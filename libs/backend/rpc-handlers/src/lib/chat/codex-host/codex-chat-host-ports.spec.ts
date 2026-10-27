import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import { PTAH_UI_HINT, type SessionApprovalRouter } from '@ptah-extension/agent-sdk';
import type { ResolvedExecutionProfile } from '@ptah-extension/auth-providers';
import type {
  CodexApprovalRequest,
  CodexThreadIdentity,
} from '@ptah-extension/codex-runtime';
import {
  SessionId,
  MESSAGE_TYPES,
  attentionRequestKey,
  type FlatStreamEventUnion,
} from '@ptah-extension/shared';
import {
  createCodexChatHostPorts,
  createCodexRuntimeAdmission,
  type CodexChatHostPortsDeps,
} from './codex-chat-host-ports';
import { CodexChatOptionError } from './codex-chat-profile-options';
import { ChatRuntimeProfileService } from '../session/chat-runtime-profile.service';

jest.mock('@ptah-extension/agent-sdk', () => ({
  PTAH_UI_HINT: jest.requireActual<
    typeof import('../../../../../agent-sdk/src/lib/prompt-harness/ptah-ui-hint')
  >('../../../../../agent-sdk/src/lib/prompt-harness/ptah-ui-hint').PTAH_UI_HINT,
  SDK_TOKENS: { RUNTIME_HOST_CAPABILITIES: Symbol.for('caps') },
}));
jest.mock('@ptah-extension/auth-providers', () => ({
  AUTH_PROVIDERS_TOKENS: {
    SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER: Symbol.for('profiles'),
  },
}));

describe('Codex chat host ports', () => {
  let workspace: string;
  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'ptah-codex-host-'));
  });
  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const id = SessionId.from('22222222-2222-4222-8222-222222222222');
  function harness() {
    const execution: ResolvedExecutionProfile = {
      runtime: 'codex-app-server',
      seed: {
        providerId: 'openai-codex',
        consumer: 'chat',
        workspacePath: workspace,
        home: workspace,
        normalizedHome: workspace,
        model: 'gpt-5',
      },
      modelSubstitution: {
        requested: 'sonnet',
        used: 'gpt-5',
        reason: 'not-in-catalog',
      },
    };
    const resolveExecutionProfile = jest.fn().mockResolvedValue(execution);
    const broadcastMessage = jest.fn().mockResolvedValue(undefined);
    const resolveAttention = jest.fn<void, [string, number]>();
    const { Logger } = jest.createMockFromModule<
      typeof import('@ptah-extension/vscode-core')
    >('@ptah-extension/vscode-core');
    const logger = Logger.prototype;
    const respond = jest
      .fn<boolean, Parameters<SessionApprovalRouter['respond']>>()
      .mockReturnValue(true);
    const approvals: CodexChatHostPortsDeps['approvals'] = {
      register: jest.fn<
        () => void,
        Parameters<SessionApprovalRouter['register']>
      >(() => () => undefined),
      respond,
      cancelPrompt: jest.fn<
        void,
        Parameters<SessionApprovalRouter['cancelPrompt']>
      >(),
    };
    const readResumeIdentity = jest
      .fn<Promise<CodexThreadIdentity | undefined>, [SessionId]>()
      .mockResolvedValue(undefined);
    const drained: FlatStreamEventUnion[] = [];
    const streamEventsToWebview = jest.fn(
      async (_id: SessionId, stream: AsyncIterable<FlatStreamEventUnion>) => {
        for await (const event of stream) drained.push(event);
      },
    );
    const deps: CodexChatHostPortsDeps = {
      resolver: { resolveExecutionProfile },
      workspaceProvider: createMockWorkspaceProvider({ folders: [workspace] }),
      platformInfo: {
        extensionPath: join(tmpdir(), 'ptah-test-extension'),
        globalStoragePath: join(tmpdir(), 'ptah-test-storage'),
      },
      hostCapabilities: { nativeCodex: true },
      webviewManager: { broadcastMessage },
      hostAttention: { resolve: resolveAttention },
      logger,
      platform: { platform: process.platform, arch: process.arch },
      info: {
        id: 'codex-app-server',
        name: 'Codex',
        version: '1.0.0',
        description: 'Native Codex chat test provider',
        vendor: 'OpenAI',
        capabilities: {
          streaming: true,
          fileAttachments: true,
          contextManagement: true,
          sessionPersistence: true,
          multiTurn: true,
          codeGeneration: true,
          imageAnalysis: true,
          functionCalling: true,
        },
      },
      createScope: () => {
        throw new Error('No process in unit tests');
      },
      metadata: { save: jest.fn() },
      approvals,
      callbacks: () => ({
        result: jest.fn(),
        content: jest.fn(),
        live: jest.fn(),
        compaction: jest.fn(),
        error: jest.fn(),
      }),
      readResumeIdentity,
      broadcaster: { streamEventsToWebview },
      tabId: () => 'tab',
    };
    return {
      deps,
      ports: createCodexChatHostPorts(deps),
      logger,
      broadcastMessage,
      resolveAttention,
      resolveExecutionProfile,
      readResumeIdentity,
      respond,
      drained,
      streamEventsToWebview,
    };
  }
  const config = () => ({
    tabId: 'tab',
    projectPath: workspace,
    workspaceId: workspace,
    model: 'sonnet',
  });

  it('builds a frozen validated profile without publishing a substitution notice', async () => {
    const h = harness();
    const { profile } = await h.ports.profile(config());
    expect(profile).toMatchObject({
      model: 'gpt-5',
      providerId: 'openai-codex',
      permissionLevel: 'ask',
    });
    expect(Object.isFrozen(profile)).toBe(true);
    expect(profile.profileFingerprint).toBeTruthy();
    expect(h.broadcastMessage).not.toHaveBeenCalled();
  });
  it('loads native resume identity and rejects immutable binding changes', async () => {
    const h = harness();
    const { profile } = await h.ports.profile(config());
    const identity: CodexThreadIdentity = {
      threadId: id,
      contextId: profile.contextId,
      processGeneration: 1,
      normalizedHome: profile.normalizedHome,
      workspaceId: workspace,
      providerId: profile.providerId,
      profileFingerprint: profile.profileFingerprint,
    };
    h.readResumeIdentity.mockResolvedValue(identity);
    expect((await h.ports.profile(config(), id)).resume).toBe(identity);
    expect(h.readResumeIdentity).toHaveBeenCalledWith(id);
    h.readResumeIdentity.mockResolvedValue({
      ...identity,
      normalizedHome: 'different-home',
    });
    await expect(h.ports.profile(config(), id)).rejects.toThrow(
      'identity mismatch',
    );
  });
  it('rejects unsupported options before resolving or logging secret MCP contents', async () => {
    const h = harness();
    await expect(
      h.ports.profile({ ...config(), temperature: 0.5 }),
    ).rejects.toThrow(new CodexChatOptionError('temperature'));
    await expect(
      h.ports.profile({
        ...config(),
        mcpServersOverride: {
          private: { type: 'http', url: 'http://localhost/?secret=never-log' },
        },
      }),
    ).rejects.toThrow(new CodexChatOptionError('mcpServersOverride'));
    expect(h.resolveExecutionProfile).not.toHaveBeenCalled();
    expect(h.logger.error).not.toHaveBeenCalled();
    expect(h.logger.info).not.toHaveBeenCalled();
  });
  it.each([undefined, 'coding'] as const)('maps the UI fence for tool profile %s', async (mcpToolProfile) => {
    const h = harness();
    const { profile } = await h.ports.profile({
      ...config(), ptahUiFence: true, mcpToolProfile,
      systemPrompt: 'system', enhancedPromptsContent: 'enhanced', outputStyleBody: 'style',
    });
    expect(profile.developerPrompt).toBe(PTAH_UI_HINT);
    expect(profile).toMatchObject({ systemPrompt: 'system', enhancedPrompt: 'enhanced', outputStyle: 'style' });
  });
  it.each([false, undefined] as const)('omits the UI hint when the fence is %s', async (ptahUiFence) => {
    const { profile } = await harness().ports.profile({ ...config(), ptahUiFence });
    expect(profile.developerPrompt).toBeUndefined();
  });
  it('rejects a non-coding tool profile with the coded option error', async () => {
    const h = harness();
    const result = h.ports.profile({
      ...config(), ptahUiFence: true, mcpToolProfile: 'apps',
    });
    await expect(result).rejects.toBeInstanceOf(CodexChatOptionError);
    await expect(result).rejects.toMatchObject({
      code: 'unsupported-option',
      key: 'mcpToolProfile',
      message: 'Codex chat does not support the "mcpToolProfile" option.',
    });
    expect(h.resolveExecutionProfile).not.toHaveBeenCalled();
  });
  it.each([true, false])('strips host flags and reports MCP availability %s', async (mcpServerRunning) => {
    const h = harness();
    const input = {
      ...config(),
      mcpServerRunning,
      workflowsDisabled: false,
      includePartialMessages: true,
      mcpServersOverride: {},
    };
    const prepare = jest.spyOn(
      ChatRuntimeProfileService.prototype,
      'prepare',
    );
    try {
      const { profile } = await h.ports.profile(input);
      expect(profile.model).toBe('gpt-5');
      expect(prepare.mock.calls[0][0]).toEqual(config());
      expect(h.logger.info).toHaveBeenCalledTimes(mcpServerRunning ? 1 : 0);
      if (mcpServerRunning) {
        expect(h.logger.info).toHaveBeenCalledWith(
          'Ptah MCP is not attached to Codex chat.',
          { code: 'ptah-mcp-not-attached' },
        );
      }
      expect(input).toHaveProperty('mcpServerRunning', mcpServerRunning);
    } finally {
      prepare.mockRestore();
    }
  });
  it('uses the same provider resolver for admission', async () => {
    const h = harness();
    const admission = createCodexRuntimeAdmission(h.deps);
    expect(await admission.servingProviderId(config())).toBe(
      (await h.ports.profile(config())).profile.providerId,
    );
    expect(h.resolveExecutionProfile.mock.calls[0]).toEqual(
      h.resolveExecutionProfile.mock.calls[1],
    );
  });
  function request(): CodexApprovalRequest {
    return {
      contextId: 'context',
      processGeneration: 2,
      threadId: id,
      turnId: 'turn',
      requestId: 5,
      kind: 'command',
      normalizedHome: workspace,
      workspaceId: workspace,
      providerId: 'openai-codex',
      message: 'Run command',
      details: { command: 'pwd' },
    };
  }
  it.each([
    ['allow', 'accept'],
    ['always_allow', 'acceptForSession'],
    ['deny_with_message', 'decline'],
    ['deny', 'cancel'],
  ] as const)('maps %s over the existing permission wire', (wire, decision) => {
    const h = harness();
    h.ports.presentation.present(id, request(), [
      'deny',
      'allowOnce',
      'allowWithInput',
      'alwaysAllow',
    ]);
    const payload = h.broadcastMessage.mock.calls[0][1];
    expect(payload.allowedDecisions).toEqual([
      'accept',
      'acceptForSession',
      'decline',
      'cancel',
    ]);
    expect(
      h.ports.handlePermissionResponse({ id: payload.id, decision: wire }),
    ).toBe(true);
    expect(h.respond.mock.calls[0][1].response.decision).toBe(decision);
  });
  it.each(['rejected', 'throws'] as const)('settles the Codex approval without falling through when the sink %s', (failure) => {
    const h = harness();
    h.ports.presentation.present(id, request(), [
      'deny',
      'allowOnce',
      'allowWithInput',
      'alwaysAllow',
    ]);
    const wireId: string = h.broadcastMessage.mock.calls[0][1].id;
    if (failure === 'throws') h.respond.mockImplementationOnce(() => { throw new Error('private request'); });
    else h.respond.mockReturnValueOnce(false);
    expect(h.ports.handlePermissionResponse({ id: wireId, decision: 'allow' })).toBe(true);
    expect(h.resolveAttention).toHaveBeenCalledWith(
      attentionRequestKey('permission', wireId),
      h.broadcastMessage.mock.calls[0][1].timestamp,
    );
    expect(h.broadcastMessage).toHaveBeenLastCalledWith(
      MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED,
      { id: wireId, sessionId: id, toolName: 'command' },
    );
    expect(h.deps.logger.warn).toHaveBeenCalledWith(
      expect.any(String), { code: failure === 'throws' ? 'approval-response-failed' : 'approval-response-rejected' },
    );
    expect(h.ports.handlePermissionResponse({ id: wireId, decision: 'allow' })).toBe(false);
    expect(h.respond).toHaveBeenCalledTimes(1);
    expect(h.resolveAttention).toHaveBeenCalledTimes(1);
  });
  it('declines an undeliverable prompt and releases its pending entry', async () => {
    const h = harness();
    h.broadcastMessage.mockRejectedValueOnce(new Error('window closed'));
    h.ports.presentation.present(id, request(), [
      'deny',
      'allowOnce',
      'allowWithInput',
      'alwaysAllow',
    ]);
    const wireId: string = h.broadcastMessage.mock.calls[0][1].id;
    await Promise.resolve();
    await Promise.resolve();
    expect(h.respond).toHaveBeenCalledWith(
      { sessionId: id, threadId: id, requestId: '5' },
      expect.objectContaining({ kind: 'codex', response: expect.objectContaining({ decision: 'decline' }) }),
    );
    expect(h.resolveAttention).toHaveBeenCalledTimes(1);
    expect(h.ports.handlePermissionResponse({ id: wireId, decision: 'allow' })).toBe(false);
  });
  it('accepts equivalent resume workspace spelling and preserves the caller path', async () => {
    const h = harness();
    const { profile } = await h.ports.profile(config());
    h.readResumeIdentity.mockResolvedValue({
      threadId: id, contextId: profile.contextId, processGeneration: 1,
      normalizedHome: profile.normalizedHome, providerId: profile.providerId,
      workspaceId: (process.platform === 'win32' ? workspace.toUpperCase() : workspace) + '/',
      profileFingerprint: profile.profileFingerprint,
    });
    expect((await h.ports.profile(config(), id)).profile.workspaceId).toBe(workspace);
  });
  it('cancels the correlated UI prompt and forgets its wire id', () => {
    const h = harness();
    h.ports.presentation.present(id, request(), [
      'deny',
      'allowOnce',
      'allowWithInput',
      'alwaysAllow',
    ]);
    const wireId: string = h.broadcastMessage.mock.calls[0][1].id;
    h.ports.presentation.cancelPrompt({
      sessionId: id,
      requestId: '5',
      reason: 'turn-ended',
    });
    expect(h.broadcastMessage).toHaveBeenLastCalledWith(
      MESSAGE_TYPES.PERMISSION_PROMPT_CANCELLED,
      { sessionId: id, requestId: wireId, reason: 'turn-ended' },
    );
    expect(h.respond).not.toHaveBeenCalled();
    expect(
      h.ports.handlePermissionResponse({ id: wireId, decision: 'allow' }),
    ).toBe(false);
  });
  describe('host attention release', () => {
    function presented() {
      const h = harness();
      h.ports.presentation.present(id, request(), [
        'deny',
        'allowOnce',
        'allowWithInput',
        'alwaysAllow',
      ]);
      const [type, payload] = h.broadcastMessage.mock.calls[0];
      expect(type).toBe(MESSAGE_TYPES.PERMISSION_REQUEST);
      expect(h.resolveAttention).not.toHaveBeenCalled();
      const noticeKey = attentionRequestKey('permission', payload.id);
      return {
        h,
        wireId: payload.id as string,
        noticeKey,
        timestamp: payload.timestamp as number,
      };
    }

    it('releases the observed notice once a decision is returned', () => {
      const { h, wireId, noticeKey, timestamp } = presented();
      h.ports.handlePermissionResponse({ id: wireId, decision: 'allow' });
      expect(h.resolveAttention).toHaveBeenCalledTimes(1);
      expect(h.resolveAttention).toHaveBeenCalledWith(noticeKey, timestamp);
      expect(
        h.ports.handlePermissionResponse({ id: wireId, decision: 'deny' }),
      ).toBe(false);
      expect(h.respond).toHaveBeenCalledTimes(1);
      h.ports.presentation.cancelPrompt({
        sessionId: id,
        requestId: '5',
        reason: 'turn-ended',
      });
      expect(h.broadcastMessage).toHaveBeenCalledTimes(1);
      h.ports.presentation.dismiss(id, request());
      expect(h.broadcastMessage).toHaveBeenLastCalledWith(
        MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED,
        { id: wireId, sessionId: id, toolName: 'command' },
      );
      expect(h.resolveAttention).toHaveBeenCalledTimes(1);
    });

    it('releases the observed notice when the request is auto-resolved', () => {
      const { h, noticeKey, timestamp } = presented();
      h.ports.presentation.dismiss(id, request());
      expect(h.resolveAttention).toHaveBeenCalledWith(noticeKey, timestamp);
      h.ports.presentation.dismiss(id, request());
      expect(h.resolveAttention).toHaveBeenCalledTimes(1);
    });

    it('releases the observed notice when the prompt is cancelled', () => {
      const { h, noticeKey, timestamp } = presented();
      h.ports.presentation.cancelPrompt({
        sessionId: id,
        requestId: '5',
        reason: 'turn-ended',
      });
      expect(h.resolveAttention).toHaveBeenCalledTimes(1);
      expect(h.resolveAttention).toHaveBeenCalledWith(noticeKey, timestamp);
    });

    it('releases nothing for an unknown response id', () => {
      const { h } = presented();
      expect(
        h.ports.handlePermissionResponse({ id: 'unknown', decision: 'allow' }),
      ).toBe(false);
      expect(h.resolveAttention).not.toHaveBeenCalled();
    });

    it('works without a host attention coordinator', () => {
      const h = harness();
      const ports = createCodexChatHostPorts({
        ...h.deps,
        hostAttention: undefined,
      });
      ports.presentation.present(id, request(), [
        'deny',
        'allowOnce',
        'allowWithInput',
        'alwaysAllow',
      ]);
      const wireId: string = h.broadcastMessage.mock.calls[0][1].id;
      expect(
        ports.handlePermissionResponse({ id: wireId, decision: 'deny' }),
      ).toBe(true);
    });
  });
  it('drains follow-up events through the broadcaster', async () => {
    const h = harness();
    const event: FlatStreamEventUnion = {
      id: 'event',
      messageId: 'message',
      sessionId: id,
      timestamp: 1,
      eventType: 'message_complete',
    };
    const stream = (async function* () {
      yield event;
    })();
    await h.ports.publish(id, stream);
    expect(h.drained).toEqual([event]);
    expect(h.streamEventsToWebview).toHaveBeenCalledWith(id, stream, 'tab');
  });
});
