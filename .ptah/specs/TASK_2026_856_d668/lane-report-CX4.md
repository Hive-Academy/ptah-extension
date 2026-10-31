# CX4 lane report

Status: implemented and focused tests passed.

## Files changed

- `libs/frontend/chat/src/lib/services/chat-store/session-live-stats.util.ts`: replaced the local context capacity trust check and percent formula with shared helpers; routed the valid numerator through `contextFillTokens`.
- `libs/frontend/chat/src/lib/services/chat-store/session-live-stats.util.spec.ts`: pinned F2, F3, and F4 values.
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`: captured the prior live reading before resume stats replace it; reused a trusted same-model window on snapshot and compact-boundary/no-snapshot resumes. Preserved the compaction seed branch.
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`: covered F10's three cases, F12's four cases, and normalized model aliases on both branches.
- `.ptah/specs/TASK_2026_856_d668/lane-report-CX4.md`: this report.

## NUL byte counts

Before: **1** (`grep -c -aP '\x00'`, using Git for Windows `grep.exe` because PowerShell did not expose `grep`). After all edits: **1** with the same command.

## Verification

`npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="session-live-stats.util|session-loader" | tail -n 60`: **passed**, Nx reported `1 task: 1 succeeded`, exit code 0. This pattern includes the unchanged `session-loader.resync-live-seed.spec.ts`. The successful run preceded a final guard tightening that requires a trusted prior capacity on the snapshot branch; that final change was not retested under the run-once lane instruction.

`git diff --check` on the four scoped source/spec files: clean. Scoped Ptah TypeScript diagnostics were attempted twice; both returned unavailable after the 45-second timeout, so strict compiler diagnostics are unverified.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Reuse the prior capacity only when both model keys normalize equally and the shared helper trusts its window. | Reuse raw model equality; infer a window from the model name; use normalized equality with trusted evidence. | Plan C1/F10/F12 and `liveContextStats` use normalized equality; `trustedContextWindow` rejects unverified routes. | Yes, localized to `applyResumeStats`. |
| Keep the existing zero-valued unknown payload when no trusted prior reading is available. | Create a synthetic percent; retain the existing placeholder. | F6 and the current resume payload shape require an unknown window to remain 0 internally for views to gate as `—`. | Yes. |
| Preserve compaction seed precedence. | Let the resume snapshot overwrite it; return with the seed first. | Existing resync guard and the requested unchanged compaction-seed behavior. | Yes. |

## Anything not done

Electron renderer reload/reopen visual checks were not run: this lane was barred from build/serve/dev/e2e targets and had no running renderer. The scoped TypeScript diagnostics service did not finish. Concurrent changes outside this lane's four scoped source/spec files were present in `libs/backend/rpc-handlers`, `libs/frontend/chat-ui`, and `libs/shared`; I did not edit or revert them.
