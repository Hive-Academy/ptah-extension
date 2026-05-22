import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  ICompactionCallbackRegistry,
  ITranscriptReader,
} from '@ptah-extension/memory-contracts';
import { MemoryCuratorService } from './memory-curator.service';
import type { MemoryStore } from './memory.store';
import type { SalienceScorer } from './salience-scorer';
import type { ICuratorLLM } from './curator-llm/curator-llm.interface';
import type { MemoryCuratorEvent } from './diagnostics.types';

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function buildService(opts?: { llm?: ICuratorLLM }): MemoryCuratorService {
  const registry = {
    register: jest.fn(() => () => {
      /* noop */
    }),
  } as unknown as ICompactionCallbackRegistry;
  const store = {
    list: jest.fn(() => ({ memories: [], total: 0 })),
    insertMemoryWithChunks: jest.fn().mockResolvedValue(undefined),
    appendChunks: jest.fn().mockResolvedValue(undefined),
    getById: jest.fn(),
    updateSalience: jest.fn(),
  } as unknown as MemoryStore;
  const scorer = {
    score: jest.fn(() => 0.5),
  } as unknown as SalienceScorer;
  const transcriptReader = {
    read: jest.fn().mockResolvedValue(''),
  } as unknown as ITranscriptReader;
  const llm =
    opts?.llm ??
    ({
      extract: jest.fn().mockResolvedValue([]),
      resolve: jest.fn().mockResolvedValue([]),
    } as unknown as ICuratorLLM);
  return new MemoryCuratorService(
    makeLogger(),
    registry,
    store,
    scorer,
    transcriptReader,
    llm,
  );
}

describe('MemoryCuratorService — event ring buffer', () => {
  it('pushEvent stores events up to RING_CAPACITY', () => {
    const svc = buildService();
    for (let i = 0; i < 250; i++) {
      svc.pushEvent({
        kind: 'idle-trigger',
        timestamp: i,
        sessionId: `s${i}`,
      });
    }
    const all = svc.recentEvents(250);
    expect(all.length).toBe(200);
    expect(all[0].timestamp).toBe(50);
    expect(all[199].timestamp).toBe(249);
  });

  it('recentEvents(10) returns last 10 in order', () => {
    const svc = buildService();
    for (let i = 0; i < 30; i++) {
      svc.pushEvent({
        kind: 'idle-trigger',
        timestamp: i,
        sessionId: `s${i}`,
      });
    }
    const last = svc.recentEvents(10) as MemoryCuratorEvent[];
    expect(last.length).toBe(10);
    expect(last[0].timestamp).toBe(20);
    expect(last[9].timestamp).toBe(29);
  });

  it('curate() with no drafts records curator-run event + lastRun', async () => {
    const svc = buildService();
    const stats = await svc.curate({ sessionId: 'abc' });
    expect(stats.extracted).toBe(0);
    const info = svc.lastRunInfo();
    expect(info.at).not.toBeNull();
    expect(info.stats).toEqual({
      extracted: 0,
      merged: 0,
      created: 0,
      skipped: 0,
    });
    const events = svc.recentEvents(5);
    expect(events.find((e) => e.kind === 'curator-run')).toBeDefined();
  });

  it('recentEvents defaults to 10', () => {
    const svc = buildService();
    for (let i = 0; i < 15; i++) {
      svc.pushEvent({
        kind: 'idle-trigger',
        timestamp: i,
      });
    }
    expect(svc.recentEvents().length).toBe(10);
  });

  it('recordDecayEvent pushes a decay-run event into the ring buffer', () => {
    const svc = buildService();
    svc.recordDecayEvent(
      { scanned: 5, demoted: 1, archived: 2, expired: 0 },
      9999,
    );
    const events = svc.recentEvents(5);
    const decay = events.find((e) => e.kind === 'decay-run');
    expect(decay).toBeDefined();
    expect(decay?.timestamp).toBe(9999);
    expect(decay?.stats).toMatchObject({
      scanned: 5,
      demoted: 1,
      archived: 2,
      expired: 0,
    });
  });
});

describe('MemoryCuratorService — in-flight dedupe (Moderate-3, Failure-7)', () => {
  it('concurrent curate calls for the same (workspaceRoot, sessionId) share a single llm.extract invocation', async () => {
    const resolvers: ((value: unknown[]) => void)[] = [];
    const extract = jest.fn(
      () =>
        new Promise<unknown[]>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const llm = {
      extract,
      resolve: jest.fn().mockResolvedValue([]),
    } as unknown as ICuratorLLM;
    const svc = buildService({ llm });
    const p1 = svc.curate({ sessionId: 'sess-A', workspaceRoot: '/ws' });
    const p2 = svc.curate({ sessionId: 'sess-A', workspaceRoot: '/ws' });
    expect(extract).toHaveBeenCalledTimes(1);
    resolvers[0]([]);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
  });

  it('different sessions run in parallel', async () => {
    const extract = jest.fn().mockResolvedValue([]);
    const llm = {
      extract,
      resolve: jest.fn().mockResolvedValue([]),
    } as unknown as ICuratorLLM;
    const svc = buildService({ llm });
    await Promise.all([
      svc.curate({ sessionId: 'A', workspaceRoot: '/ws' }),
      svc.curate({ sessionId: 'B', workspaceRoot: '/ws' }),
    ]);
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it('in-flight map clears after run completes so a follow-up call runs fresh', async () => {
    const extract = jest.fn().mockResolvedValue([]);
    const llm = {
      extract,
      resolve: jest.fn().mockResolvedValue([]),
    } as unknown as ICuratorLLM;
    const svc = buildService({ llm });
    await svc.curate({ sessionId: 'A', workspaceRoot: '/ws' });
    await svc.curate({ sessionId: 'A', workspaceRoot: '/ws' });
    expect(extract).toHaveBeenCalledTimes(2);
  });
});
