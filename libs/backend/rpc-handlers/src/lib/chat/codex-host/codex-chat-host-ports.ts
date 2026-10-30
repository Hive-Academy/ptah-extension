import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  PTAH_MCP_PORT,
  PTAH_UI_HINT_CODEX,
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
} from '@ptah-extension/codex-runtime';
import type {
  IWorkspaceProvider,
  IPlatformInfo,
} from '@ptah-extension/platform-core';
import {
  type McpHttpServerOverride,
  type PermissionResponse,
  type PermissionLevel,
  type RuntimeHostCapabilities,
  type SessionId,
} from '@ptah-extension/shared';
import { ChatRuntimeProfileService } from '../session/chat-runtime-profile.service';
import { createCodexChatApprovalPresentation } from './codex-chat-approval-presentation';
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
  const approval = createCodexChatApprovalPresentation({
    logger: deps.logger,
    approvals: {
      respond: (address, reply) => deps.approvals.respond(address, reply),
    },
    tabId: (sessionId) => deps.tabId(sessionId),
    broadcastMessage: (type, payload) =>
      deps.webviewManager.broadcastMessage(type, payload),
    promptLifecycle: {
      publish: (event) => deps.promptLifecycle?.publish(event),
    },
    hostAttention: {
      resolve: (key, timestamp) => deps.hostAttention?.resolve(key, timestamp),
    },
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: (timer) => clearTimeout(timer),
  });
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
    presentation: approval.presentation,
    handlePermissionResponse: approval.handlePermissionResponse,
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
