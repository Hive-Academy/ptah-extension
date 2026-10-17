# Phase 2 revision round 1, Part A

## Fixes

1. **S1:** The service invokes an owner-scoped force-release callback after the 30-second grace period (`enhanced-prompts.service.ts:333-347`). The handler settles the exact bound run as timed-out, emits one terminal push, and ignores a later result (`enhanced-prompts-rpc.handlers.ts:774-819`; `guidance-generation-run.supervisor.ts:110-116`). Specs: `force releases once and a late return cannot overwrite the settled run`; `force release emits one terminal event and preserves the old run`; service bound timeout callback spec.
2. **M1:** A successful `beforeCommit` marks the lock as committing; timer abort is skipped, and no abort checks interrupt trace, state save, or cache set (`enhanced-prompts.service.ts:330-333,706-738`). Spec: `allows a committing run through the timer and past the designer timeout`.
3. **M2:** Both returned and thrown execution paths use the terminal broadcaster, conditioned on a successful settlement (`enhanced-prompts-rpc.handlers.ts:798-851`). Spec: `broadcasts a failed terminal event when bound execution throws`.
4. **Cancel boundary:** Timeout leaves an already aborted user-cancelled controller alone (`guidance-generation-run.supervisor.ts:102-107`). Spec: `keeps a user cancellation when the lock timer fires later`.
5. **M6:** Start stores the authorized canonical host path; cancel and lookup canonicalize the client path after authorization (`enhanced-prompts-rpc.handlers.ts:589-606,863-905`). Spec: `uses the authorized canonical path for cancel and lookup`.
6. **M7:** Catalog mode uses `safeParse` and `RpcUserError` with `INVALID_PARAMS`; only catalog criteria now identify the workspace catalog (`setup-rpc.handlers.ts:519-524,682-684`). Specs: `returns INVALID_PARAMS for a malformed catalog request`; `returns the static catalog for an explicit unbound request`; `short-circuits to the full agent catalog on isMultiPhase input`.
7. **M9:** The lock timeout is designer timeout plus two minutes, currently 12 minutes, while preserving the 30-second grace (`enhanced-prompts.service.ts:228-233`). Spec: `allows a committing run through the timer and past the designer timeout`; existing tabless and bound lock timeout specs now use 12 minutes.
8. **Minor:** Pre-commit non-success results are `unchanged`, post-commit non-success results remain `unknown`; same-tab wrong run ID returns `not-running`; duplicate start during `cancelling` returns `blocked` with owner tab ID because accepted status is restricted to `starting` (`guidance-generation-run.supervisor.ts:81-85,128-135`; `enhanced-prompts-rpc.handlers.ts:610-619`). Specs: `cancels only the exact binding and records unchanged before commit`; `reports an unknown failed outcome after commit begins`; `keeps a user cancellation when the lock timer fires later`.

## Checks

- Focused agent-generation Jest: 1 suite, 65 tests passed.
- Focused rpc-handlers Jest: 3 suites, 96 tests passed. An initial regression test failed because it allowed the newer run to settle before inspecting the prior record; corrected and rerun green.
- Nx typecheck and lint: successfully ran both targets for both changed projects.
- Prettier applied to all eight changed source/spec files.
- `ptah_get_diagnostics` initially timed out; a final scoped check of the last edited service file found 0 errors and 0 warnings. The scoped Nx typecheck completed successfully.

## Final source line counts

- `enhanced-prompts.service.ts`: 1,484 lines.
- `guidance-generation-run.supervisor.ts`: 203 lines.
- `enhanced-prompts-rpc.handlers.ts`: 1,178 lines.
- `setup-rpc.handlers.ts`: 1,425 lines.

## Decisions

- **Duplicate start while cancelling:** Return `blocked` with the same-tab owner ID. Options: return the real `cancelling` status or reject the duplicate. Evidence: accepted response type permits only `starting`, and the current run is still owned by that tab. Reversible: yes.
- **Force-release committed state:** Use `unknown` even if `beforeCommit` was not reached. Options: `unchanged` or `unknown`. Evidence: requested S1 force-release contract requires `unknown` because execution may still be pending. Reversible: yes.

## Proposed Removals

None.

