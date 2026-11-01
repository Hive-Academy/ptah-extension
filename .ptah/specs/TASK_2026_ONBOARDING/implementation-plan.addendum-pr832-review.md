# PR #832 addendum review

## Verdict

APPROVED — no blocking compile, flow, deletion, or capability-mapping defect was found in the addendum against `refs/remotes/pr/832` (`65499f2c`); PR-R1 remains a user decision, not an approved removal.

## Blocking defects

None.

## Non-blocking suggestions

1. Make the error-path tests explicitly conditional on PR-R1. The unconditional assertion at `implementation-plan.addendum-pr832.md:181-183` that bound confirmation never returns undefined decisions applies to the recommended retry branch, but not the alternative retained fallback at lines 141-143 and 399. At the PR head, `libs/frontend/setup-wizard/src/lib/services/generation-preview.store.ts:93-100` deliberately returns undefined decisions when no target was explicitly chosen. Test both decision outcomes separately, including a missing record, a matching earlier record, and changed targets.
2. If the user retains PR-R1, explicitly specify the error-state button label on the reused dialog. The old modal labels it “Generate without preview” (`libs/frontend/setup-wizard/src/lib/components/generation-preview-modal.component.ts:320-323`), while the reused dialog always uses the normal confirmation label (`libs/frontend/setup-wizard/src/lib/components/agent-preview-dialog.component.ts:344-347`). The addendum defines the alternative action, but not this copy adjustment. If removal is approved, consider retry-specific error copy instead.
3. Expand the B3a verification-matrix “Changed projects” description in the base plan: setup-wizard changes now include the preview store and RPC service, not merely its barrel. The project list and verification commands already cover these files; no additional target is needed.

## Decisions

- **Completeness:** compared the scoped diff/stat and added-file list with P1-P29. The exact requested paths produce 57 changed files; the addendum's broader scope also includes `rpc.types.ts` and backend context. There are 31 added setup-wizard files, with 29 retained and the modal plus its spec deleted. No uncovered user-visible capability or consumed contract was identified: decisions, target/model/provenance display, preview recovery, pack planning/install/results, completion outcomes and Library copy, safe failures, widened statuses, and resume behavior all have fates. The shared index's new `library-provenance` export is explicitly addressed as outside the consumed setup flow in the inventory, rather than silently omitted.
- **Import staging:** `libs/frontend/setup-wizard/src/index.ts` is unchanged in PR #832. Existing exports at lines 17, 18, and 22 cover the pack panel, preview dialog, and next-steps component. The addendum stages `safeFailureCopy` in B2, the preview store and decision types in B3a, and completion components/helper/row type in B3b. These precede or coincide with their first consumers. Internal decision components remain reachable through their retained setup-wizard parents; onboarding needs no cross-library relative import.
- **Deletion dependencies:** the dialog imports retained `preview-decisions/*` components and helpers (`agent-preview-dialog.component.ts:20-31`). Their diff disclosure injects the core theme service, not a deleted wizard store. The pack panel retains its state/RPC/install-store dependencies (`community-packs-panel.component.ts:203-216`), and the install store retains `WizardRpcService` (`pack-install.store.ts:70`). Neither store is in the deletion ledger. The preview store depends on the retained dialog types, decision helpers, and RPC service (`generation-preview.store.ts:7-21`). `git grep` confirms that `AgentSelectionComponent` is the modal's only production consumer; deleting that owner makes the modal and its spec orphaned. Keeping completion result state and message handling avoids deleting a retained dependency.
- **Contract spot checks:** the following cited locations were checked at the PR head and agree with the addendum (paths abbreviated as in the addendum):

  | Addendum line | Checked source | Result |
  | --- | --- | --- |
  | 57 | `S/rpc/rpc-setup.types.ts:86-119` | Widened outcomes, optional kept/changed counts, target, Library pass and divergence |
  | 60 | `S/rpc/rpc-setup.types.ts:338-342` | Optional token, file decisions and target |
  | 61 | `S/rpc/rpc-setup.types.ts:352` | Pending/running plus `FileOutcome` |
  | 62 | `S/rpc/rpc-setup.types.ts:392` | Optional preview target |
  | 63 | `S/rpc/rpc-setup.types.ts:419-456` | File revision/local state, agent metadata and response additions |
  | 66 | `S/rpc/rpc-setup.types.ts:701-717` | Pack decisions/target and per-file/Library results |
  | 67 | `S/rpc/rpc-setup-decisions.types.ts:89-105` | Five file outcomes and Library-pass union |
  | 71 | `S/wizard/phase.ts:203-239` | `FileOutcome` and both optional completion counters |
  | 75 | `W/services/wizard-rpc.service.ts:55-58`, `:253-270` | Decision type and existing two-argument preview API |
  | 79 | `W/services/generation-workflow.store.ts:104-143` | Optional decisions forwarded by `startAgents` |
  | 399 | `W/components/generation-preview-modal.component.ts:322` | “Generate without preview” label exists |

- **Batches and verification:** the B2/B3a/B3b/B5b file deltas, export schedule, and shared-file ownership agree with the base plan's serial order. New specs belong to already-listed projects. No new shared-contract or backend edits are required by this delta. The base plan's broader host coverage remains intact. The unchanged guidance supervisor, guidance store, and handoff store support keeping D9 unchanged.
- **PR-R1:** correctly classified as a proposed removal. Approval means retrying the comparison in the bound owner and removing the legacy fallback. Retention means a tokenless, no-Replace submit followed by preview reopening on `preview-required`. This is intentionally conditional preservation: `B/wizard-generation/generation-preview.service.ts:364-365` refuses a missing tab preview; lines 368-381 also require matching current targets; lines 383-390 allow create-only guards without a valid token when those checks pass. An earlier successful preview alone is not a guarantee. The addendum's user-facing choice discloses the restriction. Do not infer removal approval from this review or implement the unresolved branch before the user's decision.
- **Method and limits:** read-only source/document review; only this deliverable was written. Historical code was inspected with the requested `git show`, `git diff`, and `git grep` commands, rather than a workspace index that could describe a different revision. Ptah tools were discovered. No CLI skill-discovery mechanism was exposed, so no matching skill could be loaded. No tests, builds, verification/Nx targets, runtime rendering, commits, pushes, or git mutations were performed. Compilation and runtime behavior were assessed statically, not executed; future changes to the draft PR require the addendum's rebase audit.
