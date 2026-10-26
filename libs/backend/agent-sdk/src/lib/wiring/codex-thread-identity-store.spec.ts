import 'reflect-metadata';
import type { CodexThreadIdentity } from '@ptah-extension/codex-runtime';
import { createMockStateStorage } from '@ptah-extension/platform-core/testing';
import { SessionId } from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { Logger } from '@ptah-extension/vscode-core';
import {
  CodexSessionMetadataError,
  SessionMetadataStore,
} from '../session-metadata-store';
import {
  CodexThreadIdentityPersistError,
  createCodexThreadIdentityStore,
} from './codex-thread-identity-store';
import { initializeSessionRuntimeIdentityLookup } from './session-runtime-identity-cache';

function mockLogger(): Logger {
  return Object.assign(Object.create(Logger.prototype), createMockLogger());
}

const win = process.platform === 'win32';
const threadId = SessionId.from('44444444-4444-4444-8444-444444444444');
const workspacePath = win ? 'C:\\Work\\Project' : '/work/project';
const workspaceKey = win ? 'c:/work/project' : '/work/project';
const identity: CodexThreadIdentity = {
  threadId,
  contextId: 'context-1',
  processGeneration: 1,
  normalizedHome: '/home/codex',
  workspaceId: workspacePath,
  providerId: 'openai-codex',
  profileFingerprint: 'fingerprint-1',
};

async function fixture() {
  const logger = mockLogger();
  const metadata = new SessionMetadataStore(createMockStateStorage(), logger);
  const lookup = await initializeSessionRuntimeIdentityLookup(metadata, logger);
  const store = createCodexThreadIdentityStore(lookup, metadata);
  return { metadata, lookup, store };
}

describe('createCodexThreadIdentityStore', () => {
  it('persists only the identity mapping beside codexExecution and reads it back', async () => {
    const { metadata, store } = await fixture();
    await store.persist(identity);
    await expect(store.read('context-1')).resolves.toEqual(identity);
    const row = await metadata.get(threadId);
    expect(row?.codexThread).toEqual({
      version: 1,
      contextId: 'context-1',
      processGeneration: 1,
      workspaceId: workspacePath,
      profileFingerprint: 'fingerprint-1',
      state: 'active',
    });
    expect(row?.codexExecution).toEqual({
      version: 1,
      runtime: 'codex-app-server',
      sessionId: threadId,
      providerId: 'openai-codex',
      workspaceId: workspaceKey,
      codex: { normalizedHome: '/home/codex' },
    });
    await expect(store.read('context-unknown')).resolves.toBeUndefined();
  });

  it('keeps the runtime identity lookup in agreement after persist and markInactive', async () => {
    const { store, lookup } = await fixture();
    await store.persist(identity);
    const expected = {
      persisted: {
        version: 1,
        runtime: 'codex-app-server',
        sessionId: threadId,
        providerId: 'openai-codex',
        workspaceId: workspaceKey,
        codex: { normalizedHome: '/home/codex' },
      },
    };
    expect(lookup.lookup(threadId)).toEqual(expected);
    await store.markInactive(identity);
    expect(lookup.lookup(threadId)).toEqual(expected);
    lookup.dispose();
  });

  it('reads an old codexExecution record without the mapping as absent and still serves the lookup', async () => {
    const { metadata, lookup, store } = await fixture();
    // Shape written before the mapping existed: codexExecution only.
    await metadata.updateCodexExecution(threadId, () => ({
      version: 1,
      runtime: 'codex-app-server',
      sessionId: threadId,
      providerId: 'openai-codex',
      workspaceId: workspacePath,
      codex: { normalizedHome: '/home/codex' },
    }));
    expect((await metadata.get(threadId))?.codexThread).toBeUndefined();
    await expect(store.read('context-1')).resolves.toBeUndefined();
    await expect(store.markInactive(identity)).resolves.toBeUndefined();
    expect(lookup.lookup(threadId)?.persisted).toMatchObject({
      runtime: 'codex-app-server',
      workspaceId: workspaceKey,
    });
    // The old record upgrades in place on the next launch.
    await store.persist(identity);
    await expect(store.read('context-1')).resolves.toEqual(identity);
    lookup.dispose();
  });

  it('preserves the mapping across ordinary saves and rejects direct mapping writes', async () => {
    const { metadata, store } = await fixture();
    await store.persist(identity);
    const row = await metadata.get(threadId);
    if (!row) throw new Error('Missing Codex row');
    const { codexThread: stored, ...ordinary } = row;
    await metadata.save({ ...ordinary, name: 'Renamed' });
    expect((await metadata.get(threadId))?.codexThread).toEqual(stored);
    if (!stored) throw new Error('Missing mapping');
    await expect(
      metadata.save({
        ...row,
        codexThread: { ...stored, processGeneration: 9 },
      }),
    ).rejects.toBeInstanceOf(CodexSessionMetadataError);
  });

  it('rejects persist with a typed error carrying the cause when the write fails', async () => {
    const cause = new Error('disk full');
    const store = createCodexThreadIdentityStore(
      { updateCodexExecution: jest.fn().mockRejectedValue(cause) },
      { getAll: jest.fn(), get: jest.fn() },
    );
    const failure = store.persist(identity);
    await expect(failure).rejects.toBeInstanceOf(
      CodexThreadIdentityPersistError,
    );
    await expect(failure).rejects.toMatchObject({
      code: 'write-failed',
      cause,
    });
  });

  it('refuses persist over a legacy session record with a typed error', async () => {
    const { metadata, store } = await fixture();
    await metadata.create(threadId, workspacePath, 'legacy');
    const failure = store.persist(identity);
    await expect(failure).rejects.toMatchObject({
      name: 'CodexThreadIdentityPersistError',
      code: 'write-failed',
    });
    await failure.catch((error: unknown) => {
      expect(error).toBeInstanceOf(CodexThreadIdentityPersistError);
      if (error instanceof CodexThreadIdentityPersistError)
        expect(error.cause).toBeInstanceOf(CodexSessionMetadataError);
    });
  });

  it('refuses a stale generation or a different context for the same thread', async () => {
    const { store } = await fixture();
    await store.persist({ ...identity, processGeneration: 2 });
    await expect(store.persist(identity)).rejects.toMatchObject({
      code: 'stale-generation',
    });
    await expect(
      store.persist({ ...identity, contextId: 'context-2' }),
    ).rejects.toMatchObject({ code: 'context-mismatch' });
    await expect(store.read('context-1')).resolves.toMatchObject({
      processGeneration: 2,
    });
  });

  it('compares the complete identity before marking inactive', async () => {
    const { metadata, store } = await fixture();
    await store.persist(identity);
    const newer = { ...identity, processGeneration: 2 };
    await store.persist(newer);
    const state = async () =>
      (await metadata.get(threadId))?.codexThread?.state;

    await store.markInactive(identity);
    expect(await state()).toBe('active');
    await store.markInactive({ ...newer, contextId: 'context-2' });
    expect(await state()).toBe('active');
    await store.markInactive({ ...newer, profileFingerprint: 'other' });
    expect(await state()).toBe('active');
    await store.markInactive({ ...newer, normalizedHome: '/home/other' });
    expect(await state()).toBe('active');

    await store.markInactive(newer);
    expect(await state()).toBe('inactive');
  });

  it('skips the write and change event when markInactive does not match', async () => {
    const { metadata, store } = await fixture();
    await store.persist(identity);
    const changes = jest.fn();
    metadata.onMetadataChanged(changes);
    await store.markInactive({ ...identity, processGeneration: 7 });
    expect(changes).not.toHaveBeenCalled();
  });

  it('returns inactive identities for explicit resume', async () => {
    const { store } = await fixture();
    await store.persist(identity);
    await store.markInactive(identity);
    await expect(store.read('context-1')).resolves.toEqual(identity);
    // Resume reactivates the same thread under the next generation.
    await store.persist({ ...identity, processGeneration: 2 });
    await expect(store.read('context-1')).resolves.toMatchObject({
      processGeneration: 2,
    });
  });
});
