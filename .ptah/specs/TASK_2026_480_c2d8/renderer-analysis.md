# Renderer CPU analysis

Symptom under investigation: **one core pegged continuously while the app is
idle**, seven sessions open. Throughout this report "idle" means no turn in
flight and no user input — the renderer should be doing approximately nothing.

Everything below cites a line I opened in this worktree
(`D:\projects\ptah-extension\.claude-worktrees\perf-task-478-process-and-retention-fleet-5891e3e00c97`).

---

## How to get a real profile

`apps/ptah-electron/scripts/launch.js:35` is:

```js
execFileSync(electronPath, [mainPath, ...extraArgs], { stdio: 'inherit', env: {...} });
```

`extraArgs` is `process.argv.slice(2)` with only `--production` filtered out
(`launch.js:21-25`), so **every other argument is forwarded verbatim to the
Electron binary** after the main entry. Chromium switches therefore pass straight
through. No script change is needed to attach a profiler.

### 1. Build once, then launch with the DevTools protocol open

```bash
npx nx build-dev ptah-electron
node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9222
```

Equivalent one-liner that skips the launcher entirely (same binary, same entry):

```bash
npx electron dist/apps/ptah-electron/main.mjs --remote-debugging-port=9222
```

`nx serve ptah-electron` also reaches `launch.js`, so trailing args survive:

```bash
npx nx serve ptah-electron -- --remote-debugging-port=9222
```

### 2. Confirm which process is hot before profiling anything

Do this FIRST. It costs seconds and it decides whether the renderer is even the
right target:

- In the app: **View → Toggle Developer Tools** is not enough — use Electron's
  own task manager if exposed, otherwise Windows Resource Monitor / Process
  Explorer and look at the `electron.exe` command lines. The child with
  `--type=renderer` is the renderer; the one with no `--type` is main;
  `--type=utility` are the forked workers (`embedder-worker.mjs`,
  `voice-worker.mjs`, `integrity-worker.mjs`, `workspace-watch-host.mjs` — see
  `apps/ptah-electron/CLAUDE.md` build targets).
- If the pegged core is a `--type=utility` process, **stop reading this file** —
  it is the embedder or the watch host, not renderer code.

```powershell
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Select-Object ProcessId, @{n='CPU';e={(Get-Process -Id $_.ProcessId).CPU}}, CommandLine |
  Format-List
```

### 3. Take the renderer profile

With `--remote-debugging-port=9222` running, open `http://localhost:9222` in
Chrome, pick the Ptah renderer target, then:

- **Performance** tab → record 10 s of a fully idle app → look at the bottom-up
  tree. A perpetual timer shows as a dense regular comb of identical stacks.
- **Performance monitor** panel (⋮ → More tools) is the cheapest signal of all:
  it shows CPU usage and **"DOM Nodes" / "JS event listeners" / "Layouts/sec" /
  "Style recalcs/sec"** live. A renderer doing genuine per-frame work while idle
  shows nonzero recalcs-per-second with nobody touching the app.

### 4. The zero-tooling experiment that discriminates all hypotheses below

In the renderer DevTools console, monkey-patch the schedulers and count:

```js
// count timer installs by delay, and rAF installs, for 10 seconds
const byDelay = new Map(); let raf = 0;
const si = window.setInterval, rq = window.requestAnimationFrame;
window.setInterval = (fn, d, ...a) => { byDelay.set(d, (byDelay.get(d)||0)+1); return si(fn, d, ...a); };
window.requestAnimationFrame = (cb) => { raf++; return rq(cb); };
setTimeout(() => console.log({ intervalsByDelay: [...byDelay], rafCalls: raf }), 10000);
```

Interpretation, directly against the hypotheses below:

- `rafCalls` ≈ 0 while idle → H2 is dead (it already looks dead by inspection).
- `rafCalls` ≈ 600 over 10 s → a per-frame loop exists and H2 needs re-opening.
- intervals at delay **50 and 30** → `StreamingQuotesComponent` is live (H1).
  It is the only place in the renderer that uses exactly those two numbers.
- intervals at delay **1000** → a store ticker or a permission/question card.
- intervals at delay **20** (or whatever `revealSpeed` is bound to) →
  `StreamingTextRevealComponent` (H3).

---

## Ranked hypotheses

### H1 — `StreamingQuotesComponent` runs a 20–33 Hz typewriter forever, once per stranded streaming bubble (MOST LIKELY)

**Claim.** Each open session that holds a streaming bubble mounts one
`<ptah-streaming-quotes />`, and that component runs an unconditional
30–50 ms `setInterval` that writes an Angular signal on every tick for as long
as it is mounted. It has no stop condition tied to whether anything is actually
happening. Seven sessions with a stuck streaming bubble is ~140–230 signal
writes plus change-detection passes per second, indefinitely, with the app idle.

**Evidence (files I opened).**

- `libs/frontend/chat-ui/src/lib/atoms/streaming-quotes.component.ts:90-129` —
  `startTyping()` installs `setInterval` at `typeSpeed = 50` /
  `deleteSpeed = 30` (lines 91-92) and calls
  `this.displayedText.set(...)` on essentially every tick (lines 102-104 and
  117-119). The loop is a cycle: type → 2 s pause → delete → next quote
  (`currentQuoteIndex = (currentQuoteIndex + 1) % this.quotes.length`, line
  122-123). **There is no terminating branch anywhere in the method.** The only
  thing that stops it is `ngOnDestroy` (lines 81-88).
- `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html:182-185` —
  the sole production usage:
  ```html
  <!-- Streaming quotes (only during streaming) -->
  @if (isStreaming()) {
    <ptah-streaming-quotes />
  }
  ```
  The comment claims "only during streaming"; the gate is whatever
  `isStreaming()` is, which is not the same statement.
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html:55` —
  `[isStreaming]="i >= vm().streamingBoundary"`.
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:444-446` —
  `streamingBoundary: this.historyReplaying() ? totalCount : finalized.length`,
  with `totalCount = finalized.length + streaming.length` (line 441). So a bubble
  is "streaming" **iff it comes from `streamingMessages()`, i.e. iff the tab
  holds a `streamingState`** — not iff a turn is live.

**Mechanism that pegs a core.** `libs/frontend/chat-streaming/CLAUDE.md`
documents, in its own words, the exact way a tab ends up holding a
`streamingState` that nothing can ever clear:

> "Minting for them leaves a settled tab holding an empty state whose
> `currentMessageId` is null — which `finalizeCurrentMessage` early-returns on,
> so nothing can ever clear it — and every busy-predicate reader then sees a
> live turn (TASK_2026_382 review B5)."

A tab in that state renders a streaming bubble forever. The bubble mounts
`StreamingQuotesComponent`, whose interval never self-terminates, so the tab
burns 20–33 signal-writes-per-second **while idle**, each one dirtying a
component and forcing a change-detection pass. Multiply by seven sessions. Note
that the cost is not the `substring` — it is the CD pass the signal write
schedules, which under the Zone-based webview shell
(`apps/ptah-extension-webview`, per root `CLAUDE.md`) is an application-wide tick.

Two aggravating details in the same file:

- `chat-transcript.component.ts:436-438` — `if (!this.active()) return this._frozenView;`.
  An inactive tab freezes its **view model**, but freezing the VM does not
  destroy the already-mounted `ptah-streaming-quotes` component. The interval of
  a background tile keeps running. Freezing the VM hides the leak rather than
  stopping it.
- `streaming-quotes.component.ts:120-124` — the delete→type transition does not
  clear and reinstall the interval, so after the first cycle the component runs
  at whatever delay was captured at install time (line 127 evaluates
  `this.isDeleting ? deleteSpeed : typeSpeed` **once**). Cosmetic, but it shows
  the timing logic was never audited.

**Cheapest experiment.** In the idle app's renderer console:

```js
document.querySelectorAll('ptah-streaming-quotes').length
```

If that is `> 0` while nothing is running, H1 is confirmed as present. Count
should be 0 in a truly idle app. Cross-check with the delay-50/delay-30 counter
from step 4 above. To prove causation, not just presence, take a 10 s
Performance profile, then run the same profile after deleting those nodes:

```js
document.querySelectorAll('ptah-streaming-quotes').forEach(n => n.remove());
```

(DOM removal does not run `ngOnDestroy`, so the interval survives — this only
tests the render/CD half. To kill the timers too, close the affected tabs.)

---

### H2 — the `BatchedUpdateService` rAF loop never stops (REFUTED by reading it)

**Claim under test (my children's top suspect).** The self-rescheduling rAF loop
in `batched-update.service.ts` re-arms at three sites and could spin at 60 fps
forever.

**Evidence.** I opened the file in full. It does not self-reschedule.

- `libs/frontend/chat-streaming/src/lib/batched-update.service.ts:119-125`:
  ```ts
  private flushPendingUpdates(): void {
    this.rafId = null;
    for (const [tabId, state] of this.pendingTabUpdates) {
      this.tabManager.setStreamingState(tabId, { ...state });
    }
    this.pendingTabUpdates.clear();
  }
  ```
  The callback clears `rafId` and clears the queue. **It contains no
  `requestAnimationFrame` call.** The loop is one frame deep, always.
- All three re-arm sites are guarded by `this.rafId === null` and each is reached
  only from a caller carrying new work:
  - `:92-94` inside `scheduleUpdate(tabId, state)` — an inbound event.
  - `:142-144` inside `drainDeferred()` — and only `if (scheduled)`, i.e. only if
    a deferred entry was actually moved to pending (`:132-141`).
  - `:155-157` inside `drainDeferredForTab(tabId)` — early-returns at `:148` when
    `pendingFlush` has no entry for the tab.
- Teardown cancels: `:75-78` in the `destroyRef.onDestroy`.

**Verdict.** With no updates pending, no frame is ever requested. This loop
cannot burn CPU while idle. **Refuted.**

**On point 2 of the brief (per-frame work proportional to open sessions).** The
rAF flush does NOT honour the visibility gate — `flushPendingUpdates()` iterates
the whole `pendingTabUpdates` map unconditionally (`:121`). But that is not a
leak, because the gate is applied **on the way in**, not on the way out:
`scheduleUpdate` calls `shouldDefer(tabId)` (`:86`) → `canFlush(tabId)`
(`:97-117`), and a non-visible tab's state goes into `deferredTabUpdates`
instead and never reaches `pendingTabUpdates`. So the map only ever holds tabs
that passed `canFlush` at insertion time. `flushSync(originTabId)` re-checks
`canFlush` for non-origin tabs (`:188-190`) exactly as the CLAUDE.md describes.
The per-frame cost is therefore proportional to **visible** tabs with pending
events, and is zero when nothing is streaming. One residual gap worth noting but
not a CPU cause: a tab that became invisible **between** `scheduleUpdate` and
the frame still flushes, because `flushPendingUpdates` does not re-check. That
is at most one stale frame.

---

### H3 — `StreamingTextRevealComponent`'s per-character interval outlives its content

**Claim.** A ~20 ms-per-character interval that stops only on a condition that a
stuck `isStreaming` input makes permanently false.

**Evidence.**

- `libs/frontend/chat-ui/src/lib/atoms/streaming-text-reveal.component.ts:125-135`:
  ```ts
  this.revealInterval = setInterval(() => {
    const current = this.revealedLength();
    const total = this.content().length;
    if (current < total) { this.revealedLength.set(current + 1); }
    else if (!this.isStreaming()) { this.stopReveal(); }
  }, this.revealSpeed());
  ```
  The stop branch is `else if (!this.isStreaming())`. **When `isStreaming()` is
  stuck true and the reveal has caught up, the interval keeps firing every
  `revealSpeed()` ms doing nothing at all** — a pure no-op timer at up to 50 Hz.
  It writes no signal in that branch, so the CD cost is absent; the cost is the
  timer wakeup itself.
- Default `revealSpeed` is 20 ms (`:72`).
- The effect at `:97-107` does call `stopReveal()` when `streaming` goes false —
  so this only bites when the `isStreaming` input never falls, i.e. the same
  stranded-`streamingState` root cause as H1.

**Why ranked below H1.** A no-op 50 Hz timer costs far less than a 20–33 Hz
signal write that triggers change detection. H3 is the same root cause with a
smaller blast radius. It also has **no production usage that I could find** —
`grep` over `libs/frontend` for `ptah-streaming-text-reveal` /
`StreamingTextRevealComponent` returned only the component itself, its spec, and
the two barrel exports (`chat-ui/src/index.ts:20`,
`chat/src/lib/components/index.ts:40`). Treat it as latent, not active.

**Cheapest experiment.** `document.querySelectorAll('ptah-streaming-text-reveal').length`
in the idle renderer. Expect 0.

---

### H4 — the two 1 Hz store tickers strand themselves on a non-terminal agent (CONFIRMED as a leak, but cannot peg a core)

**Claim.** Both stores start a 1 s `setInterval` when any agent is `running`, and
stop it only when a mutation arrives that makes no agent `running`. An agent that
never reaches a terminal status leaves the ticker running forever.

**Evidence.**

- `libs/frontend/chat-streaming/src/lib/background-agent.store.ts:163-183` —
  `startTick()` installs `setInterval(() => this.tick.update(t => t + 1), 1000)`;
  `syncTick()` is `if (this.hasRunningAgents()) startTick(); else stopTick();`.
- `background-agent.store.ts:195-206` — `applyMutation` is the **only** caller of
  `syncTick()`, and `syncTick()` runs on the last line of it. No timer, no
  effect, nothing else re-evaluates the condition.
- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:544-572` — the same
  shape, with the running test spelled out as a loop over `this._agents()`
  looking for `a.status === 'running'` (`:560-566`).
- `agent-monitor.store.ts:539-542` — `ngOnDestroy` stops the tick. Both stores are
  `providedIn: 'root'` (per `libs/frontend/chat-streaming/CLAUDE.md`), so
  `ngOnDestroy` fires at app teardown, not at session close.

**Verdict on the brief's question.** Confirmed: **if an agent never reaches a
terminal status, nothing ever re-runs `syncTick()`, and the 1 Hz ticker runs for
the remaining life of the renderer.** A crashed CLI agent, a dropped
`background_agent_completed`, or a session torn down without a terminal mutation
all produce this. It is a real defect.

**But it is not the reported symptom.** Two 1 Hz signal writes cannot peg a core.
Each `tick.update` schedules one CD pass per second. Because both stores are
`providedIn: 'root'`, there is only 1 singleton instance of each store (2 ticker
instances total across the root injector, producing at most 2 CD passes per
second; the earlier 1 Hz × 7 sessions = 7 CD passes arithmetic was unverified
hypothetical scaling assuming per-session store instances). Even at 2 to 7 CD
passes per second, this is visible in a profile as a sparse comb, nowhere near
saturation. Fix it, but do not expect it to move the CPU number. **Confirmed as
a bug, refuted as the cause.**

---

### H5 — `PermissionRequestCardComponent` restarts its 1 s timer on every `request()` change without cancelling

**Claim.** The effect that owns the countdown timer can leak an interval per
re-evaluation.

**Evidence.**
`libs/frontend/chat-ui/src/lib/molecules/permissions/permission-request-card.component.ts:208-227`:

```ts
effect((onCleanup) => {
  if (this.request().timeoutAt <= 0) { return; }
  this.timerInterval = setInterval(() => { ... }, 1000);
  onCleanup(() => { if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; } });
});
```

The `onCleanup` is correct for the normal case. The hazard is the field: there is
one `timerInterval` slot (`:206`) but the effect reads `this.request()` at `:210`
and `:215`, so it re-runs on every `request()` identity change. Angular runs
`onCleanup` before the re-run, so the previous handle *is* cleared — **this one
is sound.** The early `return` at `:211` also runs `onCleanup` for the previous
run. I could not construct a leak from this code.

`question-card.component.ts:343-348` is the plain-`ngOnInit` variant and
self-clears at `remaining <= 0` (`:345-347`), with `ngOnDestroy` → `clearTimer()`
at `:351-353`. Also sound.

**Verdict.** No defect found in either. 1 Hz and bounded regardless. **Refuted.**

---

## Ruled out

| Candidate | Why it is out |
|---|---|
| `batched-update.service.ts` rAF loop (`:93`, `:143`, `:156`) | `flushPendingUpdates` (`:119-125`) sets `rafId = null`, drains and returns — it never re-arms itself. All three arm sites require new work and a null `rafId`. Zero frames requested when idle. |
| `permission-request-card.component.ts:213` | `effect(onCleanup)` clears the previous handle on every re-run and on the early return. 1 Hz, self-terminating on respond/destroy. |
| `question-card.component.ts:343` | Self-clears at `remaining <= 0` (`:345-347`); `ngOnDestroy` clears (`:351-353`). Never installed at all when `timeoutAt <= 0` (`:337-340`). |
| `boot-status.service.ts:198` | Watchdog is armed only while `readiness === 'warming'` (`adopt`, `:186-194`) and explicitly retired otherwise. Interval is `DEFAULT_READINESS_RETRY_AFTER_MS` (2 s per the `core` CLAUDE.md), and the boot settles. Cannot be alive on an idle, booted app. |
| Store tickers as *the* cause | Real leak (see H4) but 1 Hz. Arithmetically incapable of saturating a core. |
| `apps/ptah-extension-webview` renderer timers | My children's sweep found none; I did not re-verify. |

---

## Open questions

1. **Is the pegged process actually the renderer?** Nothing in this analysis
   establishes that. `apps/ptah-electron/CLAUDE.md` lists four `utilityProcess`
   workers — embedder (`@huggingface/transformers` + `onnxruntime-node`), voice,
   integrity and the `@parcel/watcher` workspace watch host. A continuously
   pegged core is at least as consistent with a watcher re-walking a large tree
   or an embedder spinning as with any renderer timer. **Settle this before
   spending another hour on renderer code** (step 2 above).
2. **Does the Zone-based webview shell amortise the signal writes?** The root
   `CLAUDE.md` says the libs are zoneless but `apps/ptah-extension-webview` runs
   Zone-based. Whether one `displayedText.set` costs one component check or one
   whole-application tick changes H1's magnitude by an order of magnitude. I did
   not read the shell's bootstrap to confirm.
3. **Do the seven sessions actually hold stranded `streamingState`s?** H1's whole
   mechanism depends on it. One console line answers it
   (`document.querySelectorAll('ptah-streaming-quotes').length`) and I could not
   run the app.
4. **Does Chromium's background-timer throttling apply here?** A hidden/minimised
   Electron window normally clamps `setInterval` to ~1 Hz, which would mask H1
   whenever the window is not foreground. `libs/frontend/core/CLAUDE.md` notes
   `setTimeout` is "throttled to ~1 s in a hidden Electron window", which
   suggests throttling is NOT disabled in this app. If the user sees the peg with
   the window minimised, H1 weakens sharply and the answer is likelier in the
   main or utility processes.
5. **What consumes `tick()` in the two stores?** My grep for `tick()` over
   `libs/frontend` returned only spec-file `TestBed.tick()` hits plus an
   unrelated `marketplace/connectors-surface.component.ts:630` poll. The stores'
   `tick` signal is presumably read from templates as `tick()` inside a larger
   expression, or via a `computed`. If a `tick` consumer turns out to be an
   O(events) recomputation, H4's ranking would need revisiting — but still only
   at 1 Hz.
6. **`marketplace/connectors-surface.component.ts:630`** — `setTimeout(() => void tick(), POLL_INTERVAL_MS)`
   is a self-rescheduling poll I noticed in passing and did not open. It is in a
   surface the user must navigate to, so it is unlikely to be running on an idle
   chat screen, but it is the one unexamined self-rescheduling loop left.

---

## Files I could not read

None. Every file I attempted opened successfully. The paths cited above were all
read directly in this worktree.
