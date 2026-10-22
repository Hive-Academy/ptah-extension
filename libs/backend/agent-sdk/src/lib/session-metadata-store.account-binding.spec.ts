import 'reflect-metadata';
import type { ProviderAccountBinding } from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockStateStorage } from '@ptah-extension/platform-core/testing';
import {
  SessionMetadataStore, sessionIndexEntry, toSessionRecordInput,
  SESSION_METADATA_MIGRATION, type SessionMetadata,
} from './session-metadata-store';

const key = 'ptah.sessionMetadata';
const binding: ProviderAccountBinding = {
  version: 1, provider: 'claude', profileId: 'profile-0001', runId: 'run-00001',
  routeFingerprint: 'a'.repeat(64), routeRevision: 0, authEpoch: 0,
  identity: { kind: 'known', ownerKey: 'b'.repeat(64) },
};
const metadata: SessionMetadata = {
  sessionId: 'sdk-session-0001', workspaceId: '/workspace', name: 'Session',
  createdAt: 1, lastActiveAt: 1, totalCost: 0, totalTokens: { input: 0, output: 0 },
};
const otherRoute: ProviderAccountBinding = { ...binding, profileId: 'profile-0002', routeFingerprint: 'c'.repeat(64) };

function fixture() {
  const storage = createMockStateStorage();
  const logger = createMockLogger();
  return { storage, logger, store: new SessionMetadataStore(storage, logger) };
}

describe('immutable session account linkage', () => {
  it('keeps genuinely absent legacy records ambient', async () => {
    const { store } = fixture();
    await store.save(metadata);
    await expect(store.resolveAccountBinding(metadata.sessionId, async () => ({ status: 'absent' }))).resolves.toBeNull();
    expect((await store.get(metadata.sessionId))?.accountBinding).toBeUndefined();
  });

  it.each([null, undefined, {}, { ...binding, authEpoch: -1 },
    { ...binding, identity: { kind: 'known', ownerKey: 'email@example.com' } },
    { ...binding, directory: '/private/account' },
    { ...binding, profileId: '/private/account' },
  ])('refuses present malformed linkage on detail, list and projection', async accountBinding => {
    const { storage, store } = fixture();
    storage.__state.seed(key, [{ ...metadata, accountBinding }]);
    await expect(store.get(metadata.sessionId)).rejects.toMatchObject({ code: 'invalid-bound' });
    await expect(store.getAll()).rejects.toMatchObject({ code: 'invalid-bound' });
    const corrupted = storage.get<SessionMetadata[]>(key)?.[0];
    if (!corrupted) throw new Error('Missing fixture');
    expect(() => sessionIndexEntry(corrupted)).toThrow(expect.objectContaining({ code: 'invalid-bound' }));
    expect(() => toSessionRecordInput(corrupted)).toThrow(expect.objectContaining({ code: 'invalid-bound' }));
  });

  it('refuses malformed writes without sending paths to storage or logs', async () => {
    const { store, storage, logger } = fixture();
    const unsafe = { ...binding, directory: '/private/account' };
    await expect(store.saveAccountBound(metadata, unsafe)).rejects.toMatchObject({ code: 'invalid-bound' });
    expect(storage.update).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('roundtrips a frozen path-free snapshot in detail and summary', async () => {
    const { store, storage, logger } = fixture();
    await store.saveAccountBound(metadata, binding);
    const restored = await new SessionMetadataStore(storage, logger).get(metadata.sessionId);
    expect(restored?.accountBinding).toEqual(binding);
    expect(Object.isFrozen(restored?.accountBinding)).toBe(true);
    expect(Object.isFrozen(restored?.accountBinding?.identity)).toBe(true);
    if (!restored) throw new Error('Missing fixture');
    const record = toSessionRecordInput(restored);
    expect(record.summary['accountBinding']).toEqual(binding);
    expect(record.detail['accountBinding']).toEqual(binding);
    expect(SESSION_METADATA_MIGRATION.summaryFields).toContainEqual({ sourcePath: ['accountBinding'] });
    expect(JSON.stringify(restored.accountBinding)).not.toContain(metadata.workspaceId);
    expect(JSON.stringify(restored.accountBinding)).not.toContain('directory');
  });

  it('persists unknown identity but refuses resume', async () => {
    const { store } = fixture();
    const unknown: ProviderAccountBinding = { ...binding, identity: { kind: 'unknown' } };
    await store.saveAccountBound(metadata, unknown);
    expect((await store.get(metadata.sessionId))?.accountBinding).toEqual(unknown);
    await expect(store.resolveAccountBinding(metadata.sessionId, async () => ({ status: 'bound', binding: unknown })))
      .rejects.toMatchObject({ code: 'identity-unproved' });
  });

  it.each([otherRoute, { ...binding, authEpoch: 1 }, { ...binding, runId: 'run-00002' },
    { ...binding, identity: { kind: 'unknown' } } satisfies ProviderAccountBinding,
  ])('refuses rebind without changing the stored linkage', async replacement => {
    const { store } = fixture();
    await store.saveAccountBound(metadata, binding);
    await expect(store.saveAccountBound(metadata, replacement)).rejects.toMatchObject({ code: 'binding-conflict' });
    expect((await store.get(metadata.sessionId))?.accountBinding).toEqual(binding);
  });

  it('preserves linkage on ordinary completion updates with an omitted field', async () => {
    const { store } = fixture();
    await store.saveAccountBound(metadata, binding);
    await store.save({ ...metadata, totalCost: 4 });
    expect(await store.get(metadata.sessionId)).toMatchObject({ accountBinding: binding, totalCost: 4 });
  });

  it('explicitly refuses a same-id import from another route before the skip check', async () => {
    const { store } = fixture();
    await store.saveAccountBound(metadata, binding);
    await expect(store.getAccountBound(metadata.sessionId, otherRoute)).rejects.toMatchObject({ code: 'binding-conflict' });
    await expect(store.saveAccountBound(metadata, otherRoute)).rejects.toMatchObject({ code: 'binding-conflict' });
    await expect(store.getAccountBound(metadata.sessionId, binding)).resolves.toMatchObject({ accountBinding: binding });
  });

  it('does not reclassify an existing ambient session as a named import', async () => {
    const { store } = fixture();
    await store.save(metadata);
    await expect(store.saveAccountBound(metadata, binding)).rejects.toMatchObject({ code: 'binding-conflict' });
    await expect(store.getAccountBound(metadata.sessionId, binding)).rejects.toMatchObject({ code: 'binding-conflict' });
  });

  it('resolves server linkage before classifying local absence', async () => {
    const { store } = fixture();
    await store.save(metadata);
    const read = jest.spyOn(store, 'get');
    const lookup = jest.fn(async () => {
      expect(read).not.toHaveBeenCalled();
      return { status: 'bound' as const, binding };
    });
    await expect(store.resolveAccountBinding(metadata.sessionId, lookup)).resolves.toEqual(binding);
    expect(lookup).toHaveBeenCalledWith(metadata.sessionId);
  });

  it.each(['unavailable-storage', 'invalid-bound'] as const)('refuses %s without reading legacy metadata', async status => {
    const { store } = fixture();
    const read = jest.spyOn(store, 'get');
    await expect(store.resolveAccountBinding(metadata.sessionId, async () => ({ status }))).rejects.toMatchObject({ code: status });
    expect(read).not.toHaveBeenCalled();
  });

  it('refuses a dangling metadata linkage and a conflicting server binding', async () => {
    const { store } = fixture();
    await store.saveAccountBound(metadata, binding);
    await expect(store.resolveAccountBinding(metadata.sessionId, async () => ({ status: 'absent' }))).rejects.toMatchObject({ code: 'invalid-bound' });
    await expect(store.resolveAccountBinding(metadata.sessionId, async () => ({ status: 'bound', binding: otherRoute }))).rejects.toMatchObject({ code: 'binding-conflict' });
  });

  it('does not resolve a named write before its storage update, even with another queued write', async () => {
    const { store, storage } = fixture();
    let release: (() => void) | undefined;
    const persisted = new Promise<void>(resolve => { release = resolve; });
    storage.update.mockImplementationOnce(async () => persisted);
    let admitted = false;
    const first = store.saveAccountBound(metadata, binding).then(() => { admitted = true; });
    const second = store.save({ ...metadata, sessionId: 'sdk-session-0002' });
    await Promise.resolve();
    await Promise.resolve();
    expect(admitted).toBe(false);
    release?.();
    await Promise.all([first, second]);
    expect(admitted).toBe(true);
  });

  it('propagates a metadata write failure and leaves no durable ambient record', async () => {
    const { store, storage, logger } = fixture();
    storage.update.mockRejectedValue(new Error('fixture write failed'));
    await expect(store.saveAccountBound(metadata, binding)).rejects.toThrow('fixture write failed');
    expect(storage.__state.entries.size).toBe(0);
    await expect(new SessionMetadataStore(storage, logger).get(metadata.sessionId)).resolves.toBeNull();
  });
});
