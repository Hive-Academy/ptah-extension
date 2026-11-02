import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SessionHistoryRouter,
  SessionHistoryRouteError,
  type SessionMetadata,
} from '@ptah-extension/agent-sdk';
import {
  normalizeCodexWorkspaceKey,
  type CodexSessionHistory,
} from '@ptah-extension/codex-runtime';
import { PlatformType } from '@ptah-extension/platform-core';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import { SessionId, selectHistoryPage } from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';

import {
  ChatHistoryReadService,
  nativeHistoryRpcError,
} from '../chat/session/chat-history-read.service';

const root = mkdtempSync(join(tmpdir(), 'ptah-native-history-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const sessionId = SessionId.from('11111111-1111-4111-8111-111111111111');
const session: SessionMetadata = {
  sessionId,
  name: 'Native history',
  workspaceId: root,
  createdAt: 100,
  lastActiveAt: 200,
  totalCost: 0,
  totalTokens: { input: 0, output: 0 },
  codexExecution: {
    version: 1,
    runtime: 'codex-app-server',
    sessionId,
    providerId: 'codex',
    workspaceId: normalizeCodexWorkspaceKey(root, process.platform),
    codex: { normalizedHome: process.platform === 'win32' ? 'D:\\codex-home' : '/codex-home' },
  },
};

const snapshot: CodexSessionHistory = {
  rootThreadId: sessionId,
  threads: [{
    id: sessionId,
    parentThreadId: null,
    turns: [
      { id: 'turn-1', status: 'completed', startedAt: 100, completedAt: 110, itemsView: 'full', items: [
        { type: 'userMessage', id: 'user-1', content: [{ type: 'text', text: 'Hello' }] },
        { type: 'agentMessage', id: 'answer-1', text: 'Hi' },
      ] },
      { id: 'turn-2', status: 'completed', startedAt: 120, completedAt: 130, itemsView: 'full', items: [
        { type: 'userMessage', id: 'user-2', content: [{ type: 'text', text: 'Again' }] },
        { type: 'agentMessage', id: 'answer-2', text: 'Done' },
      ] },
    ],
    cliVersion: 'pinned', createdAt: 100, updatedAt: 200, cwd: root,
    ephemeral: false, modelProvider: 'openai', preview: '', projectId: null,
    sessionId: 'session', source: 'appServer', status: { type: 'idle' },
  }],
};

function harness(withPort = true) {
  const metadata = { get: jest.fn(async () => session) };
  const legacy = {
    readSessionHistory: jest.fn(async () => ({ events: [], stats: null })),
    readSessionEvents: jest.fn(async () => []),
  };
  const native = { readHistory: jest.fn(async () => snapshot) };
  const router = new SessionHistoryRouter(() => metadata, () => legacy, () => withPort ? native : null);
  const service = new ChatHistoryReadService(
    createMockLogger(),
    router,
    metadata,
    { getResumableBySession: jest.fn(() => []) },
    createMockWorkspaceProvider({ folders: [root] }),
    {
      type: PlatformType.CLI,
      extensionPath: join(tmpdir(), 'ptah-native-history-app'),
      globalStoragePath: join(tmpdir(), 'ptah-native-history-storage'),
      workspaceStoragePath: join(tmpdir(), 'ptah-native-history-workspace-storage'),
    },
  );
  return { service, legacy, native };
}

class PortError extends Error {
  override name = 'ElectronCodexHistoryError';
  constructor(readonly code: string) {
    super('private native detail D:\\secret');
  }
}

describe('native history RPC handoff', () => {
  it('returns the complete projection and uses base64url root cursors for older pages', async () => {
    const { service, legacy, native } = harness();
    const full = await service.readForResume(sessionId, { includeBlockOwners: true });
    expect(full.events).toContainEqual(expect.objectContaining({ eventType: 'text_delta', delta: 'Hi' }));
    expect(full.events).toContainEqual(expect.objectContaining({ eventType: 'text_delta', delta: 'Done' }));
    expect(full.stats).toBeNull();
    expect(full.resolvedWorkspacePath).toBe(root);

    const tail = selectHistoryPage(full.events, { endIndex: full.events.length, maxEvents: 1 });
    expect(tail.olderCursor).toMatch(/^h1:[A-Za-z0-9_-]+$/);
    if (!tail.olderCursor) throw new Error('Expected older cursor');
    const older = await service.readPage({ sessionId, cursor: tail.olderCursor, maxEvents: 1 });
    expect([...older.events, ...tail.events]).toEqual(full.events);
    expect(older.olderCursor).toBeNull();
    expect(older.resumableSubagents).toEqual([]);
    expect(native.readHistory).toHaveBeenCalledTimes(2);
    expect(legacy.readSessionHistory).not.toHaveBeenCalled();
    expect(legacy.readSessionEvents).not.toHaveBeenCalled();
  });

  it('returns an explicit coded error when the host has no native port', async () => {
    const { service, legacy } = harness(false);
    await expect(service.readForResume(sessionId)).rejects.toMatchObject({
      errorCode: 'HISTORY_UNAVAILABLE',
    });
    await expect(service.readPage({ sessionId, cursor: 'h1:ignored' })).rejects.toMatchObject({
      errorCode: 'HISTORY_UNAVAILABLE',
    });
    expect(legacy.readSessionHistory).not.toHaveBeenCalled();
  });

  it.each([
    ['invalidIdentity', 'HISTORY_UNAVAILABLE'],
    ['homeMismatch', 'HISTORY_UNAVAILABLE'],
    ['binaryUnavailable', 'HISTORY_UNAVAILABLE'],
    ['pathUnavailable', 'HISTORY_UNAVAILABLE'],
    ['threadNotFound', 'HISTORY_NOT_FOUND'],
    ['busy', 'HISTORY_BUSY'],
    ['timeout', 'HISTORY_TIMEOUT'],
    ['cancelled', 'HISTORY_CANCELLED'],
    ['runtimeFailed', 'HISTORY_FAILED'],
  ])('maps port code %s to %s without native text', async (portCode, rpcCode) => {
    const mapped = nativeHistoryRpcError(new PortError(portCode));
    expect(mapped?.errorCode).toBe(rpcCode);
    expect(mapped?.message).not.toContain('D:\\secret');
    const { service, native } = harness();
    native.readHistory.mockRejectedValue(new PortError(portCode));
    await expect(service.readForResume(sessionId)).rejects.toMatchObject({ errorCode: rpcCode });
    await expect(service.readPage({ sessionId, cursor: 'h1:ignored' }))
      .rejects.toMatchObject({ errorCode: rpcCode });
  });

  it.each([
    ['nativePortUnavailable', 'HISTORY_UNAVAILABLE'],
    ['invalidNativeIdentity', 'HISTORY_UNAVAILABLE'],
    ['nativeReadFailed', 'HISTORY_FAILED'],
  ] as const)('maps route code %s to %s', (routeCode, rpcCode) => {
    expect(nativeHistoryRpcError(new SessionHistoryRouteError(routeCode)))
      .toMatchObject({ errorCode: rpcCode });
  });

  it('replaces an unknown native exception with a fixed failure', async () => {
    const { service, native } = harness();
    native.readHistory.mockRejectedValue(new Error('private path D:\\secret'));
    await expect(service.readForResume(sessionId)).rejects.toMatchObject({
      errorCode: 'HISTORY_FAILED',
      message: 'Session history could not be read.',
    });
  });

  it('maps inherited object keys to the fixed failure code', () => {
    expect(nativeHistoryRpcError(new PortError('toString'))).toMatchObject({
      errorCode: 'HISTORY_FAILED',
      message: 'Session history could not be read.',
    });
  });
});
