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
 * ## The boundary of that remapping — where it USED to end, and where it ends now
 *
 * State this honestly, because a rationale that claims more than it delivers is
 * worse than no rationale. The substitution happens only where the active
 * provider has a tier mapping at all. Until TASK_2026_262 that meant: always,
 * EXCEPT on the three `ANTHROPIC_PROVIDERS` entries that declare no
 * `defaultTiers` — `openrouter`, `lm-studio` and `requesty`, each for a
 * documented reason (a 200-model dynamic catalogue; a local server holding
 * whatever model the user loaded; a tier map Requesty's own docs contradict,
 * `requesty-provider-entry.ts:19-23`). On those,
 * `claude-haiku-4-5-20251001` reached the endpoint verbatim.
 *
 * **That is now fixed, one layer down, and this function did not change.**
 * The tier env var both branches of `ModelResolver.resolve` read is populated
 * from the provider's OWN live catalogue when neither a user pick nor a
 * registry `defaultTiers` map supplies it
 * (`auth-providers/src/lib/model-tier-derivation.ts`, applied by
 * `ProviderModelsService.applyPersistedTiers` for the ambient env and by
 * `ProviderAuthResolver.buildTierValues` for a lane's). So the pinned id above
 * is remapped on all eleven entries, not eight — which is exactly why
 * `resolveJudgeModel` needed no production change and why "fetching the live
 * model list is not this function's job" is still true without being an excuse.
 * `requesty-provider-entry.ts`'s "tiers come from the live model list instead"
 * is now implemented rather than aspirational.
 *
 * Two things that did NOT change with it, and must not be read as closed:
 *  - **The remap is not instantaneous.** It needs a catalogue on hand — the
 *    in-memory cache or the copy persisted at `provider.<id>.modelCatalog`. In
 *    the window before the first fetch lands, or on a provider whose catalogue
 *    could not be fetched at all, the pinned id still goes out verbatim and
 *    `ModelResolver` logs its one-time warn. Transient rather than permanent,
 *    which is the whole difference, but not zero.
 *  - **The reflex fix — fall back to the bare `'haiku'` alias instead — still
 *    buys nothing here, and that is still a code fact rather than an opinion.**
 *    Both values enter the SAME env var (`:43` for a dated id, `:57` for an
 *    alias), so whatever populates it closes both together and whatever leaves
 *    it empty leaves both verbatim. Pinned by
 *    `auth-providers/src/lib/auth/model-resolver.spec.ts`
 *    ("tier values with nothing left to resolve them"), so nobody has to take
 *    this paragraph's word for it. Decision 1 was never what held the gap open,
 *    and reversing it would not have closed it.
 *
 * Nor was this path where the gap showed up first. The FOREGROUND CHAT had it
 * identically — `chat-session.service.ts:418` substitutes `'default'` for an
 * empty `selectedModel`, and on such a provider `resolve` turned that into a
 * bare `'opus'` and sent it. It was a gap belonging to dynamic-catalogue
 * providers rather than to skill synthesis, which is why it was closed in
 * `auth-providers` and why closing it took nothing from this library.
 *
 * Two things this docblock used to leave open, now settled:
 *  - **`applyPersistedTiers` DOES run on every third-party activation path.**
 *    `AuthManager.doConfigureAuthentication` clears the tier env then dispatches
 *    `strategy.configure`, and all eight third-party branches call
 *    `ProviderModelsService.switchActiveProvider` (`api-key.strategy.ts:456,591,635`,
 *    `oauth-proxy.strategy.ts:146,247`, `local-proxy.strategy.ts:101`,
 *    `local-native.strategy.ts:153,222`), which calls it. Only the direct-Anthropic
 *    branch does not, and that one correctly wants no remapping. So a provider
 *    that declares `defaultTiers` genuinely has its tier env populated; the
 *    "not traced" second failure mode was theoretical and is now ruled out.
 *  - Direct Anthropic (`authMethod: 'apiKey'`) and `claude-cli` (`nativeAuth`,
 *    deliberately an empty auth env) are unaffected either way: the pinned id is
 *    correct verbatim against Anthropic's own endpoint.
 *
 * Decision 1 stands, and after TASK_2026_262 its safety argument has no
 * PROVIDER-shaped boundary left at all — no entry is permanently unable to
 * remap a tier. What remains is a TIMING boundary: a provider whose catalogue
 * has not landed yet, or could not be fetched. The one-time `logger.warn` in
 * `ModelResolver` makes that case legible instead of silent; it is a
 * diagnostic, not a fallback, and it was deliberately not narrowed, because it
 * is now the only signal for the window that is left.
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
