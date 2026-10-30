/**
 * Slash command router.
 *
 * Owns the chat:continue follow-up slash-command interception path
 * extracted from `ChatSessionService.handleFollowUpSlashCommand`. The
 * session service calls `routeFollowUpSlashCommand` and falls through to
 * regular LLM streaming when the result is null (passthrough).
 *
 * Every log message, MESSAGE_TYPES.CHAT_COMPLETE payload, and
 * `executeSlashCommand` argument shape is preserved byte-identically from
 * the pre-extraction version.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import type { ModelSettings } from '@ptah-extension/settings-core';
import {
  AuthRequiredError,
  SDK_TOKENS,
  SlashCommandInterceptor,
  type ManualCompactAdmission,
  type SessionMetadataStore,
} from '@ptah-extension/agent-sdk';
import {
  AUTH_PROVIDERS_TOKENS,
  ProviderAccountService,
  type ActiveProviderResolver,
  type WorkspaceProviderProfileResolver,
} from '@ptah-extension/auth-providers';
import type {
  IAgentAdapter,
  SessionId,
  AISessionConfig,
  ChatContinueParams,
  ChatContinueResult,
  ProviderAccountSelection,
} from '@ptah-extension/shared';
import {
  MESSAGE_TYPES,
  PROVIDER_ACCOUNT_RESULT_CODES,
  isSafeProviderAccountSummary,
} from '@ptah-extension/shared';
import { ProviderAccountSelectionSchema } from '@ptah-extension/shared/schemas';
import type { ProviderAccountPortRefusal } from '@ptah-extension/auth-providers-tokens';

import { CHAT_TOKENS } from '../tokens';
import type { ChatSdkContextService } from './chat-sdk-context.service';
import type {
  ChatStreamBroadcaster,
  WebviewManager,
} from '../streaming/chat-stream-broadcaster.service';

/** Local extension until the shared RPC schema carries account selections. */
export interface MainSessionAccountSelection {
  readonly accountSelection?: ProviderAccountSelection;
}

/** Keep account refusals out of AUTH_REQUIRED's recovery/fallback UI. */
export function mainSessionAccountFailure(error: unknown):
  { success: false; error: string; accountRefusal: ProviderAccountPortRefusal } | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return;
  const code = error.code;
  const normalized = code === 'binding-conflict' ? 'conflict'
    : code === 'linkage-incomplete' ? 'invalid-bound' : code;
  const known = PROVIDER_ACCOUNT_RESULT_CODES.find(value => value !== 'ok' && value === normalized);
  if (!known || known === 'ok') return;
  const summary = 'summary' in error && typeof error.summary === 'string' &&
    isSafeProviderAccountSummary(error.summary)
    ? error.summary : 'The session account could not be verified. The conversation was preserved.';
  return { success: false, error: summary, accountRefusal: { code: known, summary } };
}

function refuseAccount(code: ProviderAccountPortRefusal['code']): never {
  throw { code, summary: 'The session account could not be verified. The conversation was preserved.' } satisfies ProviderAccountPortRefusal;
}

/** The only selection the gate forwards: a named profile the SDK run admits. */
export type ResolvedMainAccountSelection = Extract<ProviderAccountSelection, { kind: 'named' }>;

/**
 * Pre-context gate shared by fresh, resume/rewind and slash entry points.
 * Registry lookup precedes local metadata: an index without a profile cannot
 * turn a bound SDK session into an ambient session. Defaults apply ONLY to new
 * native main sessions. No caller-supplied route or identity is accepted.
 *
 * Returns the resolved named selection the launch must carry, or `undefined`
 * for the ambient path. Admission, lease and binding belong to the SDK run
 * (`NamedAccountQueryAdmission`); the gate never reserves a route itself.
 */
export async function gateMainSessionAccount(
  dependencies: {
    accounts?: Pick<ProviderAccountService, 'selection' | 'lookupBySdkSession'>;
    activeProvider?: Pick<ActiveProviderResolver, 'resolveActiveAuthForPath'>;
    metadata: Pick<SessionMetadataStore, 'get' | 'resolveAccountBinding' | 'getAccountBound'>;
  },
  input: MainSessionAccountSelection & { workspacePath?: string; sessionId?: string },
): Promise<ResolvedMainAccountSelection | undefined> {
  const { accounts, activeProvider, metadata } = dependencies;
  let selection = input.accountSelection;
  if (selection !== undefined) {
    const parsed = ProviderAccountSelectionSchema.safeParse(selection);
    if (!parsed.success) refuseAccount('conflict');
    selection = parsed.data;
  }
  if (input.sessionId) {
    if (!accounts) {
      const local = await metadata.get(input.sessionId);
      if (local?.accountBinding || selection?.kind === 'named') refuseAccount('unavailable-storage');
      return;
    }
    const binding = await metadata.resolveAccountBinding(input.sessionId,
      sdkSessionId => accounts.lookupBySdkSession({ provider: 'claude', sdkSessionId }));
    if (!binding) {
      // A new default must never bind a legacy conversation retroactively.
      if (selection?.kind === 'named') refuseAccount('invalid-bound');
      return;
    }
    if (!await metadata.getAccountBound(input.sessionId, binding)) refuseAccount('invalid-bound');
    if (binding.provider !== 'claude') refuseAccount('wrong-provider');
    if (binding.identity.kind !== 'known') refuseAccount('identity-unproved');
    if (selection?.kind === 'ambient' ||
        (selection?.kind === 'named' && selection.profileId !== binding.profileId)) refuseAccount('conflict');
    // The run resumes with this stored binding (same runId, no second binding).
    return { kind: 'named', profileId: binding.profileId };
  } else {
    // Explicit ambient adds no account, auth, model or storage calls.
    if (selection?.kind === 'ambient') return;
    if (!accounts || !activeProvider) {
      if (selection?.kind === 'named') refuseAccount('unavailable-storage');
      return;
    }
    // This config-only read must precede model/profile/proxy resolution.
    if (activeProvider.resolveActiveAuthForPath(input.workspacePath ?? '').authMethod !== 'claudeCli') return;
    if (!selection || selection.kind === 'omitted') {
      const selected = accounts.selection(input.workspacePath ?? '', 'main');
      if (!selected.profileId) return;
      selection = { kind: 'named', profileId: selected.profileId };
    }
  }
  if (selection?.kind !== 'named') refuseAccount('unavailable-storage');
  return { kind: 'named', profileId: selection.profileId };
}

@injectable()
export class ChatSlashCommandRouterService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(SETTINGS_TOKENS.MODEL_SETTINGS)
    private readonly modelSettings: ModelSettings,
    @inject(TOKENS.AGENT_ADAPTER)
    private readonly sdkAdapter: IAgentAdapter,
    @inject(SDK_TOKENS.SDK_SLASH_COMMAND_INTERCEPTOR)
    private readonly slashCommandInterceptor: SlashCommandInterceptor,
    @inject(CHAT_TOKENS.SDK_CONTEXT)
    private readonly sdkContext: ChatSdkContextService,
    @inject(CHAT_TOKENS.STREAM_BROADCASTER)
    private readonly streamBroadcaster: ChatStreamBroadcaster,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER)
    private readonly workspaceProviderProfileResolver: WorkspaceProviderProfileResolver,
    @inject(SDK_TOKENS.SDK_COMPACTION_COORDINATOR, { isOptional: true })
    private readonly manualCompactAdmission?: ManualCompactAdmission,
    @inject(ProviderAccountService, { isOptional: true })
    private readonly accounts?: ProviderAccountService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_ACTIVE_PROVIDER_RESOLVER, { isOptional: true })
    private readonly activeProvider?: ActiveProviderResolver,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE, { isOptional: true })
    private readonly metadata?: SessionMetadataStore,
  ) {}

  /**
   * Route a follow-up slash command for an active chat session.
   *
   * Returns a structured `ChatContinueResult` if the command was intercepted
   * (native or SDK new-query), or `null` to indicate the caller should
   * proceed with normal LLM streaming.
   *
   * Extracted from `ChatSessionService.handleFollowUpSlashCommand` — every
   * log message and MESSAGE_TYPES.CHAT_COMPLETE payload is byte-identical.
   */
  async routeFollowUpSlashCommand(
    prompt: string,
    sessionId: SessionId,
    tabId: string,
    workspacePath: string | undefined,
    params: ChatContinueParams & MainSessionAccountSelection & {
      pluginConfigAncestorRoots?: readonly string[];
    },
  ): Promise<ChatContinueResult | null> {
    const interceptResult = this.slashCommandInterceptor.intercept(prompt);

    if (interceptResult.action === 'passthrough') {
      return null; // Not a slash command, caller continues with normal flow
    }

    let accountSelection: ResolvedMainAccountSelection | undefined;
    try {
      if (this.metadata) {
        accountSelection = await gateMainSessionAccount(
          { accounts: this.accounts, activeProvider: this.activeProvider, metadata: this.metadata },
          { sessionId, workspacePath, accountSelection: params.accountSelection });
      } else if (this.accounts || params.accountSelection?.kind === 'named') {
        refuseAccount('unavailable-storage');
      }
    } catch (error: unknown) {
      const refusal = mainSessionAccountFailure(error);
      if (!refusal) throw error;
      this.logger.warn('[RPC] slash account admission refused', { code: refusal.accountRefusal.code });
      return { ...refusal, sessionId };
    }

    if (interceptResult.action === 'native') {
      this.logger.info('[RPC] chat:continue - native command intercepted', {
        command: interceptResult.commandName,
        sessionId,
      });

      if (interceptResult.commandName === 'clear') {
        await this.sdkAdapter.interruptSession(sessionId);

        await this.webviewManager.broadcastMessage(
          MESSAGE_TYPES.CHAT_COMPLETE,
          {
            tabId,
            sessionId,
            command: 'clear',
            message:
              'Conversation cleared. Start a new message to begin fresh.',
          },
        );
        return { success: true, sessionId };
      }
      this.logger.warn('[RPC] chat:continue - unrecognized native command', {
        command: interceptResult.commandName,
        sessionId,
      });
      return { success: true, sessionId };
    }

    if (interceptResult.action === 'new-query') {
      this.logger.info(
        '[RPC] chat:continue - SDK slash command intercepted, starting new query',
        {
          command: interceptResult.rawCommand,
          sessionId,
        },
      );
      if (
        interceptResult.commandName === 'compact' &&
        this.manualCompactAdmission
      ) {
        try {
          const decision =
            this.manualCompactAdmission.requestManualCompact(sessionId);
          if (decision.action !== 'send') {
            this.logger.info(
              '[RPC] chat:continue - manual compact admitted without send',
              {
                sessionId,
                decision: decision.action,
              },
            );
            return { success: true, sessionId, settled: true };
          }
        } catch (error) {
          this.logger.warn(
            '[RPC] chat:continue - manual compact admission failed',
            {
              sessionId,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }
      const mcpServerRunning = this.sdkContext.isMcpServerRunning();
      const enhancedPromptsContent =
        await this.sdkContext.resolveEnhancedPromptsContent(workspacePath);
      const command = interceptResult.rawCommand ?? prompt;
      const model =
        params.model ||
        this.workspaceProviderProfileResolver.resolveStoredModel(
          workspacePath ?? '',
          this.modelSettings.selectedModel.get(),
        );
      let reservationId: string | undefined;
      try {
        // The relaunch is a new query: it gets the same per-workspace provider
        // snapshot as chat:start / resume, never whatever the shared auth env
        // was last configured for (AuthRequiredError on a mismatch).
        const providerProfile =
          await this.workspaceProviderProfileResolver.resolveProviderProfileForWorkspace(
            workspacePath ?? '',
            model,
          );
        if (
          interceptResult.commandName === 'compact' &&
          this.manualCompactAdmission
        ) {
          try {
            const admission =
              this.manualCompactAdmission.admitManualCompact(sessionId);
            if (admission.decision.action !== 'send') {
              this.logger.info(
                '[RPC] chat:continue - manual compact admitted without send',
                {
                  sessionId,
                  decision: admission.decision.action,
                },
              );
              return { success: true, sessionId, settled: true };
            }
            reservationId = admission.reservationId;
          } catch (error) {
            this.logger.warn(
              '[RPC] chat:continue - manual compact admission failed',
              {
                sessionId,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        }
        const stream = await this.sdkAdapter.executeSlashCommand(
          sessionId,
          command,
          {
            sessionConfig: {
              model,
              projectPath: workspacePath,
              ...(params.pluginConfigAncestorRoots !== undefined
                ? { pluginConfigAncestorRoots: params.pluginConfigAncestorRoots }
                : {}),
              ...(params.mcpToolProfile
                ? { mcpToolProfile: params.mcpToolProfile }
                : {}),
              ...(params.ptahUiFence !== undefined
                ? { ptahUiFence: params.ptahUiFence }
                : {}),
              ...(params.systemPrompt
                ? { systemPrompt: params.systemPrompt }
                : {}),
            } as AISessionConfig,
            mcpServerRunning,
            enhancedPromptsContent,
            tabId,
            providerProfile,
            // Named only: the relaunch resumes on the session's stored binding.
            ...(accountSelection ? { accountSelection } : {}),
          },
        );
        this.streamBroadcaster.streamEventsToWebview(sessionId, stream, tabId);

        return { success: true, sessionId };
      } catch (slashError) {
        // A named relaunch's refusal keeps its typed code, not AUTH_REQUIRED.
        const refusal = mainSessionAccountFailure(slashError);
        if (refusal) {
          this.logger.warn('[RPC] slash account admission refused', { code: refusal.accountRefusal.code });
          return { ...refusal, sessionId };
        }
        const message =
          slashError instanceof Error ? slashError.message : String(slashError);
        this.logger.warn(
          '[RPC] chat:continue - executeSlashCommand rejected by runtime',
          { sessionId, command, error: message },
        );
        const result: ChatContinueResult = {
          success: false,
          sessionId,
          error: message,
          ...(slashError instanceof AuthRequiredError
            ? {
                errorCode: 'AUTH_REQUIRED' as const,
                ...(slashError.providerId
                  ? { providerId: slashError.providerId }
                  : {}),
              }
            : {}),
        };
        return result;
      } finally {
        if (reservationId !== undefined && this.manualCompactAdmission) {
          try {
            this.manualCompactAdmission.releaseManualReservation(
              sessionId,
              reservationId,
            );
          } catch (error) {
            this.logger.warn(
              '[RPC] chat:continue - manual compact release failed',
              {
                sessionId,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        }
      }
    }

    return null;
  }
}
