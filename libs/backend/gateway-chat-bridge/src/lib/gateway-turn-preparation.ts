/**
 * Bound-session identity and the pre-session preparation for one gateway turn.
 *
 * Constructed by `GatewayChatBridge` from dependencies it already injects.
 * No DI token of its own. Not part of the lib's public entry.
 */
import type { Logger } from '@ptah-extension/vscode-core';
import type { CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';
import type { EnhancedPromptsService } from '@ptah-extension/agent-generation';
import type { WorkspaceProviderProfileResolver } from '@ptah-extension/auth-providers';
import {
  legacyClaudeSessionRuntimeIdentity,
  resolveSessionRuntimeIdentity,
  type SessionRuntimeIdentityLookup,
} from '@ptah-extension/agent-sdk';
import {
  SessionId,
  type ProviderProfile,
  type RuntimeHostCapabilities,
  type SessionRuntimeIdentity,
} from '@ptah-extension/shared';

/**
 * Session context resolved once per turn and threaded into the start/resume
 * config so gateway sessions reach parity with the webview chat path
 * (enhanced prompts, plugins, code-exec MCP).
 */
export interface SdkSessionContext {
  mcpServerRunning: boolean;
  enhancedPromptsContent?: string;
}

/**
 * Provider a turn runs against, resolved once per turn for the turn's
 * workspace — the same per-workspace snapshot the webview chat path passes —
 * so a gateway session never rides the process-wide AuthEnv when another
 * workspace's provider is the active one. `providerProfile` is `undefined`
 * when the shared AuthEnv already serves this workspace's provider, and for
 * every native Codex turn (no translation proxy).
 */
export interface TurnProvider {
  model: string;
  providerProfile: ProviderProfile | undefined;
  runtime: 'claude-sdk' | 'codex-app-server';
}

/** Result of a turn's pre-session preparation (see `prepareTurn`). */
export interface TurnPreparation {
  sdkContext: SdkSessionContext;
  provider: TurnProvider;
}

export type BoundSessionIdentityResult =
  | { readonly ok: true; readonly identity?: SessionRuntimeIdentity }
  | { readonly ok: false; readonly error: Error };

/**
 * The slice of the bridge's injected services this preparation uses.
 * Structural so the bridge can pass the instances it already holds.
 */
export interface GatewayTurnPreparationDeps {
  readonly logger: Pick<Logger, 'debug' | 'warn'>;
  readonly codeExecutionMcp: Pick<
    CodeExecutionMCP,
    'getPort' | 'ensureRegisteredForSubagents'
  >;
  readonly enhancedPrompts: Pick<
    EnhancedPromptsService,
    'getEnhancedPromptContent'
  >;
  readonly profileResolver: Pick<
    WorkspaceProviderProfileResolver,
    'resolveExecutionProfile' | 'resolveStoredModel'
  >;
  /** Stored model for the active provider, read at prepare time. */
  readonly readSelectedModel: () => string;
  readonly hostCapabilities: RuntimeHostCapabilities;
  readonly sessionIdentities?: SessionRuntimeIdentityLookup;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class GatewayTurnPreparation {
  constructor(private readonly deps: GatewayTurnPreparationDeps) {}

  /**
   * Runtime view for this turn. An absent or empty binding carries no identity
   * (new-session profile; legacy fallback stays available). A non-empty id that
   * is not a `SessionId` is an existing binding, not a fresh conversation: the
   * turn fails closed and the binding is left unchanged. A present lookup that
   * returns no metadata is a legacy Claude session. A throw fails the turn; an
   * absent lookup service stays on the legacy Claude identity.
   */
  readBoundSessionIdentity(
    sessionId: string | null | undefined,
    workspaceRoot: string,
  ): BoundSessionIdentityResult {
    if (
      sessionId === null ||
      sessionId === undefined ||
      sessionId.length === 0
    ) {
      return { ok: true };
    }
    if (!SessionId.validate(sessionId)) {
      return {
        ok: false,
        error: new Error('Bound gateway session id is not a valid session id'),
      };
    }
    const id = SessionId.from(sessionId);
    if (this.deps.sessionIdentities === undefined) {
      return {
        ok: true,
        identity: legacyClaudeSessionRuntimeIdentity({
          sessionId: id,
          workspaceId: workspaceRoot,
        }),
      };
    }
    try {
      const stored = resolveSessionRuntimeIdentity(
        this.deps.sessionIdentities,
        id,
      );
      return {
        ok: true,
        identity:
          stored ??
          legacyClaudeSessionRuntimeIdentity({
            sessionId: id,
            workspaceId: workspaceRoot,
          }),
      };
    } catch (error: unknown) {
      return { ok: false, error: asError(error) };
    }
  }

  /**
   * Everything a turn needs before its session starts. The provider profile
   * is resolved here, ONCE, and deliberately outside `resolveSdkContext`'s
   * degrade-to-defaults guards: a workspace whose provider cannot be served
   * must fail the turn closed, never silently run on whichever provider the
   * shared AuthEnv happens to hold.
   *
   * `existingIdentity` is set only for a bound session. Omitting it is the
   * new-session branch; a legacy Claude binding still passes an identity so
   * the resolver cannot start a native session for that thread.
   */
  async prepareTurn(
    workspaceRoot: string,
    existingIdentity?: SessionRuntimeIdentity,
  ): Promise<TurnPreparation> {
    const sdkContext = await this.resolveSdkContext(workspaceRoot);
    const requestedModel = this.resolveModel(workspaceRoot);
    const decision = await this.deps.profileResolver.resolveExecutionProfile({
      workspacePath: workspaceRoot,
      requestedModel,
      consumer: 'gateway',
      hostCapabilities: this.deps.hostCapabilities,
      ...(existingIdentity ? { existingIdentity } : {}),
    });
    if (decision.runtime === 'codex-app-server') {
      return {
        sdkContext,
        provider: {
          model: decision.seed.model,
          providerProfile: undefined,
          runtime: 'codex-app-server',
        },
      };
    }
    return {
      sdkContext,
      provider: {
        model: decision.model,
        providerProfile: decision.providerProfile,
        runtime: 'claude-sdk',
      },
    };
  }

  /**
   * Resolve the session context for a turn, mirroring the webview chat path
   * (`ChatSessionService` + `ChatSdkContextService`). Every external call
   * is guarded so a prompt/plugin/MCP failure degrades to safe defaults
   * rather than breaking the turn.
   */
  private async resolveSdkContext(
    workspaceRoot: string,
  ): Promise<SdkSessionContext> {
    let mcpServerRunning = false;
    try {
      mcpServerRunning = this.deps.codeExecutionMcp.getPort() !== null;
      if (mcpServerRunning) {
        // Awaited: the turn's session starts once this context resolves, and
        // its subagents read `.mcp.json` (TASK_2026_318).
        //
        // The RESULT is read, not just awaited (TASK_2026_332). The catch below
        // was written believing a failed write would reject through to it, and
        // it never did: both mutation helpers absorbed every failure into a
        // warn and resolved normally, so `mcpServerRunning` stayed `true` from
        // the `getPort()` line above while the entry a subagent reads did not
        // exist. The call now reports its outcome instead, and that outcome is
        // what decides the flag.
        const registration =
          await this.deps.codeExecutionMcp.ensureRegisteredForSubagents();
        mcpServerRunning = registration.registered;
        if (!registration.registered) {
          this.deps.logger.warn(
            '[gateway-chat-bridge] MCP running but .mcp.json entry absent — subagents get no Ptah tools this turn',
            { reason: registration.reason },
          );
        }
      }
    } catch (error: unknown) {
      mcpServerRunning = false;
      this.deps.logger.debug(
        '[gateway-chat-bridge] MCP availability check failed',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }

    let enhancedPromptsContent: string | undefined;
    try {
      enhancedPromptsContent =
        (await this.deps.enhancedPrompts.getEnhancedPromptContent(
          workspaceRoot,
        )) ?? undefined;
    } catch (error: unknown) {
      this.deps.logger.debug(
        '[gateway-chat-bridge] enhanced prompt resolution failed',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }

    return { mcpServerRunning, enhancedPromptsContent };
  }

  private resolveModel(workspaceRoot: string): string {
    return this.deps.profileResolver.resolveStoredModel(
      workspaceRoot,
      this.deps.readSelectedModel(),
    );
  }
}
