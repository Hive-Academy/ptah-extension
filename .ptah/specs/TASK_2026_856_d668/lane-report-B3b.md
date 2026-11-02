# Lane B3b report

## Files changed

- `libs/shared/src/lib/types/rpc/rpc-setup.types.ts`: added optional `regenerationStartedAt?: string | null` to the status response.
- `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts`: tracks unbound regenerations by resolved workspace path; status and regenerate reconcile entries against the service lock and exported run ceiling; token-aware cleanup protects a newer run from late completion.
- `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.spec.ts`: added eight specs covering Component 3 cases 1–7, including both success and throw cleanup and a never-settling run past the ceiling.
- `.ptah/specs/TASK_2026_856_d668/lane-report-B3b.md`: this report.

## Test result

- Requested `npm run verify -- -t test -p @ptah-extension/rpc-handlers -- --testPathPatterns="enhanced-prompts-rpc"`: **failed initially** on TS2540 because the new test mock treated the service getter as writable. The mock type was corrected.
- Focused rerun: `npm exec -- jest --config libs/backend/rpc-handlers/jest.config.ts --testPathPatterns=enhanced-prompts-rpc --coverage=false --maxWorkers=2`: **2 suites passed, 47 tests passed**.
- `git diff --check` on the three scoped code files: **passed**.
- Scoped `ptah_get_diagnostics`: unavailable after two 45-second waits; no diagnostic result was returned.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the status field optional and return ISO or `null` on successful reads | Required field; optional field | Component 3 contract and older-client compatibility requirement | Yes |
| Reconcile lazily using the service lock and `ENHANCED_PROMPTS_RUN_CEILING_MS` | Timer; promise settlement alone; lazy reconciliation | Plan lines 297–302 and validation note R-F: force-release does not settle the promise | Yes |
| Delete in `finally` only when the stored token belongs to the completing call | Unconditional deletion; token check | Plan late-completion case 5; passing regression spec | Yes |
| Represent the getter as mutable only on the test mock | Assign to read-only service type; mutable mock field | Initial TS2540 failure and passing focused rerun | Yes |

## Not done

- The broader shared/host typecheck from the plan was not run: this lane's instructions restrict verification to the focused rpc-handlers test and prohibit project-wide checks while other lanes edit the worktree.
- No DI guard or RPC surface changes were required: this adds a response field and handler state without registering a service or method.
- Skill discovery was available, but returned no locally invocable matching skill. Repository guidance was applied directly.
- Concurrent changes under `libs/frontend/chat` and `libs/frontend/chat-ui` were made by other lanes; they were not touched here.

## Round 2

### Files changed

- `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts`: `liveEntry` now preserves an entry while the service lock is false, returns `null` for that read, and deletes the entry only at the run ceiling. The owning regenerate call still removes its own entry in `finally` by token.
- `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.spec.ts`: added a forced-regeneration test with a pending pre-lock invalidation await. It checks that status is `null` before lock acquisition and returns the original ISO start afterward.
- `.ptah/specs/TASK_2026_856_d668/lane-report-B3b.md`: appended this section. The shared RPC contract was not changed in Round 2.

### Test result

- Requested pipeline with `tail -n 60` could not run because `tail` is unavailable in PowerShell.
- Same focused verify command with `Select-Object -Last 60` and npm's exit code preserved: **NX 1 task succeeded; exit code 0** (`@ptah-extension/rpc-handlers:test`, 1m 7s). This includes the existing Component 3 cases and the new pre-lock regression case.

### Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Retain an entry while the lock is false, but report `null` until it is held | Delete on false lock; retain through pre-lock await | Forced regeneration awaits invalidation before taking the lock; the new regression passes | Yes |
| Continue deleting at the ceiling and in the owning call's `finally` | Preserve indefinitely; token-aware cleanup | Existing never-settling, replacement-run, and late-completion cases pass in the focused verify task | Yes |

### Not done

- No files outside the two scoped code files and this report were edited in Round 2. No broader checks were run under the lane's verification limits.
- No locally invocable matching skill mechanism was exposed in this lane; repository guidance was followed directly.
