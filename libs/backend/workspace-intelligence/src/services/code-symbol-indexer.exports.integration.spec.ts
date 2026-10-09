/**
 * The code-symbol index records every TS/JS export kind (TASK_2026_559
 * Batch 24d), measured on the REAL parser.
 *
 * `code_search_symbols` reads the rows `CodeSymbolIndexer` writes. Before this
 * batch the indexer wrote only functions, classes and methods, so an exported
 * interface, type alias, enum, variable, namespace or export-clause name was
 * never found, while a grep of the file finds it (r3 review of Batch 20.2).
 *
 * Every file here goes through the real `CodeSymbolIndexer` +
 * `AstAnalysisService` + `TreeSitterParserService`. The sink keeps rows the
 * way `MemoryStoreSymbolSink` (memory-curator) does: the kind and name are
 * parsed out of the `code:<kind>:<path>:<name>` subject, and a row is unique
 * by root and subject. `exactName` is the store's case-sensitive exact-name
 * tier (`symbol_name = ?`), the tier an exact symbol query reaches first.
 *
 * The expected names come from an independent regex census of each file's
 * own export lines, never from the extractor under test.
 *
 * The WASM shims are the ones `export-extraction.integration.spec.ts` uses.
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import type {
  ISymbolSink,
  SymbolChunkInsert,
} from '@ptah-extension/memory-contracts';

jest.mock('../ast/wasm-bundle-dir', () => {
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

import { AstAnalysisService } from '../ast/ast-analysis.service';
import { TreeSitterParserService } from '../ast/tree-sitter-parser.service';
import type { WorkspaceIndexerService } from '../file-indexing/workspace-indexer.service';
import { generateMcpContractFixturePlan } from '../testing/mcp-contract/fixture-workspace';
import { CodeSymbolIndexer } from './code-symbol-indexer.service';

const ROOT = 'D:/census-ws';

interface SymbolRow {
  readonly kind: string;
  readonly symbolName: string;
  readonly filePath: string;
  readonly text: string;
}

/** The subject fallback rule of `MemoryStoreSymbolSink.parseSubject`, verbatim. */
function parseSubject(
  subject: string,
): { kind: string; symbolName: string } | null {
  if (!subject.startsWith('code:')) return null;
  const afterPrefix = subject.slice('code:'.length);
  const firstColon = afterPrefix.indexOf(':');
  if (firstColon < 0) return null;
  const kind = afterPrefix.slice(0, firstColon);
  const remainder = afterPrefix.slice(firstColon + 1);
  const lastColon = remainder.lastIndexOf(':');
  if (lastColon < 0) return null;
  const symbolName = remainder.slice(lastColon + 1);
  if (kind.length === 0 || symbolName.length === 0) return null;
  return { kind, symbolName };
}

/** An in-memory `code_symbols` table with the store's exact-name tier. */
class TableSink implements ISymbolSink {
  private readonly rows = new Map<string, SymbolRow>();

  deleteSymbolsForFile(filePath: string, workspaceRoot: string): number {
    let deleted = 0;
    for (const [key, row] of this.rows) {
      if (
        key.startsWith(`${workspaceRoot}\u0000`) &&
        row.filePath === filePath
      ) {
        this.rows.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  async insertSymbols(chunks: readonly SymbolChunkInsert[]): Promise<void> {
    for (const chunk of chunks) {
      // As MemoryStoreSymbolSink: the producer's kind and name win.
      const parsed =
        chunk.kind !== undefined && chunk.symbolName !== undefined
          ? { kind: chunk.kind, symbolName: chunk.symbolName }
          : parseSubject(chunk.subject);
      if (!parsed) continue;
      this.rows.set(`${chunk.workspaceRoot}\u0000${chunk.subject}`, {
        kind: parsed.kind,
        symbolName: parsed.symbolName,
        filePath: chunk.filePath,
        text: chunk.text,
      });
    }
  }

  async replaceFileSymbols(
    workspaceRoot: string,
    filePath: string,
    chunks: readonly SymbolChunkInsert[],
  ): Promise<void> {
    this.deleteSymbolsForFile(filePath, workspaceRoot);
    await this.insertSymbols(chunks);
  }

  purgeMissing(): number {
    return 0;
  }

  exactName(name: string): SymbolRow[] {
    return [...this.rows.values()].filter((row) => row.symbolName === name);
  }

  forFile(filePath: string): SymbolRow[] {
    return [...this.rows.values()].filter((row) => row.filePath === filePath);
  }
}

interface CensusEntry {
  readonly name: string;
  readonly kind: string;
  /** 0-based row of the export statement, like the indexer's line numbers. */
  readonly row: number;
}

/**
 * Every exported name a line-anchored regex can see: declarations (with
 * `declare`, `default`, `abstract`, `async`, `const enum`), `{ ... }` clauses
 * (multiline, aliases, sources) and `export * as ns`. A plain `export *`
 * names nothing, and `default` is not a name anyone searches for.
 */
function census(text: string): CensusEntry[] {
  const rowOf = (index: number): number =>
    text.slice(0, index).split('\n').length - 1;
  const found: CensusEntry[] = [];
  const declaration =
    /^export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:const\s+(?=enum))?(interface|type|enum|class|function|const|let|var|namespace)\*?\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of text.matchAll(declaration)) {
    found.push({ name: m[2], kind: m[1], row: rowOf(m.index ?? 0) });
  }
  const clause = /^export\s+(?:type\s+)?\{([^}]*)\}/gm;
  for (const m of text.matchAll(clause)) {
    for (const entry of m[1].split(',')) {
      const parts = entry
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/);
      const name = parts[parts.length - 1];
      if (name === '' || name === 'default') continue;
      found.push({ name, kind: 'clause', row: rowOf(m.index ?? 0) });
    }
  }
  const namespace = /^export\s+\*\s+as\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of text.matchAll(namespace)) {
    found.push({ name: m[1], kind: 'namespace', row: rowOf(m.index ?? 0) });
  }
  return found;
}

function silentLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

/** Discovery that yields exactly `paths`, as the workspace indexer would. */
function discoveryOf(paths: readonly string[]): WorkspaceIndexerService {
  return {
    indexWorkspaceStream: () =>
      (async function* () {
        for (const p of paths) {
          yield { path: p, relativePath: p, type: 'source', size: 100 };
        }
      })(),
  } as unknown as WorkspaceIndexerService;
}

function fileSystemOf(files: ReadonlyMap<string, string>): IFileSystemProvider {
  return {
    readFile: async (p: string) => {
      const content = files.get(p);
      if (content === undefined) throw new Error(`no such file: ${p}`);
      return content;
    },
  } as unknown as IFileSystemProvider;
}

/** Real-repository files from the r3 review, by workspace-relative path. */
const SRC_ROOT = path.resolve(__dirname, '..');
function realFile(relative: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relative), 'utf8');
}

/** Files the indexer's skip list leaves out by design (barrels, specs, configs). */
const SKIPPED_BY_DESIGN =
  /(^|\/)(index|public-api)\.[jt]sx?$|\.(spec|test)\.[jt]sx?$|\.d\.ts$|\.module\.[jt]s$|(^|\/)[^/]*\.config\.[^/]+$/;

describe('CodeSymbolIndexer — every TS/JS export kind (real tree-sitter WASM)', () => {
  let parser: TreeSitterParserService;
  let analysis: AstAnalysisService;

  beforeAll(async () => {
    parser = new TreeSitterParserService(silentLogger());
    const init = await parser.initialize();
    if (init.isErr()) {
      throw init.error ?? new Error('tree-sitter initialisation failed');
    }
    analysis = new AstAnalysisService(silentLogger(), parser);
    // Loading the WASM grammars exceeds Jest's 5 s default under parallel load.
  }, 60_000);

  afterAll(() => {
    parser?.dispose();
  });

  async function indexAll(files: ReadonlyMap<string, string>): Promise<{
    sink: TableSink;
    indexer: CodeSymbolIndexer;
  }> {
    const sink = new TableSink();
    const indexer = new CodeSymbolIndexer(
      silentLogger(),
      analysis,
      discoveryOf([...files.keys()]),
      fileSystemOf(files),
      sink,
    );
    await indexer.indexWorkspace(ROOT, { userInitiated: true });
    return { sink, indexer };
  }

  /** Each census name has an exact-name row in `filePath`, at its row. */
  function expectCensusFound(
    sink: TableSink,
    filePath: string,
    text: string,
  ): number {
    const expected = census(text);
    const missing = expected.filter(
      (entry) =>
        !sink
          .exactName(entry.name)
          .some(
            (row) =>
              row.filePath === filePath && row.text.includes(`:${entry.row}-`),
          ),
    );
    expect({ filePath, missing: missing.map((m) => m.name) }).toEqual({
      filePath,
      missing: [],
    });
    return expected.length;
  }

  it('finds every exported name of the MCP contract fixture that a grep census finds', async () => {
    const plan = generateMcpContractFixturePlan(ROOT, { flatFileCount: 12 });
    const files = new Map<string, string>();
    for (const file of plan.files) {
      if (!/\.(ts|tsx)$/.test(file.path)) continue;
      if (SKIPPED_BY_DESIGN.test(file.path)) continue;
      if (census(file.content).length === 0) continue;
      files.set(`${ROOT}/${file.path}`, file.content);
    }
    expect(files.size).toBeGreaterThan(3);

    const { sink, indexer } = await indexAll(files);

    let total = 0;
    for (const [filePath, content] of files) {
      total += expectCensusFound(sink, filePath, content);
    }
    // The 300-line file alone declares 43 exports (Batch 20.2).
    expect(total).toBeGreaterThanOrEqual(43);

    // Every symbol the fixture itself declares, with its kind preserved.
    for (const known of plan.knownSymbols) {
      const rows = sink
        .exactName(known.name)
        .filter((row) => row.filePath === known.absolutePath);
      expect({ name: known.name, kinds: rows.map((r) => r.kind) }).toEqual({
        name: known.name,
        kinds: [known.kind],
      });
    }

    // The r3 misses by name: interfaces now indexed as interfaces.
    for (const name of [
      'SessionUserCredentials',
      'NavigationBarProps',
      'MetricRecordData',
      'ProcessingBatchSummary',
      'PipelineConfigurationOptions',
    ]) {
      expect(sink.exactName(name).map((row) => row.kind)).toEqual([
        'interface',
      ]);
    }

    // Batch 24b coverage is unchanged: every file analysed, none failed.
    // A full run never reads clean: discovery cannot see unrecognised files.
    expect(indexer.getCoverage(ROOT)).toMatchObject({
      reasons: ['unrecognised?'],
      analyzed: files.size,
      unchecked: 0,
      failed: 0,
    });
  }, 120_000);

  it.each([
    ['ast/ast.types.ts', 'ast/ast.types.ts', 3],
    ['types/workspace.types.ts', 'types/workspace.types.ts', 11],
    // The indexer skips files named index.ts by design (a barrel re-exports
    // names whose declarations are indexed in their own files); the same
    // text under another name proves every re-export clause name is kept.
    ['index.ts', 'barrel-index.ts', undefined],
  ] as const)(
    '%s: every exported name a grep census finds',
    async (relative, indexedAs, declarations) => {
      const text = realFile(relative);
      const filePath = `${ROOT}/src/${indexedAs}`;
      const { sink, indexer } = await indexAll(new Map([[filePath, text]]));

      const count = expectCensusFound(sink, filePath, text);
      if (declarations !== undefined) {
        expect(count).toBe(declarations);
      } else {
        expect(count).toBeGreaterThan(90);
      }
      expect(indexer.getCoverage(ROOT)).toMatchObject({
        reasons: ['unrecognised?'],
        analyzed: 1,
        failed: 0,
      });
    },
    60_000,
  );

  it('records each export kind in the kind column, without duplicating declared functions and classes', async () => {
    const filePath = `${ROOT}/src/kinds.ts`;
    const source = [
      'export interface Shape { a: string }',
      'export type Alias = string;',
      'export enum Colour { Red }',
      'export const enum Flag { On }',
      'export const value = 1, other = 2;',
      'export const { left, right: renamed } = pair;',
      'export namespace Space { const inner = 1; }',
      'export declare function declared(): void;',
      'export function run() { return 1; }',
      'export class Box { open() { return 1; } }',
      'const hidden = 1;',
      'export { hidden as shown, run as alsoRun };',
      `export * as ns ${'fr' + 'om'} './other';`,
      `export * ${'fr' + 'om'} './everything';`,
      'export default hidden;',
    ].join('\n');
    const { sink } = await indexAll(new Map([[filePath, source]]));

    const byName = new Map(
      sink.forFile(filePath).map((row) => [row.symbolName, row]),
    );
    const kinds = Object.fromEntries(
      [...byName.values()].map((row) => [row.symbolName, row.kind]),
    );
    expect(kinds).toEqual({
      Shape: 'interface',
      Alias: 'type',
      Colour: 'enum',
      Flag: 'enum',
      value: 'variable',
      other: 'variable',
      left: 'variable',
      renamed: 'variable',
      Space: 'namespace',
      declared: 'function',
      run: 'function',
      Box: 'class',
      // A method is a `function` row (the functions query's own capture).
      open: 'function',
      shown: 'export',
      alsoRun: 'export',
      ns: 'namespace',
    });
    // One row per exported name: the declared function and class are not
    // repeated as export rows, and `*` / `default` are not names.
    expect(sink.forFile(filePath)).toHaveLength(Object.keys(kinds).length);
    const rel = path.relative(ROOT, filePath);
    expect(byName.get('Shape')?.text).toBe(`interface Shape in ${rel}:0-0`);
    expect(byName.get('shown')?.text).toBe(
      `export shown = hidden in ${rel}:11-11`,
    );
    expect(byName.get('ns')?.text).toBe(
      `namespace ns from ./other in ${rel}:12-12`,
    );
  }, 60_000);

  // Review r1 R24d-02: a valid name holding `:` is indexed and found exactly.
  it('indexes an exported name holding ":" and finds it by exact name', async () => {
    const filePath = `${ROOT}/src/colon.ts`;
    const { sink, indexer } = await indexAll(
      new Map([[filePath, 'const a = 1;\nexport { a as "x:y" };']]),
    );

    expect(sink.exactName('x:y')).toEqual([
      expect.objectContaining({ kind: 'export', filePath }),
    ]);
    const single = await indexer.reindexFile(filePath, ROOT);
    expect(single.symbolsIndexed).toBe(1);
    expect(single.coverage).toMatchObject({ clean: true, analyzed: 1 });
  }, 60_000);

  // Review r1 R24d-03: a same-named declaration elsewhere, on the same line or
  // in another scope, never stands in for a different exported symbol.
  it.each([
    [
      'declaration merge on one line',
      'export class A {} export interface A { a: number }',
      [
        ['A', 'class'],
        ['A', 'interface'],
      ],
    ],
    [
      'a method and an exported const on one line',
      'class C { f() { return 1; } } export const f = 1;',
      [
        ['C', 'class'],
        ['f', 'function'],
        ['f', 'variable'],
      ],
    ],
    [
      'a nested function and a module-scope const exported by a clause',
      'function outer() { function f() {} return f; }\nconst f = 1;\nexport { f };',
      [
        ['outer', 'function'],
        ['f', 'function'],
        ['f', 'export'],
      ],
    ],
  ] as const)(
    'keeps every distinct exported symbol: %s',
    async (_title, source, expected) => {
      const filePath = `${ROOT}/src/dedup.ts`;
      const { sink } = await indexAll(new Map([[filePath, source]]));

      const rows = sink
        .forFile(filePath)
        .map((row) => [row.symbolName, row.kind])
        .sort();
      expect(rows).toEqual([...expected].map((pair) => [...pair]).sort());
    },
    60_000,
  );

  it('never counts a file with an unextracted CommonJS export as cleanly analysed', async () => {
    const partial = `${ROOT}/src/partial.js`;
    const whole = `${ROOT}/src/whole.js`;
    const { sink, indexer } = await indexAll(
      new Map([
        [
          partial,
          'exports.known = 1;\nconst key = "actual";\nexports[key] = 1;',
        ],
        [whole, 'exports.other = 2;'],
      ]),
    );

    // The known export is still indexed.
    expect(sink.exactName('known').map((row) => row.filePath)).toEqual([
      partial,
    ]);
    const coverage = indexer.getCoverage(ROOT);
    expect(coverage).toMatchObject({
      clean: false,
      analyzed: 1,
      failed: 1,
      failedByReason: { 'unsupported-syntax': 1 },
    });

    const single = await indexer.reindexFile(partial, ROOT);
    expect(single.coverage).toMatchObject({
      clean: false,
      analyzed: 0,
      failed: 1,
      failedByReason: { 'unsupported-syntax': 1 },
    });
  }, 60_000);
});
