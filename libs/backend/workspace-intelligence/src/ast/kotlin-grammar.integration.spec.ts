/**
 * Kotlin tree-sitter query set — real-grammar integration test (Batch 30k).
 *
 * Loads the vendored `assets/tree-sitter/tree-sitter-kotlin.wasm`
 * (`@tree-sitter-grammars/tree-sitter-kotlin` 1.1.0) through the real
 * `TreeSitterParserService` and runs the real `LANGUAGE_QUERIES_MAP` entry
 * against real source. A query naming a node or field the grammar lacks makes
 * the query fail, and a node that silently matches nothing gives zero
 * captures, so only the real grammar proves the node names (C# precedent,
 * `csharp-grammar.integration.spec.ts`).
 *
 * It is also the provenance record's load and corpus gate
 * (`o3-kotlin-grammar-provenance.md` §6): the committed bytes hash to the
 * manifest row and `PROVENANCE.kotlin.json`, the grammar reports ABI 14 under
 * web-tree-sitter 0.27, and the §4 `.kt` and `.kts` inputs parse cleanly.
 *
 * The shims are the ones the Batch 30 spec documents: `./wasm-bundle-dir`
 * reads `import.meta.url`, and `Language.load(path)` uses a dynamic import
 * Jest's VM rejects, so the file is read here and handed over as bytes. The
 * Kotlin grammar is vendored, so it resolves to `assets/tree-sitter/`, not to
 * @vscode/tree-sitter-wasm.
 */

import 'reflect-metadata';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';

jest.mock('./wasm-bundle-dir', () => {
  const path = require('path');
  const grammarDir = path.join(
    path.dirname(require.resolve('@vscode/tree-sitter-wasm/package.json')),
    'wasm',
  );
  const runtimeDir = path.dirname(require.resolve('web-tree-sitter'));
  // A repository asset, not a module: resolved from this file, not imported.
  const kotlinWasm = path.join(
    __dirname,
    '../../../../../assets/tree-sitter/tree-sitter-kotlin.wasm',
  );
  return {
    BUNDLE_DIR: grammarDir,
    resolveWasmPath: (filename: string) =>
      filename.startsWith('web-tree-sitter')
        ? path.join(runtimeDir, filename)
        : filename === 'tree-sitter-kotlin.wasm'
          ? kotlinWasm
          : path.join(grammarDir, filename),
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

import { Language } from 'web-tree-sitter';
import { AstAnalysisService } from './ast-analysis.service';
import { TreeSitterParserService } from './tree-sitter-parser.service';
import type { CodeInsights } from './ast-analysis.interfaces';
import {
  EXTENSION_LANGUAGE_MAP,
  GRAMMAR_FILE_MAP,
  LANGUAGE_QUERIES_MAP,
} from './tree-sitter.config';
import {
  FileType,
  type IDiagnosticsProvider,
  type IFileSystemProvider,
  type LanguageCoverage,
} from '@ptah-extension/platform-core';
import { createMockFileSystemProvider } from '@ptah-extension/platform-core/testing';
import type {
  ISymbolSink,
  SymbolChunkInsert,
} from '@ptah-extension/memory-contracts';
import { CodeSymbolIndexer } from '../services/code-symbol-indexer.service';
import type { WorkspaceIndexerService } from '../file-indexing/workspace-indexer.service';
import { LanguageAwareDiagnosticsProvider } from '../diagnostics/language-aware-diagnostics-provider';
import {
  LANGUAGE_REGISTRY,
  classifyFileForCoverage,
  languageForExtension,
  supportedLanguagesFor,
} from './language-registry';
import { KOTLIN_UNLOCATED_RECOVERY_TEXT } from './languages/kotlin.language';

const REPO_ROOT = nodePath.resolve(__dirname, '../../../../..');
const KOTLIN_WASM = nodePath.join(
  REPO_ROOT,
  'assets/tree-sitter/tree-sitter-kotlin.wasm',
);

/**
 * The provenance record's §4 `.kt` corpus: package header, a plain, an
 * aliased and a wildcard import, a data class, an object, a class with a
 * `when` expression and a secondary constructor, an extension function, a
 * generic function and a lambda property, plus an interface, an enum class
 * and a sealed class with a nested class and object.
 */
const KOTLIN_SOURCE = `package com.example.app

import kotlin.math.max
import com.example.util.Helper as H
import com.example.model.*

data class Point(val x: Int, val y: Int)

object Registry {
    fun register(name: String): Boolean = true
}

interface Shape {
    fun area(): Double
}

enum class Color {
    RED,
    GREEN
}

sealed class Result<out T> {
    class Ok<T>(val value: T) : Result<T>()
    object Empty : Result<Nothing>()
}

class Widget(private val label: String) : Shape {
    constructor(size: Int) : this(size.toString())

    override fun area(): Double = 1.0

    fun render(prefix: String, width: Int): String {
        return when (label) {
            "a" -> prefix + "A"
            else -> label.padEnd(max(width, 1))
        }
    }
}

fun String.shout(): String = uppercase()

fun <T> identity(value: T): T = value

val double: (Int) -> Int = { it * 2 }
`;

/** The provenance record's §4 `.kts` script. */
const KOTLIN_SCRIPT = `plugins {
    kotlin("jvm") version "2.0.0"
}

val greeting = "hello".let { it.uppercase() }

println(greeting)
`;

function silentLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function sha256(file: string): string {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

describe('Kotlin grammar integration (vendored tree-sitter WASM, Batch 30k)', () => {
  let parser: TreeSitterParserService;
  let analysis: AstAnalysisService;
  let kotlin: CodeInsights;
  let script: CodeInsights;

  async function analyse(source: string, file: string): Promise<CodeInsights> {
    const result = await analysis.analyzeSource(source, 'kotlin', file);
    if (result.isErr()) {
      throw result.error ?? new Error('kotlin analyzeSource failed');
    }
    if (!result.value) {
      throw new Error('kotlin analyzeSource returned no insights');
    }
    return result.value;
  }

  beforeAll(async () => {
    parser = new TreeSitterParserService(silentLogger());
    analysis = new AstAnalysisService(silentLogger(), parser);
    kotlin = await analyse(KOTLIN_SOURCE, 'Widget.kt');
    script = await analyse(KOTLIN_SCRIPT, 'build.gradle.kts');
  }, 60_000);

  afterAll(() => {
    parser?.dispose();
  });

  describe('provenance and load gate', () => {
    const manifest = JSON.parse(
      fs.readFileSync(
        nodePath.join(REPO_ROOT, 'scripts/tree-sitter-grammars.json'),
        'utf8',
      ),
    ) as {
      assets: Array<{
        id: string;
        active: boolean;
        filename: string;
        bytes: number;
        source: {
          kind: string;
          path: string;
          sha256: string;
          licenceFile: string;
          licenceSha256: string;
          provenanceFile: string;
          provenancePending?: boolean;
        };
      }>;
    };
    const row = manifest.assets.find((asset) => asset.id === 'kotlin');
    const provenance = JSON.parse(
      fs.readFileSync(
        nodePath.join(REPO_ROOT, 'assets/tree-sitter/PROVENANCE.kotlin.json'),
        'utf8',
      ),
    ) as {
      version: string;
      abi: number;
      wasm: { bytes: number; sha256: string };
      license: { sha256: string };
    };

    it('the manifest row is active, vendored, no longer pending, and names the committed files', () => {
      expect(row).toBeDefined();
      expect(row?.active).toBe(true);
      expect(row?.filename).toBe(GRAMMAR_FILE_MAP.kotlin);
      expect(row?.source.kind).toBe('vendored');
      expect(row?.source.provenancePending).toBeUndefined();
      expect(row?.source.path).toBe(
        'assets/tree-sitter/tree-sitter-kotlin.wasm',
      );
      expect(row?.source.provenanceFile).toBe(
        'assets/tree-sitter/PROVENANCE.kotlin.json',
      );
    });

    it('the committed WASM and licence hash to the manifest row and the provenance record', () => {
      expect(fs.statSync(KOTLIN_WASM).size).toBe(row?.bytes);
      expect(row?.bytes).toBe(provenance.wasm.bytes);
      expect(sha256(KOTLIN_WASM)).toBe(row?.source.sha256);
      expect(row?.source.sha256).toBe(provenance.wasm.sha256);
      expect(
        sha256(nodePath.join(REPO_ROOT, row?.source.licenceFile ?? '')),
      ).toBe(row?.source.licenceSha256);
      expect(row?.source.licenceSha256).toBe(provenance.license.sha256);
    });

    it('loads under the installed web-tree-sitter with the recorded ABI (14)', async () => {
      // The parser service above initialised the runtime and loaded this file.
      const grammar = await Language.load(
        new Uint8Array(fs.readFileSync(KOTLIN_WASM)),
      );
      expect(grammar.abiVersion).toBe(14);
      expect(grammar.abiVersion).toBe(provenance.abi);
    });
  });

  describe('language wiring', () => {
    it.each([
      ['.kt', '/ws/src/Widget.kt'],
      ['.kts', '/ws/build.gradle.kts'],
    ] as const)(
      '%s maps to kotlin and the vendored grammar, and the registry grants parse, outline, codeIndex and syntaxDiagnostics',
      (extension, file) => {
        expect(EXTENSION_LANGUAGE_MAP[extension]).toBe('kotlin');
        expect(languageForExtension(extension.toUpperCase())).toBe('kotlin');
        expect(GRAMMAR_FILE_MAP.kotlin).toBe('tree-sitter-kotlin.wasm');

        const entry = LANGUAGE_REGISTRY.kotlin;
        expect(entry.extensions).toEqual(['.kt', '.kts']);
        expect(entry.grammarFile).toBe('tree-sitter-kotlin.wasm');
        for (const capability of [
          'parse',
          'outline',
          'codeIndex',
          'syntaxDiagnostics',
        ] as const) {
          expect(entry.capabilities[capability]).toBe(true);
          expect(supportedLanguagesFor(capability)).toContain('kotlin');
          expect(classifyFileForCoverage(file, capability)).toBe('eligible');
        }
      },
    );

    it('claims no graph key and no capability it does not implement (User Decision 19)', () => {
      const capabilities = LANGUAGE_REGISTRY.kotlin.capabilities;
      expect(capabilities.publicSymbols).toBe(false);
      expect(capabilities.graphEdges).toBeNull();
      expect(capabilities.enrichSummary).toBe(false);
      expect(capabilities.definitionFallback).toBe(false);
      expect(LANGUAGE_QUERIES_MAP.kotlin.exportQuery).toBe('');
      for (const capability of [
        'publicSymbols',
        'graphEdges',
        'enrichSummary',
        'definitionFallback',
      ] as const) {
        expect(classifyFileForCoverage('/ws/src/Widget.kt', capability)).toBe(
          'unsupported',
        );
      }
    });
  });

  describe('parse quality (corpus gate)', () => {
    it('parses the .kt corpus and the .kts script cleanly', () => {
      expect(kotlin.parseStatus).toBe('ok');
      expect(kotlin.errorNodeCount).toBe(0);
      expect(script.parseStatus).toBe('ok');
      expect(script.errorNodeCount).toBe(0);
    });

    it('a broken file is not reported as a clean parse (contrast)', async () => {
      const insights = await analyse(
        'fun broken( {\n    val x = \n}\n',
        'Broken.kt',
      );
      expect(insights.parseStatus).not.toBe('ok');
      expect(insights.errorNodeCount).toBeGreaterThan(0);
    });

    // Upstream tree-sitter-kotlin #12/#13 (open in 1.1.0): a class body whose
    // last member shares the closing brace's line needs error recovery. Such
    // a file must never read as a clean parse (the index then fails it and
    // the outliner refuses it); the same members with a separator are clean.
    it.each([
      'object Keys { const val A = 1 }\n',
      'interface Shape { fun area(): Double }\n',
      'class C { init { println() } }\n',
    ])('grammar limit: %j is recovered, never ok', async (source) => {
      const insights = await analyse(source, 'OneLine.kt');
      expect(insights.parseStatus).toBe('recovered');
    });

    it('the same one-line class body with a member separator parses cleanly', async () => {
      const insights = await analyse(
        'object Keys { const val A = 1; }\n',
        'OneLine.kt',
      );
      expect(insights.parseStatus).toBe('ok');
      expect(insights.classes.map((c) => c.name)).toEqual(['Keys']);
    });
  });

  describe('Kotlin queries hit the right nodes', () => {
    it('captures top-level, member, interface, extension and generic functions', () => {
      const byName = new Map(kotlin.functions.map((f) => [f.name, f]));
      expect([...byName.keys()].sort()).toEqual([
        'area',
        'identity',
        'register',
        'render',
        'shout',
      ]);
      expect(byName.get('register')?.startLine).toBe(9);
      expect(byName.get('register')?.parameters).toEqual(['name']);
      expect(byName.get('render')?.startLine).toBe(31);
      expect(byName.get('render')?.endLine).toBe(36);
      expect(byName.get('render')?.parameters).toEqual(['prefix', 'width']);
      expect(byName.get('shout')?.startLine).toBe(39);
      expect(byName.get('identity')?.parameters).toEqual(['value']);
      // The interface member and the override are two declarations.
      expect(kotlin.functions.filter((f) => f.name === 'area')).toHaveLength(2);
    });

    it('captures classes, data, enum, sealed and nested classes, interfaces and objects', () => {
      expect(
        kotlin.classes.map((c) => `${c.name}@${c.startLine}`).sort(),
      ).toEqual(
        [
          'Point@6',
          'Registry@8',
          'Shape@12',
          'Color@16',
          'Result@21',
          'Ok@22',
          'Empty@23',
          'Widget@26',
        ].sort(),
      );
    });

    it('captures plain, aliased and wildcard imports', () => {
      expect(kotlin.imports).toEqual([
        { source: 'kotlin.math.max' },
        { source: 'com.example.util.Helper', importedSymbols: ['H'] },
        { source: 'com.example.model', importedSymbols: ['*'] },
      ]);
    });

    // Batch 30k r1 R30K-03: a comment in or next to an import never hides it,
    // and the module name is its comment-free form. Each import is reported
    // once.
    it.each([
      ['import a./* c */b.C', { source: 'a.b.C' }],
      ['import /* lead */ a.b.C', { source: 'a.b.C' }],
      ['import a.b.C // trailing *', { source: 'a.b.C' }],
      ['import a./* c */b.*', { source: 'a.b', importedSymbols: ['*'] }],
      ['import a.b. /* c */ *', { source: 'a.b', importedSymbols: ['*'] }],
      ['import a.b.* // trailing', { source: 'a.b', importedSymbols: ['*'] }],
      [
        'import a./* c */b.C as /* d */ D',
        { source: 'a.b.C', importedSymbols: ['D'] },
      ],
      ['import a.b.C as D // e', { source: 'a.b.C', importedSymbols: ['D'] }],
    ])(
      '%s is imported once, as its comment-free form',
      async (line, expected) => {
        const insights = await analyse(`${line}\nfun needle() = 1\n`, 'Imp.kt');
        expect(insights.parseStatus).toBe('ok');
        expect(insights.imports).toEqual([expected]);
      },
    );

    it('extracts no exports (no Kotlin publicSymbols key)', () => {
      expect(kotlin.exports ?? []).toEqual([]);
    });

    it('a .kts script declares no functions or types and imports nothing', () => {
      expect(script.functions).toEqual([]);
      expect(script.classes).toEqual([]);
      expect(script.imports).toEqual([]);
    });
  });

  describe('code index: every declaration persists, same-line ones included', () => {
    async function indexFile(
      relativePath: string,
      source: string,
    ): Promise<{
      inserted: number;
      rows: Map<string, SymbolChunkInsert>;
      coverage: LanguageCoverage;
    }> {
      const root = '/ws-30k-rows';
      const file = `${root}/${relativePath}`;
      const rows = new Map<string, SymbolChunkInsert>();
      let inserted = 0;
      const record = (chunks: readonly SymbolChunkInsert[]): void => {
        for (const chunk of chunks) {
          inserted += 1;
          rows.set(chunk.subject, chunk);
        }
      };
      const sink: ISymbolSink = {
        deleteSymbolsForFile: () => 0,
        insertSymbols: async (chunks) => {
          record(chunks);
        },
        replaceFileSymbols: async (_workspaceRoot, _filePath, chunks) => {
          record(chunks);
        },
        purgeMissing: () => 0,
      };
      const discovery = {
        indexWorkspaceStream: () =>
          (async function* () {
            yield { path: file, relativePath, type: 'source', size: 100 };
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
      return { inserted, rows, coverage: indexer.getCoverage(root) };
    }

    // Batch 31 r1 R31-03 (Batch 30 R30-02, rolled forward): declarations
    // that share a name and a LINE are distinct; the extractor keys each by
    // its name's position, so every one reaches the store under its own
    // subject.
    it.each([
      [
        'top-level overloads on one line',
        'src/Overloads.kt',
        'fun needle(x: Int) = x; fun needle(x: String) = x\n',
        ['function needle', 'function needle'],
      ],
      [
        'two classes with a same-named member on one line',
        'src/Pair.kt',
        'class A { fun needle() = 1; }; class B { fun needle() = 2; }\n',
        ['class A', 'class B', 'function needle', 'function needle'],
      ],
      [
        'an object and a class of the same name on one line',
        'src/Twins.kt',
        'object Needle; class Needle\n',
        ['class Needle', 'class Needle'],
      ],
    ])(
      '%s: every declaration persists, with the expected cardinality',
      async (_label, relativePath, source, expected) => {
        const { inserted, rows, coverage } = await indexFile(
          relativePath,
          source,
        );
        expect(inserted).toBe(expected.length);
        expect(rows.size).toBe(expected.length);
        expect(
          [...rows.values()].map((row) => row.text.split(' in ')[0]).sort(),
        ).toEqual([...expected].sort());
        expect(coverage.analyzed).toBe(1);
        expect(coverage.failed).toBe(0);
      },
    );

    it('member overloads on separate lines persist, each with its own span', async () => {
      const { inserted, rows, coverage } = await indexFile(
        'src/Widget.kt',
        [
          'class Widget {',
          '    fun render(): String = "w"',
          '    fun render(prefix: String): String = prefix + render()',
          '}',
          '',
        ].join('\n'),
      );
      expect(inserted).toBe(3);
      expect(rows.size).toBe(3);
      expect(
        [...rows.values()].map((row) => row.text.replace(/\\/g, '/')).sort(),
      ).toEqual([
        'class Widget in src/Widget.kt:0-3',
        'function render in src/Widget.kt:1-1',
        'function render in src/Widget.kt:2-2',
      ]);
      expect(coverage.analyzed).toBe(1);
      expect(coverage.approximations).toBeUndefined();
    });

    it('the corpus is analysed; a file the grammar can only recover is failed.parse, never analysed', async () => {
      const clean = await indexFile('src/App.kt', KOTLIN_SOURCE);
      expect(clean.coverage.analyzed).toBe(1);
      expect(clean.coverage.unsupported).toBe(0);
      expect([...clean.rows.values()].map((row) => row.symbolName)).toEqual(
        expect.arrayContaining(['Widget', 'render', 'shout']),
      );

      const limited = await indexFile(
        'src/Keys.kt',
        'object Keys { const val A = 1 }\n',
      );
      expect(limited.coverage.analyzed).toBe(0);
      expect(limited.coverage.failed).toBe(1);
      expect(limited.coverage.failedByReason).toEqual({ parse: 1 });
      expect(limited.coverage.clean).toBe(false);
    });
  });

  describe('syntax diagnostics', () => {
    async function diagnose(
      relativePath: string,
      content: string,
    ): Promise<
      Awaited<ReturnType<LanguageAwareDiagnosticsProvider['getDiagnostics']>>
    > {
      const root = fs.mkdtempSync(
        nodePath.join(os.tmpdir(), 'ptah-b30k-diag-'),
      );
      try {
        const full = nodePath.join(root, relativePath);
        fs.mkdirSync(nodePath.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf-8');
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
        return await new LanguageAwareDiagnosticsProvider(
          inner,
          fsProvider,
          parser,
        ).getDiagnostics(root, { files: [full.replace(/\\/g, '/')] });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }

    it.each([
      ['src/Broken.kt', 'fun broken( {\n    val x = \n}\n'],
      ['build.gradle.kts', 'plugins {\n    kotlin("jvm") version\n'],
    ])(
      '%s: a syntax error is reported as a syntax-only kotlin check',
      async (relativePath, content) => {
        const result = await diagnose(relativePath, content);
        expect(result.status).toBe('available');
        if (result.status !== 'available') return;
        const messages = result.diagnostics.flatMap((entry) =>
          entry.diagnostics.map((d) => d.message),
        );
        expect(messages.length).toBeGreaterThan(0);
        for (const message of messages) {
          expect(message).toContain(
            '(kotlin, kotlin:grammar-limit; syntax-only check, not type-checked)',
          );
        }
        expect(result.coverage?.approximations).toEqual([
          'kotlin:syntax-only',
          'kotlin:grammar-limit',
        ]);
      },
    );

    // Batch 30k r1 R30K-02: valid Kotlin the vendored grammar can only
    // recover (upstream #12/#13) is never served as a syntax error. It is
    // reported as not validated, naming the grammar limit.
    it.each([
      ['src/Keys.kt', 'object Keys { const val A = 1 }\n'],
      ['src/Init.kt', 'class C { init { println() } }\n'],
    ])(
      'grammar limit: valid %s gets no syntax error, and is named as not validated',
      async (relativePath, content) => {
        const result = await diagnose(relativePath, content);
        const errors = (
          result.status === 'available' ? result.diagnostics : []
        ).flatMap((entry) =>
          entry.diagnostics.filter((d) => d.severity === 'error'),
        );
        expect(errors).toEqual([]);
        expect(result.notChecked).toEqual([
          expect.objectContaining({
            language: 'kotlin',
            count: 1,
            reason: KOTLIN_UNLOCATED_RECOVERY_TEXT,
          }),
        ]);
        expect(result.notChecked?.[0]?.reason).toContain(
          'kotlin:grammar-limit',
        );
        expect(result.coverage).toMatchObject({
          clean: false,
          failed: 1,
          failedByReason: { parse: 1 },
        });
        expect(result.coverage?.approximations).toContain(
          'kotlin:grammar-limit',
        );
      },
    );

    it('a real error next to a grammar-limited valid file is still reported, for that file only', async () => {
      const root = fs.mkdtempSync(
        nodePath.join(os.tmpdir(), 'ptah-b30k-diag-mixed-'),
      );
      try {
        const files = [
          ['src/Keys.kt', 'object Keys { const val A = 1 }\n'],
          ['src/Broken.kt', 'fun broken( {\n    val x = \n}\n'],
        ].map(([relativePath, content]) => {
          const full = nodePath.join(root, relativePath);
          fs.mkdirSync(nodePath.dirname(full), { recursive: true });
          fs.writeFileSync(full, content, 'utf-8');
          return full.replace(/\\/g, '/');
        });
        const result = await new LanguageAwareDiagnosticsProvider(
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
            stat: async (file: string) => ({
              type: FileType.File,
              ctime: 0,
              mtime: 0,
              size: fs.statSync(file).size,
            }),
            readFile: async (file: string) => fs.readFileSync(file, 'utf-8'),
          }),
          parser,
        ).getDiagnostics(root, { files });
        expect(result.status).toBe('available');
        if (result.status !== 'available') return;
        expect(result.diagnostics.map((entry) => entry.file)).toEqual([
          files[1],
        ]);
        expect(result.notChecked?.[0]?.files).toEqual([files[0]]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('the clean corpus has no diagnostics, and still names the grammar limit', async () => {
      const result = await diagnose('src/App.kt', KOTLIN_SOURCE);
      expect(result.status).toBe('available');
      if (result.status !== 'available') return;
      expect(result.diagnostics.flatMap((entry) => entry.diagnostics)).toEqual(
        [],
      );
      expect(result.coverage?.approximations).toEqual([
        'kotlin:syntax-only',
        'kotlin:grammar-limit',
      ]);
    });
  });
});
