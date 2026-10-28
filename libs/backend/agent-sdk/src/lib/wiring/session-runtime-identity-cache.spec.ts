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
      updateCodexExecution: jest.fn<
        ReturnType<SessionMetadataStore['updateCodexExecution']>,
        Parameters<SessionMetadataStore['updateCodexExecution']>
      >(
        async (
          _id,
          updater: Parameters<SessionMetadataStore['updateCodexExecution']>[1],
        ) => {
          const execution = updater(undefined);
          get.mockResolvedValue({ ...row(), codexExecution: execution });
        },
      ),
      incrementCodexMessageCount: jest.fn(async () => undefined),
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

  const rawRow = (workspacePath = 'C:\\Users\\abdal\\proj'): SessionMetadata => ({
    ...row(),
    codexExecution: { ...identity, workspaceId: 'c:/users/abdal/proj' },
    codexThread: {
      version: 1,
      contextId: 'context',
      processGeneration: 1,
      workspaceId: workspacePath,
      profileFingerprint: 'profile',
      state: 'inactive',
    },
  });

  it('preserves the raw Windows path alongside the normalized identity after native release', async () => {
    const f = fixture([rawRow()]);
    const lookup = await initializeSessionRuntimeIdentityLookup(
      f.store,
      mockLogger(),
    );
    expect(lookup.lookup(id)?.persisted?.workspaceId).toBe('c:/users/abdal/proj');
    expect(lookup.lookup(id)?.workspacePath).toBe('C:\\Users\\abdal\\proj');
    lookup.releaseSession(id);
    expect(lookup.lookup(id)?.workspacePath).toBe('C:\\Users\\abdal\\proj');
    lookup.dispose();
    expect(lookup.lookup(id)).toBeUndefined();
  });

  it('refreshes the raw path and removes it when thread metadata disappears', async () => {
    const f = fixture([rawRow()]);
    const lookup = await initializeSessionRuntimeIdentityLookup(
      f.store,
      mockLogger(),
    );
    f.store.get.mockResolvedValue(rawRow('C:\\Users\\Abdal\\proj\\'));
    f.emit();
    await drain();
    expect(lookup.lookup(id)?.workspacePath).toBe('C:\\Users\\Abdal\\proj\\');
    f.store.get.mockResolvedValue(row());
    f.emit();
    await drain();
    expect(lookup.lookup(id)?.workspacePath).toBeUndefined();
    lookup.dispose();
  });

  it.each(['delete', 'release'] as const)(
    'clears the raw path on %s before the session id is reused',
    async (action) => {
      const metadata = rawRow();
      const f = fixture([
        action === 'release' ? { ...metadata, codexExecution: undefined } : metadata,
      ]);
      const lookup = await initializeSessionRuntimeIdentityLookup(
        f.store,
        mockLogger(),
      );
      if (action === 'delete') f.emit('deleted');
      else lookup.releaseSession(id);
      expect(lookup.lookup(id)).toBeUndefined();
      f.store.get.mockRejectedValueOnce(new Error('unavailable'));
      await lookup.updateCodexExecution(id, () => identity);
      expect(lookup.lookup(id)?.workspacePath).toBeUndefined();
      lookup.dispose();
    },
  );

  it('publishes the raw path from the authoritative metadata re-read after a write', async () => {
    const f = fixture([]);
    const lookup = await initializeSessionRuntimeIdentityLookup(
      f.store,
      mockLogger(),
    );
    f.store.get.mockResolvedValueOnce(rawRow());
    await lookup.updateCodexExecution(id, () => identity);
    expect(lookup.lookup(id)).toEqual({
      persisted: rawRow().codexExecution,
      workspacePath: 'C:\\Users\\abdal\\proj',
    });
    lookup.dispose();
  });

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

  it('forwards the optional native title through the routing cache writer', async () => {
    const f = fixture([]);
    const lookup = await initializeSessionRuntimeIdentityLookup(f.store, mockLogger());
    await lookup.updateCodexExecution(id, () => identity, undefined, 'Native title');
    expect(f.store.updateCodexExecution.mock.calls[0][3]).toBe('Native title');
    expect(lookup.lookup(id)?.persisted).toEqual(identity);
    lookup.dispose();
  });

  it.each(['rejected', 'missing'] as const)(
    'retains the newly written identity when the authoritative re-read is %s',
    async (result) => {
      const f = fixture([]);
      const logger = mockLogger();
      const lookup = await initializeSessionRuntimeIdentityLookup(
        f.store,
        logger,
      );
      if (result === 'rejected')
        f.store.get.mockRejectedValueOnce(new Error('private detail'));
      else f.store.get.mockResolvedValueOnce(null);
      await expect(
        lookup.updateCodexExecution(id, () => identity),
      ).resolves.toBeUndefined();
      expect(lookup.lookup(id)?.persisted).toEqual(identity);
      expect(logger.warn).toHaveBeenCalledWith(
        '[CodexRuntimeComposition] Runtime identity re-read failed; retaining written binding',
        { code: 'persisted-identity-unavailable' },
      );
      lookup.dispose();
    },
  );

  it('does not cache a proposal whose persistence fails', async () => {
    const f = fixture([]);
    const lookup = await initializeSessionRuntimeIdentityLookup(
      f.store,
      mockLogger(),
    );
    f.store.updateCodexExecution.mockImplementationOnce(
      async (_id, updater) => {
        updater(undefined);
        throw new Error('write failed');
      },
    );
    await expect(
      lookup.updateCodexExecution(id, () => identity),
    ).rejects.toThrow('write failed');
    expect(lookup.lookup(id)).toBeUndefined();
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
      '[CodexRuntimeComposition] Runtime identity refresh failed; retaining binding',
    );
    lookup.dispose();
  });
});
