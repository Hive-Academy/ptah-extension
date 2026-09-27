/**
 * The language-honesty matrix contract (TASK_2026_559 Batch 27, Task 27.2).
 *
 * r1 review (reviews/batch-27-code-logic-review-r1.md, REVISE 4/10) found the
 * structure-only version of this file let a future batch activate a key with
 * no behavioral proof (R27-01), let the required-key set drift undetected
 * because the "snapshot" compared a sorted array to its own sorted copy
 * (R27-02), and let the three named symbol tools/24d export kinds pass while
 * export-row indexing was mutated to a no-op (R27-03). This revision:
 *
 * 1. STRUCTURE — fragments (discovered via `fs`) claim a subset of
 *    `REQUIRED_KEYS`, uniquely, pinned against an INDEPENDENT literal key
 *    list (`EXPECTED_REQUIRED_KEYS`, hand-typed from the plan's table, not
 *    derived from `required-keys.ts`), with every key's category recognised
 *    (typeCheck included; an unrecognised category fails outright).
 * 2. EXECUTABLE PROOF (R27-01) — `HONESTY_CHECKS` maps every key this project
 *    can check to a function that actually calls the real tool path and
 *    throws (a real `expect`) if the honesty property does not hold. A new
 *    test asserts every fragment-activated, locally-owned key has an entry
 *    here AND runs it; `CHECKED_ELSEWHERE` names the three keys proved in
 *    `MCP/mcp-core/mcp-language-coverage.spec.ts` instead (layering: that
 *    project may import this one, not the reverse), and that file's own
 *    completeness test closes the loop across both registries.
 * 3. Non-activated capability:language keys are checked against
 *    `classifyFileForCoverage` — the actual per-file production classifier
 *    every coverage producer calls — on a real fixture path per language,
 *    not just a `hasCapability` table lookup.
 *
 * Sabotage proof for each executable check (recorded by hand in
 * batch-27-executor-report.md, not run automatically — a permanent revert
 * would defeat the fix it tests): temporarily revert one production
 * behaviour, confirm the matching check in `HONESTY_CHECKS` throws, restore,
 * confirm `git diff --stat` on the production file is empty again.
 */

import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import { createMockFileSystemProvider } from '@ptah-extension/platform-core/testing';
import { isCleanAnswer, FileType } from '@ptah-extension/platform-core';
import type {
  ISymbolSink,
  SymbolChunkInsert,
} from '@ptah-extension/memory-contracts';

import { AstAnalysisService } from '../../ast/ast-analysis.service';
import { TreeSitterParserService } from '../../ast/tree-sitter-parser.service';
import {
  DependencyGraphService,
  type SymbolIndex,
} from '../../ast/dependency-graph.service';
import {
  hasCapability,
  classifyFileForCoverage,
  type LanguageCapability,
} from '../../ast/language-registry';
import { ContextEnrichmentService } from '../../context-analysis/context-enrichment.service';
import type { FileSystemService } from '../../services/file-system.service';
import { CodeSymbolIndexer } from '../../services/code-symbol-indexer.service';
import type { WorkspaceIndexerService } from '../../file-indexing/workspace-indexer.service';
import { LanguageAwareDiagnosticsProvider } from '../../diagnostics/language-aware-diagnostics-provider';
import type { IDiagnosticsProvider } from '@ptah-extension/platform-core';

import {
  createNoGrammarFixture,
  createPythonAppFixture,
  createTsPythonMonorepoFixture,
  createJavaRustFixture,
  createPhpRubyCppFixture,
  planNoGrammar,
} from './polyglot-fixtures';
import { REQUIRED_KEYS, sortedRequiredKeys } from './matrix/required-keys';
import type { ActivationFragment } from './matrix/activations/activation-fragment';

jest.mock('../../ast/wasm-bundle-dir', () => {
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
  const nodeFsSync = require('fs');
  const loadFromPathOrBuffer = actual.Language.load.bind(actual.Language);
  actual.Language.load = (input: string | Uint8Array) =>
    loadFromPathOrBuffer(
      typeof input === 'string'
        ? new Uint8Array(nodeFsSync.readFileSync(input))
        : input,
    );
  return actual;
});

function silentLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

// ---------------------------------------------------------------------------
// Fragment discovery (Task 27.2: "fragments discovered via `fs`").
// ---------------------------------------------------------------------------

const ACTIVATIONS_DIR = path.join(__dirname, 'matrix', 'activations');

function discoverFragments(): ActivationFragment[] {
  const files = fs
    .readdirSync(ACTIVATIONS_DIR)
    .filter((f) => f.endsWith('.ts') && f !== 'activation-fragment.ts');
  return files.map(
    (f) =>
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      (
        require(path.join(ACTIVATIONS_DIR, f)) as {
          ACTIVATION: ActivationFragment;
        }
      ).ACTIVATION,
  );
}

// ---------------------------------------------------------------------------
// Shared real parser/analysis — loaded once for the whole file (grammar
// loading is the slow part every real-WASM spec in this repo avoids paying
// twice).
// ---------------------------------------------------------------------------

let parser: TreeSitterParserService;
let analysis: AstAnalysisService;

beforeAll(async () => {
  parser = new TreeSitterParserService(silentLogger());
  const init = await parser.initialize();
  if (init.isErr()) throw init.error ?? new Error('tree-sitter init failed');
  analysis = new AstAnalysisService(silentLogger(), parser);
}, 60_000);

afterAll(() => parser.dispose());

// ---------------------------------------------------------------------------
// R27-02: an INDEPENDENT literal expected-key list (Decision 18/19's table,
// hand-typed here — never derived from required-keys.ts) plus explicit
// per-category handling so an unhandled key shape fails outright instead of
// silently passing through a regex that does not recognise it.
// ---------------------------------------------------------------------------

const EXPECTED_REQUIRED_KEYS: readonly string[] = [
  // parse/outline/codeIndex: tsx(29b); java+rust(30); php/ruby/cpp(31); kotlin(30k)
  'codeIndex:cpp',
  'codeIndex:java',
  'codeIndex:kotlin',
  'codeIndex:php',
  'codeIndex:ruby',
  'codeIndex:rust',
  'codeIndex:tsx',
  'outline:cpp',
  'outline:java',
  'outline:kotlin',
  'outline:php',
  'outline:ruby',
  'outline:rust',
  'outline:tsx',
  'parse:cpp',
  'parse:java',
  'parse:kotlin',
  'parse:php',
  'parse:ruby',
  'parse:rust',
  'parse:tsx',
  // enrichSummary: tsx(29b)
  'enrichSummary:tsx',
  // syntaxDiagnostics: python/go/csharp(27); java/rust(30); php/ruby/cpp(31); kotlin(30k)
  'syntaxDiagnostics:csharp',
  'syntaxDiagnostics:cpp',
  'syntaxDiagnostics:go',
  'syntaxDiagnostics:java',
  'syntaxDiagnostics:kotlin',
  'syntaxDiagnostics:php',
  'syntaxDiagnostics:python',
  'syntaxDiagnostics:ruby',
  'syntaxDiagnostics:rust',
  // publicSymbols/graphEdges: python/go(33); csharp/java(34); rust(35); php/ruby/cpp(36)
  'graphEdges:cpp',
  'graphEdges:csharp',
  'graphEdges:go',
  'graphEdges:java',
  'graphEdges:php',
  'graphEdges:python',
  'graphEdges:ruby',
  'graphEdges:rust',
  'publicSymbols:cpp',
  'publicSymbols:csharp',
  'publicSymbols:go',
  'publicSymbols:java',
  'publicSymbols:php',
  'publicSymbols:python',
  'publicSymbols:ruby',
  'publicSymbols:rust',
  // typeCheck: go(37b)
  'typeCheck:go',
  // the ten literal honesty keys (owner: 27)
  'honesty:ptah_ast_analyze',
  'honesty:ptah_code_reindex',
  'honesty:ptah_code_search_symbols',
  'honesty:ptah_context_enrich_file',
  'honesty:ptah_get_dependencies',
  'honesty:ptah_get_dependents',
  'honesty:ptah_get_diagnostics',
  'honesty:ptah_get_symbol_index',
  'honesty:ptah_lsp_definitions',
  'honesty:ptah_lsp_references',
]
  .slice()
  .sort();

/** Every recognised key-category prefix, including `typeCheck` (R27-02). */
const KNOWN_CATEGORY_PREFIXES = [
  'parse',
  'outline',
  'codeIndex',
  'enrichSummary',
  'syntaxDiagnostics',
  'publicSymbols',
  'graphEdges',
  'typeCheck',
  'honesty',
] as const;

function categoryOf(key: string): string {
  const colon = key.indexOf(':');
  return colon < 0 ? key : key.slice(0, colon);
}

describe('language-honesty matrix — structure (TASK_2026_559 Batch 27, Task 27.2, r1-hardened)', () => {
  it('the required-key set matches an INDEPENDENT literal snapshot of Decision 18/19 (not a copy of itself)', () => {
    expect(sortedRequiredKeys()).toEqual(EXPECTED_REQUIRED_KEYS);
    expect(EXPECTED_REQUIRED_KEYS).toHaveLength(58);
  });

  it('every required key falls into a recognised category (typeCheck included; nothing silently unhandled)', () => {
    const unrecognised = REQUIRED_KEYS.filter(
      (key) => !KNOWN_CATEGORY_PREFIXES.includes(categoryOf(key) as never),
    );
    expect(unrecognised).toEqual([]);
    // A key changed to a bogus category must be caught, not ignored.
    expect(
      KNOWN_CATEGORY_PREFIXES.includes(categoryOf('bogus:python') as never),
    ).toBe(false);
  });

  it('every required key is unique (no capability/language pair listed twice)', () => {
    expect(new Set(REQUIRED_KEYS).size).toBe(REQUIRED_KEYS.length);
  });

  const fragments = discoverFragments();

  it('discovers at least the Batch 27 baseline fragment', () => {
    expect(fragments.map((f) => f.batch)).toContain('b27-baseline');
  });

  it('every fragment key is a subset of REQUIRED_KEYS', () => {
    const required = new Set(REQUIRED_KEYS);
    for (const fragment of fragments) {
      const unknown = fragment.keys.filter((k) => !required.has(k));
      expect({ batch: fragment.batch, unknown }).toEqual({
        batch: fragment.batch,
        unknown: [],
      });
    }
  });

  it('no key is claimed by two fragments', () => {
    const owner = new Map<string, string>();
    const duplicates: Array<{ key: string; first: string; second: string }> =
      [];
    for (const fragment of fragments) {
      for (const key of fragment.keys) {
        const existing = owner.get(key);
        if (existing !== undefined) {
          duplicates.push({ key, first: existing, second: fragment.batch });
        } else {
          owner.set(key, fragment.batch);
        }
      }
    }
    expect(duplicates).toEqual([]);
  });

  it('100% recall: every activated key is either a full contract or names its approximation', () => {
    for (const fragment of fragments) {
      for (const key of fragment.keys) {
        const approx = fragment.approximations?.[key];
        if (approx !== undefined) {
          expect(approx.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// R27-01/R27-03: HONESTY_CHECKS — one real, executable proof per key this
// project owns. Each function performs the actual tool-path call and
// `expect`s the honesty property; a thrown assertion IS the enforcement.
// ---------------------------------------------------------------------------

type HonestyCheck = () => Promise<void>;

/** Keys proved in `MCP/mcp-core/mcp-language-coverage.spec.ts` (layering: that
 * project imports this one, not the reverse). That file's own "every
 * fragment-activated key is checked somewhere" test cross-verifies these
 * three actually have a real check there. */
const CHECKED_ELSEWHERE: ReadonlySet<string> = new Set([
  'honesty:ptah_get_diagnostics',
  'honesty:ptah_lsp_definitions',
  'honesty:ptah_lsp_references',
]);

function realFileSystem(): FileSystemService {
  return {
    readFile: async (p: string) => fs.readFileSync(p, 'utf8'),
  } as unknown as FileSystemService;
}

const HONESTY_CHECKS: Readonly<Record<string, HonestyCheck>> = {
  'honesty:ptah_ast_analyze': async () => {
    const broken = 'export function broken( {\n  const x = 1\n';
    const brokenResult = await analysis.analyzeSource(
      broken,
      'typescript',
      '/ws/broken.ts',
    );
    if (brokenResult.isErr())
      throw new Error('expected Ok for a recovered parse');
    if (brokenResult.unwrap().parseStatus === 'ok') {
      throw new Error(
        'a broken parse was reported as the clean parseStatus "ok"',
      );
    }
    const clean = 'export function ok() {\n  return 1;\n}\n';
    const cleanResult = await analysis.analyzeSource(
      clean,
      'typescript',
      '/ws/ok.ts',
    );
    if (cleanResult.isErr() || cleanResult.unwrap().parseStatus !== 'ok') {
      throw new Error(
        'a clean parse was not reported as "ok" (contrast case failed)',
      );
    }
  },

  'honesty:ptah_context_enrich_file': async () => {
    const plan = planNoGrammar();
    const elixirFile = plan.files.find((f) => f.path.endsWith('.ex'))!;
    const tokenCounter = {
      countTokens: jest.fn(async (t: string) => t.length),
    };
    const fileSystem = { readFile: jest.fn() };
    const workspaceProvider = {
      getWorkspaceRoot: jest.fn().mockReturnValue('/ws'),
    };
    const service = new ContextEnrichmentService(
      parser,
      tokenCounter as unknown as never,
      fileSystem as unknown as FileSystemService,
      silentLogger(),
      workspaceProvider as unknown as never,
    );
    const result = await service.generateStructuralSummary(
      '/ws/lib/greeter.ex',
      undefined,
      elixirFile.content,
    );
    if (result.reason !== 'unsupported-language') {
      throw new Error(
        `expected reason "unsupported-language", got "${result.reason}"`,
      );
    }
    if (result.content !== elixirFile.content) {
      throw new Error('the full content was not returned unchanged');
    }
  },

  'honesty:ptah_get_dependents': async () => graphHonesty('dependents'),
  'honesty:ptah_get_dependencies': async () => graphHonesty('dependencies'),
  'honesty:ptah_get_symbol_index': async () => graphHonesty('symbolIndex'),

  'honesty:ptah_code_search_symbols': async () => symbolIndexerHonesty(),
  'honesty:ptah_code_reindex': async () => symbolIndexerHonesty(),

  'syntaxDiagnostics:python': async () => syntaxDiagnosticsHonesty('python'),
  'syntaxDiagnostics:go': async () => syntaxDiagnosticsHonesty('go'),
  'syntaxDiagnostics:csharp': async () => syntaxDiagnosticsHonesty('csharp'),
};

/**
 * Real `DependencyGraphService` + REAL `AstAnalysisService`/tree-sitter (not
 * mocked) over the ts-python-monorepo fixture: a TS file's real export is
 * found through `getSymbolIndex`, and a python file (graph-unsupported) is
 * disclosed, never silently merged into a clean answer.
 */
async function graphHonesty(
  mode: 'dependents' | 'dependencies' | 'symbolIndex',
): Promise<void> {
  const fixture = createTsPythonMonorepoFixture();
  try {
    const tsFile = `${fixture.root}/ts-service/src/index.ts`;
    const helperFile = `${fixture.root}/ts-service/src/helper.ts`;
    const pyFile = `${fixture.root}/py-service/app.py`;

    const svc = new DependencyGraphService(
      analysis,
      realFileSystem(),
      silentLogger(),
    );
    await svc.buildGraph([tsFile, helperFile, pyFile], fixture.root, {});

    if (mode === 'dependents' || mode === 'dependencies') {
      const answer =
        mode === 'dependents'
          ? svc.getDependents(pyFile)
          : svc.getDependencies(pyFile);
      if (answer.length !== 0)
        throw new Error('expected an empty answer for the unsupported file');
      const report = svc.getCoverageReport(fixture.root);
      const languages = report?.languages;
      if (
        !languages ||
        languages.unsupported !== 1 ||
        languages.unsupportedByLanguage?.['python'] !== 1
      ) {
        throw new Error(
          `python was not disclosed as unsupported: ${JSON.stringify(languages)}`,
        );
      }
      if (isCleanAnswer(languages)) {
        throw new Error('coverage read as clean while a file was unsupported');
      }
      // Contrast: the real TS edge IS found (this is not merely "always empty").
      if (
        mode === 'dependents' &&
        !svc.getDependents(helperFile).includes(tsFile)
      ) {
        throw new Error(
          'the real TS dependent edge was not found (contrast case failed)',
        );
      }
    } else {
      const index: SymbolIndex = svc.getSymbolIndex(fixture.root);
      const helperExports = index.get(helperFile) ?? [];
      if (!helperExports.some((e) => e.name === 'helper')) {
        throw new Error(
          `expected the real "helper" export in the symbol index, got: ${JSON.stringify(
            [...index.entries()],
          )}`,
        );
      }
      if (index.has(pyFile)) {
        throw new Error(
          'the graph-unsupported python file must not appear in the symbol index',
        );
      }
    }
  } finally {
    fixture.cleanup();
  }
}

/**
 * Real `CodeSymbolIndexer` + real tree-sitter WASM over a fixture file
 * declaring every 24d export kind, plus a no-grammar file. Mutating
 * `code-symbol-indexer.service.ts:1102`'s export loop to a no-op makes the
 * kind assertions below fail (sabotage-proven; see the executor report).
 */
async function symbolIndexerHonesty(): Promise<void> {
  interface SymbolRow {
    readonly kind: string;
    readonly symbolName: string;
    readonly filePath: string;
  }
  class TableSink implements ISymbolSink {
    private readonly rows: SymbolRow[] = [];
    deleteSymbolsForFile(): number {
      return 0;
    }
    async insertSymbols(chunks: readonly SymbolChunkInsert[]): Promise<void> {
      for (const c of chunks) {
        if (c.kind !== undefined && c.symbolName !== undefined) {
          this.rows.push({
            kind: c.kind,
            symbolName: c.symbolName,
            filePath: c.filePath,
          });
        }
      }
    }
    all(): readonly SymbolRow[] {
      return this.rows;
    }
  }
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
  function fileSystemOf(
    files: ReadonlyMap<string, string>,
  ): IFileSystemProvider {
    return {
      readFile: async (p: string) => {
        const content = files.get(p);
        if (content === undefined) throw new Error(`no such file: ${p}`);
        return content;
      },
    } as unknown as IFileSystemProvider;
  }

  const python = createPythonAppFixture();
  const noGrammar = createNoGrammarFixture();
  try {
    const kindsFile = `${python.root}/app/kinds.ts`;
    const pyFile = `${python.root}/app/models.py`;
    const elixirFile = `${noGrammar.root}/lib/greeter.ex`;

    // Every 24d export kind, in one file (mirrors
    // code-symbol-indexer.exports.integration.spec.ts's own kind matrix).
    const kindsSource = [
      'export interface Shape { a: string }',
      'export type Alias = string;',
      'export enum Colour { Red }',
      'export const value = 1;',
      'export namespace Space { const inner = 1; }',
      'export function run() { return 1; }',
      'export class Box { open() { return 1; } }',
      'const hidden = 1;',
      'export { hidden as shown };',
    ].join('\n');

    const files = new Map<string, string>([
      [kindsFile, kindsSource],
      [
        pyFile,
        'class UserAccount:\n    def __init__(self, name):\n        self.name = name\n',
      ],
      [elixirFile, 'defmodule Greeter do\n  def hello(name), do: name\nend\n'],
    ]);

    const sink = new TableSink();
    const sharedRoot = path.dirname(path.dirname(kindsFile));
    const indexer = new CodeSymbolIndexer(
      silentLogger(),
      analysis,
      discoveryOf([...files.keys()]),
      fileSystemOf(files),
      sink,
    );
    await indexer.indexWorkspace(sharedRoot, { userInitiated: true });

    const byName = new Map(sink.all().map((r) => [r.symbolName, r.kind]));
    const expectedKinds: Record<string, string> = {
      Shape: 'interface',
      Alias: 'type',
      Colour: 'enum',
      value: 'variable',
      Space: 'namespace',
      run: 'function',
      Box: 'class',
      shown: 'export',
    };
    const mismatches = Object.entries(expectedKinds).filter(
      ([name, kind]) => byName.get(name) !== kind,
    );
    if (mismatches.length > 0) {
      throw new Error(
        `export kinds not indexed as claimed: ${JSON.stringify(mismatches)} (actual: ${JSON.stringify(
          [...byName.entries()],
        )})`,
      );
    }
    if (!sink.all().some((r) => r.symbolName === 'UserAccount')) {
      throw new Error('the supported python class was not indexed');
    }

    const coverage = indexer.getCoverage(sharedRoot);
    if (!coverage || coverage.clean !== false) {
      throw new Error(
        `expected a non-clean run while a no-grammar file was present: ${JSON.stringify(coverage)}`,
      );
    }
    // r1 R29a1-01: `clean: false` alone does not prove the elixir file was
    // COUNTED as unsupported — a mixed run can go non-clean from an
    // independently unknown census bucket while `countUnsupported` silently
    // never ran. Assert the exact unsupported count and language bucket
    // (real production fields written by `CodeSymbolIndexer.countUnsupported`,
    // `code-symbol-indexer.service.ts:704-710`).
    if (
      coverage.unsupported !== 1 ||
      coverage.unsupportedByLanguage?.['elixir'] !== 1
    ) {
      throw new Error(
        `expected exactly 1 unsupported file counted as elixir: ${JSON.stringify(coverage)}`,
      );
    }
    // The same validator, run over an ALL-supported set, must read clean —
    // proving the non-clean result above is a real disclosure, not a
    // validator that always fails (R27-01's "same validator" requirement).
    const cleanSink = new TableSink();
    const cleanIndexer = new CodeSymbolIndexer(
      silentLogger(),
      analysis,
      discoveryOf([kindsFile, pyFile]),
      fileSystemOf(
        new Map([
          [kindsFile, kindsSource],
          [pyFile, files.get(pyFile)!],
        ]),
      ),
      cleanSink,
    );
    await cleanIndexer.indexWorkspace(sharedRoot, { userInitiated: true });
    const cleanCoverage = cleanIndexer.getCoverage(sharedRoot);
    // This indexer's own convention (code-symbol-indexer.exports.integration.
    // spec.ts) is that a fully-analysed run still carries `reasons:
    // ['unrecognised?']` (discovery cannot prove no unrecognised file
    // exists); "clean" here means every discovered file was analysed with no
    // failures, not the literal `clean: true` flag.
    if (
      !cleanCoverage ||
      cleanCoverage.analyzed !== 2 ||
      cleanCoverage.failed !== 0 ||
      cleanCoverage.unchecked !== 0
    ) {
      throw new Error(
        `expected both supported files fully analysed with no failures: ${JSON.stringify(cleanCoverage)}`,
      );
    }
    // r1 R29a1-01 contrast: with no elixir file in the run, the unsupported
    // count and its language bucket must be the corresponding zero/absent —
    // proving the mixed run's count of 1 above is a real disclosure, not a
    // validator that always reports 1.
    if (
      cleanCoverage.unsupported !== 0 ||
      cleanCoverage.unsupportedByLanguage?.['elixir'] !== undefined
    ) {
      throw new Error(
        `expected zero unsupported files and no elixir bucket in the all-supported run: ${JSON.stringify(cleanCoverage)}`,
      );
    }
  } finally {
    python.cleanup();
    noGrammar.cleanup();
  }
}

/**
 * Real `LanguageAwareDiagnosticsProvider` (Batch 25a) + real tree-sitter, on
 * a genuinely broken file per language: proves `syntaxDiagnostics:<lang>` is
 * an executable syntax-only check, not a declaration.
 */
async function syntaxDiagnosticsHonesty(
  language: 'python' | 'go' | 'csharp',
): Promise<void> {
  const BROKEN: Record<typeof language, { rel: string; content: string }> = {
    python: { rel: 'app/bad.py', content: 'def f(:\n    return 1\n' },
    go: {
      rel: 'cmd/main.go',
      content: 'package main\n\nfunc main() {\n\tx := \n}\n',
    },
    csharp: {
      rel: 'src/A.cs',
      content: 'class A { void M() { int x = 1 } }\n',
    },
  };
  const { rel, content } = BROKEN[language];

  const root = fs.mkdtempSync(
    path.join(require('os').tmpdir(), 'ptah-honesty-diag-'),
  );
  try {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
    const absFile = full.replace(/\\/g, '/');

    const inner: IDiagnosticsProvider = {
      getDiagnostics: async () => ({
        status: 'available',
        source: 'typescript-compiler',
        diagnostics: [],
      }),
      invalidate: () => undefined,
    };
    const fsProvider = createMockFileSystemProvider({
      findFiles: async () => [],
      stat: async (file: string) => {
        const stat = fs.statSync(file);
        return {
          type: stat.isFile() ? FileType.File : FileType.Directory,
          ctime: stat.ctimeMs,
          mtime: stat.mtimeMs,
          size: stat.size,
        };
      },
      readFile: async (file: string) => fs.readFileSync(file, 'utf-8'),
    });
    const provider = new LanguageAwareDiagnosticsProvider(
      inner,
      fsProvider,
      parser,
    );

    const result = await provider.getDiagnostics(root, { files: [absFile] });
    if (result.status !== 'available') {
      throw new Error(
        `expected an available result, got unavailable: ${result.reason}`,
      );
    }
    const entry = result.diagnostics.find((d) => d.file === absFile);
    if (!entry || entry.diagnostics.length === 0) {
      throw new Error(
        `expected at least one syntax diagnostic for the broken ${language} file`,
      );
    }
    for (const d of entry.diagnostics) {
      if (
        d.severity !== 'error' ||
        !d.message.includes('syntax-only check, not type-checked')
      ) {
        throw new Error(
          `diagnostic did not disclose its syntax-only approximation: ${JSON.stringify(d)}`,
        );
      }
    }
    const coverage = result.coverage as
      { approximations?: readonly string[] } | undefined;
    if (!coverage?.approximations?.includes(`${language}:syntax-only`)) {
      throw new Error(
        `coverage did not disclose ${language}:syntax-only: ${JSON.stringify(coverage)}`,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('language-honesty matrix — executable proof (R27-01: every activated key actually runs)', () => {
  const fragments = discoverFragments();
  const activated = new Set(fragments.flatMap((f) => f.keys));

  it('every activated, locally-owned key has an entry in HONESTY_CHECKS or CHECKED_ELSEWHERE', () => {
    const missing: string[] = [];
    for (const key of activated) {
      if (HONESTY_CHECKS[key] !== undefined) continue;
      if (CHECKED_ELSEWHERE.has(key)) continue;
      missing.push(key);
    }
    expect(missing).toEqual([]);
  });

  it.each(Object.entries(HONESTY_CHECKS))(
    'executes and proves the honesty property for %s',
    async (_key, check) => {
      await check();
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// R27-02/R27-03 (registry section) — non-activated capability:language keys
// checked against the REAL production classifier, plus typeCheck:go handled
// explicitly (not silently excluded from the capability regex).
// ---------------------------------------------------------------------------

describe('language-honesty matrix — registry/classifier grants (r1-hardened)', () => {
  const fragments = discoverFragments();
  const activated = new Set(fragments.flatMap((f) => f.keys));

  const CAPABILITY_LANGUAGE_KEY =
    /^(parse|outline|codeIndex|enrichSummary|syntaxDiagnostics|publicSymbols|graphEdges):(.+)$/;

  /** One real fixture file per required, still-unactivated language. */
  const REPRESENTATIVE_FILE: Record<
    string,
    () => { root: string; file: string; cleanup: () => void }
  > = {
    java: () => {
      const f = createJavaRustFixture();
      return {
        root: f.root,
        file: `${f.root}/javaapp/src/com/example/App.java`,
        cleanup: f.cleanup,
      };
    },
    rust: () => {
      const f = createJavaRustFixture();
      return {
        root: f.root,
        file: `${f.root}/rustapp/src/main.rs`,
        cleanup: f.cleanup,
      };
    },
    php: () => {
      const f = createPhpRubyCppFixture();
      return {
        root: f.root,
        file: `${f.root}/app/Widget.php`,
        cleanup: f.cleanup,
      };
    },
    ruby: () => {
      const f = createPhpRubyCppFixture();
      return {
        root: f.root,
        file: `${f.root}/app/widget.rb`,
        cleanup: f.cleanup,
      };
    },
    cpp: () => {
      const f = createPhpRubyCppFixture();
      return {
        root: f.root,
        file: `${f.root}/native/app.cpp`,
        cleanup: f.cleanup,
      };
    },
  };

  it('every activated capability:language key is actually granted by the registry', () => {
    const failures: string[] = [];
    for (const key of activated) {
      const m = CAPABILITY_LANGUAGE_KEY.exec(key);
      if (!m) continue;
      const [, capability, language] = m;
      if (!hasCapability(language as never, capability as never))
        failures.push(key);
    }
    expect(failures).toEqual([]);
  });

  it('every non-activated capability:language key with a representative fixture is classified NOT eligible by the REAL classifier (not just a registry lookup)', () => {
    const failures: string[] = [];
    const cleanups: Array<() => void> = [];
    try {
      for (const key of REQUIRED_KEYS) {
        const m = CAPABILITY_LANGUAGE_KEY.exec(key);
        if (!m) continue;
        if (activated.has(key)) continue;
        const [, capability, language] = m;
        const build = REPRESENTATIVE_FILE[language];
        if (!build) continue; // tsx/kotlin: no dedicated single-language fixture file yet
        const { file, cleanup } = build();
        cleanups.push(cleanup);
        const classification = classifyFileForCoverage(
          file,
          capability as LanguageCapability,
        );
        if (classification === 'eligible') failures.push(`${key} (${file})`);
      }
      expect(failures).toEqual([]);
    } finally {
      for (const cleanup of cleanups) cleanup();
    }
  });

  it('typeCheck:go is handled explicitly: not silently granted (the real syntax-only diagnostic never claims a type check)', async () => {
    // typeCheck is not a LanguageCapability (only a real type checker can
    // grant it), so this is proved through the actual diagnostics contract
    // rather than the registry: Go's real diagnostic message is syntax-only.
    await syntaxDiagnosticsHonesty('go');
    // The capability-language regex intentionally does not match `typeCheck:`
    // (it is a distinct category, asserted in the structure describe block
    // above); this test exists so a reader does not mistake that exclusion
    // for "typeCheck is unchecked".
    expect(CAPABILITY_LANGUAGE_KEY.test('typeCheck:go')).toBe(false);
    expect(categoryOf('typeCheck:go')).toBe('typeCheck');
  });
});
