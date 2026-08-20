/**
 * Typed message protocol shared by the embedder worker entry
 * (`embedder-worker.ts`) and the main-side client (`embedder-worker-client.ts`).
 * Importing the same types on both sides guarantees compile-level contract
 * parity (mirrors the voice worker's id-correlated protocol).
 *
 * All requests carry a numeric `id` (except `init`, which is fire-and-forget
 * and arrives before any request). Responses echo the `id`; pipeline-progress
 * is an out-of-band stream, not keyed by `id`.
 */

/** Config delivered once, immediately after spawn, before any request. */
export interface EmbedderWorkerInitMessage {
  readonly type: 'init';
  /**
   * Writable `@huggingface/transformers` model cache dir (null → library
   * default). Must live outside `app.asar` when packaged — the library's
   * default `<pkg>/.cache` resolves inside the asar archive (a file) and fails
   * with `ENOTDIR`.
   */
  readonly modelCacheDir: string | null;
}

export interface EmbedRequest {
  readonly id: number;
  readonly type: 'embed';
  readonly texts: readonly string[];
}

export interface DisposeRequest {
  readonly id: number;
  readonly type: 'dispose';
}

export interface RerankRequest {
  readonly id: number;
  readonly type: 'rerank';
  readonly query: string;
  readonly candidates: ReadonlyArray<{ id: string; text: string }>;
  readonly topK: number;
}

export interface WarmupRequest {
  readonly id: number;
  readonly type: 'warmup';
}

export type EmbedderWorkerRequest =
  | EmbedRequest
  | DisposeRequest
  | RerankRequest
  | WarmupRequest;

export type EmbedderWorkerInbound =
  | EmbedderWorkerInitMessage
  | EmbedderWorkerRequest;

export interface EmbedResponse {
  readonly id: number;
  readonly ok: true;
  readonly vectors: number[][];
}

export interface RerankResponse {
  readonly id: number;
  readonly ok: true;
  readonly ranked: ReadonlyArray<{ id: string; score: number }>;
}

export interface ErrorResponse {
  readonly id: number;
  readonly ok: false;
  readonly error: string;
}

export type EmbedderWorkerResponse =
  | EmbedResponse
  | RerankResponse
  | ErrorResponse;

export interface PipelineProgressInfo {
  readonly status: 'initiate' | 'download' | 'progress' | 'done' | 'ready';
  readonly name?: string;
  readonly file?: string;
  readonly progress?: number;
  readonly loaded?: number;
  readonly total?: number;
}

export interface PipelineProgressMessage {
  readonly type: 'pipeline-progress';
  readonly info: PipelineProgressInfo;
}

export type EmbedderWorkerOutbound =
  | EmbedderWorkerResponse
  | PipelineProgressMessage;

export function isPipelineProgressMessage(
  msg: unknown,
): msg is PipelineProgressMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: unknown }).type === 'pipeline-progress'
  );
}
