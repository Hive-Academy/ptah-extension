/**
 * Java and Rust tree-sitter query sets — real-grammar integration test
 * (Batch 30).
 *
 * Loads the shipped `tree-sitter-java.wasm` and `tree-sitter-rust.wasm`
 * (@vscode/tree-sitter-wasm 0.3.1) and runs the real `LANGUAGE_QUERIES_MAP`
 * entries against real source. A query naming a node or field the grammar
 * lacks makes the query fail, and a node that silently matches nothing gives
 * zero captures, so only the real grammar proves the node names (C#
 * precedent, `csharp-grammar.integration.spec.ts`).
 *
 * The shims are the ones that spec documents: `./wasm-bundle-dir` reads
 * `import.meta.url` (Jest's CJS runtime cannot parse it), and
 * `Language.load(path)` uses a dynamic import Jest's VM rejects, so the file
 * is read here and handed over as bytes.
 *
 * Fixtures hold no quoted module-specifier shapes (validate-deps scans text).
 */

import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';

jest.mock('./wasm-bundle-dir', () => {
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

import { AstAnalysisService } from './ast-analysis.service';
import { TreeSitterParserService } from './tree-sitter-parser.service';
import type { CodeInsights } from './ast-analysis.interfaces';
import type { SupportedLanguage } from './ast.types';
import {
  EXTENSION_LANGUAGE_MAP,
  GRAMMAR_FILE_MAP,
  LANGUAGE_QUERIES_MAP,
} from './tree-sitter.config';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import type {
  ISymbolSink,
  SymbolChunkInsert,
} from '@ptah-extension/memory-contracts';
import { CodeSymbolIndexer } from '../services/code-symbol-indexer.service';
import type { WorkspaceIndexerService } from '../file-indexing/workspace-indexer.service';
import {
  LANGUAGE_REGISTRY,
  classifyFileForCoverage,
  languageForExtension,
  supportedLanguagesFor,
} from './language-registry';

/**
 * Representative Java: package, single-type, static and on-demand imports, a
 * public generic class with a field, a constructor, an annotated method and a
 * generic static method, and nested interface, enum (with a method), record
 * (with a compact constructor) and annotation types.
 */
const JAVA_SOURCE = `package com.example.app;

import java.util.List;
import static java.lang.Math.max;
import java.io.*;

public class App<T> extends Base implements Runnable {
  private int count;

  public App(int count) {
    this.count = count;
  }

  @Override
  public void run() {
    System.out.println(max(count, 1));
  }

  static <U> List<U> of(U first, int size) {
    return null;
  }

  interface Listener {
    void onEvent(String name);
  }

  enum Color {
    RED, GREEN;
    Color next() { return GREEN; }
  }

  record Point(int x, int y) {
    Point {
      if (x < 0) throw new IllegalArgumentException();
    }
  }

  @interface Marker { }
}
`;

/**
 * Representative Rust: grouped, aliased, wildcard and plain `use`, an
 * external module declaration, `extern crate`, an inline module with a
 * function, a generic struct, an enum, a trait with a default method, an
 * inherent generic impl and a trait impl.
 */
const RUST_SOURCE = `use std::collections::{HashMap, HashSet};
use crate::util::helper as h;
use super::*;
use std::fmt;
extern crate serde;
mod parser;

pub mod inline {
    pub fn inner(value: i32) -> i32 {
        value * 2
    }
}

pub struct Point<T> {
    x: T,
}

enum Shape {
    Circle(f64),
}

pub trait Draw {
    fn draw(&self);
    fn size(&self) -> u32 {
        1
    }
}

impl<T> Point<T> {
    pub fn new(x: T) -> Self {
        Point { x }
    }
}

impl Draw for Shape {
    fn draw(&self) {}
}

fn main() {
    let total = inline::inner(2);
    println!("{}", total);
}
`;

function silentLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

describe('Java and Rust grammar integration (real tree-sitter WASM, Batch 30)', () => {
  let parser: TreeSitterParserService;
  let analysis: AstAnalysisService;
  let java: CodeInsights;
  let rust: CodeInsights;

  async function analyse(
    source: string,
    language: SupportedLanguage,
    file: string,
  ): Promise<CodeInsights> {
    const result = await analysis.analyzeSource(source, language, file);
    if (result.isErr()) {
      throw result.error ?? new Error(`${language} analyzeSource failed`);
    }
    if (!result.value) {
      throw new Error(`${language} analyzeSource returned no insights`);
    }
    return result.value;
  }

  beforeAll(async () => {
    parser = new TreeSitterParserService(silentLogger());
    analysis = new AstAnalysisService(silentLogger(), parser);
    java = await analyse(JAVA_SOURCE, 'java', 'App.java');
    rust = await analyse(RUST_SOURCE, 'rust', 'lib.rs');
  }, 60_000);

  afterAll(() => {
    parser?.dispose();
  });

  describe('language wiring', () => {
    it.each([
      ['java', '.java', 'tree-sitter-java.wasm', '/ws/src/App.java'],
      ['rust', '.rs', 'tree-sitter-rust.wasm', '/ws/src/lib.rs'],
    ] as const)(
      '%s: %s maps to its id and the shipped grammar, and the registry grants parse, outline, codeIndex and syntaxDiagnostics',
      (id, extension, grammarFile, file) => {
        expect(EXTENSION_LANGUAGE_MAP[extension]).toBe(id);
        expect(GRAMMAR_FILE_MAP[id]).toBe(grammarFile);
        expect(languageForExtension(extension.toUpperCase())).toBe(id);

        const entry = LANGUAGE_REGISTRY[id];
        expect(entry.extensions).toEqual([extension]);
        expect(entry.grammarFile).toBe(grammarFile);
        for (const capability of [
          'parse',
          'outline',
          'codeIndex',
          'syntaxDiagnostics',
        ] as const) {
          expect(entry.capabilities[capability]).toBe(true);
          expect(supportedLanguagesFor(capability)).toContain(id);
          expect(classifyFileForCoverage(file, capability)).toBe('eligible');
        }
      },
    );

    it.each([
      ['java', '/ws/src/App.java'],
      ['rust', '/ws/src/lib.rs'],
    ] as const)(
      '%s claims no capability a later batch owns (publicSymbols, graphEdges, enrichSummary, definitionFallback)',
      (id, file) => {
        const capabilities = LANGUAGE_REGISTRY[id].capabilities;
        expect(capabilities.publicSymbols).toBe(false);
        expect(capabilities.graphEdges).toBeNull();
        expect(capabilities.enrichSummary).toBe(false);
        expect(capabilities.definitionFallback).toBe(false);
        expect(LANGUAGE_QUERIES_MAP[id].exportQuery).toBe('');
        for (const capability of [
          'publicSymbols',
          'graphEdges',
          'enrichSummary',
          'definitionFallback',
        ] as const) {
          expect(classifyFileForCoverage(file, capability)).toBe('unsupported');
        }
      },
    );
  });

  describe('parse quality', () => {
    it('parses the Java and Rust sources cleanly', () => {
      expect(java.parseStatus).toBe('ok');
      expect(java.errorNodeCount).toBe(0);
      expect(rust.parseStatus).toBe('ok');
      expect(rust.errorNodeCount).toBe(0);
    });

    it.each([
      ['java', 'class Broken { void m( { int x = 1 } }\n', 'Broken.java'],
      ['rust', 'fn broken( {\n    let x = ;\n}\n', 'broken.rs'],
    ] as const)(
      '%s: a broken file is not reported as a clean parse (contrast)',
      async (language, source, file) => {
        const insights = await analyse(source, language, file);
        expect(insights.parseStatus).not.toBe('ok');
        expect(insights.errorNodeCount).toBeGreaterThan(0);
      },
    );
  });

  describe('Java queries hit the right nodes', () => {
    it('captures methods, constructors (compact included) and interface and enum members', () => {
      const byName = new Map(java.functions.map((f) => [f.name, f]));
      expect([...byName.keys()].sort()).toEqual([
        'App',
        'Point',
        'next',
        'of',
        'onEvent',
        'run',
      ]);
      expect(byName.get('App')?.startLine).toBe(9);
      expect(byName.get('App')?.endLine).toBe(11);
      expect(byName.get('run')?.startLine).toBe(13);
      // The shared extractor keeps the first token of each parameter, which
      // for a Java signature is the type (the C# precedent).
      expect(byName.get('of')?.parameters).toEqual(['U', 'int']);
      expect(byName.get('Point')?.parameters).toEqual([]);
    });

    it('captures class, interface, enum, record and annotation types', () => {
      expect(java.classes.map((c) => c.name).sort()).toEqual([
        'App',
        'Color',
        'Listener',
        'Marker',
        'Point',
      ]);
      const app = java.classes.find((c) => c.name === 'App');
      expect(app?.startLine).toBe(6);
    });

    it('captures single-type, static and on-demand imports', () => {
      expect(java.imports).toEqual([
        { source: 'java.util.List' },
        { source: 'java.lang.Math.max' },
        { source: 'java.io', importedSymbols: ['*'] },
      ]);
    });

    it('extracts no exports (publicSymbols is Batch 34)', () => {
      expect(java.exports ?? []).toEqual([]);
    });
  });

  describe('Rust queries hit the right nodes', () => {
    it('captures free, inline-module, trait-default and impl functions', () => {
      const byName = new Map(rust.functions.map((f) => [f.name, f]));
      expect([...byName.keys()].sort()).toEqual([
        'draw',
        'inner',
        'main',
        'new',
        'size',
      ]);
      expect(byName.get('inner')?.startLine).toBe(8);
      expect(byName.get('inner')?.endLine).toBe(10);
      expect(byName.get('inner')?.parameters).toEqual(['value']);
      expect(byName.get('main')?.startLine).toBe(38);
    });

    it('captures structs, enums, traits and impl blocks under the implemented type', () => {
      const classes = rust.classes.map((c) => `${c.name}@${c.startLine}`);
      expect(classes.sort()).toEqual(
        ['Point@13', 'Shape@17', 'Draw@21', 'Point@28', 'Shape@34'].sort(),
      );
    });

    it('captures grouped, aliased, wildcard and plain use, mod declarations and extern crates', () => {
      expect(rust.imports).toEqual([
        { source: 'std::collections::{HashMap, HashSet}' },
        { source: 'crate::util::helper', importedSymbols: ['h'] },
        { source: 'super::*' },
        { source: 'std::fmt' },
        { source: 'serde' },
        { source: 'parser' },
      ]);
    });

    it('does not report an inline module (it has a body) as an import', () => {
      expect(rust.imports.map((i) => i.source)).not.toContain('inline');
    });

    it('extracts no exports (publicSymbols is Batch 35)', () => {
      expect(rust.exports ?? []).toEqual([]);
    });
  });

  // Batch 30 r1 R30-04: impl blocks of a qualified, generic-qualified or
  // referenced self type are indexed under the type's last path segment.
  describe('qualified Rust impl blocks (r1 R30-04)', () => {
    it.each([
      ['impl nested::Foo { fn method(&self) { let x = 1; } }', 'Foo'],
      ['impl fmt::Display for Foo { fn fmt(&self) {} }', 'Foo'],
      ['impl<T> Trait for path::Type<T> { fn a(&self) {} }', 'Type'],
      ['impl Bar for &Foo { fn b(&self) {} }', 'Foo'],
      ["impl<'a> Bar for &'a mut crate::m::Baz<'a> { fn c(&self) {} }", 'Baz'],
    ])('%s is indexed as %s', async (source, name) => {
      const insights = await analyse(source, 'rust', 'impl.rs');
      expect(insights.parseStatus).toBe('ok');
      expect(insights.classes).toEqual([{ name, startLine: 0, endLine: 0 }]);
    });

    it('a type-less self type (slice) is not indexed as an impl block, but its function is', async () => {
      const insights = await analyse(
        'impl Bar for [u8] { fn d(&self) {} }',
        'rust',
        'impl.rs',
      );
      expect(insights.classes).toEqual([]);
      expect(insights.functions.map((f) => f.name)).toEqual(['d']);
    });
  });

  // Batch 30 r1 R30-02: the store keys a row by (workspace root, subject) and
  // overwrites on conflict (memory-curator `code-symbol.store.ts`), so every
  // indexed declaration needs its own subject. The sink below keeps rows the
  // same way; the reviewer's triggers must keep every row.
  describe('code-index rows never overwrite each other (r1 R30-02)', () => {
    async function persistedRows(
      relativePath: string,
      source: string,
    ): Promise<{ inserted: number; rows: Map<string, SymbolChunkInsert> }> {
      const root = '/ws-30-rows';
      const file = `${root}/${relativePath}`;
      const rows = new Map<string, SymbolChunkInsert>();
      let inserted = 0;
      const sink: ISymbolSink = {
        deleteSymbolsForFile: () => 0,
        insertSymbols: async (chunks: readonly SymbolChunkInsert[]) => {
          for (const chunk of chunks) {
            inserted += 1;
            rows.set(chunk.subject, chunk);
          }
        },
      };
      const discovery = {
        indexWorkspaceStream: () =>
          (async function* () {
            yield { path: file, relativePath, type: 'source', size: 100 };
          })(),
      } as unknown as WorkspaceIndexerService;
      const fileSystem = {
        readFile: async () => source,
      } as unknown as IFileSystemProvider;
      await new CodeSymbolIndexer(
        silentLogger(),
        analysis,
        discovery,
        fileSystem,
        sink,
      ).indexWorkspace(root, { userInitiated: true });
      return { inserted, rows };
    }

    function texts(rows: Map<string, SymbolChunkInsert>): string[] {
      // The relative path uses the host separator.
      return [...rows.values()]
        .map((row) => row.text.replace(/\\/g, '/'))
        .sort();
    }

    it('Rust: a struct and its two impl blocks, and each impl method, all persist', async () => {
      const { inserted, rows } = await persistedRows(
        'src/foo.rs',
        [
          'pub struct Foo<T>(T);',
          'impl<T> Foo<T> {',
          '    pub fn new(value: T) -> Self { Foo(value) }',
          '}',
          'impl<T> Foo<T> {',
          '    pub fn get(&self) -> &T { &self.0 }',
          '}',
          '',
        ].join('\n'),
      );
      expect(inserted).toBe(5);
      expect(rows.size).toBe(5);
      expect(texts(rows)).toEqual(
        [
          'class Foo in src/foo.rs:0-0',
          'class Foo in src/foo.rs:1-3',
          'class Foo in src/foo.rs:4-6',
          'function get in src/foo.rs:5-5',
          'function new in src/foo.rs:2-2',
        ].sort(),
      );
      // The first declaration keeps the plain subject; later ones are keyed
      // by their 1-based start line.
      expect([...rows.keys()].filter((k) => k.includes(':Foo')).sort()).toEqual(
        [
          'code:class:/ws-30-rows/src/foo.rs:Foo',
          'code:class:/ws-30-rows/src/foo.rs:Foo@2',
          'code:class:/ws-30-rows/src/foo.rs:Foo@5',
        ],
      );
    });

    it('Java: both overloads persist, each with its own span', async () => {
      const { inserted, rows } = await persistedRows(
        'src/Foo.java',
        [
          'class Foo {',
          '  void method(int x) {}',
          '  void method(String x) {}',
          '}',
          '',
        ].join('\n'),
      );
      expect(inserted).toBe(3);
      expect(rows.size).toBe(3);
      expect(texts(rows)).toEqual([
        'class Foo in src/Foo.java:0-3',
        'function method in src/Foo.java:1-1',
        'function method in src/Foo.java:2-2',
      ]);
    });

    it('re-indexing an unchanged file gives the same subjects (stable identity)', async () => {
      const source = [
        'class A {',
        '  void m(int x) {}',
        '  void m(long x) {}',
        '}',
        '',
      ].join('\n');
      const first = await persistedRows('src/A.java', source);
      const second = await persistedRows('src/A.java', source);
      expect([...second.rows.keys()]).toEqual([...first.rows.keys()]);
    });
  });
});
