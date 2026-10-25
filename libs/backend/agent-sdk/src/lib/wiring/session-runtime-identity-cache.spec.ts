import 'reflect-metadata';
import { SessionId, type SessionRuntimeIdentity } from '@ptah-extension/shared';
import { Logger } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type {
  SessionMetadata,
  SessionMetadataStore,
} from '../session-metadata-store';
import { initializeSessionRuntimeIdentityLookup } from './session-runtime-identity-cache';
import { createCodexChatMetadataPort } from './codex-chat-metadata-port';
function mockLogger(): Logger {
  return Object.assign(Object.create(Logger.prototype), createMockLogger());
}
describe('persisted runtime identity cache', () => {
  const id = SessionId.from('33333333-3333-4333-8333-333333333333');
  const identity: Extract<
    SessionRuntimeIdentity,
    { runtime: 'codex-app-server' }
  > = {
    version: 1,
    sessionId: id,
    runtime: 'codex-app-server',
    providerId: 'openai-codex',
    workspaceId: process.platform === 'win32' ? 'D:/workspace' : '/workspace',
    codex: {
      normalizedHome: process.platform === 'win32' ? 'd:\\home' : '/home',
    },
  };
  const row = (providerId = 'openai-codex'): SessionMetadata => ({
    sessionId: id,
    name: 'session',
    providerId,
    workspaceId: process.platform === 'win32' ? 'D:/workspace' : '/workspace',
    createdAt: 1,
    lastActiveAt: 1,
    totalCost: 0,
    totalTokens: { input: 0, output: 0 },
    codexExecution: { ...identity, providerId },
  });
  function fixture(rows: SessionMetadata[] = [row()]) {
    let listener: Parameters<SessionMetadataStore['onMetadataChanged']>[0];
    const unsubscribe = jest.fn();
    const get = jest
      .fn<Promise<SessionMetadata | null>, [string]>()
      .mockResolvedValue(row());
    const store = {
      getAll: jest.fn().mockResolvedValue(rows),
      get,
      onMetadataChanged: (callback: typeof listener) => {
        listener = callback;
        return unsubscribe;
      },
      updateCodexExecution: jest.fn(
        async (
          _id: string,
          updater: Parameters<SessionMetadataStore['updateCodexExecution']>[1],
        ) => {
          const execution = updater(undefined);
          get.mockResolvedValue({ ...row(), codexExecution: execution });
        },
      ),
    };
    return {
      store,
      unsubscribe,
      emit: (kind: 'updated' | 'deleted' = 'updated') =>
        listener({
          sessionId: id,
          workspaceId:
            process.platform === 'win32' ? 'D:/workspace' : '/workspace',
          kind,
        }),
    };
  }
  const drain = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  it('preloads persisted identities and disposes its subscription', async () => {
    const f = fixture();
    const lookup = await initializeSessionRuntimeIdentityLookup(
      f.store,
      mockLogger(),
    );
    expect(lookup.lookup(id)?.persisted).toEqual(identity);
    lookup.dispose();
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
    expect(lookup.lookup(id)).toBeUndefined();
  });

  it('writes through before metadata.save resolves and supersedes older event reads', async () => {
    const f = fixture([]);
    const lookup = await initializeSessionRuntimeIdentityLookup(
      f.store,
      mockLogger(),
    );
    let resolveRead!: (value: SessionMetadata | null) => void;
    f.store.get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    f.emit();
    await createCodexChatMetadataPort(lookup).save(id, {
      threadId: id,
      contextId: 'context',
      processGeneration: 1,
      providerId: identity.providerId,
      normalizedHome: identity.codex.normalizedHome,
      workspaceId: identity.workspaceId,
      profileFingerprint: 'profile',
    });
    expect(lookup.lookup(id)?.persisted?.providerId).toBe('openai-codex');
    resolveRead(row('stale'));
    await drain();
    expect(lookup.lookup(id)?.persisted?.providerId).toBe('openai-codex');
    lookup.dispose();
  });

  it('ignores an out-of-order change event response', async () => {
    const f = fixture();
    const lookup = await initializeSessionRuntimeIdentityLookup(
      f.store,
      mockLogger(),
    );
    let first!: (value: SessionMetadata | null) => void;
    let second!: (value: SessionMetadata | null) => void;
    f.store.get
      .mockReturnValueOnce(
        new Promise((resolve) => {
          first = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          second = resolve;
        }),
      );
    f.emit();
    f.emit();
    second(row('newer'));
    await drain();
    first(row('older'));
    await drain();
    expect(lookup.lookup(id)?.persisted?.providerId).toBe('newer');
    lookup.dispose();
  });

  it('release preserves native identity and deletion removes it', async () => {
    const f = fixture();
    const lookup = await initializeSessionRuntimeIdentityLookup(
      f.store,
      mockLogger(),
    );
    let resolveRead!: (value: SessionMetadata | null) => void;
    f.store.get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    f.emit();
    lookup.releaseSession(id);
    resolveRead(row());
    await drain();
    expect(lookup.lookup(id)?.persisted).toEqual(identity);
    f.emit();
    await drain();
    expect(lookup.lookup(id)).toBeDefined();
    f.emit('deleted');
    expect(lookup.lookup(id)).toBeUndefined();
    lookup.dispose();
  });

  it('does not resurrect a deleted binding from an outstanding refresh', async () => {
    const f = fixture();
    const lookup = await initializeSessionRuntimeIdentityLookup(
      f.store,
      mockLogger(),
    );
    let complete = (_value: SessionMetadata | null): void => {
      throw new Error('Read not started');
    };
    f.store.get.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    f.emit();
    f.emit('deleted');
    complete(row());
    await drain();
    expect(lookup.lookup(id)).toBeUndefined();
    lookup.dispose();
  });

  it('keeps a missing session unbound for legacy routing', async () => {
    const f = fixture([]);
    const lookup = await initializeSessionRuntimeIdentityLookup(
      f.store,
      mockLogger(),
    );
    expect(lookup.lookup(id)).toBeUndefined();
    lookup.dispose();
  });

  it('retains and logs the old native binding when refresh fails', async () => {
    const f = fixture();
    const logger = mockLogger();
    const lookup = await initializeSessionRuntimeIdentityLookup(
      f.store,
      logger,
    );
    f.store.get.mockRejectedValueOnce(new Error('private detail'));
    f.emit();
    await drain();
    await drain();
    expect(lookup.lookup(id)?.persisted).toEqual(identity);
    expect(logger.warn).toHaveBeenCalledWith(
      '[AgentSDK] Runtime identity refresh failed; retaining binding',
    );
    lookup.dispose();
  });
});
