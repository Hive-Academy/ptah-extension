import { parsePtahUi } from './ptah-ui-parser';

const parse = (body: string) => parsePtahUi(body);
const valid = (body: string) => expect(parse(body)).toMatchObject({ ok: true });
const invalid = (body: string) => expect(parse(body)).toMatchObject({ ok: false });

describe('parsePtahUi', () => {
  it('parses every implemented production in a document', () => {
    const result = parse('title Session\nstats\n  Files | $diff.files\ntable\n  Name | Value\n  A | 1\ntable $diff\n  cols path | status\nlist\n  - First\nlist $tests\nchart bar Bundle\n  main | 412\n');
    expect(result).toMatchObject({ ok: true, doc: { title: 'Session', elements: [{ kind: 'stats' }, { kind: 'table' }, { kind: 'table', source: 'diff' }, { kind: 'list' }, { kind: 'list', source: 'tests' }, { kind: 'chart' }] } });
  });

  it('accepts CRLF lines', () => valid('title CRLF\r\n'));
  it('decodes escaped pipe, backslash and dollar', () => expect(parse('title A\\|B\\\\C\\$D\n')).toMatchObject({ ok: true, doc: { title: 'A|B\\C$D' } }));
  it('rejects a stray escape', () => invalid('title A\\x\n'));
  it('rejects tabs and other controls', () => invalid('title A\tB\n'));
  it('rejects a three-space body indent', () => invalid('stats\n   A | B\n'));
  it('allows an unescaped pipe in text', () => expect(parse('title A | B\n')).toMatchObject({ ok: true, doc: { title: 'A | B' } }));
  it('allows a literal dollar mid-cell', () => valid('table\n  A | B\n  cost$ | 1\n'));
  it('allows a literal dollar at the start of a table cell', () => expect(parse('table\n  Price | Value\n  $5.00 | 5\n')).toMatchObject({ ok: true, doc: { elements: [{ rows: [['$5.00', '5']] }] } }));
  it('allows a literal dollar at the start of a chart label', () => expect(parse('chart bar Spend\n  $ spend | 5\n')).toMatchObject({ ok: true, doc: { elements: [{ points: [{ label: '$ spend', value: 5 }] }] } }));
  it('allows a literal dollar at the start of a stats label', () => expect(parse('stats\n  $ saved | 5\n')).toMatchObject({ ok: true, doc: { elements: [{ items: [{ label: '$ saved', value: '5' }] }] } }));
  it('rejects an empty title', () => invalid('title \n'));
  it('rejects an empty list item', () => invalid('list\n  - \n'));
  it('rejects an empty chart title', () => invalid('chart bar \n  A | 1\n'));
  it('rejects note because it belongs to PR D', () => invalid('note info Later\n'));
  it('allows an empty table cell', () => valid('table\n  A | B\n  | value\n'));
  it('rejects an empty stats cell', () => invalid('stats\n  A | \n'));
  it('rejects an empty chart label', () => invalid('chart line Trend\n   | 1\n'));
  it('accepts a grammar number', () => valid('chart line Trend\n  A | -1.5\n'));
  it.each(['1e3', '1,000', '+1'])('rejects non-grammar chart number %s', (number) => invalid(`chart bar Trend\n  A | ${number}\n`));

  it('recognizes a stats scalar and distinguishes an escaped dollar', () => {
    expect(parse('stats\n  Bound | $diff.files\n')).toMatchObject({ ok: true, doc: { elements: [{ items: [{ value: { source: 'diff', field: 'files' } }] }] } });
    expect(parse('stats\n  Literal | \\$diff.files\n')).toMatchObject({ ok: true, doc: { elements: [{ items: [{ value: '$diff.files' }] }] } });
  });
  it('requires a stats value beginning with a bare dollar to be a scalar', () => {
    invalid('stats\n  Price | $5.00\n');
    expect(parse('stats\n  Price | \\$5.00\n')).toMatchObject({ ok: true, doc: { elements: [{ items: [{ value: '$5.00' }] }] } });
  });
  it('rejects an unknown source including $context', () => expect(parse('stats\n  Context | $context.used\n')).toMatchObject({ ok: false, failure: { code: 'unknown-source' } }));
  it.each([
    '$constructor.files',
    '$toString.files',
    '$__proto__.files',
    '$diff.constructor',
  ])('rejects prototype names in stats without throwing: %s', (reference) => {
    expect(() => parse(`stats\n  Value | ${reference}\n`)).not.toThrow();
    expect(parse(`stats\n  Value | ${reference}\n`)).toMatchObject({ ok: false, failure: { code: 'unknown-source' } });
  });
  it('rejects an unknown scalar field', () => invalid('stats\n  Diff | $diff.missing\n'));
  it('rejects a row source as a stats value', () => invalid('stats\n  Diff | $diff\n'));
  it('accepts a known table and list row source', () => valid('table $diff\nlist $tests\n'));
  it('rejects a scalar as a table argument', () => invalid('table $diff.files\n'));
  it.each(['table $constructor\n', 'table $constructor\n  cols path\n'])('rejects prototype names in table sources without throwing', (body) => {
    expect(() => parse(body)).not.toThrow();
    expect(parse(body)).toMatchObject({ ok: false, failure: { code: 'unknown-source' } });
  });
  it('rejects a scalar as a list argument', () => invalid('list $tests.total\n'));
  it.each(['list $constructor\n', 'list $hasownproperty\n'])('rejects prototype names in list sources without throwing', (body) => {
    expect(() => parse(body)).not.toThrow();
    expect(parse(body)).toMatchObject({ ok: false, failure: { code: 'unknown-source' } });
  });
  it('accepts valid known cols', () => valid('table $diff\n  cols path | additions\n'));
  it('rejects an unknown cols name', () => invalid('table $diff\n  cols missing\n'));
  it('rejects repeated cols names', () => invalid('table $diff\n  cols path | path\n'));
  it('rejects a ragged literal table row', () => invalid('table\n  A | B\n  C\n'));
  it('rejects an unknown element keyword', () => invalid('gauge Speed\n'));
  it('rejects a title that is not first or repeated', () => {
    invalid('list\n  - A\ntitle Late\n');
    invalid('title A\ntitle B\n');
  });
  it('requires exact lowercase keywords', () => invalid('Stats\n  A | B\n'));
  it('accepts Unicode text and cells', () => valid('title Привет 世界\ntable\n  名 | 値\n  α | β\n'));

  it('accepts a body of exactly 8,192 UTF-8 bytes', () => valid(`title ${'x'.repeat(8185)}\n`));
  it('rejects a body of 8,193 UTF-8 bytes before parsing', () => expect(parse(`title ${'x'.repeat(8186)}\n`)).toMatchObject({ ok: false, failure: { code: 'too-large' } }));
  it('rejects more than 200 lines before parsing', () => expect(parse(`${'\n'.repeat(201)}`)).toMatchObject({ ok: false, failure: { code: 'too-many-lines' } }));
});
