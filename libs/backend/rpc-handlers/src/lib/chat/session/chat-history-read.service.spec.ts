import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import 'reflect-metadata';

import { SessionId, type FlatStreamEventUnion, type SubagentRecord } from '@ptah-extension/shared';
import { SessionHistoryRouter, type SessionMetadata } from '@ptah-extension/agent-sdk';
import { PlatformType } from '@ptah-extension/platform-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';

import { ChatHistoryReadService } from './chat-history-read.service';

const TEST_ROOT = mkdtempSync(join(tmpdir(), 'ptah-policy-fixture-'));
afterAll(() => rmSync(TEST_ROOT, { recursive: true, force: true }));
mkdirSync(join(TEST_ROOT, 'repo/.claude/worktrees/task'), { recursive: true });
mkdirSync(join(TEST_ROOT, 'other'), { recursive: true });
const SESSION_ID = SessionId.from('11111111-1111-4111-8111-111111111111');
const WORKSPACE = join(TEST_ROOT, 'repo');
const resumableSubagent: SubagentRecord = {
  toolCallId: 'tool-1', agentType: 'Explore', agentId: 'agent-1',
  status: 'interrupted', startedAt: 0,
};

function sessionMetadata(workspaceId: string, workingDirectory?: string): SessionMetadata {
  return {
    sessionId: SESSION_ID, name: 'Fixture', workspaceId, workingDirectory,
    createdAt: 0, lastActiveAt: 0, totalCost: 0,
    totalTokens: { input: 0, output: 0 },
  };
}

function makeHarness(
  options: {
    folders?: string[];
    metadata?: { workspaceId: string; workingDirectory?: string } | null;
    lifecycle?: { find: jest.Mock };
  } = {},
) {
  const logger = createMockLogger();
  const historyReader = {
    readSessionHistory: jest
      .fn()
      .mockResolvedValue({ events: [], stats: null }),
    readSessionEvents: jest.fn().mockResolvedValue([]),
  };
  const initialMetadata = options.metadata === null
    ? null
    : sessionMetadata(
      options.metadata?.workspaceId ?? WORKSPACE,
      options.metadata?.workingDirectory,
    );
  const metadataStore = {
    get: jest.fn(async (_id: string): Promise<SessionMetadata | null> => initialMetadata),
  };
  const subagentRegistry = {
    getResumableBySession: jest.fn((): SubagentRecord[] => []),
  };
  const workspaceProvider = createMockWorkspaceProvider({
    folders: options.folders ?? [WORKSPACE],
  });
  const service = new ChatHistoryReadService(
    logger,
    new SessionHistoryRouter(() => metadataStore, () => historyReader, () => null),
    metadataStore,
    subagentRegistry,
    workspaceProvider,
    {
      type: PlatformType.CLI,
      extensionPath: join(TEST_ROOT, 'ptah-app'),
      globalStoragePath: join(TEST_ROOT, 'ptah-storage'),
      workspaceStoragePath: join(TEST_ROOT, 'ptah-workspace-storage'),
    },
    options.lifecycle,
  );
  return {
    service,
    historyReader,
    metadataStore,
    subagentRegistry,
  };
}

describe('ChatHistoryReadService', () => {
  const OTHER_PROJECT = join(TEST_ROOT, 'other');

  it('passes the ownership option through for resume reads', async () => {
    const harness = makeHarness();
    await harness.service.readForResume(SESSION_ID, {
      includeBlockOwners: true,
    });
    expect(harness.historyReader.readSessionHistory).toHaveBeenCalledWith(
      SESSION_ID,
      WORKSPACE,
      { checkCompactionBoundary: true, includeBlockOwners: true },
    );
  });

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
    const persisted = join(WORKSPACE, '.claude', 'worktrees', 'task');
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

  it('resolves a live session addressed by its tab id through its real id', async () => {
    const TAB_ID = SessionId.from('bdf3aa78-499e-416d-b7de-f0345568f8eb');
    const lifecycle = {
      find: jest.fn((id: string) =>
        id === TAB_ID
          ? { tabId: TAB_ID, realSessionId: SESSION_ID }
          : undefined,
      ),
    };
    const harness = makeHarness({ lifecycle });
    harness.metadataStore.get.mockImplementation(async (id: string) =>
      id === SESSION_ID ? sessionMetadata(WORKSPACE) : null,
    );

    await expect(harness.service.resolveSessionFolder(TAB_ID)).resolves.toBe(
      WORKSPACE,
    );
    expect(harness.metadataStore.get).toHaveBeenCalledWith(SESSION_ID);
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
    harness.subagentRegistry.getResumableBySession.mockReturnValue([resumableSubagent]);

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
      resumableSubagents: [resumableSubagent],
    });
    expect(harness.historyReader.readSessionEvents).toHaveBeenCalledWith(
      SESSION_ID,
      WORKSPACE,
    );
    expect(harness.historyReader.readSessionHistory).not.toHaveBeenCalled();
  });
});
