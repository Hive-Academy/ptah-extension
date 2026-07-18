import 'reflect-metadata';

jest.mock('@ptah-extension/cli-agent-runtime', () => ({
  CLI_AGENT_RUNTIME_TOKENS: {
    SDK_PTAH_CLI_REGISTRY: Symbol.for('PtahCliRegistry'),
  },
}));

import type { Logger } from '@ptah-extension/vscode-core';
import type { PtahCliRegistry } from '@ptah-extension/cli-agent-runtime';
import type { SdkAgentAdapter } from '@ptah-extension/agent-sdk';
import type { CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';
import type {
  ChatStartParams,
  ChatContinueParams,
  ChatAbortParams,
  ProviderProfile,
  SessionId,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { ChatPtahCliService } from './chat-ptah-cli.service';
import type { ChatSdkContextService } from '../session/chat-sdk-context.service';

const TAB_UUID = '11111111-2222-4333-8444-555555555555';
const SESSION_UUID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const AGENT_ID = 'pc-test-001';

interface Suite {
  service: ChatPtahCliService;
  logger: MockLogger;
  codeExecutionMcp: jest.Mocked<
    Pick<CodeExecutionMCP, 'ensureRegisteredForSubagents'>
  >;
  registry: jest.Mocked<Pick<PtahCliRegistry, 'getProfile' | 'listAgents'>>;
  agentAdapter: jest.Mocked<
    Pick<
      SdkAgentAdapter,
      | 'startChatSession'
      | 'sendMessageToSession'
      | 'endSession'
      | 'isSessionActive'
    >
  >;
  sdkContext: jest.Mocked<
    Pick<
      ChatSdkContextService,
      | 'isMcpServerRunning'
      | 'resolveEnhancedPromptsContent'
      | 'resolvePluginPaths'
    >
  >;
  profile: ProviderProfile;
}

function makeSuite(): Suite {
  const logger = createMockLogger();

  const profile: ProviderProfile = {
    providerId: 'moonshot',
    authEnv: {
      ANTHROPIC_BASE_URL: 'https://api.moonshot.ai/anthropic/',
      ANTHROPIC_AUTH_TOKEN: 'sk-test',
    },
    model: 'claude-sonnet-4-20250514',
    baseUrl: 'https://api.moonshot.ai/anthropic/',
    cliJsPath: '/tmp/cli.js',
  };

  const codeExecutionMcp = {
    ensureRegisteredForSubagents: jest.fn(),
  } as jest.Mocked<Pick<CodeExecutionMCP, 'ensureRegisteredForSubagents'>>;

  const registry = {
    getProfile: jest.fn().mockResolvedValue(profile),
    listAgents: jest.fn().mockResolvedValue([
      {
        id: AGENT_ID,
        name: 'Test CLI Agent',
        providerName: 'Moonshot',
        providerId: 'moonshot',
        hasApiKey: true,
        hasStoredKey: true,
        status: 'available',
        enabled: true,
        modelCount: 1,
      },
    ]),
  } as unknown as jest.Mocked<
    Pick<PtahCliRegistry, 'getProfile' | 'listAgents'>
  >;

  const stream: AsyncIterable<unknown> = {
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.resolve({ done: true, value: undefined }),
    }),
  };

  const agentAdapter = {
    startChatSession: jest.fn().mockResolvedValue(stream),
    sendMessageToSession: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn(),
    isSessionActive: jest.fn().mockReturnValue(true),
  } as unknown as jest.Mocked<
    Pick<
      SdkAgentAdapter,
      | 'startChatSession'
      | 'sendMessageToSession'
      | 'endSession'
      | 'isSessionActive'
    >
  >;

  const sdkContext = {
    isMcpServerRunning: jest.fn().mockReturnValue(false),
    resolveEnhancedPromptsContent: jest.fn().mockResolvedValue(undefined),
    resolvePluginPaths: jest.fn().mockReturnValue([]),
  } as jest.Mocked<
    Pick<
      ChatSdkContextService,
      | 'isMcpServerRunning'
      | 'resolveEnhancedPromptsContent'
      | 'resolvePluginPaths'
    >
  >;

  const service = new ChatPtahCliService(
    logger as unknown as Logger,
    codeExecutionMcp as unknown as CodeExecutionMCP,
    registry as unknown as PtahCliRegistry,
    agentAdapter as unknown as SdkAgentAdapter,
    sdkContext as unknown as ChatSdkContextService,
  );

  return {
    service,
    logger,
    codeExecutionMcp,
    registry,
    agentAdapter,
    sdkContext,
    profile,
  };
}

describe('ChatPtahCliService', () => {
  describe('handleStart', () => {
    it('resolves profile via registry and forwards to SdkAgentAdapter.startChatSession', async () => {
      const s = makeSuite();
      const params: ChatStartParams = {
        prompt: 'hi',
        tabId: TAB_UUID,
        workspacePath: '/tmp/ws',
        ptahCliId: AGENT_ID,
      } as ChatStartParams;

      const out = await s.service.handleStart(params);

      expect(s.registry.getProfile).toHaveBeenCalledWith(AGENT_ID);
      expect(s.agentAdapter.startChatSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tabId: TAB_UUID,
          providerProfile: s.profile,
          projectPath: '/tmp/ws',
          workspaceId: '/tmp/ws',
        }),
      );
      expect(out.result).toEqual({ success: true });
      expect(out.stream).toBeDefined();
      expect(out.tabId).toBe(TAB_UUID);
      expect(s.service.hasSession(TAB_UUID)).toBe(true);
      expect(s.service.getAgentId(TAB_UUID)).toBe(AGENT_ID);
    });

    it('returns failure result when registry.getProfile returns undefined', async () => {
      const s = makeSuite();
      s.registry.getProfile.mockResolvedValueOnce(undefined);

      const out = await s.service.handleStart({
        prompt: 'hi',
        tabId: TAB_UUID,
        workspacePath: '/tmp/ws',
        ptahCliId: AGENT_ID,
      } as ChatStartParams);

      expect(out.result.success).toBe(false);
      expect(s.agentAdapter.startChatSession).not.toHaveBeenCalled();
    });
  });

  describe('handleContinue', () => {
    it('returns __NOT_PTAH_CLI__ when session is not mapped to a Ptah CLI agent', async () => {
      const s = makeSuite();

      const out = await s.service.handleContinue({
        prompt: 'more',
        sessionId: SESSION_UUID as SessionId,
        tabId: TAB_UUID,
      } as ChatContinueParams);

      expect(out).toEqual({ success: false, error: '__NOT_PTAH_CLI__' });
      expect(s.agentAdapter.sendMessageToSession).not.toHaveBeenCalled();
    });

    it('dispatches sendMessageToSession when the session is a known Ptah CLI session', async () => {
      const s = makeSuite();
      await s.service.handleStart({
        prompt: 'hi',
        tabId: TAB_UUID,
        workspacePath: '/tmp/ws',
        ptahCliId: AGENT_ID,
      } as ChatStartParams);

      const out = await s.service.handleContinue({
        prompt: 'more',
        sessionId: SESSION_UUID as SessionId,
        tabId: TAB_UUID,
      } as ChatContinueParams);

      expect(s.agentAdapter.sendMessageToSession).toHaveBeenCalledWith(
        SESSION_UUID,
        'more',
        { files: [] },
      );
      expect(out.success).toBe(true);
      expect(out.sessionId).toBe(SESSION_UUID);
    });

    it('returns failure when SdkAgentAdapter reports the session not active', async () => {
      const s = makeSuite();
      s.agentAdapter.isSessionActive.mockReturnValueOnce(false);
      await s.service.handleStart({
        prompt: 'hi',
        tabId: TAB_UUID,
        workspacePath: '/tmp/ws',
        ptahCliId: AGENT_ID,
      } as ChatStartParams);

      const out = await s.service.handleContinue({
        prompt: 'more',
        sessionId: SESSION_UUID as SessionId,
        tabId: TAB_UUID,
      } as ChatContinueParams);

      expect(out.success).toBe(false);
      expect(s.agentAdapter.sendMessageToSession).not.toHaveBeenCalled();
    });
  });

  describe('handleAbort', () => {
    it('returns __NOT_PTAH_CLI__ when sessionId is not tracked', async () => {
      const s = makeSuite();

      const out = await s.service.handleAbort({
        sessionId: SESSION_UUID as SessionId,
      } as ChatAbortParams);

      expect(out).toEqual({ success: false, error: '__NOT_PTAH_CLI__' });
      expect(s.agentAdapter.endSession).not.toHaveBeenCalled();
    });

    it('ends the session on the adapter and forgets it', async () => {
      const s = makeSuite();
      await s.service.handleStart({
        prompt: 'hi',
        tabId: TAB_UUID,
        workspacePath: '/tmp/ws',
        ptahCliId: AGENT_ID,
      } as ChatStartParams);
      s.service.trackSession(TAB_UUID, SESSION_UUID);

      const out = await s.service.handleAbort({
        sessionId: SESSION_UUID as SessionId,
      } as ChatAbortParams);

      expect(s.agentAdapter.endSession).toHaveBeenCalledWith(SESSION_UUID);
      expect(out).toEqual({ success: true });
      expect(s.service.hasSession(SESSION_UUID)).toBe(false);
    });
  });

  describe('map probes', () => {
    it('trackSession maps real session UUID back to the same agent entry', async () => {
      const s = makeSuite();
      await s.service.handleStart({
        prompt: 'hi',
        tabId: TAB_UUID,
        workspacePath: '/tmp/ws',
        ptahCliId: AGENT_ID,
      } as ChatStartParams);

      s.service.trackSession(TAB_UUID, SESSION_UUID);

      expect(s.service.hasSession(SESSION_UUID)).toBe(true);
      expect(s.service.getAgentId(SESSION_UUID)).toBe(AGENT_ID);
    });

    it('setSdkSessionId / getSdkSessionId roundtrip', () => {
      const s = makeSuite();
      s.service.setSdkSessionId(TAB_UUID, SESSION_UUID);
      expect(s.service.getSdkSessionId(TAB_UUID)).toBe(SESSION_UUID);
    });
  });
});
