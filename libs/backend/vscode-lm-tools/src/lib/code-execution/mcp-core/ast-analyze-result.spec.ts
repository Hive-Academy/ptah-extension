/**
 * What `ptah_ast_analyze` returns, measured on the REAL parser (TASK_2026_559
 * Batch 20.2p).
 *
 * The prompt contract says the tool costs "40-60% fewer tokens than Read"
 * (`ptah-core-prompt.ts:48`, `tool-description.builder.ts:1665`). Plain
 * `JSON.stringify` of the namespace result saved only ~26% on a
 * function-heavy 300-line file, because every record repeats its field names.
 * The dispatcher now writes the result with `formatAstAnalysisResult`; these
 * specs run the real `buildAstNamespace` + `AstAnalysisService` +
 * `TreeSitterParserService` and prove the text is:
 *  - lossless: every field of the old JSON result is recovered from it;
 *  - at least 40% smaller in gpt-tokenizer tokens than the source file;
 *  - led by parse status and coverage, including on a file with syntax errors.
 *
 * The two shims are the ones `code-outliner.adapter.spec.ts` documents.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  AstAnalysisService,
  TreeSitterParserService,
  formatAstAnalysisResult,
} from '@ptah-extension/workspace-intelligence';
import {
  FileType,
  compactCoverage,
  isCleanAnswer,
  type IFileSystemProvider,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { countTokens } from '@ptah-extension/tool-output-reducers';
import { buildAstNamespace } from '../namespace-builders/ast-namespace.builder';
import type { AstNamespace } from '../types';

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

const ROOT = 'D:/ws';

function silentLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

/**
 * A 300-line, function-heavy service module: imports, one class with
 * methods, then short exported helpers — the shape where per-record JSON
 * keys cost the most.
 */
function generateSource(lineCount: number): string {
  const lines = [
    "import { readFile } from 'node:fs/promises';",
    "import * as path from 'node:path';",
    "import type { Logger } from './logger';",
    '',
    'export class RecordStore {',
    '  private readonly cache = new Map<string, number>();',
    '  constructor(private readonly logger: Logger) {}',
  ];
  for (let m = 0; m < 6; m++) {
    lines.push(
      `  async load${m}(key: string, fallback: number): Promise<number> {`,
      `    const hit = this.cache.get(key) ?? fallback;`,
      `    this.logger.debug(path.join(key, '${m}'));`,
      '    return hit;',
      '  }',
    );
  }
  lines.push('}', '');
  let n = 0;
  while (lines.length + 7 <= lineCount) {
    lines.push(
      `export function transformRecord${n}(input: string, factor: number, label?: string): string {`,
      `  const scaled = input.length * factor + ${n};`,
      `  const text = label ? label + ':' + scaled : String(scaled);`,
      `  return text.padStart(${(n % 7) + 2}, '0');`,
      '}',
      '',
    );
    n++;
  }
  lines.push('export const RECORD_LIMIT = 100;');
  while (lines.length < lineCount - 1) {
    lines.push('');
  }
  lines.push('export default RecordStore;');
  return lines.join('\n');
}

const BROKEN_SOURCE = [
  "import { join } from 'node:path';",
  '',
  'export function intact(a: string, b: number): string {',
  '  return join(a, String(b));',
  '}',
  '',
  'export function broken(a: string {',
  '  return a +;',
  '}',
  '',
  'export function alsoIntact(c: number): number {',
  '  return c * 2;',
  '}',
].join('\n');

/** Inverse of the table form, written from its documented rules only. */
function decode(text: string): Record<string, unknown> {
  const out = JSON.parse(text) as Record<string, unknown>;
  for (const [key, value] of Object.entries(out)) {
    if (!isTable(value)) {
      continue;
    }
    const [header, ...rows] = value;
    out[key] = rows.map((row) => {
      const record: Record<string, unknown> = {};
      header.forEach((column, i) => {
        if (i < row.length && row[i] !== null) {
          record[column] = row[i];
        }
      });
      return record;
    });
  }
  return out;
}

function isTable(value: unknown): value is [string[], ...unknown[][]] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((row) => Array.isArray(row)) &&
    (value[0] as unknown[]).every((cell) => typeof cell === 'string')
  );
}

describe('ptah_ast_analyze result text (real parser)', () => {
  const files = new Map<string, string>();
  let parser: TreeSitterParserService;
  let ast: AstNamespace;

  beforeAll(async () => {
    parser = new TreeSitterParserService(silentLogger());
    const init = await parser.initialize();
    if (init.isErr()) {
      throw init.error ?? new Error('tree-sitter initialisation failed');
    }
    const fileSystemProvider = {
      stat: async () => ({ type: FileType.File }),
      readFile: async (p: string) => {
        const content = files.get(p);
        if (content === undefined) {
          throw new Error(`no such file: ${p}`);
        }
        return content;
      },
    } as unknown as IFileSystemProvider;
    const workspaceProvider = {
      getWorkspaceRoot: () => ROOT,
    } as unknown as IWorkspaceProvider;
    ast = buildAstNamespace({
      treeSitterParser: parser,
      astAnalysis: new AstAnalysisService(silentLogger(), parser),
      fileSystemProvider,
      workspaceProvider,
    });
    files.set(`${ROOT}/src/record-store.ts`, generateSource(300));
    files.set(`${ROOT}/src/broken.ts`, BROKEN_SOURCE);
    // Loading the WASM grammars exceeds Jest's 5 s default under parallel load.
  }, 60_000);

  afterAll(() => {
    parser?.dispose();
  });

  it('is lossless: every field of the JSON result is recovered from the tables', async () => {
    const result = await ast.analyze(`${ROOT}/src/record-store.ts`);
    const text = formatAstAnalysisResult(result);
    const parsed = JSON.parse(text) as Record<string, unknown>;

    for (const list of ['functions', 'classes', 'imports', 'exports']) {
      expect(isTable(parsed[list])).toBe(true);
    }
    expect(result.functions.length).toBeGreaterThan(40);
    expect(decode(text)).toEqual(JSON.parse(JSON.stringify(result)));
  });

  it('is at least 40% smaller in tokens than reading the 300-line file', async () => {
    const source = files.get(`${ROOT}/src/record-store.ts`) ?? '';
    expect(source.split('\n')).toHaveLength(300);

    const result = await ast.analyze(`${ROOT}/src/record-store.ts`);
    const sourceTokens = countTokens(source);
    const resultTokens = countTokens(formatAstAnalysisResult(result));

    expect(1 - resultTokens / sourceTokens).toBeGreaterThanOrEqual(0.4);
  });

  // Lane H merge (Batches 22c + 24r): the namespace result carries the full
  // coverage with its verdict first; the dispatcher writes it in the compact
  // form (`withCompactCoverage`), so a clean parse is `{clean, analyzed}`.
  it('keeps parse status and coverage ahead of the tables', async () => {
    const result = await ast.analyze(`${ROOT}/src/record-store.ts`);
    expect(Object.keys(result.coverage).slice(0, 2)).toEqual([
      'clean',
      'reasons',
    ]);
    const text = formatAstAnalysisResult({
      ...result,
      coverage: compactCoverage(result.coverage),
    });

    expect(text).toMatch(
      /^\{"parseStatus":"ok","errorNodeCount":0,"errorNodeCountCapped":false,"coverage":\{"clean":true,"analyzed":1\},"file":"D:\/ws\/src\/record-store\.ts","language":"typescript","functions":\[\["name","parameters","startLine","endLine"\],/,
    );
  });

  it('still reports a recovered parse, with coverage, for a file with syntax errors', async () => {
    const result = await ast.analyze(`${ROOT}/src/broken.ts`);
    const text = formatAstAnalysisResult(result);
    const parsed = JSON.parse(text) as {
      parseStatus: string;
      errorNodeCount: number;
      coverage: { analyzed: number; failed: number };
      functions: unknown[][];
    };

    expect(text.startsWith('{"parseStatus":"recovered",')).toBe(true);
    expect(parsed.errorNodeCount).toBeGreaterThan(0);
    expect(parsed.coverage).toMatchObject({ analyzed: 0, failed: 1 });
    expect(parsed.functions[0]).toEqual([
      'name',
      'parameters',
      'startLine',
      'endLine',
    ]);
    expect(parsed.functions.map((row) => row[0])).toContain('alsoIntact');
    expect(decode(text)).toEqual(JSON.parse(JSON.stringify(result)));
  });

  // Batch 20.2q narrow fix (Decision 22): the r4-postcap reviewer's probes.
  describe('export forms beyond ES declarations', () => {
    async function analyzeSource(name: string, source: string) {
      files.set(`${ROOT}/src/${name}`, source);
      return ast.analyze(`${ROOT}/src/${name}`);
    }

    it('reports `export = value` as a clean, non-empty answer (R4-02)', async () => {
      const result = await analyzeSource(
        'assign.ts',
        'const value = 1;\nexport = value;',
      );
      expect(result.parseStatus).toBe('ok');
      expect(result.exports).toEqual([
        { name: 'export=', kind: 'unknown', localName: 'value' },
      ]);
      expect(result.unextractedExports).toBeUndefined();
      expect(isCleanAnswer(result.coverage)).toBe(true);
    });

    it('reports `export import Alias = Other` as an exported alias (R4-02)', async () => {
      const result = await analyzeSource(
        'alias.ts',
        'export import Alias = Other;',
      );
      expect(result.exports).toEqual([
        { name: 'Alias', kind: 'unknown', localName: 'Other' },
      ]);
    });

    it('never returns a clean empty answer for an unextracted CommonJS form (R4-02)', async () => {
      const result = await analyzeSource('dynamic.ts', 'exports[key] = 1;');
      expect(result.parseStatus).toBe('ok');
      expect(result.exports).toEqual([]);
      expect(result.unextractedExports).toEqual(['line 1: exports']);
      expect(result.coverage).toMatchObject({
        analyzed: 0,
        failed: 1,
        failedByReason: { 'unsupported-syntax': 1 },
      });
      expect(isCleanAnswer(result.coverage)).toBe(false);
      // The reason is serialised right after coverage, ahead of the tables.
      expect(formatAstAnalysisResult(result)).toMatch(
        /"coverage":\{[^[]*(\[[^\]]*\][^[]*)*\},"unextractedExports":\["line 1: exports"\],"file"/,
      );
    });

    it('decodes aliases around comments and string names from nodes (R4-01)', async () => {
      const result = await analyzeSource(
        'aliases.ts',
        'const a = 1;\nexport { a /* c */ as b, a as /* public name */ d, a as "x-y" };',
      );
      expect(result.exports).toEqual([
        { name: 'b', kind: 'unknown', localName: 'a' },
        { name: 'd', kind: 'unknown', localName: 'a' },
        { name: 'x-y', kind: 'unknown', localName: 'a' },
      ]);
    });
  });
});
