/**
 * `formatAstAnalysisResult` — the table form of an AST analysis result
 * (TASK_2026_559 Batch 20.2p). The real-parser token and round-trip checks
 * live in vscode-lm-tools `ast-analyze-result.spec.ts`; these pin the format
 * rules on hand-built records.
 */
import { formatAstAnalysisResult } from './ast-result-format';

function parse(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

describe('formatAstAnalysisResult', () => {
  it('writes a list of records as a header row plus one row per record', () => {
    const text = formatAstAnalysisResult({
      parseStatus: 'ok',
      functions: [
        { name: 'load', parameters: ['id'], startLine: 3, endLine: 9 },
        { name: 'save', parameters: [], startLine: 11, endLine: 20 },
      ],
    });
    expect(text).toBe(
      '{"parseStatus":"ok","functions":[["name","parameters","startLine","endLine"],' +
        '["load",["id"],3,9],["save",[],11,20]]}',
    );
  });

  it('keeps the top-level key order, so status and coverage stay first', () => {
    const text = formatAstAnalysisResult({
      parseStatus: 'recovered',
      errorNodeCount: 2,
      errorNodeCountCapped: false,
      coverage: { census: 'complete', failed: 1 },
      file: 'a.ts',
      language: 'typescript',
      functions: [{ name: 'f', parameters: [] }],
      classes: [],
    });
    expect(Object.keys(parse(text))).toEqual([
      'parseStatus',
      'errorNodeCount',
      'errorNodeCountCapped',
      'coverage',
      'file',
      'language',
      'functions',
      'classes',
    ]);
    expect(parse(text)['functions']).toEqual([
      ['name', 'parameters'],
      ['f', []],
    ]);
  });

  it('writes an absent field as null inside a row and drops trailing absent fields', () => {
    const text = formatAstAnalysisResult({
      exports: [
        { name: 'a', kind: 'function' },
        { name: 'b', kind: 'unknown', isReExport: true, source: './b' },
        { name: 'c', kind: 'class', isDefault: true, isReExport: undefined },
        { name: 'd', kind: 'unknown', source: './d' },
      ],
    });
    expect(parse(text)['exports']).toEqual([
      ['name', 'kind', 'isReExport', 'source', 'isDefault'],
      ['a', 'function'],
      ['b', 'unknown', true, './b'],
      ['c', 'class', null, null, true],
      ['d', 'unknown', null, './d'],
    ]);
  });

  it('leaves a list unchanged when a real null would be ambiguous with an absent field', () => {
    const records = [
      { name: 'a', endLine: null },
      { name: 'b', endLine: 4 },
    ];
    expect(parse(formatAstAnalysisResult({ functions: records }))).toEqual({
      functions: records,
    });
  });

  it('leaves empty lists, non-record lists and nested records as JSON writes them', () => {
    const input = {
      imports: [],
      supportedLanguages: ['typescript', 'python'],
      classes: [
        {
          name: 'Box',
          methods: [{ name: 'open', parameters: [] }],
        },
      ],
    };
    expect(parse(formatAstAnalysisResult(input))).toEqual({
      imports: [],
      supportedLanguages: ['typescript', 'python'],
      classes: [
        ['name', 'methods'],
        ['Box', [{ name: 'open', parameters: [] }]],
      ],
    });
  });
});
