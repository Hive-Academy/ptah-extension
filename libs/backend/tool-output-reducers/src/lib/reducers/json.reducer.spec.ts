import { countTokens } from '../token-measure';
import { reduceJson } from './json.reducer';

const ctx = { budgetTokens: 2000 };

/** Pretty-print the way most tool formatters do. */
function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** The table block labelled `label`, parsed into header keys and row cells. */
function parseTable(
  text: string,
  label: string,
): { header: string[]; rows: string[][] } {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`${label} (`));
  if (start < 0) {
    throw new Error(`no table labelled ${label} in:\n${text}`);
  }
  // A delimiter is a pipe not escaped with a backslash.
  const cells = (line: string): string[] =>
    line.slice(1, -1).split(/(?<!\\)\|/);
  const header = cells(lines[start + 1]);
  expect(lines[start + 2]).toBe(`|${'---|'.repeat(header.length)}`);
  const rows: string[][] = [];
  for (let i = start + 3; i < lines.length && lines[i].startsWith('|'); i++) {
    rows.push(cells(lines[i]));
  }
  return { header, rows };
}

/** How the reducer renders a string scalar in a cell: bare, or JSON-quoted. */
function stringCellForms(value: string): string[] {
  return [value, JSON.stringify(value).replace(/\|/g, '\\|')];
}

interface Row {
  id: number;
  name: string;
  active: boolean;
  score: number;
  tags: string[];
  note: string | null;
  meta: { owner: string };
}

/** 300 deterministic rows, pretty-printed to roughly 50 KB. */
function rows300(): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < 300; i++) {
    rows.push({
      id: i,
      name: `item-${i}`,
      active: i % 3 !== 0,
      score: i % 5 === 0 ? 0 : i * 7,
      tags: i % 4 === 0 ? [] : [`t${i % 7}`],
      note: i % 2 === 0 ? null : i % 3 === 0 ? '' : `note ${i}`,
      meta: { owner: `t${i % 3}` },
    });
  }
  return rows;
}

describe('reduceJson — off-kind input (json-invalid)', () => {
  const offKind: Array<[string, string]> = [
    [
      'a log',
      '[2026-09-25T10:00:00] INFO server started\n[2026-09-25T10:00:01] ERROR: boom\n',
    ],
    ['Markdown', '# Title\n\nSome text with {braces} and [links](x).\n'],
    [
      'Python',
      '#!/usr/bin/env python\n# a comment\ndef f(x):\n    return {"a": x}\n',
    ],
    ['truncated JSON', '{"a": [1, 2, 3'],
    ['an empty string', ''],
  ];

  it.each(offKind)('returns %s byte-for-byte unchanged', (_name, input) => {
    const result = reduceJson(input, ctx);
    expect(result.text).toBe(input);
    expect(result.reducer).toBe('json-invalid');
  });
});

describe('reduceJson — nothing to compact (json-unchanged)', () => {
  it.each([
    ['null', 'null'],
    ['an empty string literal', '""'],
    ['a number', '  42  '],
    ['a long string literal', JSON.stringify('x'.repeat(5000))],
    ['an empty object', '{}'],
    ['an empty array', '[\n]'],
    ['an object whose only field is null', '{"a":null}'],
    ['an object that prunes to nothing', pretty({ a: { b: [], c: '' } })],
  ])('returns %s unchanged, never empty', (_name, input) => {
    const result = reduceJson(input, ctx);
    expect(result.text).toBe(input);
    expect(result.reducer).toBe('json-unchanged');
  });

  it('returns already-compact JSON with nothing to drop unchanged', () => {
    const input = '{"a":1,"b":[1,2]}';
    expect(reduceJson(input, ctx)).toEqual(
      expect.objectContaining({ text: input, reducer: 'json-unchanged' }),
    );
  });

  it('returns the input unchanged when a number would lose precision', () => {
    const input = pretty({ pad: 'x'.repeat(40) }).replace(
      '{',
      '{\n  "big": 12345678901234567890,',
    );
    const result = reduceJson(input, ctx);
    expect(result.text).toBe(input);
    expect(result.reducer).toBe('json-unchanged');
  });

  it('returns the input unchanged when a number overflows to Infinity', () => {
    const input = '{\n  "n": 1e400,\n  "pad": "                "\n}';
    expect(reduceJson(input, ctx).text).toBe(input);
  });

  it('returns the input unchanged when an object repeats a key', () => {
    const input = '{\n  "a": 1,\n  "a": 2,\n  "b": null\n}';
    const result = reduceJson(input, ctx);
    expect(result.text).toBe(input);
    expect(result.reducer).toBe('json-unchanged');
  });

  it('does not throw on deeply nested input', () => {
    const input = '['.repeat(20000) + ']'.repeat(20000);
    expect(() => reduceJson(input, ctx)).not.toThrow();
    expect(reduceJson(input, ctx).text).toBe(input);
  });
});

describe('reduceJson — compaction', () => {
  it('drops null, empty strings, empty arrays and empty objects recursively', () => {
    const input = pretty({
      a: 1,
      b: null,
      c: '',
      d: [],
      e: {},
      f: { g: null, h: { i: '' }, j: 'kept' },
    });
    const result = reduceJson(input, ctx);
    expect(result.reducer).toBe('json-compact');
    expect(result.text).toBe('{"a":1,"f":{"j":"kept"}}');
  });

  it('never drops 0 or false', () => {
    const input = pretty({ zero: 0, no: false, gone: null, blank: '' });
    const result = reduceJson(input, ctx);
    expect(result.text).toBe('{"zero":0,"no":false}');
  });

  it('keeps array elements in place, including null, so indices keep their meaning', () => {
    const input = pretty({ values: [1, null, '', 3], empties: [{}, []] });
    expect(reduceJson(input, ctx).text).toBe(
      '{"values":[1,null,"",3],"empties":[{},[]]}',
    );
  });

  it('keeps a __proto__ key as data', () => {
    const input = '{\n  "__proto__": {\n    "x": 1\n  },\n  "y": null\n}';
    const result = reduceJson(input, ctx);
    expect(result.text).toBe('{"__proto__":{"x":1}}');
  });

  it('does not tabulate arrays of fewer than 3 objects', () => {
    const input = pretty({ rows: [{ a: 1 }, { a: 2 }] });
    expect(reduceJson(input, ctx).text).toBe('{"rows":[{"a":1},{"a":2}]}');
  });

  it('does not tabulate objects that share fewer than half their keys', () => {
    const input = pretty([
      { a: 1, b: 1 },
      { c: 2, d: 2 },
      { e: 3, a: 3 },
    ]);
    expect(reduceJson(input, ctx).text).toBe(
      '[{"a":1,"b":1},{"c":2,"d":2},{"e":3,"a":3}]',
    );
  });
});

describe('reduceJson — tables never merge rows or keys', () => {
  it('keeps rows that differ only in one value as distinct rows', () => {
    const input = pretty([
      { id: 1, name: 'x', status: 'open' },
      { id: 1, name: 'x', status: 'closed' },
      { id: 2, name: 'y' },
    ]);
    const result = reduceJson(input, ctx);
    const table = parseTable(result.text, '$');
    expect(table.header).toEqual(['id', 'name', 'status']);
    expect(table.rows).toEqual([
      ['1', 'x', 'open'],
      ['1', 'x', 'closed'],
      ['2', 'y', ''],
    ]);
  });

  it('keeps a value containing a pipe inside one cell', () => {
    const input = pretty([
      { k: 'a|b', v: 1 },
      { k: 'c', v: 2 },
      { k: 'd', v: 3 },
    ]);
    const table = parseTable(reduceJson(input, ctx).text, '$');
    expect(table.rows.every((row) => row.length === 2)).toBe(true);
    expect(table.rows[0][0]).toBe('"a\\|b"');
  });

  it('distinguishes a numeric string from a number, and a bare word from a literal', () => {
    const input = pretty([
      { v: '1', w: 'true' },
      { v: 1, w: true },
      { v: '1.5e3', w: 'plain' },
    ]);
    const table = parseTable(reduceJson(input, ctx).text, '$');
    expect(table.rows).toEqual([
      ['"1"', '"true"'],
      ['1', 'true'],
      ['"1.5e3"', 'plain'],
    ]);
  });

  it('shows a Windows path bare, and quotes a string with surrounding space or a line break', () => {
    const input = pretty([
      { p: 'D:\\repo\\a.ts' },
      { p: ' padded' },
      { p: `line${String.fromCharCode(0x2028)}break` },
      { p: 'C:\\dir\\' },
      { p: 'last' },
    ]);
    const table = parseTable(reduceJson(input, ctx).text, '$');
    expect(table.rows).toEqual([
      ['D:\\repo\\a.ts'],
      ['" padded"'],
      ['"line\\u2028break"'],
      // A trailing backslash would escape the delimiter, so it is quoted.
      ['"C:\\\\dir\\\\"'],
      ['last'],
    ]);
  });

  it('labels a nested table with its path and keeps the other fields as compact JSON', () => {
    const input = pretty({
      total: 3,
      page: { items: [{ a: 1 }, { a: 2 }, { a: 3 }], next: null },
    });
    const result = reduceJson(input, ctx);
    expect(result.text).toBe(
      [
        '{"total":3}',
        '$.page.items (3 rows):',
        '|a|',
        '|---|',
        '|1|',
        '|2|',
        '|3|',
      ].join('\n'),
    );
  });
});

describe('reduceJson — size and preserved content', () => {
  const rows = rows300();
  const input = pretty(rows);

  it('is a ~50 KB pretty-printed array of 300 objects', () => {
    expect(input.length).toBeGreaterThan(45_000);
    expect(input.length).toBeLessThan(55_000);
  });

  it('SIZE: shrinks to at most 40% of the input tokens', () => {
    const result = reduceJson(input, ctx);
    expect(result.reducer).toBe('json-compact');
    expect(countTokens(result.text)).toBeLessThanOrEqual(
      0.4 * countTokens(input),
    );
  });

  it('PRESERVED: every non-empty scalar of every row is in that row', () => {
    const table = parseTable(reduceJson(input, ctx).text, '$');
    expect(table.rows).toHaveLength(300);
    rows.forEach((row, index) => {
      const cells = new Map(
        table.header.map((key, column) => [key, table.rows[index][column]]),
      );
      expect(cells.get('id')).toBe(String(row.id));
      expect(cells.get('active')).toBe(String(row.active));
      expect(cells.get('score')).toBe(String(row.score));
      expect(stringCellForms(row.name)).toContain(cells.get('name'));
      if (row.note) {
        expect(stringCellForms(row.note)).toContain(cells.get('note'));
      } else {
        expect(cells.get('note')).toBe('');
      }
      if (row.tags.length > 0) {
        expect(cells.get('tags')).toBe(JSON.stringify(row.tags));
      } else {
        expect(cells.get('tags')).toBe('');
      }
      expect(cells.get('meta')).toBe(JSON.stringify({ owner: row.meta.owner }));
    });
  });
});

/**
 * Batch 24r: a caller's status block (a coverage verdict and its `null`
 * unknowns) must survive compaction untouched and ahead of the bulk.
 */
describe('reduceJson — preserveKeys', () => {
  const coverage = {
    clean: false,
    reasons: ['unknown-unrecognised'],
    census: 'complete',
    unchecked: 0,
    unrecognised: null,
    nonSource: null,
    excluded: null,
    byLanguage: {},
    notes: [],
  };
  const document = {
    hits: rows300(),
    meta: { empty: null, label: '' },
    coverage,
  };

  it('keeps a preserved value verbatim, nulls and empties included, and first', () => {
    const input = pretty(document);
    const result = reduceJson(input, {
      ...ctx,
      preserveKeys: ['coverage'],
    });

    expect(result.reducer).toBe('json-compact');
    const head = JSON.parse(result.text.split('\n')[0]) as Record<
      string,
      unknown
    >;
    expect(Object.keys(head)[0]).toBe('coverage');
    expect(head['coverage']).toEqual(coverage);
    // The rest is still compacted: the empty meta fields are dropped.
    expect(head['meta']).toBeUndefined();
    expect(result.notes).toContain('kept 1 field(s) verbatim and first');
  });

  it('places several preserved keys in preserveKeys order', () => {
    const input = pretty({
      z: 1,
      index: { n: null },
      coverage,
      hits: rows300(),
    });
    const result = reduceJson(input, {
      ...ctx,
      preserveKeys: ['coverage', 'status', 'index'],
    });

    const head = JSON.parse(result.text.split('\n')[0]) as Record<
      string,
      unknown
    >;
    expect(Object.keys(head)).toEqual(['coverage', 'index', 'z']);
    expect(head['index']).toEqual({ n: null });
  });

  it('never renders a preserved array of objects as a table', () => {
    const input = pretty({ coverage: rows300().slice(0, 5), hits: rows300() });
    const result = reduceJson(input, { ...ctx, preserveKeys: ['coverage'] });

    const head = JSON.parse(result.text.split('\n')[0]) as Record<
      string,
      unknown
    >;
    expect(head['coverage']).toEqual(rows300().slice(0, 5));
    expect(result.text).not.toContain('$.coverage');
  });

  it('without preserveKeys, behaves exactly as before (nulls dropped)', () => {
    const input = pretty(document);
    const before = reduceJson(input, ctx);
    const head = JSON.parse(before.text.split('\n')[0]) as {
      coverage: Record<string, unknown>;
    };
    expect(head.coverage).not.toHaveProperty('unrecognised');
  });

  it('ignores preserveKeys for an array document or when no key matches', () => {
    const array = pretty(rows300());
    expect(reduceJson(array, { ...ctx, preserveKeys: ['coverage'] })).toEqual(
      reduceJson(array, ctx),
    );
    const other = pretty({ hits: rows300() });
    expect(reduceJson(other, { ...ctx, preserveKeys: ['coverage'] })).toEqual(
      reduceJson(other, ctx),
    );
  });

  it('keeps a document whose only field is preserved', () => {
    const input = pretty({ coverage: { a: null, b: [] }, empty: null });
    const result = reduceJson(input, { ...ctx, preserveKeys: ['coverage'] });
    expect(JSON.parse(result.text)).toEqual({ coverage: { a: null, b: [] } });
  });
});

/**
 * Batch 24b r2 M2: a preserved key is protected wherever it appears, so an
 * aggregated answer (per-result coverage) keeps its unknowns too.
 */
describe('reduceJson — preserveKeys at any depth', () => {
  const coverage = {
    clean: false,
    reasons: ['unrecognised?'],
    unrecognised: null,
    excluded: null,
  };

  it('keeps a nested preserved value verbatim and first among its siblings', () => {
    const input = pretty({
      result: { hits: rows300(), note: null, coverage },
    });
    const result = reduceJson(input, { ...ctx, preserveKeys: ['coverage'] });

    const head = JSON.parse(result.text.split('\n')[0]) as {
      result: Record<string, unknown>;
    };
    expect(Object.keys(head.result)[0]).toBe('coverage');
    expect(head.result['coverage']).toEqual(coverage);
    expect(head.result).not.toHaveProperty('note');
  });

  it('renders preserved columns first, with verbatim cells, in a table of results', () => {
    const results = [0, 1, 2, 3].map((i) => ({
      name: `r${i}`,
      empty: null,
      coverage,
    }));
    const input = pretty({ results, padding: rows300() });
    const result = reduceJson(input, { ...ctx, preserveKeys: ['coverage'] });

    const table = result.text
      .split('\n\n')
      .find((section) => section.includes('$.results'));
    const lines = (table ?? result.text)
      .split('\n')
      .filter((line) => line.startsWith('|'));
    const header = lines.find((line) => line.includes('coverage')) ?? '';
    expect(header.startsWith('|coverage|')).toBe(true);
    expect(result.text).toContain(JSON.stringify(coverage));
  });

  it('keeps per-element preserved values in an array document', () => {
    const input = pretty([
      { coverage, items: rows300().slice(0, 50) },
      { coverage, items: [] },
    ]);
    const result = reduceJson(input, { ...ctx, preserveKeys: ['coverage'] });

    expect(result.reducer).toBe('json-compact');
    const occurrences = result.text.split(JSON.stringify(coverage)).length - 1;
    expect(occurrences).toBe(2);
    expect(result.notes).toContain('kept 2 field(s) verbatim and first');
  });
});
