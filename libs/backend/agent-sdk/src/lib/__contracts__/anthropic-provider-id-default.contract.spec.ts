/**
 * `anthropicProviderId` — the unset-install default, pinned across two libs.
 * TASK_2026_250 follow-up B, item 2.
 *
 * THE SHAPE OF THE PROBLEM THIS FILE EXISTS FOR
 *
 * Three places declare what `anthropicProviderId` is when a user has set
 * nothing, and they are not wired to each other:
 *
 *   1. `platform-core/src/file-settings-keys.ts:383`
 *        FILE_BASED_SETTINGS_DEFAULTS.anthropicProviderId = 'openrouter'
 *   2. `shared/src/lib/providers/provider-registry.ts:492`
 *        DEFAULT_PROVIDER_ID = 'openrouter'
 *   3. `settings-core/src/schema/auth-schema.ts:22`
 *        ANTHROPIC_PROVIDER_ID_DEF.default = ''
 *
 * (3) IS UNREACHABLE IN PRODUCTION, and that is the finding that decides how
 * this is tested rather than fixed. Every real read bottoms out in
 * `PtahFileSettingsManager.get(key)` with NO caller default — the three
 * `ISettingsStore.readGlobal` adapters all drop the argument
 * (`platform-cli/src/settings/file-settings-store.ts:42-44`,
 * `platform-electron/src/settings/file-settings-store.ts:36-38`,
 * `platform-vscode/src/settings/vscode-settings-adapter.ts:70-75`), and
 * `WorkspaceScopeResolver.read` has no `defaultValue` parameter at all
 * (`settings-core/src/scope/workspace-scope-resolver.ts:109-116`). So the
 * lookup order in `file-settings-manager.ts:83-91` reaches (1) every time and
 * (3) never speaks. The two stores do not disagree at runtime; one of them is
 * simply never asked.
 *
 * WHY (1) AND (2) MUST BE ASSERTED EQUAL RATHER THAN LEFT ALONE
 *
 * They agree today by coincidence of two independent literals, not by
 * construction, and (1) is consulted FIRST. Every `?? DEFAULT_PROVIDER_ID`
 * fallback in the product — `auth-providers/.../active-provider-resolver.ts:38-41`
 * and `:66-73`, `rpc-handlers/.../auth-rpc.handlers.ts:394-397` — is therefore
 * dead code on a real install: the registry default has already answered. If
 * someone retargets `DEFAULT_PROVIDER_ID` (say to `'anthropic'`), those
 * fallbacks would keep reading as the source of truth while the file default
 * silently overrode them, and nothing would fail. This spec is the thing that
 * fails.
 *
 * WHY THE COUPLING IS PINNED HERE, IN agent-sdk
 *
 * `platform-core` is the leaf every backend lib depends on; importing
 * `@ptah-extension/shared` into it would invert the graph (its CLAUDE.md:
 * "Never import other backend libs from here"). That is the same constraint
 * that forced the literal-restatement tables in
 * `platform-core/src/file-settings-keys.spec.ts:334-357`. `agent-sdk` depends
 * on both sides and already re-exports `DEFAULT_PROVIDER_ID`
 * (`agent-sdk/src/index.ts:146`), so it is the nearest lib that may legally
 * hold both — mirroring how `rpc-handlers` owns the cross-lib equality for the
 * skill-synthesis lane keys.
 *
 * WHY NEITHER LITERAL WAS CHANGED
 *
 * Flipping (1) to `''` to match (3) is NOT a no-op, because the consumers use
 * `??` (nullish), not `||` (falsy). `'' ?? DEFAULT_PROVIDER_ID` is `''`, so
 * `ActiveProviderResolver.resolveThirdPartyProviderId()` would start returning
 * an empty provider id instead of `'openrouter'`, and
 * `resolveAuthProviderKey('thirdParty', '')` would move the per-provider
 * settings bucket from `provider.thirdParty.openrouter.*` to
 * `provider.thirdParty.unknown.*` (`platform-core/src/settings-auth-key.ts:16-21`),
 * orphaning any stored model/effort choice for such an install. There is an
 * unmerged branch that makes exactly this change — `fix/claude-cli-default-model`,
 * commit `2cf4390e0` — and that is where the decision belongs, with this trace
 * attached, not in a drive-by edit here.
 */
import { FILE_BASED_SETTINGS_DEFAULTS } from '@ptah-extension/platform-core';
import { DEFAULT_PROVIDER_ID } from '@ptah-extension/shared';

describe('anthropicProviderId unset-install default (TASK_2026_250 follow-up B)', () => {
  it('keeps the file-settings default and DEFAULT_PROVIDER_ID in agreement', () => {
    expect(FILE_BASED_SETTINGS_DEFAULTS['anthropicProviderId']).toBe(
      DEFAULT_PROVIDER_ID,
    );
  });

  /**
   * The file default is consulted before any `?? DEFAULT_PROVIDER_ID`, so it
   * must be a non-empty string or those fallbacks silently stop firing (see
   * the `??`-vs-`||` note in the header). This is the assertion that would
   * catch a naive application of `2cf4390e0` without the accompanying
   * consumer changes.
   */
  it('declares a non-empty provider id, so the ?? fallbacks stay consistent', () => {
    const value = FILE_BASED_SETTINGS_DEFAULTS['anthropicProviderId'];
    expect(typeof value).toBe('string');
    expect(value).not.toBe('');
  });

  /**
   * `authMethod` is what decides whether `anthropicProviderId` is consulted at
   * all: `resolveAuthProviderKey` returns the auth method verbatim unless it is
   * `'thirdParty'`. With the shipped `'apiKey'` default, a never-configured
   * install resolves the key `provider.apiKey.selectedModel` and the provider
   * id above is inert. Pinning this is what makes "the mismatch is latent, not
   * live" a checked statement rather than a claim in a report.
   */
  it('ships authMethod=apiKey, which keeps the provider id off the unset path', () => {
    expect(FILE_BASED_SETTINGS_DEFAULTS['authMethod']).toBe('apiKey');
  });
});
