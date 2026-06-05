/**
 * Worker thread entry — runs `@huggingface/transformers` to embed text and
 * cross-encode (query, candidate) pairs for reranking.
 *
 * Bundled separately by `apps/ptah-electron`'s `build-embedder-worker`
 * esbuild target. No imports from the rest of the workspace because it
 * runs in a fresh isolate.
 *
 * Protocol (matches `embedder-worker-client.ts`):
 *   request:  { id, type: 'embed',    texts: string[] }
 *           | { id, type: 'dispose' }
 *           | { id, type: 'rerank',   query: string, candidates: [{id,text}], topK: number }
 *           | { id, type: 'warmup' }
 *   response: { id, ok: true,  vectors: number[][] }
 *           | { id, ok: true,  ranked: [{id, score}] }
 *           | { id, ok: false, error: string }
 */
import { parentPort, workerData } from 'node:worker_threads';

if (!parentPort) {
  throw new Error('embedder-worker.ts must be run as a worker_thread');
}

const port = parentPort;

/**
 * Writable model-cache directory injected by the main thread. Required when
 * packaged: `@huggingface/transformers` defaults to `<pkg>/.cache`, which lives
 * inside `app.asar` (a file) and fails with `ENOTDIR`. When absent (tests /
 * unpackaged dev) the library default is used.
 */
const modelCacheDir: string | null =
  (workerData as { modelCacheDir?: string } | null)?.modelCacheDir ?? null;

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

interface PipelineProgressInfo {
  readonly status: 'initiate' | 'download' | 'progress' | 'done' | 'ready';
  readonly name?: string;
  readonly file?: string;
  readonly progress?: number;
  readonly loaded?: number;
  readonly total?: number;
}

const PROGRESS_EMIT_THROTTLE_MS = 500;
let lastProgressEmitAt = 0;

function emitPipelineProgress(info: PipelineProgressInfo): void {
  if (info.status === 'progress') {
    const now = Date.now();
    if (now - lastProgressEmitAt < PROGRESS_EMIT_THROTTLE_MS) return;
    lastProgressEmitAt = now;
  }
  port.postMessage({
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
        quantized: true,
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
        quantized: true,
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

port.on(
  'message',
  async (msg: {
    id: number;
    type: string;
    texts?: string[];
    query?: string;
    candidates?: ReadonlyArray<{ id: string; text: string }>;
    topK?: number;
  }) => {
    try {
      if (msg.type === 'embed') {
        const vectors = await embed(msg.texts ?? []);
        port.postMessage({ id: msg.id, ok: true, vectors });
        return;
      }

      if (msg.type === 'dispose') {
        pipelineSingleton = null;
        pipelineLoading = null;
        crossEncoderSingleton = null;
        crossEncoderLoading = null;
        port.postMessage({ id: msg.id, ok: true, vectors: [] });
        return;
      }

      if (msg.type === 'rerank') {
        const ranked = await rerank(
          msg.query ?? '',
          msg.candidates ?? [],
          msg.topK ?? 10,
        );
        port.postMessage({ id: msg.id, ok: true, ranked });
        return;
      }

      if (msg.type === 'warmup') {
        await warmup();
        port.postMessage({ id: msg.id, ok: true, ranked: [] });
        return;
      }

      port.postMessage({
        id: msg.id,
        ok: false,
        error: `unknown message type: ${msg.type}`,
      });
    } catch (err) {
      port.postMessage({
        id: msg.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);
