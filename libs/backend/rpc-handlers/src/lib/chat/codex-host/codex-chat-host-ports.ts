import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  CodexChatAdapterPorts,
  HostAttentionCoordinator,
  RuntimeAdmissionPort,
} from '@ptah-extension/agent-sdk';
import type { WorkspaceProviderProfileResolver } from '@ptah-extension/auth-providers';
import {
  buildCodexExecutionProfile,
  type CodexExecutionProfileInput,
  type CodexThreadIdentity,
  type CodexApprovalRequest,
} from '@ptah-extension/codex-runtime';
import type {
  IWorkspaceProvider,
  IPlatformInfo,
} from '@ptah-extension/platform-core';
import {
  MESSAGE_TYPES,
  attentionRequestKey,
  type PermissionRequest,
  type PermissionResponse,
  type RuntimeHostCapabilities,
  type SessionId,
} from '@ptah-extension/shared';
import { ChatRuntimeProfileService } from '../session/chat-runtime-profile.service';
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
  broadcaster: Pick<ChatStreamBroadcaster, 'streamEventsToWebview'>;
  tabId(sessionId: SessionId): string;
  /** Releases the host notice the webview attention observer raised for a request. */
  hostAttention?: Pick<HostAttentionCoordinator, 'resolve'>;
}

export interface CodexChatHostPorts extends CodexChatAdapterPorts {
  /** Host permission bridge must try this before the Claude permission handler. */
  handlePermissionResponse(response: PermissionResponse): boolean;
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

// An allowlist also rejects future SDK options until their native semantics are reviewed.
const supported = new Set([
  'projectPath',
  'workspaceId',
  'model',
  'tabId',
  'prompt',
  'name',
  'sessionName',
  'sessionTitle',
  'runtime',
  'permissionLevel',
  'effort',
  'systemPrompt',
  'enhancedPromptsContent',
  'outputStyleBody',
  'files',
  'images',
]);

export function createCodexChatHostPorts(
  deps: CodexChatHostPortsDeps,
): CodexChatHostPorts {
  const service = profiles(deps);
  const pending = new Map<
    string,
    { sessionId: SessionId; request: CodexApprovalRequest; timestamp: number }
  >();
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
  const settle = (id: string) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    release(id, entry.timestamp);
  };
  // The UI wire carries only a string id. Encode the full correlation to avoid
  // collisions between different processes, sessions and reused native ids.
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
    async profile(config, sessionId) {
      for (const [name, value] of Object.entries(config)) {
        if (value !== undefined && !supported.has(name))
          throw new Error('Unsupported Codex chat option');
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
      const execution = await service.prepare(config, identity);
      if (execution.runtime !== 'codex-app-server')
        throw new Error('Native provider required');
      const { seed, cwd, workspacePath } = execution;
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
      const profile = buildCodexExecutionProfile({
        paths: {
          platform: process.platform === 'win32' ? 'win32' : 'posix',
          baseDirectory: cwd,
          entries,
        },
        session: {
          contextId: resume?.contextId ?? randomUUID(),
          consumer: 'chat',
          normalizedHome: seed.home,
          providerId: seed.providerId,
          workspaceId: workspacePath,
          cwd,
          model: seed.model,
          effort: config.effort,
          permissionLevel: config.permissionLevel ?? 'ask',
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
        },
      });
      if (
        resume &&
        (resume.normalizedHome !== profile.normalizedHome ||
          resume.workspaceId !== profile.workspaceId ||
          resume.providerId !== profile.providerId)
      )
        throw new Error('Native resume identity mismatch');
      return { profile, resume };
    },
    presentation: {
      present(sessionId, request) {
        const id = key(sessionId, request);
        const timestamp = Date.now();
        // A re-presented request is a new generation; release the previous notice.
        settle(id);
        pending.set(id, { sessionId, request, timestamp });
        const payload: PermissionRequest = {
          id,
          sessionId,
          tabId: deps.tabId(sessionId),
          toolName: request.toolName ?? request.kind,
          toolUseId: request.toolId,
          toolInput: request.details,
          description: request.message,
          timestamp,
          timeoutAt: 0,
          allowedDecisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
        };
        // Direct manager call: its attention observer raises the host notice.
        void deps.webviewManager
          .broadcastMessage(MESSAGE_TYPES.PERMISSION_REQUEST, payload)
          .catch(failed);
      },
      dismiss(sessionId, request) {
        const id = key(sessionId, request);
        settle(id);
        send(MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED, {
          id,
          sessionId,
          toolName: request.toolName ?? request.kind,
        });
      },
      cancelPrompt(payload) {
        for (const [id, entry] of [...pending]) {
          if (
            entry.sessionId === payload.sessionId &&
            String(entry.request.requestId) === payload.requestId
          ) {
            settle(id);
            send(MESSAGE_TYPES.PERMISSION_PROMPT_CANCELLED, {
              ...payload,
              requestId: id,
            });
          }
        }
      },
    },
    handlePermissionResponse(response) {
      const entry = pending.get(response.id);
      if (!entry) return false;
      settle(response.id);
      const { sessionId, request } = entry;
      const decision = {
        allow: 'accept',
        always_allow: 'acceptForSession',
        deny_with_message: 'decline',
        deny: 'cancel',
      } as const;
      return deps.approvals.respond(
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
