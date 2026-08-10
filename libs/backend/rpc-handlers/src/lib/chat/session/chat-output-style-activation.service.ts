/**
 * Per-session output-style activation (TASK_2026_197, Batch 5, Req 5.1-5.3/5.6).
 *
 * ## Why this exists as its own service
 *
 * `OutputStyleActivationResolver` is a PURE predicate — it takes the already
 * resolved style entry and the provider base URL and says how the style should
 * reach the session. It deliberately does no I/O. But a session start has
 * neither of those inputs in hand: the selection lives in Ptah's own settings
 * store and the entry only exists after a tier scan. Composing those two reads
 * with the predicate is what this class does, and it lives here rather than
 * inside `ChatSessionService` so that class does not grow five more injected
 * collaborators for one field.
 *
 * ## The contract with the SDK layer
 *
 * The result is returned as the two `AISessionConfig` fields, already mapped
 * one-per-branch — `outputStyleName` for `path: 'flag'`, `outputStyleBody` for
 * `path: 'inject'`, neither for `path: 'none'`. Because the mapping happens
 * exactly once, here, the two call sites in `ChatSessionService` cannot
 * disagree and cannot set both (R3 / Req 5.3). `SdkQueryOptionsBuilder` still
 * asserts the invariant defensively at the point of use.
 *
 * ## Never cached (Req 5.6)
 *
 * Every call re-reads the selection, re-scans the tiers and re-tests the
 * provider base URL. A provider swap or a style deleted outside Ptah between
 * two sessions is therefore reflected on the next session start, with no
 * invalidation logic to get wrong.
 *
 * ## Never fatal
 *
 * An unreadable settings store or an unreadable style directory degrades to
 * "no style". A cosmetic preference must not be able to stop a chat from
 * starting.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  OUTPUT_STYLE_TOKENS,
  type OutputStyleActivationResolver,
  type OutputStyleDiscoveryService,
} from '@ptah-extension/output-styles';
import {
  SETTINGS_TOKENS,
  type ISettingsStore,
  type WorkspaceScopeResolver,
} from '@ptah-extension/settings-core';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers';
import type { ActivationDecision, AuthEnv } from '@ptah-extension/shared';
import {
  readOutputStyleSelection,
  resolveProviderBaseUrl,
  type OutputStyleSelectionContext,
} from '../../utils/output-style-selection';

/**
 * The slice of `AISessionConfig` this service owns.
 *
 * Spread into the session literal. At most one key is ever present — that is
 * the whole point of returning a mapped object instead of a decision.
 */
export interface OutputStyleSessionFields {
  readonly outputStyleName?: string;
  readonly outputStyleBody?: string;
}

/** Nothing selected, nothing resolvable, or a read failed. */
const NO_OUTPUT_STYLE: OutputStyleSessionFields = Object.freeze({});

@injectable()
export class ChatOutputStyleActivationService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(OUTPUT_STYLE_TOKENS.DISCOVERY)
    private readonly discovery: OutputStyleDiscoveryService,
    @inject(OUTPUT_STYLE_TOKENS.ACTIVATION_RESOLVER)
    private readonly activation: OutputStyleActivationResolver,
    @inject(SETTINGS_TOKENS.SETTINGS_STORE)
    private readonly settingsStore: ISettingsStore,
    /**
     * Optional, exactly as in `OutputStyleRpcHandlers`: a host with no
     * `IActiveWorkspaceSource` never registers it and the selection falls back
     * to a single unprefixed key. Reading through the SAME resolution path the
     * handler writes through is what keeps the two in agreement.
     */
    @inject(SETTINGS_TOKENS.WORKSPACE_SCOPE_RESOLVER, { isOptional: true })
    private readonly scopeResolver?: WorkspaceScopeResolver,
    /**
     * Optional live auth snapshot. `ANTHROPIC_BASE_URL` is the single input
     * that can turn the decision from `flag` into `inject`, and it is the same
     * value `SdkQueryOptionsBuilder` tests when it decides whether to drop
     * `'user'` from `settingSources` — so both sides read one source and
     * cannot drift. Absent reads as "not localhost", which selects the flag
     * tier: the primary mechanism, not the fallback.
     */
    @inject(AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV, { isOptional: true })
    private readonly authEnv?: AuthEnv,
  ) {}

  /**
   * Resolve the activation for ONE session start or resume.
   *
   * @param workspaceRoot Scopes the project-tier scan. `undefined` lets
   *   discovery fall back to the workspace provider's primary root.
   */
  async resolveSessionFields(
    workspaceRoot?: string,
  ): Promise<OutputStyleSessionFields> {
    try {
      const selected = this.readSelectedName();
      if (selected === null) return NO_OUTPUT_STYLE;

      const { styles } = await this.discovery.discover({
        workspaceRoot,
        activeName: selected,
      });

      // The winner under the SDK merge order. A shadowed entry is a real file
      // that a higher tier overrides, so binding to it would apply text the
      // SDK itself would never use.
      const winner =
        styles.find(
          (style) => style.name === selected && style.shadowed !== true,
        ) ?? null;

      const decision = this.activation.resolve({
        style: winner,
        providerBaseUrl: this.providerBaseUrl(),
      });

      return this.toSessionFields(decision);
    } catch (error: unknown) {
      // Degrade to "no style" — see the class comment. A style is a
      // preference; a chat session is the product.
      this.logger.warn(
        '[ChatOutputStyleActivation] activation could not be resolved; starting without a style',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return NO_OUTPUT_STYLE;
    }
  }

  /**
   * The one place a decision becomes session fields.
   *
   * The switch is exhaustive over the three-member union, so adding a branch
   * to `ActivationDecision` is a compile error here rather than a silently
   * ignored path.
   */
  private toSessionFields(
    decision: ActivationDecision,
  ): OutputStyleSessionFields {
    switch (decision.path) {
      case 'flag':
        return { outputStyleName: decision.styleName };
      case 'inject':
        // An empty body would append a blank section and claim a style was
        // applied when nothing was. Treat it as no style.
        return decision.body.trim().length > 0
          ? { outputStyleBody: decision.body }
          : NO_OUTPUT_STYLE;
      case 'none':
        return NO_OUTPUT_STYLE;
    }
  }

  /**
   * Ptah's persisted selection, or `null` for "no style".
   *
   * The SAME function `OutputStyleRpcHandlers` reads through — not a mirror of
   * it. The handler's answer drives the UI's checkmark and this one drives what
   * actually reaches the SDK, so a single implementation is what stops the two
   * from ever describing different styles.
   */
  private readSelectedName(): string | null {
    return readOutputStyleSelection(this.selectionContext);
  }

  /** Dependencies the shared selection helpers need, in one place. */
  private get selectionContext(): OutputStyleSelectionContext {
    return {
      settingsStore: this.settingsStore,
      scopeResolver: this.scopeResolver,
      logger: this.logger,
      logTag: '[ChatOutputStyleActivation]',
    };
  }

  /** `ANTHROPIC_BASE_URL`, normalised to `undefined` when blank or absent. */
  private providerBaseUrl(): string | undefined {
    return resolveProviderBaseUrl(this.authEnv);
  }
}
