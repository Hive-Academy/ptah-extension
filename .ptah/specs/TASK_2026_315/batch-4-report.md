# Batch 4 (reduced) — B1 + B2 + C3

**Scope**: B1 (Task 4.1), B2 (Task 4.2), C3 (Task 4.3). **C6 (Task 4.4) excluded**
by the orchestrator — a concurrent session owns `libs/backend/harness-sync/**`.
No file under `libs/backend/harness-sync/` was opened, read or edited.

**Files changed** (four, all mine; the ~20 modified `harness-sync` files in
`git status` are the other session's):

- `D:\projects\ptah-extension\apps\ptah-electron\src\activation\wire-runtime.ts` — B1 + C3
- `D:\projects\ptah-extension\apps\ptah-electron\src\ipc\ipc-bridge.ts` — B2
- `D:\projects\ptah-extension\apps\ptah-electron\src\activation\wire-runtime.boot-order.spec.ts` — **new**
- `D:\projects\ptah-extension\apps\ptah-electron\src\ipc\ipc-bridge.window-availability.spec.ts` — **new**

**`skill-trigger.service.ts` was NOT touched.** Neither was any other file in
`libs/backend/skill-synthesis/`. Batch 5 inherits that lib untouched by me. See
B1(b) below — the investigation moved the finding off that file entirely.

**`post-window.ts` was NOT edited, deliberately.** `tasks.md` listed it for B2
(`:108`, window creation) and C3 (`:113-117`, the `did-finish-load` →
`scheduleWarmup` hookup). B2's decision is drop-not-queue, so window creation
does not move; C3's change is entirely inside `scheduleWarmup`, and anchoring
warmup to `did-finish-load` is already correct. Nothing there needed to change.

No git commits were created.

---

## B2 (Task 4.2) — the two dropped events

### They were identified, not guessed

The two drops were reproduced and traced, not inferred. I temporarily replaced
the bare warning at `ipc-bridge.ts:123` with one carrying the message `type` and
a captured stack, rebuilt the dev main bundle, and ran the real Electron app for
75 s (`tmp/logs/b2-trace.log`, lines 588 and 630). Both drops reproduced.

**Event 1 — `skillSynthesis:event`** (the `boot-scan` stats event):

```
IpcBridge.sendToRenderer
  ← ElectronWebviewManagerAdapter.broadcastMessage
  ← SkillSynthesisService.pushEvent
  ← SkillTriggerService.runBootScan
```

Emitted immediately after `session enqueued for synthesis … "source":"boot"`.

**Event 2 — `harness:healthChanged`**:

```
IpcBridge.sendToRenderer
  ← ElectronWebviewManagerAdapter.broadcastMessage
  ← HarnessHealthRpcService.pushIfChanged
  ← EventEmitter.emit
  ← HarnessReconcilerService.runReconcile
```

Emitted from the `reason: activation` reconcile pass.

These match the "likely candidates" in `tasks.md`, now confirmed rather than
assumed.

### Decision: DROP, not queue

Both are **edge-triggered notifications sitting on top of pull-backed state**,
and I verified both consumers cold-pull:

- `HarnessCardComponent.ngOnInit` (`libs/frontend/dashboard/.../harness-card.component.ts:205`)
  calls `HarnessHealthStore.refresh()` whenever `health()` is still `null`. Its
  own docblock at `:78` names this "the cold case only: no push has landed yet".
  So the boot push is exactly the case the pull already covers.
- `SkillSynthesisLiveService` (`libs/frontend/skill-synthesis-ui/.../skill-synthesis-live.service.ts:92`)
  feeds a diagnostics recent-events log and a transient activity label. Its
  entire meaning is "while you were watching" — nobody was.

Nothing downstream loses state it depended on.

**Why queueing is the wrong answer even though it is cheap.** `enqueueStreamEvent`
at `:115-120` already buffers batchable stream types, so the mechanism exists.
Two reasons not to reuse it:

1. The activation `harness:healthChanged` snapshot is superseded within
   milliseconds by the `content-download-complete` pass, and again by the
   renderer's own pull. A replay racing that pull would **overwrite fresher
   state with staler state** — strictly worse than the drop. This is the
   decisive argument.
2. `IpcBridge` outlives a renderer reload — `SETUP_WIZARD_COMPLETE` calls
   `platformCommands.reloadWindow()` at `ipc-bridge.ts:372` — so a replay buffer
   would re-deliver boot events to a renderer that has already moved past them.

### What changed

The drop stays; only its reporting changes. `sendToRenderer` and
`flushStreamQueue` now share one `resolveWindow(messageType)` helper with a
`hasHadWindow` latch:

- **No window has ever existed** (boot) → `console.debug`, naming the type. This
  is normal, so it is not a warning.
- **A window existed and is gone** (mid-session) → still `console.warn`. That is
  the case the original warning was worth keeping for, and it is preserved.

Either branch now names the message type. The original carried none, which is
precisely why identifying these two events required attaching a stack trace.

The full queue-vs-suppress reasoning is recorded in the docblock on
`IpcBridge.resolveWindow`.

**Verified**: `tmp/logs/b4-verify.log` contains zero `Cannot send to renderer`
lines. Both events now appear as:

```
[IpcBridge] Push dropped, no renderer yet (pull-backed, deliberately not queued): skillSynthesis:event
[IpcBridge] Push dropped, no renderer yet (pull-backed, deliberately not queued): harness:healthChanged
```

---

## B1 (Task 4.1) — boot ordering and boot spend

### (a) Ordering — FIXED

`bringUpSubsystems` now runs **before** `bootHeavyServices`, not after. The
listener registration sits between them with no `await` in the gap.

`bringUpSubsystems` is self-contained (`libs/backend/vscode-core/src/services/subsystem-bringup.ts`):
it resolves `CODE_EXECUTION_MCP`, binds the port, calls `setPtahMcpPort`, and
writes the `ptah` entry into `{ws}/.mcp.json`. Nothing in it depends on the Thoth
boot — the dependency ran the other way, which was the bug.

The causal chain is now closed by construction, not by timing luck:
`resolveMcpSessionWiring` (`platform-core/src/interfaces/mcp-server-status.interface.ts:45`)
reads `IMcpServerStatus.getPort()` **live at query time**, and `getPort()` is
non-null only after `mcpService.start()`. With bring-up completing first, every
boot-scan query sees `mcpServerRunning: true`.

**Measured, before vs after** (same machine, same workspace):

|                                     | `b2-trace.log` (before)  | `b4-verify.log` (after)                  |
| ----------------------------------- | ------------------------ | ---------------------------------------- |
| MCP start                           | line 667                 | **line 527**                             |
| `Subsystems brought up`             | line 674                 | **line 533**                             |
| `Booting deferred backend services` | line 527                 | **line 534**                             |
| `[SdkQueryRunner] MCP disabled`     | **1 occurrence**         | **0**                                    |
| boot internal query                 | `mcpServerRunning:false` | none issued (watermark already advanced) |

The one risk I checked empirically: moving MCP ahead means the harness reconcile
now runs _after_ `.mcp.json` gains its `ptah` key, where it previously ran
before. I could not read `harness-sync` to reason about it, so I measured it.
Both reconcile passes report identically before and after —
`expected:39, found:39, missing:0, foreign:0, writeFailed:0` — so the reordering
introduces no `foreign` finding.

### One-shot re-entry at `:353` — HARDENED

The boolean `hasBootedHeavyServices` is replaced by a promise latch
(`heavyServicesBoot ??= bootHeavyServicesOnce(...)`).

A boolean latch is set on entry, so it answers "has one started" — but every
caller here needs "has one finished". `onDidChangeWorkspaceFolders` can fire
while the startup boot is still awaiting; under a boolean the second caller
returns instantly, and if that second caller is the awaited one, `wireRuntime`
returns with every `refs.*` field still `null` — leaving `main.ts`'s `will-quit`
LIFO chain nothing to dispose while the services it should have stopped are
running. Handing back the same promise makes the second caller wait.

A rejected boot is still not retried, matching the previous boolean exactly.

The reorder also _narrows_ the window rather than widening it: the listener is
registered after the bring-up await and immediately before the startup call,
with no await between, so an event cannot interleave and win the latch. That is
pinned by a test.

### (b) Boot spends tokens with no user action — NOT FIXED, and `tasks.md`'s attribution is wrong

**`tasks.md` names `skill-trigger.service.ts:802` as the spender. It is not.**
That path calls `synthesis.enqueueAnalyze`, which is a local SQLite INSERT and
spends nothing upstream — the comment at `skill-trigger.service.ts:788-799` says
so explicitly, and the trace confirms it: the enqueue at `b2-trace.log:587`
produces no query.

The actual boot spender is the **memory curator**. The trace shows the sequence
plainly (`b2-trace.log:589-591`):

```
[memory-curator] no curator model pinned; riding the haiku tier of the resolved provider
[SdkQueryRunner] Starting internal query: {"model":"haiku","mcpServerRunning":false,...}
```

That is `MemoryTriggerService.runBootScan`
(`libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:805`),
calling `curator.curate` once per session newer than the watermark, gated by
`memory.triggers.bootScan` — **default `true`**
(`memory-trigger-config.ts:53`). `context.md`'s heading ("Boot-time **curator**
LLM query") was right; the file pointer in `tasks.md` was not.

**Why I did not change it**, three reasons in order:

1. It is in `libs/backend/memory-curator/`, outside Batch 4's declared file set
   and outside the files this batch was authorised to touch.
2. It is not an ordering bug and cannot be fixed from an Electron activation
   file. `bootHeavyServices` does not choose to spend; `MemoryTriggerService`
   does.
3. Flipping a shipped default from `true` to `false` is a **product decision**
   about whether Ptah learns from your history unprompted — not a bugfix. The
   behaviour is already gated, abortable (`bootScanController`), watermarked
   (only sessions past the watermark; my verification boot issued **no** query
   for exactly that reason), and budget-limited downstream.

So: (b) is _deliberate as designed behaviour with a user switch_, and what was
**not** deliberate — that it ran tool-less — is (a), which is fixed. If the user
wants the default itself revisited, that is a one-line change in
`memory-trigger-config.ts:53` plus a settings-UI story, and it belongs in its
own task with the corrected attribution above.

---

## C3 (Task 4.3) — the heap budget

### The decision, and what was actually measured

**The old check was measuring the wrong process.** The embedder runs in a
separate Electron `utilityProcess` (`build-embedder-worker` →
`embedder-worker.mjs`), so `process.memoryUsage().heapUsed` at
`wire-runtime.ts:431` reported the **main** process and knew nothing about the
worker. The label "Worker heap after warmup" was false.

Three captures of that absolute figure:

| capture                      | workspace                  | heap after warmup |
| ---------------------------- | -------------------------- | ----------------- |
| `tmp/logs/b2-trace.log`      | small                      | 56.3 MB           |
| `tmp/logs/log.log`           | property-hub, 15 445 files | **246.0 MB**      |
| `tmp/logs/coldstart-306.log` | large                      | **272.0 MB**      |

The spread tracks **workspace size** — the file and symbol indexes — not the
embedder. So the 200 MB threshold fired on any ordinary large project and stayed
silent on any small one. It could not be exceeded for the reason it named, and
could not be _raised_ to a number that meant anything, because the quantity is
not attributable to warmup at all. Raising it would have been picking a nicer
number for a broken measurement.

**Chosen: change what is measured, and set the constant from measurement.**

- The check now measures the heap **delta across `warmup()`**. That is
  attributable — it is what the warmup call retained in main — and it is stable
  across workspace sizes, because whatever the index already cost appears on
  both sides of the subtraction.
- **Measured: +0.1 MB** on the verification boot (`b4-verify.log:807` —
  `Embedder warmup complete (main heap +0.1 MB, now 53.8 MB)`). The
  process/worker boundary holds; the old check was reporting the 53.8 MB the
  rest of the process already owned.
- `WARMUP_HEAP_DELTA_BUDGET_MB = 48`, **one named constant** used by both the
  comparison and the message. The two inline `200` literals are gone.
- **What the budget is for**, recorded in the comment: it is an _architectural
  assertion_, not a capacity limit. The model, tokenizer and ONNX session are
  supposed to live entirely in the utilityProcess; main should retain only the
  client proxy and one round of `Float32Array` results. A delta above the budget
  means main is holding worker payloads — the failure this seam exists to catch,
  and the one the absolute-heap version could never tell apart from "the user
  opened a big repo". 48 MB sits far above sampling noise (GC timing moves
  `heapUsed` by single-digit MB between adjacent reads) and below any shipped
  embedding model's in-heap footprint.
- The log line no longer claims to be the worker's heap.

**Honest limitation, stated rather than papered over**: exceeding the budget
still only logs. There is no reclaim lever at this seam — `EmbedderWorkerClient`
exposes `embed` / `rerank` / `warmup` / `dispose` and nothing else, and disposing
the worker is precisely what warmup exists to avoid. A real consequence needs the
worker's own RSS reported back over `embedder-worker-protocol.ts`, which is a
`memory-curator` change and not this file's to make. That is written into the
comment as the follow-up rather than faked with an action that does nothing.

---

## Tests

Two new spec files, both proven fail-before / pass-after by mutation.

**`ipc-bridge.window-availability.spec.ts`** (5 tests) — pins that each of the
two named boot events reports at debug and not warn; that a pre-window push is
**not buffered for replay** (the queue-vs-suppress decision, as one assertion, so
a later "improvement" into a replay queue fails here and has to read the
reasoning first); that a mid-session loss still warns; and that the batched
stream path follows the same rule.

**`wire-runtime.boot-order.spec.ts`** (7 tests) — source assertions, deliberately.
`wireRuntime` is a ~450-line activation function that resolves two dozen DI
tokens, opens SQLite, reaches the network and builds an Electron menu; standing
it up in Jest would test the mock graph, not the ordering. What broke is textual
sequence inside one function body, which is what these pin — the same technique
`libs/backend/skill-synthesis` uses to keep provider ids out of the lane
resolver. Comments are stripped before scanning, so the docblock explaining why
`Worker heap after warmup` was retired cannot satisfy the assertion that it is
gone. The behaviour behind the tests was verified against a real boot.

### Mutation proof (fail-before)

Two mutations applied simultaneously — startup boot moved back above bring-up,
and the debug branch restored to `console.warn`:

```
● wireRuntime — boot ordering (B1) › brings MCP up BEFORE the heavy boot …
● wireRuntime — boot ordering (B1) › registers the workspace-change listener after bring-up …
● IpcBridge … › reports skillSynthesis:event at debug — not warn …
● IpcBridge … › reports harness:healthChanged at debug — not warn …
● IpcBridge … › applies the same rule to the batched stream path
Tests: 5 failed, 7 passed, 12 total
```

Source restored; all 20 pass.

---

## Commands and results

| #   | Command                                                                                              | Result                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `npx nx build-main ptah-electron --configuration=development` (with temporary trace instrumentation) | success                                                                                                                                                                   |
| 2   | Electron dev run, 75 s → `tmp/logs/b2-trace.log`                                                     | both drops reproduced and traced (lines 588, 630)                                                                                                                         |
| 3   | `npx nx typecheck ptah-electron`                                                                     | success                                                                                                                                                                   |
| 4   | `npx nx build-main ptah-electron --configuration=development` (fixed source)                         | success                                                                                                                                                                   |
| 5   | Electron dev run, 80 s → `tmp/logs/b4-verify.log`                                                    | 0 × `Cannot send to renderer`; 0 × `MCP disabled`; MCP up at line 533 before heavy boot at 534; harness reconcile unchanged; warmup delta +0.1 MB                         |
| 6   | `npx nx test ptah-electron` (first attempt)                                                          | 1 failed — my own negative assertion was matching the explanatory comment; assertion narrowed to comment-stripped source                                                  |
| 7   | `npx jest … wire-runtime.boot-order + ipc-bridge*`                                                   | 3 suites, 20 tests passed                                                                                                                                                 |
| 8   | Mutation run (pre-fix behaviour restored in both files)                                              | **5 failed**, 7 passed — fail-before confirmed                                                                                                                            |
| 9   | Restore + re-run same specs                                                                          | 20 passed                                                                                                                                                                 |
| 10  | `npx nx test ptah-electron`                                                                          | **267 passed**, 4 skipped, 0 failed                                                                                                                                       |
| 11  | `npx jest … --testPathIgnorePatterns "wire-runtime.boot-order\|window-availability"`                 | 255 passed — confirms the "worker process failed to exit gracefully" warning is **pre-existing**, not from the new specs                                                  |
| 12  | `npx nx lint ptah-electron`                                                                          | **0 errors**, 4 warnings — all pre-existing (`electron-adapters.ts`, `electron-browser-capabilities.ts` ×2, `editor-rpc.handlers.ts` max-lines). None in a file I touched |
| 13  | `npx nx build ptah-electron`                                                                         | **success** (9 tasks)                                                                                                                                                     |
| 14  | `npx nx typecheck ptah-electron`                                                                     | success                                                                                                                                                                   |

`wire-runtime.ts` is 572 lines and `ipc-bridge.ts` 558 — both under the 700-line
soft ceiling; no new `max-lines` warning.

---

## Carried forward

1. **B1(b) — the boot token spend** needs its own task, against
   `libs/backend/memory-curator/src/lib/triggers/memory-trigger-config.ts:53`
   (`bootScan: true`), **not** `skill-trigger.service.ts`. Correct that pointer
   before assigning it.
2. **C3's missing consequence** — an enforceable worker memory budget needs the
   worker's RSS reported over `embedder-worker-protocol.ts` (`memory-curator`).
3. **C6 (Task 4.4)** remains unstarted, per the scope change.
4. Batch 5 may open `libs/backend/skill-synthesis/` freely — nothing in it moved.
