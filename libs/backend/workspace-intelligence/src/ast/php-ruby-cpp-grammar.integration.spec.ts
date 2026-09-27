/**
 * PHP, Ruby and C++ tree-sitter query sets — real-grammar integration test
 * (Batch 31).
 *
 * Loads the shipped `tree-sitter-php.wasm`, `tree-sitter-ruby.wasm` and
 * `tree-sitter-cpp.wasm` (@vscode/tree-sitter-wasm 0.3.1) and runs the real
 * `LANGUAGE_QUERIES_MAP` entries against real source. A query naming a node
 * or field the grammar lacks makes the query fail, and a node that silently
 * matches nothing gives zero captures, so only the real grammar proves the
 * node names (C# precedent, `csharp-grammar.integration.spec.ts`).
 *
 * C has no grammar of its own (User Decision 19): `.c` and `.h` files parse
 * with the C++ grammar, so the cpp keys are proven on a real `.c`, a real `.h`
 * and a real `.cpp` file, and the `c:parsed-as-cpp` approximation is checked
 * on the index and diagnostics answers.
 *
 * The shims are the ones the Batch 30 spec documents: `./wasm-bundle-dir`
 * reads `import.meta.url`, and `Language.load(path)` uses a dynamic import
 * Jest's VM rejects, so the file is read here and handed over as bytes.
 *
 * Include and require fixtures are built by concatenation (validate-deps
 * scans text for module-specifier shapes).
 */

import 'reflect-metadata';
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
  return {
    BUNDLE_DIR: grammarDir,
    resolveWasmPath: (filename: string) =>
      filename.startsWith('web-tree-sitter')
        ? path.join(runtimeDir, filename)
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

import { AstAnalysisService } from './ast-analysis.service';
import { TreeSitterParserService } from './tree-sitter-parser.service';
import type { CodeInsights } from './ast-analysis.interfaces';
import type { GenericAstNode, SupportedLanguage } from './ast.types';
import { cDeclaratorName } from './c-declarator';
import { Result } from '@ptah-extension/shared';
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
  isCParsedAsCpp,
  languageForExtension,
  supportedLanguagesFor,
} from './language-registry';

/** Concatenated so no quoted module-specifier shape appears in this file. */
const REQUIRE = 'req' + 'uire';

/**
 * Representative PHP inside HTML: namespace, plain, aliased and grouped
 * `use`, literal and computed includes, interface, trait, enum, abstract
 * class with a promoted-style constructor and a static method, a function
 * with a closure and an arrow function, and a function whose body is HTML
 * between `?>` and `<?php`.
 */
const PHP_SOURCE = String.raw`<!DOCTYPE html>
<html><body>
<?php
namespace App\Models;

use App\Contracts\Named;
use App\Support\Str as S;
use App\Shapes\{Circle, Square as Sq};
${REQUIRE}_once('helpers.php');
include 'partials/header.php';
include __DIR__ . '/computed.php';

interface Renderable
{
    public function render(): string;
}

trait Greets
{
    public function greet($name) { return "Hi $name"; }
}

enum Suit: string
{
    case Hearts = 'H';
    public function color() { return 'Red'; }
}

abstract class Widget implements Renderable
{
    use Greets;
    private $label = 'w';

    public function __construct(string $label, int $size = 1)
    {
        $this->label = $label;
    }

    public static function make(): self { return new static('x'); }
}

function helper_name($value)
{
    $wrap = function ($x) use ($value) { return $x . $value; };
    $twice = fn($x) => $x * 2;
    return $wrap($twice(1));
}
?>
<p><?= helper_name('a') ?></p>
<?php function late_partial() { ?>
  <div>html inside a function body</div>
<?php } ?>
`;

/**
 * Representative Ruby: literal `require`/`require_relative`, a computed
 * require, a module holding a class with an initializer, a singleton method,
 * an endless method and a string-interpolating method, a class named by a
 * scope (`Admin::Panel`), and a top-level method with a block.
 */
const RUBY_SOURCE = `${REQUIRE} 'json'
${REQUIRE}_relative 'lib/helper'
${REQUIRE} File.join(__dir__, 'computed')

module Shop
  class Widget < Base
    attr_reader :label

    def initialize(label, size = 1)
      @label = label
    end

    def self.build(label)
      new(label)
    end

    def title = "Widget #{label}"

    def render
      "<#{label}>"
    end
  end

  class Admin::Panel
    def show; end
  end
end

def top_level(a,
              b)
  [a, b].map do |x|
    x * 2
  end
end
`;

/**
 * Representative C++: local and system includes, a function-like macro,
 * nested namespaces with a class template (inline constructor and method, a
 * member prototype), a struct and a scoped enum, an out-of-line qualified
 * template member definition, a `static` function, a function returning a
 * pointer, `main` with a lambda, and two overloads.
 */
const CPP_SOURCE = `#include "widget.h"
#include <iostream>
#define SQUARE(x) ((x) * (x))

namespace app {
namespace ui {

template <typename T>
class Box {
 public:
  explicit Box(T value) : value_(value) {}
  T get() const { return value_; }
  int area(int side);

 private:
  T value_;
};

struct Point {
  int x;
  int y;
};

enum class Mode { Fast, Slow };

}  // namespace ui
}  // namespace app

template <typename T>
int app::ui::Box<T>::area(int side) {
  return SQUARE(side);
}

static int helper(int value) { return value + 1; }

const char *label_of(int code) {
  return code > 0 ? "yes" : "no";
}

int main() {
  auto twice = [](int v) { return v * 2; };
  std::cout << twice(helper(widget_name())) << std::endl;
  return 0;
}

int scale(int v) { return v * 2; }
double scale(double v) { return v * 2.0; }
`;

/** Real C: a typedef'd anonymous struct, a tagged struct, designated initialisers. */
const C_SOURCE = `#include "widget.h"
#include <stdlib.h>

typedef struct {
    int width;
} Size;

struct widget {
    const char *name;
    Size size;
};

static int clamp(int value) { return value < 0 ? 0 : value; }

int widget_name(void) {
    struct widget w = { .name = "w", .size = { .width = 2 } };
    return clamp(w.size.width);
}
`;

/** A real C header: include guard, forward declaration, typedef'd enum, prototype, inline function. */
const H_SOURCE = `#ifndef WIDGET_H
#define WIDGET_H

struct widget;

typedef enum { WIDGET_SMALL, WIDGET_LARGE } widget_kind;

int widget_name(void);

static inline int widget_twice(int v) { return v * 2; }

#endif
`;

/** Valid C the C++ grammar cannot parse: `new` is a C++ keyword. */
const C_NOT_CPP_SOURCE = `int make(void) {
    int *new = 0;
    return new == 0;
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

describe('PHP, Ruby and C++ grammar integration (real tree-sitter WASM, Batch 31)', () => {
  let parser: TreeSitterParserService;
  let analysis: AstAnalysisService;
  let php: CodeInsights;
  let ruby: CodeInsights;
  let cpp: CodeInsights;
  let c: CodeInsights;
  let header: CodeInsights;

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
    php = await analyse(PHP_SOURCE, 'php', 'Widget.php');
    ruby = await analyse(RUBY_SOURCE, 'ruby', 'widget.rb');
    cpp = await analyse(CPP_SOURCE, 'cpp', 'app.cpp');
    c = await analyse(C_SOURCE, EXTENSION_LANGUAGE_MAP['.c'], 'widget.c');
    header = await analyse(H_SOURCE, EXTENSION_LANGUAGE_MAP['.h'], 'widget.h');
  }, 60_000);

  afterAll(() => {
    parser?.dispose();
  });

  describe('language wiring', () => {
    it.each([
      ['php', ['.php', '.phtml'], 'tree-sitter-php.wasm', '/ws/app/Widget.php'],
      ['ruby', ['.rb', '.rake'], 'tree-sitter-ruby.wasm', '/ws/app/widget.rb'],
      [
        'cpp',
        ['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hh', '.hxx', '.c', '.h'],
        'tree-sitter-cpp.wasm',
        '/ws/native/app.cpp',
      ],
    ] as const)(
      '%s: its extensions map to its id and the shipped grammar, and the registry grants parse, outline, codeIndex and syntaxDiagnostics',
      (id, extensions, grammarFile, file) => {
        for (const extension of extensions) {
          expect(EXTENSION_LANGUAGE_MAP[extension]).toBe(id);
          expect(languageForExtension(extension.toUpperCase())).toBe(id);
        }
        expect(GRAMMAR_FILE_MAP[id]).toBe(grammarFile);
        const entry = LANGUAGE_REGISTRY[id];
        expect(entry.extensions).toEqual(extensions);
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

    it('.c and .h are C++ (no separate C grammar), and only they are C parsed as C++', () => {
      for (const file of ['/ws/native/widget.c', '/ws/native/WIDGET.H']) {
        expect(classifyFileForCoverage(file, 'codeIndex')).toBe('eligible');
        expect(isCParsedAsCpp(file)).toBe(true);
      }
      for (const file of [
        '/ws/native/app.cpp',
        '/ws/native/app.hpp',
        '/ws/c/readme.md',
        '/ws/src/h',
      ]) {
        expect(isCParsedAsCpp(file)).toBe(false);
      }
    });

    it.each([
      ['php', '/ws/app/Widget.php'],
      ['ruby', '/ws/app/widget.rb'],
      ['cpp', '/ws/native/app.cpp'],
      ['cpp', '/ws/native/widget.c'],
    ] as const)(
      '%s (%s) claims no capability a later batch owns (publicSymbols, graphEdges, enrichSummary, definitionFallback)',
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
    it('parses the PHP (HTML around it included), Ruby, C++, C and header sources cleanly', () => {
      for (const insights of [php, ruby, cpp, c, header]) {
        expect(insights.parseStatus).toBe('ok');
        expect(insights.errorNodeCount).toBe(0);
      }
    });

    it.each([
      ['php', '<?php\nfunction broken( { $x = ; }\n', 'broken.php'],
      ['ruby', 'def broken(a\n  1 +\nend\n', 'broken.rb'],
      ['cpp', 'int broken( { int x = ; }\n', 'broken.cpp'],
    ] as const)(
      '%s: a broken file is not reported as a clean parse (contrast)',
      async (language, source, file) => {
        const insights = await analyse(source, language, file);
        expect(insights.parseStatus).not.toBe('ok');
        expect(insights.errorNodeCount).toBeGreaterThan(0);
      },
    );

    it.each([
      ['a variable named `new`', C_NOT_CPP_SOURCE],
      [
        'an `extern "C"` block split across `#ifdef`s',
        [
          '#ifdef __cplusplus',
          'extern "C" {',
          '#endif',
          'int widget_name(void);',
          '#ifdef __cplusplus',
          '}',
          '#endif',
          '',
        ].join('\n'),
      ],
    ])(
      'valid C the C++ grammar cannot parse (%s) is a recovered parse, never clean',
      async (_label, source) => {
        const insights = await analyse(source, 'cpp', 'guard.h');
        expect(insights.parseStatus).toBe('recovered');
      },
    );
  });

  describe('PHP queries hit the right nodes', () => {
    it('captures functions and class, trait, interface and enum methods', () => {
      const byName = new Map(php.functions.map((f) => [f.name, f]));
      expect([...byName.keys()].sort()).toEqual([
        '__construct',
        'color',
        'greet',
        'helper_name',
        'late_partial',
        'make',
        'render',
      ]);
      expect(byName.get('__construct')?.startLine).toBe(33);
      expect(byName.get('__construct')?.endLine).toBe(36);
      expect(byName.get('helper_name')?.startLine).toBe(41);
      expect(byName.get('helper_name')?.endLine).toBe(46);
      // A function whose body is HTML between `?>` and `<?php`.
      expect(byName.get('late_partial')?.startLine).toBe(49);
      expect(byName.get('late_partial')?.endLine).toBe(51);
      // The shared extractor keeps each parameter's first token.
      expect(byName.get('__construct')?.parameters).toEqual(['string', 'int']);
    });

    it('captures interfaces, traits, enums and classes', () => {
      expect(php.classes.map((k) => `${k.name}@${k.startLine}`)).toEqual([
        'Renderable@12',
        'Greets@17',
        'Suit@22',
        'Widget@28',
      ]);
    });

    it('captures plain, aliased and grouped use and literal includes, not a computed include', () => {
      expect(php.imports).toEqual([
        { source: 'App\\Contracts\\Named' },
        { source: 'App\\Support\\Str', importedSymbols: ['S'] },
        { source: 'App\\Shapes', importedSymbols: ['Circle'] },
        { source: 'App\\Shapes', importedSymbols: ['Sq'] },
        { source: 'helpers.php' },
        { source: 'partials/header.php' },
      ]);
    });

    it('extracts no exports (publicSymbols is Batch 36)', () => {
      expect(php.exports ?? []).toEqual([]);
    });
  });

  describe('Ruby queries hit the right nodes', () => {
    it('captures instance, singleton, endless, one-line and top-level methods', () => {
      const byName = new Map(ruby.functions.map((f) => [f.name, f]));
      expect([...byName.keys()].sort()).toEqual([
        'build',
        'initialize',
        'render',
        'show',
        'title',
        'top_level',
      ]);
      expect(byName.get('initialize')?.startLine).toBe(8);
      expect(byName.get('initialize')?.endLine).toBe(10);
      expect(byName.get('initialize')?.parameters).toEqual(['label', 'size']);
      expect(byName.get('build')?.startLine).toBe(12);
      expect(byName.get('render')?.parameters).toEqual([]);
      expect(byName.get('top_level')?.startLine).toBe(28);
      expect(byName.get('top_level')?.endLine).toBe(33);
    });

    it('captures modules and classes, a scoped class under its last segment', () => {
      expect(ruby.classes.map((k) => `${k.name}@${k.startLine}`)).toEqual([
        'Shop@4',
        'Widget@5',
        'Panel@23',
      ]);
    });

    it('captures literal require and require_relative, not a computed require', () => {
      expect(ruby.imports).toEqual([
        { source: 'json' },
        { source: 'lib/helper' },
      ]);
    });

    it('does not take an interpolated or receiver-bound require for a file', async () => {
      const insights = await analyse(
        [
          `${REQUIRE} "lib/#{name}"`,
          `loader.${REQUIRE} 'lib/other'`,
          `${REQUIRE} 'lib/one', 'lib/two'`,
          '',
        ].join('\n'),
        'ruby',
        'loader.rb',
      );
      expect(insights.parseStatus).toBe('ok');
      expect(insights.imports).toEqual([]);
    });

    it('extracts no exports (publicSymbols is Batch 36)', () => {
      expect(ruby.exports ?? []).toEqual([]);
    });
  });

  describe('C++ queries hit the right nodes (.cpp)', () => {
    it('captures inline, out-of-line qualified, static, pointer-returning and overloaded definitions, not prototypes', () => {
      expect(
        cpp.functions.map((f) => `${f.name}@${f.startLine}-${f.endLine}`),
      ).toEqual([
        'Box@10-10',
        'get@11-11',
        'area@29-31',
        'helper@33-33',
        'label_of@35-37',
        'main@39-43',
        'scale@45-45',
        'scale@46-46',
      ]);
      expect(
        cpp.functions.find((f) => f.name === 'helper')?.parameters,
      ).toEqual(['int']);
    });

    it('captures class templates, structs and scoped enums', () => {
      expect(cpp.classes.map((k) => `${k.name}@${k.startLine}`)).toEqual([
        'Box@8',
        'Point@18',
        'Mode@23',
      ]);
    });

    it('captures local includes without quotes and system includes with their brackets', () => {
      expect(cpp.imports).toEqual([
        { source: 'widget.h' },
        { source: '<iostream>' },
      ]);
    });

    it('extracts no exports (publicSymbols is Batch 36)', () => {
      expect(cpp.exports ?? []).toEqual([]);
    });
  });

  describe('C through the C++ grammar (.c and .h, c:parsed-as-cpp)', () => {
    it('.c: functions, a typedef-named anonymous struct, a tagged struct and includes', () => {
      expect(c.functions.map((f) => `${f.name}@${f.startLine}`)).toEqual([
        'clamp@12',
        'widget_name@14',
      ]);
      expect(c.classes.map((k) => `${k.name}@${k.startLine}`)).toEqual([
        'Size@3',
        'widget@7',
      ]);
      expect(c.imports).toEqual([
        { source: 'widget.h' },
        { source: '<stdlib.h>' },
      ]);
    });

    it('.h: an inline definition and a typedef-named enum; a prototype and a forward declaration are not definitions', () => {
      expect(header.functions.map((f) => f.name)).toEqual(['widget_twice']);
      expect(header.classes.map((k) => `${k.name}@${k.startLine}`)).toEqual([
        'widget_kind@5',
      ]);
    });
  });

  // The store keys a row by (workspace root, subject) and overwrites on
  // conflict (memory-curator `code-symbol.store.ts`), so every declaration
  // needs its own subject (Batch 30 r1 R30-02). The sink keeps rows the same
  // way.
  describe('code index: rows never overwrite each other, and C is disclosed', () => {
    async function indexFiles(
      files: ReadonlyArray<readonly [string, string]>,
    ): Promise<{
      inserted: number;
      rows: Map<string, SymbolChunkInsert>;
      coverage: LanguageCoverage;
    }> {
      const root = '/ws-31-rows';
      const contents = new Map(
        files.map(([relativePath, source]) => [
          `${root}/${relativePath}`,
          source,
        ]),
      );
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
            for (const [relativePath] of files) {
              yield {
                path: `${root}/${relativePath}`,
                relativePath,
                type: 'source',
                size: 100,
              };
            }
          })(),
      } as unknown as WorkspaceIndexerService;
      const fileSystem = {
        readFile: async (p: string) => {
          const content = contents.get(p);
          if (content === undefined) throw new Error(`no such file: ${p}`);
          return content;
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
    // that share a name and a LINE are still distinct declarations; the
    // extractor keeps each (keyed by the name's position), so every one
    // reaches the unique-subject allocator and the store.
    it.each([
      [
        'Java overloads on one line',
        'src/A.java',
        'class A { void needle(int x) {} void needle(String x) {} }\n',
        ['class A', 'function needle', 'function needle'],
      ],
      [
        'a Rust struct and two impl blocks on one line',
        'src/foo.rs',
        'struct Foo; impl Foo { fn first() {} } impl Foo { fn second() {} }\n',
        [
          'class Foo',
          'class Foo',
          'class Foo',
          'function first',
          'function second',
        ],
      ],
      [
        'C++ functions of two namespaces on one line',
        'src/n.cpp',
        'namespace a { int needle(int x) {return x;} } namespace b { int needle(int x) {return x;} }\n',
        ['function needle', 'function needle'],
      ],
    ])(
      '%s: every declaration persists, with the expected cardinality',
      async (_label, relativePath, source, expected) => {
        const { inserted, rows, coverage } = await indexFiles([
          [relativePath, source],
        ]);
        expect(inserted).toBe(expected.length);
        expect(rows.size).toBe(expected.length);
        expect(
          [...rows.values()].map((row) => row.text.split(' in ')[0]).sort(),
        ).toEqual([...expected].sort());
        expect(coverage.analyzed).toBe(1);
      },
    );

    // Batch 31 r1 R31-02: valid definitions whose declarator a fixed query
    // shape could not read are indexed, not a clean empty answer.
    it.each([
      ['a parenthesised name', 'int (needle)(int x) { return x; }\n', ['int']],
      ['three pointers', 'int ***needle() { return nullptr; }\n', []],
      [
        'a returned function pointer',
        'int (*needle())(int) { return nullptr; }\n',
        [],
      ],
      [
        'a name qualified five scopes deep',
        'int a::b::c::d::e::needle(long v) { return 0; }\n',
        ['long'],
      ],
      [
        'a reference to a pointer',
        'int *&needle(int *p) { return p; }\n',
        ['int'],
      ],
    ])(
      'C++ definition with %s is indexed',
      async (_label, source, parameters) => {
        const insights = await analyse(source, 'cpp', 'needle.cpp');
        expect(insights.parseStatus).toBe('ok');
        expect(insights.functions).toEqual([
          { name: 'needle', parameters, startLine: 0, endLine: 0 },
        ]);
        expect(insights.unextractedDeclarations).toBeUndefined();
        const { rows, coverage } = await indexFiles([
          ['src/needle.cpp', source],
        ]);
        expect([...rows.values()].map((row) => row.symbolName)).toEqual([
          'needle',
        ]);
        expect(coverage.analyzed).toBe(1);
      },
    );

    it('C++: both overloads persist with their own spans; the .cpp answer carries no C approximation', async () => {
      const { inserted, rows, coverage } = await indexFiles([
        ['native/app.cpp', CPP_SOURCE],
      ]);
      expect(rows.size).toBe(inserted);
      const scale = [...rows.values()]
        .filter((row) => row.symbolName === 'scale')
        .map((row) => row.text.replace(/\\/g, '/'))
        .sort();
      expect(scale).toEqual([
        'function scale in native/app.cpp:45-45',
        'function scale in native/app.cpp:46-46',
      ]);
      expect(coverage.analyzed).toBe(1);
      expect(coverage.failed).toBe(0);
      expect(coverage.approximations).toBeUndefined();
    });

    it('PHP and Ruby: same-named methods of two classes and a reopened class all persist', async () => {
      const { inserted, rows } = await indexFiles([
        [
          'app/pair.php',
          '<?php\nclass A { function run() {} }\nclass B { function run() {} }\n',
        ],
        [
          'app/reopen.rb',
          'class Widget\n  def run; end\nend\nclass Widget\n  def run; end\nend\n',
        ],
      ]);
      expect(inserted).toBe(8);
      expect(rows.size).toBe(8);
    });

    it('.c and .h answers disclose c:parsed-as-cpp; C the grammar cannot parse is failed.parse, never analysed', async () => {
      const { coverage, rows } = await indexFiles([
        ['native/widget.c', C_SOURCE],
        ['native/widget.h', H_SOURCE],
        ['native/legacy.c', C_NOT_CPP_SOURCE],
      ]);
      expect(coverage.analyzed).toBe(2);
      expect(coverage.failed).toBe(1);
      expect(coverage.failedByReason).toEqual({ parse: 1 });
      expect(coverage.clean).toBe(false);
      expect(coverage.approximations).toEqual(['c:parsed-as-cpp']);
      expect([...rows.values()].map((row) => row.symbolName)).toEqual(
        expect.arrayContaining(['widget_name', 'Size', 'widget_twice']),
      );
    });

    it('a clean .h-only answer still names the approximation', async () => {
      const { coverage } = await indexFiles([['native/widget.h', H_SOURCE]]);
      expect(coverage.analyzed).toBe(1);
      expect(coverage.approximations).toEqual(['c:parsed-as-cpp']);
    });

    it.each([
      ['native/widget.c', C_SOURCE, ['c:parsed-as-cpp'], 'analyzed'],
      ['native/legacy.c', C_NOT_CPP_SOURCE, ['c:parsed-as-cpp'], 'failed'],
      ['native/app.cpp', CPP_SOURCE, undefined, 'analyzed'],
    ] as const)(
      'a single-file reindex of %s carries its own approximation',
      async (relativePath, source, approximations, bucket) => {
        const root = '/ws-31-single';
        const indexer = new CodeSymbolIndexer(
          silentLogger(),
          analysis,
          {
            indexWorkspaceStream: () => (async function* () {})(),
          } as unknown as WorkspaceIndexerService,
          { readFile: async () => source } as unknown as IFileSystemProvider,
          {
            deleteSymbolsForFile: () => 0,
            insertSymbols: async () => undefined,
          },
        );
        const { coverage } = await indexer.reindexFile(
          `${root}/${relativePath}`,
          root,
        );
        expect(coverage[bucket]).toBe(1);
        expect(coverage.approximations).toEqual(approximations);
      },
    );
  });

  describe('syntax diagnostics: C files name the grammar that judged them', () => {
    async function diagnose(
      files: ReadonlyArray<readonly [string, string]>,
    ): Promise<
      Awaited<ReturnType<LanguageAwareDiagnosticsProvider['getDiagnostics']>>
    > {
      const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'ptah-b31-diag-'));
      try {
        const absolute = files.map(([relativePath, content]) => {
          const full = nodePath.join(root, relativePath);
          fs.mkdirSync(nodePath.dirname(full), { recursive: true });
          fs.writeFileSync(full, content, 'utf-8');
          return full.replace(/\\/g, '/');
        });
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
        ).getDiagnostics(root, { files: absolute });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }

    it('valid C with a C++ keyword is a syntax error that says c:parsed-as-cpp, and the coverage discloses it', async () => {
      const result = await diagnose([['src/legacy.c', C_NOT_CPP_SOURCE]]);
      expect(result.status).toBe('available');
      if (result.status !== 'available') return;
      const messages = result.diagnostics.flatMap((entry) =>
        entry.diagnostics.map((d) => d.message),
      );
      expect(messages.length).toBeGreaterThan(0);
      for (const message of messages) {
        expect(message).toContain(
          '(cpp, c:parsed-as-cpp; syntax-only check, not type-checked)',
        );
      }
      expect(result.coverage?.approximations).toEqual(
        expect.arrayContaining(['cpp:syntax-only', 'c:parsed-as-cpp']),
      );
    });

    it('a .cpp file is not labelled as C (contrast)', async () => {
      const result = await diagnose([
        ['src/app.cpp', 'int broken( { int x = ; }\n'],
      ]);
      expect(result.status).toBe('available');
      if (result.status !== 'available') return;
      const messages = result.diagnostics.flatMap((entry) =>
        entry.diagnostics.map((d) => d.message),
      );
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.join('\n')).not.toContain('c:parsed-as-cpp');
      expect(result.coverage?.approximations).toEqual(['cpp:syntax-only']);
    });
  });

  // Batch 31 r1 R31-05: Ruby may omit the parameter parentheses.
  describe('Ruby parameters with and without parentheses', () => {
    it.each([
      ['def needle alpha, beta\n  alpha\nend\n', ['alpha', 'beta']],
      ['def needle(alpha, beta)\n  alpha\nend\n', ['alpha', 'beta']],
      ['def needle a, b\n  a\nend\n', ['a', 'b']],
      [
        'def needle a, *rest, key:, &blk\n  a\nend\n',
        ['a', '*rest', 'key', '&blk'],
      ],
      ['def self.needle alpha\n  alpha\nend\n', ['alpha']],
    ])('%j has parameters %j', async (source, parameters) => {
      const insights = await analyse(source, 'ruby', 'needle.rb');
      expect(insights.parseStatus).toBe('ok');
      expect(insights.functions.map((f) => f.parameters)).toEqual([parameters]);
    });
  });

  // Batch 31 r1 R31-02: a definition whose declarator names nothing the
  // walker can read is reported, and the index answer is not clean.
  describe('a C/C++ definition that cannot be named is disclosed', () => {
    it('cDeclaratorName names nothing for a chain that ends without a name', () => {
      const node = (
        type: string,
        text: string,
        children: GenericAstNode[] = [],
      ): GenericAstNode => ({
        type,
        text,
        isNamed: true,
        fieldName: null,
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: text.length },
        children,
      });
      expect(
        cDeclaratorName(
          node('function_declarator', '(*)(int)', [
            node('parenthesized_declarator', '(*)', [
              node('abstract_pointer_declarator', '*'),
            ]),
            node('parameter_list', '(int)'),
          ]),
        ),
      ).toBeUndefined();
      expect(
        cDeclaratorName(
          node('function_declarator', 'run(int x)', [
            node('identifier', 'run'),
            node('parameter_list', '(int x)'),
          ]),
        ),
      ).toEqual({
        name: 'run',
        parameters: expect.objectContaining({ text: '(int x)' }),
      });
    });

    it('the index counts such a file failed (unsupported-syntax), never analysed', async () => {
      const root = '/ws-31-unnamed';
      const indexer = new CodeSymbolIndexer(
        silentLogger(),
        {
          analyzeSource: async () =>
            Result.ok({
              parseStatus: 'ok',
              errorNodeCount: 0,
              errorNodeCountCapped: false,
              functions: [],
              classes: [],
              imports: [],
              unextractedDeclarations: ['line 1: MACRO_DEF(x)'],
            }),
        } as unknown as AstAnalysisService,
        {
          indexWorkspaceStream: () => (async function* () {})(),
        } as unknown as WorkspaceIndexerService,
        {
          readFile: async () => 'MACRO_DEF(x) {}\n',
        } as unknown as IFileSystemProvider,
        { deleteSymbolsForFile: () => 0, insertSymbols: async () => undefined },
      );
      const { coverage } = await indexer.reindexFile(`${root}/a.cpp`, root);
      expect(coverage.analyzed).toBe(0);
      expect(coverage.failed).toBe(1);
      expect(coverage.failedByReason).toEqual({ 'unsupported-syntax': 1 });
      expect(coverage.clean).toBe(false);
    });
  });
});
