# Batch 43 report

## Retained methods and ports

| RPC method(s) | Ports used by the retained body or its helpers |
| --- | --- |
| `listClones`, `getClone` | Registry, user-layer mirror, scorecard (grade and invocation-event aggregates), workspace provider |
| `previewEnhancement` | Registry, enhancer, workspace provider settings and pause switch |
| `applyProposal`, `revertEnhancement` | Enhancer |
| `getHistoryBody` | User-layer mirror, workspace provider |
| `rebaseClone`, `keepClone` | Registry, user-layer mirror, workspace provider, content download where an upstream plugin path is needed |
| `saveCloneBody` | Registry, user-layer mirror, workspace provider, repropagation |
| `listQuarantinedAgents`, `restoreQuarantinedAgent` | User-layer mirror, workspace provider, agent-sync consent reader |
| `getAgentModels`, `setAgentModel` | Agent model settings, CLI model list service, workspace provider |
| `invocationStats`, `getScorecards`, `getScorecardDetail` | Scorecard (grade and invocation-event aggregates) |
| `listSpecs`, `harvestSpecs`, `clearStaleSpecs` | Spec harvester |

Library pause is read from the workspace provider by `previewEnhancement`; telemetry and enhancement preferences live in the settings ports. The legacy `getSettings`/`updateSettings` methods belong to the Batch 59 removal set, so their bodies remain intact here. The auto-writing `enhanceNow` method is also in that removal set.

## Changes

- `previewEnhancement` now reads effective settings from the workspace provider and validates them with the existing Zod settings schema before calling the enhancer. It no longer calls `this.synthesis.readSettings()`.
- Updated its spec to set a real workspace configuration value, assert that value reaches the enhancer, and assert that `synthesis.readSettings` is not called.
- Removed the stale diagnostics comment mentioning `SKILL_SYNTHESIS_EVENT`. No live push call was present in this handler at the start of this batch.

## Acceptance results

- Scoped `rg -n 'SKILL_SYNTHESIS_EVENT'` on the handler: zero matches.
- Retained method bodies and their helpers: zero `this.synthesis`, candidate-store, or queue-store access. Remaining such accesses are in obsolete methods and the candidate-list helper reserved for Batch 59.
- `METHODS`, obsolete method bodies, and constructor injections remain unchanged.
- No test, typecheck, lint, build, serve, or e2e command was run, as instructed.

## Decisions

- Used the existing workspace settings provider and Zod schema for the preview because the current enhancer API still requires `SkillSynthesisSettings`. The settings are read at call time, like the pause switch.
- Left the obsolete `enhanceNow`, legacy settings, suggestion, queue, and candidate paths for the atomic Batch 59 contract cut.

## Clarifications Needed

- `libs/backend/skill-synthesis/src/lib/skill-scorecard.service.ts:51,77,108`: current scorecard methods do not accept a workspace root. The per-workspace grade change requires the planned Task 44.3 store/service edit before the Batch 59 handler calls can pass the active root. No edit was made outside this batch's two allowed source/spec files.
