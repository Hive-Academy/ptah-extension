# PR 763 backend round 2

## Finding

Valid. `recordOutcome` replaces only one agent entry (`wizard-generation-checkpoint.service.ts:412-433`), while the prior lifecycle decision used the current invocation's `failedCount` (`wizard-generation-rpc.handlers.ts:896-905`). A successful one-agent retry could therefore leave another failed entry in a checkpoint finalized as completed. Run-state derives success from the manifest lifecycle (`wizard-generation-binding.ts:122-158`), and the bound completion derives its terminal status from `settled.payload.success` (`wizard-generation-run.supervisor.ts:321-345`).

## Fix

- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:908-935`: for a settled bound run, read the merged checkpoint before finalization, count failed selected agents, and retain a failed lifecycle and completion payload while any remain. Abort handling and tabless settlement retain their existing paths.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:1503-1517`: a bound retry RPC still reports success when its requested agent succeeded and finalization succeeded, even when the shared run remains failed.

## Spec and verification

- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts:319-389`: two failed agents; retry one successfully and verify checkpoint, completion event and run-state remain failed; retry the other and verify all three complete.
- Focused Jest: `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts --coverage=false --maxWorkers=1` — 1 suite passed, 98 tests passed.
- Scoped `ptah_get_diagnostics`: clean before the final retry-response edit; subsequent checks timed out without a result. Jest passed after that edit.

## Decisions

- Apply the merged-checkpoint lifecycle check only to bound runs. The existing top-level completion and run-state contracts are bound-run surfaces; tabless retries retain their previous invocation-level behavior. Reversible: yes.
- Keep item-level retry success separate from shared-run completion status. The item may succeed while another agent remains failed. Reversible: yes.

## Not done

- No Nx, build, e2e, workspace-wide, or CLI checks, per lane verification limits. Final scoped TypeScript diagnostics were unavailable due to timeout.