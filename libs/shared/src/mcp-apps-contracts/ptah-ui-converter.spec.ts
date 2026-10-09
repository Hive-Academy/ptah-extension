import { convertPtahUi } from './ptah-ui-converter';
import { parsePtahUi } from './ptah-ui-parser';
import { PTAH_UI_CORPUS } from './ptah-ui.corpus';
import type { PtahUiDocument } from './ptah-ui.types';
import { validateSurfaceDocument } from './surface.validator';

const countBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), 'utf8');

function parse(body: string): PtahUiDocument {
  const parsed = parsePtahUi(body);
  if (!parsed.ok) throw new Error(parsed.failure.message);
  return parsed.doc;
}

describe('convertPtahUi', () => {
  const convert = (doc: PtahUiDocument) => convertPtahUi(doc, 'ptah-ui-1');

  // R3.1: the 610 fixtures keep their exact output; only `catalogVersion` moves to /4 (D1).
  it.each<[string, PtahUiDocument, unknown]>([
    [
      'stats',
      {
        title: 'T',
        elements: [
          {
            kind: 'stats',
            items: [
              { label: 'Files', value: { source: 'diff', field: 'files' } },
              { label: 'Text', value: 'literal' },
            ],
          },
        ],
      },
      {
        components: [
          {
            kind: 'stat',
            id: 'c0',
            title: { text: 'Files' },
            value: '$diff.files',
          },
          { kind: 'stat', id: 'c1', title: { text: 'Text' }, value: 'literal' },
        ],
        bindings: [
          { kind: 'scalar', componentId: 'c0', source: 'diff', field: 'files' },
        ],
      },
    ],
    [
      'literal table',
      {
        elements: [{ kind: 'table', columns: ['A', 'B'], rows: [['x', 'y']] }],
      },
      {
        components: [
          {
            kind: 'table',
            id: 'c0',
            columns: [
              { key: 'c0', label: { text: 'A' } },
              { key: 'c1', label: { text: 'B' } },
            ],
            rows: [['x', 'y']],
          },
        ],
        bindings: [],
      },
    ],
    [
      'source table',
      { elements: [{ kind: 'table', source: 'diff', columns: ['path'] }] },
      {
        components: [
          {
            kind: 'table',
            id: 'c0',
            columns: [{ key: 'c0', label: { text: 'path' } }],
            rows: [],
          },
        ],
        bindings: [
          {
            kind: 'rows',
            componentId: 'c0',
            source: 'diff',
            columns: ['path'],
          },
        ],
      },
    ],
    [
      'literal list',
      { elements: [{ kind: 'list', items: ['one'] }] },
      {
        components: [
          { kind: 'list', id: 'c0', items: [{ text: { text: 'one' } }] },
        ],
        bindings: [],
      },
    ],
    [
      'source list',
      { elements: [{ kind: 'list', source: 'tests' }] },
      {
        components: [{ kind: 'list', id: 'c0', items: [] }],
        bindings: [
          {
            kind: 'rows',
            componentId: 'c0',
            source: 'tests',
            columns: ['command', 'outcome'],
          },
        ],
      },
    ],
    [
      'chart',
      {
        elements: [
          {
            kind: 'chart',
            chart: 'bar',
            title: 'Size',
            points: [{ label: 'main', value: 4 }],
          },
        ],
      },
      {
        components: [
          {
            kind: 'bar-chart',
            id: 'c0',
            title: { text: 'Size' },
            series: [{ name: 'Size', points: [{ x: 'main', y: 4 }] }],
          },
        ],
        bindings: [],
      },
    ],
  ])('deep equals the %s fixture', (_name, doc, expected) => {
    expect(convert(doc)).toEqual({
      envelope: {
        schemaVersion: 'dashboard-spec/2',
        catalogVersion: 'dashboard-catalog/4',
        surfaceId: 'ptah-ui-1',
        title: { text: doc.title ?? '' },
        components: (expected as { components: unknown }).components,
      },
      bindings: (expected as { bindings: unknown }).bindings,
    });
  });

  it.each(PTAH_UI_CORPUS.map((entry) => [entry.name, entry.body] as const))(
    'keeps the 610 corpus case %s flat, positional and valid under /4',
    (_name, body) => {
      const { envelope } = convert(parse(body));
      expect(envelope.catalogVersion).toBe('dashboard-catalog/4');
      envelope.components.forEach((component, index) =>
        expect(component.id).toBe(`c${index}`),
      );
      expect(validateSurfaceDocument(envelope, countBytes).ok).toBe(true);
    },
  );

  // R3.2: one fixture per container, fence in, envelope components out.
  it.each<[string, string, unknown]>([
    [
      'row',
      'row\n  badge ok Shipped\n',
      {
        kind: 'stack',
        id: 'c0',
        direction: 'horizontal',
        children: [
          {
            kind: 'badge',
            id: 'c0.0',
            tone: 'success',
            text: { text: 'Shipped' },
          },
        ],
      },
    ],
    [
      'col',
      'col\n  badge neutral Idle\n',
      {
        kind: 'stack',
        id: 'c0',
        direction: 'vertical',
        children: [
          {
            kind: 'badge',
            id: 'c0.0',
            tone: 'neutral',
            text: { text: 'Idle' },
          },
        ],
      },
    ],
    [
      'grid',
      'grid 3\n  badge info One\n  badge warn Two\n',
      {
        kind: 'grid',
        id: 'c0',
        columns: 3,
        children: [
          { kind: 'badge', id: 'c0.0', tone: 'info', text: { text: 'One' } },
          {
            kind: 'badge',
            id: 'c0.1',
            tone: 'warning',
            text: { text: 'Two' },
          },
        ],
      },
    ],
    [
      'card with a title',
      'card Release\n  badge error Blocked\n',
      {
        kind: 'card',
        id: 'c0',
        title: { text: 'Release' },
        children: [
          {
            kind: 'badge',
            id: 'c0.0',
            tone: 'error',
            text: { text: 'Blocked' },
          },
        ],
      },
    ],
    [
      'card without a title',
      'card\n  badge ok Done\n',
      {
        kind: 'card',
        id: 'c0',
        children: [
          {
            kind: 'badge',
            id: 'c0.0',
            tone: 'success',
            text: { text: 'Done' },
          },
        ],
      },
    ],
    [
      'section',
      'section Overview\n  badge ok Done\n',
      {
        kind: 'section',
        id: 'c0',
        title: { text: 'Overview' },
        children: [
          {
            kind: 'badge',
            id: 'c0.0',
            tone: 'success',
            text: { text: 'Done' },
          },
        ],
      },
    ],
    [
      'accordion',
      'accordion Details\n  badge ok Done\n',
      {
        kind: 'accordion',
        id: 'c0',
        title: { text: 'Details' },
        children: [
          {
            kind: 'badge',
            id: 'c0.0',
            tone: 'success',
            text: { text: 'Done' },
          },
        ],
      },
    ],
  ])('maps %s to its catalog kind', (_name, body, expected) => {
    const { envelope, bindings } = convert(parse(body));
    expect(envelope.components).toEqual([expected]);
    expect(bindings).toEqual([]);
    expect(validateSurfaceDocument(envelope, countBytes).ok).toBe(true);
  });

  it.each<[string, string, unknown]>([
    [
      'note info',
      'note info Heads up',
      { kind: 'alert', id: 'c0', tone: 'info', text: { text: 'Heads up' } },
    ],
    [
      'note ok',
      'note ok Green',
      { kind: 'alert', id: 'c0', tone: 'success', text: { text: 'Green' } },
    ],
    [
      'note warn',
      'note warn Careful',
      { kind: 'alert', id: 'c0', tone: 'warning', text: { text: 'Careful' } },
    ],
    [
      'note error',
      'note error Broken',
      { kind: 'alert', id: 'c0', tone: 'error', text: { text: 'Broken' } },
    ],
    [
      'progress with the default tone',
      'progress Coverage | 84.5',
      {
        kind: 'progress',
        id: 'c0',
        value: 84.5,
        tone: 'neutral',
        label: { text: 'Coverage' },
      },
    ],
    [
      'progress with a tone',
      'progress Budget | 100 | warn',
      {
        kind: 'progress',
        id: 'c0',
        value: 100,
        tone: 'warning',
        label: { text: 'Budget' },
      },
    ],
    [
      'avatar with a subtitle',
      'avatar Ada Lovelace | Reviewer',
      { kind: 'avatar', id: 'c0', name: 'Ada Lovelace', subtitle: 'Reviewer' },
    ],
    [
      'avatar without a subtitle',
      'avatar Ada',
      { kind: 'avatar', id: 'c0', name: 'Ada' },
    ],
  ])('maps the %s atom (R4)', (_name, line, expected) => {
    const { envelope } = convert(parse(`${line}\n`));
    expect(envelope.components).toEqual([expected]);
    expect(validateSurfaceDocument(envelope, countBytes).ok).toBe(true);
  });

  it('maps statline trend and spark onto the /4 stat fields', () => {
    const { envelope, bindings } = convert(
      parse(
        'stats\n  Coverage | 84% | +4.2% good | 70 75 84\n  Errors | 3 | -2\n  Plain | 1\n',
      ),
    );
    expect(envelope.components).toEqual([
      {
        kind: 'stat',
        id: 'c0',
        title: { text: 'Coverage' },
        value: '84%',
        trend: {
          direction: 'up',
          amount: 4.2,
          percent: true,
          polarity: 'good',
        },
        spark: [70, 75, 84],
      },
      {
        kind: 'stat',
        id: 'c1',
        title: { text: 'Errors' },
        value: '3',
        trend: { direction: 'down', amount: 2, percent: false },
      },
      { kind: 'stat', id: 'c2', title: { text: 'Plain' }, value: '1' },
    ]);
    expect(bindings).toEqual([]);
    expect(validateSurfaceDocument(envelope, countBytes).ok).toBe(true);
  });

  it('names nested children after their parent and expands nested stats', () => {
    const { envelope, bindings } = convert(
      parse(
        [
          'title Agents',
          'note info Top',
          'grid 2',
          '  card Usage',
          '    stats',
          '      Total | $agents.total',
          '      Session cost | $agents.session.cost',
          '  section Lanes',
          '    table $agents session',
          '    list $agents',
          'badge ok End',
          '',
        ].join('\n'),
      ),
    );
    expect(envelope.title).toEqual({ text: 'Agents' });
    const [top, grid, end] = envelope.components;
    expect(top?.id).toBe('c0');
    expect(grid).toMatchObject({
      kind: 'grid',
      id: 'c1',
      children: [
        {
          kind: 'card',
          id: 'c1.0',
          children: [
            { kind: 'stat', id: 'c1.0.0', value: '$agents.total' },
            { kind: 'stat', id: 'c1.0.1', value: '$agents.session.cost' },
          ],
        },
        {
          kind: 'section',
          id: 'c1.1',
          children: [
            { kind: 'table', id: 'c1.1.0', rows: [] },
            { kind: 'list', id: 'c1.1.1', items: [] },
          ],
        },
      ],
    });
    expect(end?.id).toBe('c2');
    expect(bindings).toEqual([
      {
        kind: 'scalar',
        componentId: 'c1.0.0',
        source: 'agents',
        field: 'total',
      },
      {
        kind: 'scalar',
        componentId: 'c1.0.1',
        source: 'agents',
        field: 'cost',
        scope: 'session',
      },
      {
        kind: 'rows',
        componentId: 'c1.1.0',
        source: 'agents',
        columns: ['name', 'status', 'tokens', 'cost', 'duration', 'context'],
        scope: 'session',
      },
      {
        kind: 'rows',
        componentId: 'c1.1.1',
        source: 'agents',
        columns: ['name', 'status', 'tokens', 'cost', 'duration', 'context'],
      },
    ]);
  });
});
