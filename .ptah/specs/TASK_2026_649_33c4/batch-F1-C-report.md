# F1-C builder page review fixes

## S1 — revision order
- `libs/frontend/harness-builder/src/lib/services/harness-proposal-hydration.service.ts:110`: revisions now sort ascending by `turnStartedAt ?? updatedAt`, then `updatedAt`, then their original array position. The existing user-choice precedence in `recompute` is unchanged.
- Specs: `services/harness-proposal-hydration.service.spec.ts:88,103` cover a newer unattributed revision after an older attributed revision on reload and live push, including `isConfigComplete`.

## S3 — stale intent on view destruction
- `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:451`: destroy cancels the current tab's pending intent only while its dialog is open and no view transition is running. `HarnessWorkflowRequestService` exposes no public transition flag, so the dialog guard follows the requested fallback.
- Spec: `components/harness-builder-view.component.spec.ts:428` destroys an open handoff view and checks cancellation.

## S4 — pinned-root reads and initialization
- `libs/frontend/harness-builder/src/lib/services/harness-rpc.service.ts:71,301`: optional `workspaceRoot` is sent by initialize and get-proposal; absent roots retain the previous payloads.
- `libs/frontend/harness-builder/src/lib/services/harness-proposal-hydration.service.ts:21,158,178,229,327`: binding retains the original path for initial, retry, and refresh reads; canonical root remains the validation key.
- `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:414,466`: hydration and initialization receive the tab's original pinned path.
- Specs: `services/harness-rpc.service.spec.ts:22,35`, `services/harness-proposal-hydration.service.spec.ts:113`, and `components/harness-builder-view.component.spec.ts:268` cover transport payloads and view wiring.

## M10 — original path for workspace actions
- `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:245,263,341,367,414,423,428,531,591`: the tab retains its original workspace path separately from `pinnedRoot()`; sidebar Apply, canvas adoption, state binding, display, and workspace switching receive the original path. Canonicalization remains for record keys and root comparisons. `services/harness-builder-records.service.ts:107` documents that boundary.
- `components/sidebar/builder-apply-section.component.ts:292` already sends its `workspaceRoot` input to `rpc.apply`; the corrected view input now makes it the original UNC path.
- Specs: `components/harness-builder-view.component.spec.ts:268` checks sidebar input and `components/sidebar/builder-apply-section.component.spec.ts:10` checks the Apply RPC payload for a case-sensitive UNC path.

## Decisions
| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use `updatedAt` as the fallback ordering key | Write time; place unattributed revisions after all attributed revisions | `HarnessProposalRevision.updatedAt` is present in shared types; S1 contract explicitly selects own write time | Yes |
| Keep the original tab path beside a canonical comparison key | Single canonical path; separate original path | M10 UNC case-sensitivity failure and `findTabByIdAcrossWorkspaces().workspacePath` | Yes |
| Cancel a pending intent on destroy only for an open dialog | Always cancel; open-dialog guard | Request service has private `transitioning` field; S3 explicitly permits the open-dialog fallback | Yes |

## Verification and limitations
- No Nx, Jest, TypeScript CLI, build, or e2e command was run, per lane instruction.
- `ptah_get_diagnostics` was called after edits; its scoped TypeScript compiler check timed out repeatedly and returned **unavailable**, leaving these files unchecked. The orchestrator must run the changed specs.
- `harness-builder-state.service.ts:181` has a separate existing no-argument `initialize()` for its workspace-switch reinitialization. That file is outside F1-C ownership; if that path is exercised during a pinned builder tab, it may still use the active root and needs separate ownership/review.
