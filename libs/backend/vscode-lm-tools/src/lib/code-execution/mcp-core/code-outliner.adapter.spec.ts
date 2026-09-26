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
  return text
    .split('\n')
    .reduce((sum, line) => sum + countTokens(line) + 1, 0);
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
    out.push(`  const part${k} = String(order.items[${k}] ?? '').padStart(${k + 2});`);
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

    it('reports no focus spans when no focus symbol is requested', async () => {
      const outline = await outliner.outline(TS_SOURCE, 'typescript');
      expect(outline?.focus).toEqual([]);
      expect(outline?.omittable.length).toBeGreaterThan(0);
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
          new RegExp(`^export (?:interface|type|function|class|const) ${name}\\b`, 'm'),
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
      const broken = lines('function a( {', '  x();', '  y();', '}', 'export const z = 1;');
      await expect(outliner.outline(broken, 'typescript')).resolves.toBeNull();
    });

    it('returns null for JSX under the plain TypeScript grammar (.tsx)', async () => {
      const tsx = lines(
        'export const App = () => {',
        '  const label = "hi";',
        '  return <div className="x">{label}</div>;',
        '};',
      );
      await expect(outliner.outline(tsx, '.tsx')).resolves.toBeNull();
    });

    it.each(['typescriptreact', 'rust', 'constructor', '.toString', '', 'src/readme.md'])(
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
      ['py', 'python'],
      ['.cs', 'csharp'],
      ['go', 'go'],
    ])('resolves the language hint %j to the %s grammar', async (hint, grammar) => {
      const runner = {
        queryMulti: jest.fn().mockResolvedValue(Result.ok(new Map())),
      };

      await new TreeSitterCodeOutliner(runner).outline('x', hint);

      expect(runner.queryMulti).toHaveBeenCalledWith(
        'x',
        grammar,
        expect.any(Array),
      );
    });

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
