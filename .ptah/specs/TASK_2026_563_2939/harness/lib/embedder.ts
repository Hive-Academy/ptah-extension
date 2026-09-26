/**
 * A real `EmbedderWorkerClient` wired the way the headless CLI host wires it
 * (`libs/backend/cli-engine/src/lib/thoth/cli-embedder-worker-factory.ts` +
 * `cli-worker-thread-process.ts`): an `IEmbedderWorkerProcessFactory` that
 * spawns the bundled `embedder-worker.ts` in a `node:worker_threads` Worker and
 * posts the `init` message (`modelCacheDir`) before any request. The worker
 * auto-detects the worker_threads transport (`embedder-worker.ts:55-83`).
 *
 * `modelCacheDir` is a BYTE COPY of
 * `~/.ptah/models/Xenova/{bge-small-en-v1.5,ms-marco-MiniLM-L-6-v2}` under
 * `%TEMP%\mqs-563-eval\models\`. The originals are only read. The worker sets
 * `env.cacheDir = modelCacheDir` and `env.allowLocalModels = false`, which is
 * the production configuration.
 *
 * Used by Phase 2: M3 reach 8a and the 8b replay (real embedder and reranker)
 * and KNN starvation. The relevance runs are BM25-only by definition
 * (VecStatus.available = false) and do not use it.
 *
 * Worker bundle (README): esbuild
 * libs/backend/memory-curator/src/lib/embedder/embedder-worker.ts --bundle
 * --platform=node --format=cjs --external:@huggingface/transformers
 * --outfile=%TEMP%\mqs-563-eval\embedder-worker.cjs
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { EmbedderWorkerClient } from '../../../../../libs/backend/memory-curator/src/lib/embedder/embedder-worker-client';
import type {
  IEmbedderWorkerProcess,
  IEmbedderWorkerProcessFactory,
} from '../../../../../libs/backend/memory-curator/src/lib/embedder/worker-process.port';
import { EVAL_DIR } from './copy-db';

export const MODEL_NAMES = [
  'bge-small-en-v1.5',
  'ms-marco-MiniLM-L-6-v2',
] as const;
export const MODEL_CACHE_DIR = path.join(EVAL_DIR, 'models');
export const WORKER_BUNDLE = path.join(EVAL_DIR, 'embedder-worker.cjs');
const SOURCE_MODELS = path.join(os.homedir(), '.ptah', 'models', 'Xenova');

/** Byte-copy the two model dirs once; never writes to the source. */
export function prepareModelCache(): { copied: string[]; reused: string[] } {
  const copied: string[] = [];
  const reused: string[] = [];
  for (const name of MODEL_NAMES) {
    const src = path.join(SOURCE_MODELS, name);
    const dest = path.join(MODEL_CACHE_DIR, 'Xenova', name);
    if (fs.existsSync(dest)) {
      reused.push(dest);
      continue;
    }
    if (!fs.existsSync(src)) throw new Error(`model source missing: ${src}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true, errorOnExist: true, force: false });
    copied.push(dest);
  }
  return { copied, reused };
}

class WorkerThreadProcess implements IEmbedderWorkerProcess {
  constructor(private readonly worker: Worker) {}

  postMessage(msg: unknown): void {
    this.worker.postMessage(msg);
  }

  on(event: 'message', cb: (msg: unknown) => void): void;
  on(event: 'exit', cb: (code: number | null) => void): void;
  on(
    event: 'message' | 'exit',
    cb: ((msg: unknown) => void) | ((code: number | null) => void),
  ): void {
    if (event === 'message')
      this.worker.on('message', cb as (msg: unknown) => void);
    else
      this.worker.on('exit', (code: number) =>
        (cb as (code: number | null) => void)(code),
      );
  }

  kill(): void {
    void this.worker.terminate();
  }
}

export class HarnessEmbedderWorkerFactory implements IEmbedderWorkerProcessFactory {
  constructor(
    private readonly workerPath: string = WORKER_BUNDLE,
    private readonly modelCacheDir: string = MODEL_CACHE_DIR,
  ) {}

  spawn(): IEmbedderWorkerProcess {
    if (!fs.existsSync(this.workerPath)) {
      throw new Error(
        `embedder worker bundle missing: ${this.workerPath} (see README)`,
      );
    }
    const proc = new WorkerThreadProcess(new Worker(this.workerPath));
    proc.postMessage({ type: 'init', modelCacheDir: this.modelCacheDir });
    return proc;
  }
}

/**
 * The real client over the harness factory (idle teardown 60 s). `workerPath`
 * defaults to the plain worker bundle; the M3 locality run passes the
 * net-guarded wrapper from `lib/net-guard.ts`, which requires the same bundle.
 */
export function buildEmbedder(
  logger: never,
  workerPath: string = WORKER_BUNDLE,
): EmbedderWorkerClient {
  prepareModelCache();
  return new EmbedderWorkerClient(
    logger,
    new HarnessEmbedderWorkerFactory(workerPath),
    60_000,
  );
}
