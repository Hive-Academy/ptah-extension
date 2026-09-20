# VERDICT: PASS

Scoped pass. The three findings of `judge-backoff-repair.md` are discharged, and I traced
the new machinery — per-launch UUID, the one-second reconciliation deadline, and the two
cap evictions — looking for the third-round defect the brief predicted. I did not find a
blocking one. The eviction cannot double-count (the flush deletes before it records), and
every timer has a clear path. Four Moderate residuals below, one of which is a genuine
coverage hole in exactly the line that fixed last round's blocking defect.

All line numbers are from `ca61fcde9`. Files:

- `libs/backend/agent-sdk/src/lib/helpers/mcp-server-backoff.service.ts` (SVC)
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (BLD)
- `libs/backend/agent-sdk/src/lib/helpers/mcp-server-backoff.service.spec.ts` (SPEC)

---

## 1. THE REGRESSION IS GONE — both directions hold at once

### 1a. Two launches in one tab escalate 1 -> 2. VERIFIED.

The key is minted inside `build()`, not derived from anything session-scoped:

- `BLD:924` — `const mcpAttemptKey = routingId ? randomUUID() : undefined;`
- `BLD:926-930` — `trackStderrSession(routingId, mcpAttemptKey, abortController.signal)`
- `BLD:1009` — the `stderr` closure captures that same `mcpAttemptKey` and passes it to
  `checkStderrForFailure`, which forwards it to `recordFailure` at `SVC:282`.

`build()` runs once per `executeQuery` (the same call that mints the `AbortController`
passed at `BLD:929`), so two launches evaluate `randomUUID()` twice and the keys differ by
construction — there is no cached field, no memo, no `??=`. Two launches in one tab
therefore reach `SVC:157-160` with `existing.lastAttemptKey !== attemptKey`,
`bothReportsHaveKeys` true, equality false, so the dedup branch at `SVC:162` is skipped and
`failureCount` advances at `SVC:166`. The tab-lifetime `routingId` survives only as the
LOOKUP key (`SVC:237`, `attemptKeyByRoutingKey`), never as the dedup identity. That is the
correct grain and it is what §1c of the previous judgment demanded.

`trackStderrSession` also sweeps the prior launch before installing the new one
(`SVC:225-229`), so the old launch's buffer and aliases do not survive the retrack — the
residual the previous judge listed as item 5 is discharged.

### 1b. Stderr report + init report for the SAME launch still collapse to ONE. VERIFIED.

Both sides converge on the identical launch UUID through the routing map:

- stderr side: `attemptKey = mcpAttemptKey` directly (`BLD:1009` -> `SVC:282`).
- init side: `SVC:112` `resolveInitAttemptKey(event.sessionId)` -> `SVC:355-359`, which
  reads `attemptKeyBySdkSessionId`, populated at `SVC:136` from
  `attemptKeyByRoutingKey.get(routingKey)` (`SVC:130-131`) where
  `routingKey = tabId ?? realSessionId`. The builder registered that map entry under
  `routingId = sessionConfig?.tabId ?? sessionId` (`BLD:831`, `SVC:237`). With a tabId
  present both expressions are the same tabId, so the SDK UUID is translated onto the
  launch UUID and `SVC:157-158` sees equal keys -> `SVC:162-163` returns the existing
  `backoffUntil` without incrementing.
- Before the resolve lands, `resolveInitAttemptKey` returns `undefined` and the failure is
  queued (`SVC:119`, `SVC:362-385`) with its ORIGINAL `failedAt`, then flushed under the
  launch key (`SVC:137` -> `SVC:396`). Timestamp preservation is what keeps the keyless
  fallback sound if it flushes without a key.

Pinned by SPEC:48-74 (15 s apart, one count, `lastAttemptKey: 'launch-1'`).

### 1c. Resumed session, routing ID already IS the SDK UUID. VERIFIED.

Two independent paths, both present:

- `SVC:358` — `attemptKeyByRoutingKey.get(sdkSessionId)` is the second term of
  `resolveInitAttemptKey`, so a resume with no tabId resolves on the FIRST `servers` event
  with no queueing and no resolve notification at all.
- `SVC:130` — with a tabId present, `routingKey = tabId` matches `BLD:831`'s `routingId`.

The two expressions are textually the same (`tabId ?? <session id>`), so the two sides
cannot drift.

---

## 2. THE ONE-SECOND DEADLINE TIMER

Created once per pending batch at `SVC:376-380`, never re-armed on subsequent pushes
(`SVC:382-384`), so the deadline runs from the FIRST queued failure. That is the right
choice: a server storm cannot roll the deadline forward.

**Cleared on every exit path that owns it:**

| Path | Evidence |
| --- | --- |
| reconciliation (resolve arrives) | `SVC:137` -> `SVC:394` `clearTimeout` |
| unresolvable resolve (keyless) | `SVC:133` -> `SVC:394` |
| cap eviction | `SVC:371` -> `SVC:394` |
| the timer firing itself | `SVC:377` -> `SVC:393-394` (delete then clear; a fired timer clearing itself is a no-op but leaves no map entry) |
| `clear()` | `SVC:341-344` — iterates every batch and clears, then clears the map |

**Not cleared on abort.** `releaseStderrSession` (`SVC:408-421`) touches `stderrSessions`,
`attemptKeyByRoutingKey` and `attemptKeyBySdkSessionId` — never `pendingInitFailures`,
which is keyed by SDK session id and has no link to the abort signal. So an aborted
launch's queued init failure still fires at +1 s and is recorded keylessly. This is
deliberate and asserted: SPEC:161-181 aborts, publishes a late init failure, and expects
`getRecord('late-server')?.failureCount` to be `1`. It is a behaviour change from the
previous round (which asserted `toBeUndefined()`), and the commit message argues for it —
a dropped report means a broken server is never backed off. I accept it. The timer records
a failure into `records`, which is never freed, so there is no freed-state hazard: the
class has no `dispose()`, the only teardown is `clear()` (`SVC:333-346`), and that clears
the timers first.

**Can it fire after disposal and touch freed state?** No. `clear()` is the only teardown
and it clears every timer at `SVC:342` before `SVC:344` empties the map; a timer that
somehow survived would find no pending entry and return at `SVC:392`.

**Event loop / unref: MINOR finding.** `SVC:376` uses a bare `setTimeout` with no
`.unref()`. Consequences:

- Electron main / VS Code extension host: a handle held for at most 1 s past the last
  queued init failure. Irrelevant.
- `ptah-cli` (headless, exits when work is done): the process can be held open for up to
  1 s. Cosmetically slower exit, not a hang.
- Jest: the suite is safe today. Every `queueInitFailure` in SPEC is either flushed
  (SPEC:64-68 via the resolve, SPEC:166-170 via the keyless resolve) or fired
  (SPEC:219-221), and the whole file runs under `jest.useFakeTimers()` (SPEC:40) with
  `useRealTimers()` in `afterEach` (SPEC:45), so no real handle exists. No other spec in
  the repo constructs this service — `grep` for `McpServerBackoffService` outside the
  service's own files returns only `index.ts:151`, `di/register.ts:59,421`,
  `di/tokens.ts:162`, `helpers/index.ts:81` and the builder's two call sites. Nothing can
  hang a worker today, but a future spec that queues an init failure under REAL timers
  would hold its worker for a second. `.unref()` costs one line and removes the class of
  problem. Minor.

---

## 3. CAP EVICTION — the report's claim is accurate, and it does NOT double-count

### 3a. Pending-init eviction flushes keylessly. CONFIRMED.

`SVC:367-373`: on a miss with `pendingInitFailures.size >= maxTrackedServers`, the oldest
key (Map insertion order, `SVC:369`) is passed to `flushPendingInitFailures(oldestKey)`
with NO `attemptKey`, so `SVC:396` records each queued failure keyless rather than
dropping it. The per-batch array is capped too (`SVC:382`), closing the previous judge's
unbounded-`push` note. The report's claim at `backoff-repair-report.md:138-140` is true as
written.

### 3b. Can the keyless eviction flush DOUBLE-COUNT when the resolve later arrives? NO.

`flushPendingInitFailures` deletes the map entry BEFORE it records:

```
SVC:391  const pending = this.pendingInitFailures.get(sdkSessionId);
SVC:392  if (!pending) return;
SVC:393  this.pendingInitFailures.delete(sdkSessionId);
SVC:394  clearTimeout(pending.timeout);
SVC:395  for (const failure of pending.failures) { ... recordFailure ... }
```

So when the resolve for that same SDK session finally arrives at `SVC:133` or `SVC:137`,
the second `flushPendingInitFailures` finds nothing and returns at `SVC:392`. The batch can
be flushed exactly once, whichever of the three triggers (timer, eviction, resolve) wins.
The delete-before-record order also makes the loop re-entrancy-safe. The original
double-count bug does not return through this path.

### 3c. `stderrSessions` eviction DROPS rather than flushes — Moderate, asymmetric.

`SVC:400-406` evicts the oldest stderr session outright; there is nothing to flush (a
buffer holds an INCOMPLETE line, not a failure), so this is not the same trade as 3a. But
two properties are worth naming:

- The victim is chosen by INSERTION order (`SVC:402`), so the evicted session is the
  longest-lived tab, not the least recently active. A long-running session is the first one
  to lose failure detection.
- After eviction the launch keeps reporting under its key (`SVC:282` passes `attemptKey`
  regardless of state), so keyed dedup still works — but `state` is `undefined` at
  `SVC:262-263`, so its partial line is no longer carried across chunks and a notice split
  across a chunk boundary is never matched. SPEC:231-258 asserts exactly this loss
  (`toBeNull()`, record `toBeUndefined()`). The failure detection degrades silently for
  that session for the rest of its life. It needs 100 concurrent tracked launches to
  trigger, so Moderate, not Serious — but the cap would be better as LRU-on-`checkStderr`
  than FIFO-on-insert.

---

## 4. PREVIOUSLY-PASSED PROPERTIES — all four still hold

| Property | Evidence | Status |
| --- | --- | --- |
| 10 s window is a key-ABSENT fallback, not an unconditional `\|\|` | `SVC:155-160`: `bothReportsHaveKeys` gates a ternary; the window is the ELSE arm only. Two different keys 3 s apart still count twice (SPEC:76-97). | PASS |
| Trim is `max(lastNewlineIndex + 1, lastMatchEnd)` | `SVC:286-287`, applied before the 2048/512 fallback at `SVC:290-292`. | PASS |
| Per-buffer 16 KB clamp | `SVC:266-270`, clamping `state.buffer + data` on every call, per session key (`MAX_STDERR_BUFFER_LEN = 16_384`, `SVC:88`). | PASS |
| `{ once: true }` per-query abort listener | `SVC:246`; `SVC:243-244` handles an already-aborted signal without registering. The signal is the per-`executeQuery` controller (`BLD:929`). | PASS |
| State-identity guard | `SVC:238-241`: `release` closes over the `state` object built at `SVC:232` and returns unless `stderrSessions.get(trimmedAttemptKey) === state`. Now doubly safe — the key is a per-launch UUID, so two launches cannot collide on it at all. | PASS |

Early return at `SVC:162-163` still precedes the `lastFailedAt` write at `SVC:181`, so a
keyless storm cannot roll the window forward. Curve and ceiling unchanged
(`SVC:167-173`, `SVC:46`).

---

## 5. THE SPEC — nine tests, eight discriminate, one guards nothing that matters

| # | Test | Guards | Would it fail against a defective implementation? |
| --- | --- | --- | --- |
| 1 | SPEC:48-74 same launch, stderr + init, 15 s apart | 1b | **YES.** Remove the `attemptKeyBySdkSessionId` translation at `SVC:136` and the init flush goes keyless with a 15 s gap -> window misses -> `failureCount: 2`. Also pins `lastAttemptKey: 'launch-1'`. |
| 2 | SPEC:76-97 distinct keys 3 s apart | the window fallback | **YES.** An unconditional `\|\| now - lastFailedAt < 10_000` collapses it to 1. |
| 3 | SPEC:99-123 newline BEFORE a complete match, no trailing newline | the trim | **YES, and it is the test that was watched failing.** Chunk 1 `'starting\nfirecrawl (CONNECT_TIMEOUT)'`: `lastNewlineIdx + 1 = 9`, `lastMatchEnd = 36`. Under the newline-first form the buffer retains `'firecrawl (CONNECT_TIMEOUT)'` and chunk 2 completes it, so `checkStderrForFailure` returns `'firecrawl'` where the test expects `null`. That is exactly the pasted output (`backoff-repair-report.md:168-176`: `expect(received).toBeNull() / Received: "firecrawl"`), and the test NAME in the paste matches SPEC:99 verbatim. The committed test is the one that failed — not a softened version. The previous judge's item 3 is discharged. |
| 4 | SPEC:125-149 interleaved sessions | per-session buffers | **YES.** A shared buffer splices `alpha`/`beta`. |
| 5 | SPEC:151-182 abort releases, late init recorded | disposal + the new keyless resolve | **YES.** Without `releaseStderrSession` the `launch-1` buffer survives; without the keyless branch at `SVC:132-134` `late-server` is never recorded. Note it codifies the behaviour change of §2 (a post-abort init failure IS now counted). |
| 6 | SPEC:184-209 two launches in `tab-1`, 10 min apart | **the finding this round existed to fix** | **NO — see below.** |
| 7 | SPEC:211-229 blank SDK id, keyless after the deadline | the 1 s timer | **YES.** Asserts `undefined` at 999 ms and a record at 1000 ms, and that `lastAttemptKey` is absent. Deletes the deadline and it never records. Genuinely discriminating on both the existence and the length of the deadline. |
| 8 | SPEC:231-258 stderr-session cap | the new cap | **YES.** With `maxTrackedServers: 2`, without the prune `launch-1`'s retained `'firecrawl (CONNECT_'` joins `'TIMEOUT): failed'` and returns `'firecrawl'`. |
| 9 | SPEC:260-289 curve + reset | the arithmetic | **YES.** Pins 60/120/240/480/960/1800/1800 s and the `connected` reset to 60 s. Any factor, ceiling or `failureCount - 1` error fails it. Closes the previous judge's "curve uncovered" note. |

### Test 6 is the hole (Moderate)

SPEC:184-209 supplies its own two distinct keys — `'launch-1'` and `'launch-2'` — straight
into `trackStderrSession` and `checkStderrForFailure`. But the round-1 regression was NOT
in the service: the service always escalated on two different keys, and SPEC:76-97 already
proved that. The regression was in the CALLER — which key `build()` chose to hand over.
The whole fix is one line, `BLD:924`, and test 6 cannot see it. Revert `BLD:924` to
`const mcpAttemptKey = routingId;` and test 6 still passes, green, while the exact bug
last round's judge called blocking is back in production.

Nothing else covers it either: no spec anywhere references `trackStderrSession` outside
this file, and `sdk-query-options-builder` has no test asserting that two `build()` calls
with the same `routingId` produce different attempt keys, or that the key passed to
`trackStderrSession` is the same one the `stderr` closure passes to
`checkStderrForFailure`. Test 6 raises the test count without guarding the repair. It is
not the "one test in five proves nothing" of last round — it does pin the 120 s extension
— but it is aimed at the wrong file.

**Required follow-up (not merge-blocking, because the implementation is correct):** a
builder-level test that calls `build()` twice with the same `routingId` and asserts the two
`trackStderrSession` calls received different second arguments, and that the argument
equals the one the `options.stderr` callback forwards.

---

## 6. `randomUUID()` PROVENANCE AND HOST SAFETY — PASS

`BLD:16` — `import { randomUUID } from 'node:crypto';`. Safe in all three hosts, and
already the repository's convention:

- Same lib, same pattern:
  `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:21`
  imports `randomUUID` from `node:crypto`; `sdk-model-service.ts:14` imports `createHash`
  from the same module. `randomUUID` from `node:crypto` appears across 20+ backend files
  including `platform-electron`, `cli-engine`, `cli-agent-runtime` and `rpc-handlers`.
- Every host of this lib is a Node runtime: Electron main (Node 22 in Electron 40), the VS
  Code extension host (Node, esbuild bundle -> `main.mjs`), and `ptah-cli` (Node).
  `node:crypto` is a core module in all three; `randomUUID` has been available since Node
  14.17.
- `sdk-query-options-builder` is a backend lib, and the repository's frontend/backend
  isolation rule means it can never be pulled into the webview bundle, which is the only
  context where `node:crypto` would not resolve.
- The prefixed `node:` specifier is the correct form for a bundled Electron app — it is
  unambiguous to esbuild's `external` handling and cannot be shadowed by a userland
  `crypto` package.

Runtime-agnostic by design is preserved: this is a Node builtin, not a platform adapter
concern, and it needs no `platform-core` port.

---

## 7. CONSTRAINTS — CLEAN

`git show --stat ca61fcde9` — five files, in full:

```
.ptah/specs/TASK_2026_479_4e71/backoff-repair-report.md
.ptah/specs/TASK_2026_479_4e71/judge-backoff-repair.md
libs/backend/agent-sdk/src/lib/helpers/mcp-server-backoff.service.spec.ts
libs/backend/agent-sdk/src/lib/helpers/mcp-server-backoff.service.ts
libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts
```

The three named source files plus two `.ptah/specs` prose documents (this round's report
and the previous judgment). No carrier touched, nothing under `scripts/`, `jest.preset.js`,
`nx.json`, `.github/workflows/`, `apps/**`, `libs/frontend/**` or `libs/backend/platform-*`.
The builder diff is 7 lines and is entirely the launch-UUID mint plus its two uses.
`trackStderrSession`'s signature change has exactly one call site in the repository
(`BLD:926`), so no caller was left on the old arity. **PASS.**

---

## Residual findings (none blocking)

1. **(Moderate) Cross-launch key contamination through the resolve handler,
   `SVC:129-137`.** The handler resolves `attemptKeyByRoutingKey.get(routingKey)` at the
   moment the resolve ARRIVES, not the key the pending batch was queued under. If launch 2
   is tracked under the same tab before launch 1's resolve notification lands, launch 1's
   queued init failures are flushed under LAUNCH 2's key (`SVC:137`), and `SVC:136` writes
   a stale `attemptKeyBySdkSessionId[launch-1-sdk-id] = launch-2-key`. When launch 1's
   failure was only ever reported by the init path (a `status: 'failed'` with no
   `CONNECT_TIMEOUT`-class stderr line — the regex at `SVC:71-72` matches only four codes),
   launch 2's own report for the same server then dedups against it and two launches count
   once. The 1 s deadline bounds the window, and the user must relaunch inside it, so this
   is narrow — but it is the same under-count direction as the last two defects. Fix: carry
   the attempt key INTO the pending batch at queue time, or key the batch by the routing
   key's then-current attempt key rather than re-resolving at flush.
2. **(Moderate) The keyless deadline flush can double-count one launch.** If the stderr
   line and the init `servers` event for the same server are more than
   `KEYLESS_DEDUP_WINDOW_MS` apart (plausible with several servers on different connect
   timeouts) AND the resolve misses the 1 s deadline, the keyless flush at `SVC:396` takes
   the `SVC:159-160` window branch, misses, and counts a second failure for one launch.
   This is the SAFE direction (over-suppression of a server that genuinely failed), and it
   replaces round 1's silent LOSS of the same report, so it is a net improvement — but the
   report does not acknowledge the trade.
3. **(Moderate) Test 6 does not guard the line that fixed last round's blocking finding.**
   §5 above.
4. **(Moderate) `stderrSessions` eviction is FIFO-by-insert and silently disables detection
   for the victim.** §3c above.
5. **(Minor) `SVC:376` `setTimeout` is not `.unref()`'d.** §2 above.

## Safe to merge

Yes. The blocking defect of round 2 is genuinely repaired at the right grain, both dedup
directions hold simultaneously, the resumed-session path resolves through two independent
routes, no timer leaks state or outlives its owner, and the two new caps cannot
double-count. The five residuals are all narrower than the bug they replaced and none
loses or corrupts data on a likely path. Land it, and take finding 3 (the builder-level
key test) as the next commit — it is the only thing standing between this fix and a silent
reversion.
