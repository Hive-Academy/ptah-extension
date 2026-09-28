/**
 * Polyglot fixtures for the language-honesty harness (TASK_2026_559 Batch 27,
 * Task 27.1). Lane D's `fixture-workspace.ts` stays TS/JS-only and is not
 * edited here; this file adds the non-TS sets the honesty matrix (Batch 27
 * Task 27.2) and the dispatcher coverage spec (Task 27.3) exercise.
 *
 * All import/require-shaped strings are built by concatenation so lint's
 * import scanner and `validate-deps` never mistake fixture *content* for a
 * real edge out of this file (Batch 9 note, `fixture-workspace.ts:74`).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { KnownEdge } from './fixture-workspace';

/** `fr` + `om` — see the file-level note above. */
const FROM = 'fr' + 'om';
const REQUIRE = 'require';
const IMPORT = 'import';

/**
 * A known cross-file edge in a polyglot fixture. `granularity` says whether
 * the edge is only known at file resolution (`'file'` — e.g. a Python
 * `from . import x` or a Go package import, where the graph records the
 * module boundary) or down to the imported symbol (`'symbol'` — a TS/Java
 * named import). The honesty contract only asserts recall at the granularity
 * a language's extractor actually promises (Decision 18/19).
 */
export interface PolyglotKnownEdge extends KnownEdge {
  readonly granularity: 'file' | 'symbol';
}

export interface PolyglotFixtureFile {
  readonly path: string;
  readonly content: string;
}

export interface PolyglotFixturePlan {
  readonly files: readonly PolyglotFixtureFile[];
  readonly knownEdges: readonly PolyglotKnownEdge[];
}

export interface PolyglotFixture {
  readonly root: string;
  readonly knownEdges: readonly PolyglotKnownEdge[];
  readonly cleanup: () => void;
}

function toForwardSlash(p: string): string {
  return p.split(path.sep).join('/');
}

/** Writes a plan's files under a fresh mkdtemp root; returns root + cleanup. */
function materialize(plan: PolyglotFixturePlan): PolyglotFixture {
  const root = toForwardSlash(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-polyglot-fixture-')),
  );
  const createdDirs = new Set<string>();
  for (const file of plan.files) {
    const fullPath = path.join(root, ...file.path.split('/'));
    const dir = path.dirname(fullPath);
    if (!createdDirs.has(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      createdDirs.add(dir);
    }
    fs.writeFileSync(fullPath, file.content, 'utf8');
  }
  const knownEdges = plan.knownEdges.map((e) => ({
    ...e,
    fromPath: `${root}/${e.fromPath}`,
    toPath: `${root}/${e.toPath}`,
  }));
  return {
    root,
    knownEdges,
    cleanup: () => {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        // ignore — a leaked temp dir under os.tmpdir() is not a test failure
      }
    },
  };
}

// ---------------------------------------------------------------------------
// python-app: a small Python package with relative and absolute imports.
// ---------------------------------------------------------------------------

export function planPythonApp(): PolyglotFixturePlan {
  const files: PolyglotFixtureFile[] = [
    {
      path: 'app/__init__.py',
      content: '',
    },
    {
      path: 'app/models.py',
      content: [
        'class UserAccount:',
        '    def __init__(self, name):',
        '        self.name = name',
        '',
        'def load_default_account():',
        '    return UserAccount("default")',
        '',
      ].join('\n'),
    },
    {
      path: 'app/service.py',
      content: [
        `${FROM} . ${IMPORT} models`,
        `${FROM} .models ${IMPORT} UserAccount, load_default_account`,
        `${IMPORT} os`,
        '',
        'def bootstrap():',
        '    return load_default_account()',
        '',
      ].join('\n'),
    },
  ];
  const knownEdges: PolyglotKnownEdge[] = [
    {
      from: 'app/service.py',
      to: 'app/models.py',
      fromPath: 'app/service.py',
      toPath: 'app/models.py',
      importedSymbols: ['UserAccount', 'load_default_account'],
      granularity: 'file',
    },
  ];
  return { files, knownEdges };
}

// ---------------------------------------------------------------------------
// go-csharp: a Go package plus a C# project importing each other's siblings.
// ---------------------------------------------------------------------------

export function planGoCsharp(): PolyglotFixturePlan {
  const files: PolyglotFixtureFile[] = [
    {
      path: 'goapp/main.go',
      content: [
        'package main',
        '',
        `${IMPORT} (`,
        '\t"fmt"',
        '\t"goapp/widget"',
        ')',
        '',
        'func main() {',
        '\tfmt.Println(widget.Name())',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'goapp/widget/widget.go',
      content: [
        'package widget',
        '',
        'func Name() string {',
        '\treturn "widget"',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'csapp/Program.cs',
      content: [
        'using CsApp.Widgets;',
        '',
        'namespace CsApp',
        '{',
        '    public class Program',
        '    {',
        '        public static void Main()',
        '        {',
        '            var w = new Widget();',
        '        }',
        '    }',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'csapp/Widgets/Widget.cs',
      content: [
        'namespace CsApp.Widgets',
        '{',
        '    public class Widget { }',
        '}',
        '',
      ].join('\n'),
    },
  ];
  const knownEdges: PolyglotKnownEdge[] = [
    {
      from: 'goapp/main.go',
      to: 'goapp/widget/widget.go',
      fromPath: 'goapp/main.go',
      toPath: 'goapp/widget/widget.go',
      importedSymbols: ['Name'],
      granularity: 'file',
    },
    {
      from: 'csapp/Program.cs',
      to: 'csapp/Widgets/Widget.cs',
      fromPath: 'csapp/Program.cs',
      toPath: 'csapp/Widgets/Widget.cs',
      importedSymbols: ['Widget'],
      granularity: 'symbol',
    },
  ];
  return { files, knownEdges };
}

// ---------------------------------------------------------------------------
// java-rust: a Java package and a Rust crate with local module imports.
// ---------------------------------------------------------------------------

export function planJavaRust(): PolyglotFixturePlan {
  const files: PolyglotFixtureFile[] = [
    {
      path: 'javaapp/src/com/example/App.java',
      content: [
        'package com.example;',
        '',
        `${IMPORT} com.example.widget.Widget;`,
        '',
        'public class App {',
        '    public static void main(String[] args) {',
        '        Widget w = new Widget();',
        '    }',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'javaapp/src/com/example/widget/Widget.java',
      content: [
        'package com.example.widget;',
        '',
        'public class Widget { }',
        '',
      ].join('\n'),
    },
    {
      path: 'rustapp/src/main.rs',
      content: [
        'mod widget;',
        '',
        'fn main() {',
        '    widget::name();',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'rustapp/src/widget.rs',
      content: [
        "pub fn name() -> &'static str {",
        '    "widget"',
        '}',
        '',
      ].join('\n'),
    },
  ];
  const knownEdges: PolyglotKnownEdge[] = [
    {
      from: 'javaapp/src/com/example/App.java',
      to: 'javaapp/src/com/example/widget/Widget.java',
      fromPath: 'javaapp/src/com/example/App.java',
      toPath: 'javaapp/src/com/example/widget/Widget.java',
      importedSymbols: ['Widget'],
      granularity: 'symbol',
    },
    {
      from: 'rustapp/src/main.rs',
      to: 'rustapp/src/widget.rs',
      fromPath: 'rustapp/src/main.rs',
      toPath: 'rustapp/src/widget.rs',
      importedSymbols: ['name'],
      granularity: 'file',
    },
  ];
  return { files, knownEdges };
}

/** As {@link planJavaRust}, plus a Kotlin file for Batch 30k's vendored grammar. */
export function planJavaRustWithKotlin(): PolyglotFixturePlan {
  const base = planJavaRust();
  return {
    files: [
      ...base.files,
      {
        path: 'ktapp/src/Widget.kt',
        content: [
          'package ktapp',
          '',
          'class Widget {',
          '    fun name() = "widget"',
          '}',
          '',
        ].join('\n'),
      },
    ],
    knownEdges: base.knownEdges,
  };
}

// ---------------------------------------------------------------------------
// ts-python-monorepo: TS and Python side by side, each internally consistent.
// ---------------------------------------------------------------------------

export function planTsPythonMonorepo(): PolyglotFixturePlan {
  const files: PolyglotFixtureFile[] = [
    {
      path: 'ts-service/src/index.ts',
      content: [
        `${IMPORT} { helper } ${FROM} './helper';`,
        '',
        'export function run() {',
        '  return helper();',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'ts-service/src/helper.ts',
      content: ['export function helper() {', "  return 'help';", '}', ''].join(
        '\n',
      ),
    },
    {
      path: 'py-service/app.py',
      content: [
        `${FROM} .util ${IMPORT} greet`,
        '',
        'def run():',
        '    return greet()',
        '',
      ].join('\n'),
    },
    {
      path: 'py-service/util.py',
      content: ['def greet():', "    return 'hi'", ''].join('\n'),
    },
  ];
  const knownEdges: PolyglotKnownEdge[] = [
    {
      from: 'ts-service/src/index.ts',
      to: 'ts-service/src/helper.ts',
      fromPath: 'ts-service/src/index.ts',
      toPath: 'ts-service/src/helper.ts',
      importedSymbols: ['helper'],
      granularity: 'symbol',
    },
    {
      from: 'py-service/app.py',
      to: 'py-service/util.py',
      fromPath: 'py-service/app.py',
      toPath: 'py-service/util.py',
      importedSymbols: ['greet'],
      granularity: 'file',
    },
  ];
  return { files, knownEdges };
}

// ---------------------------------------------------------------------------
// no-grammar: languages with no installed tree-sitter grammar at all.
// ---------------------------------------------------------------------------

export function planNoGrammar(): PolyglotFixturePlan {
  const files: PolyglotFixtureFile[] = [
    {
      path: 'lib/greeter.ex',
      content: [
        'defmodule Greeter do',
        '  def hello(name), do: "Hello, #{name}"',
        'end',
        '',
      ].join('\n'),
    },
    {
      path: 'Sources/Greeter.swift',
      content: [
        'struct Greeter {',
        '    func hello(name: String) -> String {',
        '        return "Hello, \\(name)"',
        '    }',
        '}',
        '',
      ].join('\n'),
    },
  ];
  return { files, knownEdges: [] };
}

// ---------------------------------------------------------------------------
// php-ruby-cpp: real C/C++ that #include each other, plus PHP and Ruby.
// ---------------------------------------------------------------------------

export function planPhpRubyCpp(): PolyglotFixturePlan {
  const files: PolyglotFixtureFile[] = [
    {
      path: 'native/widget.h',
      content: [
        '#ifndef WIDGET_H',
        '#define WIDGET_H',
        '',
        'int widget_name(void);',
        '',
        '#endif',
        '',
      ].join('\n'),
    },
    {
      path: 'native/widget.c',
      content: [
        '#include "widget.h"',
        '',
        'int widget_name(void) {',
        '    return 1;',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'native/app.cpp',
      content: [
        '#include "widget.h"',
        '#include <iostream>',
        '',
        'int main() {',
        '    std::cout << widget_name() << std::endl;',
        '    return 0;',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'app/Widget.php',
      content: [
        '<?php',
        `${REQUIRE}('helper.php');`,
        '',
        'class Widget {',
        '    public function name() {',
        '        return helper_name();',
        '    }',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'app/helper.php',
      content: [
        '<?php',
        '',
        'function helper_name() {',
        "    return 'widget';",
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'app/widget.rb',
      content: [
        `${REQUIRE} 'helper'`,
        '',
        'class Widget',
        '  def name',
        '    helper_name',
        '  end',
        'end',
        '',
      ].join('\n'),
    },
    {
      path: 'app/helper.rb',
      content: ['def helper_name', "  'widget'", 'end', ''].join('\n'),
    },
  ];
  const knownEdges: PolyglotKnownEdge[] = [
    {
      from: 'native/widget.c',
      to: 'native/widget.h',
      fromPath: 'native/widget.c',
      toPath: 'native/widget.h',
      importedSymbols: ['widget_name'],
      granularity: 'file',
    },
    {
      from: 'native/app.cpp',
      to: 'native/widget.h',
      fromPath: 'native/app.cpp',
      toPath: 'native/widget.h',
      importedSymbols: ['widget_name'],
      granularity: 'file',
    },
    {
      from: 'app/Widget.php',
      to: 'app/helper.php',
      fromPath: 'app/Widget.php',
      toPath: 'app/helper.php',
      importedSymbols: ['helper_name'],
      granularity: 'file',
    },
    {
      from: 'app/widget.rb',
      to: 'app/helper.rb',
      fromPath: 'app/widget.rb',
      toPath: 'app/helper.rb',
      importedSymbols: ['helper_name'],
      granularity: 'file',
    },
  ];
  return { files, knownEdges };
}

// ---------------------------------------------------------------------------
// Bounds fixtures — namespace/manifest/vendor/build-supersession edges the
// coverage/census accounting must disclose rather than silently drop.
//
// Deviation (documented in the Batch 27 executor report): the plan's literal
// "300-file namespace" and "80 manifests" are generated at their literal
// counts (cheap: string generation, no parsing), but "vendor tree beyond the
// census limit" uses a small multiple of a documented small limit parameter
// rather than the production ~2,000-file cap, so the harness stays fast. Pass
// a larger `limit` to exercise the real production constant directly against
// this same fixture shape.
// ---------------------------------------------------------------------------

/** A flat namespace of `count` trivial TS files (default 300, per the plan). */
export function planFlatNamespace(count = 300): PolyglotFixturePlan {
  const files: PolyglotFixtureFile[] = [];
  for (let i = 0; i < count; i++) {
    files.push({
      path: `flat/file${i}.ts`,
      content: `export const value${i} = ${i};\n`,
    });
  }
  return { files, knownEdges: [] };
}

/** `count` package manifests (default 80, per the plan). */
export function planManifests(count = 80): PolyglotFixturePlan {
  const files: PolyglotFixtureFile[] = [];
  for (let i = 0; i < count; i++) {
    files.push({
      path: `packages/pkg${i}/package.json`,
      content:
        JSON.stringify({ name: `pkg${i}`, version: '1.0.0' }, null, 2) + '\n',
    });
  }
  return { files, knownEdges: [] };
}

/**
 * A `vendor/` tree with `beyondLimit` files past a caller-supplied `limit`,
 * plus one real source file outside `vendor/`. Exercises "the cap does not
 * starve the second [directory]" — the real source file must still be
 * discovered even when the vendor tree alone exceeds `limit`.
 */
export function planVendorTreeBeyondCensusLimit(
  limit: number,
  beyondLimit = 5,
): PolyglotFixturePlan {
  const files: PolyglotFixtureFile[] = [];
  const vendorCount = limit + beyondLimit;
  for (let i = 0; i < vendorCount; i++) {
    files.push({
      path: `vendor/dep${i}/index.js`,
      content: `module.exports.value = ${i};\n`,
    });
  }
  files.push({
    path: 'src/real.ts',
    content: 'export const real = true;\n',
  });
  return { files, knownEdges: [] };
}

/**
 * Two builds of the same module under different roots: `outdated` should
 * never be reported once `current` has run — a superseded-run publish must
 * not resurrect stale coverage (23a "atomic publish" contract).
 */
export function planSupersededBuild(): {
  readonly outdated: PolyglotFixturePlan;
  readonly current: PolyglotFixturePlan;
} {
  const outdated: PolyglotFixturePlan = {
    files: [{ path: 'src/app.py', content: 'def old():\n    return 1\n' }],
    knownEdges: [],
  };
  const current: PolyglotFixturePlan = {
    files: [{ path: 'src/app.py', content: 'def new():\n    return 2\n' }],
    knownEdges: [],
  };
  return { outdated, current };
}

// ---------------------------------------------------------------------------
// Public factory functions — plan + materialize to a real mkdtemp root.
// ---------------------------------------------------------------------------

export function createPythonAppFixture(): PolyglotFixture {
  return materialize(planPythonApp());
}
export function createGoCsharpFixture(): PolyglotFixture {
  return materialize(planGoCsharp());
}
export function createJavaRustFixture(withKotlin = false): PolyglotFixture {
  return materialize(withKotlin ? planJavaRustWithKotlin() : planJavaRust());
}
export function createTsPythonMonorepoFixture(): PolyglotFixture {
  return materialize(planTsPythonMonorepo());
}
export function createNoGrammarFixture(): PolyglotFixture {
  return materialize(planNoGrammar());
}
export function createPhpRubyCppFixture(): PolyglotFixture {
  return materialize(planPhpRubyCpp());
}
export function createFlatNamespaceFixture(count = 300): PolyglotFixture {
  return materialize(planFlatNamespace(count));
}
export function createManifestsFixture(count = 80): PolyglotFixture {
  return materialize(planManifests(count));
}
export function createVendorTreeBeyondCensusLimitFixture(
  limit: number,
  beyondLimit = 5,
): PolyglotFixture {
  return materialize(planVendorTreeBeyondCensusLimit(limit, beyondLimit));
}
