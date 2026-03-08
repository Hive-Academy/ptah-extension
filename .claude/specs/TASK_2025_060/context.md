# TASK_2025_060: Model Selection Mismatch Fix

## User Intent

Fix critical model mismatch issue where:

1. UI shows "Opus 4.5" but API sends invalid model `claude-sonnet-4.5-20250929`
2. Claude returns 404 error: "model not found"
3. User wants dynamic model fetching (no hardcoding)
4. User wants model sync between selection and API calls
5. User wants per-message model name displayed near token/cost badges

## Screenshot Evidence

User uploaded screenshot showing:

- Model dropdown displays "Opus 4.5"
- API Error: `{"type":"not_found_error","message":"model: claude-sonnet-4.5-20250929 was not found. Did you mean claude-sonnet-4-5-20250929?"}`

## Root Cause Analysis

### Problem 1: Invalid Hardcoded Model Name

The model ID `claude-sonnet-4.5-20250929` is hardcoded in 3 places and is INVALID:

- `sdk-query-builder.ts:97` - Default model for new sessions
- `sdk-agent-adapter.ts:348` - Default in startChatSession
- `sdk-agent-adapter.ts:465` - Default in resumeSession

Claude API expects format: `claude-{model}-4-YYYYMMDD` (no `.5`)

### Problem 2: Model ID Not Translated

Frontend uses shorthand IDs (`opus`, `sonnet`, `haiku`) but backend doesn't translate to `apiName`:

- `AVAILABLE_MODELS` in `model-autopilot.types.ts` has correct mappings
- RPC handler `config:model-switch` (line 665-669) uses `apiName` correctly for LIVE updates
- But initial session start doesn't use this translation!

### Problem 3: Model Not on Messages

`ExecutionChatMessage` type lacks `model` field for per-message tracking.
`ExecutionNode` has `model` field (line 156) but it's not propagated.

## Key Files to Modify

### Backend

- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-builder.ts` - Fix default model translation
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` - Remove hardcoded fallbacks
- `apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts` - Pass model correctly

### Frontend

- `libs/shared/src/lib/types/execution-node.types.ts` - Add `model` to `ExecutionChatMessage`
- `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html` - Display model badge
- `libs/frontend/chat/src/lib/components/atoms/` - New `ModelBadgeComponent`

### Shared

- `libs/shared/src/lib/types/model-autopilot.types.ts` - Add helper function for ID→apiName lookup
