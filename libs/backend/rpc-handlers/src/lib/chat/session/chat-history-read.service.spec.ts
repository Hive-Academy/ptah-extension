import 'reflect-metadata';

import type { FlatStreamEventUnion, SessionId } from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type {
  Logger,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

import { ChatHistoryReadService } from './chat-history-read.service';

const SESSION_ID = '11111111-1111-4111-8111-111111111111' as SessionId;
const WORKSPACE = '/c/projects/repo';

function makeHarness(
  options: {
    folders?: string[];
    metadata?: { workingDirectory?: string } | null;
    exists?: jest.Mock;
  } = {},
) {
  const logger = createMockLogger();
  const historyReader = {
    readSessionHistory: jest
      .fn()
      .mockResolvedValue({ events: [], stats: null }),
    readSessionEvents: jest.fn().mockResolvedValue([]),
  };
  const metadataStore = {
    get: jest.fn().mockResolvedValue(options.metadata ?? null),
  };
  const subagentRegistry = {
    getResumableBySession: jest.fn().mockReturnValue([]),
  } as unknown as SubagentRegistryService;
  const workspaceProvider = createMockWorkspaceProvider({
    folders: options.folders ?? [WORKSPACE],
  });
  const fileSystemProvider = {
    exists: options.exists ?? jest.fn().mockResolvedValue(true),
  };
  const service = new ChatHistoryReadService(
    logger as unknown as Logger,
    historyReader as never,
    metadataStore as never,
    subagentRegistry,
    workspaceProvider as unknown as IWorkspaceProvider,
    fileSystemProvider as never,
    {
      type: 'cli',
      extensionPath: '/tmp/ptah-app',
      globalStoragePath: '/tmp/ptah-storage',
      workspaceStoragePath: '/tmp/ptah-workspace-storage',
    } as never,
  );
  return {
    service,
    historyReader,
    metadataStore,
    subagentRegistry,
    fileSystemProvider,
  };
}

describe('ChatHistoryReadService', () => {
  it('uses an existing authorized persisted directory for resume', async () => {
    const persisted = `${WORKSPACE}/.claude/worktrees/task`;
    const harness = makeHarness({ folders: [WORKSPACE, persisted] });

    await expect(
      harness.service.readForResume(SESSION_ID, WORKSPACE, persisted),
    ).resolves.toMatchObject({ resolvedWorkspacePath: persisted });
    expect(harness.historyReader.readSessionHistory).toHaveBeenCalledWith(
      SESSION_ID,
      persisted,
      { checkCompactionBoundary: true },
    );
  });

  it.each([
    ['unauthorized', '/outside/repo', jest.fn().mockResolvedValue(true)],
    ['missing', `${WORKSPACE}/deleted`, jest.fn().mockResolvedValue(false)],
    [
      'unreadable',
      `${WORKSPACE}/unreadable`,
      jest.fn().mockRejectedValue(new Error('EACCES')),
    ],
  ])(
    'falls back for an %s persisted directory',
    async (_label, persisted, exists) => {
      const harness = makeHarness({ exists });
      await expect(
        harness.service.readForResume(SESSION_ID, WORKSPACE, persisted),
      ).resolves.toMatchObject({ resolvedWorkspacePath: WORKSPACE });
      expect(harness.historyReader.readSessionHistory).toHaveBeenCalledWith(
        SESSION_ID,
        WORKSPACE,
        { checkCompactionBoundary: true },
      );
    },
  );

  it('reads an older page through the side-effect-free event API', async () => {
    const events = [
      { eventType: 'message_start', messageId: 'u1', role: 'user' },
      { eventType: 'message_stop', messageId: 'u1' },
      { eventType: 'message_start', messageId: 'u2', role: 'user' },
      { eventType: 'message_stop', messageId: 'u2' },
    ] as FlatStreamEventUnion[];
    const harness = makeHarness();
    harness.historyReader.readSessionEvents.mockResolvedValue(events);
    (
      harness.subagentRegistry.getResumableBySession as jest.Mock
    ).mockReturnValue([{ toolCallId: 'tool-1' }]);

    await expect(
      harness.service.readPage({
        sessionId: SESSION_ID,
        workspacePath: WORKSPACE,
        cursor: 'h1:u2',
        maxEvents: 250,
      }),
    ).resolves.toEqual({
      events: events.slice(0, 2),
      olderCursor: null,
      resumableSubagents: [{ toolCallId: 'tool-1' }],
    });
    expect(harness.historyReader.readSessionEvents).toHaveBeenCalledWith(
      SESSION_ID,
      WORKSPACE,
    );
    expect(harness.historyReader.readSessionHistory).not.toHaveBeenCalled();
  });

  it('rejects a caller-supplied workspace outside the open folders', async () => {
    const harness = makeHarness();
    await expect(
      harness.service.readPage({
        sessionId: SESSION_ID,
        workspacePath: '/outside/repo',
        cursor: 'h1:u2',
      }),
    ).rejects.toMatchObject({
      message: 'Access denied: workspace path is not an open folder.',
      errorCode: 'UNAUTHORIZED_WORKSPACE',
    });
    expect(harness.historyReader.readSessionEvents).not.toHaveBeenCalled();
  });

  it('rejects a page read when no workspace folder is open', async () => {
    const harness = makeHarness({ folders: [] });
    await expect(
      harness.service.readPage({ sessionId: SESSION_ID, cursor: 'h1:u2' }),
    ).rejects.toMatchObject({
      message:
        'No workspace folder open. Please open a folder before resuming a chat session.',
      errorCode: 'WORKSPACE_NOT_OPEN',
    });
    expect(harness.historyReader.readSessionEvents).not.toHaveBeenCalled();
  });

  it('rejects an unsafe open workspace path', async () => {
    const unsafeWorkspace = '/tmp/ptah-app';
    const harness = makeHarness({ folders: [unsafeWorkspace] });
    await expect(
      harness.service.readPage({
        sessionId: SESSION_ID,
        workspacePath: unsafeWorkspace,
        cursor: 'h1:u2',
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        'Cannot start a session in this folder:',
      ),
      errorCode: 'UNAUTHORIZED_WORKSPACE',
    });
    expect(harness.historyReader.readSessionEvents).not.toHaveBeenCalled();
  });
});
