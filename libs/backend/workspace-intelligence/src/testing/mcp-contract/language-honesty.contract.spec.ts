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
 *    here AND runs it; `CHECKED_ELSEWHERE` names the keys proved in
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
import * as os from 'node:os';
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
import type {
  DiagnosticsResult,
  IDiagnosticsProvider,
  IProcessSpawner,
  IStateStorage,
  IWorkspaceScopedStateStorage,
} from '@ptah-extension/platform-core';
import { GoVetChecker } from '../../diagnostics/external-checkers/go-vet-checker';
import type { CheckerRunResult } from '../../diagnostics/external-checkers/checker-runner';
import { GoVetConsentStore } from '../../diagnostics/external-checkers/go-vet-consent-store';
import type { SupportedLanguage } from '../../ast/ast.types';

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
  // Batch 30k: the Kotlin grammar is vendored in the repository.
  // A repository asset, not a module: resolved from this file, not imported.
  const kotlinWasm = nodePath.join(
    __dirname,
    '../../../../../../assets/tree-sitter/tree-sitter-kotlin.wasm',
  );
  return {
    BUNDLE_DIR: grammarDir,
    resolveWasmPath: (filename: string) =>
      filename.startsWith('web-tree-sitter')
        ? nodePath.join(runtimeDir, filename)
        : filename === 'tree-sitter-kotlin.wasm'
          ? kotlinWasm
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
  // Batch 29b: the outliner (`code-outliner.adapter.ts`) lives in vscode-lm-tools.
  'outline:tsx',
  // Batch 30: same outliner.
  'outline:java',
  'outline:rust',
  // Batch 31: same outliner (cpp on real .c, .h and .cpp files).
  'outline:php',
  'outline:ruby',
  'outline:cpp',
  // Batch 30k: same outliner, vendored Kotlin grammar.
  'outline:kotlin',
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

  'parse:tsx': async () => tsxParseHonesty(),
  'codeIndex:tsx': async () =>
    codeIndexHonesty({
      root: '/ws-29b-index',
      relativePath: 'src/Badge.tsx',
      source: TSX_COMPONENT,
      names: ['Badge', 'Card'],
    }),
  'enrichSummary:tsx': async () => tsxEnrichHonesty(),

  'parse:java': async () => grammarParseHonesty(JAVA_HONESTY),
  'codeIndex:java': async () =>
    codeIndexHonesty({ root: '/ws-30-java-index', ...JAVA_HONESTY }),
  'syntaxDiagnostics:java': async () => syntaxDiagnosticsHonesty('java'),
  'parse:rust': async () => grammarParseHonesty(RUST_HONESTY),
  'codeIndex:rust': async () =>
    codeIndexHonesty({ root: '/ws-30-rust-index', ...RUST_HONESTY }),
  'syntaxDiagnostics:rust': async () => syntaxDiagnosticsHonesty('rust'),

  // Batch 31. C has no grammar of its own (User Decision 19): every cpp key
  // is proved on a real .cpp, .c and .h file, and only the C ones name
  // `c:parsed-as-cpp`.
  'parse:php': async () => grammarParseHonesty(PHP_HONESTY),
  'codeIndex:php': async () =>
    codeIndexHonesty({ root: '/ws-31-php-index', ...PHP_HONESTY }),
  'syntaxDiagnostics:php': async () => syntaxDiagnosticsHonesty('php'),
  'parse:ruby': async () => grammarParseHonesty(RUBY_HONESTY),
  'codeIndex:ruby': async () =>
    codeIndexHonesty({ root: '/ws-31-ruby-index', ...RUBY_HONESTY }),
  'syntaxDiagnostics:ruby': async () => syntaxDiagnosticsHonesty('ruby'),
  'parse:cpp': async () => {
    for (const subject of CPP_HONESTY) await grammarParseHonesty(subject);
  },
  'codeIndex:cpp': async () => {
    for (const subject of CPP_HONESTY) {
      await codeIndexHonesty({
        root: `/ws-31-cpp-index-${path.extname(subject.relativePath).slice(1)}`,
        ...subject,
        approximations: subject.relativePath.endsWith('.cpp')
          ? []
          : ['c:parsed-as-cpp'],
      });
    }
  },
  'syntaxDiagnostics:cpp': async () => {
    await syntaxDiagnosticsHonesty('cpp');
    // Valid C the C++ grammar rejects: reported, and named as C parsed as C++.
    await syntaxDiagnosticsHonesty('cpp', {
      rel: 'src/legacy.c',
      content: C_WITH_CPP_KEYWORD,
    });
  },

  // Batch 30k: the vendored Kotlin grammar.
  'parse:kotlin': async () => grammarParseHonesty(KOTLIN_HONESTY),
  'codeIndex:kotlin': async () =>
    codeIndexHonesty({ root: '/ws-30k-kotlin-index', ...KOTLIN_HONESTY }),
  'syntaxDiagnostics:kotlin': async () => syntaxDiagnosticsHonesty('kotlin'),

  // Batch 37b (Task 37b3.2): go vet is never a type-check claim.
  'typeCheck:go': async () => goVetTypeCheckHonesty(),
};

/** One grammar language's honesty source: clean, and a broken contrast. */
interface GrammarHonestySource {
  readonly language: SupportedLanguage;
  readonly relativePath: string;
  readonly source: string;
  readonly names: readonly string[];
  readonly broken: string;
}

const JAVA_HONESTY: GrammarHonestySource = {
  language: 'java',
  relativePath: 'src/com/example/Widget.java',
  source: [
    'package com.example;',
    '',
    'public class Widget {',
    '  private final String label;',
    '  public Widget(String label) {',
    '    this.label = label;',
    '  }',
    '  public String render() {',
    '    return "<" + label + ">";',
    '  }',
    // An overload: its own row, never overwriting the first (R30-02).
    '  public String render(String prefix) {',
    '    return prefix + render();',
    '  }',
    '}',
    '',
  ].join('\n'),
  names: ['Widget', 'render'],
  broken: 'class Broken { void m( { int x = 1 } }\n',
};

const RUST_HONESTY: GrammarHonestySource = {
  language: 'rust',
  relativePath: 'src/widget.rs',
  source: [
    'pub struct Widget {',
    '    label: String,',
    '}',
    '',
    'impl Widget {',
    '    pub fn render(&self) -> String {',
    '        format!("<{}>", self.label)',
    '    }',
    '}',
    '',
    // A second impl block of the same type: its own row (R30-02).
    'impl Widget {',
    '    pub fn width(&self) -> usize {',
    '        self.label.len()',
    '    }',
    '}',
    '',
  ].join('\n'),
  names: ['Widget', 'render'],
  broken: 'fn broken( {\n    let x = ;\n}\n',
};

/** Batch 31: PHP inside HTML, with a function whose body is HTML. */
const PHP_HONESTY: GrammarHonestySource = {
  language: 'php',
  relativePath: 'app/Widget.php',
  source: [
    '<ul>',
    '<?php',
    'namespace App;',
    '',
    'class Widget',
    '{',
    '    public function render($label)',
    '    {',
    '        return "<li>$label</li>";',
    '    }',
    '}',
    '',
    'class Other',
    '{',
    // The same method name in another class: its own row (R30-02).
    '    public function render() { return 1; }',
    '}',
    '?>',
    '</ul>',
    '<?php function footer() { ?><footer></footer><?php } ?>',
    '',
  ].join('\n'),
  names: ['Widget', 'render', 'footer'],
  broken: '<?php\nfunction broken( { $x = ; }\n',
};

/** Batch 31: Ruby with interpolation, a reopened class and a scoped one. */
const RUBY_HONESTY: GrammarHonestySource = {
  language: 'ruby',
  relativePath: 'lib/widget.rb',
  source: [
    'class Widget',
    '  def render(label)',
    '    "<#{label}>"',
    '  end',
    'end',
    '',
    // A reopened class and a second `render`: their own rows (R30-02).
    'class Widget',
    '  def render; end',
    'end',
    '',
    'class Admin::Panel',
    'end',
    '',
  ].join('\n'),
  names: ['Widget', 'render', 'Panel'],
  broken: 'def broken(a\n  1 +\nend\n',
};

/**
 * Batch 30k: Kotlin with an overload, the same member name in a second
 * class, and an object. Class bodies close on their own line (the grammar
 * needs error recovery otherwise; see `kotlin.language.ts`).
 */
const KOTLIN_HONESTY: GrammarHonestySource = {
  language: 'kotlin',
  relativePath: 'src/main/kotlin/app/Widget.kt',
  source: [
    'package app',
    '',
    'class Widget(private val label: String) {',
    '    fun render(): String = "<$label>"',
    // An overload: its own row (R30-02).
    '    fun render(prefix: String): String = prefix + render()',
    '}',
    '',
    'class Other {',
    // The same member name in another class: its own row (R30-02).
    '    fun render(): Int = 1',
    '}',
    '',
    'object Registry {',
    '    fun register(widget: Widget) = widget.render()',
    '}',
    '',
  ].join('\n'),
  names: ['Widget', 'render', 'Registry', 'register'],
  broken: 'fun broken( {\n    val x = \n}\n',
};

/** Valid C the C++ grammar rejects: `new` is a C++ keyword. */
const C_WITH_CPP_KEYWORD =
  'int make(void) {\n    int *new = 0;\n    return new == 0;\n}\n';

/** Batch 31: C++, and C through the C++ grammar (`.c`, `.h`). */
const CPP_HONESTY: readonly GrammarHonestySource[] = [
  {
    language: 'cpp',
    relativePath: 'native/widget.cpp',
    source: [
      '#include "widget.h"',
      'namespace ui {',
      'class Widget {',
      ' public:',
      '  int render(int width) const;',
      '};',
      'int Widget::render(int width) const { return width; }',
      // An overload: its own row (R30-02).
      'int render(double scale) { return 1; }',
      '}',
      '',
    ].join('\n'),
    names: ['Widget', 'render'],
    broken: 'int broken( { int x = ; }\n',
  },
  {
    language: 'cpp',
    relativePath: 'native/widget.c',
    source: [
      '#include "widget.h"',
      'typedef struct { int width; } Widget;',
      'int render(const Widget *w) { return w->width; }',
      '',
    ].join('\n'),
    names: ['Widget', 'render'],
    broken: C_WITH_CPP_KEYWORD,
  },
  {
    language: 'cpp',
    relativePath: 'native/widget.h',
    source: [
      '#ifndef WIDGET_H',
      '#define WIDGET_H',
      'struct Widget { int width; };',
      'int render(const struct Widget *w);',
      'static inline int render_twice(int v) { return v * 2; }',
      '#endif',
      '',
    ].join('\n'),
    names: ['Widget', 'render_twice'],
    // Valid C, but an `extern "C"` block split across `#ifdef`s.
    broken: [
      '#ifdef __cplusplus',
      'extern "C" {',
      '#endif',
      'int render(void);',
      '#ifdef __cplusplus',
      '}',
      '#endif',
      '',
    ].join('\n'),
  },
];

/**
 * `parse:<lang>` (Batch 30): the real parser analyses the file cleanly and
 * finds its declarations; a broken file of the same language is not `ok`.
 */
async function grammarParseHonesty(
  subject: GrammarHonestySource,
): Promise<void> {
  const clean = await analysis.analyzeSource(
    subject.source,
    subject.language,
    `/ws/${subject.relativePath}`,
  );
  if (clean.isErr()) {
    throw clean.error ?? new Error(`${subject.language} parse failed`);
  }
  const insights = clean.unwrap();
  if (insights.parseStatus !== 'ok') {
    throw new Error(
      `${subject.language} did not parse cleanly: ${insights.parseStatus}`,
    );
  }
  const found = [
    ...insights.functions.map((f) => f.name),
    ...insights.classes.map((c) => c.name),
  ];
  const missing = subject.names.filter((name) => !found.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `${subject.language} declarations not found: ${JSON.stringify(missing)}`,
    );
  }
  // Contrast: a broken file is not a clean parse, so the ok above is the
  // grammar's verdict, not a status that is always ok.
  const broken = await analysis.analyzeSource(
    subject.broken,
    subject.language,
    `/ws/broken-${subject.relativePath}`,
  );
  if (broken.isErr() || broken.unwrap().parseStatus === 'ok') {
    throw new Error(
      `a broken ${subject.language} file was a clean parse (contrast failed)`,
    );
  }
}

/**
 * Batch 29b: TSX with JSX — valid TSX the TypeScript grammar can only recover
 * from. Relative imports only (validate-deps scans spec text).
 */
const TSX_COMPONENT = [
  "import { useTheme } from './theme';",
  'export interface BadgeProps {',
  '  count: number;',
  '}',
  'export function Badge(props: BadgeProps) {',
  ...Array.from(
    { length: 12 },
    (_, i) => `  const step${i} = props.count * ${i} + useTheme().offset${i};`,
  ),
  '  return <span className="badge">{step11}</span>;',
  '}',
  'export const Card = ({ title }: { title: string }) => <h2>{title}</h2>;',
  '',
].join('\n');

/** `parse:tsx`: a clean TSX parse, where the TypeScript grammar recovers. */
async function tsxParseHonesty(): Promise<void> {
  const asTsx = await analysis.analyzeSource(
    TSX_COMPONENT,
    'tsx',
    '/ws/Badge.tsx',
  );
  if (asTsx.isErr()) throw asTsx.error ?? new Error('tsx parse failed');
  const insights = asTsx.unwrap();
  if (insights.parseStatus !== 'ok') {
    throw new Error(
      `TSX with JSX did not parse cleanly: ${insights.parseStatus}`,
    );
  }
  const names = insights.functions.map((f) => f.name);
  if (!names.includes('Badge') || !names.includes('Card')) {
    throw new Error(`TSX components not found: ${JSON.stringify(names)}`);
  }
  // Contrast: the same text under the TypeScript grammar is not clean, so
  // the ok above comes from the TSX grammar, not from a check that always
  // passes.
  const asTs = await analysis.analyzeSource(
    TSX_COMPONENT,
    'typescript',
    '/ws/Badge.tsx',
  );
  if (asTs.isErr() || asTs.unwrap().parseStatus === 'ok') {
    throw new Error(
      'the TypeScript grammar parsed JSX cleanly (contrast failed)',
    );
  }
}

/**
 * `codeIndex:<lang>` (tsx since 29b, java/rust since 30, php/ruby/cpp since
 * 31, kotlin since 30k):the real indexer stores the file's declarations and counts the file
 * analysed, not unsupported or failed. When `approximations` is given, the
 * coverage names exactly those (Batch 31: `c:parsed-as-cpp` for C only).
 */
async function codeIndexHonesty(subject: {
  readonly root: string;
  readonly relativePath: string;
  readonly source: string;
  readonly names: readonly string[];
  readonly approximations?: readonly string[];
}): Promise<void> {
  const { root, relativePath, source } = subject;
  const file = `${root}/${relativePath}`;
  const names: string[] = [];
  // The store keys rows by subject and overwrites on conflict
  // (`code-symbol.store.ts`, `ON CONFLICT(workspace_root, subject)`), so a
  // repeated subject is a lost row (Batch 30 r1 R30-02).
  const subjects = new Set<string>();
  const overwritten: string[] = [];
  const sink: ISymbolSink = {
    deleteSymbolsForFile: () => 0,
    insertSymbols: async (chunks: readonly SymbolChunkInsert[]) => {
      for (const c of chunks) {
        if (subjects.has(c.subject)) overwritten.push(c.subject);
        subjects.add(c.subject);
        if (c.symbolName !== undefined) names.push(c.symbolName);
      }
    },
  };
  const discovery = {
    indexWorkspaceStream: () =>
      (async function* () {
        yield {
          path: file,
          relativePath,
          type: 'source',
          size: 100,
        };
      })(),
  } as unknown as WorkspaceIndexerService;
  const fileSystem = {
    readFile: async (p: string) => {
      if (p !== file) throw new Error(`no such file: ${p}`);
      return source;
    },
  } as unknown as IFileSystemProvider;

  const indexer = new CodeSymbolIndexer(
    silentLogger(),
    analysis,
    discovery,
    fileSystem,
    sink,
  );
  await indexer.indexWorkspace(root, { userInitiated: true });

  if (overwritten.length > 0) {
    throw new Error(
      `${relativePath}: rows would overwrite each other in the store: ${JSON.stringify(overwritten)}`,
    );
  }
  const missing = subject.names.filter((name) => !names.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `${relativePath} declarations were not indexed: ${JSON.stringify(missing)} (indexed ${JSON.stringify(names)})`,
    );
  }
  const coverage = indexer.getCoverage(root);
  if (
    !coverage ||
    coverage.analyzed !== 1 ||
    coverage.unsupported !== 0 ||
    coverage.failed !== 0
  ) {
    throw new Error(
      `expected ${relativePath} analysed, not unsupported or failed: ${JSON.stringify(coverage)}`,
    );
  }
  if (
    subject.approximations !== undefined &&
    JSON.stringify(coverage.approximations ?? []) !==
      JSON.stringify(subject.approximations)
  ) {
    throw new Error(
      `${relativePath}: expected approximations ${JSON.stringify(subject.approximations)}, got ${JSON.stringify(coverage.approximations)}`,
    );
  }
}

/** `enrichSummary:tsx`: a declaration-only `.tsx` file summarises; JSX at load time falls back. */
async function tsxEnrichHonesty(): Promise<void> {
  const service = new ContextEnrichmentService(
    parser,
    { countTokens: async (t: string) => t.length } as unknown as never,
    { readFile: jest.fn() } as unknown as FileSystemService,
    silentLogger(),
    { getWorkspaceRoot: () => '/ws' } as unknown as never,
  );
  const summary = await service.generateStructuralSummary(
    '/ws/src/Badge.tsx',
    'tsx',
    TSX_COMPONENT,
  );
  if (summary.mode !== 'structural') {
    throw new Error(
      `a declaration-only .tsx file was not summarised: ${summary.reason}`,
    );
  }
  if (
    !summary.content.includes('export function Badge(props: BadgeProps);') ||
    summary.content.includes('<span')
  ) {
    throw new Error(`unexpected TSX summary: ${summary.content}`);
  }
  // Contrast: load-time JSX is not declaration-only, so the full content
  // comes back with its reason (Decision 13 refusal kept).
  const runtime = 'export const root = <Badge count={1} />;\nmount(root);\n';
  const fallback = await service.generateStructuralSummary(
    '/ws/src/main.tsx',
    'tsx',
    runtime,
  );
  if (
    fallback.mode !== 'full' ||
    fallback.reason !== 'unsupported-declarations' ||
    fallback.content !== runtime
  ) {
    throw new Error(
      `load-time JSX was not refused with its reason: ${JSON.stringify(fallback)}`,
    );
  }
}

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
  language:
    | 'python'
    | 'go'
    | 'csharp'
    | 'java'
    | 'rust'
    | 'php'
    | 'ruby'
    | 'cpp'
    | 'kotlin',
  override?: { readonly rel: string; readonly content: string },
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
    java: {
      rel: 'src/com/example/A.java',
      content: 'class A { void m() { int x = 1 } }\n',
    },
    rust: {
      rel: 'src/lib.rs',
      content: 'fn f() {\n    let x = ;\n}\n',
    },
    php: {
      rel: 'app/bad.php',
      content: '<p>page</p>\n<?php function f( { $x = ; } ?>\n',
    },
    ruby: {
      rel: 'lib/bad.rb',
      content: 'def f(a\n  1 +\nend\n',
    },
    cpp: {
      rel: 'src/bad.cpp',
      content: 'int f( { int x = ; }\n',
    },
    kotlin: {
      rel: 'src/main/kotlin/Bad.kt',
      content: 'fun f( {\n    val x = \n}\n',
    },
  };
  const { rel, content } = override ?? BROKEN[language];
  // A C file is judged by the C++ grammar and must say so (Batch 31).
  const cSource = /\.[ch]$/.test(rel);

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
        !d.message.includes('syntax-only check, not type-checked') ||
        d.message.includes('c:parsed-as-cpp') !== cSource
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
    // Batch 30k r1 R30K-02: every Kotlin syntax answer names the grammar's
    // known limit (valid one-line class bodies need error recovery).
    if (
      language === 'kotlin' &&
      !coverage.approximations.includes('kotlin:grammar-limit')
    ) {
      throw new Error(
        `a Kotlin syntax answer did not disclose kotlin:grammar-limit: ${JSON.stringify(coverage)}`,
      );
    }
    if (coverage.approximations.includes('c:parsed-as-cpp') !== cSource) {
      throw new Error(
        `c:parsed-as-cpp must be named exactly for C files (${rel}): ${JSON.stringify(coverage)}`,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Batch 37b (Task 37b3.2): `typeCheck:go`. Go is not installed where the
// specs run, so the binary resolution and the process runner are injected;
// the checker, its consent store and the diagnostics provider are real.
// ---------------------------------------------------------------------------

/** In-memory host storage for the consent store (one per registered root). */
class MemoryStateStorage implements IStateStorage {
  private readonly values = new Map<string, unknown>();
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.values.has(key) ? (this.values.get(key) as T) : defaultValue;
  }
  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, value);
  }
  keys(): readonly string[] {
    return [...this.values.keys()];
  }
}

class WorkspaceStateStorage
  extends MemoryStateStorage
  implements IWorkspaceScopedStateStorage
{
  private readonly byRoot = new Map<string, MemoryStateStorage>();
  register(root: string): void {
    this.byRoot.set(path.resolve(root), new MemoryStateStorage());
  }
  getStorageForWorkspace(workspacePath: string): IStateStorage | undefined {
    return this.byRoot.get(workspacePath);
  }
  getAllWorkspacePaths(): string[] {
    return [...this.byRoot.keys()];
  }
}

/** Nothing to show, nothing named unchecked, nothing unmapped. */
function readsAsClean(result: DiagnosticsResult): boolean {
  return (
    result.status === 'available' &&
    result.diagnostics.length === 0 &&
    (result.notChecked ?? []).length === 0 &&
    (result.unmappedFindings ?? 0) === 0
  );
}

/** Go answers are syntax-level: never `type-check`, always `go:syntax-only`. */
function assertNoTypeCheckClaim(result: DiagnosticsResult, when: string): void {
  const coverage = result.coverage as
    { checks?: string; approximations?: readonly string[] } | undefined;
  if (coverage?.checks !== 'syntax-only') {
    throw new Error(
      `${when}: a Go-only answer must be checks 'syntax-only': ${JSON.stringify(coverage)}`,
    );
  }
  if (!coverage.approximations?.includes('go:syntax-only')) {
    throw new Error(
      `${when}: go:syntax-only was not disclosed: ${JSON.stringify(coverage)}`,
    );
  }
}

async function goVetTypeCheckHonesty(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-honesty-govet-'));
  const userData = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ptah-honesty-govet-user-'),
  );
  try {
    fs.writeFileSync(
      path.join(root, 'go.mod'),
      'module example.com/m\n\ngo 1.22\n',
    );
    fs.mkdirSync(path.join(root, 'a'));
    fs.writeFileSync(
      path.join(root, 'a', 'a.go'),
      'package a\n\nfunc A() {}\n',
    );
    const file = path.join(root, 'a', 'a.go').replace(/\\/g, '/');

    const storage = new WorkspaceStateStorage();
    storage.register(root);
    const store = new GoVetConsentStore(storage, { userDataPath: userData });
    const binary = {
      path: path.resolve('/opt/go/bin/go'),
      size: 123,
      mtimeMs: 456,
      pathDirs: [path.resolve('/opt/go/bin')],
    };
    let vetOutput = '# example.com/m/a\n{}\n';
    let runs = 0;
    const runCount = (): number => runs;
    const run = async (): Promise<CheckerRunResult> => {
      runs += 1;
      return {
        kind: 'exited',
        code: 0,
        signal: null,
        stdout: '',
        stderr: vetOutput,
        durationMs: 1,
      };
    };
    const checker = new GoVetChecker({
      consentStore: store,
      getSpawner: () =>
        ({
          spawnProcess: () => {
            throw new Error('spawned outside the injected runner');
          },
        }) as unknown as IProcessSpawner,
      userDataPath: userData,
      logger: { info: () => undefined },
      env: () => ({ PATH: path.resolve('/opt/go/bin') }),
      resolveGo: () => binary,
      run,
    });
    const provider = new LanguageAwareDiagnosticsProvider(
      {
        getDiagnostics: async () => ({
          status: 'available',
          source: 'typescript-compiler',
          diagnostics: [],
        }),
        invalidate: () => undefined,
      },
      createMockFileSystemProvider({
        findFiles: async () => [],
        stat: async (p: string) => {
          const stat = fs.statSync(p);
          return {
            type: stat.isFile() ? FileType.File : FileType.Directory,
            ctime: stat.ctimeMs,
            mtime: stat.mtimeMs,
            size: stat.size,
          };
        },
        readFile: async (p: string) => fs.readFileSync(p, 'utf-8'),
      }),
      parser,
      process.platform,
      checker,
    );
    const ask = () => provider.getDiagnostics(root, { files: [file] });
    const namesGoFile = (result: DiagnosticsResult, text: string): boolean =>
      (result.notChecked ?? []).some(
        (group) =>
          group.language === 'go' &&
          (group.files ?? []).some((f) => f.replace(/\\/g, '/') === file) &&
          group.reason.includes(text),
      );

    // Consent off: nothing runs, Go is unchecked with its reason, not clean.
    const off = await ask();
    if (
      runCount() !== 0 ||
      off.goVet?.status !== 'unchecked' ||
      off.goVet.reason !== 'no-consent' ||
      !namesGoFile(off, 'go vet is off') ||
      readsAsClean(off)
    ) {
      throw new Error(
        `consent off was not an honest unchecked answer: ${JSON.stringify(off)}`,
      );
    }
    assertNoTypeCheckClaim(off, 'consent off');

    // Stale consent (the Go binary changed): same, with the stale reason.
    await store.grant(root, { ...binary, size: 1 });
    const stale = await ask();
    if (
      runCount() !== 0 ||
      stale.goVet?.status !== 'unchecked' ||
      stale.goVet.reason !== 'consent-stale' ||
      !namesGoFile(stale, 'out of date') ||
      readsAsClean(stale)
    ) {
      throw new Error(
        `stale consent was not an honest unchecked answer: ${JSON.stringify(stale)}`,
      );
    }
    assertNoTypeCheckClaim(stale, 'stale consent');

    // Current consent, clean vet run: checked, and still no type-check claim.
    await store.grant(root, binary);
    const checked = await ask();
    if (
      runCount() !== 1 ||
      checked.goVet?.status !== 'checked' ||
      checked.goVet.checkedFiles !== 1
    ) {
      throw new Error(
        `a consented clean vet run was not reported as checked: ${JSON.stringify(checked)}`,
      );
    }
    assertNoTypeCheckClaim(checked, 'vet ran');

    // Findings vet places outside the workspace: counted, file named, not clean.
    vetOutput = JSON.stringify({
      'example.com/m/a': {
        printf: [
          { posn: path.resolve('/elsewhere/generated.go:42:1'), message: 'x' },
        ],
      },
    });
    const unmapped = await ask();
    if (
      unmapped.goVet?.reason !== 'unmapped-findings' ||
      (unmapped.unmappedFindings ?? 0) < 1 ||
      !namesGoFile(unmapped, 'outside the workspace') ||
      readsAsClean(unmapped)
    ) {
      throw new Error(
        `unmapped findings read as clean: ${JSON.stringify(unmapped)}`,
      );
    }
    assertNoTypeCheckClaim(unmapped, 'unmapped findings');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
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
        if (!build) continue; // tsx: no dedicated single-language fixture file yet
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
