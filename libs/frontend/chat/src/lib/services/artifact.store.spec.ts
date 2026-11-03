import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService } from '@ptah-extension/core';
import { type ArtifactRecord } from '@ptah-extension/shared';
import { ArtifactStore, panelArtifactsFrom } from './artifact.store';

const record = (id: string, sessionId = 'session-a', revision = 1): ArtifactRecord => ({
  id: id.padEnd(16, 'x'),
  title: id,
  revision,
  sessionId,
  viewerUrl: `ptah-artifact://${id.padEnd(16, 'x')}/index.html`,
  createdAt: '2026-10-20T12:00:00.000Z',
});

describe('ArtifactStore', () => {
  const activeTab = signal<string | null>(null);
  const call = jest.fn();
  let store: ArtifactStore;

  beforeEach(() => {
    activeTab.set(null);
    call.mockReset();
    TestBed.configureTestingModule({
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: TabManagerService, useValue: { activeTabId: activeTab } },
      ],
    });
    store = TestBed.inject(ArtifactStore);
    TestBed.flushEffects();
  });

  it('keeps records per session, deduplicates by id and caps each session', () => {
    const selected = store.forSession('session-a');
    store.upsert(record('one'));
    store.upsert(record('one', 'session-a', 2));
    store.upsert(record('two', 'session-b'));
    expect(selected().map((item) => item.revision)).toEqual([2]);
    expect(store.forSession('session-b')()).toHaveLength(1);

    for (let i = 0; i < 205; i++) store.upsert(record(`artifact-${i}`));
    expect(selected()).toHaveLength(200);
  });

  it('reloads the active session and ignores other session records', async () => {
    call.mockResolvedValue({ success: true, data: { artifacts: [record('one'), record('two', 'session-b')] } });
    activeTab.set('session-a');
    TestBed.flushEffects();
    await store.reload('session-a');
    expect(call).toHaveBeenCalledWith('artifacts:list', { sessionId: 'session-a' });
    expect(store.forSession('session-a')().map((item) => item.title)).toEqual(['one']);
    expect(store.forSession('session-b')()).toEqual([]);
  });

  it('keeps notifications and warns when reload data is invalid', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    store.upsert(record('one'));
    call.mockResolvedValue({ success: true, data: { artifacts: [{ html: '<script>bad</script>' }] } });
    await store.reload('session-a');
    expect(store.forSession('session-a')()).toHaveLength(1);
    expect(store.lastError()).toBe('Unable to load artifacts.');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps existing rows and exposes a failure when list RPC fails', async () => {
    store.upsert(record('one'));
    call.mockResolvedValue({ success: false, error: 'unavailable' });
    await store.reload('session-a');
    expect(store.forSession('session-a')()).toHaveLength(1);
    expect(store.lastError()).toBe('Unable to load artifacts.');
  });
  describe('panelArtifacts', () => {
    // Regression: the panel read only `records()[tabId]`, so a resumed session
    // whose publish was routed to another tab id showed "not loaded in this tab".
    it('returns the selected record when it lives in another session bucket', () => {
      const own = record('own', 'tab-1');
      const foreign = record('foreign', 'registry-tab');
      store.upsert(own);
      store.upsert(foreign);
      const listed = store.panelArtifacts('tab-1', foreign.id);
      expect(listed.map((item) => item.id)).toEqual([own.id, foreign.id]);
      expect(store.forSession('tab-1')()).toEqual([own]);
    });

    it('returns the tab bucket unchanged when the selection is already in it', () => {
      const own = record('own', 'tab-1');
      store.upsert(own);
      store.upsert({ ...own, sessionId: 'registry-tab' });
      expect(store.panelArtifacts('tab-1', own.id)).toBe(store.records()['tab-1']);
    });

    it('adds no entry for an unknown id, no selection or no tab', () => {
      const own = record('own', 'tab-1');
      store.upsert(own);
      store.upsert(record('foreign', 'registry-tab'));
      expect(store.panelArtifacts('tab-1', 'unknown-id-xxxxxx')).toEqual([own]);
      expect(store.panelArtifacts('tab-1', null)).toEqual([own]);
      expect(store.panelArtifacts(null, null)).toEqual([]);
    });

    it('keeps newest-first order across buckets', () => {
      const older = { ...record('older', 'tab-1'), createdAt: '2026-10-20T10:00:00.000Z' };
      const newer = { ...record('newer', 'registry-tab'), createdAt: '2026-10-20T11:00:00.000Z' };
      const ids = panelArtifactsFrom({ 'tab-1': [older], 'registry-tab': [newer] }, 'tab-1', newer.id)
        .map((item) => item.id);
      expect(ids).toEqual([newer.id, older.id]);
    });
  });

  describe('adoptPublishResult', () => {
    const publishResult = (id: string, sessionId: string, revision = 1) => ({
      ...record(id, sessionId, revision),
      savedPath: 'C:/ptah/artifacts/report.html',
    });

    // Regression: after an app restart `artifacts:list` returns nothing for a
    // session that is not live, so the panel had no record for a published card.
    it('makes a transcript publish result available to the panel when the list is empty', async () => {
      call.mockResolvedValue({ success: true, data: { artifacts: [] } });
      await store.reload('tile-tab');
      const raw = publishResult('restored', 'registry-tab');
      const adopted = await store.adoptPublishResult(raw);
      await store.reload('tile-tab');

      expect(adopted).toEqual(record('restored', 'registry-tab'));
      expect(adopted).not.toHaveProperty('savedPath');
      expect(store.recordById(raw.id)).toEqual(adopted);
      expect(store.panelArtifacts('tile-tab', raw.id)).toEqual([adopted]);
    });

    it('rejects an invalid publish result and keeps a newer stored revision', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect(await store.adoptPublishResult({ id: 'short', html: '<script>bad</script>' })).toBeNull();
      expect(await store.adoptPublishResult(record('no-saved-path'))).toBeNull();
      expect(store.records()).toEqual({});
      expect(warn).toHaveBeenCalledTimes(2);
      warn.mockRestore();

      store.upsert(record('kept', 'session-a', 3));
      await store.adoptPublishResult(publishResult('kept', 'session-a', 2));
      expect(store.recordById(record('kept').id)?.revision).toBe(3);
    });
  });

  it('numbers auto-open requests so the latest one wins', () => {
    expect(store.autoOpenRequest()).toBeNull();
    store.requestAutoOpen(record('one'));
    store.requestAutoOpen(record('two'));
    expect(store.autoOpenRequest()).toEqual({ record: record('two'), seq: 2 });
  });
});
