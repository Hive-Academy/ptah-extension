import { Injectable, NgZone, inject, signal } from '@angular/core';
import {
  getOrCreateWorkerPoolSingleton,
  terminateWorkerPoolSingleton,
  type WorkerPoolManager,
} from '@pierre/diffs/worker';
import {
  PIERRE_HIGHLIGHT_OPTIONS,
  registerPierreResources,
} from './pierre-config';

/**
 * `@pierre/diffs/dist/worker/worker-portable.js`, copied by the webview build
 * (`apps/ptah-extension-webview/project.json` assets). Relative, so it
 * resolves against the document's `<base href>` in both hosts.
 */
export const PIERRE_WORKER_SCRIPT_PATH = 'assets/pierre/worker-portable.js';

/** Fetching the worker script and starting the workers each get this long. */
const LOAD_TIMEOUT_MS = 10_000;

export type PierreWorkerPoolState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly pool: WorkerPoolManager }
  /** Workers could not start; Pierre highlights on the main thread. */
  | { readonly status: 'unavailable' };

/**
 * The page's one `@pierre/diffs` worker pool (gate-p4-a9-pierre-perf Q1): Shiki
 * tokenization runs in workers so a long review does not block the main
 * thread.
 *
 * A VS Code webview cannot start a worker from a file URL, so the
 * self-contained `worker-portable.js` (no imports, no eval) is fetched once
 * and every worker is created from one Blob URL; both hosts' CSPs allow
 * `worker-src blob:`. When any step fails the state becomes `unavailable`,
 * the failure is logged once, and renderers are given no pool.
 *
 * Reached only from the lazy renderer chunk: this file imports Pierre at
 * runtime and must never be imported from an eager barrel.
 */
@Injectable({ providedIn: 'root' })
export class PierreWorkerPoolService {
  private readonly ngZone = inject(NgZone);
  private readonly _state = signal<PierreWorkerPoolState>({
    status: 'loading',
  });
  private started = false;

  readonly state = this._state.asReadonly();

  /** Starts the single load; later calls do nothing. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.load().then(
      (pool) => this._state.set({ status: 'ready', pool }),
      (error: unknown) => {
        // Expected on hosts without workers; diffs still render, unthreaded.
        console.warn(
          '[PierreWorkerPool] worker pool unavailable; highlighting on the main thread',
          error,
        );
        this._state.set({ status: 'unavailable' });
      },
    );
  }

  private async load(): Promise<WorkerPoolManager> {
    if (
      typeof Worker === 'undefined' ||
      typeof fetch !== 'function' ||
      typeof URL.createObjectURL !== 'function'
    ) {
      throw new Error('Web workers are not available in this document');
    }
    // `initialize()` resolves PIERRE_HIGHLIGHT_OPTIONS.theme by name.
    registerPierreResources();
    const blobUrl = URL.createObjectURL(await fetchWorkerScript());
    const hardware = navigator.hardwareConcurrency || 4;
    // Outside the zone: every worker message would otherwise run app-wide
    // change detection. Signal writes from Pierre's callbacks still schedule it.
    const pool = this.ngZone.runOutsideAngular(() =>
      getOrCreateWorkerPoolSingleton({
        poolOptions: {
          workerFactory: () => new Worker(blobUrl, { name: 'pierre-diffs' }),
          poolSize: Math.max(2, Math.min(hardware, 6)),
          workerInitializationTimeout: LOAD_TIMEOUT_MS,
        },
        highlighterOptions: { ...PIERRE_HIGHLIGHT_OPTIONS },
      }),
    );
    try {
      await this.ngZone.runOutsideAngular(() => pool.initialize());
    } catch (error: unknown) {
      terminateWorkerPoolSingleton();
      URL.revokeObjectURL(blobUrl);
      throw error;
    }
    return pool;
  }
}

/** The worker script as a JavaScript Blob, or a rejection within the timeout. */
async function fetchWorkerScript(): Promise<Blob> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
  try {
    const response = await fetch(PIERRE_WORKER_SCRIPT_PATH, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `${PIERRE_WORKER_SCRIPT_PATH} responded ${response.status}`,
      );
    }
    return new Blob([await response.text()], { type: 'text/javascript' });
  } finally {
    clearTimeout(timer);
  }
}
