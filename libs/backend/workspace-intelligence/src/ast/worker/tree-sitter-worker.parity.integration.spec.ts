/**
 * Result parity: a `TreeSitterParserService` that parses in the worker
 * returns what the in-process engine returns, on the real TypeScript and
 * Python grammars.
 *
 * The "worker" is a loopback: `TreeSitterWorkerRuntime` over its own real
 * `TreeSitterEngine`, with every message passed through `structuredClone`
 * and a macrotask, as the utility-process channel does. A clone drops the
 * parse-quality properties `queryMulti` hangs on its `Map`, so parity here
 * also proves the protocol carries them.
 *
 * Shims as in `../tsx-grammar.integration.spec.ts`: `wasm-bundle-dir` reads
 * `import.meta.url`, and `Language.load(path)` uses a dynamic import Jest's
 * VM rejects, so grammar files are read here and handed over as bytes.
 */
import 'reflect-metadata';

jest.mock('../wasm-bundle-dir', () => {
  const nodePath = require('path');
  const grammarDir = nodePath.join(
    nodePath.dirname(require.resolve('@vscode/tree-sitter-wasm/package.json')),
    'wasm',
  );
  const runtimeDir = nodePath.dirname(require.resolve('web-tree-sitter'));
  return {
    BUNDLE_DIR: grammarDir,
    resolveWasmPath: (filename: string) =>
      filename.startsWith('web-tree-sitter')
        ? nodePath.join(runtimeDir, filename)
        : nodePath.join(grammarDir, filename),
  };
});

jest.mock('web-tree-sitter', () => {
  const actual =
    jest.requireActual<typeof import('web-tree-sitter')>('web-tree-sitter');
  const nodeFs = require('fs');
  const loadFromPathOrBuffer = actual.Language.load.bind(actual.Language);
  actual.Language.load = (input: string | Uint8Array) =>
    loadFromPathOrBuffer(
      typeof input === 'string'
        ? new Uint8Array(nodeFs.readFileSync(input))
        : input,
    );
  return actual;
});

import { MAX_PARSE_BYTES, parserFailureReason } from '../parser-refusal';
import type { GenericAstNode } from '../ast.types';
import {
  TreeSitterEngine,
  type QueryMatch,
  type QueryResults,
  type TreeSitterLogger,
} from '../tree-sitter-engine';
import { TreeSitterParserService } from '../tree-sitter-parser.service';
import { LANGUAGE_QUERIES_MAP } from '../tree-sitter.config';
import type {
  ITreeSitterWorkerFactory,
  ITreeSitterWorkerProcess,
} from './tree-sitter-worker.port';
import { TreeSitterWorkerRuntime } from './tree-sitter-worker-runtime';
import {
  TRANSPORT_AST_LIMITS,
  boundAstForTransport,
  isGenericAstNode,
} from './ast-transport-bounds';

function silentLogger(): jest.Mocked<TreeSitterLogger> {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

class LoopbackWorker implements ITreeSitterWorkerProcess {
  readonly posted: unknown[] = [];
  private messageListener: (message: unknown) => void = () => undefined;
  private readonly runtime: TreeSitterWorkerRuntime;

  constructor(engine: TreeSitterEngine) {
    this.runtime = new TreeSitterWorkerRuntime(engine, (message) => {
      const copy = structuredClone(message);
      setImmediate(() => this.messageListener(copy));
    });
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
    const copy = structuredClone(message);
    setImmediate(() => {
      void this.runtime.handle(copy);
    });
  }

  on(event: 'message', callback: (message: unknown) => void): void;
  on(event: 'exit', callback: (code: number | null) => void): void;
  on(
    event: 'message' | 'exit',
    callback: ((message: unknown) => void) | ((code: number | null) => void),
  ): void {
    // A loopback never exits; only its message listener is kept.
    if (event === 'message') {
      this.messageListener = callback as (message: unknown) => void;
    }
  }

  kill(): void {
    // Nothing to stop: the loopback runs in this process.
  }
}

const TS_SOURCE = `
import { readFile } from 'fs';
import * as path from 'path';

export interface Options { root: string }

export class Loader {
  constructor(private readonly options: Options) {}
  async load(name: string): Promise<string> {
    return path.join(this.options.root, name);
  }
}

export function helper(a: number, b: number): number {
  return a + b;
}

export const arrow = (x: string) => x.trim();
const broken = (;
`;

const PY_SOURCE = `
import os
from typing import List

class Store:
    def get(self, key: str) -> str:
        return os.environ[key]

def top(values: List[int]) -> int:
    return sum(values)
`;

function queryEntries(language: 'typescript' | 'python') {
  return Object.entries(LANGUAGE_QUERIES_MAP[language])
    .filter(([, queryString]) => queryString.length > 0)
    .map(([key, queryString]) => ({ key, queryString }));
}

const INVALID_QUERY = '(no_such_node) @x';

/** Comparable view of a `queryMulti` result: entries plus parse quality. */
function view(map: QueryResults | undefined) {
  if (!map) throw new Error('queryMulti returned no map');
  return {
    entries: [...map.entries()],
    parseStatus: map.parseStatus,
    errorNodeCount: map.errorNodeCount,
    errorNodeCountCapped: map.errorNodeCountCapped,
  };
}

/**
 * `Parser.init` replaces web-tree-sitter's module-wide WASM binding, so two
 * engines in one process must not interleave. The in-process baseline runs
 * to completion and is disposed before the loopback worker's engine starts,
 * as the host and worker engines never share a process in Electron.
 */
describe('tree-sitter worker result parity (real grammars)', () => {
  const expected: {
    multi: Partial<Record<'typescript' | 'python', ReturnType<typeof view>>>;
    functions?: QueryMatch[];
    exports?: QueryMatch[];
    ast?: GenericAstNode;
    invalidQuery?: Error;
    oversized?: Error;
  } = { multi: {} };
  let viaWorker: TreeSitterParserService;
  let loopback: LoopbackWorker | undefined;
  const oversized = 'x'.repeat(MAX_PARSE_BYTES + 1);

  beforeAll(async () => {
    const inProcess = new TreeSitterEngine(silentLogger());
    for (const [language, source] of [
      ['typescript', TS_SOURCE],
      ['python', PY_SOURCE],
    ] as const) {
      const result = await inProcess.queryMulti(source, language, queryEntries(language));
      expected.multi[language] = view(result.value);
    }
    expected.functions = (
      await inProcess.query(TS_SOURCE, 'typescript', LANGUAGE_QUERIES_MAP.typescript.functionQuery)
    ).value;
    expected.exports = (await inProcess.queryExports(TS_SOURCE, 'typescript')).value;
    expected.ast = (await inProcess.parse(PY_SOURCE, 'python')).value;
    expected.invalidQuery = (await inProcess.query(TS_SOURCE, 'typescript', INVALID_QUERY)).error;
    expected.oversized = (await inProcess.query(oversized, 'typescript', '(identifier) @i')).error;
    inProcess.dispose();

    const workerEngine = new TreeSitterEngine(silentLogger());
    const factory: ITreeSitterWorkerFactory = {
      spawn: () => {
        loopback = new LoopbackWorker(workerEngine);
        return loopback;
      },
    };
    viaWorker = new TreeSitterParserService(silentLogger(), factory);
  });

  afterAll(() => {
    viaWorker.dispose();
  });

  it.each([
    ['typescript', TS_SOURCE],
    ['python', PY_SOURCE],
  ] as const)('queryMulti matches the in-process result for %s', async (language, source) => {
    const actual = await viaWorker.queryMulti(source, language, queryEntries(language));
    expect(actual.isOk()).toBe(true);
    const actualView = view(actual.value);
    expect(actualView).toEqual(expected.multi[language]);
    expect(actualView.entries.some(([, matches]) => matches.length > 0)).toBe(true);
  });

  it('carries a recovered parse (the TypeScript source has a syntax error)', () => {
    expect(expected.multi.typescript?.parseStatus).toBe('recovered');
  });

  it('query and the pre-configured queries match the in-process result', async () => {
    const functions = await viaWorker.query(
      TS_SOURCE,
      'typescript',
      LANGUAGE_QUERIES_MAP.typescript.functionQuery,
    );
    expect(functions.value).toEqual(expected.functions);
    expect(functions.value?.length).toBeGreaterThan(0);
    const exports = await viaWorker.queryExports(TS_SOURCE, 'typescript');
    expect(exports.value).toEqual(expected.exports);
  });

  it('parse matches the in-process AST, bounded for transport', async () => {
    const actual = await viaWorker.parse(PY_SOURCE, 'python');
    expect(actual.isOk()).toBe(true);
    if (!expected.ast) throw new Error('no in-process AST');
    expect(actual.value).toEqual(boundAstForTransport(expected.ast));
  });

  it('bounds the parse of a large real source to the transport limits', async () => {
    const source = Array.from(
      { length: 6_000 },
      (_, i) => `export function f${i}(a: number): number { return a + ${i}; }
`,
    ).join('');
    const actual = await viaWorker.parse(source, 'typescript');
    const ast = actual.value;
    if (!ast) throw new Error(actual.error?.message ?? 'no AST');
    expect(isGenericAstNode(ast, TRANSPORT_AST_LIMITS)).toBe(true);
    expect(isGenericAstNode(ast, { ...TRANSPORT_AST_LIMITS, maxNodes: TRANSPORT_AST_LIMITS.maxNodes - 1 })).toBe(false);
    expect(ast.textTruncated).toBe(true);
    expect(ast.children).toHaveLength(6_000);
  }, 30_000);

  it('fails an invalid query with the same error as in-process', async () => {
    const actual = await viaWorker.query(TS_SOURCE, 'typescript', INVALID_QUERY);
    expect(expected.invalidQuery).toBeInstanceOf(Error);
    expect(actual.isErr()).toBe(true);
    expect(actual.error?.message).toBe(expected.invalidQuery?.message);
    expect(parserFailureReason(actual.error)).toBe(parserFailureReason(expected.invalidQuery));
  });

  it('answers empty and oversized sources without the worker', async () => {
    const before = loopback?.posted.length ?? 0;
    const empty = await viaWorker.queryMulti('', 'typescript', queryEntries('typescript'));
    expect(empty.value?.size).toBe(0);
    expect(empty.value?.parseStatus).toBe('ok');

    const actual = await viaWorker.query(oversized, 'typescript', '(identifier) @i');
    expect(parserFailureReason(actual.error)).toBe('too-large');
    expect(actual.error?.message).toBe(expected.oversized?.message);
    expect(loopback?.posted.length ?? 0).toBe(before);
  });
});
