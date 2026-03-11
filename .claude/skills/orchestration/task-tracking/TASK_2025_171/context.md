# TASK_2025_171: Model Mapping Modal for Ptah CLI Agents

## Type: REFACTORING

## Status: IN_PROGRESS

## Workflow: Minimal (Frontend Developer only)

## User Request

Move the inline model mapping section (currently takes massive vertical space showing 3 Sonnet/Opus/Haiku search fields per agent provider) into a modal dialog. Add a small button on each agent card that opens the modal. Show 3 small badges on the agent card displaying the currently mapped models (if any).

## Current State

- `agent-orchestration-config.component.ts` lines 195-206: renders `<ptah-provider-model-selector>` per unique Ptah CLI provider inline
- This creates 3 tier selectors (Sonnet/Opus/Haiku) × N providers, taking massive vertical space
- `ptah-cli-config.component.ts`: CRUD management for agents, no model mapping reference

## Planned Changes

### 1. `agent-orchestration-config.component.ts`

- Remove the model mapping section (lines 195-206 block with `@if (uniquePtahProviders().length > 0)`)
- Keep `uniquePtahProviders()` computed (may still be useful) or remove if unused

### 2. `ptah-cli-config.component.ts`

- Import `ProviderModelSelectorComponent`
- Add state: `providerTierMappings` signal - Map of providerId → {sonnet, opus, haiku}
- Add state: `modelMappingAgent` signal - which agent's modal is open
- Load tier mappings per unique provider via `provider:getModelTiers` RPC
- Per agent card: add 3 small badges showing mapped model IDs (from providerTierMappings)
- Per agent card: add a small "Models" button (Layers icon)
- Add `<dialog>` modal with `<ptah-provider-model-selector>` inside
- On modal close: re-fetch tier mappings to sync badges

### 3. No backend/shared type changes needed

- `provider:getModelTiers` RPC already accepts optional `providerId`
- `ProviderModelSelectorComponent` is self-contained

## Files Affected

1. `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts`
2. `libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-config.component.ts`
