# Task Context - TASK_2026_159

## User Request

"can we orchestrate a task for the curator model picker to use the haiku tier with whatever auth provider the user has settled? and make sure we don't have an issue or any faults that could come from switching or changing these model tiers ?"

## Task Type

BUGFIX (behavior correction / safety)

## Complexity Assessment

Medium — touches backend model resolution, frontend picker label/defaults, and provider tier config. Safety/correctness focus requires QA.

## Strategy Selected

BUGFIX streamlined with QA emphasis: Team-Leader -> Developers -> QA.

## Conversation Summary

- User observed in Thoth → Memory → Curator model picker that the default is labelled `Default (claude-haiku-4-5-20251001)` even though they are using Ollama Cloud as the auth provider.
- Investigation showed that `SdkInternalQueryCuratorLlm` in `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts` falls back to the hardcoded constant `CURATOR_FALLBACK_MODEL = 'claude-haiku-4-5-20251001'` when `memory.curatorModel` is empty.
- The curator does NOT use the provider model-tier mapping (`provider.<id>.mainAgent.modelTier.haiku` or provider `defaultTiers`) that the main chat agent uses.
- The UI component `CuratorModelPickerComponent` (`libs/frontend/memory-curator-ui/src/lib/components/diagnostics/curator-model-picker.component.ts`) hardcodes the same label.
- Active provider resolution is handled by `ActiveProviderResolver` in `libs/backend/auth-providers/src/lib/auth/active-provider-resolver.ts` and tier mapping is managed by `ProviderModelsService` in `libs/backend/auth-providers/src/lib/provider-models.service.ts`.
- Settings keys for per-provider haiku tier overrides are file-based (`provider.<id>.mainAgent.modelTier.haiku`) and declared in `libs/backend/platform-core/src/file-settings-keys.ts`.

## Assumptions

1. Keep the curator provider/model override UI — do not remove user override capability.
2. "Active provider" means the auth provider currently selected for the main chat agent (apiKey/claudeCli → Anthropic direct; thirdParty → `anthropicProviderId`).
3. Haiku tier is the appropriate curator default because curation is a lightweight, high-volume summarization task.
4. If a provider has no haiku-tier mapping (user override or provider default), a safe fallback still must exist (current hardcoded Claude Haiku is acceptable as a last resort, with logging).

## CLI Agent Delegation

**Mode**: disabled (user selected "no — Sub-agents work alone")
**Available Agents**: codex, copilot, ollama-cloud (ptah-cli), claude-cli (ptah-cli)

## Related Tasks

- TASK_2026_157: Task-management system phase 1 (unrelated; shares the `.ptah/specs/` infrastructure)

## Created

2026-07-16T00:00:00.000Z
