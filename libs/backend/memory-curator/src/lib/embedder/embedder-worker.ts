/**
 * Worker thread entry — runs `@xenova/transformers` to embed text.
 *
 * Bundled separately by `apps/ptah-electron`'s `build-embedder-worker`
 * esbuild target. No imports from the rest of the workspace because it
 * runs in a fresh isolate.
 *
 * Protocol (matches `embedder-worker-client.ts`):
 *   request:  { id, type: 'embed', texts: string[] }
 *           | { id, type: 'dispose' }
 *   response: { id, ok: true, vectors: number[][] }
 *           | { id, ok: false, error: string }
 */
import { parentPort } from 'node:worker_threads';

if (!parentPort) {
  throw new Error('embedder-worker.ts must be run as a worker_thread');
}

const port = parentPort;

interface PipelineFn {
  (
    texts: string | string[],
    options: { pooling: string; normalize: boolean },
  ): Promise<{ data: Float32Array }>;
}

let pipelineSingleton: PipelineFn | null = null;
let pipelineLoading: Promise<PipelineFn> | null = null;

async function loadPipeline(): Promise<PipelineFn> {
  if (pipelineSingleton) return pipelineSingleton;
  if (pipelineLoading) return pipelineLoading;
  pipelineLoading = (async () => {
    // Dynamic import so test envs without the package can stub this file.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import(
      '@xenova/transformers' as unknown as string
    )) as any;
    const { pipeline } = mod;
    const fn: PipelineFn = await pipeline(
      'feature-extraction',
      'Xenova/bge-small-en-v1.5',
      {
        quantized: true,
      },
    );
    pipelineSingleton = fn;
    return fn;
  })();
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

port.on(
  'message',
  async (msg: { id: number; type: string; texts?: string[] }) => {
    try {
      if (msg.type === 'embed') {
        const vectors = await embed(msg.texts ?? []);
        port.postMessage({ id: msg.id, ok: true, vectors });
        return;
      }
      if (msg.type === 'dispose') {
        pipelineSingleton = null;
        pipelineLoading = null;
        port.postMessage({ id: msg.id, ok: true, vectors: [] });
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
