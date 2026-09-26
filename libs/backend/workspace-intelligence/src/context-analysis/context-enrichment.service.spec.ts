/**
 * Context Enrichment Service Tests
 *
 * Pins two contracts of `generateStructuralSummary`:
 *
 * 1. A structural summary never silently drops API. Every top-level
 *    declaration survives with its signature; when that cannot be guaranteed
 *    (recovered parse, unknown top-level kind, nothing to summarise) the
 *    result is the full content with a `reason`.
 * 2. Every `mode: 'full'` result names WHY no summary was returned, a
 *    structural result carries no reason, and `content` is the last key so a
 *    budget cut at the end of the serialised JSON keeps the metadata.
 *
 * Summaries run through the REAL tree-sitter grammars, not a mocked parser: a
 * query naming a node the grammar lacks, or a grammar that rejects the syntax,
 * produces no captures and no error, and only a real parse shows that. The two
 * shims below are the ones `csharp-grammar.integration.spec.ts` documents:
 * `./wasm-bundle-dir` reads `import.meta.url`, which Jest's CJS runtime cannot
 * parse, and `Language.load(path)` uses a dynamic import Jest's VM rejects, so
 * the grammar bytes are read here and handed over as a buffer.
 */

import 'reflect-metadata';

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

import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { Result } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { TreeSitterParserService } from '../ast/tree-sitter-parser.service';
import type { FileSystemService } from '../services/file-system.service';
import type { TokenCounterService } from '../services/token-counter.service';
import { ContextEnrichmentService } from './context-enrichment.service';
import {
  DECLARATION_SUMMARY_QUERIES,
  summariseDeclarations,
} from './declaration-summary';

const FILE = '/ws/src/a.ts';
const SOURCE = [
  'export function greet(name: string) {',
  '  const trimmed = name.trim();',
  '  const greeting = `Hello, ${trimmed}! Welcome back to the workspace.`;',
  '  const decorated = greeting.padStart(greeting.length + 4, "*");',
  '  const shouted = decorated.toUpperCase();',
  '  return shouted.length > 200 ? shouted.slice(0, 200) : shouted;',
  '}',
  '',
].join('\n');

function makeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

/** One real parser for the whole file: grammar loading is the slow part. */
const parser = new TreeSitterParserService(makeLogger() as unknown as Logger);

afterAll(() => parser.dispose());

function makeService() {
  const tokenCounter = {
    countTokens: jest.fn(async (text: string) => text.length),
  };
  const fileSystem = { readFile: jest.fn().mockResolvedValue(SOURCE) };
  const logger = makeLogger();
  const workspaceProvider = {
    getWorkspaceRoot: jest.fn().mockReturnValue('/ws'),
  };

  const service = new ContextEnrichmentService(
    parser,
    tokenCounter as unknown as TokenCounterService,
    fileSystem as unknown as FileSystemService,
    logger as unknown as Logger,
    workspaceProvider as unknown as IWorkspaceProvider,
  );
  return { service, tokenCounter, fileSystem, logger };
}

/** Summarise `source` as `language` through the real parser and the service. */
function summarise(
  source: string,
  language: 'typescript' | 'javascript',
  file = FILE,
) {
  return makeService().service.generateStructuralSummary(
    file,
    language,
    source,
  );
}

/** Real-parser `queryMulti` captures for the declaration summary. */
async function captures(source: string, language: 'typescript' | 'javascript') {
  const result = await parser.queryMulti(source, language, [
    ...DECLARATION_SUMMARY_QUERIES,
  ]);
  if (result.isErr() || !result.value) {
    throw new Error('the real parser failed');
  }
  return result.value;
}

/** The declaration writer's outcome for `source`, through the real parser. */
async function writerOutcome(
  source: string,
  language: 'typescript' | 'javascript',
) {
  return summariseDeclarations(
    source,
    await captures(source, language),
    'src/a.ts',
  );
}

/** The writer's summary text (fails the test on any other outcome). */
async function summaryText(
  source: string,
  language: 'typescript' | 'javascript',
): Promise<string> {
  const outcome = await writerOutcome(source, language);
  if (outcome.kind !== 'summary') {
    throw new Error(`expected a summary, got '${outcome.kind}'`);
  }
  return outcome.text;
}

/** A body long enough that eliding it makes the summary smaller. */
const LONG_BODY = Array.from(
  { length: 12 },
  (_, i) => `  const step${i} = input * ${i} + helperValue${i};`,
).join('\n');

describe('ContextEnrichmentService.generateStructuralSummary', () => {
  describe('summary completeness (real tree-sitter grammars)', () => {
    it('keeps every exported name of a normal .ts file and drops the bodies', async () => {
      const source = [
        "import { Base } from './base';",
        "import * as path from 'node:path';",
        '',
        'export const VERSION = 3;',
        'export function greet(name: string): string {',
        '  const secretBody = name.trim();',
        '  return secretBody;',
        '}',
        'export async function load(id: number): Promise<void> {',
        '  await fetchIt(id);',
        '}',
        'export const add = (a: number, b: number): number => {',
        '  return a + b + hiddenArrowBody;',
        '};',
        'export const twice = function named(x: number) { return x * hiddenFnBody; };',
        'export class Service extends Base {',
        '  private readonly cache = new Map<string, number>();',
        '  constructor(private readonly id: string) { super(); hiddenCtor(); }',
        '  get size(): number { return hiddenGetter; }',
        '  async run(input: string): Promise<string> { return hiddenMethod; }',
        '}',
        'function internalHelper(): void { hiddenHelper(); }',
        'export { internalHelper as helper };',
        "export * from './more';",
        "export const SMALL = { a: 1, b: 'two' };",
        '',
      ].join('\n');

      const text = await summaryText(source, 'typescript');

      for (const kept of [
        "import { Base } from './base';",
        "import * as path from 'node:path';",
        'export const VERSION = 3;',
        'export function greet(name: string): string;',
        'export async function load(id: number): Promise<void>;',
        'export const add = (a: number, b: number): number => { … };',
        'export const twice = function named(x: number) { … };',
        'export class Service extends Base {',
        'private readonly cache = new Map<string, number>();',
        'constructor(private readonly id: string);',
        'get size(): number;',
        'async run(input: string): Promise<string>;',
        'function internalHelper(): void;',
        'export { internalHelper as helper };',
        "export * from './more';",
        "export const SMALL = { a: 1, b: 'two' };",
      ]) {
        expect(text).toContain(kept);
      }
      expect(text).not.toMatch(
        /secretBody|fetchIt|hidden(ArrowBody|FnBody|Ctor|Getter|Method|Helper)/,
      );
    });

    it('returns a smaller structural summary through the service for a normal file', async () => {
      const source = [
        "import { Base } from './base';",
        `export function compute(input: number): number {\n${LONG_BODY}\n  return input;\n}`,
        `export class Runner extends Base {\n  run(input: number): number {\n${LONG_BODY}\n    return input;\n  }\n}`,
        '',
      ].join('\n');

      const out = await summarise(source, 'typescript');

      expect(out.mode).toBe('structural');
      expect(out).not.toHaveProperty('reason');
      expect(out.content).toContain(
        'export function compute(input: number): number;',
      );
      expect(out.content).toContain('run(input: number): number;');
      expect(out.content).not.toContain('helperValue');
      expect(out.tokenCount).toBeLessThan(out.originalTokenCount);
    });

    it('keeps ambient and overload signatures of a .d.ts file (B2)', async () => {
      const source = [
        'export declare function greet(name: string): string;',
        'export declare const version: string;',
        'export function over(a: string): void;',
        'export function over(a: number): void;',
        'declare function globalHelper(): void;',
        "declare module 'plugin' {",
        '  export function register(name: string): void;',
        '}',
        '',
      ].join('\n');

      const text = await summaryText(source, 'typescript');
      const out = await summarise(source, 'typescript', '/ws/src/api.d.ts');

      for (const kept of source.split('\n').filter(Boolean)) {
        expect(text).toContain(kept);
      }
      // Nothing to elide: the file is already its own summary (R2-S1 guard).
      expect(out).toEqual({
        mode: 'full',
        reason: 'summary-not-smaller',
        tokenCount: source.length,
        originalTokenCount: source.length,
        reductionPercentage: 0,
        content: source,
      });
    });

    it('keeps interfaces, type aliases, enums and namespaces verbatim', async () => {
      const source = [
        'export interface User {',
        '  id: string;',
        '  rename(to: string): void;',
        '}',
        'interface Internal { flag: boolean }',
        'export type Id = string | number;',
        'type Pair<T> = [T, T];',
        'export enum Color { Red, Green }',
        'export const enum Flag { On = 1 }',
        'namespace Util {',
        '  export const tag = "u";',
        '}',
        '',
      ].join('\n');

      const text = await summaryText(source, 'typescript');

      for (const kept of source.split('\n').filter(Boolean)) {
        expect(text).toContain(kept);
      }
    });

    it('keeps export default declarations and expressions', async () => {
      const text = await summaryText(
        [
          'export default class Widget<T> {',
          '  render(value: T): string { return hiddenRender; }',
          '}',
          '',
        ].join('\n'),
        'typescript',
      );
      const textFn = await summaryText(
        'export default function (a: number) { return hiddenDefault; }\n',
        'typescript',
      );

      expect(text).toContain('export default class Widget<T> {');
      expect(text).toContain('render(value: T): string;');
      expect(text).not.toContain('hiddenRender');
      expect(textFn).toContain('export default function (a: number)');
      expect(textFn).not.toContain('hiddenDefault');
    });

    it('keeps JSX arrow components of a .jsx file (the JavaScript grammar parses JSX)', async () => {
      const text = await summaryText(
        'export const App = () => <div />;\nexport const Next = () => <span />;\n',
        'javascript',
      );

      expect(text).toContain('export const App = () => …;');
      expect(text).toContain('export const Next = () => …;');
    });

    it("returns full content with reason 'parse-failed' for TSX parsed as typescript (B1)", async () => {
      const source =
        'export const App = () => <div />;\nexport const Next = () => <span />;\n';

      const out = await summarise(source, 'typescript', '/ws/src/App.tsx');

      expect(out).toEqual({
        mode: 'full',
        reason: 'parse-failed',
        tokenCount: source.length,
        originalTokenCount: source.length,
        reductionPercentage: 0,
        content: source,
      });
    });

    it("returns full content with reason 'parse-failed' when the parse needed error recovery", async () => {
      const source = [
        'export function broken(a: number) {',
        '  if (a {',
        '}',
        'export const kept = 1;',
        '',
      ].join('\n');
      const { service, logger } = makeService();

      const out = await service.generateStructuralSummary(
        FILE,
        'typescript',
        source,
      );

      expect(out.mode).toBe('full');
      expect(out.reason).toBe('parse-failed');
      expect(out.content).toBe(source);
      const logged = logger.warn.mock.calls.flat().join('\n');
      expect(logged).toContain('parse-failed');
      expect(logged).not.toContain(FILE);
    });

    it("returns full content with reason 'no-declarations' for a file of imports and comments", async () => {
      const source = "import './polyfills';\n// Nothing is declared here.\n";

      const out = await summarise(source, 'javascript', '/ws/src/main.js');

      expect(out.mode).toBe('full');
      expect(out.reason).toBe('no-declarations');
      expect(out.content).toBe(source);
    });

    it("answers 'unsupported-declarations' for a top-level node kind the writer does not know", () => {
      const node = {
        type: 'future_declaration',
        text: 'future x;',
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 9 },
        isNamed: true,
        fieldName: null,
        children: [],
      };
      const matches = new Map([
        [
          'statements',
          [
            {
              pattern: 0,
              captures: [
                {
                  name: 'statement',
                  node,
                  text: node.text,
                  startPosition: node.startPosition,
                  endPosition: node.endPosition,
                },
              ],
            },
          ],
        ],
      ]);

      expect(summariseDeclarations('future x;', matches, 'a.ts')).toEqual({
        kind: 'unsupported-declarations',
      });
    });
  });

  /**
   * Decision 13: a summary only for pure declaration files. Every fixture
   * below publishes (or may publish) API a summary could hide, so the whole
   * file comes back with reason 'unsupported-declarations'. The padding makes
   * a summary smaller than the file, so the small-file fallback cannot mask a
   * missing refusal.
   */
  describe('declaration-only gate (Decision 13, real parser)', () => {
    const padding = `const padding = "${'x'.repeat(350)}";`;

    async function expectRefused(
      source: string,
      language: 'typescript' | 'javascript' = 'javascript',
    ) {
      const { service, logger } = makeService();

      const out = await service.generateStructuralSummary(
        '/ws/src/index.cjs',
        language,
        source,
      );

      expect(out).toEqual({
        mode: 'full',
        reason: 'unsupported-declarations',
        tokenCount: source.length,
        originalTokenCount: source.length,
        reductionPercentage: 0,
        content: source,
      });
      const logged = logger.debug.mock.calls.flat().join('\n');
      expect(logged).toContain('unsupported-declarations');
      expect(logged).not.toContain('index.cjs');
    }

    it.each([
      [
        'R3-B1 an exports alias used inside an installer body',
        `const e=exports; function install(){ e.publicApi = x => x; ${padding} } install();`,
      ],
      [
        'R3-B1 exports destructured from module',
        `const { exports: e }=module; function install(){ e.publicApi = x => x; ${padding} } install();`,
      ],
      [
        'R3-B1 a CommonJS top-level this alias',
        `const e=this; function install(){ e.publicApi = x => x; ${padding} } install();`,
      ],
      [
        'R3-B1 a globalThis installer',
        `function install(){ globalThis.publicApi = x => x; ${padding} } install();`,
      ],
      [
        'R3-B1 a prototype installer',
        `class API {} function install(){ API.prototype.publicMethod = x => x; ${padding} } install(); module.exports=API;`,
      ],
      [
        'R3-B1 an IIFE initialiser',
        `const api=(() => { globalThis.publicApi = x => x; ${padding} return globalThis; })();`,
      ],
      [
        'R3-B2 a large object storing a method by reference (CommonJS)',
        `function externalFn(x) { return x; }\nconst api={ publicMethod: externalFn, payload:"${'x'.repeat(450)}" };\nmodule.exports=api;`,
      ],
      [
        'a conditional export',
        `const ready = true;\nif (ready) { exports.publicApi = function publicApi(x) { ${padding} return x; }; }\n`,
      ],
      [
        'an Object.defineProperty export',
        `export const ready = true;\nObject.defineProperty(exports, 'publicApi', {\n  value: function publicApi(x) { ${padding} return x; }\n});\n`,
      ],
      [
        "a bracket-form module['exports'] export",
        `export const ready = true;\nmodule['exports'].publicApi = function publicApi(x) { ${padding} return x; };\n`,
      ],
      [
        'a prototype method added to an exported class',
        `export class API {}\nAPI.prototype.publicMethod = function (x) { ${padding} return x; };\n`,
      ],
      [
        'CommonJS export assignments',
        `module.exports = { start };\nexports.stop = (code) => { ${padding} hiddenStop(code); };\n`,
      ],
      [
        'a top-level call',
        `export function start() { ${padding} }\nstart();\n`,
      ],
      [
        'a top-level callback registration',
        `export const ready = true;\nonLoad(() => { register(function viaCallback(y) { ${padding} return y; }); });\n`,
      ],
      [
        'a call in a variable initialiser',
        `export const lazy = wrap(() => { ${padding} hiddenLazyBody(); });\n`,
      ],
      [
        'a variable initialised from another name',
        `function impl() { ${padding} }\nexport const alias = impl;\n`,
      ],
      [
        'a call inside a small literal',
        `export function install() { ${padding} }\nexport const table = { ready: install() };\n`,
      ],
      [
        'a spread in a small literal',
        `const base = { a: 1 };\nexport const api = { ...base, run() { ${padding} } };\n`,
      ],
      [
        'a class static block',
        `export class Holder {\n  static { register(Holder); }\n  run() { ${padding} }\n}\n`,
      ],
      [
        'a static field initialised by a call',
        `export class Holder {\n  static shared = create();\n  run() { ${padding} }\n}\n`,
      ],
      [
        'a computed class member key',
        `export class Holder {\n  [key()]() { ${padding} }\n}\n`,
      ],
      [
        'Object.assign inside an elided body',
        `export function install(target) { Object.assign(target, { publicApi: 1 }); ${padding} }\n`,
      ],
      [
        'an Object alias inside an elided body',
        `export function install(target) { const O = Object; O.defineProperty(target, 'x', {}); ${padding} }\n`,
      ],
      [
        'window inside an elided body',
        `export function install() { window.publicApi = 1; ${padding} }\n`,
      ],
      [
        'a local variable named module inside an elided body',
        `export function run(modules) {\n  for (const module of modules) { module.start(); }\n  ${padding}\n}\n`,
      ],
    ])(
      "returns full content with reason 'unsupported-declarations' for %s",
      async (_label, source) => {
        await expectRefused(source);
      },
    );

    it.each([
      [
        'R3-B2 an exported object storing a method by reference',
        `function externalFn(x: number) { return x; }\nexport const api = { publicMethod: externalFn, payload: "${'x'.repeat(450)}" };\n`,
      ],
      [
        'R3-B2 a large object with a spread and a computed key',
        `const otherApi = {};\nconst key = 'publicApi';\nexport const api = { ...otherApi, [key]: 1, payload: "${'x'.repeat(450)}" };\n`,
      ],
      [
        'a large object whose values are methods',
        `export const api = {\n${Array.from({ length: 30 }, (_, i) => `  method${i}(a) { return a + ${i}; },`).join('\n')}\n};\n`,
      ],
      [
        'a large object with a getter',
        `export const api = { get publicApi() { return 1; }, payload: "${'x'.repeat(450)}" };\n`,
      ],
      [
        'a large template literal with a substitution',
        `export const V = 1;\nexport const text = \`\${V} ${'x'.repeat(450)}\`;\n`,
      ],
    ])(
      "returns full content with reason 'unsupported-declarations' for %s",
      async (_label, source) => {
        await expectRefused(source, 'typescript');
      },
    );

    const payloads = Array.from({ length: 5000 }, (_, i) => `"payload${i}"`);
    const work = `function work(input) { ${padding} return input; }`;
    const tail = 'export function tailApi(x: number): number { return x+1; }';

    it('R3-S1 elides a pure-data literal under as const, parentheses and satisfies', async () => {
      const source = `export const data = ([${payloads.join(',')}] as const) satisfies readonly string[];\n${work}\n${tail}`;

      const out = await summarise(source, 'typescript');

      expect(out.mode).toBe('structural');
      expect(out.content).toContain(
        'export const data = ([ … ] as const) satisfies readonly string[];',
      );
      expect(out.content).toContain('function work(input);');
      expect(out.content).toContain(
        'export function tailApi(x: number): number;',
      );
      expect(out.content).not.toContain('payload');
      expect(out.content.length).toBeLessThan(400);
    });

    it("R3-S1 refuses an object mixing a method with a large data array ('unsupported-declarations')", async () => {
      await expectRefused(
        `export const data = { method(x) { return x; }, data: [${payloads.join(',')}]};\n${work}\n${tail}`,
        'typescript',
      );
    });
  });

  describe('runtime exports inside elided bodies (R2-B1, real parser)', () => {
    it.each([
      [
        'exports assigned inside a function body',
        'function install() {\n  exports.publicApi = (x) => x;\n}\ninstall();\n',
      ],
      [
        'module.exports defined inside a method',
        "export class Installer {\n  install() {\n    Object.defineProperty(module.exports, 'publicApi', { value: 1 });\n  }\n}\n",
      ],
      [
        "module['exports'] inside an arrow body",
        "export const install = () => { module['exports'].publicApi = 1; };\n",
      ],
      [
        'exports passed as a shorthand property inside a body',
        'export function install() {\n  register({ exports });\n}\n',
      ],
    ])(
      "returns full content with reason 'unsupported-declarations' for %s",
      async (_label, source) => {
        const { service, logger } = makeService();

        const out = await service.generateStructuralSummary(
          '/ws/src/index.cjs',
          'javascript',
          source,
        );

        expect(out).toEqual({
          mode: 'full',
          reason: 'unsupported-declarations',
          tokenCount: source.length,
          originalTokenCount: source.length,
          reductionPercentage: 0,
          content: source,
        });
        const logged = logger.debug.mock.calls.flat().join('\n');
        expect(logged).toContain('unsupported-declarations');
        expect(logged).not.toContain('index.cjs');
      },
    );
  });

  describe('retained source is byte-identical (R2-B2, real parser)', () => {
    it('keeps a template literal with blank and whitespace-only lines exactly', async () => {
      const banner = 'export const banner = `first\n\n \t\nlast\r\n\r\nend`;';
      const source = `${banner}\nexport function f() {\n${LONG_BODY}\n  return 1;\n}\n`;

      const text = await summaryText(source, 'typescript');
      const out = await summarise(source, 'typescript');

      expect(text).toContain(banner);
      expect(out.mode).toBe('structural');
      expect(out.content).toContain(banner);
      expect(out.content).toContain('export function f();');
    });

    it('renders a statement with nothing to elide as its exact source', async () => {
      const statement = [
        'export class Holder {',
        '',
        '  readonly text = `a',
        '',
        '    b`;',
        '  ',
        '  static readonly ready = `x\n\ny`;',
        '}',
      ].join('\n');

      const text = await summaryText(`${statement}\n`, 'typescript');

      expect(text.split('\n').slice(3).join('\n')).toBe(`${statement}\n`);
    });
  });

  describe('large initialiser values (R2-S1, real parser)', () => {
    const payloads = Array.from({ length: 5000 }, (_, i) => `"payload${i}"`);
    const tail = 'export function tailApi(x: number): number { return x + 1; }';

    it.each([
      [
        'array',
        `export const data = [${payloads.join(', ')}];\n${tail}\n`,
        'export const data = [ … ];',
      ],
      [
        'object',
        `export const data = {${payloads
          .map((p, i) => `k${i}: ${p}`)
          .join(', ')}};\n${tail}\n`,
        'export const data = { … };',
      ],
      [
        'as-const array with a type annotation',
        `export const data: readonly string[] = [${payloads.join(', ')}] as const;\n${tail}\n`,
        'export const data: readonly string[] = [ … ] as const;',
      ],
      [
        'template string',
        `export const data = \`${payloads.join('\n')}\`;\n${tail}\n`,
        'export const data = "…";',
      ],
    ])(
      'elides a huge %s initialiser and keeps the API after it',
      async (_label, source, kept) => {
        const out = await summarise(source, 'typescript');

        expect(out.mode).toBe('structural');
        expect(out.content).toContain(kept);
        expect(out.content).toContain(
          'export function tailApi(x: number): number;',
        );
        expect(out.content).not.toContain('payload');
        expect(out.content.length).toBeLessThan(400);
      },
    );

    it('elides a large class field value but keeps small constants', async () => {
      const text = await summaryText(
        [
          `export class Table {\n  static readonly rows = [${payloads
            .slice(0, 100)
            .join(', ')}];\n  readonly small = [1, 2, 3];\n}`,
          "export const SMALL = { a: 1, b: 'two' };",
          '',
        ].join('\n'),
        'typescript',
      );

      expect(text).toContain('static readonly rows = [ … ];');
      expect(text).toContain('readonly small = [1, 2, 3];');
      expect(text).toContain("export const SMALL = { a: 1, b: 'two' };");
    });

    it('keeps a small object of methods with their bodies elided', async () => {
      const text = await summaryText(
        'export const api = {\n  start(a) { return a + hiddenStart; },\n  stop: (b) => hiddenStop(b),\n};\n',
        'javascript',
      );

      expect(text).toContain('start(a) { … },');
      expect(text).toContain('stop: (b) => …,');
      expect(text).not.toMatch(/hiddenStart|hiddenStop/);
    });

    it("refuses with 'unsupported-declarations' when an elided value refers to exports", async () => {
      const outcome = await writerOutcome(
        `export const table = [${payloads
          .slice(0, 100)
          .join(', ')}, exports.extra = 1];\n`,
        'javascript',
      );

      expect(outcome).toEqual({ kind: 'unsupported-declarations' });
    });

    it("returns full content with reason 'summary-not-smaller' when the summary is not smaller", async () => {
      const { service, logger } = makeService();
      const source = 'export const a = 1;\n';

      const out = await service.generateStructuralSummary(
        FILE,
        'typescript',
        source,
      );

      expect(out).toEqual({
        mode: 'full',
        reason: 'summary-not-smaller',
        tokenCount: source.length,
        originalTokenCount: source.length,
        reductionPercentage: 0,
        content: source,
      });
      const logged = logger.debug.mock.calls.flat().join('\n');
      expect(logged).toContain('summary-not-smaller');
      expect(logged).not.toContain(FILE);
    });

    it("returns full content with reason 'summary-not-smaller' when fewer characters cost more tokens (R3-M1)", async () => {
      const { service, tokenCounter } = makeService();
      // A word-count tokenizer: whitespace is free, as it nearly is for BPE.
      tokenCounter.countTokens.mockImplementation(
        async (text: string) => text.split(/\s+/).filter(Boolean).length,
      );
      const source = `export function f() {${' '.repeat(350)}return 1; }`;

      const out = await service.generateStructuralSummary(
        FILE,
        'typescript',
        source,
      );

      expect(out).toEqual({
        mode: 'full',
        reason: 'summary-not-smaller',
        tokenCount: 7,
        originalTokenCount: 7,
        reductionPercentage: 0,
        content: source,
      });
      expect(tokenCounter.countTokens).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * Rendering runs on the host's main thread. Load-robust relative guard (the
   * tool-output-reducers pattern): fastest of three renders (parse excluded);
   * over the absolute bound the run still passes under a 10 s hard ceiling
   * and within LOAD_FACTOR of a quarter-size input timed under the same load.
   * A declaration × body scan grows 16× for 4× the input; a sweep grows 4×.
   */
  it('renders 16,000 function declarations in linear time (R2-M1)', async () => {
    const LOAD_FACTOR = 8;
    const HARD_CEILING_MS = 10_000;
    const moduleOf = (count: number): string =>
      Array.from(
        { length: count },
        (_, i) =>
          `export function f${i}(a: number): number { return a + ${i}; }`,
      ).join('\n');
    const fastestRenderMs = async (count: number): Promise<number> => {
      const source = moduleOf(count);
      const matches = await captures(source, 'typescript');
      let elapsed = Infinity;
      for (let run = 0; run < 3; run++) {
        const start = performance.now();
        const outcome = summariseDeclarations(source, matches, 'src/a.ts');
        elapsed = Math.min(elapsed, performance.now() - start);
        expect(outcome.kind).toBe('summary');
      }
      return elapsed;
    };

    const elapsed = await fastestRenderMs(16_000);
    if (elapsed >= 250) {
      expect(elapsed).toBeLessThan(HARD_CEILING_MS);
      expect(elapsed).toBeLessThan(
        LOAD_FACTOR * (await fastestRenderMs(4_000)),
      );
    }
  }, 120_000);

  describe('full-content fallback reasons', () => {
    it("returns full content with reason 'unsupported-language' and never parses when no language is given", async () => {
      const { service } = makeService();
      const queryMulti = jest.spyOn(parser, 'queryMulti');

      const out = await service.generateStructuralSummary(FILE, undefined);

      expect(queryMulti).not.toHaveBeenCalled();
      queryMulti.mockRestore();
      expect(out).toEqual({
        mode: 'full',
        reason: 'unsupported-language',
        tokenCount: SOURCE.length,
        originalTokenCount: SOURCE.length,
        reductionPercentage: 0,
        content: SOURCE,
      });
    });

    it("returns full content with reason 'unsupported-language' for a language it cannot summarise", async () => {
      const source = 'def greet(name):\n    return name\n';

      const out = await makeService().service.generateStructuralSummary(
        '/ws/src/a.py',
        'python',
        source,
      );

      expect(out.mode).toBe('full');
      expect(out.reason).toBe('unsupported-language');
      expect(out.content).toBe(source);
    });

    it("returns full content with reason 'parse-failed' when the parser errs", async () => {
      const { service, logger } = makeService();
      const queryMulti = jest
        .spyOn(parser, 'queryMulti')
        .mockResolvedValueOnce(
          Result.err(new Error('grammar exploded at /secret/path')),
        );

      const out = await service.generateStructuralSummary(FILE, 'javascript');
      queryMulti.mockRestore();

      expect(out.mode).toBe('full');
      expect(out.reason).toBe('parse-failed');
      expect(out.content).toBe(SOURCE);
      // Fixed log text: no raw error message or path.
      const logged = logger.warn.mock.calls.flat().join('\n');
      expect(logged).toContain('parse-failed');
      expect(logged).not.toContain('/secret/path');
      expect(logged).not.toContain(FILE);
    });

    it("returns an empty full result with reason 'read-failed' when the file cannot be read", async () => {
      const { service, fileSystem, tokenCounter, logger } = makeService();
      fileSystem.readFile.mockRejectedValue(
        new Error(`ENOENT: no such file, open '${FILE}'`),
      );

      const out = await service.generateStructuralSummary(FILE, 'typescript');

      expect(tokenCounter.countTokens).not.toHaveBeenCalled();
      expect(out).toEqual({
        mode: 'full',
        reason: 'read-failed',
        tokenCount: 0,
        originalTokenCount: 0,
        reductionPercentage: 0,
        content: '',
      });
      const logged = logger.error.mock.calls.flat().join('\n');
      expect(logged).toContain('read-failed');
      expect(logged).not.toContain(FILE);
    });

    it('uses pre-read content without touching the file system', async () => {
      const { service, fileSystem } = makeService();

      const out = await service.generateStructuralSummary(
        FILE,
        'typescript',
        SOURCE,
      );

      expect(fileSystem.readFile).not.toHaveBeenCalled();
      expect(out.mode).toBe('structural');
      expect(out.content).toContain('export function greet(name: string);');
      expect(out.content).not.toContain('toUpperCase');
    });

    it('returns a structural empty-file header with no reason for a blank file', async () => {
      const out = await makeService().service.generateStructuralSummary(
        FILE,
        undefined,
        '  \n',
      );

      expect(out.mode).toBe('structural');
      expect(out).not.toHaveProperty('reason');
      expect(out.content).toContain('// Empty file');
    });

    it('serialises every result with content last so a tail cut keeps mode and reason', async () => {
      const results = [
        await summarise(SOURCE, 'typescript'),
        await makeService().service.generateStructuralSummary(FILE, undefined),
        await summarise("console.log('x');\n", 'javascript'),
      ];

      expect(results.map((r) => r.mode)).toEqual([
        'structural',
        'full',
        'full',
      ]);
      for (const result of results) {
        const keys = Object.keys(result);
        expect(keys[0]).toBe('mode');
        expect(keys[keys.length - 1]).toBe('content');
      }
    });
  });
});
