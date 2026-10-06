# Root Cause — TASK_2026_621_3d5c

## Verdict

**INFERRED (high confidence):** Electron's 2026-09-24 boot change `5cf965d57` made the heavy boot wait for `registerCodeExecutionMcpForSubagents()`.  That operation performs sequential installed-CLI detection.  The heavy boot is the only production caller of `bootThothRuntime()`, which is in turn the code that starts `MemoryTriggerService`; while the CLI probe was pending, extraction could not start.  Commit `1095a8f20` (2026-10-01 18:28 +03:00) stopped awaiting that same registration, and the preserved database shows extraction resuming on 2026-10-02.

This is a startup/liveness failure in the Electron host, not evidence that the curator's network admission or retention guard intentionally stopped passes.  It affected the only host that actually starts the curator: VS Code and the CLI do not call `bootThothRuntime()` in production.

## Timeline

| Time | VERIFIED event | Consequence |
| --- | --- | --- |
| 2026-09-24 16:57 +03:00 | `5cf965d57` moves subagent MCP registration to `postWindow` *ahead of* the heavy boot and awaits it. The diff comments identify sequential CLI probes and a 4–12 s / potentially >30 s wait. | The path to Thoth, hence the trigger service, is held behind CLI detection. |
| 2026-09-24 through 2026-10-01 | Snapshot query: every `observation_queue` row dated in this interval has `processed_at IS NULL`; no `memories` row has a `created_at` date in the interval. | No extraction completed during the reported gap. |
| 2026-10-01 18:28 +03:00 | `1095a8f20 fix(electron): stop the cli probe from holding the boot screen` changes the registration from awaited to fire-and-forget, then opens the heavy-boot gate. | Removes the identified dependency. |
| 2026-10-02 | Snapshot query: 4,882 of 20,091 observations are processed and 98 memories are created. | Extraction becomes live again immediately after the fix is available. |

## Evidence

### VERIFIED

- Only Electron production code calls `bootThothRuntime()`: [apps/ptah-electron/src/activation/boot-heavy-services.ts:164](D:/projects/ptah-extension/apps/ptah-electron/src/activation/boot-heavy-services.ts:164). The repository-wide production search found no VS Code or CLI caller. Electron registers curator services in [phase-2-libraries.ts:391](D:/projects/ptah-extension/apps/ptah-electron/src/di/phase-2-libraries.ts:391).
- `bootThothRuntime()` only resolves/starts the trigger after its curator has started: [boot-thoth-runtime.ts:275](D:/projects/ptah-extension/libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:275)-[288](D:/projects/ptah-extension/libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:288). `MemoryTriggerService.start()` is where subscriptions and the boot scan are armed: [memory-trigger.service.ts:172](D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:172)-[221](D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:221).
- `5cf965d57` (2026-09-24) replaced `bringUpSubsystems()` with a split start/registration. Its diff adds an awaited `registerCodeExecutionMcpForSubagents()` before `booter.openWindowGate()` / `startOrJoin()`. The commit's source comment says registration probes installed CLIs sequentially and is ahead of heavy boot. Source: `git show 5cf965d57 -- apps/ptah-electron/src/activation/wire-runtime.ts`.
- `1095a8f20` (2026-10-01) changes that exact awaited call to `void registerCodeExecutionMcpForSubagents(...)`, before opening the heavy-boot gate. Its current implementation and explanation are [wire-runtime.ts:514](D:/projects/ptah-extension/apps/ptah-electron/src/activation/wire-runtime.ts:514)-[526](D:/projects/ptah-extension/apps/ptah-electron/src/activation/wire-runtime.ts:526); source: `git show 1095a8f20 -- apps/ptah-electron/src/activation/wire-runtime.ts`.
- Read-only copy of `~/.ptah/bench-snapshots/ptah-20261006-pre-retention.sqlite` (hash recorded in [context.md:19](D:/projects/ptah-extension/.ptah/specs/TASK_2026_621_3d5c/context.md:19)) was queried and deleted afterward. Results: 1,809/1,809 unprocessed on 09-24; 3,570/3,570 on 09-28; 5,048/5,048 on 09-29; 9,586/9,586 on 09-30; 14,156/14,156 on 10-01; 4,882/20,091 processed on 10-02. `memories` has rows on 09-22 and 09-23, none 09-24..10-01, then 98 on 10-02.
- No target log file was present under `%APPDATA%\\Code\\logs`, `%APPDATA%\\ptah`, `%LOCALAPPDATA%\\ptah`, or `~/.ptah/logs` for the requested date range; consequently there are no curator/extraction log lines to corroborate the sequence.
- Admission cannot by itself establish a nine-day stop from this evidence: a clear/no governor proceeds synchronously, while a network back-off is only recorded after `stalled/provider-unreachable` ([curator-pass-admission.ts:96](D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/curator-llm/curator-pass-admission.ts:96)-[104](D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/curator-llm/curator-pass-admission.ts:104), [172](D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/curator-llm/curator-pass-admission.ts:172)-[185](D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/curator-llm/curator-pass-admission.ts:185)).
- The boot scan does not silently advance a watermark past a stalled item: it stops early ([boot-scan-runner.ts:185](D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/triggers/boot-scan-runner.ts:185)-[196](D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/triggers/boot-scan-runner.ts:196)).

### INFERRED

- The device's Electron boot was delayed or repeatedly interrupted in the awaited CLI-registration stage during the interval. The code/history/database timing supports this as the most likely causal chain, but no surviving host log proves a particular probe duration or an individual boot's terminal state.

## Smallest fix

Keep the `1095a8f20` ordering: start `registerCodeExecutionMcpForSubagents()` without awaiting it, then immediately open the window gate and run `booter.startOrJoin()` ([wire-runtime.ts:523](D:/projects/ptah-extension/apps/ptah-electron/src/activation/wire-runtime.ts:523)-[526](D:/projects/ptah-extension/apps/ptah-electron/src/activation/wire-runtime.ts:526)). Add one focused regression test that makes subagent registration remain pending and asserts `bootThothRuntime` / `MemoryTriggerService.start()` still runs.  This directly preserves curator liveness without weakening curator admission or changing retention.

## Not proven

- Which executable probe(s) blocked on this machine, how long each waited, and whether the app was killed before the wait finished.
- Whether any affected session would additionally have been rejected by the memory-enabled setting, rate limit, governor, provider back-off, or transcript failure after the trigger started.
- A per-pass curator activity record for the gap: this snapshot has no persisted curator activity/pass-log table, and the requested log roots contained no matching dated log lines.
- The commit proves the blocking dependency and the recovery proves temporal correlation; it does not constitute an instrumented reproduction of the original Electron process.
