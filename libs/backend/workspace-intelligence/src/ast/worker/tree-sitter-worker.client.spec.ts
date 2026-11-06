/**
 * TreeSitterWorkerClient: one request in flight, a bounded queue, a
 * per-request timeout, crash and cooldown handling. Every failure is an error
 * result; no test may leave a caller waiting.
 */
import { parserFailureReason, ParserRefusalError } from '../parser-refusal';
import type { TreeSitterLogger } from '../tree-sitter-engine';
import {
  TreeSitterWorkerClient,
  TreeSitterWorkerUnavailableError,
} from './tree-sitter-worker.client';
import {
  FakeWorkerFactory,
  emptyQueryMultiReply,
} from '../../testing/tree-sitter-worker-fakes';

function mockLogger(): jest.Mocked<TreeSitterLogger> {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

const AST = {
  type: 'identifier',
  text: 'foo',
  startPosition: { row: 0, column: 9 },
  endPosition: { row: 0, column: 12 },
  isNamed: true,
  fieldName: null,
  children: [],
};

const MATCH = {
  pattern: 0,
  captures: [
    {
      name: 'function.name',
      node: AST,
      text: 'foo',
      startPosition: AST.startPosition,
      endPosition: AST.endPosition,
    },
  ],
};

function okQuery(id: number): unknown {
  return { kind: 'result', id, ok: true, value: { op: 'query', matches: [MATCH] } };
}

/** Let the client's promise callbacks run. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('TreeSitterWorkerClient', () => {
  let factory: FakeWorkerFactory;
  let logger: jest.Mocked<TreeSitterLogger>;

  beforeEach(() => {
    factory = new FakeWorkerFactory();
    logger = mockLogger();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs queryMulti in the worker and rebuilds the Map with its parse quality', async () => {
    const client = new TreeSitterWorkerClient(factory, logger);
    const pending = client.queryMulti('function foo() {}', 'typescript', [
      { key: 'functions', queryString: '(function_declaration) @f' },
    ]);
    const worker = factory.latest();
    const request = worker.lastRequest();
    expect(request).toMatchObject({ kind: 'request', op: 'queryMulti', language: 'typescript' });
    worker.emit({
      kind: 'result',
      id: request.id,
      ok: true,
      value: {
        op: 'queryMulti',
        entries: [['functions', [MATCH]]],
        quality: { parseStatus: 'recovered', errorNodeCount: 2, errorNodeCountCapped: false },
      },
    });
    const result = await pending;
    expect(result.isOk()).toBe(true);
    const map = result.value;
    expect(map?.get('functions')).toEqual([MATCH]);
    expect(map?.parseStatus).toBe('recovered');
    expect(map?.errorNodeCount).toBe(2);
    expect(map?.errorNodeCountCapped).toBe(false);
  });

  it('keeps one request in flight and sends the next when the first answers', async () => {
    const client = new TreeSitterWorkerClient(factory, logger);
    const first = client.query('a', 'typescript', 'q1');
    const second = client.query('b', 'typescript', 'q2');
    const worker = factory.latest();
    expect(worker.posted).toHaveLength(1);
    worker.emit(okQuery(worker.lastRequest().id));
    expect((await first).isOk()).toBe(true);
    expect(worker.posted).toHaveLength(2);
    expect(worker.lastRequest()).toMatchObject({ op: 'query', queryString: 'q2' });
    worker.emit(okQuery(worker.lastRequest().id));
    expect((await second).value).toEqual([MATCH]);
    expect(factory.workers).toHaveLength(1);
  });

  it('fails a request at once when the waiting queue is full', async () => {
    const client = new TreeSitterWorkerClient(factory, logger, {
      foreground: { maxQueued: 1 },
    });
    void client.query('in flight', 'typescript', 'q');
    void client.query('waiting', 'typescript', 'q');
    const overflow = await client.query('overflow', 'typescript', 'q');
    expect(overflow.isErr()).toBe(true);
    expect(overflow.error).toBeInstanceOf(TreeSitterWorkerUnavailableError);
    expect(overflow.error?.message).toContain('queue is full');
    expect(factory.latest().posted).toHaveLength(1);
    client.terminate();
  });

  it('fails a request that times out, kills the worker and respawns for the next', async () => {
    jest.useFakeTimers();
    const client = new TreeSitterWorkerClient(factory, logger, { requestTimeoutMs: 1_000 });
    const slow = client.query('slow', 'typescript', 'q');
    const next = client.query('next', 'typescript', 'q');
    const first = factory.latest();
    jest.advanceTimersByTime(1_000);
    const timedOut = await slow;
    expect(timedOut.isErr()).toBe(true);
    expect(timedOut.error?.message).toContain('did not answer query (typescript) within 1000 ms');
    expect(parserFailureReason(timedOut.error)).toBe('grammar-unavailable');
    expect(first.killed).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(
      '[tree-sitter-worker] request timed out',
      expect.any(Error),
    );

    // The killed worker's exit and late reply change nothing.
    first.exit(null);
    first.emit(okQuery(0));
    const second = factory.latest();
    expect(second).not.toBe(first);
    second.emit(okQuery(second.lastRequest().id));
    expect((await next).isOk()).toBe(true);
  });

  it('turns a worker exit during a request into an error result and carries on', async () => {
    const client = new TreeSitterWorkerClient(factory, logger);
    const crashed = client.parse('x', 'python');
    const queued = client.query('y', 'python', 'q');
    const first = factory.latest();
    first.exit(3);
    const result = await crashed;
    expect(result.isErr()).toBe(true);
    expect(result.error?.message).toBe(
      'The tree-sitter worker exited (code 3) during parse (python)',
    );
    expect(result.error).toBeInstanceOf(ParserRefusalError);

    const second = factory.latest();
    expect(second).not.toBe(first);
    second.emit(okQuery(second.lastRequest().id));
    expect((await queued).isOk()).toBe(true);
  });

  it('fails fast during the cooldown after repeated failures, then respawns', async () => {
    let now = 0;
    const client = new TreeSitterWorkerClient(factory, logger, {
      maxConsecutiveFailures: 2,
      failureCooldownMs: 5_000,
      now: () => now,
    });
    for (let i = 0; i < 2; i++) {
      const pending = client.query('x', 'go', 'q');
      factory.latest().exit(1);
      expect((await pending).isErr()).toBe(true);
    }
    const spawned = factory.workers.length;
    const refused = await client.query('x', 'go', 'q');
    expect(refused.error?.message).toContain('unavailable for 5000 ms');
    expect(client.unavailableForMs()).toBe(5_000);
    expect(factory.workers).toHaveLength(spawned);

    now = 5_000;
    const recovered = client.query('x', 'go', 'q');
    const worker = factory.latest();
    expect(factory.workers).toHaveLength(spawned + 1);
    worker.emit(okQuery(worker.lastRequest().id));
    expect((await recovered).isOk()).toBe(true);
  });

  it('rebuilds a worker refusal as a ParserRefusalError with its reason', async () => {
    const client = new TreeSitterWorkerClient(factory, logger);
    const pending = client.queryMulti('x', 'kotlin', []);
    const worker = factory.latest();
    worker.emit({
      kind: 'result',
      id: worker.lastRequest().id,
      ok: false,
      error: { name: 'ParserRefusalError', message: 'Grammar for kotlin is unavailable', refusal: 'grammar-unavailable' },
    });
    const result = await pending;
    expect(result.error).toBeInstanceOf(ParserRefusalError);
    expect(result.error?.message).toBe('Grammar for kotlin is unavailable');
    expect(parserFailureReason(result.error)).toBe('grammar-unavailable');
  });

  it('fails a request whose reply does not validate, and keeps the worker', async () => {
    const client = new TreeSitterWorkerClient(factory, logger);
    const pending = client.query('x', 'typescript', 'q');
    const worker = factory.latest();
    worker.emit({ kind: 'result', id: worker.lastRequest().id, ok: true, value: { op: 'query', matches: 'nope' } });
    const result = await pending;
    expect(result.isErr()).toBe(true);
    expect(result.error?.message).toContain('invalid reply to query (typescript)');
    expect(worker.killed).toBe(false);
    expect(logger.error).toHaveBeenCalledWith('[tree-sitter-worker] invalid reply', expect.any(Error));
  });

  it('fails a request whose reply answers another op', async () => {
    const client = new TreeSitterWorkerClient(factory, logger);
    const pending = client.parse('x', 'typescript');
    const worker = factory.latest();
    worker.emit(okQuery(worker.lastRequest().id));
    const result = await pending;
    expect(result.error?.message).toBe(
      'The tree-sitter worker answered query to a parse request',
    );
  });

  it('forwards worker logs, with a real Error for an error log', () => {
    const client = new TreeSitterWorkerClient(factory, logger);
    void client.query('x', 'typescript', 'q');
    const worker = factory.latest();
    worker.emit({ kind: 'log', level: 'info', message: 'grammar loaded' });
    worker.emit({ kind: 'log', level: 'error', message: 'query failed', error: { name: 'Error', message: 'bad node' } });
    worker.emit({ unrelated: true });
    expect(logger.info).toHaveBeenCalledWith('[tree-sitter-worker] grammar loaded');
    const [text, error] = logger.error.mock.calls[0];
    expect(text).toBe('[tree-sitter-worker] query failed');
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('bad node');
    expect(logger.warn).toHaveBeenCalledWith(
      '[tree-sitter-worker] dropped a message of unknown shape',
      expect.objectContaining({ issue: expect.any(String) }),
    );
    client.terminate();
  });

  it('fails a request when the worker cannot be spawned', async () => {
    factory.failNextSpawn = true;
    const client = new TreeSitterWorkerClient(factory, logger);
    const result = await client.query('x', 'typescript', 'q');
    expect(result.error).toBeInstanceOf(TreeSitterWorkerUnavailableError);
    expect(result.error?.message).toContain('fork failed');
    expect(logger.error).toHaveBeenCalled();
  });

  it('terminate fails every waiting request and kills the worker', async () => {
    const client = new TreeSitterWorkerClient(factory, logger);
    const inFlight = client.query('a', 'typescript', 'q');
    const waiting = client.query('b', 'typescript', 'q');
    const worker = factory.latest();
    client.terminate();
    await flush();
    expect((await inFlight).error?.message).toBe('The tree-sitter worker was terminated');
    expect((await waiting).error?.message).toBe('The tree-sitter worker was terminated');
    expect(worker.killed).toBe(true);
  });

  it('serves queued foreground requests before queued background work', async () => {
    const client = new TreeSitterWorkerClient(factory, logger);
    const first = client.query('a', 'typescript', 'bg-1', { priority: 'background' });
    const laterBackground = client.query('b', 'typescript', 'bg-2', { priority: 'background' });
    const foreground = client.query('c', 'typescript', 'fg');
    const worker = factory.latest();
    worker.emit(okQuery(worker.lastRequest().id));
    await first;
    expect(worker.lastRequest()).toMatchObject({ queryString: 'fg' });
    worker.emit(okQuery(worker.lastRequest().id));
    expect((await foreground).isOk()).toBe(true);
    expect(worker.lastRequest()).toMatchObject({ queryString: 'bg-2' });
    worker.emit(okQuery(worker.lastRequest().id));
    expect((await laterBackground).isOk()).toBe(true);
  });

  it('answers a request that waits past its lane deadline without sending it', async () => {
    jest.useFakeTimers();
    const client = new TreeSitterWorkerClient(factory, logger, {
      foreground: { maxWaitMs: 1_000 },
      background: { maxWaitMs: 5_000 },
    });
    const inFlight = client.query('slow', 'typescript', 'q');
    const waitingForeground = client.query('fg', 'typescript', 'q');
    const waitingBackground = client.parse('bg', 'go', { priority: 'background' });
    const worker = factory.latest();

    jest.advanceTimersByTime(1_000);
    const expired = await waitingForeground;
    expect(expired.error).toBeInstanceOf(TreeSitterWorkerUnavailableError);
    expect(expired.error?.message).toBe(
      'query (typescript) waited 1000 ms in the tree-sitter worker foreground queue and was not run',
    );

    jest.advanceTimersByTime(4_000);
    expect((await waitingBackground).error?.message).toBe(
      'parse (go) waited 5000 ms in the tree-sitter worker background queue and was not run',
    );

    worker.emit(okQuery(worker.lastRequest().id));
    expect((await inFlight).isOk()).toBe(true);
    // Neither expired request was ever sent, and expiry is not a worker failure.
    expect(worker.posted).toHaveLength(1);
    expect(client.unavailableForMs()).toBe(0);
  });

  it('applies each lane its own capacity, so a background burst cannot refuse foreground work', async () => {
    const client = new TreeSitterWorkerClient(factory, logger, {
      foreground: { maxQueued: 1 },
      background: { maxQueued: 2 },
    });
    const inFlight = client.query('x', 'typescript', 'q');
    const background = [
      client.query('b1', 'typescript', 'q', { priority: 'background' }),
      client.query('b2', 'typescript', 'q', { priority: 'background' }),
    ];
    const refused = await client.query('b3', 'typescript', 'q', { priority: 'background' });
    expect(refused.error?.message).toBe(
      'The tree-sitter worker background queue is full; query (typescript) was not run',
    );
    const foreground = client.query('f1', 'typescript', 'fg');

    const worker = factory.latest();
    worker.autoReply = (request) => ({ kind: 'reply', message: okQuery(request.id) });
    worker.emit(okQuery(worker.lastRequest().id));
    expect((await inFlight).isOk()).toBe(true);
    expect((await foreground).isOk()).toBe(true);
    for (const pending of background) expect((await pending).isOk()).toBe(true);
    expect(worker.requests().map((r) => r.content)).toEqual(['x', 'f1', 'b1', 'b2']);
  });

  it('answers queryMulti through an auto-replying worker with one entry per key', async () => {
    factory.autoReply = (request) => ({ kind: 'reply', message: emptyQueryMultiReply(request) });
    const client = new TreeSitterWorkerClient(factory, logger);
    const result = await client.queryMulti('x', 'python', [
      { key: 'functions', queryString: 'q' },
      { key: 'classes', queryString: 'q' },
    ]);
    expect([...(result.value?.keys() ?? [])]).toEqual(['functions', 'classes']);
  });
});
