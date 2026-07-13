/**
 * Embedder worker entry — a single bundled `embedder-worker.mjs` driven by TWO
 * runtimes:
 *   - Electron `utilityProcess` (its own OS process, so a native ONNX `abort()`
 *     kills only the child; the main process gets an `exit` event and respawns).
 *     Bundled by ptah-electron's `build-embedder-worker` esbuild target.
 *   - Plain Node `worker_threads` in the headless CLI, which has no Electron
 *     `utilityProcess`. Bundled by ptah-cli's `build-embedder-worker` target.
 *
 * Runs `@huggingface/transformers` to embed text and cross-encode
 * (query, candidate) pairs for reranking, keeping the heavy ONNX runtime off
 * the host thread.
 *
 * Transport is auto-detected at startup: if `process.parentPort` exists (the
 * Electron utilityProcess global, whose 'message' events wrap the payload as
 * `{ data }`) we use it; otherwise we fall back to `node:worker_threads`
 * `parentPort` (raw payload). No `electron` import — the utilityProcess global
 * is provided by the runtime, keeping this file importable by the
 * (electron-free) backend lib bundle. Config (`modelCacheDir`) arrives via the
 * `init` message in BOTH transports, never via `workerData`.
 *
 * Protocol (matches `embedder-worker-protocol.ts`):
 *   request:  { type: 'init', modelCacheDir }
 *           | { id, type: 'embed',    texts: string[] }
 *           | { id, type: 'dispose' }
 *           | { id, type: 'rerank',   query, candidates: [{id,text}], topK }
 *           | { id, type: 'warmup' }
 *   response: { id, ok: true,  vectors: number[][] }
 *           | { id, ok: true,  ranked: [{id, score}] }
 *           | { id, ok: false, error: string }
 *   stream:   { type: 'pipeline-progress', info }
 */
import { parentPort as workerThreadsParentPort } from 'node:worker_threads';
import type {
  EmbedderWorkerInbound,
  PipelineProgressInfo,
} from './embedder-worker-protocol';

/**
 * Electron utilityProcess `process.parentPort` (a `MessagePortMain`): its
 * 'message' events wrap the payload as `{ data }`. Typed structurally so this
 * file needs no `electron` import.
 */
interface ElectronParentPortLike {
  on(event: 'message', cb: (e: { data: unknown }) => void): void;
  postMessage(msg: unknown): void;
}

const electronParentPort = (
  process as unknown as { parentPort?: ElectronParentPortLike }
).parentPort;

/**
 * Transport shim normalizing the two runtimes into a single `post(msg)` +
 * `subscribe(handler)` pair. Everything below (embed/rerank/warmup/dispose
 * dispatch and throttled `pipeline-progress` emission) is transport-agnostic.
 *
 * Electron delivers messages wrapped as `{ data }`; `node:worker_threads`
 * delivers the raw payload — the crux the two branches normalize.
 */
type PostFn = (msg: unknown) => void;
type MessageHandler = (msg: EmbedderWorkerInbound) => void;

let post: PostFn;
let subscribe: (handler: MessageHandler) => void;

if (electronParentPort) {
  const electronPort = electronParentPort;
  post = (msg) => electronPort.postMessage(msg);
  subscribe = (handler) =>
    electronPort.on('message', (e) => handler(e.data as EmbedderWorkerInbound));
} else if (workerThreadsParentPort) {
  const threadPort = workerThreadsParentPort;
  post = (msg) => threadPort.postMessage(msg);
  subscribe = (handler) =>
    threadPort.on('message', (payload: unknown) =>
      handler(payload as EmbedderWorkerInbound),
    );
} else {
  throw new Error(
    'embedder-worker.ts must be run as a worker (no Electron parentPort and no worker_threads parentPort)',
  );
}

/**
 * Writable model-cache directory injected by the main process via the `init`
 * message. Required when packaged: `@huggingface/transformers` defaults to
 * `<pkg>/.cache`, which lives inside `app.asar` (a file) and fails with
 * `ENOTDIR`. When absent (tests / unpackaged dev) the library default is used.
 */
let modelCacheDir: string | null = null;

interface TransformersEnv {
  cacheDir?: string;
  allowLocalModels?: boolean;
}

let envConfigured = false;

function configureTransformersEnv(env: TransformersEnv | undefined): void {
  if (envConfigured || !env || !modelCacheDir) return;
  env.cacheDir = modelCacheDir;
  env.allowLocalModels = false;
  envConfigured = true;
}

interface PipelineFn {
  (
    texts: string | string[],
    options: { pooling: string; normalize: boolean },
  ): Promise<{ data: Float32Array }>;
}

let pipelineSingleton: PipelineFn | null = null;
let pipelineLoading: Promise<PipelineFn> | null = null;

const PROGRESS_EMIT_THROTTLE_MS = 500;
let lastProgressEmitAt = 0;

function emitPipelineProgress(info: PipelineProgressInfo): void {
  if (info.status === 'progress') {
    const now = Date.now();
    if (now - lastProgressEmitAt < PROGRESS_EMIT_THROTTLE_MS) return;
    lastProgressEmitAt = now;
  }
  post({
    type: 'pipeline-progress',
    info,
  });
}

async function loadPipeline(): Promise<PipelineFn> {
  if (pipelineSingleton) return pipelineSingleton;
  if (pipelineLoading) return pipelineLoading;
  pipelineLoading = (async () => {
    const mod = (await import(
      '@huggingface/transformers' as unknown as string
    )) as {
      pipeline: (
        task: string,
        model: string,
        options: Record<string, unknown>,
      ) => Promise<PipelineFn>;
      env?: TransformersEnv;
    };
    configureTransformersEnv(mod.env);
    const { pipeline } = mod;
    lastProgressEmitAt = 0;
    emitPipelineProgress({
      status: 'initiate',
      name: 'Xenova/bge-small-en-v1.5',
    });
    const fn: PipelineFn = await pipeline(
      'feature-extraction',
      'Xenova/bge-small-en-v1.5',
      {
        // v4 removed the `quantized` boolean; `dtype: 'q8'` selects the same
        // 8-bit quantized ONNX weights (equivalent to the old `quantized: true`).
        dtype: 'q8',
        progress_callback: emitPipelineProgress,
      },
    );
    emitPipelineProgress({
      status: 'ready',
      name: 'Xenova/bge-small-en-v1.5',
    });
    pipelineSingleton = fn;
    return fn;
  })();
  pipelineLoading.catch(() => {
    pipelineLoading = null;
  });

  return pipelineLoading;
}

async function embed(texts: readonly string[]): Promise<number[][]> {
  const fn = await loadPipeline();
  const out: number[][] = [];
  for (const text of texts) {
    const result = await fn(text, { pooling: 'mean', normalize: true });
    out.push(Array.from(result.data));
  }
  return out;
}

/**
 * A single label-score entry returned by the transformers text-classification
 * pipeline. When topk is null the pipeline returns ALL labels per input item;
 * the array is sorted descending by score. For the MS-MARCO binary relevance
 * model the highest-scored label is always at index 0.
 */
interface LabelScore {
  label: string;
  score: number;
}

interface CrossEncoderFn {
  (
    pairs: ReadonlyArray<[string, string]>,
    options?: Record<string, unknown>,
  ): Promise<Array<LabelScore | LabelScore[]>>;
}

let crossEncoderSingleton: CrossEncoderFn | null = null;
let crossEncoderLoading: Promise<CrossEncoderFn> | null = null;

/**
 * Lazily load the cross-encoder model. Wrapped in a 10-second timeout per
 * §13 R-B (offline-boot guard): if the model download hangs, the loading
 * promise is cleared so the next call can retry instead of queuing forever.
 */
async function loadCrossEncoder(): Promise<CrossEncoderFn> {
  if (crossEncoderSingleton) return crossEncoderSingleton;
  if (crossEncoderLoading) return crossEncoderLoading;

  crossEncoderLoading = (async () => {
    const mod = (await import(
      '@huggingface/transformers' as unknown as string
    )) as {
      pipeline: (
        task: string,
        model: string,
        options: Record<string, unknown>,
      ) => Promise<CrossEncoderFn>;
      env?: TransformersEnv;
    };
    configureTransformersEnv(mod.env);

    const fn = await Promise.race([
      mod.pipeline('text-classification', 'Xenova/ms-marco-MiniLM-L-6-v2', {
        // v4 removed `quantized`; `dtype: 'q8'` selects the same q8 weights.
        dtype: 'q8',
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Cross-encoder model load timeout')),
          10_000,
        ),
      ),
    ]);

    crossEncoderSingleton = fn as unknown as CrossEncoderFn;
    return crossEncoderSingleton;
  })();
  crossEncoderLoading.catch(() => {
    crossEncoderLoading = null;
  });

  return crossEncoderLoading;
}

/**
 * Extract the relevance score from a single text-classification pipeline output
 * entry. When `topk: null` the pipeline returns an array of `{label, score}`
 * sorted descending — index 0 is the highest-scored label (the "relevant" class
 * for the MS-MARCO model). When a non-array is returned (some pipeline versions
 * return a bare object for single inputs), fall back to `entry.score`.
 */
function extractScore(entry: LabelScore | LabelScore[]): number {
  if (Array.isArray(entry)) {
    return entry[0]?.score ?? 0;
  }
  return entry.score;
}

/**
 * Run cross-encoder reranking on the given (query, candidate) pairs.
 * Returns candidates sorted by descending score, truncated to topK.
 *
 * Positional correspondence guarantee: `@huggingface/transformers` processes
 * batched text-classification inputs sequentially and returns results in
 * input order (one array element per input pair). `results[i]` is guaranteed
 * to correspond to `pairs[i]`. The `topk: null` option controls how many
 * label-score objects are returned *per pair*, not the order of pairs.
 */
async function rerank(
  query: string,
  candidates: ReadonlyArray<{ id: string; text: string }>,
  topK: number,
): Promise<ReadonlyArray<{ id: string; score: number }>> {
  const fn = await loadCrossEncoder();
  const pairs: Array<[string, string]> = candidates.map((c) => [query, c.text]);
  const results = await fn(pairs, {
    topk: null,
    truncation: true,
    max_length: 512,
  });
  const scored = candidates.map((c, i) => ({
    id: c.id,
    score: extractScore(results[i]),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Pre-load both models and JIT-compile ONNX execution providers via a
 * small dummy inference pass. Called by the WARMUP message 3s after
 * window-ready so the first real query pays no cold-start cost.
 */
async function warmup(): Promise<void> {
  await loadPipeline();
  await loadCrossEncoder();
  const dummy = await embed(['warmup']);
  await rerank('warmup', [{ id: 'x', text: dummy.toString() }], 1);
}

async function handleMessage(msg: EmbedderWorkerInbound): Promise<void> {
  if (msg.type === 'init') {
    modelCacheDir = msg.modelCacheDir;
    return;
  }

  try {
    if (msg.type === 'embed') {
      const vectors = await embed(msg.texts ?? []);
      post({ id: msg.id, ok: true, vectors });
      return;
    }

    if (msg.type === 'dispose') {
      pipelineSingleton = null;
      pipelineLoading = null;
      crossEncoderSingleton = null;
      crossEncoderLoading = null;
      post({ id: msg.id, ok: true, vectors: [] });
      return;
    }

    if (msg.type === 'rerank') {
      const ranked = await rerank(
        msg.query ?? '',
        msg.candidates ?? [],
        msg.topK ?? 10,
      );
      post({ id: msg.id, ok: true, ranked });
      return;
    }

    if (msg.type === 'warmup') {
      await warmup();
      post({ id: msg.id, ok: true, ranked: [] });
      return;
    }

    post({
      id: (msg as { id: number }).id,
      ok: false,
      error: `unknown message type: ${(msg as { type: string }).type}`,
    });
  } catch (err: unknown) {
    post({
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

subscribe((msg) => {
  void handleMessage(msg);
});
