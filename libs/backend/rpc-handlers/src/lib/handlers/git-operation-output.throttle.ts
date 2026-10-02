/**
 * Batches the live output of one running git operation into
 * `git:operationOutput` pushes (TASK_2026_576 Component 30).
 *
 * A hook can print thousands of small chunks; one webview message per chunk
 * would flood the renderer. Output is queued and sent at most once per
 * {@link OPERATION_OUTPUT_INTERVAL_MS}, each push carrying at most
 * {@link OPERATION_OUTPUT_MAX_PUSH_BYTES} of one stream. {@link flush} sends
 * whatever is left, and the caller awaits it before returning the
 * operation's result, so the log is complete when the result arrives.
 *
 * The queue is bounded: past {@link OPERATION_OUTPUT_MAX_PENDING_BYTES} the
 * oldest queued output is dropped and the next push says how much. The full
 * tail still reaches the user through the result's `hookOutput`.
 */
import type {
  GitOperationOutputPayload,
  GitOperationOutputStream,
} from '@ptah-extension/shared';

export const OPERATION_OUTPUT_INTERVAL_MS = 100;
export const OPERATION_OUTPUT_MAX_PUSH_BYTES = 16 * 1024;
export const OPERATION_OUTPUT_MAX_PENDING_BYTES = 256 * 1024;

export type OperationOutputSender = (
  payload: GitOperationOutputPayload,
) => Promise<void>;

interface PendingSegment {
  readonly stream: GitOperationOutputStream;
  text: string;
  bytes: number;
}

export class GitOperationOutputThrottle {
  private readonly pending: PendingSegment[] = [];
  private pendingBytes = 0;
  private skippedBytes = 0;
  private lastPushAt = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly operationId: string,
    private readonly send: OperationOutputSender,
  ) {}

  /** Queue one chunk. Ignored once {@link flush} has run. */
  push(stream: GitOperationOutputStream, chunk: string): void {
    if (this.closed || chunk.length === 0) return;
    const bytes = Buffer.byteLength(chunk, 'utf8');
    const last = this.pending.at(-1);
    if (last?.stream === stream) {
      last.text += chunk;
      last.bytes += bytes;
    } else {
      this.pending.push({ stream, text: chunk, bytes });
    }
    this.pendingBytes += bytes;
    this.dropOverflow();
    this.schedule();
  }

  /**
   * Send everything still queued, without waiting for the interval, and stop
   * accepting output. Resolves once every push sent so far has settled.
   */
  async flush(): Promise<void> {
    this.closed = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    while (this.pending.length > 0) this.sendOne();
    await Promise.all(this.inFlight);
  }

  private schedule(): void {
    if (this.timer !== undefined || this.pending.length === 0) return;
    const wait = Math.max(
      0,
      this.lastPushAt + OPERATION_OUTPUT_INTERVAL_MS - Date.now(),
    );
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.sendOne();
      this.schedule();
    }, wait);
  }

  /** One push: the head of the queue, one stream, at most the byte cap. */
  private sendOne(): void {
    const head = this.pending[0];
    if (!head) return;
    const note = this.takeSkipNote();
    const budget = OPERATION_OUTPUT_MAX_PUSH_BYTES - byteLength(note);
    const cut = prefixWithinBytes(head.text, budget);
    const taken = head.text.slice(0, cut);
    const takenBytes = byteLength(taken);
    head.text = head.text.slice(cut);
    head.bytes -= takenBytes;
    this.pendingBytes -= takenBytes;
    if (head.text.length === 0) this.pending.shift();

    this.lastPushAt = Date.now();
    // The sender reports its own failures; a lost push must neither reject
    // `flush` (and with it the commit result) nor go unhandled.
    // degradation-audit: reported - the sender logs a failed push once per operation
    const sent = this.send({
      operationId: this.operationId,
      stream: head.stream,
      chunk: note + taken,
    }).catch(() => undefined);
    this.inFlight.add(sent);
    void sent.then(() => this.inFlight.delete(sent));
  }

  /** Drop the oldest queued output until the queue is back under its cap. */
  private dropOverflow(): void {
    while (this.pendingBytes > OPERATION_OUTPUT_MAX_PENDING_BYTES) {
      const head = this.pending[0];
      const excess = this.pendingBytes - OPERATION_OUTPUT_MAX_PENDING_BYTES;
      if (head.bytes <= excess) {
        this.pending.shift();
        this.pendingBytes -= head.bytes;
        this.skippedBytes += head.bytes;
        continue;
      }
      // Cut at least `excess` bytes off the head, on a character boundary.
      const cut = prefixCoveringBytes(head.text, excess);
      const droppedBytes = byteLength(head.text.slice(0, cut));
      head.text = head.text.slice(cut);
      head.bytes -= droppedBytes;
      this.pendingBytes -= droppedBytes;
      this.skippedBytes += droppedBytes;
    }
  }

  private takeSkipNote(): string {
    if (this.skippedBytes === 0) return '';
    const kib = Math.ceil(this.skippedBytes / 1024);
    this.skippedBytes = 0;
    return `[... ${kib} KiB of earlier output not shown ...]\n`;
  }
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** UTF-8 size of one code point. */
function codePointBytes(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/**
 * The longest prefix of `text` (as a UTF-16 index) whose UTF-8 encoding fits
 * in `maxBytes`, never splitting a surrogate pair.
 */
function prefixWithinBytes(text: string, maxBytes: number): number {
  if (byteLength(text) <= maxBytes) return text.length;
  let bytes = 0;
  let index = 0;
  while (index < text.length) {
    const codePoint = text.codePointAt(index) ?? 0;
    const size = codePointBytes(codePoint);
    if (bytes + size > maxBytes) break;
    bytes += size;
    index += codePoint > 0xffff ? 2 : 1;
  }
  return index;
}

/**
 * The shortest prefix of `text` (as a UTF-16 index) whose UTF-8 encoding is
 * at least `minBytes`, never splitting a surrogate pair.
 */
function prefixCoveringBytes(text: string, minBytes: number): number {
  let bytes = 0;
  let index = 0;
  while (index < text.length && bytes < minBytes) {
    const codePoint = text.codePointAt(index) ?? 0;
    bytes += codePointBytes(codePoint);
    index += codePoint > 0xffff ? 2 : 1;
  }
  return index;
}
