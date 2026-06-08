import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { ITracer } from '@ptah-extension/platform-core';
import type {
  ICompactionCallbackRegistry,
  ITranscriptReader,
} from '@ptah-extension/memory-contracts';
import { MemoryCuratorService } from './memory-curator.service';
import type { MemoryStore } from './memory.store';
import type { SalienceScorer } from './salience-scorer';
import type { ICuratorLLM } from './curator-llm/curator-llm.interface';
import type { MemoryCuratorEvent } from './diagnostics.types';

interface RecordingTracer extends ITracer {
  readonly spans: string[];
}

function makeRecordingTracer(): RecordingTracer {
  const spans: string[] = [];
  return {
    spans,
    startSpan: <T>(
      name: string,
      _attrs: Record<string, string | number | boolean>,
      fn: () => T,
    ): T => {
      spans.push(name);
      return fn();
    },
    addBreadcrumb: () => undefined,
  };
}

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
    const stats = await svc.curate({
      sessionId: 'abc',
      transcript: 'real transcript content',
    });
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

  it('onEvent fans out every pushEvent to subscribers and dispose detaches', () => {
    const svc = buildService();
    const received: MemoryCuratorEvent[] = [];
    const sub = svc.onEvent((ev) => {
      received.push(ev);
    });
    svc.pushEvent({ kind: 'idle-trigger', timestamp: 1, sessionId: 's1' });
    svc.pushEvent({ kind: 'curator-run', timestamp: 2, sessionId: 's1' });
    expect(received.length).toBe(2);
    expect(received[0].kind).toBe('idle-trigger');
    expect(received[1].kind).toBe('curator-run');
    sub.dispose();
    svc.pushEvent({ kind: 'decay-run', timestamp: 3 });
    expect(received.length).toBe(2);
  });

  it('onEvent listener errors are caught and logged, do not break fan-out', () => {
    const svc = buildService();
    const calls: number[] = [];
    svc.onEvent(() => {
      throw new Error('boom');
    });
    svc.onEvent((ev) => {
      calls.push(ev.timestamp);
    });
    svc.pushEvent({ kind: 'idle-trigger', timestamp: 42 });
    expect(calls).toEqual([42]);
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
    const p1 = svc.curate({
      sessionId: 'sess-A',
      workspaceRoot: '/ws',
      transcript: 't',
    });
    const p2 = svc.curate({
      sessionId: 'sess-A',
      workspaceRoot: '/ws',
      transcript: 't',
    });
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
      svc.curate({ sessionId: 'A', workspaceRoot: '/ws', transcript: 't' }),
      svc.curate({ sessionId: 'B', workspaceRoot: '/ws', transcript: 't' }),
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
    await svc.curate({ sessionId: 'A', workspaceRoot: '/ws', transcript: 't' });
    await svc.curate({ sessionId: 'A', workspaceRoot: '/ws', transcript: 't' });
    expect(extract).toHaveBeenCalledTimes(2);
  });
});

describe('MemoryCuratorService — placeholder skip event', () => {
  it('curate() with empty transcript pushes curator-skipped-no-data and bypasses llm.extract', async () => {
    const extract = jest.fn().mockResolvedValue([]);
    const resolve = jest.fn().mockResolvedValue([]);
    const llm = { extract, resolve } as unknown as ICuratorLLM;
    const registry = {
      register: jest.fn(() => () => undefined),
    } as unknown as ICompactionCallbackRegistry;
    const store = {
      list: jest.fn(() => ({ memories: [], total: 0 })),
      insertMemoryWithChunks: jest.fn().mockResolvedValue(undefined),
      appendChunks: jest.fn().mockResolvedValue(undefined),
      getById: jest.fn(),
      updateSalience: jest.fn(),
    } as unknown as MemoryStore;
    const scorer = { score: jest.fn(() => 0.5) } as unknown as SalienceScorer;
    const transcriptReader = {
      read: jest.fn().mockResolvedValue(''),
    } as unknown as ITranscriptReader;
    const svc = new MemoryCuratorService(
      makeLogger(),
      registry,
      store,
      scorer,
      transcriptReader,
      llm,
    );
    const stats = await svc.curate({ sessionId: 'sess-skip' });
    expect(stats).toEqual({ extracted: 0, merged: 0, created: 0, skipped: 0 });
    expect(extract).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    const events = svc.recentEvents(5);
    const skip = events.find((e) => e.kind === 'curator-skipped-no-data');
    expect(skip).toBeDefined();
    expect(skip?.sessionId).toBe('sess-skip');
  });

  it('curate() with whitespace-only transcript still skips (treated as placeholder)', async () => {
    const extract = jest.fn().mockResolvedValue([]);
    const llm = {
      extract,
      resolve: jest.fn().mockResolvedValue([]),
    } as unknown as ICuratorLLM;
    const svc = buildService({ llm });
    const stats = await svc.curate({ sessionId: 's2', transcript: '   \n  ' });
    expect(stats.extracted).toBe(0);
    expect(extract).not.toHaveBeenCalled();
    const skip = svc
      .recentEvents(5)
      .find((e) => e.kind === 'curator-skipped-no-data');
    expect(skip).toBeDefined();
  });
});

describe('MemoryCuratorService — real-fixture integration (Critical Verification Point 1)', () => {
  it('drives a recorded JSONL transcript through doCurate with a fake ICuratorLLM and extracts a fully-populated 5-field memory draft', async () => {
    const recordedTranscript = [
      '{"type":"user","content":"please add structured concept tags to the curator output"}',
      '{"type":"assistant","content":"investigating extract prompt + zod schema"}',
      '{"type":"tool_result","content":"edited adapter prompt + schema; tests pass"}',
      '{"type":"assistant","content":"committed change at HEAD"}',
    ].join('\n');

    const populatedDraft = {
      kind: 'event' as const,
      subject: 'curator output concept tags',
      content:
        'Added structured concept tags + 5-field summary plumb-through to the curator adapter.',
      salienceHint: 0.6,
      request: 'Add concept tags + 5-field summary fields to curator output',
      investigated: 'curator-llm-adapter prompt + Zod schema',
      learned:
        'Adapter is the bridge; prompt + schema must both grow together for round-trip',
      completed:
        'Prompt extended; schema extended; spec coverage updated; tests green',
      nextSteps: 'Audit downstream consumers for default-discovery fallback',
      type: 'feature' as const,
      concepts: ['curator', 'memory', 'schema', 'prompt'] as const,
      files: [
        'libs/backend/agent-sdk/src/lib/curator-llm-adapter/index.ts',
      ] as const,
    };
    const extract = jest.fn().mockResolvedValue([populatedDraft]);
    const resolve = jest
      .fn()
      .mockResolvedValue([{ ...populatedDraft, mergeTargetId: null }]);
    const llm = { extract, resolve } as unknown as ICuratorLLM;

    const registry = {
      register: jest.fn(() => () => undefined),
    } as unknown as ICompactionCallbackRegistry;
    const insertMemoryWithChunks = jest.fn().mockResolvedValue(undefined);
    const store = {
      list: jest.fn(() => ({ memories: [], total: 0 })),
      insertMemoryWithChunks,
      appendChunks: jest.fn().mockResolvedValue(undefined),
      getById: jest.fn(),
      updateSalience: jest.fn(),
    } as unknown as MemoryStore;
    const scorer = { score: jest.fn(() => 0.75) } as unknown as SalienceScorer;
    const transcriptReader = {
      read: jest.fn().mockResolvedValue(recordedTranscript),
    } as unknown as ITranscriptReader;

    const svc = new MemoryCuratorService(
      makeLogger(),
      registry,
      store,
      scorer,
      transcriptReader,
      llm,
    );

    const stats = await svc.curate({
      sessionId: 'fixture-A',
      workspaceRoot: '/ws',
      transcript: recordedTranscript,
    });

    expect(stats.extracted).toBeGreaterThanOrEqual(1);
    expect(stats.created).toBe(1);
    expect(stats.merged).toBe(0);
    expect(stats.skipped).toBe(0);

    expect(extract).toHaveBeenCalledWith(recordedTranscript, undefined);
    expect(insertMemoryWithChunks).toHaveBeenCalledTimes(1);

    const insertedMemory = (insertMemoryWithChunks as jest.Mock).mock
      .calls[0][0];
    expect(insertedMemory.request).toBe(populatedDraft.request);
    expect(insertedMemory.investigated).toBe(populatedDraft.investigated);
    expect(insertedMemory.learned).toBe(populatedDraft.learned);
    expect(insertedMemory.completed).toBe(populatedDraft.completed);
    expect(insertedMemory.nextSteps).toBe(populatedDraft.nextSteps);
    expect(insertedMemory.type).toBe('feature');
    expect(insertedMemory.type).not.toBe('discovery');
    expect(insertedMemory.concepts).toEqual(populatedDraft.concepts);
    expect(insertedMemory.files).toEqual(populatedDraft.files);
  });
});

describe('MemoryCuratorService — corpus auto-rebuild trigger (Batch C1)', () => {
  function makeWithCorpusDeps(opts: {
    workspaceRoot: string | null;
    corpora: Array<{ name: string }>;
    enabled?: boolean;
    rebuildImpl?: jest.Mock;
  }) {
    const draft = {
      kind: 'event' as const,
      subject: 'auto-rebuild test',
      content: 'content',
      salienceHint: 0.5,
      type: 'feature' as const,
      concepts: ['c'] as const,
      files: [] as const,
    };
    const llm = {
      extract: jest.fn().mockResolvedValue([draft]),
      resolve: jest.fn().mockResolvedValue([{ ...draft, mergeTargetId: null }]),
    } as unknown as ICuratorLLM;
    const registry = {
      register: jest.fn(() => () => undefined),
    } as unknown as ICompactionCallbackRegistry;
    const store = {
      list: jest.fn(() => ({ memories: [], total: 0 })),
      insertMemoryWithChunks: jest.fn().mockResolvedValue(undefined),
      appendChunks: jest.fn().mockResolvedValue(undefined),
      getById: jest.fn(),
      updateSalience: jest.fn(),
    } as unknown as MemoryStore;
    const scorer = { score: jest.fn(() => 0.5) } as unknown as SalienceScorer;
    const transcriptReader = {
      read: jest.fn().mockResolvedValue(''),
    } as unknown as ITranscriptReader;
    const corpusStore = {
      list: jest.fn(() => opts.corpora),
    } as unknown as import('./knowledge-agents/corpus.store').CorpusStore;
    const rebuildCorpus =
      opts.rebuildImpl ?? jest.fn().mockResolvedValue({ added: 0, removed: 0 });
    const knowledgeAgent = {
      rebuildCorpus,
    } as unknown as import('./knowledge-agents/knowledge-agent.service').KnowledgeAgentService;
    const workspace = {
      getConfiguration: jest.fn(
        <T>(_s: string, k: string, fallback?: T): T | undefined => {
          if (k === 'memory.corpus.autoRebuildOnExtraction') {
            return (opts.enabled ?? true) as unknown as T;
          }
          return fallback;
        },
      ),
    } as unknown as import('@ptah-extension/platform-core').IWorkspaceProvider;
    const svc = new MemoryCuratorService(
      makeLogger(),
      registry,
      store,
      scorer,
      transcriptReader,
      llm,
      corpusStore,
      knowledgeAgent,
      workspace,
    );
    return { svc, rebuildCorpus, corpusStore, knowledgeAgent };
  }

  it('fires rebuildCorpus for each workspace corpus when created > 0', async () => {
    const { svc, rebuildCorpus, corpusStore } = makeWithCorpusDeps({
      workspaceRoot: '/ws/X',
      corpora: [{ name: 'a' }, { name: 'b' }],
    });
    await svc.curate({
      sessionId: 's',
      workspaceRoot: '/ws/X',
      transcript: 'real transcript content',
    });
    expect((corpusStore.list as jest.Mock).mock.calls[0][0]).toEqual({
      workspaceRoot: '/ws/X',
    });
    expect(rebuildCorpus).toHaveBeenCalledTimes(2);
    expect(rebuildCorpus).toHaveBeenCalledWith('a');
    expect(rebuildCorpus).toHaveBeenCalledWith('b');
  });

  it('does NOT fire rebuildCorpus when workspaceRoot is null', async () => {
    const { svc, rebuildCorpus } = makeWithCorpusDeps({
      workspaceRoot: null,
      corpora: [{ name: 'a' }],
    });
    await svc.curate({
      sessionId: 's',
      workspaceRoot: null,
      transcript: 'real transcript content',
    });
    expect(rebuildCorpus).not.toHaveBeenCalled();
  });

  it('does NOT fire rebuildCorpus when autoRebuildOnExtraction is disabled', async () => {
    const { svc, rebuildCorpus } = makeWithCorpusDeps({
      workspaceRoot: '/ws/X',
      corpora: [{ name: 'a' }],
      enabled: false,
    });
    await svc.curate({
      sessionId: 's',
      workspaceRoot: '/ws/X',
      transcript: 'real transcript content',
    });
    expect(rebuildCorpus).not.toHaveBeenCalled();
  });

  it('rebuildCorpus rejection does NOT propagate to curate()', async () => {
    const rebuildImpl = jest.fn().mockRejectedValue(new Error('boom'));
    const { svc } = makeWithCorpusDeps({
      workspaceRoot: '/ws/X',
      corpora: [{ name: 'a' }],
      rebuildImpl,
    });
    await expect(
      svc.curate({
        sessionId: 's',
        workspaceRoot: '/ws/X',
        transcript: 'real transcript content',
      }),
    ).resolves.toEqual(expect.objectContaining({ created: 1 }));
    await new Promise((r) => setImmediate(r));
    expect(rebuildImpl).toHaveBeenCalled();
  });

  it('per-corpus throttle: rapid-fire curates rebuild each corpus at most once per window', async () => {
    const { svc, rebuildCorpus } = makeWithCorpusDeps({
      workspaceRoot: '/ws/X',
      corpora: [{ name: 'a' }, { name: 'b' }],
    });
    for (let i = 0; i < 5; i++) {
      await svc.curate({
        sessionId: `s-${i}`,
        workspaceRoot: '/ws/X',
        transcript: `real transcript content ${i}`,
      });
    }
    await new Promise((r) => setImmediate(r));
    const callsByName = (rebuildCorpus as jest.Mock).mock.calls.map(
      (c) => c[0],
    );
    expect(callsByName.filter((n) => n === 'a').length).toBe(1);
    expect(callsByName.filter((n) => n === 'b').length).toBe(1);
  });
});

describe('MemoryCuratorService — curator-error on LLM failure', () => {
  it('extract rejection pushes curator-error, zeroes stats, and does not throw out of curate()', async () => {
    const extract = jest
      .fn()
      .mockRejectedValue(
        new Error(
          'The memory curator could not complete its language-model query.',
        ),
      );
    const resolve = jest.fn().mockResolvedValue([]);
    const llm = { extract, resolve } as unknown as ICuratorLLM;
    const svc = buildService({ llm });

    const stats = await svc.curate({
      sessionId: 'err-1',
      transcript: 'real transcript content',
    });

    expect(stats).toEqual({
      extracted: 0,
      merged: 0,
      created: 0,
      skipped: 0,
    });
    expect(resolve).not.toHaveBeenCalled();
    const evt = svc.recentEvents(5).find((e) => e.kind === 'curator-error');
    expect(evt).toBeDefined();
    expect(evt?.sessionId).toBe('err-1');
    expect(typeof evt?.error).toBe('string');
    const info = svc.lastRunInfo();
    expect(info.stats).toEqual({
      extracted: 0,
      merged: 0,
      created: 0,
      skipped: 0,
    });
  });

  it('extract rejection attributes the failure to the extract stage in the message', async () => {
    const extract = jest.fn().mockRejectedValue(new Error('auth expired'));
    const resolve = jest.fn().mockResolvedValue([]);
    const llm = { extract, resolve } as unknown as ICuratorLLM;
    const svc = buildService({ llm });

    await svc.curate({
      sessionId: 'err-extract-stage',
      transcript: 'real transcript content',
    });

    const evt = svc.recentEvents(5).find((e) => e.kind === 'curator-error');
    expect(evt?.error).toContain('memory extraction failed');
    expect(evt?.error).toContain('auth expired');
  });

  it('resolve rejection pushes curator-error, zeroes stats, attributes the resolve stage, preserves the extracted count, and does not throw out of curate()', async () => {
    const draft = {
      kind: 'event' as const,
      subject: 's',
      content: 'c',
      salienceHint: 0.5,
      type: 'feature' as const,
      concepts: ['x'] as const,
      files: [] as const,
    };
    const extract = jest.fn().mockResolvedValue([draft, { ...draft }]);
    const resolve = jest.fn().mockRejectedValue(new Error('transport down'));
    const llm = { extract, resolve } as unknown as ICuratorLLM;
    const svc = buildService({ llm });

    const stats = await svc.curate({
      sessionId: 'err-2',
      transcript: 'real transcript content',
    });

    expect(stats).toEqual({
      extracted: 0,
      merged: 0,
      created: 0,
      skipped: 0,
    });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(1);
    const evt = svc.recentEvents(5).find((e) => e.kind === 'curator-error');
    expect(evt).toBeDefined();
    expect(evt?.sessionId).toBe('err-2');
    expect(evt?.error).toContain('memory resolution failed');
    expect(evt?.error).toContain('2 extracted');
    expect(evt?.error).toContain('transport down');
    const info = svc.lastRunInfo();
    expect(info.stats).toEqual({
      extracted: 0,
      merged: 0,
      created: 0,
      skipped: 0,
    });
  });
});

describe('MemoryCuratorService — tracing instrumentation', () => {
  function buildTracedService(): {
    svc: MemoryCuratorService;
    tracer: RecordingTracer;
  } {
    const tracer = makeRecordingTracer();
    const registry = {
      register: jest.fn(() => () => undefined),
    } as unknown as ICompactionCallbackRegistry;
    const store = {
      list: jest.fn(() => ({ memories: [], total: 0 })),
      insertMemoryWithChunks: jest.fn().mockResolvedValue(undefined),
      appendChunks: jest.fn().mockResolvedValue(undefined),
      getById: jest.fn(),
      updateSalience: jest.fn(),
    } as unknown as MemoryStore;
    const scorer = { score: jest.fn(() => 0.5) } as unknown as SalienceScorer;
    const transcriptReader = {
      read: jest.fn().mockResolvedValue(''),
    } as unknown as ITranscriptReader;
    const llm = {
      extract: jest.fn().mockResolvedValue([]),
      resolve: jest.fn().mockResolvedValue([]),
    } as unknown as ICuratorLLM;
    const svc = new MemoryCuratorService(
      makeLogger(),
      registry,
      store,
      scorer,
      transcriptReader,
      llm,
      null,
      null,
      null,
      tracer,
    );
    return { svc, tracer };
  }

  it('curate wraps the run in a memory.curate span and returns identical stats', async () => {
    const { svc, tracer } = buildTracedService();
    const stats = await svc.curate({
      sessionId: 'trace-1',
      transcript: 'real transcript content',
    });
    expect(stats).toEqual({
      extracted: 0,
      merged: 0,
      created: 0,
      skipped: 0,
    });
    expect(tracer.spans).toContain('memory.curate');
  });
});
