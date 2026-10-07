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
import type {
  IEmbedder,
  VecStatusService,
} from '@ptah-extension/persistence-sqlite';
import {
  CURATOR_PRECOMPACT_MIN_INTERVAL_MS,
  MemoryCuratorService,
} from './memory-curator.service';
import { MemoryStore } from './memory.store';
import type { MemorySearchService } from './memory-search.service';
import { memoryId, type MemorySearchHit } from './memory.types';
import {
  openRetentionTestDb,
  removeRetentionTempDirs,
  seedMemories,
  type RetentionTestDb,
} from './retention/retention-sqlite.test-support';
import type { ICuratorLLM } from './curator-llm/curator-llm.interface';
import { CURATOR_TRANSCRIPT_MAX_CHARS } from './curator-llm/clamp-transcript';
import { CURATOR_MAX_WINDOWS } from './curator-llm/transcript-windows';
import { CURATOR_QUEUE_WAIT_CEILING_MS } from './curator-llm/curator-job-queue';
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
    findMergeCandidates: jest.fn(() => []),
    insertMemoryWithChunks: jest.fn().mockResolvedValue(undefined),
    appendChunks: jest.fn().mockResolvedValue(undefined),
    getById: jest.fn(),
  } as unknown as MemoryStore;
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
      workspaceRoot: '/ws/a',
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
    expect(events.find((e) => e.kind === 'curator-run')).toMatchObject({
      workspaceRoot: '/ws/a',
    });
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
    svc.pushEvent({ kind: 'manual-run', timestamp: 3 });
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
      findMergeCandidates: jest.fn(() => []),
      insertMemoryWithChunks: jest.fn().mockResolvedValue(undefined),
      appendChunks: jest.fn().mockResolvedValue(undefined),
      getById: jest.fn(),
    } as unknown as MemoryStore;
    const transcriptReader = {
      read: jest.fn().mockResolvedValue(''),
    } as unknown as ITranscriptReader;
    const svc = new MemoryCuratorService(
      makeLogger(),
      registry,
      store,
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
      findMergeCandidates: jest.fn(() => []),
      insertMemoryWithChunks,
      appendChunks: jest.fn().mockResolvedValue(undefined),
      getById: jest.fn(),
    } as unknown as MemoryStore;
    const transcriptReader = {
      read: jest.fn().mockResolvedValue(recordedTranscript),
    } as unknown as ITranscriptReader;

    const svc = new MemoryCuratorService(
      makeLogger(),
      registry,
      store,
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

    expect(extract).toHaveBeenCalledWith(recordedTranscript, undefined, {
      userInitiated: undefined,
    });
    expect(insertMemoryWithChunks).toHaveBeenCalledTimes(1);

    const insertedMemory = (insertMemoryWithChunks as jest.Mock).mock
      .calls[0][0];
    expect(insertedMemory.salience).toBe(0.6);
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
      findMergeCandidates: jest.fn(() => []),
      insertMemoryWithChunks: jest.fn().mockResolvedValue(undefined),
      appendChunks: jest.fn().mockResolvedValue(undefined),
      getById: jest.fn(),
    } as unknown as MemoryStore;
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
      outcome: 'failed',
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
      outcome: 'failed',
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
      outcome: 'failed',
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
      outcome: 'failed',
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
      findMergeCandidates: jest.fn(() => []),
      insertMemoryWithChunks: jest.fn().mockResolvedValue(undefined),
      appendChunks: jest.fn().mockResolvedValue(undefined),
      getById: jest.fn(),
    } as unknown as MemoryStore;
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
      findMergeCandidates: jest.fn(() => []),
      insertMemoryWithChunks: jest.fn().mockResolvedValue(undefined),
      appendChunks: jest.fn().mockResolvedValue(undefined),
      getById: jest.fn(),
    } as unknown as MemoryStore;
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

describe('MemoryCuratorService — PreCompact master gate', () => {
  it('does not start a PreCompact curate while memory is paused', async () => {
    type Data = Parameters<
      Parameters<ICompactionCallbackRegistry['register']>[0]
    >[0];
    const handler: { current: ((data: Data) => void) | null } = {
      current: null,
    };
    const extract = jest
      .fn()
      .mockResolvedValue({ status: 'extracted', drafts: [] });
    const service = new MemoryCuratorService(
      makeLogger(),
      {
        register: jest.fn((callback: (data: Data) => void) => {
          handler.current = callback;
          return () => undefined;
        }),
      } as unknown as ICompactionCallbackRegistry,
      {
        list: jest.fn(() => ({ memories: [], total: 0 })),
        findMergeCandidates: jest.fn(() => []),
      } as unknown as MemoryStore,
      {
        read: jest.fn().mockResolvedValue('USER: remembered detail'),
      } as unknown as ITranscriptReader,
      {
        extract,
        resolve: jest.fn().mockResolvedValue([]),
      } as unknown as ICuratorLLM,
      null,
      null,
      {
        getConfiguration: jest.fn(() => false),
      } as unknown as IWorkspaceProvider,
    );
    service.start();

    if (!handler.current) throw new Error('curator did not subscribe');
    handler.current({
      sessionId: 'paused-session',
      trigger: 'auto',
      timestamp: Date.now(),
      preTokens: 1,
      cwd: '/ws',
    });
    await service.drain();

    expect(extract).not.toHaveBeenCalled();
  });
});

/**
 * TASK_2026_597 A7 (R5.5) — PreCompact curations of one session are coalesced
 * to at most one per {@link CURATOR_PRECOMPACT_MIN_INTERVAL_MS}.
 */
describe('MemoryCuratorService — PreCompact coalescing (TASK_2026_597 A7)', () => {
  type PreCompactData = Parameters<
    Parameters<ICompactionCallbackRegistry['register']>[0]
  >[0];

  let now: number;
  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function buildHarness(): {
    svc: MemoryCuratorService;
    fire: (sessionId?: string, trigger?: string) => Promise<void>;
    read: jest.Mock;
    register: jest.Mock;
    dispose: jest.Mock;
    logger: { info: jest.Mock };
    extract: jest.Mock;
  } {
    let handler: ((data: PreCompactData) => void) | null = null;
    const dispose = jest.fn();
    const extract = jest
      .fn()
      .mockResolvedValue({ status: 'extracted', drafts: [] });
    const register = jest.fn((cb: (data: PreCompactData) => void) => {
      handler = cb;
      return dispose;
    });
    const registry = { register } as unknown as ICompactionCallbackRegistry;
    const store = {
      list: jest.fn(() => ({ memories: [], total: 0 })),
      findMergeCandidates: jest.fn(() => []),
      insertMemoryWithChunks: jest.fn().mockResolvedValue(undefined),
      appendChunks: jest.fn().mockResolvedValue(undefined),
      getById: jest.fn(),
    } as unknown as MemoryStore;
    const read = jest.fn().mockResolvedValue('USER: hello\n\nASSISTANT: hi');
    const logger = makeLogger();
    const svc = new MemoryCuratorService(
      logger,
      registry,
      store,
      { read } as unknown as ITranscriptReader,
      {
        extract,
        resolve: jest.fn().mockResolvedValue([]),
      } as unknown as ICuratorLLM,
    );
    svc.start();
    return {
      svc,
      read,
      register,
      dispose,
      extract,
      logger: logger as unknown as { info: jest.Mock },
      fire: async (sessionId = 's-compact', trigger = 'auto') => {
        if (!handler)
          throw new Error('curator did not subscribe to PreCompact');
        handler({
          sessionId,
          trigger: trigger as PreCompactData['trigger'],
          timestamp: now,
          preTokens: 150_000,
          cwd: '/ws',
        });
        await svc.drain();
      },
    };
  }

  function skipLogs(logger: { info: jest.Mock }): unknown[][] {
    return logger.info.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('skipping a PreCompact curation'),
    );
  }

  it('fires once for two PreCompacts within the interval, logs the skip, and stays registered', async () => {
    const h = buildHarness();

    await h.fire();
    now += CURATOR_PRECOMPACT_MIN_INTERVAL_MS - 1;
    await h.fire();

    expect(h.read).toHaveBeenCalledTimes(1);
    const skips = skipLogs(h.logger);
    expect(skips).toHaveLength(1);
    expect(skips[0][1]).toMatchObject({
      sessionId: 's-compact',
      trigger: 'auto',
      sinceLastMs: CURATOR_PRECOMPACT_MIN_INTERVAL_MS - 1,
      minIntervalMs: CURATOR_PRECOMPACT_MIN_INTERVAL_MS,
    });
    expect(h.register).toHaveBeenCalledTimes(1);
    expect(h.dispose).not.toHaveBeenCalled();
  });

  it('fires again once the interval has passed', async () => {
    const h = buildHarness();

    await h.fire();
    now += CURATOR_PRECOMPACT_MIN_INTERVAL_MS;
    await h.fire();

    expect(h.read).toHaveBeenCalledTimes(2);
    expect(skipLogs(h.logger)).toHaveLength(0);
  });

  it('measures the interval from the last PreCompact that fired, not the last one skipped', async () => {
    const h = buildHarness();

    await h.fire();
    now += CURATOR_PRECOMPACT_MIN_INTERVAL_MS / 2;
    await h.fire();
    now += CURATOR_PRECOMPACT_MIN_INTERVAL_MS / 2;
    await h.fire();

    expect(h.read).toHaveBeenCalledTimes(2);
  });

  it('keeps one watermark per session', async () => {
    const h = buildHarness();

    await h.fire('s-a');
    await h.fire('s-b');

    expect(h.read).toHaveBeenCalledTimes(2);
  });

  it('forgets the watermark when the session ends', async () => {
    const h = buildHarness();

    await h.fire();
    h.svc.forgetSession('s-compact');
    await h.fire();

    expect(h.read).toHaveBeenCalledTimes(2);
  });

  it('does not stamp the watermark when the pass fails, so the next PreCompact retries', async () => {
    const h = buildHarness();
    h.extract.mockResolvedValueOnce({
      status: 'stalled',
      reason: 'provider-unreachable',
      providerId: 'openai-codex',
    });

    await h.fire();
    now += 1_000;
    await h.fire();

    expect(h.read).toHaveBeenCalledTimes(2);
    expect(skipLogs(h.logger)).toHaveLength(0);
  });

  it('does not skip a manual compaction inside the interval', async () => {
    const h = buildHarness();

    await h.fire('s-compact', 'auto');
    now += 1_000;
    await h.fire('s-compact', 'manual');

    expect(h.read).toHaveBeenCalledTimes(2);
    expect(skipLogs(h.logger)).toHaveLength(0);
  });

  it('carries the watermark across rekeySession', async () => {
    const h = buildHarness();

    await h.fire('tab-1');
    h.svc.rekeySession('tab-1', 'real-1');
    await h.fire('real-1');
    await h.fire('tab-1');

    expect(h.read).toHaveBeenCalledTimes(2);
    expect(skipLogs(h.logger)).toHaveLength(1);
  });

  /** Holds the next transcript read open until `release()` is called. */
  function holdNextRead(read: jest.Mock): () => void {
    let release: () => void = () => undefined;
    read.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('USER: hello\n\nASSISTANT: hi');
        }),
    );
    return () => release();
  }

  it('skips a second auto PreCompact that arrives while the first pass is still pending', async () => {
    const h = buildHarness();
    const release = holdNextRead(h.read);

    const first = h.fire();
    const second = h.fire();
    release();
    await Promise.all([first, second]);

    expect(h.read).toHaveBeenCalledTimes(1);
    expect(
      skipLogs(h.logger).some((c) =>
        String(c[0]).includes('already in flight'),
      ),
    ).toBe(true);

    // The settled reservation became the watermark.
    now += 1_000;
    await h.fire();
    expect(h.read).toHaveBeenCalledTimes(1);
  });

  it('does not stamp the watermark after a manual compaction', async () => {
    const h = buildHarness();

    await h.fire('s-compact', 'manual');
    now += 1_000;
    await h.fire('s-compact', 'auto');

    expect(h.read).toHaveBeenCalledTimes(2);
    expect(skipLogs(h.logger)).toHaveLength(0);
  });

  it('stamps the CURRENT session id when the session is rekeyed while its pass is pending', async () => {
    const h = buildHarness();
    const release = holdNextRead(h.read);

    const first = h.fire('tab-1');
    h.svc.rekeySession('tab-1', 'real-1');
    release();
    await first;
    now += 1_000;
    await h.fire('real-1');
    await h.fire('tab-1');

    expect(h.read).toHaveBeenCalledTimes(2);
    expect(skipLogs(h.logger)).toHaveLength(1);
    expect(skipLogs(h.logger)[0][1]).toMatchObject({ sessionId: 'real-1' });
  });

  it('does not restore the watermark of a session forgotten while its pass was pending', async () => {
    const h = buildHarness();
    const release = holdNextRead(h.read);

    const first = h.fire();
    h.svc.forgetSession('s-compact');
    release();
    await first;
    now += 1_000;
    await h.fire();

    expect(h.read).toHaveBeenCalledTimes(2);
    expect(skipLogs(h.logger)).toHaveLength(0);
  });

  it('keeps the later watermark when both rekeyed ids have one', async () => {
    const h = buildHarness();
    const halfInterval = CURATOR_PRECOMPACT_MIN_INTERVAL_MS / 2;

    await h.fire('real-1');
    now += halfInterval + 1;
    await h.fire('tab-1');
    h.svc.rekeySession('tab-1', 'real-1');
    now += halfInterval;
    await h.fire('real-1');

    // Measured from tab-1's later pass, real-1 is still inside the interval.
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(skipLogs(h.logger)).toHaveLength(1);
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

  it('reports a dispatched failure as failed, not as a run (TASK_2026_621)', async () => {
    const llm = {
      extract: jest.fn().mockRejectedValue(new Error('provider returned 500')),
      resolve: jest.fn(),
    } as unknown as ICuratorLLM;
    const svc = buildService({ llm });

    const stats = await svc.curate({
      sessionId: 'broken',
      transcript: 'USER: something worth curating',
    });

    // `'ran'` would let the trigger mark the drained observations processed.
    expect(stats.outcome).toBe('failed');
  });
});

/**
 * TASK_2026_376 R1 — the three ways a pass must now decline to consume its
 * input, and the fan-out id it must refuse outright.
 */
describe('MemoryCuratorService — a pass that never read its input reports STALLED', () => {
  type CompactionCallback = Parameters<
    ICompactionCallbackRegistry['register']
  >[0];

  function buildParts(llm: ICuratorLLM): {
    svc: MemoryCuratorService;
    logger: Logger;
    transcriptReader: ITranscriptReader;
    store: MemoryStore;
    callbacks: CompactionCallback[];
  } {
    const callbacks: CompactionCallback[] = [];
    const registry = {
      register: jest.fn((cb: CompactionCallback) => {
        callbacks.push(cb);
        return () => {
          /* noop */
        };
      }),
    } as unknown as ICompactionCallbackRegistry;
    const store = {
      list: jest.fn(() => ({ memories: [], total: 0 })),
      findMergeCandidates: jest.fn(() => []),
      insertMemoryWithChunks: jest.fn().mockResolvedValue(undefined),
      appendChunks: jest.fn().mockResolvedValue(undefined),
      getById: jest.fn(),
    } as unknown as MemoryStore;
    const transcriptReader = {
      read: jest.fn().mockResolvedValue('a real transcript'),
    } as unknown as ITranscriptReader;
    const logger = makeLogger();
    const svc = new MemoryCuratorService(
      logger,
      registry,
      store,
      transcriptReader,
      llm,
    );
    return { svc, logger, transcriptReader, store, callbacks };
  }

  function llmReturning(extraction: unknown): ICuratorLLM {
    return {
      extract: jest.fn().mockResolvedValue(extraction),
      resolve: jest.fn().mockResolvedValue([]),
    } as unknown as ICuratorLLM;
  }

  it('maps a NO-OUTPUT extraction to stalled, so the observations survive', async () => {
    // The pass reached the model, spent its turns on tool calls and never wrote
    // its JSON. Reporting `'ran'` here is what told `MemoryTriggerService` to
    // mark the drained observation rows processed for a curation that produced
    // nothing — the same data loss F4 had just closed, on a different path.
    const { svc } = buildParts(
      llmReturning({
        status: 'no-output',
        usedTools: true,
        toolNames: ['mcp__ptah__ptah_memory_search'],
      }),
    );

    const stats = await svc.curate({
      sessionId: 'tool-only-session',
      transcript: 'a real transcript worth curating',
    });

    expect(stats.outcome).toBe('stalled');
    expect(stats.extracted).toBe(0);
    // A stalled pass is not a run: it must not overwrite the last real one.
    expect(svc.lastRunInfo().at).toBeNull();
    const kinds = svc.recentEvents(20).map((e) => e.kind);
    expect(kinds).toContain('rate-limited');
    expect(kinds).not.toContain('curator-run');
  });

  it('records WHY it deferred, so a quiet curator can be diagnosed', async () => {
    const { svc } = buildParts(
      llmReturning({ status: 'no-output', usedTools: false, toolNames: [] }),
    );
    await svc.curate({ sessionId: 's1', transcript: 'a real transcript' });
    const event = svc.recentEvents(20).find((e) => e.kind === 'rate-limited');
    expect(event?.stats).toMatchObject({
      source: 'curator-llm',
      reason: 'no-output',
      usedTools: false,
    });
  });

  it('does not run the pipeline at all for a caller that already aborted', async () => {
    const llm = llmReturning({ status: 'extracted', drafts: [] });
    const { svc } = buildParts(llm);
    const controller = new AbortController();
    controller.abort();

    const stats = await svc.curate({
      sessionId: 'withdrawn',
      transcript: 'a real transcript',
      signal: controller.signal,
    });

    expect(stats.outcome).toBe('stalled');
    expect(llm.extract).not.toHaveBeenCalled();
  });

  it('refuses a PreCompact fan-out for an internal one-shot query id', async () => {
    // `internal-query-<epoch>` names no session and has no transcript on disk.
    // With `maxTurns: 6` the curator's OWN query can now cross a compaction
    // boundary, so this id can be fanned back into the service that produced it
    // (TASK_2026_376 R1, logic finding 4).
    const { svc, transcriptReader, callbacks } = buildParts(
      llmReturning({ status: 'extracted', drafts: [] }),
    );
    svc.start();
    expect(callbacks).toHaveLength(1);

    callbacks[0]({
      sessionId: 'internal-query-1757000000000',
      trigger: 'auto',
      timestamp: Date.now(),
      preTokens: 100_000,
      cwd: 'D:/ws',
    });
    await Promise.resolve();

    expect(transcriptReader.read).not.toHaveBeenCalled();
    expect(svc.recentEvents(20)).toHaveLength(0);
  });

  it('still curates a real session id through the same fan-out', async () => {
    const { svc, transcriptReader, callbacks } = buildParts(
      llmReturning({ status: 'extracted', drafts: [] }),
    );
    svc.start();

    callbacks[0]({
      sessionId: '50653b50-a03b-45a5-937b-b4944ab2e9f1',
      trigger: 'auto',
      timestamp: Date.now(),
      preTokens: 100_000,
      cwd: 'D:/ws',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transcriptReader.read).toHaveBeenCalled();
  });

  it('defers a pass that waits past the job-queue ceiling instead of hanging', async () => {
    // The `memory:runNow` RPC calls `curate()` with no signal, so before the
    // ceiling a user-triggered pass could sit behind background passes with no
    // bound and nothing to cancel it (TASK_2026_376 R1, logic finding 3).
    jest.useFakeTimers();
    try {
      let releaseFirst!: () => void;
      const firstPass = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const llm = {
        extract: jest.fn(async () => {
          await firstPass;
          return { status: 'extracted', drafts: [] };
        }),
        resolve: jest.fn().mockResolvedValue([]),
      } as unknown as ICuratorLLM;
      const { svc } = buildParts(llm);

      const blocking = svc.curate({
        sessionId: 'background-pass',
        transcript: 'a real transcript',
      });
      const queued = svc.curate({
        sessionId: 'user-triggered-pass',
        transcript: 'a real transcript',
      });

      await Promise.resolve();
      jest.advanceTimersByTime(CURATOR_QUEUE_WAIT_CEILING_MS + 1);

      const queuedStats = await queued;
      expect(queuedStats.outcome).toBe('stalled');
      // The chain is intact: the blocking pass still owns its slot and still
      // finishes normally.
      expect(llm.extract).toHaveBeenCalledTimes(1);
      releaseFirst();
      await expect(blocking).resolves.toMatchObject({ outcome: 'ran' });
      // The abandoned pass is never dispatched, even once its turn arrives.
      await Promise.resolve();
      expect(llm.extract).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

/**
 * TASK_2026_437 C14, Batch 16b. `memory:runNow` is the one curate a user waits
 * on: it passes `userInitiated`, and every LLM call of that pass — each extract
 * window and the resolve — must carry it so the adapter skips the governor. A
 * trigger-driven pass carries nothing.
 */
describe('MemoryCuratorService — userInitiated reaches every curator LLM call', () => {
  function harness() {
    const draft = {
      kind: 'fact' as const,
      subject: 'ptah',
      content: 'lanes exist',
      salienceHint: 0.5,
    };
    const extract = jest
      .fn()
      .mockResolvedValue({ status: 'extracted', drafts: [draft] });
    const resolve = jest
      .fn()
      .mockResolvedValue([{ ...draft, mergeTargetId: null }]);
    const svc = new MemoryCuratorService(
      makeLogger(),
      {
        register: jest.fn(() => () => undefined),
      } as unknown as ICompactionCallbackRegistry,
      {
        list: jest.fn(() => ({ memories: [], total: 0 })),
        findMergeCandidates: jest.fn(() => []),
        insertMemoryWithChunks: jest.fn().mockResolvedValue(undefined),
        appendChunks: jest.fn().mockResolvedValue(undefined),
        getById: jest.fn(),
      } as unknown as MemoryStore,
      { read: jest.fn() } as unknown as ITranscriptReader,
      { extract, resolve } as unknown as ICuratorLLM,
    );
    return { svc, extract, resolve };
  }

  it('passes { userInitiated: true } to extract and resolve for the runNow pass', async () => {
    const { svc, extract, resolve } = harness();

    await svc.curate({
      sessionId: 'manual-1',
      workspaceRoot: '/ws',
      transcript: '{"type":"user","content":"remember the lanes"}',
      userInitiated: true,
    });

    expect(extract).toHaveBeenCalled();
    for (const call of extract.mock.calls) {
      expect(call[2]).toEqual({ userInitiated: true });
    }
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0][3]).toEqual({ userInitiated: true });
  });

  it('logs once when a user-initiated curate joins an in-flight pass, and changes nothing else', async () => {
    const { svc, extract } = harness();
    const logger = (svc as unknown as { logger: { info: jest.Mock } }).logger;
    let releaseExtract: () => void = () => undefined;
    extract.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseExtract = () => resolve({ status: 'extracted', drafts: [] });
        }),
    );
    const input = {
      sessionId: 'shared-1',
      workspaceRoot: '/ws',
      transcript: '{"type":"user","content":"remember the lanes"}',
    };

    const background = svc.curate(input);
    const manual = svc.curate({ ...input, userInitiated: true });

    const joined = logger.info.mock.calls.filter((call) =>
      String(call[0]).includes('joined an in-flight pass'),
    );
    expect(joined).toEqual([
      [
        "[memory-curator] user-initiated curate joined an in-flight pass; it keeps that pass's lane",
        { sessionId: 'shared-1' },
      ],
    ]);

    await new Promise((resolve) => setImmediate(resolve));
    releaseExtract();
    const [backgroundStats, manualStats] = await Promise.all([
      background,
      manual,
    ]);
    // One pass, shared: the manual call got the background pass's result, and
    // that pass ran on its own (background) options.
    expect(manualStats).toEqual(backgroundStats);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract.mock.calls[0][2]).toEqual({ userInitiated: undefined });
  });

  it('leaves userInitiated unset for a pass nobody is waiting on', async () => {
    const { svc, extract, resolve } = harness();

    await svc.curate({
      sessionId: 'trigger-1',
      workspaceRoot: '/ws',
      transcript: '{"type":"user","content":"remember the lanes"}',
    });

    expect(extract.mock.calls[0][2]).toEqual({ userInitiated: undefined });
    expect(resolve.mock.calls[0][3]).toEqual({ userInitiated: undefined });
  });
});

/**
 * TASK_2026_563 M3 + M5 criterion 8: the resolve candidates are tier 1 plus a
 * scoped tier 2 of semantic hits, and a resolver-chosen merge target is used
 * only when it was in that list and is still an active row in this workspace.
 * Real SQLite store, so the guard reads the actual `quarantined_at` and
 * `workspace_root` columns.
 */
describe('MemoryCuratorService — tier-2 merge candidates and the merge guard', () => {
  const WS = '/ws/guard';
  const TRANSCRIPT = '{"type":"user","content":"remember the alpha decision"}';
  const zeroEmbedder = {
    dim: 384,
    embed: async (texts: readonly string[]) =>
      texts.map(() => new Float32Array(384)),
  } as unknown as IEmbedder;

  let t: RetentionTestDb;
  let store: MemoryStore;

  beforeEach(() => {
    t = openRetentionTestDb({ memorySchema: true, vec: true });
    store = new MemoryStore(makeLogger(), t.connection, zeroEmbedder, {
      available: true,
    } as VecStatusService);
    seedMemories(t.raw, [
      { id: 'tier1-row', workspaceRoot: WS, salience: 0.7 },
      { id: 'quarantine-me', workspaceRoot: WS, salience: 0.4 },
      { id: 'semantic-row', workspaceRoot: WS, salience: 0.5 },
      { id: 'foreign-row', workspaceRoot: '/ws/other', salience: 0.5 },
    ]);
    const setSubject = t.raw.prepare(
      'UPDATE memories SET subject = ? WHERE id = ?',
    );
    setSubject.run('alpha', 'tier1-row');
    setSubject.run('alpha', 'quarantine-me');
    setSubject.run('unrelated topic', 'semantic-row');
    setSubject.run('alpha', 'foreign-row');
  });
  afterEach(() => t.close());
  afterAll(() => removeRetentionTempDirs());

  const draft = {
    kind: 'fact' as const,
    subject: 'alpha',
    content: 'alpha decision recorded',
    salienceHint: 0.5,
  };

  function searchReturning(ids: readonly string[]): {
    search: MemorySearchService;
    searchRich: jest.Mock;
  } {
    const searchRich = jest.fn(async () => ({
      hits: ids.map((id) => {
        const memory = store.getById(memoryId(id));
        if (!memory) throw new Error(`seed row ${id} missing`);
        return { memory } as unknown as MemorySearchHit;
      }),
      bm25Only: false,
    }));
    return {
      search: { searchRich } as unknown as MemorySearchService,
      searchRich,
    };
  }

  function build(
    resolve: jest.Mock,
    search: MemorySearchService | null,
    logger: Logger = makeLogger(),
  ): MemoryCuratorService {
    return new MemoryCuratorService(
      logger,
      {
        register: jest.fn(() => () => undefined),
      } as unknown as ICompactionCallbackRegistry,
      store,
      { read: jest.fn() } as unknown as ITranscriptReader,
      {
        extract: jest
          .fn()
          .mockResolvedValue({ status: 'extracted', drafts: [draft] }),
        resolve,
      } as unknown as ICuratorLLM,
      null,
      null,
      null,
      undefined,
      null,
      search,
    );
  }

  const chunkCount = (id: string): number =>
    Number(
      (
        t.raw
          .prepare(
            'SELECT COUNT(*) AS n FROM memory_chunks WHERE memory_id = ?',
          )
          .get(id) as { n: number | bigint }
      ).n,
    );
  const memoryCount = (): number =>
    Number(
      (
        t.raw.prepare('SELECT COUNT(*) AS n FROM memories').get() as {
          n: number | bigint;
        }
      ).n,
    );
  const refusals = (logger: Logger): unknown[] =>
    (logger.info as jest.Mock).mock.calls
      .filter((c) => String(c[0]).includes('merge target refused'))
      .map((c) => (c[1] as { reason: string }).reason);

  it('sends tier 1 then scoped tier-2 hits to resolve and merges into a tier-2 candidate', async () => {
    const { search, searchRich } = searchReturning(['semantic-row']);
    const resolve = jest
      .fn()
      .mockResolvedValue([{ ...draft, mergeTargetId: 'semantic-row' }]);
    const svc = build(resolve, search);

    const stats = await svc.curate({
      sessionId: 's-tier2',
      workspaceRoot: WS,
      transcript: TRANSCRIPT,
    });

    expect(searchRich).toHaveBeenCalledWith(
      'alpha alpha decision recorded',
      5,
      WS,
    );
    const related = resolve.mock.calls[0][1] as ReadonlyArray<{ id: string }>;
    expect(
      related
        .slice(0, 2)
        .map((c) => c.id)
        .sort(),
    ).toEqual(['quarantine-me', 'tier1-row']);
    expect(related.map((c) => c.id)[2]).toBe('semantic-row');
    expect(related).toHaveLength(3);
    expect(stats.merged).toBe(1);
    expect(stats.created).toBe(0);
    expect(chunkCount('semantic-row')).toBe(2);
  });

  it('inserts as new when the merge target is outside the candidate list (another workspace)', async () => {
    const { search } = searchReturning([]);
    const logger = makeLogger();
    const resolve = jest
      .fn()
      .mockResolvedValue([{ ...draft, mergeTargetId: 'foreign-row' }]);
    const before = memoryCount();

    const stats = await build(resolve, search, logger).curate({
      sessionId: 's-foreign',
      workspaceRoot: WS,
      transcript: TRANSCRIPT,
    });

    expect(stats.merged).toBe(0);
    expect(stats.created).toBe(1);
    expect(chunkCount('foreign-row')).toBe(1);
    expect(memoryCount()).toBe(before + 1);
    expect(refusals(logger)).toEqual(['not-in-candidates']);
  });

  it('inserts as new when the merge target is a candidate from another workspace scope', async () => {
    // The pass is unscoped (null), so tier 1 is the NULL-workspace rows; the
    // resolver still names a '/ws/guard' id, which getMergeTarget refuses even
    // when forced into the candidate set.
    t.raw
      .prepare('UPDATE memories SET workspace_root = NULL WHERE id = ?')
      .run('quarantine-me');
    const logger = makeLogger();
    const resolve = jest.fn(
      async (_d: unknown, related: ReadonlyArray<{ id: string }>) => {
        expect(related.map((c) => c.id)).toContain('quarantine-me');
        // Simulate the row moving scope between collection and write.
        t.raw
          .prepare('UPDATE memories SET workspace_root = ? WHERE id = ?')
          .run(WS, 'quarantine-me');
        return [{ ...draft, mergeTargetId: 'quarantine-me' }];
      },
    );

    const stats = await build(resolve, null, logger).curate({
      sessionId: 's-scope',
      workspaceRoot: null,
      transcript: TRANSCRIPT,
    });

    expect(stats.merged).toBe(0);
    expect(stats.created).toBe(1);
    expect(chunkCount('quarantine-me')).toBe(1);
    expect(refusals(logger)).toEqual(['ineligible']);
  });

  it('inserts as new when the merge target was quarantined after the candidates were collected', async () => {
    const { search } = searchReturning([]);
    const logger = makeLogger();
    const resolve = jest.fn(
      async (_d: unknown, related: ReadonlyArray<{ id: string }>) => {
        expect(related.map((c) => c.id)).toContain('quarantine-me');
        t.raw
          .prepare(
            `UPDATE memories SET quarantined_at = 5000, quarantine_reason = 'rule:test' WHERE id = ?`,
          )
          .run('quarantine-me');
        return [{ ...draft, mergeTargetId: 'quarantine-me' }];
      },
    );

    const stats = await build(resolve, search, logger).curate({
      sessionId: 's-quarantined',
      workspaceRoot: WS,
      transcript: TRANSCRIPT,
    });

    expect(stats.merged).toBe(0);
    expect(stats.created).toBe(1);
    expect(chunkCount('quarantine-me')).toBe(1);
    expect(refusals(logger)).toEqual(['ineligible']);
  });

  it('inserts once, without counting a merge, when the target is quarantined while its chunk is embedded', async () => {
    // Gate the FIRST embed (the append's) and quarantine the target while it
    // is held: after the pre-resolve guard passed, before the append commits.
    let releaseEmbed: () => void = () => undefined;
    const embedGate = new Promise<void>((resolve) => {
      releaseEmbed = resolve;
    });
    let embedCalls = 0;
    const gatedEmbedder = {
      dim: 384,
      embed: async (texts: readonly string[]) => {
        embedCalls++;
        if (embedCalls === 1) await embedGate;
        return texts.map(() => new Float32Array(384));
      },
    } as unknown as IEmbedder;
    store = new MemoryStore(makeLogger(), t.connection, gatedEmbedder, {
      available: true,
    } as VecStatusService);
    const getMergeTarget = jest.spyOn(store, 'getMergeTarget');
    const insert = jest.spyOn(store, 'insertMemoryWithChunks');
    const logger = makeLogger();
    const resolve = jest
      .fn()
      .mockResolvedValue([{ ...draft, mergeTargetId: 'tier1-row' }]);
    const before = memoryCount();

    const pass = build(resolve, null, logger).curate({
      sessionId: 's-commit-race',
      workspaceRoot: WS,
      transcript: TRANSCRIPT,
    });
    while (embedCalls === 0) {
      await new Promise((r) => setImmediate(r));
    }
    expect(getMergeTarget).toHaveReturnedWith(memoryId('tier1-row'));
    t.raw
      .prepare(
        `UPDATE memories SET quarantined_at = 5000, quarantine_reason = 'rule:test' WHERE id = ?`,
      )
      .run('tier1-row');
    releaseEmbed();
    const stats = await pass;

    expect(stats.merged).toBe(0);
    expect(stats.created).toBe(1);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(memoryCount()).toBe(before + 1);
    expect(chunkCount('tier1-row')).toBe(1);
    expect(refusals(logger)).toEqual(['ineligible-at-commit']);
  });

  it('leaves salience, hits and last_used_at of every candidate unchanged after a pass without a merge', async () => {
    const { search } = searchReturning(['semantic-row']);
    const resolve = jest
      .fn()
      .mockResolvedValue([{ ...draft, mergeTargetId: null }]);
    const snapshot = () =>
      t.raw
        .prepare(
          `SELECT id, salience, hits, last_used_at FROM memories
           WHERE id IN ('tier1-row', 'quarantine-me', 'semantic-row') ORDER BY id`,
        )
        .all();
    const before = snapshot();

    const stats = await build(resolve, search).curate({
      sessionId: 's-readonly',
      workspaceRoot: WS,
      transcript: TRANSCRIPT,
    });

    expect(stats.created).toBe(1);
    expect((resolve.mock.calls[0][1] as unknown[]).length).toBe(3);
    expect(snapshot()).toEqual(before);
  });
});
