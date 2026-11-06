/**
 * TreeSitterParserService with a tree-sitter worker factory: runtime status
 * includes the worker cooldown, request priority reaches the worker queue,
 * oversized sources never cross, and dispose() settles waiting requests and
 * kills the child (the Electron quit path calls it).
 */
import 'reflect-metadata';

// `wasm-bundle-dir` reads `import.meta.url`, which Jest's CJS runtime rejects.
jest.mock('./wasm-bundle-dir', () => ({
  BUNDLE_DIR: '/mock/bundle/dir',
  resolveWasmPath: (filename: string) => `/mock/bundle/dir/wasm/${filename}`,
}));

import { MAX_PARSE_BYTES } from './parser-refusal';
import type { TreeSitterLogger } from './tree-sitter-engine';
import { TreeSitterParserService } from './tree-sitter-parser.service';
import { TREE_SITTER_WORKER_DEFAULTS } from './worker/tree-sitter-worker.client';
import { FakeWorkerFactory } from '../testing/tree-sitter-worker-fakes';

function mockLogger(): jest.Mocked<TreeSitterLogger> {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function okQuery(id: number): unknown {
  return { kind: 'result', id, ok: true, value: { op: 'query', matches: [] } };
}

describe('TreeSitterParserService with a worker', () => {
  let factory: FakeWorkerFactory;
  let service: TreeSitterParserService;

  beforeEach(() => {
    factory = new FakeWorkerFactory();
    service = new TreeSitterParserService(mockLogger(), factory);
  });

  afterEach(() => {
    service.dispose();
  });

  it('reports the runtime unavailable, with its retry delay, during the worker cooldown', async () => {
    expect(service.isRuntimeUnavailable()).toBe(false);
    expect(service.runtimeRetryInMs()).toBe(0);
    for (let i = 0; i < TREE_SITTER_WORKER_DEFAULTS.maxConsecutiveFailures; i++) {
      const pending = service.query('x', 'typescript', 'q');
      factory.latest().exit(1);
      expect((await pending).isErr()).toBe(true);
    }
    expect(service.isRuntimeUnavailable()).toBe(true);
    expect(service.runtimeRetryInMs()).toBeGreaterThan(
      TREE_SITTER_WORKER_DEFAULTS.failureCooldownMs - 1_000,
    );
  });

  it('passes the request priority to the worker queue', async () => {
    const first = service.query('first', 'typescript', 'q');
    const background = service.queryMulti('bg', 'typescript', [], {
      priority: 'background',
    });
    const foreground = service.query('fg', 'typescript', 'q');
    const worker = factory.latest();
    worker.autoReply = (request) =>
      request.op === 'queryMulti'
        ? {
            kind: 'reply',
            message: {
              kind: 'result',
              id: request.id,
              ok: true,
              value: { op: 'queryMulti', entries: [], quality: {} },
            },
          }
        : { kind: 'reply', message: okQuery(request.id) };
    worker.emit(okQuery(worker.lastRequest().id));
    await Promise.all([first, background, foreground]);
    expect(worker.requests().map((request) => request.content)).toEqual([
      'first',
      'fg',
      'bg',
    ]);
  });

  it('refuses an oversized source in-process, without sending it', async () => {
    const result = await service.query('x'.repeat(MAX_PARSE_BYTES + 1), 'typescript', 'q');
    expect(result.error?.message).toContain('larger than');
    expect(factory.workers).toHaveLength(0);
  });

  it('dispose settles a pending request with an error and kills the child', async () => {
    const pending = service.parse('x', 'python');
    const worker = factory.latest();
    service.dispose();
    const result = await pending;
    expect(result.isErr()).toBe(true);
    expect(result.error?.message).toBe('The tree-sitter worker was terminated');
    expect(worker.killed).toBe(true);
  });
});
