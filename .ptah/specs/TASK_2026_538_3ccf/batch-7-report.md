# Batch 7 implementation report - TASK_2026_538

## Task evidence

- **7.1 implemented:** `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\lib\types\messages\message-constants.ts:166-176`. The v1 comment states that the message is no longer posted to webviews since TASK_2026_538, that v1 proposals arrive as `surface:updated`, and that the constant remains the namespace-to-publisher hand-off type. Adjacent `SURFACE_UPDATED` is the one push for surface changes, including v1 proposals.
- **7.2 implemented:** `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\lib\types\messages\payload-map.ts:130,248-264,386`. Added the relative `import type` from the plain `surface.types.ts` module, the seven-field readonly `SurfaceUpdatedPayload` interface with per-field documentation, and its message map entry. The routing comment preserves v1 sessionId semantics; revision gaps require `surface:read`. No Zod schema import was added.
- **7.2 barrel evidence (unchanged):** `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\index.ts:10` exports `./lib/types/messages`; `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\lib\types\messages\index.ts:10` exports `./payload-map`. This exposes the new interface through exactly the same chain as `DashboardSpecProposedPayload`, without editing either barrel.
- **7.3 implemented:** `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-core\src\messaging\rpc-handler.ts:90`. Added only the `surface:` allowed prefix with the requested TASK_2026_538 surface state RPC comment.

## Risk R1 and scope

No `RpcMethodRegistry` or `RPC_METHOD_ENTRIES` additions. Read-only inspection found no `surface:` occurrence in `libs/shared/src/lib/types/rpc.types.ts`, and `libs/shared/src/lib/types/rpc/rpc-surface.types.ts` does not exist. Registry entries, RPC types, handlers and manifest wiring remain Batch 11 work.

Only the three assigned production files and this report were written. No frontend files, existing specs, task states or batches.md were edited. No git commands were run.

## Stack and conventions observed

The root manifest specifies Node 24.x; package-lock.json records TypeScript 6.0.3, Nx 23.2.1, Jest 30.5.2 and tsyringe 4.10.0. This batch uses shared plain TypeScript contracts and the existing tsyringe-injected RPC handler, not a NestJS server. `rpc-handler.ts` supplies the existing prefix validation, Map-based routing and logging conventions. The two project.json files declare the requested typecheck, test and lint targets. CONVENTIONS.md section 8 and eslint.config.mjs define the shared/backend boundaries; the added import stays within shared. The sibling DashboardSpecProposedPayload, HarnessConfigProposedPayload and FileContentChangedPayload establish the interface and documentation patterns.

## Verification

- Scoped `ptah_get_diagnostics` on the three changed source files: TypeScript compiler source, 0 errors and 0 warnings.
- Requested command, invoked once: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/vscode-core 2>&1 | Select-String -Pattern 'Tests:|Suites:|FAIL|error|Successfully' | Select-Object -Last 20`. Output additionally escapes U+2028/U+2029; the shell preserves the Nx exit code.
- Nx verification completed with **exit code 1**. The returned summary identifies `libs/backend/vscode-core/src/services/git-info.service.review.spec.ts` as the failing suite: **1 failed / 38 passed suites; 1 failed / 662 passed tests; 663 total tests**. Nx reported that the requested targets for the two projects failed overall.
- The output also warned that vscode-core's jest.config.ts could not load as an ES module, and that a worker failed to exit gracefully and was force exited. These are observed warnings, not an established cause of the failing assertion.
- The requested summary filter did not retain the failing assertion or individual successful target results. No suite was rerun to recover details. The worktree has no `.nx/cache` directory from which to recover those logs. Nx supplied the run log: https://nx.app/runs/GCppWRY5pp . The individual zod-free guard result is therefore not independently confirmed by the retained output; its source and dependencies remain unedited.

## Deviations and observations

No implementation deviations. The barrel requirement is satisfied through existing exports. No existing spec was changed. `ptah_search_files` returned no instruction files; native filesystem reads were used as fallback. The zod-free guard remains unedited.

## Clarifications Needed

Verification acceptance is blocked by the existing `git-info.service.review.spec.ts` failure, which is outside this batch's edit scope. No change to that spec or its production service was attempted, and the cause is not established by the filtered output.

Which follow-up should the invoking workflow own?

1. **Investigate the existing git-info test failure separately (Recommended)**, using the recorded Nx run and retaining Batch 7's current file boundaries.
2. Assign expanded ownership for a failure investigation before accepting Batch 7.

The three requested source changes are implemented, but this batch is **not reported as verification-complete**.
