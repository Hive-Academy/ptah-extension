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
import { CURATOR_TRANSCRIPT_MAX_CHARS } from './curator-llm/clamp-transcript';
import { CURATOR_MAX_WINDOWS } from './curator-llm/transcript-windows';
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

function buildService(opts?: {
  llm?: ICuratorLLM;
  logger?: Logger;
}): MemoryCuratorService {
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
    opts?.logger ?? makeLogger(),
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
    // One tick: a pass is admitted by `CuratorJobQueue` (TASK_2026_376 F4), so
    // it starts on the next microtask rather than inside the `curate` call.
    // What is pinned here is unchanged — two concurrent calls, ONE extract.
    await Promise.resolve();
    expect(extract).toHaveBeenCalledTimes(1);
    resolvers[0]({ status: 'extracted', drafts: [] });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
  });

  // Renamed for accuracy in TASK_2026_376 F4: two sessions are now QUEUED
  // rather than run at once. The property this pins is the one it always
  // pinned — distinct sessions are not coalesced into one extract.
  it('different sessions each get their own extract', async () => {
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
    // Two DISTINCT drafts: the windowed extractor unions on
    // `(subject, content)`, so two identical drafts would arrive as one.
    const extract = jest.fn().mockResolvedValue({
      status: 'extracted',
      drafts: [draft, { ...draft, content: 'c2' }],
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

/**
 * TASK_2026_352 — the prompt cap lives at the pipeline's chokepoint.
 *
 * The fault it closes was a CALL SITE that forgot: the memory boot scan read a
 * whole session with no `tailBytes` and skipped `composeTranscript`, the only
 * clamp on the live path, producing a 170 655-character prompt
 * (`tmp/logs/log.log:1017`). A cap on any one caller would have left the next
 * one free to repeat it, so these tests assert on what the LLM RECEIVES.
 */
describe('MemoryCuratorService — the chunked curation budget (TASK_2026_367)', () => {
  function makeLlmSpy(drafts: readonly unknown[] = []): {
    llm: ICuratorLLM;
    extract: jest.Mock;
    resolve: jest.Mock;
  } {
    const extract = jest
      .fn()
      .mockResolvedValue({ status: 'extracted', drafts });
    const resolve = jest.fn().mockResolvedValue([]);
    return {
      extract,
      resolve,
      llm: { extract, resolve } as unknown as ICuratorLLM,
    };
  }

  /** A transcript of `records` blocks of `size` characters each. */
  function transcriptOf(records: number, size: number): string {
    return Array.from(
      { length: records },
      (_, i) => `USER: turn ${i} ${'x'.repeat(size)}`,
    ).join('\n\n');
  }

  it('a transcript under the cap costs exactly one extract and one resolve', async () => {
    const draft = {
      kind: 'fact' as const,
      subject: 's',
      content: 'c',
      salienceHint: 0.5,
    };
    const spy = makeLlmSpy([draft]);
    const svc = buildService({ llm: spy.llm });

    await svc.curate({
      sessionId: 's1',
      transcript: 'USER: hello\n\nASSISTANT: hi',
    });

    expect(spy.extract).toHaveBeenCalledTimes(1);
    expect(spy.resolve).toHaveBeenCalledTimes(1);
    expect(spy.extract.mock.calls[0][0]).toBe('USER: hello\n\nASSISTANT: hi');
  });

  it('never hands extract() more than one window, on any call', async () => {
    const spy = makeLlmSpy();
    const svc = buildService({ llm: spy.llm });
    const transcript = transcriptOf(268, 640);

    expect(transcript.length).toBeGreaterThan(170_000);

    await svc.curate({ sessionId: 's1', transcript });

    expect(spy.extract.mock.calls.length).toBeGreaterThan(1);
    for (const call of spy.extract.mock.calls) {
      expect((call[0] as string).length).toBeLessThanOrEqual(
        CURATOR_TRANSCRIPT_MAX_CHARS,
      );
    }
  });

  it('a 400 KB transcript costs at most 8 extracts and exactly one resolve, and the resolve receives every window union', async () => {
    let window = 0;
    const extract = jest.fn().mockImplementation(() => {
      window++;
      return Promise.resolve({
        status: 'extracted',
        drafts: [
          {
            kind: 'fact',
            subject: `s${window}`,
            content: 'c',
            salienceHint: 1,
          },
          // Repeated verbatim by every window — the union must keep one.
          { kind: 'fact', subject: 'shared', content: 'same', salienceHint: 1 },
        ],
      });
    });
    const resolve = jest.fn().mockResolvedValue([]);
    const svc = buildService({
      llm: { extract, resolve } as unknown as ICuratorLLM,
    });

    await svc.curate({
      sessionId: 's-400k',
      transcript: transcriptOf(400, 1_000),
    });

    expect(extract.mock.calls.length).toBeGreaterThan(1);
    expect(extract.mock.calls.length).toBeLessThanOrEqual(CURATOR_MAX_WINDOWS);
    expect(resolve).toHaveBeenCalledTimes(1);

    const sent = resolve.mock.calls[0][0] as { subject: string }[];
    expect(sent).toHaveLength(extract.mock.calls.length + 1);
    expect(sent.filter((d) => d.subject === 'shared')).toHaveLength(1);
  });

  it('an extract rejection on window 3 records a curator error and issues no resolve', async () => {
    let call = 0;
    const extract = jest.fn().mockImplementation(() => {
      call++;
      if (call === 3) return Promise.reject(new Error('window 3 exploded'));
      return Promise.resolve({ status: 'extracted', drafts: [] });
    });
    const resolve = jest.fn().mockResolvedValue([]);
    const svc = buildService({
      llm: { extract, resolve } as unknown as ICuratorLLM,
    });

    const stats = await svc.curate({
      sessionId: 's-boom',
      transcript: transcriptOf(400, 1_000),
    });

    expect(extract).toHaveBeenCalledTimes(3);
    expect(resolve).not.toHaveBeenCalled();
    expect(stats.extracted).toBe(0);
    const evt = svc.recentEvents(5).find((e) => e.kind === 'curator-error');
    expect(evt?.error).toContain('memory extraction failed');
    expect(evt?.error).toContain('window 3 exploded');
  });

  it('an abort signalled after window 2 stops the loop', async () => {
    const controller = new AbortController();
    let call = 0;
    const extract = jest.fn().mockImplementation(() => {
      call++;
      if (call === 2) controller.abort();
      return Promise.resolve({ status: 'extracted', drafts: [] });
    });
    const resolve = jest.fn().mockResolvedValue([]);
    const svc = buildService({
      llm: { extract, resolve } as unknown as ICuratorLLM,
    });

    await svc.curate({
      sessionId: 's-abort',
      transcript: transcriptOf(400, 1_000),
      signal: controller.signal,
    });

    expect(extract).toHaveBeenCalledTimes(2);
    expect(resolve).not.toHaveBeenCalled();
    const evt = svc.recentEvents(5).find((e) => e.kind === 'curator-error');
    expect(evt?.error).toContain('aborted after 2');
  });

  it('a stalled window stops the loop and takes the stall path', async () => {
    let call = 0;
    const extract = jest.fn().mockImplementation(() => {
      call++;
      if (call === 2) {
        return Promise.resolve({
          status: 'stalled',
          reason: 'provider-cooling-down',
          providerId: 'p1',
        });
      }
      return Promise.resolve({ status: 'extracted', drafts: [] });
    });
    const resolve = jest.fn().mockResolvedValue([]);
    const svc = buildService({
      llm: { extract, resolve } as unknown as ICuratorLLM,
    });

    const stats = await svc.curate({
      sessionId: 's-stall',
      transcript: transcriptOf(400, 1_000),
    });

    expect(stats.outcome).toBe('stalled');
    expect(extract).toHaveBeenCalledTimes(2);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('warns only when a transcript exceeds even the chunked budget', async () => {
    const spy = makeLlmSpy();
    const logger = makeLogger() as unknown as { warn: jest.Mock };
    const svc = buildService({ llm: spy.llm, logger: logger as never });

    await svc.curate({
      sessionId: 's-loud',
      transcript: transcriptOf(400, 1_000),
    });

    const call = logger.warn.mock.calls.find((c) =>
      String(c[0]).includes('exceeded the chunked curation budget'),
    );
    expect(call).toBeDefined();
    expect(call?.[1]).toMatchObject({
      sessionId: 's-loud',
      cap: CURATOR_TRANSCRIPT_MAX_CHARS * CURATOR_MAX_WINDOWS,
    });
    expect(
      (call?.[1] as { droppedChars: number }).droppedChars,
    ).toBeGreaterThan(130_000);
  });

  it('says nothing when the whole transcript fit', async () => {
    const spy = makeLlmSpy();
    const logger = makeLogger() as unknown as { warn: jest.Mock };
    const svc = buildService({ llm: spy.llm, logger: logger as never });

    await svc.curate({ sessionId: 's-quiet', transcript: 'USER: short' });

    expect(
      logger.warn.mock.calls.filter((c) =>
        String(c[0]).includes('exceeded the chunked curation budget'),
      ),
    ).toHaveLength(0);
  });
});

/**
 * TASK_2026_374 defect 1 — a MANUAL `/compact` plans ONE window.
 *
 * Measured before the fix: a 372-event session split into eight windows spent
 * sequentially at 24-37 s each, roughly four minutes of background provider
 * work on the same account and quota as the compaction the user was waiting
 * for. Automatic threshold compaction keeps the full budget — nobody is waiting
 * on it, and the coverage the chunked budget buys is the whole point of it.
 */
describe('MemoryCuratorService — manual PreCompact window budget', () => {
  type PreCompactData = Parameters<
    Parameters<ICompactionCallbackRegistry['register']>[0]
  >[0];

  /** A transcript of `records` blocks of `size` characters each. */
  function transcriptOf(records: number, size: number): string {
    return Array.from(
      { length: records },
      (_, i) => `USER: turn ${i} ${'x'.repeat(size)}`,
    ).join('\n\n');
  }

  function buildHarness(transcript: string): {
    fire: (trigger: 'manual' | 'auto') => Promise<void>;
    extract: jest.Mock;
    resolve: jest.Mock;
    logger: { info: jest.Mock; warn: jest.Mock };
  } {
    let handler: ((data: PreCompactData) => void) | null = null;
    const registry = {
      register: jest.fn((cb: (data: PreCompactData) => void) => {
        handler = cb;
        return () => {
          /* noop */
        };
      }),
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
      read: jest.fn().mockResolvedValue(transcript),
    } as unknown as ITranscriptReader;
    // One draft per window: `doCurate` short-circuits before `resolve` when
    // the union is empty, so an empty extraction could not tell "one window"
    // from "eight windows" by the resolve count.
    const extract = jest.fn().mockResolvedValue({
      status: 'extracted',
      drafts: [{ kind: 'fact', subject: 's', content: 'c', salienceHint: 0.5 }],
    });
    const resolve = jest.fn().mockResolvedValue([]);
    const logger = makeLogger();
    const svc = new MemoryCuratorService(
      logger,
      registry,
      store,
      scorer,
      transcriptReader,
      { extract, resolve } as unknown as ICuratorLLM,
    );
    svc.start();

    return {
      extract,
      resolve,
      logger: logger as unknown as { info: jest.Mock; warn: jest.Mock },
      fire: async (trigger) => {
        if (!handler)
          throw new Error('curator did not subscribe to PreCompact');
        handler({
          sessionId: 's-compact',
          trigger,
          timestamp: Date.now(),
          preTokens: 333_538,
          cwd: '/ws',
        });
        await svc.drain();
      },
    };
  }

  it('plans exactly one window on a transcript that would otherwise plan eight', async () => {
    const h = buildHarness(transcriptOf(400, 1_000));

    await h.fire('manual');

    expect(h.extract).toHaveBeenCalledTimes(1);
    expect(h.resolve).toHaveBeenCalledTimes(1);
  });

  it('keeps the full eight-window budget on an automatic trigger', async () => {
    const h = buildHarness(transcriptOf(400, 1_000));

    await h.fire('auto');

    expect(h.extract).toHaveBeenCalledTimes(CURATOR_MAX_WINDOWS);
    expect(h.resolve).toHaveBeenCalledTimes(1);
  });

  it('logs the narrowed clamp at info, keeping the warn for the rare case', async () => {
    const h = buildHarness(transcriptOf(400, 1_000));

    await h.fire('manual');

    expect(
      h.logger.warn.mock.calls.filter((c: unknown[]) =>
        String(c[0]).includes('exceeded the chunked curation budget'),
      ),
    ).toHaveLength(0);
    const narrowed = h.logger.info.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes('clamped to the narrowed curation budget'),
    );
    expect(narrowed).toBeDefined();
    expect(narrowed?.[1]).toMatchObject({
      sessionId: 's-compact',
      budgetWindows: 1,
      cap: CURATOR_TRANSCRIPT_MAX_CHARS,
    });
  });

  it('leaves a short manual compaction at its unchanged one-window cost', async () => {
    const h = buildHarness('USER: hello\n\nASSISTANT: hi');

    await h.fire('manual');

    expect(h.extract).toHaveBeenCalledTimes(1);
    expect(h.extract.mock.calls[0][0]).toBe('USER: hello\n\nASSISTANT: hi');
    expect(
      h.logger.info.mock.calls.filter((c: unknown[]) =>
        String(c[0]).includes('clamped to the narrowed curation budget'),
      ),
    ).toHaveLength(0);
  });

  it('cannot be widened past CURATOR_MAX_WINDOWS by a call site', async () => {
    const extract = jest
      .fn()
      .mockResolvedValue({ status: 'extracted', drafts: [] });
    const svc = buildService({
      llm: {
        extract,
        resolve: jest.fn().mockResolvedValue([]),
      } as unknown as ICuratorLLM,
    });

    await svc.curate({
      sessionId: 's-greedy',
      transcript: transcriptOf(400, 1_000),
      maxWindows: 64,
    });

    expect(extract).toHaveBeenCalledTimes(CURATOR_MAX_WINDOWS);
  });
});

/**
 * TASK_2026_376 F4 — a curation window must not be lost to the internal-query
 * concurrency gate.
 *
 * The fake gate below is the real one narrowed to what this test needs: one
 * lane, a ceiling of one, FIFO admission, and a wait ceiling after which the
 * waiter is rejected with the error `InternalQueryQueueTimeoutError` wrapped in
 * the `CuratorLlmQueryError` the curator adapter throws. Every millisecond
 * figure is scaled down from production (60 000 ms budget, 24-37 s windows) so
 * the ratio that produces the defect is preserved and the test stays fast.
 */
class FakeLaneGate {
  private busy = false;
  private readonly waiters: Array<() => void> = [];
  /** Waiters rejected for exceeding the wait ceiling. The number under test. */
  timeouts = 0;

  constructor(private readonly queueTimeoutMs: number) {}

  acquire(): Promise<() => void> {
    if (!this.busy) {
      this.busy = true;
      return Promise.resolve(() => this.release());
    }
    return new Promise<() => void>((resolve, reject) => {
      let settled = false;
      const admit = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.busy = true;
        resolve(() => this.release());
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const index = this.waiters.indexOf(admit);
        if (index >= 0) this.waiters.splice(index, 1);
        this.timeouts++;
        reject(queueSlotTimeoutError(this.queueTimeoutMs));
      }, this.queueTimeoutMs);
      this.waiters.push(admit);
    });
  }

  private release(): void {
    this.busy = false;
    const next = this.waiters.shift();
    if (next) next();
  }
}

function queueSlotTimeoutError(ms: number): Error {
  const inner = new Error(
    `Internal query waited longer than ${ms}ms for a concurrency slot.`,
  );
  inner.name = 'InternalQueryQueueTimeoutError';
  const wrapped = new Error(
    'The memory curator could not complete its language-model query.',
    { cause: inner },
  );
  wrapped.name = 'CuratorLlmQueryError';
  return wrapped;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** An `ICuratorLLM` whose every call must win a slot in `gate` first. */
function makeGatedLlm(
  gate: FakeLaneGate,
  queryMs: number,
): { llm: ICuratorLLM; extractCalls: string[] } {
  const extractCalls: string[] = [];
  const llm: ICuratorLLM = {
    extract: async (transcript: string) => {
      const release = await gate.acquire();
      try {
        extractCalls.push(transcript.slice(0, 12));
        await sleep(queryMs);
        return {
          status: 'extracted',
          drafts: [
            {
              kind: 'fact',
              subject: transcript.slice(0, 12),
              content: 'durable fact',
              salienceHint: 0.5,
            },
          ],
        };
      } finally {
        release();
      }
    },
    resolve: async (drafts) => {
      const release = await gate.acquire();
      try {
        await sleep(queryMs);
        return drafts.map((d) => ({ ...d, mergeTargetId: null }));
      } finally {
        release();
      }
    },
  };
  return { llm, extractCalls };
}

/** Long enough to plan several windows (`CURATOR_WINDOW_MAX_CHARS` is 32 KB). */
function multiWindowTranscript(marker: string): string {
  return Array.from(
    { length: 100 },
    (_, i) => `${marker} USER: turn ${i} ${'x'.repeat(1_000)}`,
  ).join('\n\n');
}

describe('MemoryCuratorService — concurrency-slot loss (TASK_2026_376 F4)', () => {
  it('a sibling window is not lost when a predecessor outlives the wait ceiling', async () => {
    // One query (40 ms) outlives the wait ceiling (15 ms), which is the
    // production ratio that dropped two sessions.
    const gate = new FakeLaneGate(15);
    const { llm, extractCalls } = makeGatedLlm(gate, 40);
    const svc = buildService({ llm });

    const [multi, sibling] = await Promise.all([
      svc.curate({
        sessionId: 'multi-window',
        transcript: multiWindowTranscript('A'),
      }),
      svc.curate({ sessionId: 'sibling', transcript: 'B USER: short session' }),
    ]);

    // The transcript really did cost more than one window — otherwise this
    // test would pass for the wrong reason.
    expect(
      extractCalls.filter((t) => t.startsWith('A')).length,
    ).toBeGreaterThan(1);
    expect(gate.timeouts).toBe(0);
    expect(multi).toMatchObject({ outcome: 'ran' });
    expect(multi.extracted).toBeGreaterThan(0);
    expect(sibling).toMatchObject({ outcome: 'ran' });
    expect(sibling.extracted).toBeGreaterThan(0);
  });

  it('defers instead of reporting a run when the slot is never won', async () => {
    const events: MemoryCuratorEvent[] = [];
    const llm = {
      extract: jest.fn().mockRejectedValue(queueSlotTimeoutError(60_000)),
      resolve: jest.fn(),
    } as unknown as ICuratorLLM;
    const svc = buildService({ llm });
    svc.onEvent((e) => events.push(e));

    const stats = await svc.curate({
      sessionId: 'congested',
      transcript: 'USER: something worth curating',
    });

    // `'stalled'` is what makes `MemoryTriggerService` leave the observation
    // rows unprocessed, so the next drain curates this session again.
    expect(stats.outcome).toBe('stalled');
    expect(stats.extracted).toBe(0);
    expect(events.map((e) => e.kind)).toContain('rate-limited');
    expect(events.map((e) => e.kind)).not.toContain('curator-run');
    // A deferred pass is not a run, so it must not become "last run".
    expect(svc.lastRunInfo().stats).toBeNull();
  });

  it('still reports a dispatched failure as a run', async () => {
    const llm = {
      extract: jest.fn().mockRejectedValue(new Error('provider returned 500')),
      resolve: jest.fn(),
    } as unknown as ICuratorLLM;
    const svc = buildService({ llm });

    const stats = await svc.curate({
      sessionId: 'broken',
      transcript: 'USER: something worth curating',
    });

    expect(stats.outcome).toBe('ran');
  });
});
