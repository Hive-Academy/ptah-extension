# PR 763 lane A report

## Finding 4308395701
- Valid: `enhanced-prompts.service.ts:778` released the lock for bound runs, clearing the reservation at `:361`; `regenerate` then awaits `getStatus` at `:837`, while the supervisor finishes and broadcasts later at `enhanced-prompts-rpc.handlers.ts:802-826`.
- Fix: `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:778-779` leaves bound release to the supervisor. Unbound release remains in `runWizard`.
- Specs: `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.spec.ts:598` checks the reservation remains held after the run and is released by its caller; two cancellation specs now release their reservations. `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.spec.ts:1013` checks a second tab is blocked during deferred status completion and the first run settles and broadcasts.
- Focused Jest: agent-generation spec 66 passed; guidance RPC spec 37 passed.

## Finding 4308395717
- Valid: `orchestrator.service.ts:500-506` reports `completed` when any agent succeeded; `wizard-generation-run.supervisor.ts:168-173` reports completion `success: false` when any failed; `wizard-generation-rpc.handlers.ts:896-907` persisted the summary lifecycle; `wizard-generation-binding.ts:122-158` mapped that checkpoint to `completed` and `success: true`.
- Fix: `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:896-905` persists `failed` for bound runs with a completed summary and failed outcomes.
- Spec: `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts:292` verifies mixed outcomes produce failed checkpoint, failed completion, and failed run-state RPC; the existing tabless partial-success spec at `:1861` still passes.
- Focused Jest: wizard RPC spec 97 passed.

## Decisions
- **Bound checkpoint mapping, not orchestrator lifecycle.** Options: mark every partial result failed in the orchestrator; or map the bound checkpoint only. Evidence: the legacy completion screen uses the completion payload (`wizard-phase-generation.ts:88-92`), the CLI uses completion `success` (`apps/ptah-cli/src/cli/commands/setup.ts:246`, `wizard.ts:247`), and the tabless checkpoint's existing partial lifecycle is asserted by `wizard-generation-rpc.handlers.spec.ts:1876`. The bound mapping is additive and reversible.
- **Bound reservation owned by supervisor.** Options: release inside `runWizard` or after terminal delivery. The supervisor already releases in its `finally` at `enhanced-prompts-rpc.handlers.ts:825-826`; timeout grace also force releases at `enhanced-prompts.service.ts:334-345`. This is reversible.

## Not done
- Scoped `ptah_get_diagnostics` returned unavailable after 45 seconds on both attempts. No Nx, build, or workspace-wide check was run. Jest used `--forceExit` because the first run held an open handle after completion.
