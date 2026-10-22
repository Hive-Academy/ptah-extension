import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService } from '@ptah-extension/core';
import { type ArtifactRecord } from '@ptah-extension/shared';
import { ArtifactStore } from './artifact.store';

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
});
