import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  ITracer,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
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
      extract: jest.fn().mockResolvedValue({ status: 'extracted', drafts: [] }),
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
      outcome: 'ran',
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
      { scanned: 5, promoted: 3, demoted: 1, archived: 2, expired: 0 },
      9999,
    );
    const events = svc.recentEvents(5);
    const decay = events.find((e) => e.kind === 'decay-run');
    expect(decay).toBeDefined();
    expect(decay?.timestamp).toBe(9999);
    expect(decay?.stats).toMatchObject({
      scanned: 5,
      promoted: 3,
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
    const resolvers: ((value: unknown) => void)[] = [];
    const extract = jest.fn(
      () =>
        new Promise<unknown>((resolve) => {
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
    resolvers[0]({ status: 'extracted', drafts: [] });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
  });

  it('different sessions run in parallel', async () => {
    const extract = jest
      .fn()
      .mockResolvedValue({ status: 'extracted', drafts: [] });
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
    const extract = jest
      .fn()
      .mockResolvedValue({ status: 'extracted', drafts: [] });
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
    const extract = jest
      .fn()
      .mockResolvedValue({ status: 'extracted', drafts: [] });
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
    expect(stats).toEqual({
      outcome: 'ran',
      extracted: 0,
      merged: 0,
      created: 0,
      skipped: 0,
    });
    expect(extract).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    const events = svc.recentEvents(5);
    const skip = events.find((e) => e.kind === 'curator-skipped-no-data');
    expect(skip).toBeDefined();
    expect(skip?.sessionId).toBe('sess-skip');
  });

  it('curate() with whitespace-only transcript still skips (treated as placeholder)', async () => {
    const extract = jest
      .fn()
      .mockResolvedValue({ status: 'extracted', drafts: [] });
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
    const extract = jest.fn().mockResolvedValue({
      status: 'extracted',
      drafts: [populatedDraft],
    });
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
      extract: jest
        .fn()
        .mockResolvedValue({ status: 'extracted', drafts: [draft] }),
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
    } as unknown as IWorkspaceProvider;
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
      outcome: 'ran',
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
      outcome: 'ran',
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
    const extract = jest.fn().mockResolvedValue({
      status: 'extracted',
      drafts: [draft, { ...draft }],
    });
    const resolve = jest.fn().mockRejectedValue(new Error('transport down'));
    const llm = { extract, resolve } as unknown as ICuratorLLM;
    const svc = buildService({ llm });

    const stats = await svc.curate({
      sessionId: 'err-2',
      transcript: 'real transcript content',
    });

    expect(stats).toEqual({
      outcome: 'ran',
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
      outcome: 'ran',
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
      extract: jest.fn().mockResolvedValue({ status: 'extracted', drafts: [] }),
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
      outcome: 'ran',
      extracted: 0,
      merged: 0,
      created: 0,
      skipped: 0,
    });
    expect(tracer.spans).toContain('memory.curate');
  });
});

/**
 * TASK_2026_295 — an unusable session id must not coalesce two different
 * sessions into one run.
 *
 * The in-flight map exists to stop the SAME session being curated twice
 * concurrently. Its key used to be `${workspaceRoot}::${sessionId}`, so two
 * unrelated sessions in one workspace that both arrived with `''` produced the
 * identical key `"/ws::"`: the second caller was handed the FIRST session's
 * promise, its transcript was never seen by the LLM, and it received the first
 * session's `CuratorRunStats` and reported success. Silent curation loss.
 *
 * The LLM double gates on a promise so both runs are genuinely in flight at the
 * same time — the only condition under which the old key could collide.
 */
describe('MemoryCuratorService — in-flight coalescing (TASK_2026_295)', () => {
  function gatedLlm(): {
    llm: ICuratorLLM;
    transcripts: string[];
    release: () => void;
  } {
    const transcripts: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const llm = {
      extract: jest.fn(async (transcript: string) => {
        transcripts.push(transcript);
        await gate;
        return { status: 'extracted', drafts: [] };
      }),
      resolve: jest.fn(async () => []),
    } as unknown as ICuratorLLM;
    return { llm, transcripts, release: () => release() };
  }

  it('does NOT share one run between two sessions that both arrive with an empty id', async () => {
    const { llm, transcripts, release } = gatedLlm();
    const svc = buildService({ llm });

    const a = svc.curate({
      sessionId: '',
      workspaceRoot: '/ws',
      transcript: 'session A transcript',
    });
    const b = svc.curate({
      sessionId: '',
      workspaceRoot: '/ws',
      transcript: 'session B transcript',
    });

    release();
    await Promise.all([a, b]);
    // Before the fix this was ['session A transcript'] — B was handed A's
    // in-flight promise and its transcript never reached the LLM at all.
    expect(transcripts).toEqual([
      'session A transcript',
      'session B transcript',
    ]);
  });

  it('still coalesces two concurrent runs for the SAME real session', async () => {
    // The control. Without it, "does not coalesce" would also pass for an
    // implementation that had simply deleted the in-flight map.
    const { llm, transcripts, release } = gatedLlm();
    const svc = buildService({ llm });

    const first = svc.curate({
      sessionId: 's-1',
      workspaceRoot: '/ws',
      transcript: 'first transcript',
    });
    const second = svc.curate({
      sessionId: 's-1',
      workspaceRoot: '/ws',
      transcript: 'second transcript',
    });

    release();
    const [statsFirst, statsSecond] = await Promise.all([first, second]);
    // One run, and the second caller was served by it.
    expect(transcripts).toEqual(['first transcript']);
    expect(statsSecond).toEqual(statsFirst);
  });

  it('keeps different real sessions in the same workspace independent', async () => {
    const { llm, transcripts, release } = gatedLlm();
    const svc = buildService({ llm });

    const a = svc.curate({
      sessionId: 's-a',
      workspaceRoot: '/ws',
      transcript: 'transcript A',
    });
    const b = svc.curate({
      sessionId: 's-b',
      workspaceRoot: '/ws',
      transcript: 'transcript B',
    });

    release();
    await Promise.all([a, b]);
    expect(transcripts).toEqual(['transcript A', 'transcript B']);
  });
});

/**
 * TASK_2026_296 item 6, Part B — a rekey landing mid-curate must not produce a
 * double-curate.
 *
 * A residual hook path can start a curate under the **tabId**, because the SDK
 * UUID does not exist until the system `init` message lands. When it does land,
 * `MemoryTriggerService.rekeySession` fires and moves the in-flight coalescing
 * key onto the UUID. If it did not, the guard would still be holding the old
 * key and a curate triggered under the UUID would start a SECOND concurrent
 * run of the same session (plan §6c Q3).
 *
 * Both ids here are real UUID v4 strings — a tabId IS one, so `tab_N` would
 * make these pass for the wrong reason.
 */
describe('MemoryCuratorService — rekeySession (TASK_2026_296)', () => {
  const TAB_ID = '4a4a0d5e-6a1c-4d2f-9d3b-3e6f1c5a7b21';
  const REAL_ID = 'b7c2f9a1-0e44-4a6b-8c1d-2f5e9a3b6d70';
  const OTHER_ID = 'f31c8a2d-55b6-4e19-9a07-1d8c4b2e6f93';

  function gatedLlm(): {
    llm: ICuratorLLM;
    transcripts: string[];
    release: () => void;
  } {
    const transcripts: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const llm = {
      extract: jest.fn(async (transcript: string) => {
        transcripts.push(transcript);
        await gate;
        return { status: 'extracted', drafts: [] };
      }),
      resolve: jest.fn(async () => []),
    } as unknown as ICuratorLLM;
    return { llm, transcripts, release: () => release() };
  }

  it('runs exactly one curate when the rekey lands mid-flight', async () => {
    const { llm, transcripts, release } = gatedLlm();
    const svc = buildService({ llm });

    // Armed under the tabId — the residual path.
    const started = svc.curate({
      sessionId: TAB_ID,
      workspaceRoot: '/ws',
      transcript: 'the one real run',
    });

    svc.rekeySession(TAB_ID, REAL_ID);

    // The trigger now fires under the canonical id. Without the rekey this
    // would miss the in-flight guard and start a second concurrent run.
    const afterRekey = svc.curate({
      sessionId: REAL_ID,
      workspaceRoot: '/ws',
      transcript: 'the double that must not happen',
    });

    release();
    const [a, b] = await Promise.all([started, afterRekey]);

    expect(transcripts).toEqual(['the one real run']);
    expect(b).toEqual(a);
  });

  it('drains the migrated key when the run settles, so the session is curatable again', async () => {
    // The migrated entry inherits a `.finally` that deletes the OLD key, so
    // without a re-armed cleanup it would sit under `toId` forever and every
    // later curate would be handed a long-settled promise.
    const { llm, transcripts, release } = gatedLlm();
    const svc = buildService({ llm });

    const started = svc.curate({
      sessionId: TAB_ID,
      workspaceRoot: '/ws',
      transcript: 'first run',
    });
    svc.rekeySession(TAB_ID, REAL_ID);
    release();
    await started;
    await Promise.resolve();

    await svc.curate({
      sessionId: REAL_ID,
      workspaceRoot: '/ws',
      transcript: 'second run',
    });

    expect(transcripts).toEqual(['first run', 'second run']);
  });

  it('refuses to overwrite an entry already held under toId', async () => {
    // R4. The destination is a LIVE run; the fromId entry is discarded rather
    // than clobbering it, and the destination's own promise still serves its
    // callers.
    const { llm, transcripts, release } = gatedLlm();
    const svc = buildService({ llm });

    const underTab = svc.curate({
      sessionId: TAB_ID,
      workspaceRoot: '/ws',
      transcript: 'tab run',
    });
    const underReal = svc.curate({
      sessionId: REAL_ID,
      workspaceRoot: '/ws',
      transcript: 'real run',
    });

    svc.rekeySession(TAB_ID, REAL_ID);

    // The destination is unchanged: a further curate under REAL_ID still
    // coalesces onto the run that was already there.
    const third = svc.curate({
      sessionId: REAL_ID,
      workspaceRoot: '/ws',
      transcript: 'must coalesce onto the real run',
    });

    release();
    const [, realStats, thirdStats] = await Promise.all([
      underTab,
      underReal,
      third,
    ]);
    expect(transcripts).toEqual(['tab run', 'real run']);
    expect(thirdStats).toEqual(realStats);
  });

  // Paired-isolation siblings: the rekey must be inert where it has no
  // business acting, and must leave every unrelated session alone.
  it('is a no-op for a blank, identical or unrelated id', async () => {
    const { llm, transcripts, release } = gatedLlm();
    const svc = buildService({ llm });

    const running = svc.curate({
      sessionId: TAB_ID,
      workspaceRoot: '/ws',
      transcript: 'untouched run',
    });

    svc.rekeySession('', REAL_ID);
    svc.rekeySession(TAB_ID, '   ');
    svc.rekeySession(TAB_ID, TAB_ID);
    svc.rekeySession(OTHER_ID, REAL_ID);

    // Still coalescing under its original key — nothing moved.
    const same = svc.curate({
      sessionId: TAB_ID,
      workspaceRoot: '/ws',
      transcript: 'must coalesce',
    });

    release();
    const [a, b] = await Promise.all([running, same]);
    expect(transcripts).toEqual(['untouched run']);
    expect(b).toEqual(a);
  });

  it('migrates only the matching workspace-scoped keys', async () => {
    // The key is `${workspaceRoot ?? ''}::${sessionId}`, so one session can hold
    // several entries. All of them move; a same-id entry in another workspace
    // must not be left behind, and another session's entry must not move.
    const { llm, transcripts, release } = gatedLlm();
    const svc = buildService({ llm });

    const inA = svc.curate({
      sessionId: TAB_ID,
      workspaceRoot: '/ws-a',
      transcript: 'ws-a run',
    });
    const inB = svc.curate({
      sessionId: TAB_ID,
      workspaceRoot: '/ws-b',
      transcript: 'ws-b run',
    });
    const other = svc.curate({
      sessionId: OTHER_ID,
      workspaceRoot: '/ws-a',
      transcript: 'other session run',
    });

    svc.rekeySession(TAB_ID, REAL_ID);

    const coalescedA = svc.curate({
      sessionId: REAL_ID,
      workspaceRoot: '/ws-a',
      transcript: 'should coalesce onto ws-a',
    });
    const coalescedB = svc.curate({
      sessionId: REAL_ID,
      workspaceRoot: '/ws-b',
      transcript: 'should coalesce onto ws-b',
    });

    release();
    const [statsA, statsB, , cA, cB] = await Promise.all([
      inA,
      inB,
      other,
      coalescedA,
      coalescedB,
    ]);
    expect(transcripts).toEqual(['ws-a run', 'ws-b run', 'other session run']);
    expect(cA).toEqual(statsA);
    expect(cB).toEqual(statsB);
  });
});
