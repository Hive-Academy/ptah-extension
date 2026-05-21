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
});
