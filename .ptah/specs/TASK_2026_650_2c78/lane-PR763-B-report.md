# PR 763 lane B report

## Finding 4308395724 — valid

Evidence: `generation-agent-sidebar.component.ts:42-50` called `AgentGenerationStore.resume()` while `generation-workflow.store.ts:163-180` only supported resuming an already loaded interrupted run. `agent-generation.store.ts:79-84` calls unbound `resumeGeneration()`.

Fix: `generation-agent-sidebar.component.ts:50` calls `GenerationWorkflowStore.resumeCheckpoint()`; `generation-workflow.store.ts:170-193` submits the saved checkpoint with the active tab binding and handles acceptance, rejection, and failure. The legacy `AgentGenerationStore.resume()` remains for the old wizard.

Spec: `generation-agent-sidebar.component.spec.ts:10` verifies the button routes to the bound store, not legacy resume; `generation-workflow.store.spec.ts:254` verifies the binding and accepted run. Focused Jest: passed.

## Finding 4308395726 — valid

Evidence: `generation-workflow.store.ts:104-105` and old resume start had no rejection reset; `submitGuidance` already reset it, while `accept` did not.

Fix: `generation-workflow.store.ts:105,186,242` clears stale rejection at agent start, resume start, and acceptance.

Spec: `generation-workflow.store.spec.ts:283` covers rejection followed by a successful start and acceptance. Focused Jest: passed.

## Finding 4308395734 — valid

Evidence: `generation-workflow.store.ts:243-258` previously left a runless start in `quiet` after three failed lookups; `isBound()` includes `quiet` at line 52. Start paths called `refresh()` for explicit failures.

Fix: `generation-workflow.store.ts:115,157,193` handles explicit unsuccessful responses immediately; `:206-219` resets the store with a safe user-facing error, preserving a prior model error; `:276-283` releases a runless tab after lookup exhaustion. Accepted runs retain their lookup watchdog.

Spec: `generation-workflow.store.spec.ts:309` covers explicit failure for agent, guidance, and checkpoint resume; `:335` covers unconfirmed start and exhausted lookups. Focused Jest: passed.

## Verification

`npx jest -c libs/frontend/setup-wizard/jest.config.ts libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.spec.ts libs/frontend/setup-wizard/src/lib/components/generation-agent-sidebar.component.spec.ts --coverage=false --maxWorkers=1`: 2 suites, 21 tests passed (final run).

Scoped `ptah_get_diagnostics` was attempted twice after edits; TypeScript checking stayed unavailable after the tool's 45-second limit. No Nx targets or other suites were run under the lane's verification rule.

## Decisions

- Keep `AgentGenerationStore.resume()` unchanged because the old wizard still uses its unbound flow. The tab sidebar uses the new bound entry point. Reversible.
- Show only two confirmed safe backend error strings verbatim; use a generic message for other response text. Evidence: `rpc-setup.types.ts:343-349` permits arbitrary `error`, while `wizard-generation-rpc.handlers.ts:320,400` contains the two user-facing strings. Reversible.
- Keep the lookup watchdog for responses without a definite outcome, since a run may have started despite a lost response. Release only when lookups are exhausted and no run was accepted. Reversible.

## Not done

No broader setup-wizard suite or Nx checks were run because this lane permits only focused Jest for changed specs; the orchestrator owns those checks.