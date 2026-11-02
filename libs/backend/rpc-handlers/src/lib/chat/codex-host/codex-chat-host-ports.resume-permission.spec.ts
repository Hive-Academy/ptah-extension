import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { SessionApprovalRouter } from '@ptah-extension/agent-sdk';
import type { ResolvedExecutionProfile } from '@ptah-extension/auth-providers';
import type { CodexThreadIdentity } from '@ptah-extension/codex-runtime';
import {
  SessionId,
  type FlatStreamEventUnion,
  type PermissionLevel,
} from '@ptah-extension/shared';
import {
  createCodexChatHostPorts,
  type CodexChatHostPortsDeps,
} from './codex-chat-host-ports';
import { resolveSavedCodexPermissionLevel } from './codex-saved-permission-level';

// Resume builds a profile only; approval presentation is never reached.
jest.mock('@ptah-extension/agent-sdk', () => ({
  presentCodexApproval: jest.fn(),
  PTAH_UI_HINT_CODEX: 'ptah-ui-hint',
  SDK_TOKENS: { RUNTIME_HOST_CAPABILITIES: Symbol.for('caps') },
  PTAH_MCP_PORT: 51820,
  UNROUTABLE_PERMISSION_TIMEOUT_MS: 1000,
  buildSystemAbortPermissionMessage: jest.fn(),
}));
jest.mock('@ptah-extension/auth-providers', () => ({
  AUTH_PROVIDERS_TOKENS: {
    SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER: Symbol.for('profiles'),
  },
}));

describe('Codex host resume permission persistence', () => {
  let workspace: string;
  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'ptah-codex-resume-'));
  });
  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  const sessionId = SessionId.from('22222222-2222-4222-8222-222222222222');
  const chatTab = '33333333-3333-4333-8333-333333333333';
  const config = () => ({
    tabId: 'tab',
    projectPath: workspace,
    workspaceId: workspace,
    model: 'sonnet',
  });

  function statefulIdentityStore() {
    const records = new Map<string, CodexThreadIdentity>();
    return {
      persist: jest.fn(async (identity: CodexThreadIdentity) => {
        records.set(identity.threadId, identity);
      }),
      markInactive: jest.fn(async (_identity: CodexThreadIdentity) => undefined),
      read: jest.fn(async (id: SessionId) => records.get(id)),
    };
  }

  function harness() {
    const identityStore = statefulIdentityStore();
    const settings = new Map<string, unknown>([['autopilot.enabled', true]]);
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
    const { Logger } = jest.createMockFromModule<
      typeof import('@ptah-extension/vscode-core')
    >('@ptah-extension/vscode-core');
    const readSavedPermissionLevel = jest.fn(
      (_workspacePath: string): PermissionLevel =>
        resolveSavedCodexPermissionLevel(
          (key) => settings.get(key),
          () => {
            throw new Error('Invalid saved Codex permission settings');
          },
        ),
    );
    const drained: FlatStreamEventUnion[] = [];
    const streamEventsToWebview = jest.fn(
      async (_id: SessionId, stream: AsyncIterable<FlatStreamEventUnion>) => {
        for await (const event of stream) drained.push(event);
      },
    );
    const deps: CodexChatHostPortsDeps = {
      resolver: { resolveExecutionProfile: jest.fn().mockResolvedValue(execution) },
      workspaceProvider: createMockWorkspaceProvider({ folders: [workspace] }),
      platformInfo: {
        extensionPath: join(tmpdir(), 'ptah-test-extension'),
        globalStoragePath: join(tmpdir(), 'ptah-test-storage'),
      },
      hostCapabilities: { nativeCodex: true },
      webviewManager: { broadcastMessage: jest.fn().mockResolvedValue(undefined) },
      logger: Logger.prototype,
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
      approvals: {
        register: jest.fn<
          () => void,
          Parameters<SessionApprovalRouter['register']>
        >(() => () => undefined),
        respond: jest.fn<
          boolean,
          Parameters<SessionApprovalRouter['respond']>
        >(() => true),
        cancelPrompt: jest.fn<
          void,
          Parameters<SessionApprovalRouter['cancelPrompt']>
        >(),
      },
      callbacks: () => ({
        result: jest.fn(),
        content: jest.fn(),
        live: jest.fn(),
        compaction: jest.fn(),
        error: jest.fn(),
      }),
      readResumeIdentity: identityStore.read,
      readSavedPermissionLevel,
      broadcaster: { streamEventsToWebview },
      tabId: () => chatTab,
    };
    return {
      deps,
      ports: createCodexChatHostPorts(deps),
      identityStore,
      readSavedPermissionLevel,
      settings,
    };
  }

  async function saveAndClose(
    h: ReturnType<typeof harness>,
    permissionLevel: PermissionLevel,
  ) {
    h.settings.set('autopilot.permissionLevel', permissionLevel);
    const { profile } = await h.ports.profile({ ...config(), permissionLevel });
    const identity: CodexThreadIdentity = {
      threadId: sessionId,
      contextId: profile.contextId,
      processGeneration: 1,
      normalizedHome: profile.normalizedHome,
      workspaceId: profile.workspaceId,
      providerId: profile.providerId,
      profileFingerprint: profile.profileFingerprint,
    };
    await h.identityStore.persist(identity);
    await h.identityStore.markInactive(identity);
    return { profile, identity };
  }

  it.each(['auto-edit', 'ask', 'plan'] as const)(
    'restores the saved %s level through host resume without a supplied level',
    async (permissionLevel) => {
      const h = harness();
      const saved = await saveAndClose(h, permissionLevel);
      const reopenedPorts = createCodexChatHostPorts(h.deps);

      const resumed = await reopenedPorts.profile(config(), sessionId);

      expect(saved.profile.permissionLevel).toBe(permissionLevel);
      expect(resumed.resume).toEqual(saved.identity);
      expect(h.identityStore.read).toHaveBeenCalledWith(sessionId);
      expect(h.readSavedPermissionLevel).toHaveBeenCalledWith(workspace);
      expect(resumed.profile.permissionLevel).toBe(permissionLevel);
      // A fingerprint built at any other level makes the runtime refuse resume.
      expect(resumed.profile.profileFingerprint).toBe(
        saved.identity.profileFingerprint,
      );
    },
  );
});
