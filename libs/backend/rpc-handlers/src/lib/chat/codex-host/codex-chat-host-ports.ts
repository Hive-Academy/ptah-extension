import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  PTAH_MCP_PORT,
  PTAH_UI_HINT_CODEX,
  UNROUTABLE_PERMISSION_TIMEOUT_MS,
  buildSystemAbortPermissionMessage,
  presentCodexApproval,
} from '@ptah-extension/agent-sdk';
import type {
  CodexChatAdapterPorts,
  HostAttentionCoordinator,
  PermissionPromptLifecycleEvent,
  RuntimeAdmissionPort,
} from '@ptah-extension/agent-sdk';
import type { WorkspaceProviderProfileResolver } from '@ptah-extension/auth-providers';
import {
  buildCodexExecutionProfile,
  CODEX_PTAH_TOOL_TIMEOUT_SEC,
  normalizeCodexWorkspaceKey,
  ptahMcpSessionUrl,
  type CodexExecutionProfileInput,
  type CodexMcpServer,
  type CodexThreadIdentity,
  type CodexApprovalRequest,
} from '@ptah-extension/codex-runtime';
import type {
  IWorkspaceProvider,
  IPlatformInfo,
} from '@ptah-extension/platform-core';
import {
  MESSAGE_TYPES,
  TabId,
  attentionRequestKey,
  type McpHttpServerOverride,
  type PermissionRequest,
  type PermissionResponse,
  type PermissionLevel,
  type RuntimeHostCapabilities,
  type SessionId,
} from '@ptah-extension/shared';
import { ChatRuntimeProfileService } from '../session/chat-runtime-profile.service';
import {
  classifyCodexChatOptions,
  CodexChatOptionError,
} from './codex-chat-profile-options';
import type {
  ChatStreamBroadcaster,
  WebviewManager,
} from '../streaming/chat-stream-broadcaster.service';

export interface CodexRuntimeAdmissionDeps {
  resolver: Pick<WorkspaceProviderProfileResolver, 'resolveExecutionProfile'>;
  workspaceProvider: IWorkspaceProvider;
  platformInfo: Pick<IPlatformInfo, 'extensionPath' | 'globalStoragePath'>;
  hostCapabilities: RuntimeHostCapabilities;
  webviewManager: Pick<WebviewManager, 'broadcastMessage'>;
}

export interface CodexChatHostPortsDeps
  extends
    CodexRuntimeAdmissionDeps,
    Pick<
      CodexChatAdapterPorts,
      | 'logger'
      | 'platform'
      | 'info'
      | 'createScope'
      | 'metadata'
      | 'approvals'
      | 'callbacks'
    > {
  /** Resolve by chat session id; the runtime identity store itself is keyed by context id. */
  readResumeIdentity(
    sessionId: SessionId,
  ): Promise<CodexThreadIdentity | undefined>;
  readSavedPermissionLevel(workspacePath: string): PermissionLevel;
  broadcaster: Pick<ChatStreamBroadcaster, 'streamEventsToWebview'>;
  tabId(sessionId: SessionId): string;
  /** Releases the host notice the webview attention observer raised for a request. */
  hostAttention?: Pick<HostAttentionCoordinator, 'resolve'>;
  /**
   * Gateway notices. Electron binds this to
   * `SdkPermissionHandler.publishPromptLifecycle`; other hosts may omit it.
   */
  promptLifecycle?: {
    publish(event: PermissionPromptLifecycleEvent): void;
  };
}

export interface CodexChatHostPorts extends CodexChatAdapterPorts {
  /** Host permission bridge must try this before the Claude permission handler. */
  handlePermissionResponse(response: PermissionResponse): boolean;
}

/** Ptah MCP is running but the chat has neither a tab id nor a session id to route by. */
export class CodexChatRoutingError extends Error {
  readonly code = 'ptah-mcp-routing-id-missing';

  constructor() {
    super(
      'Codex chat cannot attach Ptah MCP: no tab id or session id to route the session by.',
    );
    this.name = 'CodexChatRoutingError';
  }
}

/** Two user MCP servers map to the same Codex server name; the message names originals only. */
export class CodexChatMcpServerNameError extends Error {
  readonly code = 'codex-mcp-server-name-collision';

  constructor(readonly serverNames: readonly string[]) {
    super(
      `Codex chat cannot attach MCP servers ${serverNames.map((name) => `"${name}"`).join(', ')}: their names map to the same Codex server name.`,
    );
    this.name = 'CodexChatMcpServerNameError';
  }
}

/** A user MCP server URL is not a valid http(s) URL; the message names the server only. */
export class CodexChatMcpServerUrlError extends Error {
  readonly code = 'codex-mcp-server-url-invalid';

  constructor(readonly serverName: string) {
    super(
      `Codex chat cannot attach MCP server "${serverName}": its URL is not a valid http(s) URL.`,
    );
    this.name = 'CodexChatMcpServerUrlError';
  }
}

/**
 * Claude's system-abort text, with the unroutable timer's internal reason.
 * Decline carries it; cancel does not.
 */
function unroutableSystemAbortReason(toolName: string, timeoutMs: number): string {
  return buildSystemAbortPermissionMessage(
    toolName,
    `Permission request timed out after ${timeoutMs}ms with no answer from the UI — denying to prevent a permanent hang.`,
  );
}

/** `consumer` selects the gate. It is not a Codex thread option, so classification must not reject it. */
function withoutRuntimeConsumer<T extends { readonly consumer?: 'chat' | 'gateway' }>(
  config: T,
): Omit<T, 'consumer'> {
  if (config.consumer === undefined) return config;
  const { consumer: _consumer, ...options } = config;
  return options;
}

type CodexHttpMcpServer = Extract<CodexMcpServer, { readonly transport: 'http' | 'sse' }>;

interface CodexUserMcpServers {
  readonly servers: readonly CodexHttpMcpServer[];
  readonly secrets: ReadonlyMap<string, string>;
}

/**
 * Map the user's MCP servers (Smithery, OAuth, caller overrides) to Codex http
 * servers. The profile keeps references only; every header value and any URL
 * that carries a query, userinfo or hash travels in the returned secrets.
 */
function userMcpServers(
  overrides: Readonly<Record<string, McpHttpServerOverride>> | undefined,
): CodexUserMcpServers {
  const servers: CodexHttpMcpServer[] = [];
  const secrets = new Map<string, string>();
  const originals = new Map<string, string>();
  for (const [original, override] of Object.entries(overrides ?? {})) {
    // Codex applies server names as dotted config keys (OAuth keys carry dots).
    const name = original.replace(/[^A-Za-z0-9_-]/g, '_');
    const previous = originals.get(name);
    if (previous !== undefined)
      throw new CodexChatMcpServerNameError([previous, original].sort());
    originals.set(name, original);
    let parsed: URL;
    try {
      parsed = new URL(override.url);
    } catch {
      // The parser's message may echo the URL; name the server only.
      throw new CodexChatMcpServerUrlError(original);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      throw new CodexChatMcpServerUrlError(original);
    const secretUrl =
      parsed.search !== '' ||
      parsed.hash !== '' ||
      parsed.username !== '' ||
      parsed.password !== '';
    let urlReference: string | undefined;
    if (secretUrl) {
      urlReference = `mcp.${name}.url`;
      secrets.set(urlReference, override.url);
    }
    const headerReferences: Record<string, string> = {};
    Object.entries(override.headers ?? {}).forEach(([header, value], index) => {
      // An empty header carries nothing and the runtime refuses empty secrets.
      if (value === '') return;
      const reference = `mcp.${name}.header.${index}`;
      headerReferences[header] = reference;
      secrets.set(reference, value);
    });
    servers.push({
      name,
      transport: 'http',
      url: secretUrl ? `${parsed.origin}${parsed.pathname}` : override.url,
      ...(urlReference !== undefined ? { urlReference } : {}),
      headerReferences,
    });
  }
  return { servers, secrets };
}

function profiles(deps: CodexRuntimeAdmissionDeps) {
  return new ChatRuntimeProfileService(
    deps.resolver,
    deps.workspaceProvider,
    deps.platformInfo,
    deps.webviewManager,
    deps.hostCapabilities,
  );
}

export function createCodexRuntimeAdmission(
  deps: CodexRuntimeAdmissionDeps,
): RuntimeAdmissionPort {
  const service = profiles(deps);
  return {
    servingProviderId: async (config) => {
      const execution = await service.prepare(config);
      return execution.runtime === 'codex-app-server'
        ? execution.seed.providerId
        : execution.providerProfile?.providerId;
    },
  };
}

export function createCodexChatHostPorts(
  deps: CodexChatHostPortsDeps,
): CodexChatHostPorts {
  const service = profiles(deps);
  type PromptOutcome = 'allowed' | 'denied' | 'timed-out' | 'aborted';
  interface PendingPrompt {
    sessionId: SessionId;
    request: CodexApprovalRequest;
    timestamp: number;
    correlationKey: string;
    promptTimer?: ReturnType<typeof setTimeout>;
    unroutable?: {
      readonly routingHint: string;
      readonly toolName: string;
      readonly timeoutMs: number;
    };
  }
  const pending = new Map<string, PendingPrompt>();
  const wireIds = new Map<string, string>();
  const failed = (reason: unknown) => {
    deps.logger.error(
      'Codex chat presentation failed.',
      reason instanceof Error ? reason : new Error(String(reason)),
    );
  };
  const send = (type: string, payload: unknown) => {
    void deps.webviewManager.broadcastMessage(type, payload).catch(failed);
  };
  // Every terminal path of an approval releases its host notice with the kind
  // and generation (payload timestamp) the attention observer claimed it under.
  const release = (id: string, timestamp: number) =>
    deps.hostAttention?.resolve(
      attentionRequestKey('permission', id),
      timestamp,
    );
  const clearPromptTimer = (entry: PendingPrompt) => {
    if (entry.promptTimer === undefined) return;
    clearTimeout(entry.promptTimer);
    entry.promptTimer = undefined;
  };
  // A publisher is an external listener. Its throw must not skip the native
  // reply or the timer, matching SdkPermissionHandler.emitLifecycle.
  const publishLifecycle = (event: PermissionPromptLifecycleEvent): void => {
    try {
      deps.promptLifecycle?.publish(event);
    } catch (error: unknown) {
      deps.logger.warn('Codex prompt lifecycle listener threw.', {
        code: 'prompt-lifecycle-listener-threw',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const publishResolved = (
    id: string,
    entry: PendingPrompt,
    outcome: PromptOutcome,
  ) => {
    if (!entry.unroutable) return;
    publishLifecycle({
      phase: 'resolved',
      requestId: id,
      routingHint: entry.unroutable.routingHint,
      toolName: entry.unroutable.toolName,
      outcome,
    });
  };
  // Remove the pending entry and clear its timer before any native reply or
  // `resolved` event, so a reentrant publisher cannot answer twice.
  const takePrompt = (id: string): PendingPrompt | undefined => {
    const entry = pending.get(id);
    if (!entry) return undefined;
    clearPromptTimer(entry);
    pending.delete(id);
    wireIds.delete(entry.correlationKey);
    release(id, entry.timestamp);
    return entry;
  };
  const declineApproval = (entry: PendingPrompt, reason?: string) => {
    const { sessionId, request } = entry;
    try {
      deps.approvals.respond(
        {
          sessionId,
          threadId: request.threadId,
          requestId: String(request.requestId),
        },
        {
          kind: 'codex',
          response: {
            sessionId,
            contextId: request.contextId,
            processGeneration: request.processGeneration,
            threadId: request.threadId,
            turnId: request.turnId,
            requestId: request.requestId,
            decision: 'decline',
            ...(reason === undefined ? {} : { reason }),
          },
        },
      );
    } catch {
      // degradation-audit: reported - coded warning omits request contents.
      deps.logger.warn('Codex approval delivery decline failed.', {
        code: 'approval-delivery-decline-failed',
      });
    }
  };
  // Keep native correlation separate from the renderer's UUID wire identity.
  const key = (sessionId: SessionId, request: CodexApprovalRequest) =>
    JSON.stringify([
      sessionId,
      request.contextId,
      request.processGeneration,
      request.threadId,
      request.turnId,
      request.requestId,
    ]);
  return {
    logger: deps.logger,
    platform: deps.platform,
    info: deps.info,
    createScope: deps.createScope,
    metadata: deps.metadata,
    approvals: deps.approvals,
    callbacks: (id, turn) => deps.callbacks(id, turn),
    checkOptions(config) {
      const { rejected } = classifyCodexChatOptions(withoutRuntimeConsumer(config));
      if (rejected.length > 0) throw new CodexChatOptionError(rejected[0]);
      // Classification strips ambient inputs; active turns consume only the prompt.
      // Profile notices belong to session preparation and must not repeat per turn.
    },
    async profile(input, sessionId) {
      const consumer = input.consumer ?? 'chat';
      const { supported: config, rejected, stripped } = classifyCodexChatOptions(
        withoutRuntimeConsumer(input),
      );
      const attachPtahMcp = input.mcpServerRunning === true;
      if (stripped.includes('thinking')) {
        deps.logger.info('Thinking is not applied to Codex chat; Codex uses native effort.', {
          code: 'codex-thinking-not-applied',
        });
      }
      if (stripped.includes('outputStyleName')) {
        deps.logger.info('Output style by name is not applied to Codex chat.', {
          code: 'codex-output-style-not-applied',
        });
      }
      if (rejected.length > 0) throw new CodexChatOptionError(rejected[0]);
      // Claude main-chat parity: the session segment carries the tab id when
      // present, else the session id; never attach Ptah MCP anonymously.
      const routingId =
        typeof input.tabId === 'string' && input.tabId.trim() !== ''
          ? input.tabId
          : sessionId;
      if (attachPtahMcp && !routingId) throw new CodexChatRoutingError();
      // Map before any resolution so a bad server fails fast, like a rejected option.
      const user = userMcpServers(
        'mcpServersOverride' in input ? input.mcpServersOverride : undefined,
      );
      if (user.servers.length > 0) {
        // Names and transports only; URLs and headers may carry secrets.
        // "Configured" is not reachability: nothing has connected yet.
        deps.logger.info('User MCP servers are configured for Codex chat.', {
          code: 'codex-user-mcp-configured',
          serverNames: user.servers.map((server) => server.name).sort(),
          transports: [...new Set(user.servers.map((server) => server.transport))],
        });
      }
      const resume = sessionId
        ? await deps.readResumeIdentity(sessionId)
        : undefined;
      if (sessionId && !resume)
        throw new Error('Native resume identity unavailable');
      if (resume && resume.threadId !== sessionId)
        throw new Error('Native resume identity mismatch');
      const identity =
        resume && sessionId
          ? {
              version: 1 as const,
              sessionId,
              runtime: 'codex-app-server' as const,
              providerId: resume.providerId,
              workspaceId: resume.workspaceId,
              codex: { normalizedHome: resume.normalizedHome },
            }
          : undefined;
      const execution = await service.prepare(
        input.consumer === undefined ? config : { ...config, consumer },
        identity,
      );
      if (execution.runtime !== 'codex-app-server')
        throw new Error('Native provider required');
      const { seed, cwd, workspacePath } = execution;
      const mcpServers = new Map<string, CodexHttpMcpServer>();
      // Claude `mergeMcpOverride` parity: a user server named `ptah` wins,
      // so the session URL is recorded only when that entry survives.
      const ptahSessionUrl =
        attachPtahMcp && routingId
          ? ptahMcpSessionUrl(PTAH_MCP_PORT, routingId, cwd)
          : undefined;
      if (ptahSessionUrl) {
        mcpServers.set('ptah', {
          name: 'ptah',
          transport: 'http',
          // Live binding: read the port the host bound at open time.
          url: ptahSessionUrl,
          headerReferences: {},
          toolTimeoutSec: CODEX_PTAH_TOOL_TIMEOUT_SEC,
        });
      }
      for (const server of user.servers) mcpServers.set(server.name, server);
      if (ptahSessionUrl && mcpServers.get('ptah')?.url === ptahSessionUrl) {
        // Once per open (profile runs at open, not per turn). Pathname only:
        // host, port, userinfo, query and hash can carry secrets; routing ids
        // in the path are the session address and are allowed.
        deps.logger.info('Ptah MCP is attached to Codex chat.', {
          code: 'ptah-mcp-attached',
          path: new URL(ptahSessionUrl).pathname,
        });
      }
      const entries: CodexExecutionProfileInput['paths']['entries'] = {};
      const paths = [
        cwd,
        seed.home,
        ...('files' in config ? (config.files ?? []) : []),
      ];
      for (const path of paths) {
        const absolute = resolve(cwd, path);
        try {
          const [info, canonical] = await Promise.all([
            stat(absolute),
            realpath(absolute),
          ]);
          entries[absolute] = {
            kind: info.isDirectory() ? 'directory' : 'file',
            realpath: canonical,
          };
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !('code' in error) ||
            error.code !== 'ENOENT'
          )
            throw error;
          entries[absolute] = { kind: 'missing' };
        }
      }
      const profileInput: CodexExecutionProfileInput = {
        paths: {
          platform: process.platform === 'win32' ? 'win32' : 'posix',
          baseDirectory: cwd,
          entries,
        },
        session: {
          contextId: resume?.contextId ?? randomUUID(),
          consumer,
          normalizedHome: seed.home,
          providerId: seed.providerId,
          workspaceId: workspacePath,
          cwd,
          model: seed.model,
          effort: config.effort,
          permissionLevel: config.permissionLevel ?? deps.readSavedPermissionLevel(workspacePath),
          systemPrompt: config.systemPrompt,
          enhancedPrompt: config.enhancedPromptsContent,
          outputStyle: config.outputStyleBody,
          attachments: [
            ...('files' in config ? (config.files ?? []) : []).map((path) => ({
              type: 'file' as const,
              path,
            })),
            ...('images' in config ? (config.images ?? []) : []).map(
              (image) => ({ type: 'image' as const, ...image }),
            ),
          ],
          ...(mcpServers.size > 0 ? { mcpServers: [...mcpServers.values()] } : {}),
        },
      };
      let developerPrompt = profileInput.session.developerPrompt;
      if (
        config.ptahUiFence === true &&
        (config.mcpToolProfile ?? 'coding') === 'coding'
      ) {
        developerPrompt = [
          developerPrompt,
          PTAH_UI_HINT_CODEX,
        ].filter((part) => part !== undefined).join('\n\n');
      }
      const profile = buildCodexExecutionProfile({
        ...profileInput,
        session: { ...profileInput.session, developerPrompt },
      });
      if (
        resume &&
        (resume.normalizedHome !== profile.normalizedHome ||
          normalizeCodexWorkspaceKey(resume.workspaceId, process.platform) !==
            normalizeCodexWorkspaceKey(profile.workspaceId, process.platform) ||
          resume.providerId !== profile.providerId)
      )
        throw new Error('Native resume identity mismatch');
      return user.secrets.size > 0
        ? { profile, resume, secrets: user.secrets }
        : { profile, resume };
    },
    presentation: {
      present(sessionId, request) {
        const correlationKey = key(sessionId, request);
        const previousId = wireIds.get(correlationKey);
        if (previousId) {
          const previous = takePrompt(previousId);
          if (previous) publishResolved(previousId, previous, 'aborted');
        }
        const id = randomUUID();
        const timestamp = Date.now();
        const tabId = deps.tabId(sessionId);
        const routable = TabId.safeParse(tabId) !== null;
        const presented = presentCodexApproval(request);
        const windowEnd = timestamp + UNROUTABLE_PERMISSION_TIMEOUT_MS;
        const boundedAt =
          request.expiresAt === undefined
            ? windowEnd
            : Math.min(request.expiresAt, windowEnd);
        const timeoutMs = Math.max(0, boundedAt - timestamp);
        const entry: PendingPrompt = {
          sessionId,
          request,
          timestamp,
          correlationKey,
          ...(routable
            ? {}
            : {
                unroutable: {
                  routingHint: tabId,
                  toolName: presented.toolName,
                  timeoutMs,
                },
              }),
        };
        pending.set(id, entry);
        wireIds.set(correlationKey, id);
        const payload: PermissionRequest = routable
          ? {
              id,
              sessionId,
              ...(tabId === sessionId ? {} : { tabId }),
              ...presented,
              toolUseId: request.toolId,
              timestamp,
              timeoutAt: request.expiresAt ?? 0,
            }
          : {
              id,
              ...presented,
              toolUseId: request.toolId,
              timestamp,
              timeoutAt: boundedAt,
            };
        if (!routable) {
          publishLifecycle({
            phase: 'requested',
            requestId: id,
            routingHint: tabId,
            toolName: presented.toolName,
            description: presented.description,
            routable: false,
            timeoutMs,
          });
          // A publisher that answered inside `requested` already took the entry.
          // Skip the card; the wire id is already settled and cannot be answered.
          if (!pending.has(id)) return;
          entry.promptTimer = setTimeout(() => {
            const current = takePrompt(id);
            if (!current?.unroutable) return;
            const reason = unroutableSystemAbortReason(
              current.unroutable.toolName,
              current.unroutable.timeoutMs,
            );
            declineApproval(current, reason);
            publishResolved(id, current, 'timed-out');
          }, timeoutMs);
        }
        // Direct manager call: its attention observer raises the host notice.
        void deps.webviewManager
          .broadcastMessage(MESSAGE_TYPES.PERMISSION_REQUEST, payload)
          .catch((error: unknown) => {
            failed(error);
            const current = pending.get(id);
            if (current?.request !== request) return;
            const taken = takePrompt(id);
            if (!taken) return;
            declineApproval(taken);
            publishResolved(id, taken, 'denied');
          });
      },
      dismiss(sessionId, request) {
        const id = wireIds.get(key(sessionId, request));
        if (!id) return;
        const entry = takePrompt(id);
        if (!entry) return;
        send(MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED, {
          id,
          sessionId,
          toolName: request.toolName ?? request.kind,
        });
        publishResolved(id, entry, 'aborted');
      },
      cancelPrompt(payload) {
        for (const [id, entry] of [...pending]) {
          if (
            entry.sessionId === payload.sessionId &&
            String(entry.request.requestId) === payload.requestId
          ) {
            const taken = takePrompt(id);
            if (!taken) continue;
            send(MESSAGE_TYPES.PERMISSION_PROMPT_CANCELLED, {
              ...payload,
              requestId: id,
            });
            publishResolved(id, taken, 'aborted');
          }
        }
      },
    },
    handlePermissionResponse(response) {
      const entry = pending.get(response.id);
      if (!entry) return false;
      const outcome: PromptOutcome =
        response.decision === 'allow' || response.decision === 'always_allow'
          ? 'allowed'
          : 'denied';
      const taken = takePrompt(response.id);
      if (!taken) return false;
      const { sessionId, request } = taken;
      const decision = {
        allow: 'accept',
        always_allow: 'acceptForSession',
        deny_with_message: 'decline',
        deny: 'cancel',
      } as const;
      // Claude sends PERMISSION_AUTO_RESOLVED for sibling prompts an Always
      // Allow rule clears, never for the request the user just answered
      // (sdk-permission-handler.ts handleResponse). The sink's respond
      // dismisses this same prompt, so the wire id is dropped first.
      try {
        const accepted = deps.approvals.respond(
          {
            sessionId,
            threadId: request.threadId,
            requestId: String(request.requestId),
          },
          {
            kind: 'codex',
            response: {
              sessionId,
              contextId: request.contextId,
              processGeneration: request.processGeneration,
              threadId: request.threadId,
              turnId: request.turnId,
              requestId: request.requestId,
              decision: decision[response.decision],
              reason: response.reason,
              modifiedInput: response.modifiedInput,
            },
          },
        );
        if (accepted) {
          publishResolved(response.id, taken, outcome);
          return true;
        }
        deps.logger.warn('Codex approval response rejected.', {
          code: 'approval-response-rejected',
        });
      } catch {
        // degradation-audit: reported - coded warning without request content (the
        // sink error may carry it). The renderer has already dismissed the prompt;
        // this Codex entry is settled and its reply is consumed instead of
        // falling through.
        deps.logger.warn('Codex approval response failed.', {
          code: 'approval-response-failed',
        });
      }
      send(MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED, {
        id: response.id,
        sessionId,
        toolName: request.toolName ?? request.kind,
      });
      publishResolved(response.id, taken, 'aborted');
      return true;
    },
    replacement: {
      validateReplacement(request, input) {
        if (
          request.kind !== 'command' ||
          Object.keys(input).some((name) => name !== 'command')
        )
          return undefined;
        const command = input['command'];
        return typeof command === 'string' && command.trim()
          ? command
          : undefined;
      },
      failed() {
        deps.logger.error('Codex approval follow-up failed.');
      },
    },
    publish: (id, stream) =>
      deps.broadcaster.streamEventsToWebview(id, stream, deps.tabId(id)),
  };
}
