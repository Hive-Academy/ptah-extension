import { parsePtahUi } from './ptah-ui-parser';
import { PTAH_UI_CORPUS } from './ptah-ui.corpus';
import { SURFACE_LIMITS } from './surface-catalog';

const parse = (body: string) => parsePtahUi(body);
const valid = (body: string) => expect(parse(body)).toMatchObject({ ok: true });
const invalid = (body: string) =>
  expect(parse(body)).toMatchObject({ ok: false });

describe('parsePtahUi', () => {
  it('parses every implemented production in a document', () => {
    const result = parse(
      'title Session\nstats\n  Files | $diff.files\ntable\n  Name | Value\n  A | 1\ntable $diff\n  cols path | status\nlist\n  - First\nlist $tests\nchart bar Bundle\n  main | 412\n',
    );
    expect(result).toMatchObject({
      ok: true,
      doc: {
        title: 'Session',
        elements: [
          { kind: 'stats' },
          { kind: 'table' },
          { kind: 'table', source: 'diff' },
          { kind: 'list' },
          { kind: 'list', source: 'tests' },
          { kind: 'chart' },
        ],
      },
    });
  });

  it('accepts CRLF lines', () => valid('title CRLF\r\n'));
  it.each([
    ['title', 'title  Session\n'],
    ['card', 'card  Summary\n  stats\n    Files | 1\n'],
    ['section', 'section  Checks\n  stats\n    Passed | 1\n'],
    ['accordion', 'accordion  Details\n  stats\n    Files | 1\n'],
    ['table source', 'table  $diff\n'],
    ['list source', 'list  $tests\n'],
  ])('accepts multiple spaces after %s headers', (_name, body) => valid(body));
  it('decodes escaped pipe, backslash and dollar', () =>
    expect(parse('title A\\|B\\\\C\\$D\n')).toMatchObject({
      ok: true,
      doc: { title: 'A|B\\C$D' },
    }));
  it('rejects a stray escape', () => invalid('title A\\x\n'));
  it('rejects tabs and other controls', () => invalid('title A\tB\n'));
  it('rejects a three-space body indent', () => invalid('stats\n   A | B\n'));
  it('allows an unescaped pipe in text', () =>
    expect(parse('title A | B\n')).toMatchObject({
      ok: true,
      doc: { title: 'A | B' },
    }));
  it('allows a literal dollar mid-cell', () =>
    valid('table\n  A | B\n  cost$ | 1\n'));
  it('allows a literal dollar at the start of a table cell', () =>
    expect(parse('table\n  Price | Value\n  $5.00 | 5\n')).toMatchObject({
      ok: true,
      doc: { elements: [{ rows: [['$5.00', '5']] }] },
    }));
  it('allows a literal dollar at the start of a chart label', () =>
    expect(parse('chart bar Spend\n  $ spend | 5\n')).toMatchObject({
      ok: true,
      doc: { elements: [{ points: [{ label: '$ spend', value: 5 }] }] },
    }));
  it('allows a literal dollar at the start of a stats label', () =>
    expect(parse('stats\n  $ saved | 5\n')).toMatchObject({
      ok: true,
      doc: { elements: [{ items: [{ label: '$ saved', value: '5' }] }] },
    }));
  it('rejects an empty title', () => invalid('title \n'));
  it('rejects an empty list item', () => invalid('list\n  - \n'));
  it('rejects an empty chart title', () => invalid('chart bar \n  A | 1\n'));
  it('accepts note now that R3 folds in PR D', () =>
    expect(parse('note info Later\n')).toEqual({
      ok: true,
      doc: { elements: [{ kind: 'note', tone: 'info', text: 'Later' }] },
    }));
  it('allows an empty table cell', () => valid('table\n  A | B\n  | value\n'));
  it('rejects an empty stats cell', () => invalid('stats\n  A | \n'));
  it('rejects an empty chart label', () =>
    invalid('chart line Trend\n   | 1\n'));
  it('accepts a grammar number', () => valid('chart line Trend\n  A | -1.5\n'));
  it('requires whole header keywords', () => {
    invalid('titlecase Heading\n');
    invalid('charts line Trend\n  A | 1\n');
    invalid('tabletop $diff\n');
    invalid('listing $tests\n');
  });
  it('accepts repeated chart header spacing without collapsing title spacing', () =>
    expect(parse('chart  bar   Deployment  trend\n  main | 1\n')).toMatchObject(
      {
        ok: true,
        doc: { elements: [{ chart: 'bar', title: 'Deployment  trend' }] },
      },
    ));
  it.each(['1e3', '1,000', '+1'])(
    'rejects non-grammar chart number %s',
    (number) => invalid(`chart bar Trend\n  A | ${number}\n`),
  );

  it('recognizes a stats scalar and distinguishes an escaped dollar', () => {
    expect(parse('stats\n  Bound | $diff.files\n')).toMatchObject({
      ok: true,
      doc: {
        elements: [{ items: [{ value: { source: 'diff', field: 'files' } }] }],
      },
    });
    expect(parse('stats\n  Literal | \\$diff.files\n')).toMatchObject({
      ok: true,
      doc: { elements: [{ items: [{ value: '$diff.files' }] }] },
    });
  });
  it('requires a stats value beginning with a bare dollar to be a scalar', () => {
    invalid('stats\n  Price | $5.00\n');
    expect(parse('stats\n  Price | \\$5.00\n')).toMatchObject({
      ok: true,
      doc: { elements: [{ items: [{ value: '$5.00' }] }] },
    });
  });
  it('rejects an unknown source including $context', () =>
    expect(parse('stats\n  Context | $context.used\n')).toMatchObject({
      ok: false,
      failure: { code: 'unknown-source' },
    }));
  it.each([
    '$constructor.files',
    '$toString.files',
    '$__proto__.files',
    '$diff.constructor',
  ])('rejects prototype names in stats without throwing: %s', (reference) => {
    expect(() => parse(`stats\n  Value | ${reference}\n`)).not.toThrow();
    expect(parse(`stats\n  Value | ${reference}\n`)).toMatchObject({
      ok: false,
      failure: { code: 'unknown-source' },
    });
  });
  it('rejects an unknown scalar field', () =>
    invalid('stats\n  Diff | $diff.missing\n'));
  it('rejects a row source as a stats value', () =>
    invalid('stats\n  Diff | $diff\n'));
  it('accepts a known table and list row source', () =>
    valid('table $diff\nlist $tests\n'));
  it.each(['table $usage\n', 'list $usage\n'])(
    'rejects row sources without columns: %s',
    (body) =>
      expect(parse(body)).toMatchObject({
        ok: false,
        failure: { message: 'source `usage` has no columns (line 1)' },
      }),
  );
  it('rejects a scalar as a table argument', () =>
    invalid('table $diff.files\n'));
  it.each(['table $constructor\n', 'table $constructor\n  cols path\n'])(
    'rejects prototype names in table sources without throwing',
    (body) => {
      expect(() => parse(body)).not.toThrow();
      expect(parse(body)).toMatchObject({
        ok: false,
        failure: { code: 'unknown-source' },
      });
    },
  );
  it('rejects a scalar as a list argument', () =>
    invalid('list $tests.total\n'));
  it.each(['list $constructor\n', 'list $hasownproperty\n'])(
    'rejects prototype names in list sources without throwing',
    (body) => {
      expect(() => parse(body)).not.toThrow();
      expect(parse(body)).toMatchObject({
        ok: false,
        failure: { code: 'unknown-source' },
      });
    },
  );
  it('accepts valid known cols', () =>
    valid('table $diff\n  cols path | additions\n'));
  it('rejects an unknown cols name', () =>
    invalid('table $diff\n  cols missing\n'));
  it('rejects repeated cols names', () =>
    invalid('table $diff\n  cols path | path\n'));
  it('rejects a ragged literal table row', () =>
    invalid('table\n  A | B\n  C\n'));
  it('rejects an unknown element keyword', () => invalid('gauge Speed\n'));
  it('rejects a title that is not first or repeated', () => {
    invalid('list\n  - A\ntitle Late\n');
    invalid('title A\ntitle B\n');
  });
  it('requires exact lowercase keywords', () => invalid('Stats\n  A | B\n'));
  it('accepts Unicode text and cells', () =>
    valid('title Привет 世界\ntable\n  名 | 値\n  α | β\n'));

  it('accepts a body of exactly 8,192 UTF-8 bytes', () =>
    valid(`title ${'x'.repeat(8185)}\n`));
  it('rejects a body of 8,193 UTF-8 bytes before parsing', () =>
    expect(parse(`title ${'x'.repeat(8186)}\n`)).toMatchObject({
      ok: false,
      failure: { code: 'too-large' },
    }));
  it('rejects more than 200 lines before parsing', () =>
    expect(parse(`${'\n'.repeat(201)}`)).toMatchObject({
      ok: false,
      failure: { code: 'too-many-lines' },
    }));
});

/** Indents every non-empty line of `body` by `depth` levels. */
const nest = (body: string, depth = 1) =>
  body
    .split('\n')
    .map((line) => (line === '' ? line : `${'  '.repeat(depth)}${line}`))
    .join('\n');
const failureOf = (body: string) => {
  const result = parse(body);
  if (result.ok) throw new Error(`expected a failure for ${body}`);
  return result.failure;
};

describe('parsePtahUi R3 nesting delta', () => {
  describe('610 compatibility', () => {
    it.each(PTAH_UI_CORPUS.map((entry) => [entry.name, entry.body]))(
      'parses corpus case %s',
      (_name, body) => valid(body),
    );

    it.each(PTAH_UI_CORPUS.map((entry) => [entry.name, entry.body]))(
      're-bases corpus case %s one level down unchanged',
      (_name, body) => {
        const flat = parse(body);
        const untitled = body
          .replace(/\r\n/g, '\n')
          .replace(/^title [^\n]*\n/, '');
        const nested = parse(`col\n${nest(untitled)}`);
        if (!flat.ok || !nested.ok) throw new Error('corpus must parse');
        expect(nested.doc.elements).toEqual([
          { kind: 'col', children: flat.doc.elements },
        ]);
      },
    );

    it('keeps a 610 statline free of trend and spark fields', () =>
      expect(parse('stats\n  A | 1\n')).toEqual({
        ok: true,
        doc: {
          elements: [{ kind: 'stats', items: [{ label: 'A', value: '1' }] }],
        },
      }));
  });

  describe('containers', () => {
    it('parses every container keyword with its fields', () =>
      expect(
        parse(
          'title Board\nrow\n  note ok A\ncol\n  note ok B\ngrid 3\n  note ok C\ncard\n  note ok D\ncard Build\n  note ok E\nsection Tests\n  note ok F\naccordion Details \\| more\n  note ok G\n',
        ),
      ).toEqual({
        ok: true,
        doc: {
          title: 'Board',
          elements: [
            {
              kind: 'row',
              children: [{ kind: 'note', tone: 'ok', text: 'A' }],
            },
            {
              kind: 'col',
              children: [{ kind: 'note', tone: 'ok', text: 'B' }],
            },
            {
              kind: 'grid',
              columns: 3,
              children: [{ kind: 'note', tone: 'ok', text: 'C' }],
            },
            {
              kind: 'card',
              children: [{ kind: 'note', tone: 'ok', text: 'D' }],
            },
            {
              kind: 'card',
              title: 'Build',
              children: [{ kind: 'note', tone: 'ok', text: 'E' }],
            },
            {
              kind: 'section',
              title: 'Tests',
              children: [{ kind: 'note', tone: 'ok', text: 'F' }],
            },
            {
              kind: 'accordion',
              title: 'Details | more',
              children: [{ kind: 'note', tone: 'ok', text: 'G' }],
            },
          ],
        },
      }));

    it('nests containers, ends a container at a lower depth and skips blank lines', () =>
      expect(
        parse(
          'grid 2\n  card Left\n    stats\n      A | 1\n\n    list\n      - x\n  card Right\n    progress Done | 40\nnote info After\n',
        ),
      ).toEqual({
        ok: true,
        doc: {
          elements: [
            {
              kind: 'grid',
              columns: 2,
              children: [
                {
                  kind: 'card',
                  title: 'Left',
                  children: [
                    { kind: 'stats', items: [{ label: 'A', value: '1' }] },
                    { kind: 'list', items: ['x'] },
                  ],
                },
                {
                  kind: 'card',
                  title: 'Right',
                  children: [{ kind: 'progress', label: 'Done', value: 40 }],
                },
              ],
            },
            { kind: 'note', tone: 'info', text: 'After' },
          ],
        },
      }));

    it.each([
      ['an empty row at the end', 'row\n'],
      ['an empty row followed by a sibling', 'row\nnote info A\n'],
      ['an empty card before a blank line', 'card Title\n\nnote info A\n'],
    ])('rejects %s', (_name, body) =>
      expect(failureOf(body)).toMatchObject({
        code: 'syntax',
        message: expect.stringContaining('needs at least one child item'),
      }),
    );

    it.each([
      ['row with text', 'row Left\n  note ok A\n'],
      ['section without text', 'section\n  note ok A\n'],
      ['accordion without text', 'accordion\n  note ok A\n'],
      ['grid without columns', 'grid\n  note ok A\n'],
      ['grid with a decimal', 'grid 2.0\n  note ok A\n'],
      ['an uppercase keyword', 'Row\n  note ok A\n'],
      ['a glued keyword', 'rows\n  note ok A\n'],
      ['an unknown keyword at depth 1', 'row\n  gauge Speed\n'],
      ['a stray escape in a title', 'section A\\x\n  note ok A\n'],
    ])('rejects %s', (_name, body) => invalid(body));

    it('rejects grid 0 as syntax', () =>
      expect(failureOf('grid 0\n  note ok A\n')).toMatchObject({
        code: 'syntax',
      }));
  });

  describe('indentation', () => {
    it('rejects a three-space indent and names the expected depth', () =>
      expect(failureOf('row\n   note ok A\n')).toEqual({
        code: 'depth',
        line: 2,
        message:
          'indentation must be a multiple of two spaces (line 2, expected depth 1)',
      }));

    it('rejects a depth jump of two and names the expected depth', () =>
      expect(failureOf('row\n  col\n      note ok A\n')).toEqual({
        code: 'depth',
        line: 3,
        message: 'unexpected indented line (line 3, expected depth 2)',
      }));

    it('rejects an indented first line', () =>
      expect(failureOf('  note ok A\n')).toMatchObject({
        code: 'depth',
        message: 'unexpected indented line (line 1, expected depth 0)',
      }));

    it('rejects a line indented under a single-line atom', () =>
      expect(failureOf('note ok A\n  note ok B\n')).toMatchObject({
        code: 'depth',
      }));

    it('rejects an element body deeper than one level', () =>
      expect(failureOf('row\n  stats\n      A | 1\n')).toMatchObject({
        code: 'depth',
        message: expect.stringContaining('expected depth 2'),
      }));

    it('treats a body line at the header depth as a sibling item', () =>
      expect(failureOf('row\n  stats\n  A | 1\n')).toMatchObject({
        code: 'syntax',
        message: expect.stringContaining('stats needs at least one line'),
      }));

    it('accepts CRLF line endings at depth 2', () =>
      expect(
        parse(
          'row\r\n  col\r\n    stats\r\n      A | 1\r\n    note warn Late\r\n',
        ),
      ).toEqual({
        ok: true,
        doc: {
          elements: [
            {
              kind: 'row',
              children: [
                {
                  kind: 'col',
                  children: [
                    { kind: 'stats', items: [{ label: 'A', value: '1' }] },
                    { kind: 'note', tone: 'warn', text: 'Late' },
                  ],
                },
              ],
            },
          ],
        },
      }));
  });

  describe('title', () => {
    it('accepts a title first at depth 0', () =>
      valid('title A\nrow\n  note ok B\n'));
    it('rejects a title inside a container', () =>
      expect(failureOf('row\n  title Inner\n  note ok B\n')).toMatchObject({
        code: 'syntax',
        message: 'title is only allowed at depth 0 (line 2)',
      }));
    it('rejects a title after a container', () =>
      invalid('row\n  note ok B\ntitle Late\n'));
  });

  describe('statline trend and spark', () => {
    it('parses a trend without a spark', () =>
      expect(parse('stats\n  Cost | \\$1.20 | -12.5% good\n')).toMatchObject({
        ok: true,
        doc: {
          elements: [
            {
              items: [
                {
                  label: 'Cost',
                  value: '$1.20',
                  trend: {
                    direction: 'down',
                    amount: 12.5,
                    percent: true,
                    polarity: 'good',
                  },
                },
              ],
            },
          ],
        },
      }));

    it('parses an empty trend followed by a spark', () =>
      expect(parse('stats\n  Tokens | 1.2k |  | 1 2.5 -3\n')).toEqual({
        ok: true,
        doc: {
          elements: [
            {
              kind: 'stats',
              items: [{ label: 'Tokens', value: '1.2k', spark: [1, 2.5, -3] }],
            },
          ],
        },
      }));

    it('parses a scalar value with a trend and a spark', () =>
      expect(
        parse('stats\n  Agents | $agents.total | +2 | 1 3\n'),
      ).toMatchObject({
        ok: true,
        doc: {
          elements: [
            {
              items: [
                {
                  value: { source: 'agents', field: 'total' },
                  trend: { direction: 'up', amount: 2, percent: false },
                  spark: [1, 3],
                },
              ],
            },
          ],
        },
      }));

    it.each([
      ['an empty trend with no spark', 'stats\n  A | 1 |\n'],
      ['a one-point spark', 'stats\n  A | 1 | +1 | 5\n'],
      ['an empty spark', 'stats\n  A | 1 | +1 |\n'],
      ['an unsigned trend', 'stats\n  A | 1 | 5%\n'],
      ['a trend with a unit', 'stats\n  A | 1 | +5px\n'],
      ['a trend with an exponent', 'stats\n  A | 1 | +1e3\n'],
      ['an unknown polarity', 'stats\n  A | 1 | +5 great\n'],
      ['a scalar trend', 'stats\n  A | 1 | $diff.files\n'],
      ['a spark with a thousands separator', 'stats\n  A | 1 | +1 | 1,000 2\n'],
      ['a spark with an exponent', 'stats\n  A | 1 | +1 | 1e3 2\n'],
      ['five cells', 'stats\n  A | 1 | +1 | 1 2 | x\n'],
    ])('rejects %s', (_name, body) => invalid(body));
  });

  describe('atoms', () => {
    it('parses progress, badge and avatar', () =>
      expect(
        parse(
          'progress Coverage \\| unit | 84.5 | ok\nprogress Plain | 0\nbadge neutral Draft | v2\navatar Priya | Reviewer\navatar Solo\n',
        ),
      ).toEqual({
        ok: true,
        doc: {
          elements: [
            {
              kind: 'progress',
              label: 'Coverage | unit',
              value: 84.5,
              tone: 'ok',
            },
            { kind: 'progress', label: 'Plain', value: 0 },
            { kind: 'badge', tone: 'neutral', text: 'Draft | v2' },
            { kind: 'avatar', name: 'Priya', subtitle: 'Reviewer' },
            { kind: 'avatar', name: 'Solo' },
          ],
        },
      }));

    it('decodes backslash-pipe in note and badge text', () =>
      expect(parse('note error A \\| B\nbadge warn C \\| D\n')).toMatchObject({
        ok: true,
        doc: {
          elements: [{ text: 'A | B' }, { text: 'C | D' }],
        },
      }));

    it('accepts pct 100.0', () => valid('progress Done | 100.0\n'));

    it.each([
      ['pct 100.1', 'progress Done | 100.1\n'],
      ['a negative pct', 'progress Done | -1\n'],
      ['a pct with a percent sign', 'progress Done | 50%\n'],
      ['a pct with a thousands separator', 'progress Done | 1,0\n'],
      ['a scalar as a progress value', 'progress Passed | $tests.passed\n'],
      ['an empty progress label', 'progress  | 5\n'],
      ['an unknown progress tone', 'progress Done | 5 | success\n'],
      ['an empty progress tone', 'progress Done | 5 |\n'],
      ['a bare progress', 'progress\n'],
      ['an unknown note tone', 'note neutral Text\n'],
      ['a note without text', 'note info\n'],
      ['an unknown badge tone', 'badge primary Text\n'],
      ['an uppercase badge tone', 'badge OK Text\n'],
      ['an avatar with three cells', 'avatar A | B | C\n'],
      ['an avatar without a name', 'avatar  | Role\n'],
      ['a bare avatar', 'avatar\n'],
    ])('rejects %s', (_name, body) => invalid(body));
  });

  describe('sources and the session scope (R5.11)', () => {
    it('parses $agents and $limits row sources and scalars', () =>
      expect(
        parse(
          'stats\n  Running | $agents.running\n  At limit | $limits.atLimit\ntable $agents\n  cols name | context\nlist $limits\n',
        ),
      ).toEqual({
        ok: true,
        doc: {
          elements: [
            {
              kind: 'stats',
              items: [
                {
                  label: 'Running',
                  value: { source: 'agents', field: 'running' },
                },
                {
                  label: 'At limit',
                  value: { source: 'limits', field: 'atLimit' },
                },
              ],
            },
            { kind: 'table', source: 'agents', columns: ['name', 'context'] },
            { kind: 'list', source: 'limits' },
          ],
        },
      }));

    it('parses the session scope after $agents only', () =>
      expect(
        parse(
          'stats\n  Total | $agents.session.total\ntable $agents session\n  cols name\nlist $agents session\n',
        ),
      ).toEqual({
        ok: true,
        doc: {
          elements: [
            {
              kind: 'stats',
              items: [
                {
                  label: 'Total',
                  value: { source: 'agents', field: 'total', scope: 'session' },
                },
              ],
            },
            {
              kind: 'table',
              source: 'agents',
              columns: ['name'],
              scope: 'session',
            },
            { kind: 'list', source: 'agents', scope: 'session' },
          ],
        },
      }));

    it.each([
      ['$limits session', 'table $limits session\n'],
      ['$diff session', 'list $diff session\n'],
      ['$agents sessions', 'table $agents sessions\n'],
      ['$agents Session', 'list $agents Session\n'],
      ['$limits.session.lanes', 'stats\n  A | $limits.session.lanes\n'],
      ['$agents.sesion.total', 'stats\n  A | $agents.sesion.total\n'],
      ['$agents.total.session', 'stats\n  A | $agents.total.session\n'],
    ])('rejects %s', (_name, body) => invalid(body));

    it('rejects an unknown field of a new source', () =>
      expect(failureOf('stats\n  A | $agents.session.prompt\n')).toMatchObject({
        code: 'unknown-source',
      }));
    it('rejects an unknown $limits column', () =>
      invalid('table $limits\n  cols lane | email\n'));
  });

  describe('catalog limits (R3.3)', () => {
    /** One item at `depth` wrapped in `depth` nested `col` containers. */
    const atDepth = (depth: number) => {
      const lines: string[] = [];
      for (let level = 0; level < depth; level += 1)
        lines.push(`${'  '.repeat(level)}col`);
      lines.push(`${'  '.repeat(depth)}note ok Leaf`);
      return `${lines.join('\n')}\n`;
    };
    const notes = (count: number, depth = 1) =>
      Array.from(
        { length: count },
        (_, i) => `${'  '.repeat(depth)}note ok N${i}`,
      ).join('\n');

    it(`accepts an item at tree depth ${SURFACE_LIMITS.maxTreeDepth}`, () =>
      valid(atDepth(SURFACE_LIMITS.maxTreeDepth - 1)));
    it(`rejects an item at tree depth ${SURFACE_LIMITS.maxTreeDepth + 1}, naming the limit`, () =>
      expect(failureOf(atDepth(SURFACE_LIMITS.maxTreeDepth))).toEqual({
        code: 'limit',
        line: SURFACE_LIMITS.maxTreeDepth + 1,
        message: `maxTreeDepth (8) exceeded (line ${SURFACE_LIMITS.maxTreeDepth + 1})`,
      }));
    it('accepts element body lines one level below the deepest allowed item', () =>
      valid(
        `${atDepth(SURFACE_LIMITS.maxTreeDepth - 1)}`.replace(
          /note ok Leaf\n$/,
          `stats\n${'  '.repeat(SURFACE_LIMITS.maxTreeDepth)}A | 1\n`,
        ),
      ));

    it(`accepts ${SURFACE_LIMITS.maxChildrenPerNode} children in one container`, () =>
      valid(`row\n${notes(SURFACE_LIMITS.maxChildrenPerNode)}\n`));
    it(`rejects ${SURFACE_LIMITS.maxChildrenPerNode + 1} children, naming the limit`, () =>
      expect(
        failureOf(`row\n${notes(SURFACE_LIMITS.maxChildrenPerNode + 1)}\n`),
      ).toMatchObject({
        code: 'limit',
        line: 1,
        message: 'maxChildrenPerNode (50) exceeded (line 1)',
      }));
    it('counts each statline as one child, as the converter expands them', () => {
      const stats = `  stats\n${Array.from({ length: 8 }, (_, i) => `    S${i} | ${i}`).join('\n')}`;
      valid(`row\n${stats}\n${notes(SURFACE_LIMITS.maxChildrenPerNode - 8)}\n`);
      expect(
        failureOf(
          `row\n${stats}\n${notes(SURFACE_LIMITS.maxChildrenPerNode - 7)}\n`,
        ),
      ).toMatchObject({
        code: 'limit',
        message: expect.stringContaining('maxChildrenPerNode'),
      });
    });

    it(`accepts exactly ${SURFACE_LIMITS.maxComponents} components`, () => {
      const body = Array.from(
        { length: 4 },
        () => `section Part\n${notes(49)}`,
      ).join('\n');
      const result = parse(`${body}\n`);
      expect(result).toMatchObject({ ok: true });
    });
    it('reaches the 200-line body cap before maxComponents can be exceeded', () =>
      expect(
        failureOf(
          `${Array.from({ length: 4 }, () => `section Part\n${notes(49)}`).join('\n')}\nnote ok Extra\n`,
        ),
      ).toMatchObject({ code: 'too-many-lines' }));

    it(`accepts grid ${SURFACE_LIMITS.maxGridColumns}`, () =>
      valid(`grid ${SURFACE_LIMITS.maxGridColumns}\n  note ok A\n`));
    it(`rejects grid ${SURFACE_LIMITS.maxGridColumns + 1}, naming the limit`, () =>
      expect(
        failureOf(`grid ${SURFACE_LIMITS.maxGridColumns + 1}\n  note ok A\n`),
      ).toEqual({
        code: 'limit',
        line: 1,
        message: 'maxGridColumns (4) exceeded (line 1)',
      }));
  });
});
