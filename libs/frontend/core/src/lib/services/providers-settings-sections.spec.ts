import { signal } from '@angular/core';
import type { RpcMethodName } from '@ptah-extension/shared';
import { RpcResult } from './claude-rpc.service';
import {
  createSectionStore,
  effortFreshSectionView,
  readSection,
  requireRpcData,
  SECTION_LOAD_ERROR,
  sectionView,
} from './providers-settings-sections';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('providers-settings-sections', () => {
  const scopeKey = signal('workspace-a');
  const workspace = { scopeKey };
  beforeEach(() => scopeKey.set('workspace-a'));

  describe('createSectionStore', () => {
    it('starts unloaded with no data, no error and no read', () => {
      const store = createSectionStore<string>();
      expect(store.value()).toEqual({ status: 'unloaded', data: null, error: null });
      expect(store.generation).toBe(0);
      expect(store.scopeKey).toBe('');
    });
  });

  describe('readSection', () => {
    it('publishes ready data for the workspace it was read in', async () => {
      const store = createSectionStore<string>();
      await readSection(store, workspace, async () => 'value');
      expect(store.value()).toEqual({ status: 'ready', data: 'value', error: null });
      expect(store.scopeKey).toBe('workspace-a');
    });

    it('keeps previous data while loading and after a failure, with only the fixed retry text', async () => {
      const store = createSectionStore<string>();
      await readSection(store, workspace, async () => 'saved');
      const pending = deferred<string>();
      const reading = readSection(store, workspace, () => pending.promise);
      expect(store.value()).toEqual({ status: 'loading', data: 'saved', error: null });
      pending.reject(new Error('raw host text with secret'));
      await reading;
      expect(store.value()).toEqual({ status: 'error', data: 'saved', error: SECTION_LOAD_ERROR });
      expect(JSON.stringify(store.value())).not.toContain('secret');
    });

    it('discards a superseded read', async () => {
      const store = createSectionStore<string>();
      const older = deferred<string>();
      const first = readSection(store, workspace, () => older.promise);
      await readSection(store, workspace, async () => 'newer');
      older.resolve('older');
      await first;
      expect(store.value().data).toBe('newer');
    });

    it('publishes nothing when the workspace switches mid-read and drops the other workspace data', async () => {
      const store = createSectionStore<string>();
      await readSection(store, workspace, async () => 'from-a');
      const pending = deferred<string>();
      const reading = readSection(store, workspace, () => pending.promise);
      scopeKey.set('workspace-b');
      pending.resolve('late-a');
      await reading;
      expect(store.value().status).toBe('loading');
      const next = deferred<string>();
      const readingB = readSection(store, workspace, () => next.promise);
      // Data read in workspace A is never shown while workspace B loads.
      expect(store.value()).toEqual({ status: 'loading', data: null, error: null });
      next.resolve('from-b');
      await readingB;
      expect(store.value().data).toBe('from-b');
    });
  });

  describe('sectionView', () => {
    it('shows a value read in another workspace as unloaded', async () => {
      const store = createSectionStore<string>();
      const view = sectionView(store, workspace);
      await readSection(store, workspace, async () => 'from-a');
      expect(view()).toEqual({ status: 'ready', data: 'from-a', error: null });
      scopeKey.set('workspace-b');
      expect(view()).toEqual({ status: 'unloaded', data: null, error: null });
    });
  });

  describe('effortFreshSectionView', () => {
    const pending = signal(0);
    const revision = signal(0);
    const effortChanges = { pending, revision };
    beforeEach(() => {
      pending.set(0);
      revision.set(0);
    });

    it('hides the value while an effort change is pending or after a newer change', async () => {
      const store = createSectionStore<string>();
      const readRevision = signal(0);
      const view = effortFreshSectionView(store, readRevision, workspace, effortChanges);
      expect(view().status).toBe('unloaded');
      await readSection(store, workspace, async () => 'high');
      expect(view()).toEqual({ status: 'ready', data: 'high', error: null });
      pending.set(1);
      expect(view()).toEqual({ status: 'loading', data: null, error: null });
      pending.set(0);
      revision.set(1);
      expect(view()).toEqual({ status: 'loading', data: null, error: null });
      readRevision.set(1);
      expect(view().data).toBe('high');
    });

    it('never keeps previous data after a failed read', async () => {
      const store = createSectionStore<string>();
      const view = effortFreshSectionView(store, () => 0, workspace, effortChanges);
      await readSection(store, workspace, async () => 'high');
      await readSection(store, workspace, async () => {
        throw new Error('failed');
      });
      expect(view()).toEqual({ status: 'error', data: null, error: SECTION_LOAD_ERROR });
    });
  });

  describe('requireRpcData', () => {
    it('returns the data and passes a timeout only when one is given', async () => {
      const call = jest.fn(async () => new RpcResult(true, { model: 'm' }));
      const rpc = { call } as unknown as Parameters<typeof requireRpcData>[0];
      await expect(requireRpcData(rpc, 'config:model-get', {})).resolves.toEqual({ model: 'm' });
      await requireRpcData(rpc, 'config:model-get', {}, 5000);
      expect(call.mock.calls).toEqual([
        ['config:model-get', {}, undefined],
        ['config:model-get', {}, { timeout: 5000 }],
      ]);
    });

    it('throws a fixed message that never carries the host error text', async () => {
      const rpc = {
        call: jest.fn(async (method: RpcMethodName) => new RpcResult(false, undefined, `${method}: key sk-secret`)),
      } as unknown as Parameters<typeof requireRpcData>[0];
      await expect(requireRpcData(rpc, 'config:model-get', {})).rejects.toThrow(
        new Error('Settings request failed'),
      );
    });
  });
});
