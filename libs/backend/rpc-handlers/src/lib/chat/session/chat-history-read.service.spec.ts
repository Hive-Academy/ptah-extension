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
    metadata?: { workspaceId: string; workingDirectory?: string } | null;
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
    get: jest
      .fn()
      .mockResolvedValue(
        options.metadata === undefined
          ? { workspaceId: WORKSPACE }
          : options.metadata,
      ),
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
  const OTHER_PROJECT = '/c/projects/other';

  it("reads resume history from the session's own folder, not the active one", async () => {
    const harness = makeHarness({
      folders: [WORKSPACE, OTHER_PROJECT],
      metadata: { workspaceId: OTHER_PROJECT },
    });

    await expect(
      harness.service.readForResume(SESSION_ID),
    ).resolves.toMatchObject({ resolvedWorkspacePath: OTHER_PROJECT });
    expect(harness.historyReader.readSessionHistory).toHaveBeenCalledWith(
      SESSION_ID,
      OTHER_PROJECT,
      { checkCompactionBoundary: true },
    );
  });

  it('uses the saved worktree cwd for resume', async () => {
    const persisted = `${WORKSPACE}/.claude/worktrees/task`;
    const harness = makeHarness({
      metadata: { workspaceId: WORKSPACE, workingDirectory: persisted },
    });

    await expect(
      harness.service.readForResume(SESSION_ID),
    ).resolves.toMatchObject({ resolvedWorkspacePath: persisted });
  });

  it('refuses to resume when the session folder is not open', async () => {
    const harness = makeHarness({
      folders: [WORKSPACE],
      metadata: { workspaceId: OTHER_PROJECT },
    });

    await expect(
      harness.service.readForResume(SESSION_ID),
    ).rejects.toMatchObject({ errorCode: 'SESSION_FOLDER_UNAVAILABLE' });
    expect(harness.historyReader.readSessionHistory).not.toHaveBeenCalled();
  });

  it("reads a page from the session's own folder, not the active one", async () => {
    const harness = makeHarness({
      folders: [WORKSPACE, OTHER_PROJECT],
      metadata: { workspaceId: OTHER_PROJECT },
    });
    harness.historyReader.readSessionEvents.mockResolvedValue([
      { eventType: 'message_start', messageId: 'u2', role: 'user' },
    ] as FlatStreamEventUnion[]);

    await harness.service.readPage({ sessionId: SESSION_ID, cursor: 'h1:u2' });

    expect(harness.historyReader.readSessionEvents).toHaveBeenCalledWith(
      SESSION_ID,
      OTHER_PROJECT,
    );
  });

  it('rejects a page read for an unknown session', async () => {
    const harness = makeHarness({ metadata: null });
    await expect(
      harness.service.readPage({ sessionId: SESSION_ID, cursor: 'h1:u2' }),
    ).rejects.toMatchObject({ errorCode: 'SESSION_NOT_FOUND' });
    expect(harness.historyReader.readSessionEvents).not.toHaveBeenCalled();
  });

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
});
