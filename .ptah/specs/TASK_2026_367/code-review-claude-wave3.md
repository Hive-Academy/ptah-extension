# TASK_2026_367 — Claude wave 3 code review

Reviewed the two uncommitted batches on `fix/log-defects-367`:

- FIX-B10 — reconcile a real `message_start` with a synthesized start.
- B9 — move rival-CLI spawning behind the off-thread process-spawner port.

The review was limited to the files named by the request and the adjacent contracts, state implementations, registration sites, pinned SDK behavior, and tests needed to verify them. FIX-F2 under `cli-agent-runtime/src/lib/ptah-cli/**`, `cli-stderr-severity.spec.ts`, `register.ptah-cli-registry.smoke.spec.ts`, and TASK_2026_368 were ignored.

## Verdicts

| Batch   | Verdict                | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FIX-B10 | **APPROVE**            | The fix keeps the already-published synthesized message ID, folds in the real model/usage, preserves the block-index → tool-call-ID map and active-Skill state, emits no second message envelope, and clears the synthesized marker on both reconcile and stop. Root and subagent correlation regressions now cover the wave-2 F1 sequence.                                                                                                                                                                                                   |
| B9      | **APPROVE WITH FIXES** | The production path satisfies R1–R3: host-side `cross-spawn` parsing feeds a dependency-free worker, `whenSpawned` protects all four adapter tree kills, and `needsConsole` maps to `windowsHide: false`. The SDK seam remains behaviorally unchanged and all four adapters retain streamed stderr. One LOW test/contract gap remains: the new `spawnProcess` path's two fallback routes are only established by shared code, not directly asserted, and the broad “any worker failure” wording is not true for asynchronous worker failures. |

## Findings

| ID  | Severity | Batch | File:line                                                                                                                                                                                                                         | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Fix                                                                                                                                                                                                                                                                            |
| --- | -------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | **LOW**  | B9    | `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts:662-684`; `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.spec.ts:515-533`; `.ptah/specs/TASK_2026_367/implementation-plan.md:1148-1150` | `spawnProcess()` does inherit `PTAH_SDK_INLINE_SPAWN=1` and synchronous `new WorkerBackedProcess(...)` fallback through the shared `launch()` method. However, the only escape-hatch spec calls the SDK `spawn()` seam. No test pins either fallback through the new port. Also, asynchronous worker `error`/early `exit` goes through `WorkerBackedProcess.fail()` and emits an error; it does not fall back inline, so the plan's “any worker failure” sentence is broader than the implementation and the established pre-B9 behavior. | Add `spawnProcess` regressions for the environment escape hatch and a synchronous worker-construction failure. Narrow the plan/report wording to “worker construction failure,” or separately design a safe pre-child asynchronous fallback without risking a duplicate child. |

No HIGH or MEDIUM findings were identified.

## FIX-B10 coverage checklist

- [x] A synthesized start is explicitly tracked per context through `TransformerState.isMessageSynthesized`, `markMessageSynthesized`, and `clearMessageSynthesized` (`transformer-state.ts:37-50,75-80`; `sdk-message-transformer.ts:55-58,303-305,324-325,368-378`).
- [x] Reconcile strategy is consistent: the synthesized ID is retained because it has already been published; the real ID is diagnostic only. The real model is folded into the active context and usage is recorded before reconciliation (`stream-event.transformer.ts:132-155,204-255`).
- [x] Reconcile emits no second `message_start`, does not clear the context's tool-call map, and does not clear active Skill IDs (`stream-event.transformer.ts:209-217,238-255`).
- [x] The root F1 regression sends early `tool_use` → real `message_start` → `input_json_delta` → `message_stop`; it asserts exactly one start and one completion, the same message ID on start/tool-start/tool-delta/completion, and the same real tool-call ID on tool-start/tool-delta (`stream-event.synthesized-start.spec.ts:569-628`).
- [x] The equivalent subagent sequence retains the synthesized message ID, real tool-call ID, and `parentToolUseId`, while never flipping root turn state (`stream-event.synthesized-start.spec.ts:630-685`).
- [x] An early `Skill` remains active across reconciliation, and the test proves `clearActiveSkillToolUseIds` is not called (`stream-event.synthesized-start.spec.ts:687-711`).
- [x] The turn-phase regression constructs the real `SessionTurnStateRegistry`, injects it into `helpers.turnState`, and observes exactly one `generating` event and one `message_start` (`stream-event.synthesized-start.spec.ts:713-746`; `session-turn-state.registry.ts:119-137`). The implementation invokes `markGenerating` again on reconcile, but the real registry's once-per-turn guard returns `null`; the phase/revision is committed only once.
- [x] `message_stop` clears the message ID, and the real state implementation clears the synthesized marker as part of `clearMessageId`; the direct-stop regression asserts both (`stream-event.transformer.ts:306-334`; `sdk-message-transformer.ts:368-370`; `stream-event.synthesized-start.spec.ts:748-775`). Reconcile also clears the marker explicitly at `stream-event.transformer.ts:242`.
- [x] A genuinely later logical message is handled as new after the preceding `message_stop`, because that stop removes both the active ID and synthesized marker. After a successful reconcile, the marker is also cleared, so any subsequent `message_start` follows the ordinary new-message branch. A missing `message_stop` before an unrelated start is inherently ambiguous and remains the residual behavior documented by the batch report.
- [x] The four sibling transformer-spec edits add only the three required fake-state methods; they do not change inputs, expected events, or behavior assertions (`assistant-message.transformer.spec.ts:7-13`, `stream-event.transformer.spec.ts:6-12`, `system-message.transformer.spec.ts:6-12`, `user-message.transformer.spec.ts:6-12`).
- [x] The report records an instructed pre-fix experiment: disabling the reconcile condition produced 5 failed / 8 passed tests, including duplicate envelopes and cleared Skill state, after which the branch was restored. This is credible and specific, but remains a historical report claim because reproducing it would require editing reviewed code.

## B9 coverage checklist

- [x] `platform-core` owns a type-only `IProcessSpawner` port using ambient `NodeJS` types and imports nothing from `agent-sdk`, `cross-spawn`, or `node:child_process` (`process-spawner.interface.ts:1-82`). Its barrel uses `export type` (`platform-core/src/index.ts:61-67`).
- [x] R1: `crossSpawn._parse` is captured and called on the host before `launch`; the resolved command, arguments, and `windowsVerbatimArguments` enter the worker plan (`off-thread-process-spawner.ts:127-152,637-659`). The eval-created worker source requires only `node:worker_threads` and `node:child_process`; it does not require `cross-spawn` (`off-thread-process-spawner-source.ts:34-37`).
- [x] The `.cmd` regression is not mocked. On Windows `itWin` resolves to real `it`, creates a real temporary `.cmd`, launches it through `spawnProcess`, compares its stdout byte-for-byte with real inline `crossSpawn`, and separately inspects the worker message for `cmd.exe` plus `windowsVerbatimArguments: true` (`off-thread-process-spawner.spec.ts:439-511`). On this Windows host those cases are registered to run, not skip.
- [x] R2: `WorkerBackedProcess.whenSpawned` settles on `spawned`, terminal failure, and forced termination; pre-pid `kill()` is also queued (`off-thread-process-spawner.ts:286-288,328-345,361-370,410-444`). Every tree-kill in Antigravity, OpenCode, Pi, and Copilot chains from `whenSpawned` before using the PID (`antigravity-cli.adapter.ts:495-506`; `opencode-cli.adapter.ts:461-472`; `pi-cli.adapter.ts:325-335`; `copilot-sdk.adapter.ts:280-293`). A kill requested before the PID arrives is therefore not lost.
- [x] The deferred-PID adapter regression sets synchronous `pid` to `undefined`, resolves `whenSpawned` to `7777`, and verifies the tree kill uses `7777` (`antigravity-cli.adapter.spec.ts:575-598`).
- [x] R3: `needsConsole: true` maps to `windowsHide: false`; absent/false maps to `true`, and both values are asserted on the real worker message (`off-thread-process-spawner.ts:650-656`; `off-thread-process-spawner.spec.ts:409-437`). `spawnCli` forwards `needsConsole` and gates `detached` off on Windows (`cli-adapter.utils.ts:241-277`; `cli-adapter.utils.spec.ts:165-188`).
- [x] The SDK `spawn()` seam retains its command, args, cwd, filtered env, signal, non-detached launch, hidden window, callback-or-ignore stderr selection, and existing hook behavior (`off-thread-process-spawner.ts:606-627`). The worker protocol replacement is equivalent for that seam: old `wantStderr: true/false` becomes `stderrMode: callback/ignore`; callback chunks are still UTF-8 decoded in the worker, stdout pause/resume and terminal events are unchanged, and the SDK continues to consume `exit`, not the additive `close` event.
- [x] The new `spawnProcess()` seam always requests `stderrMode: 'stream'`; the worker posts raw stderr bytes and an end marker, and the host exposes them as a `Readable` (`off-thread-process-spawner.ts:383-395,637-659`; `off-thread-process-spawner-source.ts:83-100,126-145`). Antigravity, OpenCode, Pi, and Copilot still call `child.stderr?.setEncoding('utf8')` in their main run paths (`antigravity-cli.adapter.ts:490-491`; `opencode-cli.adapter.ts:456-457`; `pi-cli.adapter.ts:380-382`; `copilot-sdk.adapter.ts:346-349`).
- [x] Inline fallback logic is shared by both public seams: `PTAH_SDK_INLINE_SPAWN=1` and a synchronous `WorkerBackedProcess` construction throw call `spawnInline(plan, hooks)` (`off-thread-process-spawner.ts:662-684`). Direct `spawnProcess` assertions are missing (F1). Asynchronous worker failures still emit `error` rather than respawn, matching the existing SDK-path behavior but not the plan's literal “any worker failure” wording.
- [x] `CliDetectionService` injects the existing `SDK_TOKENS.SDK_PROCESS_SPAWNER` and passes it only to the four process-spawning rival adapters; Codex and Cursor remain untouched (`cli-detection.service.ts:35-60`). No direct `new CliDetectionService(...)` call exists. All three production composition roots register SDK services before CLI-runtime services, so the new token is available when tsyringe resolves the service.
- [x] The optional adapter constructor parameters preserve existing direct constructions. Existing adapter-spec changes add `whenSpawned`, plus necessary async expectations in Copilot; no prior behavior assertion was deleted or weakened.
- [x] The no-spawner `spawnCli` regression verifies the same `crossSpawn(binary, args, { cwd, stdio, env, detached, ...windowsHide })` path remains in use; the injected path verifies delegation and environment precedence (`cli-adapter.utils.spec.ts:119-164`).
- [x] Codex production code is untouched. Its version probe still calls `probeCliVersion(binaryPath)` without a spawner, so it remains on the existing inline `cross-spawn` path (`codex-cli.adapter.ts:444`).

## Verification

The requested command was run once:

```text
npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime @ptah-extension/platform-core
```

Nx reported `Running target test for 3 projects` and completed successfully:

| Project                             |                                Suites |                                           Tests |
| ----------------------------------- | ------------------------------------: | ----------------------------------------------: |
| `@ptah-extension/platform-core`     |                  30 passed / 30 total |                  540 passed, 4 todo / 544 total |
| `@ptah-extension/agent-sdk`         |       84 passed, 1 skipped / 85 total |             1381 passed, 2 skipped / 1383 total |
| `@ptah-extension/cli-agent-runtime` |                  45 passed / 45 total |                          550 passed / 550 total |
| **Aggregate**                       | **159 passed, 1 skipped / 160 total** | **2471 passed, 2 skipped, 4 todo / 2477 total** |

Nx explicitly reported that all three outputs came from its cache. The cached result also marked `platform-core:test` as historically flaky, but its replayed result was green. `git diff --check` was clean for the reviewed tracked files.

## Unverified

- The mandated Nx invocation reused cached results for 3/3 tasks, so this review did not independently execute a fresh child process, `.cmd` wrapper, or adapter suite. Static registration proves the `.cmd` cases are real and enabled on this Windows host; the replayed agent-sdk totals contain only the two known skipped performance tests.
- The report's pre-fix FIX-B10 failure is not independently reproducible without temporarily editing reviewed production code, which the read-only review contract forbids.
- No VS Code, Electron, headless CLI, real rival CLI, or ConPTY session was booted end to end.
- No asynchronous worker-error fault was injected. Static inspection confirms that path emits `error` and does not fall back inline (F1).
- The missing-stop ambiguity for an unrelated real `message_start` after an unreconciled synthesized start was not exercised. The transformer has no independent turn-boundary signal with which to distinguish that malformed sequence.

## Fix list by severity

- **HIGH:** None.
- **MEDIUM:** None.
- **LOW:** F1 — pin both `spawnProcess` fallback routes directly and make the worker-failure wording match the actual synchronous-construction fallback, or implement a separately safe asynchronous pre-child fallback.

REVIEW DONE — <0 high, 0 medium, 1 low>
