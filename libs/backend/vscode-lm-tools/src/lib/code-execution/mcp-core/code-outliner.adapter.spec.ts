/**
 * `TreeSitterCodeOutliner` against the REAL `TreeSitterParserService` and the
 * real grammars (TASK_2026_559 Batch 2d).
 *
 * The lib-wide `wasm-bundle-dir` mock (jest.config.ts) throws, because other
 * specs here must never reach tree-sitter. This spec is the exception the
 * batch asks for: a query naming a node or field the grammar lacks fails at
 * `queryMulti`, which the adapter turns into `null`, so only the real grammar
 * proves the outline queries. The two shims mirror
 * `workspace-intelligence/src/ast/csharp-grammar.integration.spec.ts`:
 *  - `wasm-bundle-dir` resolves to the files `scripts/copy-wasm.js` copies
 *    (grammars from @vscode/tree-sitter-wasm, runtime from web-tree-sitter);
 *  - `Language.load(path)` in the CJS build of web-tree-sitter uses a dynamic
 *    `import('fs/promises')` that Jest's VM rejects, so the file is read here
 *    and handed over as bytes.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import { TreeSitterParserService } from '@ptah-extension/workspace-intelligence';
import {
  countTokens,
  createCodeReducer,
  type CodeLineSpan,
} from '@ptah-extension/tool-output-reducers';
import { TreeSitterCodeOutliner } from './code-outliner.adapter';

jest.mock('wasm-bundle-dir', () => {
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

const NOTE = /^… (\d+) lines? omitted …$/;

function silentLogger(): Logger {
  return {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    dispose: jest.fn(),
  } as unknown as Logger;
}

const lines = (...rows: string[]): string => `${rows.join('\n')}\n`;

function sorted(spans: readonly CodeLineSpan[]): CodeLineSpan[] {
  return [...spans].sort(
    (a, b) => a.startLine - b.startLine || a.endLine - b.endLine,
  );
}

/** Token count summed line by line (never one encode over a large text). */
function lineTokens(text: string): number {
  return text.split('\n').reduce((sum, line) => sum + countTokens(line) + 1, 0);
}

/**
 * Every output line is the next input line verbatim or a note skipping
 * exactly N input lines; together they account for every input line once.
 */
function expectReconstructs(output: string, input: string): void {
  const source = input.split('\n');
  let cursor = 0;
  for (const line of output.split('\n')) {
    const note = NOTE.exec(line);
    if (note) {
      cursor += Number(note[1]);
      continue;
    }
    if (source[cursor] !== line) {
      throw new Error(
        `output line ${JSON.stringify(line)} is not input line ${cursor}`,
      );
    }
    cursor++;
  }
  expect(cursor).toBe(source.length);
}

const TS_SOURCE = lines(
  "import x from 'y';", // 0
  '@dec()', // 1
  'export class A<T> extends B implements C {', // 2
  '  private f = 1;', // 3
  '  constructor(a: T) {', // 4
  '    super();', // 5
  '  }', // 6
  '  m(', // 7
  '    a: number,', // 8
  '  ): void {', // 9
  '    const z = () => {', // 10
  '      a++;', // 11
  '    };', // 12
  '  }', // 13
  '}', // 14
  'export function foo(a) {', // 15
  '  return a;', // 16
  '}', // 17
  'export const bar = async (x: number) => ({', // 18
  '  x,', // 19
  '});', // 20
  'const baz = function* () {', // 21
  '  yield 1;', // 22
  '};', // 23
  'interface I { a: number }', // 24
  'abstract class Q { abstract h(): void; }', // 25
);

const JS_SOURCE = lines(
  'class A {', // 0
  '  f = 2;', // 1
  '  m() {', // 2
  '    return 1;', // 3
  '  }', // 4
  '}', // 5
  'function f() {', // 6
  '  x();', // 7
  '}', // 8
  'const g = function () {', // 9
  '  y();', // 10
  '};', // 11
);

const PY_SOURCE = lines(
  'import os', // 0
  '', // 1
  '@dec', // 2
  'class A(B):', // 3
  '    """doc"""', // 4
  '    def m(self, a):', // 5
  '        return a', // 6
  '', // 7
  'async def f(', // 8
  '    x) -> int:  x = 1', // 9: body on the header's last row stays
  '', // 10
  'def g():', // 11
  '    y = 1', // 12
  '    return y', // 13
);

const GO_SOURCE = lines(
  'package main', // 0
  '', // 1
  'import "fmt"', // 2
  '', // 3
  'type S struct {', // 4
  '  A int', // 5
  '}', // 6
  '', // 7
  'func (s *S) M(a int) int {', // 8
  '  return a', // 9
  '}', // 10
  '', // 11
  'func F() {', // 12
  '  fmt.Println(1)', // 13
  '  g := func() {', // 14
  '    x()', // 15
  '  }', // 16
  '}', // 17
);

const CS_SOURCE = lines(
  'using System;', // 0
  'namespace N {', // 1
  '  public class C {', // 2
  '    public C(int a) {', // 3
  '      A = a;', // 4
  '    }', // 5
  '    public int A { get; set; }', // 6
  '    public int P {', // 7
  '      get { return 1; }', // 8
  '    }', // 9
  '    public void M(int x) {', // 10
  '      void L() {', // 11
  '        x++;', // 12
  '      }', // 13
  '      Func<int> f = () => { return 1; };', // 14
  '    }', // 15
  '    ~C() { }', // 16
  '  }', // 17
  '}', // 18
);

const TSX_SOURCE = lines(
  'export interface Props {', // 0
  '  title: string;', // 1
  '  count: number;', // 2
  '}', // 3
  '', // 4
  'export function Badge(props: Props) {', // 5
  '  const text = `${props.title}: ${props.count}`;', // 6
  '  return <span className="badge">{text}</span>;', // 7
  '}', // 8
  'export const Card = ({ title }: Props) => {', // 9
  '  return (', // 10
  '    <>', // 11
  '      <h2>{title}</h2>', // 12
  '      <hr />', // 13
  '    </>', // 14
  '  );', // 15
  '};', // 16
  'export class Legacy {', // 17
  '  render() {', // 18
  '    return <div>{this.label}</div>;', // 19
  '  }', // 20
  '  label = "x";', // 21
  '}', // 22
);

const JAVA_SOURCE = lines(
  'package com.example;', // 0
  '', // 1
  'public class Store {', // 2
  '  private int count;', // 3
  '  public Store(int count) {', // 4
  '    this.count = count;', // 5
  '  }', // 6
  '  public int next() {', // 7
  '    Runnable r = () -> {', // 8
  '      count++;', // 9
  '    };', // 10
  '    return count;', // 11
  '  }', // 12
  '  record Point(int x) {', // 13
  '    Point {', // 14
  '      check(x);', // 15
  '    }', // 16
  '  }', // 17
  '  enum Mode { ON, OFF }', // 18
  '  void empty() { }', // 19
  '}', // 20
);

const RUST_SOURCE = lines(
  'mod parser;', // 0
  '', // 1
  'pub struct Store {', // 2
  '    count: u32,', // 3
  '}', // 4
  '', // 5
  'impl Store {', // 6
  '    pub fn next(&mut self) -> u32 {', // 7
  '        let bump = |n: u32| {', // 8
  '            n + 1', // 9
  '        };', // 10
  '        bump(self.count)', // 11
  '    }', // 12
  '}', // 13
  '', // 14
  'pub trait Named {', // 15
  '    fn name(&self) -> String;', // 16
  '}', // 17
  'fn empty() {}', // 18
);

/**
 * A 300+-line TypeScript module: an interface, a type, twelve exported metric
 * functions, an exported service class and an exported arrow formatter.
 */
function serviceModule(): {
  source: string;
  exported: string[];
  focusBlock: string;
} {
  const out: string[] = [
    "import { readFile } from 'node:fs/promises';",
    "import * as path from 'node:path';",
    '',
    'export interface Order {',
    '  id: string;',
    '  total: number;',
    '  items: string[];',
    '}',
    '',
    'export type OrderId = string;',
    '',
  ];
  const exported = ['Order', 'OrderId'];
  for (let i = 0; i < 12; i++) {
    const name = `computeMetric${i}`;
    exported.push(name);
    out.push(
      `/** Metric ${i}: a weighted sum over the orders. */`,
      `export function ${name}(orders: Order[], factor = ${i + 1}): number {`,
    );
    for (let k = 0; k < 12; k++) {
      out.push(
        `  const step${k} = orders.reduce((sum, order) => sum + order.total * ${k + 1}, 0) / factor;`,
      );
    }
    out.push('  return step0 + step11;', '}', '');
  }
  exported.push('OrderService');
  out.push(
    'export class OrderService {',
    '  private readonly cache = new Map<string, Order>();',
    '',
  );
  let focusBlock = '';
  for (const method of ['load', 'save', 'applyDiscount', 'refund', 'audit']) {
    const block = [
      `  async ${method}(id: OrderId, rate = 0.1): Promise<Order | undefined> {`,
      '    const cached = this.cache.get(id);',
      '    if (cached === undefined) {',
      `      const raw = await readFile(path.join('orders', id + '.json'), 'utf8');`,
      '      this.cache.set(id, JSON.parse(raw) as Order);',
      '    }',
      '    const order = this.cache.get(id);',
      '    if (order !== undefined) {',
      `      order.total = order.total * (1 - rate); // ${method}`,
      '    }',
      '    return order;',
      '  }',
    ];
    if (method === 'applyDiscount') {
      focusBlock = block.join('\n');
    }
    out.push(...block, '');
  }
  out.push('}', '');
  exported.push('formatOrder');
  out.push('export const formatOrder = (order: Order): string => {');
  for (let k = 0; k < 20; k++) {
    out.push(
      `  const part${k} = String(order.items[${k}] ?? '').padStart(${k + 2});`,
    );
  }
  out.push("  return [order.id, part0, part19].join(' ');", '};', '');
  return { source: out.join('\n'), exported, focusBlock };
}

describe('TreeSitterCodeOutliner (real TreeSitterParserService)', () => {
  let parser: TreeSitterParserService;
  let outliner: TreeSitterCodeOutliner;

  beforeAll(async () => {
    parser = new TreeSitterParserService(silentLogger());
    const init = await parser.initialize();
    if (init.isErr()) {
      throw init.error ?? new Error('tree-sitter initialisation failed');
    }
    outliner = new TreeSitterCodeOutliner(parser);
  });

  afterAll(() => {
    parser?.dispose();
  });

  describe('outline queries compile and hit the right nodes in every grammar', () => {
    it('typescript: body interiors, focus on a method and on an arrow const', async () => {
      const outline = await outliner.outline(TS_SOURCE, 'typescript', 'm');
      expect(outline).not.toBeNull();
      expect(sorted(outline?.omittable ?? [])).toEqual([
        { startLine: 5, endLine: 5 },
        { startLine: 10, endLine: 12 },
        { startLine: 11, endLine: 11 },
        { startLine: 16, endLine: 16 },
        { startLine: 19, endLine: 19 },
        { startLine: 22, endLine: 22 },
      ]);
      expect(outline?.focus).toEqual([{ startLine: 7, endLine: 13 }]);

      const bar = await outliner.outline(TS_SOURCE, '.ts', 'bar');
      expect(bar?.focus).toEqual([{ startLine: 18, endLine: 20 }]);
      const abstract = await outliner.outline(TS_SOURCE, 'ts', 'h');
      expect(abstract?.focus).toEqual([{ startLine: 25, endLine: 25 }]);
    });

    it('javascript: every declaration with the focus name is reported', async () => {
      const outline = await outliner.outline(JS_SOURCE, 'javascript', 'f');
      expect(sorted(outline?.omittable ?? [])).toEqual([
        { startLine: 3, endLine: 3 },
        { startLine: 7, endLine: 7 },
        { startLine: 10, endLine: 10 },
      ]);
      expect(sorted(outline?.focus ?? [])).toEqual([
        { startLine: 1, endLine: 1 },
        { startLine: 6, endLine: 8 },
      ]);
    });

    it('python: a block runs from the row after the header colon to its last row', async () => {
      const outline = await outliner.outline(PY_SOURCE, 'python', 'A');
      expect(sorted(outline?.omittable ?? [])).toEqual([
        { startLine: 6, endLine: 6 },
        { startLine: 12, endLine: 13 },
      ]);
      expect(outline?.focus).toEqual([{ startLine: 3, endLine: 6 }]);
    });

    it('go: function, method and func-literal bodies; focus on a type', async () => {
      const outline = await outliner.outline(GO_SOURCE, '.go', 'S');
      expect(sorted(outline?.omittable ?? [])).toEqual([
        { startLine: 9, endLine: 9 },
        { startLine: 13, endLine: 16 },
        { startLine: 15, endLine: 15 },
      ]);
      expect(outline?.focus).toEqual([{ startLine: 4, endLine: 6 }]);
    });

    it('csharp: member and local-function bodies; one-row bodies give no span', async () => {
      const outline = await outliner.outline(CS_SOURCE, 'csharp', 'C');
      expect(sorted(outline?.omittable ?? [])).toEqual([
        { startLine: 4, endLine: 4 },
        { startLine: 11, endLine: 14 },
        { startLine: 12, endLine: 12 },
      ]);
      expect(sorted(outline?.focus ?? [])).toEqual([
        { startLine: 2, endLine: 17 },
        { startLine: 3, endLine: 5 },
      ]);
    });

    it('tsx outline not refused: JSX components get body spans and focus (Batch 29b)', async () => {
      for (const hint of ['.tsx', 'tsx', 'src/App.tsx']) {
        const outline = await outliner.outline(TSX_SOURCE, hint, 'Card');
        expect({ hint, refused: outline === null }).toEqual({
          hint,
          refused: false,
        });
        expect(sorted(outline?.omittable ?? [])).toEqual([
          { startLine: 6, endLine: 7 },
          { startLine: 10, endLine: 15 },
          { startLine: 19, endLine: 19 },
        ]);
        expect(outline?.focus).toEqual([{ startLine: 9, endLine: 16 }]);
      }
      const props = await outliner.outline(TSX_SOURCE, '.tsx', 'Props');
      expect(props?.focus).toEqual([{ startLine: 0, endLine: 3 }]);
    });

    it('java outline not refused: method, constructor, lambda and compact-constructor bodies; focus on types and members (Batch 30)', async () => {
      for (const hint of ['.java', 'java', 'src/com/example/Store.java']) {
        const outline = await outliner.outline(JAVA_SOURCE, hint, 'Store');
        expect({ hint, refused: outline === null }).toEqual({
          hint,
          refused: false,
        });
        expect(sorted(outline?.omittable ?? [])).toEqual([
          { startLine: 5, endLine: 5 },
          { startLine: 8, endLine: 11 },
          { startLine: 9, endLine: 9 },
          { startLine: 15, endLine: 15 },
        ]);
        // The class and its constructor share the name.
        expect(sorted(outline?.focus ?? [])).toEqual([
          { startLine: 2, endLine: 20 },
          { startLine: 4, endLine: 6 },
        ]);
      }
      const point = await outliner.outline(JAVA_SOURCE, 'java', 'Point');
      expect(sorted(point?.focus ?? [])).toEqual([
        { startLine: 13, endLine: 17 },
        { startLine: 14, endLine: 16 },
      ]);
      const count = await outliner.outline(JAVA_SOURCE, 'java', 'count');
      expect(count?.focus).toEqual([{ startLine: 3, endLine: 3 }]);
      const mode = await outliner.outline(JAVA_SOURCE, 'java', 'Mode');
      expect(mode?.focus).toEqual([{ startLine: 18, endLine: 18 }]);
    });

    it('rust outline not refused: fn and closure bodies; focus finds a struct and its impl block (Batch 30)', async () => {
      for (const hint of ['.rs', 'rs', 'rust', 'src/store.rs']) {
        const outline = await outliner.outline(RUST_SOURCE, hint, 'Store');
        expect({ hint, refused: outline === null }).toEqual({
          hint,
          refused: false,
        });
        expect(sorted(outline?.omittable ?? [])).toEqual([
          { startLine: 8, endLine: 11 },
          { startLine: 9, endLine: 9 },
        ]);
        expect(sorted(outline?.focus ?? [])).toEqual([
          { startLine: 2, endLine: 4 },
          { startLine: 6, endLine: 13 },
        ]);
      }
      const name = await outliner.outline(RUST_SOURCE, 'rust', 'name');
      expect(name?.focus).toEqual([{ startLine: 16, endLine: 16 }]);
      const parserModule = await outliner.outline(
        RUST_SOURCE,
        'rust',
        'parser',
      );
      expect(parserModule?.focus).toEqual([{ startLine: 0, endLine: 0 }]);
    });

    it('rust focus keeps qualified, generic-qualified and referenced impl blocks of the type (Batch 30 r1 R30-04)', async () => {
      const source = lines(
        'mod nested {', // 0
        '    pub struct Foo;', // 1
        '}', // 2
        'impl nested::Foo {', // 3
        '    fn method(&self) {', // 4
        '        let x = 1;', // 5
        '    }', // 6
        '}', // 7
        'impl fmt::Display for Foo {', // 8
        '    fn fmt(&self) {}', // 9
        '}', // 10
        'impl<T> Tr for path::Foo<T> {', // 11
        '    fn a(&self) {}', // 12
        '}', // 13
        'impl Bar for &Foo {', // 14
        '    fn b(&self) {}', // 15
        '}', // 16
      );
      const outline = await outliner.outline(source, 'rust', 'Foo');
      expect(sorted(outline?.focus ?? [])).toEqual([
        { startLine: 1, endLine: 1 },
        { startLine: 3, endLine: 7 },
        { startLine: 8, endLine: 10 },
        { startLine: 11, endLine: 13 },
        { startLine: 14, endLine: 16 },
      ]);
    });

    it('php outline not refused, HTML around <?php included: method, function and closure bodies; focus on a class and a property (Batch 31)', async () => {
      const source = lines(
        '<h1><?= $title ?></h1>', // 0
        '<?php', // 1
        'class Store', // 2
        '{', // 3
        '    private $items = [];', // 4
        '', // 5
        '    public function add($item)', // 6
        '    {', // 7
        '        $this->items[] = $item;', // 8
        '        return $this;', // 9
        '    }', // 10
        '', // 11
        '    public function total(): int {', // 12
        '        return array_sum(array_map(fn($i) => $i->price, $this->items));', // 13
        '    }', // 14
        '}', // 15
        '', // 16
        'function report(Store $store)', // 17
        '{', // 18
        '    $format = function ($n) {', // 19
        '        return number_format($n);', // 20
        '    };', // 21
        '    return $format($store->total());', // 22
        '}', // 23
        '?>', // 24
        '<p>done</p>', // 25
      );
      for (const hint of ['.php', 'php', '.phtml', 'views/store.phtml']) {
        const outline = await outliner.outline(source, hint, 'Store');
        expect({ hint, refused: outline === null }).toEqual({
          hint,
          refused: false,
        });
        expect(sorted(outline?.omittable ?? [])).toEqual([
          { startLine: 8, endLine: 9 },
          { startLine: 13, endLine: 13 },
          { startLine: 19, endLine: 22 },
          { startLine: 20, endLine: 20 },
        ]);
        expect(outline?.focus).toEqual([{ startLine: 2, endLine: 15 }]);
      }
      const items = await outliner.outline(source, 'php', 'items');
      expect(items?.focus).toEqual([{ startLine: 4, endLine: 4 }]);
    });

    it('ruby outline not refused: a method body stops before its `end` (also when a block `end` shares it); top-level blocks and one-line methods stay (Batch 31)', async () => {
      const source = lines(
        'module Shop', // 0
        '  class Store', // 1
        '    def initialize(items)', // 2
        '      @items = items', // 3
        '      @count = items.size', // 4
        '    end', // 5
        '', // 6
        '    def self.build(*args,', // 7
        '                   **opts)', // 8
        '      new(args)', // 9
        '    end', // 10
        '', // 11
        '    def total; @items.sum; end', // 12
        '', // 13
        '    def names', // 14
        '      @items.map do |i|', // 15
        '        i.name', // 16
        '      end end', // 17
        '  end', // 18
        '', // 19
        '  class Admin::Store', // 20
        '  end', // 21
        'end', // 22
        'Tally = Struct.new(:n) do', // 23
        '  def up', // 24
        '    n + 1', // 25
        '  end', // 26
        'end', // 27
      );
      for (const hint of ['.rb', 'rb', 'ruby', '.rake', 'lib/store.rb']) {
        const outline = await outliner.outline(source, hint, 'Store');
        expect({ hint, refused: outline === null }).toEqual({
          hint,
          refused: false,
        });
        expect(sorted(outline?.omittable ?? [])).toEqual([
          { startLine: 3, endLine: 4 },
          { startLine: 9, endLine: 9 },
          { startLine: 15, endLine: 16 },
          { startLine: 25, endLine: 25 },
        ]);
        expect(sorted(outline?.focus ?? [])).toEqual([
          { startLine: 1, endLine: 18 },
          { startLine: 20, endLine: 21 },
        ]);
      }
      const tally = await outliner.outline(source, 'ruby', 'Tally');
      expect(tally?.focus).toEqual([{ startLine: 23, endLine: 27 }]);
      const build = await outliner.outline(source, 'ruby', 'build');
      expect(build?.focus).toEqual([{ startLine: 7, endLine: 10 }]);
    });

    it('cpp outline not refused on .cpp: member, out-of-line qualified and lambda bodies; focus finds a prototype with its definition, a class, a namespace and a macro (Batch 31)', async () => {
      const source = lines(
        '#include "store.h"', // 0
        '#define TWICE(x) ((x) * 2)', // 1
        'namespace shop {', // 2
        'class Store {', // 3
        ' public:', // 4
        '  int total() const {', // 5
        '    int sum = 0;', // 6
        '    return sum;', // 7
        '  }', // 8
        '  int count() const;', // 9
        '};', // 10
        'int Store::count() const {', // 11
        '  auto add = [](int a, int b) {', // 12
        '    return a + b;', // 13
        '  };', // 14
        '  return add(1, 2);', // 15
        '}', // 16
        '}  // namespace shop', // 17
      );
      for (const hint of ['.cpp', 'cpp', '.cc', '.hpp', 'src/store.cxx']) {
        const outline = await outliner.outline(source, hint, 'count');
        expect({ hint, refused: outline === null }).toEqual({
          hint,
          refused: false,
        });
        expect(sorted(outline?.omittable ?? [])).toEqual([
          { startLine: 6, endLine: 7 },
          { startLine: 12, endLine: 15 },
          { startLine: 13, endLine: 13 },
        ]);
        expect(sorted(outline?.focus ?? [])).toEqual([
          { startLine: 9, endLine: 9 },
          { startLine: 11, endLine: 16 },
        ]);
      }
      const store = await outliner.outline(source, 'cpp', 'Store');
      expect(store?.focus).toEqual([{ startLine: 3, endLine: 10 }]);
      // Batch 31 r1 R31-02: declarators no fixed query shape reads.
      const shapes = lines(
        'int (needle)(int x) {', // 0
        '  return x;', // 1
        '}', // 2
        'int ***needle() {', // 3
        '  return nullptr;', // 4
        '}', // 5
        'int (*needle(long v))(int) {', // 6
        '  return nullptr;', // 7
        '}', // 8
        'int a::b::c::d::e::needle(long v) {', // 9
        '  return 0;', // 10
        '}', // 11
      );
      const needle = await outliner.outline(shapes, 'cpp', 'needle');
      expect(sorted(needle?.focus ?? [])).toEqual([
        { startLine: 0, endLine: 2 },
        { startLine: 3, endLine: 5 },
        { startLine: 6, endLine: 8 },
        { startLine: 9, endLine: 11 },
      ]);
      const shop = await outliner.outline(source, 'cpp', 'shop');
      expect(shop?.focus).toEqual([{ startLine: 2, endLine: 17 }]);
      const twice = await outliner.outline(source, 'cpp', 'TWICE');
      expect(twice?.focus).toEqual([{ startLine: 1, endLine: 1 }]);
    });

    it('cpp outline on real .c and .h files (C parsed with the C++ grammar); C the grammar rejects is refused (Batch 31)', async () => {
      const c = lines(
        '#include <stdio.h>', // 0
        'typedef struct {', // 1
        '    int total;', // 2
        '} Counter;', // 3
        'static int counter_next(Counter *c,', // 4
        '                        int step) {', // 5
        '    c->total += step;', // 6
        '    return c->total;', // 7
        '}', // 8
      );
      const cOutline = await outliner.outline(c, '.c', 'counter_next');
      expect(cOutline?.omittable).toEqual([{ startLine: 6, endLine: 7 }]);
      // Batch 31 r1 R31-01: a C outline names the grammar it was read with.
      expect(cOutline?.approximations).toEqual(['c:parsed-as-cpp']);
      for (const hint of ['c', '.H', 'src/counter.c']) {
        expect((await outliner.outline(c, hint))?.approximations).toEqual([
          'c:parsed-as-cpp',
        ]);
      }
      for (const hint of ['cpp', '.hpp', 'src/counter.cc']) {
        expect(
          (await outliner.outline(c, hint))?.approximations,
        ).toBeUndefined();
      }
      expect(cOutline?.focus).toEqual([{ startLine: 4, endLine: 8 }]);
      const counter = await outliner.outline(c, 'src/counter.c', 'Counter');
      expect(counter?.focus).toEqual([{ startLine: 1, endLine: 3 }]);

      const h = lines(
        '#ifndef COUNTER_H', // 0
        '#define COUNTER_H', // 1
        'int counter_next(int step);', // 2
        'static inline int counter_twice(int v) {', // 3
        '    int doubled = v * 2;', // 4
        '    return doubled;', // 5
        '}', // 6
        '#endif', // 7
      );
      const hOutline = await outliner.outline(h, '.h', 'counter_next');
      expect(hOutline?.omittable).toEqual([{ startLine: 4, endLine: 5 }]);
      expect(hOutline?.focus).toEqual([{ startLine: 2, endLine: 2 }]);

      // Valid C, but `new` is a C++ keyword: refused, never guessed.
      const notCpp = lines(
        'int make(void) {',
        '    int *new = 0;',
        '    return new == 0;',
        '}',
      );
      await expect(outliner.outline(notCpp, '.c')).resolves.toBeNull();
    });

    it('reports no focus spans when no focus symbol is requested', async () => {
      const outline = await outliner.outline(TS_SOURCE, 'typescript');
      expect(outline?.focus).toEqual([]);
      expect(outline?.omittable.length).toBeGreaterThan(0);
    });
  });

  // Batch 24d: the outline's own declaration queries are separate from the
  // export query, so check them for the same export kinds. An export line is
  // never inside an omittable span, and focus finds every declared export.
  describe('never hides an exported declaration (Batch 24d)', () => {
    const EXPORT_KINDS_SOURCE = [
      'export interface Shape {',
      '  a: string;',
      '}',
      'export type Alias = { b: number };',
      'export enum Colour {',
      '  Red,',
      '}',
      'export const enum Flag { On }',
      'export declare function declared(): void;',
      'export declare const ambient: number;',
      'export abstract class Base {',
      '  abstract run(): void;',
      '}',
      'export namespace Space {',
      '  export interface Inner {',
      '    c: boolean;',
      '  }',
      '}',
      'export function make() {',
      '  return { d: 1 };',
      '}',
      'export const factory = () => {',
      '  return 2;',
      '};',
      'export let counter = 0;',
      'export var legacy = 1;',
      'export default class Main {',
      '  go() {',
      '    return 3;',
      '  }',
      '}',
    ].join('\n');

    /** Row and name of every `export <kind> <Name>` line, by regex. */
    function exportDeclarations(
      text: string,
    ): Array<{ row: number; name: string }> {
      const found: Array<{ row: number; name: string }> = [];
      text.split('\n').forEach((line, row) => {
        const m =
          /^\s*export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:const\s+(?=enum))?(?:interface|type|enum|class|function|const|let|var|namespace)\*?\s+([A-Za-z_$][\w$]*)/.exec(
            line,
          );
        if (m) found.push({ row, name: m[1] });
      });
      return found;
    }

    const realFile = (relative: string): string =>
      fs.readFileSync(
        path.resolve(
          __dirname,
          '../../../../../workspace-intelligence/src',
          relative,
        ),
        'utf8',
      );

    it.each([
      ['every TS export kind', () => EXPORT_KINDS_SOURCE, 14],
      ['ast/ast.types.ts', () => realFile('ast/ast.types.ts'), 3],
      [
        'types/workspace.types.ts',
        () => realFile('types/workspace.types.ts'),
        11,
      ],
    ] as const)('%s', async (_title, read, declarations) => {
      const source = read();
      const exports = exportDeclarations(source);
      expect(exports).toHaveLength(declarations);

      for (const { row, name } of exports) {
        const outline = await outliner.outline(source, 'typescript', name);
        expect(outline).not.toBeNull();
        const hidden = (outline?.omittable ?? []).some(
          (span) => span.startLine <= row && row <= span.endLine,
        );
        expect({ name, hidden }).toEqual({ name, hidden: false });
        const focused = (outline?.focus ?? []).some(
          (span) => span.startLine <= row && row <= span.endLine,
        );
        expect({ name, focused }).toEqual({ name, focused: true });
      }
    });
  });

  describe('300-line TypeScript module through the code reducer', () => {
    const { source, exported, focusBlock } = serviceModule();

    it('is at least 300 lines', () => {
      expect(source.split('\n').length).toBeGreaterThanOrEqual(300);
    });

    it('outlines to ≤ 40% of the source tokens, keeps every exported name and the focus body', async () => {
      const reduce = createCodeReducer(outliner);

      const result = await reduce(source, {
        budgetTokens: 2000,
        languageHint: 'typescript',
        focusSymbol: 'applyDiscount',
      });

      expect(result.reducer).toBe('code-outline');
      expect(lineTokens(result.text)).toBeLessThanOrEqual(
        0.4 * lineTokens(source),
      );
      for (const name of exported) {
        expect(result.text).toMatch(
          new RegExp(
            `^export (?:interface|type|function|class|const) ${name}\\b`,
            'm',
          ),
        );
      }
      expect(result.text).toContain(focusBlock);
      // Other method bodies are omitted: only applyDiscount's comment survives.
      expect(result.text).toContain('// applyDiscount');
      expect(result.text).not.toContain('// refund');
      expect(result.notes).toContain(
        'kept focus symbol "applyDiscount" in full (1 declaration(s))',
      );
      expectReconstructs(result.text, source);
    });
  });

  describe('refuses (null) instead of guessing', () => {
    it('returns null for a parse with syntax errors', async () => {
      const broken = lines(
        'function a( {',
        '  x();',
        '  y();',
        '}',
        'export const z = 1;',
      );
      await expect(outliner.outline(broken, 'typescript')).resolves.toBeNull();
    });

    it('still returns null for JSX forced onto the plain TypeScript grammar', async () => {
      const tsx = lines(
        'export const App = () => {',
        '  const label = "hi";',
        '  return <div className="x">{label}</div>;',
        '};',
      );
      await expect(outliner.outline(tsx, 'typescript')).resolves.toBeNull();
    });

    it.each([
      'typescriptreact',
      'kotlin',
      '.kt',
      'constructor',
      '.toString',
      '',
      'src/readme.md',
    ])(
      'returns null for the unsupported language %j without parsing',
      async (language) => {
        const runner = { queryMulti: jest.fn() };
        const fake = new TreeSitterCodeOutliner(runner);

        await expect(fake.outline(TS_SOURCE, language)).resolves.toBeNull();
        expect(runner.queryMulti).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['typescript', 'typescript'],
      ['TypeScript', 'typescript'],
      ['.TS', 'typescript'],
      ['ts', 'typescript'],
      ['src/lib/a.ts', 'typescript'],
      ['.jsx', 'javascript'],
      ['tsx', 'tsx'],
      ['.tsx', 'tsx'],
      ['src/App.TSX', 'tsx'],
      ['py', 'python'],
      ['.cs', 'csharp'],
      ['go', 'go'],
      ['java', 'java'],
      ['.JAVA', 'java'],
      ['src/main/java/App.java', 'java'],
      ['rust', 'rust'],
      ['rs', 'rust'],
      ['src/lib.rs', 'rust'],
      ['php', 'php'],
      ['.PHTML', 'php'],
      ['app/Http/Kernel.php', 'php'],
      ['ruby', 'ruby'],
      ['rb', 'ruby'],
      ['lib/tasks/db.rake', 'ruby'],
      ['cpp', 'cpp'],
      ['.C', 'cpp'],
      ['h', 'cpp'],
      ['include/widget.h', 'cpp'],
      ['src/app.c++', 'cpp'],
    ])(
      'resolves the language hint %j to the %s grammar',
      async (hint, grammar) => {
        const runner = {
          queryMulti: jest.fn().mockResolvedValue(Result.ok(new Map())),
        };

        await new TreeSitterCodeOutliner(runner).outline('x', hint);

        expect(runner.queryMulti).toHaveBeenCalledWith(
          'x',
          grammar,
          expect.any(Array),
        );
      },
    );

    it('asks for declarations only when a focus symbol is given', async () => {
      const runner = {
        queryMulti: jest.fn().mockResolvedValue(Result.ok(new Map())),
      };
      const fake = new TreeSitterCodeOutliner(runner);

      await fake.outline('x', 'typescript');
      await fake.outline('x', 'typescript', 'x');

      const keys = runner.queryMulti.mock.calls.map((call) =>
        (call[2] as Array<{ key: string }>).map((entry) => entry.key),
      );
      expect(keys).toEqual([
        ['errors', 'bodies'],
        ['errors', 'bodies', 'declarations'],
      ]);
    });

    it('returns null on a host whose grammars fail to load (initialize errs)', async () => {
      const noGrammars = new TreeSitterParserService(silentLogger());
      jest
        .spyOn(noGrammars, 'initialize')
        .mockResolvedValue(Result.err(new Error('wasm not found')));

      await expect(
        new TreeSitterCodeOutliner(noGrammars).outline(TS_SOURCE, 'typescript'),
      ).resolves.toBeNull();
    });

    it('returns null when initialisation rejects outright', async () => {
      const throwing = new TreeSitterParserService(silentLogger());
      jest
        .spyOn(throwing, 'initialize')
        .mockRejectedValue(new Error('resolveWasmPath failed'));

      await expect(
        new TreeSitterCodeOutliner(throwing).outline(TS_SOURCE, 'typescript'),
      ).resolves.toBeNull();
    });

    it('the reducer falls back to the log reducer when the outliner refuses', async () => {
      const broken = lines('function a( {', '  x();', '}');

      const result = await createCodeReducer(outliner)(broken, {
        budgetTokens: 50,
        languageHint: 'typescript',
      });

      expect(result.reducer).toMatch(/^code-fallback:log-/);
      expect(result.notes?.[0]).toBe(
        'code outline unavailable: no outline for language "typescript"',
      );
    });
  });

  /**
   * The parse runs on the host's main thread. Load-robust relative guard (the
   * tool-output-reducers pattern): fastest of three; over the absolute bound
   * the run still passes under a 10 s hard ceiling and within LOAD_FACTOR of
   * a quarter-size input timed under the same load.
   */
  it('outlines ~250 KiB of TypeScript in under 1 s', async () => {
    const LOAD_FACTOR = 8;
    const HARD_CEILING_MS = 10_000;
    const unit = (i: number): string =>
      lines(
        `export function f${i}(a: number): number {`,
        '  const x = a + 1;',
        '  if (x > 2) {',
        '    return x;',
        '  }',
        '  return a;',
        '}',
      );
    const moduleOfSize = (chars: number): string => {
      let text = '';
      for (let i = 0; text.length + unit(i).length <= chars; i++) {
        text += unit(i);
      }
      return text;
    };
    const reduce = createCodeReducer(outliner);
    const fastestMs = async (text: string): Promise<number> => {
      let elapsed = Infinity;
      for (let run = 0; run < 3; run++) {
        const start = performance.now();
        const result = await reduce(text, {
          budgetTokens: 2000,
          languageHint: 'typescript',
        });
        elapsed = Math.min(elapsed, performance.now() - start);
        expect(result.reducer).toBe('code-outline');
      }
      return elapsed;
    };
    const full = moduleOfSize(250 * 1024);

    const elapsed = await fastestMs(full);
    if (elapsed >= 1000) {
      expect(elapsed).toBeLessThan(HARD_CEILING_MS);
      expect(elapsed).toBeLessThan(
        LOAD_FACTOR * (await fastestMs(moduleOfSize(64 * 1024))),
      );
    }
  }, 120_000);
});
