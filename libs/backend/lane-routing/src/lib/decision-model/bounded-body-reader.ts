/**
 * Reads a response body up to a byte cap (decision-model catalog, phase 3 L3).
 *
 * The body is read chunk by chunk and counted in bytes, so a body over the cap
 * is refused, and its stream cancelled, before it is held in memory whole. An
 * abort of `signal` cancels the stream and rejects with the signal's reason.
 */

/** A body source: a stream, `null` (no body), or `text()` alone. */
export interface BoundedBodySource {
  /** `undefined` when the fetch seam exposes `text()` only. */
  readonly body?: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}

export type BoundedBody =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false };

const OVERSIZED: BoundedBody = Object.freeze({ ok: false });

/**
 * The body as UTF-8 text, or `{ ok: false }` when it has more than `maxBytes`
 * bytes. Rejects when the stream fails or `signal` aborts.
 */
export async function readBoundedBody(
  source: BoundedBodySource,
  maxBytes: number,
  signal: AbortSignal,
): Promise<BoundedBody> {
  if (source.body === null) return { ok: true, text: '' };
  if (source.body === undefined) {
    // A `text()`-only seam cannot stream; the cap still holds in bytes.
    const text = await source.text();
    return new TextEncoder().encode(text).byteLength > maxBytes
      ? OVERSIZED
      : { ok: true, text };
  }
  return readStream(source.body, maxBytes, signal);
}

async function readStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal: AbortSignal,
): Promise<BoundedBody> {
  const reader = body.getReader();
  const cancel = (): void => {
    reader.cancel().catch(() => {
      // degradation-audit: reported - the caller logs the oversized, aborted or failed read; a cancel failure has nothing more to add
    });
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      // A cancel on abort ends the read with `done`; it is not a full body.
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        cancel();
        return OVERSIZED;
      }
      chunks.push(value);
    }
    return { ok: true, text: decode(chunks, total) };
  } catch (error: unknown) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

function decode(chunks: readonly Uint8Array[], total: number): string {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
