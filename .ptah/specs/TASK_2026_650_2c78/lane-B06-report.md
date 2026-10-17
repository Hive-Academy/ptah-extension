# B06 report

Status: Complete.

## Part 1

- `libs/backend/agent-generation/src/lib/services/setup-wizard.service.ts` (203 lines): legacy panel accepts the typed generation request, focuses chat, sends to `ptah.main`, retains its panel after delivery, and keeps explicit Close. Evidence: lines 96-115, 138-175. Specs: `hands a typed generation request to main and keeps the legacy panel open`; `keeps the landing available for retry when main is live but unbootstrapped`.
- `libs/backend/agent-generation/src/lib/services/setup-wizard.service.spec.ts` (419 lines): host handoff, retry and Close coverage, lines 238-300.
- `apps/ptah-electron/src/services/electron-setup-wizard.service.ts` (166 lines): landing still uses `SWITCH_VIEW`; generation sends `SWITCH_VIEW` to main then `SETUP_GENERATION_OPEN`, lines 63-113.
- `apps/ptah-electron/src/services/electron-setup-wizard.service.spec.ts` (48 lines): landing, main push and failure coverage, lines 6-48.
- `apps/ptah-extension-vscode/src/commands/setup-agents-command.ts` (93 lines): default command opens landing; explicit workflow routes to handoff, lines 34-65.
- `apps/ptah-extension-vscode/src/commands/setup-agents-command.spec.ts` (41 lines): default and explicit action, lines 12-41.

No backend generation starts on tab open: host code only sends the shared open payload; the B05 consumer invokes `GenerationWorkflowLauncherService.open`. `source.analysisDir` is absent from the payload. Tabless Settings and CLI paths are untouched.

## Part 2

- `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts` (1487 lines): commit state is per run and timeout ownership is keyed to that run, lines 249, 330, 517, 713-740.
- `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.spec.ts` (2233 lines): `checks a force-released stale run abort while a new run is committing`, line 1671.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts` (1793 lines): bound retry lookup receives canonical workspace, line 1316.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts` (2821 lines): alternate host spelling bound retry and invalid timestamp, lines 498 and 672.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-binding.ts` (321 lines): invalid `updatedAt` is stale for an orphaned running checkpoint, line 54.

## Checks

Focused Jest: agent-generation 66+17 passed; rpc-handlers 90 passed; Electron 2 passed; VS Code command 1 passed. Scoped typecheck and lint: 5 projects passed. Four-project Nx test gate: passed, header confirmed 4 projects (plus 34 dependency tasks). Main consumer proof: 1 test passed. Ptah diagnostics unavailable after two 45-second timeouts; scoped Nx typecheck passed.

## Notes for B07/B08

The legacy panel sends exactly `{ workspacePath, workflow, origin }` in `SETUP_GENERATION_OPEN`; failed VS Code delivery returns false to the panel handler so it can retry. The panel stays open even after a true postMessage transport result, since that is not consumer acknowledgement. Electron broadcast is fire-and-forget; its landing path remains available.

## Decisions

- Decision: retain the legacy panel after a successful transport push. Options: auto-close or retain. Evidence: B06 batch decision says transport receipt does not prove main consumer acceptance. Reversible: yes.
- Decision: use an explicit workflow argument on the existing VS Code command while preserving no-argument landing behavior. Options: new command or optional argument. Evidence: existing command API accepts handler arguments; plan requires direct generation when requested. Reversible: yes.
- Decision: key timeout commit protection to its lock owner and use a run-local flag for post-write abort checks. Options: shared boolean or owner identity. Evidence: force release allows overlapping stale and current runs. Reversible: yes.

## Deviations

None.

## Proposed Removals

None.

