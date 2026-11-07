/**
 * TreeSitterWorkerRuntime: every request gets exactly one validated reply,
 * including requests that fail validation or whose engine call throws.
 */
import { Result } from '@ptah-extension/shared';
import { ParserRefusalError } from '../parser-refusal';
import { MAX_TRANSPORT_NODE_TEXT_CHARS } from './ast-transport-bounds';
import type { QueryMatch, QueryResults } from '../tree-sitter-engine';
import {
  TreeSitterWorkerRuntime,
  createForwardingLogger,
  type TreeSitterWorkerEngine,
} from './tree-sitter-worker-runtime';
import {
  treeSitterWorkerLogSchema,
  treeSitterWorkerResultSchema,
  type TreeSitterWorkerOutbound,
} from './tree-sitter-worker.protocol';

function fakeEngine(
  overrides: Partial<TreeSitterWorkerEngine> = {},
): TreeSitterWorkerEngine {
  return {
    queryMulti: jest.fn(async () =>
      Result.ok<QueryResults>(
        Object.assign(new Map<string, QueryMatch[]>([['functions', []]]), {
          parseStatus: 'ok' as const,
          errorNodeCount: 0,
          errorNodeCountCapped: false,
        }),
      ),
    ),
    query: jest.fn(async () => Result.ok<QueryMatch[]>([])),
    parse: jest.fn(async () =>
      Result.ok({
        type: 'program',
        text: '',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 0 },
        isNamed: true,
        fieldName: null,
        children: [],
      }),
    ),
    ...overrides,
  };
}

describe('TreeSitterWorkerRuntime', () => {
  let posted: TreeSitterWorkerOutbound[];
  const post = (message: TreeSitterWorkerOutbound): void => {
    posted.push(message);
  };

  beforeEach(() => {
    posted = [];
  });

  it('answers queryMulti with its entries and parse quality', async () => {
    const runtime = new TreeSitterWorkerRuntime(fakeEngine(), post);
    await runtime.handle({
      kind: 'request',
      id: 4,
      op: 'queryMulti',
      content: 'x',
      language: 'typescript',
      queries: [{ key: 'functions', queryString: '(f) @f' }],
    });
    expect(posted).toHaveLength(1);
    const reply = treeSitterWorkerResultSchema.parse(posted[0]);
    expect(reply).toEqual({
      kind: 'result',
      id: 4,
      ok: true,
      value: {
        op: 'queryMulti',
        entries: [['functions', []]],
        quality: { parseStatus: 'ok', errorNodeCount: 0, errorNodeCountCapped: false },
      },
    });
  });

  it('answers an engine error with the error and its refusal reason', async () => {
    const runtime = new TreeSitterWorkerRuntime(
      fakeEngine({
        parse: jest.fn(async () =>
          Result.err(new ParserRefusalError('grammar-unavailable', 'no grammar')),
        ),
      }),
      post,
    );
    await runtime.handle({ kind: 'request', id: 1, op: 'parse', content: 'x', language: 'go' });
    const reply = treeSitterWorkerResultSchema.parse(posted[0]);
    expect(reply.ok).toBe(false);
    if (reply.ok) return;
    expect(reply.error).toMatchObject({
      name: 'ParserRefusalError',
      message: 'no grammar',
      refusal: 'grammar-unavailable',
    });
  });

  it('answers a throwing engine call with an error result', async () => {
    const runtime = new TreeSitterWorkerRuntime(
      fakeEngine({
        query: jest.fn(async () => {
          throw new Error('wasm trap');
        }),
      }),
      post,
    );
    await runtime.handle({
      kind: 'request',
      id: 2,
      op: 'query',
      content: 'x',
      language: 'rust',
      queryString: '(x) @x',
    });
    const reply = treeSitterWorkerResultSchema.parse(posted[0]);
    expect(reply).toMatchObject({ id: 2, ok: false, error: { message: 'wasm trap' } });
  });

  it('bounds a parse reply for transport', async () => {
    const runtime = new TreeSitterWorkerRuntime(
      fakeEngine({
        parse: jest.fn(async () =>
          Result.ok({
            type: 'program',
            text: 'z'.repeat(10_000),
            startPosition: { row: 0, column: 0 },
            endPosition: { row: 0, column: 10_000 },
            isNamed: true,
            fieldName: null,
            children: [],
          }),
        ),
      }),
      post,
    );
    await runtime.handle({ kind: 'request', id: 3, op: 'parse', content: 'x', language: 'go' });
    const reply = treeSitterWorkerResultSchema.parse(posted[0]);
    if (!reply.ok || reply.value.op !== 'parse') throw new Error('expected a parse reply');
    expect(reply.value.ast.text).toHaveLength(MAX_TRANSPORT_NODE_TEXT_CHARS);
    expect(reply.value.ast.textTruncated).toBe(true);
  });

  it('answers an invalid request that has an id with an error result', async () => {
    const engine = fakeEngine();
    const runtime = new TreeSitterWorkerRuntime(engine, post);
    await runtime.handle({ kind: 'request', id: 9, op: 'parse', content: 'x', language: 'cobol' });
    const reply = treeSitterWorkerResultSchema.parse(posted[0]);
    expect(reply).toMatchObject({ id: 9, ok: false });
    expect(engine.parse).not.toHaveBeenCalled();
  });

  it('logs an invalid request that has no id', async () => {
    const runtime = new TreeSitterWorkerRuntime(fakeEngine(), post);
    await runtime.handle('garbage');
    const log = treeSitterWorkerLogSchema.parse(posted[0]);
    expect(log.level).toBe('error');
    expect(log.message).toContain('Invalid tree-sitter worker request');
  });

  it('forwards engine logs as bounded log messages', () => {
    const logger = createForwardingLogger(post);
    logger.info('loaded');
    logger.error('failed', new Error('boom'));
    expect(posted.map((m) => treeSitterWorkerLogSchema.parse(m))).toEqual([
      { kind: 'log', level: 'info', message: 'loaded' },
      {
        kind: 'log',
        level: 'error',
        message: 'failed',
        error: expect.objectContaining({ name: 'Error', message: 'boom' }),
      },
    ]);
  });
});
