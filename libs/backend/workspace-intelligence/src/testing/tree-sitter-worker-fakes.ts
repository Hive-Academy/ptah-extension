/**
 * In-memory stand-ins for the tree-sitter worker process, shared by the
 * worker client, parser service and indexer specs. A `FakeWorker` records
 * what it is sent; a spec answers by hand (`emit`, `exit`) or installs an
 * `autoReply` that answers each request on the next macrotask, as the real
 * utility-process channel does.
 */
import type {
  ITreeSitterWorkerFactory,
  ITreeSitterWorkerProcess,
} from '../ast/worker/tree-sitter-worker.port';
import {
  treeSitterWorkerRequestSchema,
  type TreeSitterWorkerRequest,
} from '../ast/worker/tree-sitter-worker.protocol';

/** What an auto-replying worker does with a request: send a reply, or exit. */
export type FakeWorkerReply =
  | { readonly kind: 'reply'; readonly message: unknown }
  | { readonly kind: 'exit'; readonly code: number };

export class FakeWorker implements ITreeSitterWorkerProcess {
  readonly posted: unknown[] = [];
  killed = false;
  autoReply: ((request: TreeSitterWorkerRequest) => FakeWorkerReply) | null =
    null;
  private readonly messageListeners: ((message: unknown) => void)[] = [];
  private readonly exitListeners: ((code: number | null) => void)[] = [];

  postMessage(message: unknown): void {
    this.posted.push(message);
    const autoReply = this.autoReply;
    if (!autoReply) return;
    const request = treeSitterWorkerRequestSchema.parse(message);
    setImmediate(() => {
      const reply = autoReply(request);
      if (reply.kind === 'reply') this.emit(reply.message);
      else this.exit(reply.code);
    });
  }

  on(event: 'message', callback: (message: unknown) => void): void;
  on(event: 'exit', callback: (code: number | null) => void): void;
  on(
    event: 'message' | 'exit',
    callback: ((message: unknown) => void) | ((code: number | null) => void),
  ): void {
    // The overloads above tie each event to its callback type.
    if (event === 'message') {
      this.messageListeners.push(callback as (message: unknown) => void);
    } else {
      this.exitListeners.push(callback as (code: number | null) => void);
    }
  }

  kill(): void {
    this.killed = true;
  }

  emit(message: unknown): void {
    for (const listener of this.messageListeners) listener(message);
  }

  exit(code: number | null): void {
    for (const listener of this.exitListeners) listener(code);
  }

  /** The last posted request, validated as the worker would. */
  lastRequest(): TreeSitterWorkerRequest {
    return treeSitterWorkerRequestSchema.parse(this.posted.at(-1));
  }

  /** Every posted request, validated. */
  requests(): TreeSitterWorkerRequest[] {
    return this.posted.map((message) =>
      treeSitterWorkerRequestSchema.parse(message),
    );
  }
}

export class FakeWorkerFactory implements ITreeSitterWorkerFactory {
  readonly workers: FakeWorker[] = [];
  failNextSpawn = false;
  /** Installed on every worker this factory spawns. */
  autoReply: ((request: TreeSitterWorkerRequest) => FakeWorkerReply) | null =
    null;

  spawn(): ITreeSitterWorkerProcess {
    if (this.failNextSpawn) {
      this.failNextSpawn = false;
      throw new Error('fork failed');
    }
    const worker = new FakeWorker();
    worker.autoReply = this.autoReply;
    this.workers.push(worker);
    return worker;
  }

  latest(): FakeWorker {
    const worker = this.workers.at(-1);
    if (!worker) throw new Error('no worker spawned');
    return worker;
  }
}

/** A successful `queryMulti` reply with an empty match list per query key. */
export function emptyQueryMultiReply(request: TreeSitterWorkerRequest): unknown {
  return {
    kind: 'result',
    id: request.id,
    ok: true,
    value: {
      op: 'queryMulti',
      entries:
        request.op === 'queryMulti'
          ? request.queries.map((query) => [query.key, []])
          : [],
      quality: { parseStatus: 'ok', errorNodeCount: 0, errorNodeCountCapped: false },
    },
  };
}
