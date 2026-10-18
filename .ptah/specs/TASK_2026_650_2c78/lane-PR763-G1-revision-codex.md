# PR 763 G1 revision — unbound resume selection

## Defect 1 — skip newer tab-bound checkpoints

- `libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts:484-527`: added an optional candidate predicate to the existing newest-resumable lookup. The default lookup is unchanged; filtered lookup continues past rejected newer candidates and also checks a root generation checkpoint.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-checkpoint.service.ts:207-235`: unbound-only lookup accepts only unfinished generation manifests without `tabBinding`.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:791-809`: unbound resume without `analysisDir` requests that lookup. An explicit unbound `analysisDir` pointing to a tab-bound checkpoint raises the user-facing message, “This generation run belongs to a chat tab. Resume it in that tab.” Bound resume retains the original lookup. The existing explicit checkpoint trust and binding checks remain.
- Regression specs: `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts:2410-2470` tests newer bound plus older unbound selection, untouched bound manifest, and the explicit-directory refusal/message. `libs/backend/agent-generation/src/lib/services/analysis-storage.service.spec.ts:626-670` tests predicate traversal over stored runs. The earlier bound-only and unbound-only tests remain.

## Defect 2 — legacy cancel

- Kept the approved prior fix unchanged at `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:1297-1300` and its existing regression spec around `wizard-generation-rpc.handlers.spec.ts:800`. No CLI files were edited.

## Verification

- Prettier ran on all five changed source/spec files.
- Focused Jest: RPC handlers spec passed, 102/102 tests; storage spec passed, 43/43 tests. After tightening the unfinished-generation predicate, the focused older-unbound resume case passed (1 test, 101 skipped). Jest printed a non-failing ESM config warning.
- `ptah_get_diagnostics` on the five files returned clean, zero errors before the final comment/predicate edit. After that edit, two scoped attempts timed out at 45 seconds and returned unchecked, so final diagnostics are unavailable.

## Decisions

- Extend the existing storage lookup with an optional predicate rather than add another run enumerator. Options: change the storage lookup, or duplicate its private valid-run traversal in RPC handlers. Evidence: `findLatestResumableRun` owns timestamp ordering and root-checkpoint fallback; its original call sites still pass only the workspace. Reversible: remove the optional argument and call-site filter.
- Reject explicit unbound access to a tab-bound checkpoint with `RpcUserError('INVALID_PARAMS')`. Options: return the generic no-run response, or give a distinct error. The explicit request identifies a real checkpoint whose binding cannot be adopted by the legacy wizard or CLI. Reversible: change the error response without touching persisted data.

## Not done

- Final scoped diagnostics did not complete; the service reported its compiler check still running after 45 seconds. No Nx, build, e2e, package, or git command was run.