import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { MemoryCuratorEvent } from '../diagnostics.types';
import type { IEmbedder } from '@ptah-extension/persistence-sqlite';
import {
  EmbedderStatusService,
  type EmbedderStatusSnapshot,
} from './embedder-status.service';
import type {
  PipelineProgressInfo,
  PipelineProgressListener,
} from './embedder-worker-client';
import { EmbedderWorkerClient } from './embedder-worker-client';

interface CapturedEmbedder {
  dim: number;
  modelId: string;
  embed: jest.Mock;
  warmup: jest.Mock;
  dispose: jest.Mock;
  onPipelineProgress(listener: PipelineProgressListener): {
    dispose(): void;
  };
  triggerProgress(info: PipelineProgressInfo): void;
  warmupCallCount: number;
  warmupBehavior: 'resolve' | 'reject';
  warmupRejection?: Error;
}

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function makeCuratorSink(): {
  events: MemoryCuratorEvent[];
  pushEvent(ev: MemoryCuratorEvent): void;
} {
  const events: MemoryCuratorEvent[] = [];
  return {
    events,
    pushEvent(ev: MemoryCuratorEvent): void {
      events.push(ev);
    },
  };
}

function makeEmbedder(): CapturedEmbedder {
  const listeners = new Set<PipelineProgressListener>();
  const embedder = Object.create(EmbedderWorkerClient.prototype) as unknown as {
    dim: number;
    modelId: string;
    embed: jest.Mock;
    warmup: jest.Mock;
    dispose: jest.Mock;
    onPipelineProgress(listener: PipelineProgressListener): {
      dispose(): void;
    };
    triggerProgress(info: PipelineProgressInfo): void;
    warmupCallCount: number;
    warmupBehavior: 'resolve' | 'reject';
    warmupRejection?: Error;
  };
  Object.defineProperty(embedder, 'dim', { value: 384, writable: true });
  Object.defineProperty(embedder, 'modelId', {
    value: 'Xenova/bge-small-en-v1.5',
    writable: true,
  });
  embedder.warmupCallCount = 0;
  embedder.warmupBehavior = 'resolve';
  embedder.embed = jest.fn(async () => []);
  embedder.warmup = jest.fn(async () => {
    embedder.warmupCallCount++;
    if (embedder.warmupBehavior === 'reject') {
      throw embedder.warmupRejection ?? new Error('warmup failed');
    }
  });
  embedder.dispose = jest.fn(async () => undefined);
  embedder.onPipelineProgress = (listener: PipelineProgressListener) => {
    listeners.add(listener);
    return {
      dispose: () => listeners.delete(listener),
    };
  };
  embedder.triggerProgress = (info: PipelineProgressInfo) => {
    for (const l of listeners) l(info);
  };
  return embedder as unknown as CapturedEmbedder;
}

function buildService(opts?: {
  embedder?: CapturedEmbedder;
  curator?: ReturnType<typeof makeCuratorSink>;
}): {
  svc: EmbedderStatusService;
  embedder: CapturedEmbedder;
  curator: ReturnType<typeof makeCuratorSink>;
} {
  const embedder = opts?.embedder ?? makeEmbedder();
  const curator = opts?.curator ?? makeCuratorSink();
  const svc = new EmbedderStatusService(
    makeLogger(),
    embedder as unknown as IEmbedder,
    curator as unknown as ConstructorParameters<
      typeof EmbedderStatusService
    >[2],
  );
  return { svc, embedder, curator };
}

describe('EmbedderStatusService', () => {
  describe('initial state', () => {
    it('starts not-ready and not-downloading', () => {
      const { svc } = buildService();
      const snap = svc.getStatus();
      expect(snap.ready).toBe(false);
      expect(snap.downloading).toBe(false);
      expect(snap.progress).toBeUndefined();
      expect(snap.error).toBeUndefined();
    });
  });

  describe('ensureReady', () => {
    it('triggers warmup, emits starting + ready curator events, marks ready', async () => {
      const { svc, embedder, curator } = buildService();
      await svc.ensureReady();
      expect(embedder.warmupCallCount).toBe(1);
      expect(svc.getStatus().ready).toBe(true);
      expect(svc.getStatus().downloading).toBe(false);
      const kinds = curator.events.map((e) => e.kind);
      const phases = curator.events.map((e) => e.phase);
      expect(kinds).toContain('embedder-download');
      expect(phases).toEqual(expect.arrayContaining(['starting', 'ready']));
    });

    it('is reentrant — concurrent calls share the same in-flight promise', async () => {
      const { svc, embedder } = buildService();
      const deferred: { resolve: (() => void) | null } = { resolve: null };
      embedder.warmup = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            deferred.resolve = () => resolve();
          }),
      );
      const p1 = svc.ensureReady();
      const p2 = svc.ensureReady();
      expect(embedder.warmup).toHaveBeenCalledTimes(1);
      if (deferred.resolve) deferred.resolve();
      await Promise.all([p1, p2]);
      expect(embedder.warmup).toHaveBeenCalledTimes(1);
    });

    it('returns immediately when already ready (no second warmup)', async () => {
      const { svc, embedder } = buildService();
      await svc.ensureReady();
      await svc.ensureReady();
      expect(embedder.warmupCallCount).toBe(1);
    });

    it('records failure + rethrows when warmup rejects', async () => {
      const { svc, embedder, curator } = buildService();
      embedder.warmupBehavior = 'reject';
      embedder.warmupRejection = new Error('network down');
      await expect(svc.ensureReady()).rejects.toThrow('network down');
      const snap = svc.getStatus();
      expect(snap.ready).toBe(false);
      expect(snap.downloading).toBe(false);
      expect(snap.error?.message).toBe('network down');
      const failed = curator.events.find((e) => e.phase === 'failed');
      expect(failed).toBeDefined();
      expect(failed?.error).toBe('network down');
    });

    it('allows a retry after a previous failure', async () => {
      const { svc, embedder } = buildService();
      embedder.warmupBehavior = 'reject';
      embedder.warmupRejection = new Error('network down');
      await expect(svc.ensureReady()).rejects.toThrow();
      embedder.warmupBehavior = 'resolve';
      await svc.ensureReady();
      expect(svc.getStatus().ready).toBe(true);
      expect(embedder.warmupCallCount).toBe(2);
    });
  });

  describe('pipeline progress forwarding', () => {
    it('marks downloading on initiate / download statuses', () => {
      const { svc, embedder, curator } = buildService();
      embedder.triggerProgress({ status: 'initiate', name: 'm', file: 'f' });
      const snap = svc.getStatus();
      expect(snap.downloading).toBe(true);
      const starting = curator.events.find((e) => e.phase === 'starting');
      expect(starting).toBeDefined();
    });

    it('reports clamped progress ratio from explicit progress percent', () => {
      const { svc, embedder } = buildService();
      embedder.triggerProgress({
        status: 'progress',
        name: 'm',
        file: 'f',
        progress: 42,
        loaded: 100,
        total: 200,
      });
      const snap = svc.getStatus();
      expect(snap.downloading).toBe(true);
      expect(snap.progress).toBeCloseTo(0.42, 5);
    });

    it('derives progress from loaded/total when percent is missing', () => {
      const { svc, embedder } = buildService();
      embedder.triggerProgress({
        status: 'progress',
        name: 'm',
        file: 'f',
        loaded: 150,
        total: 300,
      });
      expect(svc.getStatus().progress).toBeCloseTo(0.5, 5);
    });

    it('throttles curator-buffer progress emissions to ~500ms', () => {
      const { embedder, curator } = buildService();
      for (let i = 0; i < 10; i++) {
        embedder.triggerProgress({
          status: 'progress',
          name: 'm',
          file: 'f',
          progress: i * 10,
        });
      }
      const downloadingEvents = curator.events.filter(
        (e) => e.phase === 'downloading',
      );
      expect(downloadingEvents.length).toBeLessThanOrEqual(2);
    });

    it('transitions to ready on the ready status', () => {
      const { svc, embedder, curator } = buildService();
      embedder.triggerProgress({
        status: 'ready',
        name: 'Xenova/bge-small-en-v1.5',
        file: '',
      });
      const snap = svc.getStatus();
      expect(snap.ready).toBe(true);
      expect(snap.downloading).toBe(false);
      expect(snap.progress).toBe(1);
      const readyEvent = curator.events.find((e) => e.phase === 'ready');
      expect(readyEvent).toBeDefined();
    });
  });

  describe('recordError', () => {
    it('captures error and emits failed curator event', () => {
      const { svc, curator } = buildService();
      svc.recordError({ message: 'fetch failed', code: 'ENETUNREACH' });
      const snap = svc.getStatus();
      expect(snap.error?.message).toBe('fetch failed');
      expect(snap.error?.code).toBe('ENETUNREACH');
      const failed = curator.events.find((e) => e.phase === 'failed');
      expect(failed?.error).toBe('fetch failed');
    });
  });

  describe('change listeners', () => {
    it('notifies subscribers on state transitions', async () => {
      const { svc } = buildService();
      const seen: EmbedderStatusSnapshot[] = [];
      const sub = svc.on('change', (s) => seen.push(s));
      await svc.ensureReady();
      sub.dispose();
      expect(seen.length).toBeGreaterThanOrEqual(2);
      expect(seen[seen.length - 1].ready).toBe(true);
    });

    it('stops notifying after dispose', async () => {
      const { svc } = buildService();
      const listener = jest.fn();
      const sub = svc.on('change', listener);
      sub.dispose();
      await svc.ensureReady();
      expect(listener).not.toHaveBeenCalled();
    });

    it('rejects unsupported event names', () => {
      const { svc } = buildService();
      expect(() => svc.on('unknown' as 'change', () => undefined)).toThrow(
        /unsupported event/,
      );
    });
  });

  describe('curator buffer event payload shape', () => {
    it('emits embedder-download kind with phase + numeric progress + timestamp', async () => {
      const { svc, curator } = buildService();
      await svc.ensureReady();
      for (const ev of curator.events) {
        expect(ev.kind).toBe('embedder-download');
        expect(typeof ev.timestamp).toBe('number');
        expect(['starting', 'downloading', 'ready', 'failed']).toContain(
          ev.phase,
        );
      }
      const ready = curator.events.find((e) => e.phase === 'ready');
      expect(ready?.progress).toBe(1);
    });
  });
});
