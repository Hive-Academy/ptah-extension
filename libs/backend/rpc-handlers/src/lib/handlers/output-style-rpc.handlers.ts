/**
 * Output-Style RPC Handlers — the `outputStyle:` namespace (TASK_2026_197).
 *
 * Serves the output-style surface on all hosts (VS Code, Electron, CLI) with
 * `requires: []`: everything below needs only `IFileSystemProvider` and
 * `IWorkspaceProvider`, which every host has.
 *
 *   - outputStyle:list      — built-in + user + project tiers, invalid files included
 *   - outputStyle:get       — one style's body plus the E8 guard stamp
 *   - outputStyle:activate  — persist Ptah's own selection, report how it will apply
 *   - outputStyle:save      — upsert; renaming the active style rebinds it here
 *   - outputStyle:delete    — remove a file; deleting the active style clears it
 *   - outputStyle:diagnose  — re-resolve the decision, never read from a cache
 *
 * ## This class owns exactly two things
 *
 * Everything about styles-as-files lives in `@ptah-extension/output-styles` and
 * is called, not re-implemented. What is genuinely this layer's job is:
 *
 *  1. **The trust boundary** — Zod at the door, one `INVALID_PARAMS` for every
 *     malformed payload, and a name guard that rejects traversal and reserved
 *     Windows device names BEFORE any filesystem call happens.
 *  2. **The selection** — reading and writing `outputStyle.selectedName` in
 *     Ptah's own settings. The writer deliberately has no `settings-core`
 *     access, so the Req 4.4 rebind ("renaming the active style updates the
 *     binding in the same call") and the Req 4.6 clear ("deleting the active
 *     style falls back to default") are decided HERE, from the writer's
 *     `renamedFrom` signal. `OutputStyleSaveResult.rebound` is this class's
 *     answer, not the writer's.
 *
 * ## Errors
 *
 * Two shapes, on purpose. A malformed REQUEST is a thrown `RpcUserError` —
 * there is no result to return. A failed OPERATION is a `success: false`
 * result carrying a typed `OutputStyleOperationError`, because the UI needs to
 * render it beside the list it already has. Both are display-ready: the lib's
 * messages are pre-formatted and its paths are `~`- or workspace-relative, and
 * `sanitize()` catches anything unexpected so no raw exception text and no
 * absolute host path can reach a client (Req 7.6).
 *
 * ## Parity is a SEPARATE, ADVISORY outcome (§4.1)
 *
 * `activate`'s optional `parity` argument mirrors the chosen style into a
 * co-owned `.claude/settings*.json` so a `claude` process the user starts
 * themselves sees it too. It is OPT-IN and default OFF: no `parity` object, or
 * `enabled: false`, and no settings file is touched at all.
 *
 * It is **not** how a style activates inside Ptah — that is the flag tier,
 * which involves no I/O and cannot fail. So the parity write is sequenced
 * AFTER the selection is already persisted, it is called OUTSIDE the try that
 * can reject this RPC, and `runParity` is total: it returns an outcome for
 * every input and throws for none. A parity failure therefore cannot roll back,
 * block, or alter the selection — structurally, not by convention.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS, RpcUserError } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  LOCALHOST_BASE_URL_RE,
  OUTPUT_STYLE_TOKENS,
  type ClaudeSettingsWriter,
  type OutputStyleActivationResolver,
  type OutputStyleDiscoveryService,
  type OutputStyleFileWriter,
} from '@ptah-extension/output-styles';
import {
  SETTINGS_TOKENS,
  type ISettingsStore,
  type WorkspaceScopeResolver,
} from '@ptah-extension/settings-core';
import {
  normalizeOutputStyleSelection,
  readOutputStyleSelection,
  resolveProviderBaseUrl,
  writeOutputStyleSelection,
  type OutputStyleSelectionContext,
} from '../utils/output-style-selection';
// Re-exported by `auth-providers`, which this lib already depends on. The
// zero-dep `auth-providers-tokens` package would be the narrower import, but it
// is not in this project's declared dependencies and every other handler here
// reaches the tokens through the same barrel — one import path, not two.
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers';
import type {
  ActivationDecision,
  AuthEnv,
  OutputStyleDetail,
  OutputStyleEntry,
  OutputStyleTier,
  RpcMethodName,
  OutputStyleListParams,
  OutputStyleListResult,
  OutputStyleGetParams,
  OutputStyleGetResult,
  OutputStyleActivateParams,
  OutputStyleActivateResult,
  OutputStyleSaveParams,
  OutputStyleSaveResult,
  OutputStyleDeleteParams,
  OutputStyleDeleteResult,
  OutputStyleDiagnoseParams,
  OutputStyleDiagnoseResult,
  OutputStyleParityOutcome,
  OutputStyleParityRequest,
} from '@ptah-extension/shared';
import {
  OutputStyleListParamsSchema,
  OutputStyleGetParamsSchema,
  OutputStyleActivateParamsSchema,
  OutputStyleSaveParamsSchema,
  OutputStyleDeleteParamsSchema,
  OutputStyleDiagnoseParamsSchema,
} from './output-style-rpc.schema';

@injectable()
export class OutputStyleRpcHandlers {
  /** RPC methods owned by this handler (manifest coverage invariant). */
  static readonly METHODS = [
    'outputStyle:list',
    'outputStyle:get',
    'outputStyle:activate',
    'outputStyle:save',
    'outputStyle:delete',
    'outputStyle:diagnose',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(OUTPUT_STYLE_TOKENS.DISCOVERY)
    private readonly discovery: OutputStyleDiscoveryService,
    @inject(OUTPUT_STYLE_TOKENS.FILE_WRITER)
    private readonly fileWriter: OutputStyleFileWriter,
    @inject(OUTPUT_STYLE_TOKENS.ACTIVATION_RESOLVER)
    private readonly activation: OutputStyleActivationResolver,
    /**
     * Opt-in CLI parity only. Nothing on the activation path touches it, and
     * nothing it reports can change a selection that is already persisted.
     */
    @inject(OUTPUT_STYLE_TOKENS.CLAUDE_SETTINGS_WRITER)
    private readonly settingsWriter: ClaudeSettingsWriter,
    @inject(SETTINGS_TOKENS.SETTINGS_STORE)
    private readonly settingsStore: ISettingsStore,
    /**
     * Optional: a host that has not bound an `IActiveWorkspaceSource` never
     * registers this, so the selection falls back to a single unprefixed key.
     * That is a degraded scope, not a broken one — every read and write still
     * agrees with every other.
     */
    @inject(SETTINGS_TOKENS.WORKSPACE_SCOPE_RESOLVER, { isOptional: true })
    private readonly scopeResolver?: WorkspaceScopeResolver,
    /**
     * Optional: the live auth snapshot, mutated in place by auth configuration.
     * Its `ANTHROPIC_BASE_URL` is the one input that can make the decision
     * `inject` instead of `flag`. Absent (a host without auth-providers, or a
     * unit harness) reads as "not localhost", which is the safe default — the
     * flag tier is the primary mechanism and injection is the narrow fallback.
     */
    @inject(AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV, { isOptional: true })
    private readonly authEnv?: AuthEnv,
  ) {}

  register(): void {
    this.registerList();
    this.registerGet();
    this.registerActivate();
    this.registerSave();
    this.registerDelete();
    this.registerDiagnose();
  }

  /** `outputStyle:list` — every tier, plus the files that failed to parse. */
  private registerList(): void {
    this.rpcHandler.registerMethod<
      OutputStyleListParams,
      OutputStyleListResult
    >('outputStyle:list', async (params) => {
      const parsed = this.parse(OutputStyleListParamsSchema, params);
      try {
        return await this.discovery.discover({
          workspaceRoot: parsed.workspaceRoot,
          activeName: this.readSelectedName(),
        });
      } catch (error: unknown) {
        throw this.sanitize(
          error,
          'outputStyle:list',
          'Failed to list output styles.',
        );
      }
    });
  }

  /**
   * `outputStyle:get` — one style, with its body and the E8 guard stamp.
   *
   * The stamp comes from `OutputStyleFileWriter.stat`, which locates the file
   * by frontmatter `name` exactly as `save` will. Deriving the path here
   * instead would give the editor a stamp for a file the writer might not
   * choose, which is the one way to make an optimistic-concurrency check lie.
   *
   * A missing stamp is not an error: built-ins have no file, and a file that
   * vanished between the scan and the stat is reported as `style: null` by the
   * lookup above rather than as a failure.
   */
  private registerGet(): void {
    this.rpcHandler.registerMethod<OutputStyleGetParams, OutputStyleGetResult>(
      'outputStyle:get',
      async (params) => {
        const parsed = this.parse(OutputStyleGetParamsSchema, params);
        try {
          const { styles } = await this.discovery.discover({
            workspaceRoot: parsed.workspaceRoot,
            activeName: this.readSelectedName(),
          });

          const entry = styles.find(
            (style) => style.name === parsed.name && style.tier === parsed.tier,
          );
          if (entry === undefined) return { style: null };

          if (parsed.tier !== 'user' && parsed.tier !== 'project') {
            return { style: entry as OutputStyleDetail };
          }

          const stamped = await this.fileWriter.stat({
            tier: parsed.tier,
            name: parsed.name,
            workspaceRoot: parsed.workspaceRoot,
          });

          return {
            style: stamped.ok
              ? {
                  ...entry,
                  mtime: stamped.stamp.mtime,
                  byteLength: stamped.stamp.byteLength,
                }
              : entry,
          };
        } catch (error: unknown) {
          throw this.sanitize(
            error,
            'outputStyle:get',
            'Failed to open the output style.',
          );
        }
      },
    );
  }

  /**
   * `outputStyle:activate` — persist the selection and say how it will apply.
   *
   * The decision is REPORTED, never stored (Req 5.6). It describes what the
   * next session would do with today's provider; a provider change between now
   * and then re-resolves it from scratch at the session call site.
   *
   * ## Why the parity write is the LAST thing that happens, outside the `try`
   *
   * The selection is authoritative and the parity write is advisory (§4.1).
   * Structuring the method so the selection is fully resolved and persisted
   * before `runParity` is even called — and so that call sits outside the
   * `try` whose `catch` rejects this RPC — means there is no reachable path on
   * which a parity outcome influences `selection`. Not a rule to remember: an
   * unfailed selection is already returned by the time parity is consulted, and
   * the only field the parity result can occupy is `parity`.
   */
  private registerActivate(): void {
    this.rpcHandler.registerMethod<
      OutputStyleActivateParams,
      OutputStyleActivateResult
    >('outputStyle:activate', async (params) => {
      const parsed = this.parse(OutputStyleActivateParamsSchema, params);
      const requested = this.normalizeSelection(parsed.name);

      let selection: OutputStyleActivateResult;
      try {
        selection = await this.applySelection(requested, parsed.workspaceRoot);
      } catch (error: unknown) {
        throw this.sanitize(
          error,
          'outputStyle:activate',
          'Failed to activate the output style.',
        );
      }

      // A refused selection changed nothing, so there is nothing to mirror.
      if (!selection.success) return selection;

      return {
        ...selection,
        parity: await this.runParity(
          parsed.parity,
          requested,
          parsed.workspaceRoot,
        ),
      };
    });
  }

  /**
   * Persist the selection and report how it will reach the next session.
   *
   * Everything that can legitimately fail an activate lives here; the caller
   * turns a throw into a sanitized rejection. Knows nothing about parity.
   */
  private async applySelection(
    requested: string | null,
    workspaceRoot: string | undefined,
  ): Promise<OutputStyleActivateResult> {
    if (requested === null) {
      await this.writeSelectedName(null);
      return { success: true, decision: { path: 'none' } };
    }

    const { styles } = await this.discovery.discover({
      workspaceRoot,
      activeName: requested,
    });

    const winner = this.winnerFor(styles, requested);
    if (winner === null) {
      // Selecting something that does not exist would create the E5 orphan
      // state on purpose. Refuse, and leave the previous selection intact.
      return {
        success: false,
        decision: { path: 'none' },
        error: {
          code: 'NOT_FOUND',
          message: `"${requested}" is no longer available, so it was not activated.`,
        },
      };
    }

    await this.writeSelectedName(requested);

    return { success: true, decision: this.decisionFor(winner) };
  }

  /**
   * Opt-in CLI parity (§4.1, §4.2, R6). Total by construction: every input
   * yields an outcome and none yields a throw.
   *
   *  - No request, or `enabled: false` → `undefined`, and **`ClaudeSettingsWriter`
   *    is never called**. A user who never ticks the box never has a
   *    `.claude/settings*.json` created or modified.
   *  - `styleName === null` clears the key, so opting in and then choosing
   *    `default` does not leave a stale value behind for the CLI to honour.
   *  - The writer already returns rather than throws; the `catch` is the
   *    belt-and-braces that keeps this method total even if that ever changes.
   *    It must never rethrow — a rethrow here would surface as a failed RPC
   *    and the frontend would roll the selection back, which is the exact
   *    outcome §4.1 forbids.
   */
  private async runParity(
    request: OutputStyleParityRequest | undefined,
    styleName: string | null,
    workspaceRoot: string | undefined,
  ): Promise<OutputStyleParityOutcome | undefined> {
    if (request === undefined || !request.enabled) return undefined;

    // G6, defensive. The schema already rejects a name containing `:`, so this
    // is unreachable today; it exists so that a future plugin tier cannot
    // silently write a `${plugin}:${style}` identifier into a settings file
    // the CLI would warn about and ignore.
    if (styleName !== null && styleName.includes(':')) {
      return {
        written: false,
        tier: request.tier,
        error: {
          code: 'IMMUTABLE',
          message:
            'A plugin-provided style cannot be mirrored into a settings file.',
        },
      };
    }

    try {
      return await this.settingsWriter.setOutputStyle({
        tier: request.tier,
        styleName,
        workspaceRoot,
      });
    } catch (error: unknown) {
      this.logger.error(
        '[OutputStyleRpc] parity write threw',
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        written: false,
        tier: request.tier,
        error: {
          code: 'WRITE_FAILED',
          message:
            'Your style is active in Ptah, but the settings file for the command line could not be updated.',
        },
      };
    }
  }

  /**
   * `outputStyle:save` — upsert, and rebind the selection when a rename moved
   * the active style's identity (Req 4.4).
   *
   * The rebind is one server-side operation because the writer reports
   * `renamedFrom` and the selection lives one layer up: the client never has to
   * issue save-then-activate and never has a window where the selection points
   * at a name that no longer exists.
   */
  private registerSave(): void {
    this.rpcHandler.registerMethod<
      OutputStyleSaveParams,
      OutputStyleSaveResult
    >('outputStyle:save', async (params) => {
      const parsed = this.parse(OutputStyleSaveParamsSchema, params);
      try {
        const result = await this.fileWriter.save({
          tier: parsed.tier,
          name: parsed.name,
          description: parsed.description,
          keepCodingInstructions: parsed.keepCodingInstructions,
          body: parsed.body,
          originalName: parsed.originalName,
          expectedMtime: parsed.expectedMtime,
          expectedByteLength: parsed.expectedByteLength,
          overwrite: parsed.overwrite,
          workspaceRoot: parsed.workspaceRoot,
        });

        if (!result.ok) return { success: false, error: result.error };

        const rebound = await this.rebindSelection(
          result.renamedFrom,
          parsed.name.trim(),
        );

        return {
          success: true,
          path: result.location.displayPath,
          rebound,
        };
      } catch (error: unknown) {
        throw this.sanitize(
          error,
          'outputStyle:save',
          'Failed to save the output style.',
        );
      }
    });
  }

  /**
   * `outputStyle:delete` — remove the file, and clear the selection when the
   * style that just went away was the active one (Req 4.6).
   *
   * Order matters: the selection is only cleared AFTER the delete succeeded.
   * Clearing first would leave a user with no style and the file still there.
   */
  private registerDelete(): void {
    this.rpcHandler.registerMethod<
      OutputStyleDeleteParams,
      OutputStyleDeleteResult
    >('outputStyle:delete', async (params) => {
      const parsed = this.parse(OutputStyleDeleteParamsSchema, params);
      try {
        const result = await this.fileWriter.delete({
          tier: parsed.tier,
          name: parsed.name,
          workspaceRoot: parsed.workspaceRoot,
        });

        if (!result.ok) {
          return { success: false, clearedActive: false, error: result.error };
        }

        const wasActive = this.readSelectedName() === parsed.name;
        if (wasActive) await this.writeSelectedName(null);

        return { success: true, clearedActive: wasActive };
      } catch (error: unknown) {
        throw this.sanitize(
          error,
          'outputStyle:delete',
          'Failed to delete the output style.',
        );
      }
    });
  }

  /**
   * `outputStyle:diagnose` — what the NEXT session would do, resolved now.
   *
   * Nothing here is cached. That is the whole point (Req 5.6): the answer
   * depends on the provider in force at the moment it is asked, and a stored
   * answer would go stale the first time a user switched provider.
   */
  private registerDiagnose(): void {
    this.rpcHandler.registerMethod<
      OutputStyleDiagnoseParams,
      OutputStyleDiagnoseResult
    >('outputStyle:diagnose', async (params) => {
      const parsed = this.parse(OutputStyleDiagnoseParamsSchema, params);
      const activeName = this.readSelectedName();

      try {
        const { styles } = await this.discovery.discover({
          workspaceRoot: parsed.workspaceRoot,
          activeName,
        });

        const winner =
          activeName === null ? null : this.winnerFor(styles, activeName);

        return {
          decision: this.decisionFor(winner),
          visibleTiers: this.visibleTiers(),
          activeName,
          activeMissing: activeName !== null && winner === null,
        };
      } catch (error: unknown) {
        throw this.sanitize(
          error,
          'outputStyle:diagnose',
          'Failed to diagnose the output-style configuration.',
        );
      }
    });
  }

  // -------------------------------------------------------------------------
  // Selection — Ptah's own settings, never a `.claude/` file.
  //
  // Every read, write and normalisation below delegates to
  // `utils/output-style-selection.ts`, which `ChatOutputStyleActivationService`
  // also calls. That is deliberate and load-bearing: this class's view of what
  // is ACTIVE drives the UI checkmark, and that service's view of what to
  // ACTIVATE drives the actual SDK call. One implementation is what stops the
  // picker from showing one style while a different one reaches the session.
  // -------------------------------------------------------------------------

  /** Dependencies the shared selection helpers need, in one place. */
  private get selectionContext(): OutputStyleSelectionContext {
    return {
      settingsStore: this.settingsStore,
      scopeResolver: this.scopeResolver,
      logger: this.logger,
      logTag: '[OutputStyleRpc]',
    };
  }

  /** The persisted selection, or `null` for "no style". */
  private readSelectedName(): string | null {
    return readOutputStyleSelection(this.selectionContext);
  }

  /** Persist the selection through the same path `readSelectedName` reads. */
  private async writeSelectedName(name: string | null): Promise<void> {
    await writeOutputStyleSelection(this.selectionContext, name);
  }

  /**
   * Req 4.4. `renamedFrom` is the writer's statement that a style's identity
   * moved; whether that mattered is a selection question, which is ours.
   */
  private async rebindSelection(
    renamedFrom: string | undefined,
    newName: string,
  ): Promise<boolean> {
    if (renamedFrom === undefined) return false;
    if (this.readSelectedName() !== renamedFrom) return false;
    await this.writeSelectedName(newName);
    return true;
  }

  /** `null` / `''` / `default` all mean "no style" (Req 2.4). */
  private normalizeSelection(name: string | null): string | null {
    return normalizeOutputStyleSelection(name);
  }

  // -------------------------------------------------------------------------
  // Activation reporting.
  // -------------------------------------------------------------------------

  /** The entry a name resolves to under the SDK merge order, or `null`. */
  private winnerFor(
    styles: readonly OutputStyleEntry[],
    name: string,
  ): OutputStyleEntry | null {
    return (
      styles.find((style) => style.name === name && style.shadowed !== true) ??
      null
    );
  }

  private decisionFor(style: OutputStyleEntry | null): ActivationDecision {
    return this.activation.resolve({
      style,
      providerBaseUrl: this.providerBaseUrl(),
    });
  }

  private providerBaseUrl(): string | undefined {
    return resolveProviderBaseUrl(this.authEnv);
  }

  /**
   * The tiers whose style FILES the current provider can see (E3).
   *
   * `builtin` is unconditional — those come from a hardcoded map inside the
   * binary, not a directory scan, so nothing can hide them. `user` is the one
   * tier a localhost-proxy provider drops. `plugin` is absent because Ptah does
   * not enumerate that tier at all (P5 deferred); reporting it as visible would
   * claim a capability the surface does not have.
   *
   * The predicate is `@ptah-extension/output-styles`'s exported
   * `LOCALHOST_BASE_URL_RE` — the same constant `OutputStyleActivationResolver`
   * decides with, and the one the resolver's spec holds byte-identical to the
   * builder's literal. This only REPORTS; it never decides.
   */
  private visibleTiers(): readonly OutputStyleTier[] {
    const localhost = LOCALHOST_BASE_URL_RE.test(this.providerBaseUrl() ?? '');
    return localhost ? ['builtin', 'project'] : ['builtin', 'user', 'project'];
  }

  // -------------------------------------------------------------------------
  // Boundary helpers — same shape as `TasksRpcHandlers`.
  // -------------------------------------------------------------------------

  /** Zod-parse or throw a structured INVALID_PARAMS user error. */
  private parse<T>(
    schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
    params: unknown,
  ): T {
    const result = schema.safeParse(params ?? {});
    if (!result.success || result.data === undefined) {
      throw new RpcUserError(
        'Invalid output-style request parameters.',
        'INVALID_PARAMS',
      );
    }
    return result.data;
  }

  /**
   * Convert an unexpected internal failure into a sanitized error. Typed user
   * errors pass through; anything else is logged server-side with its detail
   * and replaced by a generic message, so no absolute host path and no raw
   * exception text can reach a client (Req 7.6).
   */
  private sanitize(error: unknown, method: string, message: string): Error {
    if (error instanceof RpcUserError) return error;
    this.logger.error(
      `[OutputStyleRpc] ${method} failed`,
      error instanceof Error ? error : new Error(String(error)),
    );
    return new Error(message);
  }
}
