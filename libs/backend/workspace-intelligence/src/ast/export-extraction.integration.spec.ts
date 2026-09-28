/**
 * JS/TS export extraction — real-grammar integration test (TASK_2026_559,
 * Batch 20.2q).
 *
 * Runs the real `LANGUAGE_QUERIES_MAP` export queries through the real
 * tree-sitter WASM grammars, so a query naming a node the grammar lacks (zero
 * captures, no error) or a TypeScript-only node leaking into the JavaScript
 * query (compile error) fails here. Both public paths are checked:
 * `AstAnalysisService.analyzeSource` (ptah_ast_analyze and the dependency
 * graph's symbol index) and `queryExports` + `extractExportsFromMatches`
 * (`ptah.ast.queryExports`).
 *
 * The real-file cases compare against a regex census of the file's own export
 * lines computed here, never against the extractor's output.
 *
 * The WASM shims are the same as `csharp-grammar.integration.spec.ts` (see its
 * header for why each is needed).
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@ptah-extension/vscode-core';

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
import type { CodeInsights, ExportInfo } from './ast-analysis.interfaces';
import type { SupportedLanguage } from './ast.types';
import {
  extractExportsFromMatches,
  exportSymbolNames,
} from './export-extraction';

// Keeps the keyword and the module quote apart in this file's text.
const FROM = 'from';

type Expected = Pick<ExportInfo, 'name' | 'kind'> & Partial<ExportInfo>;

interface ExportCase {
  title: string;
  source: string;
  expected: Expected[];
  /** JavaScript too (the source is valid JS); TypeScript always runs. */
  js?: boolean;
  /** Default `ok`. */
  parseStatus?: 'ok' | 'recovered';
  /** Expected `unextractedExports`; default: absent. */
  unextracted?: string[];
}

const CASES: ExportCase[] = [
  {
    title: 'export interface',
    source: 'export interface I { a: string }',
    expected: [{ name: 'I', kind: 'interface' }],
  },
  {
    title: 'export type alias',
    source: 'export type T = string;',
    expected: [{ name: 'T', kind: 'type' }],
  },
  {
    title: 'export enum',
    source: 'export enum E { A }',
    expected: [{ name: 'E', kind: 'enum' }],
  },
  {
    title: 'export const enum',
    source: 'export const enum CE { A }',
    expected: [{ name: 'CE', kind: 'enum' }],
  },
  {
    title: 'export var / let / const (several declarators)',
    source: 'export var v = 1;\nexport let l = 1;\nexport const c = 1, d = 2;',
    expected: [
      { name: 'v', kind: 'variable' },
      { name: 'l', kind: 'variable' },
      { name: 'c', kind: 'variable' },
      { name: 'd', kind: 'variable' },
    ],
    js: true,
  },
  {
    title: 'exported object destructuring, nested, defaulted and rest',
    source: 'export const { a, b: c, d = 1, e: { f }, ...rest } = o;',
    expected: [
      { name: 'a', kind: 'variable' },
      { name: 'c', kind: 'variable' },
      { name: 'd', kind: 'variable' },
      { name: 'f', kind: 'variable' },
      { name: 'rest', kind: 'variable' },
    ],
    js: true,
  },
  {
    title: 'exported array destructuring',
    source: 'export const [x, , y = 1, [z], ...w] = arr;',
    expected: [
      { name: 'x', kind: 'variable' },
      { name: 'y', kind: 'variable' },
      { name: 'z', kind: 'variable' },
      { name: 'w', kind: 'variable' },
    ],
    js: true,
  },
  {
    title: 'destructuring outside an export is not an export',
    source:
      'function helper({ p }) { const [q] = p; return q; }\nexport let { kept } = o;',
    expected: [{ name: 'kept', kind: 'variable' }],
    js: true,
  },
  {
    title: 'export default named function keeps its name',
    source: 'export default function named() {}',
    expected: [{ name: 'named', kind: 'function', isDefault: true }],
    js: true,
  },
  {
    title: 'export default anonymous function',
    source: 'export default function () {}',
    expected: [{ name: 'default', kind: 'function', isDefault: true }],
    js: true,
  },
  {
    title: 'export default arrow function',
    source: 'export default async () => 1;',
    expected: [{ name: 'default', kind: 'function', isDefault: true }],
    js: true,
  },
  {
    title: 'export default named class keeps its name',
    source: 'export default class Named {}',
    expected: [{ name: 'Named', kind: 'class', isDefault: true }],
    js: true,
  },
  {
    title: 'export default anonymous class',
    source: 'export default class {}',
    expected: [{ name: 'default', kind: 'class', isDefault: true }],
    js: true,
  },
  {
    title: 'export default expression',
    source: 'export default 42;',
    expected: [{ name: 'default', kind: 'variable', isDefault: true }],
    js: true,
  },
  {
    title: 'export default identifier records the local name',
    source: 'const local = 1;\nexport default local;',
    expected: [
      { name: 'default', kind: 'unknown', isDefault: true, localName: 'local' },
    ],
    js: true,
  },
  {
    title: 'export default interface (TS)',
    source: 'export default interface DefI {}',
    expected: [{ name: 'DefI', kind: 'interface', isDefault: true }],
  },
  {
    title: 'local export clause with alias',
    source: 'const a = 1, d = 2;\nexport { a as b, d };',
    expected: [
      { name: 'b', kind: 'unknown', localName: 'a' },
      { name: 'd', kind: 'unknown' },
    ],
    js: true,
  },
  {
    title: 'export { x as default }',
    source: 'const x = 1;\nexport { x as default };',
    expected: [
      { name: 'default', kind: 'unknown', isDefault: true, localName: 'x' },
    ],
    js: true,
  },
  {
    title: 'named re-export with alias is one record',
    source: `export { e as f, g } ${FROM} './m';`,
    expected: [
      {
        name: 'f',
        kind: 'unknown',
        isReExport: true,
        source: './m',
        localName: 'e',
      },
      { name: 'g', kind: 'unknown', isReExport: true, source: './m' },
    ],
    js: true,
  },
  {
    title: 're-export of default',
    source: `export { default } ${FROM} './m';\nexport { default as G } ${FROM} './n';`,
    expected: [
      {
        name: 'default',
        kind: 'unknown',
        isDefault: true,
        isReExport: true,
        source: './m',
      },
      {
        name: 'G',
        kind: 'unknown',
        isReExport: true,
        source: './n',
        localName: 'default',
      },
    ],
    js: true,
  },
  {
    title: 'type-only re-exports (TS)',
    source: `export type { TT } ${FROM} './m';\nexport { type T2, U } ${FROM} './n';`,
    expected: [
      { name: 'TT', kind: 'unknown', isReExport: true, source: './m' },
      { name: 'T2', kind: 'unknown', isReExport: true, source: './n' },
      { name: 'U', kind: 'unknown', isReExport: true, source: './n' },
    ],
  },
  {
    title: 'wildcard re-exports, one per module',
    source: `export * ${FROM} './m';\nexport * ${FROM} './n';`,
    expected: [
      { name: '*', kind: 'wildcard', isReExport: true, source: './m' },
      { name: '*', kind: 'wildcard', isReExport: true, source: './n' },
    ],
    js: true,
  },
  {
    title: 'namespace re-export',
    source: `export * as ns ${FROM} './m';`,
    expected: [
      { name: 'ns', kind: 'namespace', isReExport: true, source: './m' },
    ],
    js: true,
  },
  {
    title: 'export declare forms (TS)',
    source: [
      'export declare const dc: number;',
      'export declare let dl: number;',
      'export declare function df(): void;',
      'export declare class DC {}',
      'export declare abstract class DAC {}',
      'export declare interface DI {}',
      'export declare type DT = string;',
      'export declare enum DE { A }',
      'export declare namespace DN {}',
    ].join('\n'),
    expected: [
      { name: 'dc', kind: 'variable' },
      { name: 'dl', kind: 'variable' },
      { name: 'df', kind: 'function' },
      { name: 'DC', kind: 'class' },
      { name: 'DAC', kind: 'class' },
      { name: 'DI', kind: 'interface' },
      { name: 'DT', kind: 'type' },
      { name: 'DE', kind: 'enum' },
      { name: 'DN', kind: 'namespace' },
    ],
  },
  {
    title: 'abstract class (TS)',
    source: 'export abstract class AC { abstract run(): void; }',
    expected: [{ name: 'AC', kind: 'class' }],
  },
  {
    title: 'overloads are one symbol (TS)',
    source: [
      'export function ov(a: string): void;',
      'export function ov(a: number): void;',
      'export function ov(a: unknown) {}',
      'export declare function amb(a: string): void;',
      'export declare function amb(a: number): void;',
    ].join('\n'),
    expected: [
      { name: 'ov', kind: 'function' },
      { name: 'amb', kind: 'function' },
    ],
  },
  {
    title: 'namespace and declaration merging keep one record per kind (TS)',
    source:
      'export namespace N {}\nexport interface M {}\nexport namespace M {}',
    expected: [
      { name: 'N', kind: 'namespace' },
      { name: 'M', kind: 'interface' },
      { name: 'M', kind: 'namespace' },
    ],
  },
  {
    title: 'function, generator, async function and class',
    source:
      'export function f() {}\nexport function* gen() {}\nexport async function af() {}\nexport class K {}',
    expected: [
      { name: 'f', kind: 'function' },
      { name: 'gen', kind: 'function' },
      { name: 'af', kind: 'function' },
      { name: 'K', kind: 'class' },
    ],
    js: true,
  },
  // R4-01: specifiers are decoded from their nodes, never by splitting text.
  {
    title: 'comment before `as` in an export specifier',
    source: 'const a = 1;\nexport { a /* c */ as b };',
    expected: [{ name: 'b', kind: 'unknown', localName: 'a' }],
    js: true,
  },
  {
    title: 'comment after `as` in an export specifier',
    source: 'const a = 1;\nexport { a as /* public name */ b };',
    expected: [{ name: 'b', kind: 'unknown', localName: 'a' }],
    js: true,
  },
  {
    title: 'string-literal exported name',
    source: 'const a = 1;\nexport { a as "x-y" };',
    expected: [{ name: 'x-y', kind: 'unknown', localName: 'a' }],
    js: true,
  },
  {
    title: 'string-literal re-exported names',
    source: `export { "q n" as c } ${FROM} './m';\nexport * as "s-t" ${FROM} './n';`,
    expected: [
      {
        name: 'c',
        kind: 'unknown',
        isReExport: true,
        source: './m',
        localName: 'q n',
      },
      { name: 's-t', kind: 'namespace', isReExport: true, source: './n' },
    ],
    js: true,
  },
  {
    title: 'inline type modifier with alias (TS)',
    source: 'type T3 = string;\nexport { type T3 as T4 };',
    expected: [{ name: 'T4', kind: 'unknown', localName: 'T3' }],
  },
  // R4-02: module-system exports are records, not a silent empty list.
  {
    title: 'export = identifier (TS)',
    source: 'const value = 1;\nexport = value;',
    expected: [{ name: 'export=', kind: 'unknown', localName: 'value' }],
  },
  {
    title: 'export = expression (TS)',
    source: 'export = { a: 1 };',
    expected: [{ name: 'export=', kind: 'variable' }],
  },
  {
    title: 'export as namespace (TS)',
    source:
      'declare const lib: number;\nexport = lib;\nexport as namespace UMD;',
    expected: [
      { name: 'export=', kind: 'unknown', localName: 'lib' },
      { name: 'UMD', kind: 'namespace' },
    ],
  },
  {
    title: 'export import alias of a namespace member (TS)',
    source: 'export import X = N.Y;',
    expected: [{ name: 'X', kind: 'unknown', localName: 'N.Y' }],
  },
  {
    title: 'export import alias of a required module (TS)',
    // This grammar splits `require('m')` off with a MISSING ";".
    source: `export import R = require('m');`,
    expected: [{ name: 'R', kind: 'namespace', isReExport: true, source: 'm' }],
    parseStatus: 'recovered',
  },
  {
    title: 'CommonJS module.exports and exports assignments',
    source: [
      'module.exports = main;',
      'exports.run = function () {};',
      'module.exports.Klass = class {};',
      'exports.count = 1;',
      'exports.default = main;',
    ].join('\n'),
    expected: [
      { name: 'export=', kind: 'unknown', localName: 'main' },
      { name: 'run', kind: 'function' },
      { name: 'Klass', kind: 'class' },
      { name: 'count', kind: 'variable' },
      { name: 'default', kind: 'unknown', isDefault: true, localName: 'main' },
    ],
    js: true,
  },
  {
    title: 'compiled CommonJS: Object.defineProperty(exports, ...)',
    source: [
      'Object.defineProperty(exports, "__esModule", { value: true });',
      'Object.defineProperty(exports, "helper", { enumerable: true, get: function () { return m.helper; } });',
    ].join('\n'),
    expected: [{ name: 'helper', kind: 'unknown' }],
    js: true,
  },
  {
    title: 'unextracted CommonJS forms are reported, not dropped',
    source: 'exports[key] = 1;\nconst self = module.exports;',
    expected: [],
    unextracted: ['line 1: exports', 'line 2: module.exports'],
    js: true,
  },
  // Batch 24d R5-02: constant-string bracket access is the same CommonJS
  // export as the dot form, never a clean empty answer.
  {
    title: 'CommonJS module["exports"].name (R5-02 probe)',
    source: 'module["exports"].actual = 1;',
    expected: [{ name: 'actual', kind: 'variable' }],
    js: true,
  },
  {
    title: 'CommonJS bracket forms with constant string keys',
    source: [
      "module['exports'] = main;",
      'exports["a-b"] = 1;',
      'module.exports["run"] = function () {};',
      'module["exports"]["Klass"] = class {};',
    ].join('\n'),
    expected: [
      { name: 'export=', kind: 'unknown', localName: 'main' },
      { name: 'a-b', kind: 'variable' },
      { name: 'run', kind: 'function' },
      { name: 'Klass', kind: 'class' },
    ],
    js: true,
  },
  {
    title: 'CommonJS bracket forms with a computed key stay unextracted',
    source: [
      'module["exports"][key] = 1;',
      'const self = module["exports"];',
      'exports[`t`] = 1;',
    ].join('\n'),
    expected: [],
    unextracted: [
      'line 1: module["exports"]',
      'line 2: module["exports"]',
      'line 3: exports',
    ],
    js: true,
  },
  // Batch 24d review r1 R24d-01: the WHOLE decoded module key decides, never
  // one string fragment of it.
  {
    title: 'escaped module key that evaluates to "exports" (R24d-01)',
    source: [
      'module["\\u0065xports"].actual = 1;',
      "module['export\\x73'] = main;",
    ].join('\n'),
    expected: [
      { name: 'actual', kind: 'variable' },
      { name: 'export=', kind: 'unknown', localName: 'main' },
    ],
    js: true,
  },
  {
    title: 'computed module key is disclosed, never clean-empty (R24d-01)',
    source: [
      'const k = "exports";',
      'module[k].actual = 1;',
      'module[k] = main;',
      'const view = module[`exports`];',
    ].join('\n'),
    expected: [],
    unextracted: [
      'line 2: module[k].actual',
      'line 3: module[k]',
      'line 4: module[`exports`]',
    ],
    js: true,
  },
  {
    title:
      'a key that only contains "exports" is not the export object (R24d-01)',
    source: [
      'module["exports\\x78"].actual = 1;',
      'module["id"] = 2;',
      'const loaded = module["loaded"];',
    ].join('\n'),
    expected: [],
    js: true,
  },
  // R24d-04: legacy (sloppy-mode) escapes decode to the runtime key.
  {
    title: 'legacy octal and non-octal decimal escapes (R24d-04)',
    source: [
      'exports["\\141"] = 1;',
      'exports["\\8"] = 2;',
      'exports["\\400"] = 3;',
      'exports["\\0"] = 4;',
    ].join('\n'),
    expected: [
      { name: 'a', kind: 'variable' },
      { name: '8', kind: 'variable' },
      { name: ' 0', kind: 'variable' },
      { name: '\0', kind: 'variable' },
    ],
    js: true,
  },
  {
    title: 'a name that cannot be decoded exactly is disclosed, not guessed',
    source: ['const a = 1;', 'export { a as "\\u{110000}" };'].join('\n'),
    expected: [],
    unextracted: ['line 2: a as "\\u{110000}"'],
    js: true,
  },
  // Batch 24d R5-03: string names are their semantic value, escapes decoded.
  {
    title: 'escaped string-literal export names (R5-03 probe)',
    source: [
      'const a = 1;',
      'export { a as "x\\u002dy", a as "\\x41\\u{42}", a as \'q\\\'s\', a as "t\\\\u" };',
    ].join('\n'),
    expected: [
      { name: 'x-y', kind: 'unknown', localName: 'a' },
      { name: 'AB', kind: 'unknown', localName: 'a' },
      { name: "q's", kind: 'unknown', localName: 'a' },
      { name: 't\\u', kind: 'unknown', localName: 'a' },
    ],
    js: true,
  },
  {
    title: 'escaped string-literal re-export and local names',
    source: `export { "l\\u006fcal" as "p\\u0075b" } ${FROM} './m';`,
    expected: [
      {
        name: 'pub',
        kind: 'unknown',
        isReExport: true,
        source: './m',
        localName: 'local',
      },
    ],
    js: true,
  },
  {
    title: 'escaped Object.defineProperty and bracket names',
    source: [
      'Object.defineProperty(exports, "b\\u0063", { value: 2 });',
      'exports["q\\u0072"] = 1;',
    ].join('\n'),
    expected: [
      { name: 'bc', kind: 'unknown' },
      { name: 'qr', kind: 'variable' },
    ],
    js: true,
  },
];

/** Drops absent optional fields so `toEqual` compares exactly what is set. */
function normalise(records: readonly ExportInfo[]): Expected[] {
  return records.map((record) => {
    const out: Expected = { name: record.name, kind: record.kind };
    if (record.isDefault) out.isDefault = true;
    if (record.isReExport) out.isReExport = true;
    if (record.source !== undefined) out.source = record.source;
    if (record.localName !== undefined) out.localName = record.localName;
    return out;
  });
}

function identity(record: Pick<ExportInfo, 'name' | 'kind' | 'source'>) {
  return `${record.name}|${record.kind}|${record.source ?? ''}`;
}

describe('JS/TS export extraction (real tree-sitter WASM)', () => {
  let parser: TreeSitterParserService;
  let analysis: AstAnalysisService;

  beforeAll(() => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      lifecycle: jest.fn(),
      dispose: jest.fn(),
    } as unknown as Logger;
    parser = new TreeSitterParserService(logger);
    analysis = new AstAnalysisService(logger, parser);
  });

  afterAll(() => {
    parser?.dispose();
  });

  async function analyze(
    source: string,
    language: SupportedLanguage,
  ): Promise<CodeInsights> {
    const result = await analysis.analyzeSource(source, language);
    if (result.isErr() || !result.value) {
      throw result.error ?? new Error('analyzeSource returned no insights');
    }
    return result.value;
  }

  async function queryExports(
    source: string,
    language: SupportedLanguage,
  ): Promise<ExportInfo[]> {
    const result = await parser.queryExports(source, language);
    if (result.isErr()) {
      throw result.error ?? new Error('queryExports failed');
    }
    return extractExportsFromMatches(result.value ?? []).exports;
  }

  const runs = CASES.flatMap((c) =>
    (c.js
      ? (['typescript', 'javascript'] as const)
      : (['typescript'] as const)
    ).map((language) => ({ ...c, language })),
  );

  it.each(runs)(
    '$title ($language)',
    async ({ source, language, expected, parseStatus, unextracted }) => {
      const insights = await analyze(source, language);
      expect(insights.parseStatus).toBe(parseStatus ?? 'ok');
      expect(insights.unextractedExports).toEqual(unextracted);
      const viaAnalysis = insights.exports ?? [];
      expect(normalise(viaAnalysis)).toEqual(expected);

      const identities = viaAnalysis.map(identity);
      expect(new Set(identities).size).toBe(identities.length);

      // ptah.ast.queryExports decodes the same query the same way.
      expect(normalise(await queryExports(source, language))).toEqual(expected);
    },
    60_000,
  );

  it('keeps the JavaScript query free of TypeScript-only node types', async () => {
    // A TS node name in the JS query fails compilation and returns an error.
    const result = await parser.queryExports(
      'export interface I {}',
      'javascript',
    );
    expect(result.isOk()).toBe(true);
  });

  describe('real repository files against an independent census', () => {
    const srcRoot = path.resolve(__dirname, '..');

    /**
     * Every export a line-anchored regex can see in the file: declarations,
     * `{ ... }` clauses (multiline, with aliases and sources) and `*` forms.
     */
    function census(
      text: string,
    ): Array<Pick<ExportInfo, 'name' | 'kind' | 'source'>> {
      const found: Array<Pick<ExportInfo, 'name' | 'kind' | 'source'>> = [];
      const kinds: Record<string, ExportInfo['kind']> = {
        interface: 'interface',
        type: 'type',
        enum: 'enum',
        class: 'class',
        function: 'function',
        const: 'variable',
        let: 'variable',
        var: 'variable',
        namespace: 'namespace',
      };
      const declaration =
        /^export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:const\s+(?=enum))?(interface|type|enum|class|function|const|let|var|namespace)\*?\s+([A-Za-z_$][\w$]*)/gm;
      for (const m of text.matchAll(declaration)) {
        found.push({ name: m[2], kind: kinds[m[1]] });
      }
      const clause =
        /^export\s+(?:type\s+)?\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/gm;
      for (const m of text.matchAll(clause)) {
        for (const entry of m[1].split(',')) {
          const parts = entry
            .trim()
            .replace(/^type\s+/, '')
            .split(/\s+as\s+/);
          if (parts[0] === '') continue;
          found.push({
            name: parts[parts.length - 1],
            kind: 'unknown',
            source: m[2],
          });
        }
      }
      const star =
        /^export\s+\*\s+(?:as\s+([A-Za-z_$][\w$]*)\s+)?from\s*['"]([^'"]+)['"]/gm;
      for (const m of text.matchAll(star)) {
        found.push(
          m[1]
            ? { name: m[1], kind: 'namespace', source: m[2] }
            : { name: '*', kind: 'wildcard', source: m[2] },
        );
      }
      return found;
    }

    it.each([
      ['ast/ast.types.ts', 3, 0],
      ['types/workspace.types.ts', 11, 0],
      ['index.ts', undefined, 7],
    ] as const)(
      '%s: every exported name, once, including wildcard re-exports',
      async (relative, declarations, wildcards) => {
        const text = fs.readFileSync(path.join(srcRoot, relative), 'utf8');
        const expected = census(text);
        if (declarations !== undefined) {
          expect(expected).toHaveLength(declarations);
        }
        expect(expected.filter((e) => e.kind === 'wildcard')).toHaveLength(
          wildcards,
        );

        const insights = await analyze(text, 'typescript');
        expect(insights.parseStatus).toBe('ok');
        expect(insights.unextractedExports).toBeUndefined();
        const actual = insights.exports ?? [];
        expect(actual.map(identity).sort()).toEqual(
          expected.map(identity).sort(),
        );
        expect(new Set(actual.map(identity)).size).toBe(actual.length);
      },
      60_000,
    );
  });
});

describe('exportSymbolNames (symbol index names)', () => {
  it('lists each exported name once and keeps each wildcard source distinct', () => {
    expect(
      exportSymbolNames([
        { name: 'ov', kind: 'function' },
        { name: 'M', kind: 'interface' },
        { name: 'M', kind: 'namespace' },
        { name: '*', kind: 'wildcard', isReExport: true, source: './a' },
        { name: '*', kind: 'wildcard', isReExport: true, source: './b' },
        { name: 'ns', kind: 'namespace', isReExport: true, source: './c' },
      ]),
    ).toEqual(['ov', 'M', '* from ./a', '* from ./b', 'ns']);
  });
});
