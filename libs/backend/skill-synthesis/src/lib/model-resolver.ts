/**
 * Shared model-resolution utility for SkillJudgeService and SkillCuratorService.
 *
 * Extracted here to avoid importing from one service into another, which would
 * create an implicit dependency between peers.
 */
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { resolveAuthProviderKey } from '@ptah-extension/platform-core';
import { JUDGE_DEFAULT_MODEL_ID } from './types';

const SECTION = 'ptah';
const AUTH_METHOD_KEY = 'authMethod';
const ANTHROPIC_PROVIDER_ID_KEY = 'anthropicProviderId';
/**
 * Matches `AUTH_METHOD_DEF.default` (`settings-core/src/schema/auth-schema.ts:12`)
 * and `runV2Migration`'s own `authMethod || 'apiKey'`. Restated rather than
 * imported because `settings-core` is not a dependency of this library, and it
 * is an auth METHOD, not a provider id — it names no vendor.
 */
const DEFAULT_AUTH_METHOD = 'apiKey';

/**
 * Read a `ptah.*` setting as a trimmed string.
 *
 * No `defaultValue` is passed, deliberately. `PtahFileSettingsManager.get`
 * prefers a caller-supplied default OVER the registered
 * `FILE_BASED_SETTINGS_DEFAULTS` entry (`file-settings-manager.ts:83-91`), so
 * passing `''` here would shadow the host's own default for these keys and make
 * this function disagree with the chat path about what the active provider is.
 */
function readSetting(ws: IWorkspaceProvider, key: string): string {
  const raw = ws.getConfiguration<string>(SECTION, key);
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Resolve the effective LLM model string from a `judgeModel` setting value.
 *
 * Any value other than `'inherit'` is an explicit user choice and is returned
 * as-is. `'inherit'` means: **the model the user's active chat provider is
 * already running, and failing that a known-good Anthropic model.**
 *
 * ## Why "inherit" reads the ACTIVE PROVIDER'S selected model
 *
 * There are two callers, and what they have in common is the auth env, not the
 * lane:
 *
 *  - `resolveLaneModel` (`lane-resolver.service.ts:87`), on the branch where
 *    the lane names NO provider. `IProviderAuthResolver` returns `null` for a
 *    blank provider id, so the call carries no `auth` override.
 *  - `SkillEnhancerService.generateCandidate` (`skill-enhancer.service.ts:690`),
 *    which is NOT a lane at all — it calls this function directly and passes
 *    the result to `internalQuery.execute` (`:740-746`) with no `auth` field.
 *
 * Both therefore run under the AMBIENT chat auth env, which is what the rest of
 * this docblock reasons about. The only model id known to be servable there is
 * the one the active provider is already serving, and that value lives at
 * `provider.<authKey>.selectedModel`, where `authKey` is computed from
 * `authMethod` + `anthropicProviderId` exactly as `ModelSettings` computes it
 * (`settings-core/src/repositories/model-settings.ts:31-43`).
 *
 * It used to read `llm.vscode.model`, and that was a cross-family read. That
 * key is the VS Code Language Model provider's `vendor/family` selector — its
 * shipped default is a non-Anthropic id — and its only consumer, `VsCodeLmAdapter`,
 * was deleted in `096930b51`. Nothing in the product writes it any more, but a
 * value persisted by an older install (or restored by settings import, which
 * still round-trips the key at `agent-sdk/src/lib/types/settings-export.types.ts:68`)
 * would be handed verbatim to an Anthropic-shaped endpoint: `ModelResolver.resolve`
 * matches neither the `claude-` prefix nor a tier alias for a `vendor/family`
 * string and returns it unchanged (`auth-providers/src/lib/auth/model-resolver.ts:87`).
 *
 * ## Why the nothing-configured fallback is a PINNED id and not a tier alias
 *
 * This is a deliberate divergence from the memory curator, which falls back to
 * the bare `'haiku'` tier (`CURATOR_DEFAULT_MODEL_TIER`, TASK_2026_159). The two
 * answer differently because they run under different auth envs, and the auth
 * env is what decides whether a pinned dated id is dangerous:
 *
 *  - **Here** the call rides the ambient chat env, where the active provider's
 *    `ANTHROPIC_DEFAULT_<TIER>_MODEL` values are populated. `ModelResolver.resolve`
 *    detects the tier from a `claude-*` id and substitutes that override
 *    (`auth-providers/src/lib/auth/model-resolver.ts:38-48`), so a non-Anthropic
 *    user gets THEIR haiku-tier model, not this literal.
 *  - **A lane with its own provider** gets an override env whose chat
 *    `ANTHROPIC_DEFAULT_*_MODEL` keys are blanked by design (R2), so there is no
 *    tier mapping for a pinned id to travel through and only a bare alias can
 *    reach the provider entry's `defaultTiers`. That branch therefore returns
 *    the alias — see `resolveLaneModel`.
 *
 * So the pinned id is the deliberate answer to "the user expressed no
 * preference anywhere": ship a model known to be good at the judge/synthesis
 * rubric rather than a tier whose meaning is set by a provider the user never
 * chose for this work. Do not "fix" it into a tier alias — that has been
 * considered and declined (TASK_2026_250, Decision 1).
 *
 * ## The boundary of that remapping — it does NOT cover every provider
 *
 * State this honestly, because a rationale that claims more than it delivers is
 * worse than no rationale. The substitution above happens only where
 * `ANTHROPIC_DEFAULT_HAIKU_MODEL` is actually populated in the ambient env, and
 * `ProviderModelsService.applyPersistedTiers` writes it under `if (value)`,
 * where `value = userTiers[tier] ?? providerDefaults[tier]`. Two ways it is
 * absent, both leaving `claude-haiku-4-5-20251001` to reach the endpoint
 * verbatim:
 *
 *  1. **The active provider declares no `defaultTiers` and the user set no
 *     manual haiku override.** `defaultTiers` is optional on `AnthropicProvider`,
 *     and of the 11 `ANTHROPIC_PROVIDERS` entries THREE omit it: `openrouter`,
 *     `lm-studio` and `requesty`. `openrouter` is `DEFAULT_PROVIDER_ID` and the
 *     registered `FILE_BASED_SETTINGS_DEFAULTS` value for `anthropicProviderId`,
 *     so this is the likeliest configuration, not an exotic one.
 *  2. **`applyPersistedTiers` has not run for the active provider** — its own
 *     doc says "call this during authentication setup when a provider is
 *     active", and whether every auth path invokes it is not traced here.
 *
 * Direct Anthropic (`authMethod: 'apiKey'`) and `claude-cli` (`nativeAuth`, and
 * deliberately an empty auth env) are unaffected: the pinned id is correct
 * verbatim against Anthropic's own endpoint.
 *
 * So Decision 1 is intact but its safety argument is CONDITIONAL, and the
 * residual hazard is exactly the one this task was filed about, surviving for
 * the three providers above. Closing it means either giving those entries a
 * `defaultTiers` in the registry or revisiting Decision 1 — both are the user's
 * call and neither is taken here.
 */
export function resolveJudgeModel(
  judgeModel: string,
  workspaceProvider: IWorkspaceProvider,
): string {
  if (judgeModel !== 'inherit') return judgeModel;
  try {
    const authMethod =
      readSetting(workspaceProvider, AUTH_METHOD_KEY) || DEFAULT_AUTH_METHOD;
    const authKey = resolveAuthProviderKey(
      authMethod,
      readSetting(workspaceProvider, ANTHROPIC_PROVIDER_ID_KEY),
    );
    const configured = readSetting(
      workspaceProvider,
      `provider.${authKey}.selectedModel`,
    );
    return configured || JUDGE_DEFAULT_MODEL_ID;
  } catch {
    return JUDGE_DEFAULT_MODEL_ID;
  }
}
