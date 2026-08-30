/**
 * DiagnosticsCacheInvalidator — the change signal `ptah_get_diagnostics` lacks.
 *
 * `TypeScriptDiagnosticsProvider` keeps a short per-root result cache because a
 * full `ts.createProgram` pass costs tens of seconds and three agents call the
 * tool in a burst at the start of a session. The cache key is the workspace
 * root, and **nothing in that key moves when a source file does** — so an agent
 * that read diagnostics, applied a fix and asked again was answered from before
 * its own edit. That loop is not an edge case: the core prompt
 * (`ptah-system-prompt.constant.ts`) tells every agent to check diagnostics
 * AFTER it changes files, so it is the documented normal path.
 *
 * The provider has carried `invalidate(root?)` since TASK_2026_325 finding 2,
 * and nothing called it. This service is the caller.
 *
 * ## Why the SDK hook, and why this lib
 *
 * The cheap change signals were all rejected upstream: the newest `mtimeMs`
 * across a monorepo's source roots costs the full walk the cache exists to
 * avoid, and the provider is handed no file watcher. But Ptah already observes
 * the writes that matter — the AGENT's own — through the SDK `PostToolUse`
 * hook, which reports the tool name and the workspace root it ran in. That is
 * a precise signal at zero polling cost.
 *
 * `workspace-intelligence` (which owns the provider) may not import
 * `agent-sdk`; its dependency set is `platform-core` / `vscode-core` /
 * `memory-contracts` / `shared`. `vscode-lm-tools` reaches both and is the lib
 * that serves `ptah_get_diagnostics`, so the subscriber lives here.
 *
 * ## Construction
 *
 * Started from `PtahAPIBuilder`'s constructor rather than from three host
 * wiring lines. `PtahAPIBuilder` is the ONLY injection site of
 * `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER` in the workspace, so the cache cannot
 * hold an entry before the builder exists — there is no path to
 * `getDiagnostics` that does not go through it. Binding the subscription to the
 * builder's lifetime therefore covers every window in which a stale answer is
 * possible, in all three hosts, with one construction site.
 */

import { inject, injectable } from 'tsyringe';
import { blankToUndefined } from '@ptah-extension/shared';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IDiagnosticsProvider,
} from '@ptah-extension/platform-core';

/**
 * Duplicated from `SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY` so this lib
 * does not take a hard dependency on `agent-sdk` to read one hook — the same
 * reason and the same shape as the four duplicated tokens in
 * `ptah-api-builder.service.ts`.
 *
 * A drifted string here would be a silent no-op, which is precisely the defect
 * this service exists to remove, so `diagnostics-cache-invalidator.service.spec.ts`
 * imports the real `SDK_TOKENS` and asserts identity against this symbol.
 *
 * @warning Keep the `Symbol.for()` string in sync with
 * `libs/backend/agent-sdk/src/lib/di/tokens.ts`.
 */
export const SDK_POST_TOOL_USE_CALLBACK_REGISTRY = Symbol.for(
  'SdkPostToolUseCallbackRegistry',
);

/** DI token for this service. Registered by `registerVsCodeLmToolsServices`. */
export const DIAGNOSTICS_CACHE_INVALIDATOR = Symbol.for(
  'PtahDiagnosticsCacheInvalidator',
);

/**
 * The two fields of `PostToolUsePayload` this service reads, declared
 * structurally so the subscription can be unit-tested without the SDK.
 */
export interface DiagnosticsInvalidationPayload {
  readonly toolName: string;
  readonly workspaceRoot: string;
}

/**
 * The one method of `PostToolUseCallbackRegistry` this service uses. `register`
 * returns a disposer, and the registry already wraps each subscriber in its own
 * try/catch — but this service never relies on that (see {@link onPostToolUse}).
 */
export interface DiagnosticsInvalidationSource {
  register(
    callback: (payload: DiagnosticsInvalidationPayload) => void,
  ): () => void;
}

/**
 * Tool names whose successful use can change what a type-check would report.
 *
 * Deliberately an allowlist rather than a denylist. `PostToolUse` fires for
 * every tool call of every session — `Read`, `Grep`, `Bash`, `WebFetch`, each
 * MCP tool — and invalidating on all of them would throw away the burst
 * collapsing the cache exists for, turning a shared compile back into one
 * compile per tool call. A denylist would also silently opt in every tool added
 * upstream in future.
 *
 * `Bash` is the deliberate omission on the other side: a `Bash` call CAN write
 * files, but most do not, and it is the single most frequent tool in a session.
 * Treating it as a write would cost a full recompile per shell command for a
 * change signal that is usually absent.
 */
const WRITING_TOOL_NAMES: ReadonlySet<string> = new Set([
  'Write',
  'Edit',
  'NotebookEdit',
]);

@injectable()
export class DiagnosticsCacheInvalidator {
  private disposer: (() => void) | null = null;

  constructor(
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,

    @inject(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER)
    private readonly diagnostics: IDiagnosticsProvider,

    /**
     * Optional: a host that binds the diagnostics tool without registering the
     * SDK (and any spec that builds a partial container) must still construct
     * the API surface. The absence is logged, never swallowed silently.
     */
    @inject(SDK_POST_TOOL_USE_CALLBACK_REGISTRY, { isOptional: true })
    private readonly postToolUse: DiagnosticsInvalidationSource | undefined,
  ) {}

  /**
   * Subscribe to the agent's writes. Idempotent — a second call while already
   * subscribed does nothing, so a host that constructs the API builder twice
   * cannot double-register on the hottest hook in the process.
   */
  start(): void {
    if (this.disposer) return;

    if (!this.postToolUse) {
      this.logger.warn(
        '[diagnostics-cache] PostToolUse registry not registered — the diagnostics result cache will not be invalidated on agent writes',
      );
      return;
    }

    // A provider with no cache has nothing to invalidate (see the docblock on
    // `IDiagnosticsProvider.invalidate`). Not subscribing at all is the point:
    // `PostToolUse` fires once per tool call per session, and arming that to
    // reach a method that does not exist is pure overhead.
    if (typeof this.diagnostics.invalidate !== 'function') {
      this.logger.debug(
        '[diagnostics-cache] provider exposes no invalidate() — nothing to keep fresh, not subscribing',
      );
      return;
    }

    this.disposer = this.postToolUse.register((payload) => {
      this.onPostToolUse(payload);
    });
    this.logger.info(
      '[diagnostics-cache] invalidating diagnostics on agent writes',
    );
  }

  /** Release the subscription. Idempotent. */
  stop(): void {
    this.disposer?.();
    this.disposer = null;
  }

  /**
   * A hook callback must never throw into the SDK. The registry does wrap
   * subscribers, but this handler owns its own catch anyway: the cost of being
   * wrong here is an agent turn killed by a cache-maintenance failure, and the
   * cost of catching is one warn line.
   */
  private onPostToolUse(payload: DiagnosticsInvalidationPayload): void {
    if (!WRITING_TOOL_NAMES.has(payload.toolName)) return;

    // A blank root drops EVERY cached root rather than none. The hook resolves
    // its cwd from the payload with a closure fallback, so a blank value means
    // "a file was written somewhere we cannot name" — and between
    // over-invalidating (one recompile) and under-invalidating (a stale clean
    // answer delivered with the confidence of a fresh one), only the first is
    // recoverable.
    const root = blankToUndefined(payload.workspaceRoot);

    try {
      this.diagnostics.invalidate?.(root);
    } catch (error: unknown) {
      this.logger.warn('[diagnostics-cache] invalidate failed', {
        toolName: payload.toolName,
        workspaceRoot: root ?? '(all roots)',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
