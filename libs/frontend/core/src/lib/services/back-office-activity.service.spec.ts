import { TestBed } from '@angular/core/testing';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

import {
  ACTIVITY_IDLE_AFTER_MS,
  ACTIVITY_RING_CAPACITY,
  BackOfficeActivityService,
} from './back-office-activity.service';
import { WorkspaceScopeService } from './workspace-scope.service';

function send(
  service: BackOfficeActivityService,
  type: string,
  payload: unknown,
): void {
  service.handleMessage({ type, payload });
}

describe('BackOfficeActivityService', () => {
  let service: BackOfficeActivityService;
  let workspaceScope: WorkspaceScopeService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    TestBed.configureTestingModule({});
    workspaceScope = TestBed.inject(WorkspaceScopeService);
    service = TestBed.inject(BackOfficeActivityService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('starts empty and idle', () => {
    expect(service.recent()).toEqual([]);
    expect(service.latest()).toBeNull();
    expect(service.isIdle()).toBe(true);
  });

  it('passes a well-formed activity:event straight through', () => {
    send(service, MESSAGE_TYPES.ACTIVITY_EVENT, {
      source: 'cron',
      kind: 'cron-run',
      summary: 'Daily backup finished',
      timestamp: 1000,
      level: 'info',
    });

    expect(service.latest()).toMatchObject({
      source: 'cron',
      kind: 'cron-run',
      summary: 'Daily backup finished',
      level: 'info',
    });
  });

  it('drops a malformed activity:event without changing anything', () => {
    send(service, MESSAGE_TYPES.ACTIVITY_EVENT, {
      source: 'not-a-source',
      kind: 'x',
      summary: 'x',
      timestamp: 1,
    });
    send(service, MESSAGE_TYPES.ACTIVITY_EVENT, null);

    expect(service.recent()).toEqual([]);
    expect(service.isIdle()).toBe(true);
  });

  it('admits an empty summary, so the renderer fallback stays reachable', () => {
    send(service, MESSAGE_TYPES.ACTIVITY_EVENT, {
      source: 'harness',
      kind: 'reconcile',
      summary: '',
      timestamp: 5,
    });

    expect(service.latest()?.summary).toBe('');
  });

  it('bounds the ring at 50 items, newest first', () => {
    for (let i = 0; i < 60; i++) {
      // Distinct kinds so nothing coalesces.
      send(service, MESSAGE_TYPES.ACTIVITY_EVENT, {
        source: 'cron',
        kind: `run-${i}`,
        summary: `run ${i}`,
        timestamp: i,
      });
    }

    expect(service.recent()).toHaveLength(ACTIVITY_RING_CAPACITY);
    expect(service.recent()[0].summary).toBe('run 59');
    expect(service.recent()[ACTIVITY_RING_CAPACITY - 1].summary).toBe('run 10');
  });

  it('coalesces 100 indexing:progress messages 10 ms apart into one slot', () => {
    for (let i = 1; i <= 100; i++) {
      send(service, MESSAGE_TYPES.INDEXING_PROGRESS, {
        pipeline: 'symbols',
        percent: i,
        currentLabel: `file-${i}.ts`,
        elapsedMs: i * 10,
        totalKnown: true,
      });
      jest.advanceTimersByTime(10);
    }

    expect(service.recent()).toHaveLength(1);
    expect(service.latest()?.summary).toBe('Indexing 100% — file-100.ts');
  });

  it('keeps the ring slot id stable while coalescing', () => {
    send(service, MESSAGE_TYPES.INDEXING_PROGRESS, {
      pipeline: 'symbols',
      percent: 1,
      currentLabel: 'a.ts',
      elapsedMs: 1,
      totalKnown: true,
    });
    const firstId = service.latest()?.id;

    jest.advanceTimersByTime(10);
    send(service, MESSAGE_TYPES.INDEXING_PROGRESS, {
      pipeline: 'symbols',
      percent: 2,
      currentLabel: 'b.ts',
      elapsedMs: 2,
      totalKnown: true,
    });

    expect(service.latest()?.id).toBe(firstId);
  });

  it('gives two indexing:progress messages 2 s apart two slots', () => {
    send(service, MESSAGE_TYPES.INDEXING_PROGRESS, {
      pipeline: 'symbols',
      percent: 10,
      currentLabel: 'a.ts',
      elapsedMs: 1,
      totalKnown: true,
    });
    jest.advanceTimersByTime(2000);
    send(service, MESSAGE_TYPES.INDEXING_PROGRESS, {
      pipeline: 'symbols',
      percent: 20,
      currentLabel: 'b.ts',
      elapsedMs: 2,
      totalKnown: true,
    });

    expect(service.recent()).toHaveLength(2);
  });

  it('does not coalesce across different sources', () => {
    send(service, MESSAGE_TYPES.INDEXING_PROGRESS, {
      pipeline: 'symbols',
      percent: 10,
      currentLabel: 'a.ts',
      elapsedMs: 1,
      totalKnown: true,
    });
    send(service, MESSAGE_TYPES.MEMORY_CORPUS_CHANGED, {
      action: 'rebuilt',
      corpusId: 'c1',
      name: 'Docs',
      count: 1,
      timestamp: 1,
    });

    expect(service.recent()).toHaveLength(2);
  });

  it('is busy right after a push and idle once the clock passes IDLE_AFTER_MS', () => {
    send(service, MESSAGE_TYPES.INDEXING_COMPLETE, {
      workspaceRoot: '/ws',
      workspaceFingerprint: 'fp',
      completedAt: 1,
      gitHeadSha: null,
      elapsedMs: 4200,
    });

    expect(service.isIdle()).toBe(false);
    expect(service.latest()?.summary).toBe('Workspace index finished in 4s');

    jest.advanceTimersByTime(ACTIVITY_IDLE_AFTER_MS + 1000);

    expect(service.isIdle()).toBe(true);
  });

  it('narrates a boot phase but not the settled one', () => {
    send(service, MESSAGE_TYPES.BOOT_READINESS_CHANGED, {
      readiness: 'warming',
      phase: 'database',
      startedAt: 1,
    });
    expect(service.latest()?.summary).toBe('Opening the database');

    send(service, MESSAGE_TYPES.BOOT_READINESS_CHANGED, {
      readiness: 'ready',
      phase: 'settled',
      startedAt: 1,
    });
    expect(service.recent()).toHaveLength(1);
  });

  it('prefers the host-supplied boot detail and warns on a failed boot', () => {
    send(service, MESSAGE_TYPES.BOOT_READINESS_CHANGED, {
      readiness: 'failed',
      phase: 'database',
      detail: 'Database is locked',
      startedAt: 1,
    });

    expect(service.latest()).toMatchObject({
      summary: 'Database is locked',
      level: 'warn',
    });
  });

  it('drops a malformed boot push', () => {
    send(service, MESSAGE_TYPES.BOOT_READINESS_CHANGED, {
      readiness: 'sleepy',
      phase: 'database',
      startedAt: 1,
    });

    expect(service.recent()).toEqual([]);
  });

  it('summarises memory extraction with and without merges', () => {
    send(service, MESSAGE_TYPES.MEMORY_EXTRACTED, {
      workspaceRoot: null,
      extracted: 5,
      created: 3,
      merged: 2,
      timestamp: 1,
    });
    expect(service.latest()?.summary).toBe('Curated 3 memories (2 merged)');

    jest.advanceTimersByTime(2000);
    send(service, MESSAGE_TYPES.MEMORY_EXTRACTED, {
      workspaceRoot: null,
      extracted: 1,
      created: 1,
      merged: 0,
      timestamp: 2,
    });
    expect(service.latest()?.summary).toBe('Curated 1 memories');
  });

  it('ignores curation outcomes from a different active workspace', () => {
    workspaceScope.switchTo('/ws-a');
    send(service, MESSAGE_TYPES.MEMORY_EXTRACTED, {
      workspaceRoot: '/ws-b',
      extracted: 2,
      created: 1,
      merged: 0,
      timestamp: 1,
    });
    expect(service.recent()).toEqual([]);

    send(service, MESSAGE_TYPES.MEMORY_EXTRACTED, {
      workspaceRoot: '/ws-a',
      extracted: 2,
      created: 1,
      merged: 0,
      timestamp: 2,
    });
    expect(service.latest()?.summary).toBe('Curated 1 memories');
  });

  it('matches Windows workspace identity across case and separators', () => {
    workspaceScope.switchTo('D:\\Projects\\Ptah');
    send(service, MESSAGE_TYPES.MEMORY_EXTRACTED, {
      workspaceRoot: 'd:/projects/ptah/',
      extracted: 2,
      created: 0,
      merged: 2,
      timestamp: 1,
    });

    expect(service.latest()?.summary).toBe('Merged 2 memories');
  });

  it('drops workspace-scoped curation before an active workspace is known', () => {
    send(service, MESSAGE_TYPES.MEMORY_EXTRACTED, {
      workspaceRoot: '/ws-a',
      extracted: 1,
      created: 1,
      merged: 0,
      timestamp: 1,
    });

    expect(service.recent()).toEqual([]);
  });

  it('summarises a corpus change', () => {
    send(service, MESSAGE_TYPES.MEMORY_CORPUS_CHANGED, {
      action: 'rebuilt',
      corpusId: 'c1',
      name: 'Docs',
      count: 42,
      timestamp: 1,
    });

    expect(service.latest()?.summary).toBe(
      'Corpus "Docs" rebuilt (42 entries)',
    );
  });

  it('reuses the proven skill-synthesis phrasing', () => {
    send(service, MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT, {
      event: { kind: 'curator-pass-start', timestamp: 1 },
    });
    expect(service.latest()?.summary).toBe('Curator analyzing candidates…');

    jest.advanceTimersByTime(2000);
    send(service, MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT, {
      event: {
        kind: 'backfill-progress',
        timestamp: 2,
        stats: { done: 3, total: 9 },
      },
    });
    expect(service.latest()?.summary).toBe('Embedding candidates 3/9…');
  });

  it('degrades an unknown skill event kind to a generic line, never to null', () => {
    send(service, MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT, {
      event: { kind: 'brand-new-kind', timestamp: 1 },
    });

    expect(service.latest()?.summary).toBe('Skill synthesis: brand-new-kind');
  });

  it('warns on a skill synthesis error', () => {
    send(service, MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT, {
      event: { kind: 'error', timestamp: 1, error: 'disk full' },
    });

    expect(service.latest()).toMatchObject({
      summary: 'Skill synthesis error: disk full',
      level: 'warn',
    });
  });

  it('narrates a vec status change once and ignores the re-broadcast', () => {
    const offline = {
      ok: false,
      diagnostic: { ok: false, reason: 'binding-missing' },
    };
    send(service, MESSAGE_TYPES.VEC_STATUS_CHANGED, offline);
    expect(service.latest()).toMatchObject({
      summary: 'sqlite-vec went offline (binding-missing).',
      level: 'warn',
    });

    jest.advanceTimersByTime(5000);
    send(service, MESSAGE_TYPES.VEC_STATUS_CHANGED, offline);
    expect(service.recent()).toHaveLength(1);

    jest.advanceTimersByTime(5000);
    send(service, MESSAGE_TYPES.VEC_STATUS_CHANGED, {
      ok: true,
      diagnostic: { ok: true, reason: 'loaded' },
    });
    expect(service.recent()).toHaveLength(2);
    expect(service.latest()?.summary).toBe('sqlite-vec is online.');
  });

  it('reports embedder download, readiness and error, each only once', () => {
    send(service, MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED, {
      status: { ready: false, downloading: true, progress: 0.25 },
    });
    expect(service.latest()?.summary).toBe(
      'Downloading the embedding model 25%…',
    );

    jest.advanceTimersByTime(2000);
    send(service, MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED, {
      status: { ready: true, downloading: false },
    });
    expect(service.latest()?.summary).toBe('Embedder ready.');

    jest.advanceTimersByTime(2000);
    send(service, MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED, {
      status: { ready: true, downloading: false },
    });
    expect(service.recent()).toHaveLength(2);

    jest.advanceTimersByTime(2000);
    send(service, MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED, {
      status: { ready: false, downloading: false, error: { message: 'oom' } },
    });
    expect(service.latest()).toMatchObject({
      summary: 'Embedder error: oom',
      level: 'warn',
    });
  });

  it('drops malformed vec, embedder, memory and indexing payloads', () => {
    send(service, MESSAGE_TYPES.VEC_STATUS_CHANGED, {});
    send(service, MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED, {});
    send(service, MESSAGE_TYPES.MEMORY_EXTRACTED, {});
    send(service, MESSAGE_TYPES.MEMORY_CORPUS_CHANGED, { action: 'built' });
    send(service, MESSAGE_TYPES.INDEXING_PROGRESS, {});
    send(service, MESSAGE_TYPES.INDEXING_COMPLETE, {});
    send(service, MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT, {});

    expect(service.recent()).toEqual([]);
  });

  // ── Mapper narrowing (logic review F-3 / F-4) ────────────────────────────

  it('substitutes now() for a timestamp of the wrong type', () => {
    const now = Date.now();
    send(service, MESSAGE_TYPES.MEMORY_EXTRACTED, {
      workspaceRoot: null,
      created: 1,
      merged: 0,
      timestamp: 'yesterday',
    });

    expect(service.latest()?.timestamp).toBe(now);
    expect(typeof service.latest()?.timestamp).toBe('number');
  });

  it('substitutes now() for a non-finite completedAt', () => {
    const now = Date.now();
    send(service, MESSAGE_TYPES.INDEXING_COMPLETE, {
      workspaceRoot: '/ws',
      workspaceFingerprint: 'fp',
      completedAt: Number.NaN,
      gitHeadSha: null,
      elapsedMs: 1000,
    });

    expect(service.latest()?.timestamp).toBe(now);
  });

  it('keeps a well-formed wire timestamp untouched', () => {
    send(service, MESSAGE_TYPES.MEMORY_CORPUS_CHANGED, {
      action: 'built',
      corpusId: 'c',
      name: 'Docs',
      count: 1,
      timestamp: 4242,
    });

    expect(service.latest()?.timestamp).toBe(4242);
  });

  it('ignores a boot detail that is not a string and uses the phase label', () => {
    send(service, MESSAGE_TYPES.BOOT_READINESS_CHANGED, {
      readiness: 'warming',
      phase: 'harness',
      detail: { message: 'nope' },
      startedAt: 1,
    });

    expect(service.latest()?.summary).toBe('Syncing the agent harness');
  });

  it('drops indexing and memory payloads whose numbers are non-finite', () => {
    send(service, MESSAGE_TYPES.INDEXING_PROGRESS, {
      pipeline: 'symbols',
      percent: Number.NaN,
      currentLabel: 'a.ts',
      elapsedMs: 1,
      totalKnown: true,
    });
    send(service, MESSAGE_TYPES.INDEXING_COMPLETE, {
      workspaceRoot: '/ws',
      workspaceFingerprint: 'fp',
      completedAt: 1,
      gitHeadSha: null,
      elapsedMs: Number.POSITIVE_INFINITY,
    });
    send(service, MESSAGE_TYPES.MEMORY_EXTRACTED, {
      workspaceRoot: null,
      extracted: 1,
      created: Number.NaN,
      merged: 0,
      timestamp: 1,
    });

    expect(service.recent()).toEqual([]);
  });

  it('treats a non-finite merged/count as zero rather than printing NaN', () => {
    send(service, MESSAGE_TYPES.MEMORY_EXTRACTED, {
      workspaceRoot: null,
      extracted: 1,
      created: 2,
      merged: Number.NaN,
      timestamp: 1,
    });
    expect(service.latest()?.summary).toBe('Curated 2 memories');

    jest.advanceTimersByTime(2000);
    send(service, MESSAGE_TYPES.MEMORY_CORPUS_CHANGED, {
      action: 'built',
      corpusId: 'c',
      name: 'Docs',
      count: 'many',
      timestamp: 1,
    });
    expect(service.latest()?.summary).toBe('Corpus "Docs" built (0 entries)');
  });

  it('ignores a non-string indexing label instead of interpolating it', () => {
    send(service, MESSAGE_TYPES.INDEXING_PROGRESS, {
      pipeline: 'symbols',
      percent: 40,
      currentLabel: { path: 'a.ts' },
      elapsedMs: 1,
      totalKnown: true,
    });

    expect(service.latest()?.summary).toBe('Indexing 40%');
  });

  it('falls back to the generic skill line rather than printing NaN', () => {
    send(service, MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT, {
      event: {
        kind: 'backfill-progress',
        timestamp: 1,
        stats: { done: 'lots', total: 9 },
      },
    });
    expect(service.latest()?.summary).toBe(
      'Skill synthesis: backfill-progress',
    );

    jest.advanceTimersByTime(2000);
    send(service, MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT, {
      event: {
        kind: 'curator-pass',
        timestamp: 2,
        stats: { suggestionsCreated: 'some' },
      },
    });
    expect(service.latest()?.summary).toBe('Skill synthesis: curator-pass');
  });

  it('does not stringify a non-string skill error', () => {
    send(service, MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT, {
      event: { kind: 'error', timestamp: 1, error: { code: 5 } },
    });

    expect(service.latest()?.summary).toBe('Skill synthesis error: unknown');
  });

  it('does not stringify a non-string vec reason or embedder message', () => {
    send(service, MESSAGE_TYPES.VEC_STATUS_CHANGED, {
      ok: false,
      diagnostic: { ok: false, reason: { code: 1 } },
    });
    expect(service.latest()?.summary).toBe(
      'sqlite-vec went offline (unknown).',
    );

    jest.advanceTimersByTime(2000);
    send(service, MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED, {
      status: { ready: false, downloading: false, error: { message: 42 } },
    });
    expect(service.latest()?.summary).toBe('Embedder is not available.');
  });

  it('ignores a message type it does not declare', () => {
    send(service, 'chat:messageChunk', { summary: 'nope' });

    expect(service.recent()).toEqual([]);
  });

  it('declares the nine user-meaningful handled wire strings', () => {
    expect(service.handledMessageTypes).toEqual([
      'activity:event',
      'boot:readinessChanged',
      'memory:extracted',
      'memory:corpusChanged',
      'indexing:progress',
      'indexing:complete',
      'skillSynthesis:event',
      'db:vecStatusChanged',
      'embedder:statusChanged',
    ]);
  });

  it('clears its idle timer on destroy', () => {
    const clearSpy = jest.spyOn(global, 'clearInterval');

    TestBed.resetTestingModule();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
