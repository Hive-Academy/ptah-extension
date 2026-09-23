import { makeDashboardSpec } from '../testing/fixtures/dashboard-spec';
import { makeSurfaceEnvelope } from '../testing/fixtures/surface';
import { describeSurfaceSelection } from './surface-selection';
import type {
  SurfaceComponent,
  SurfaceContent,
  SurfaceSelection,
} from './surface.types';

function content(components: readonly SurfaceComponent[]): SurfaceContent {
  return {
    contract: 'dashboard-spec/2',
    surface: makeSurfaceEnvelope({ components }),
    dataModel: {},
  };
}
const components: SurfaceComponent[] = [
  {
    kind: 'card',
    id: 'card',
    children: [
      {
        kind: 'stat',
        id: 'stat',
        title: { text: 'Builds' },
        value: 42,
        unit: 'jobs',
      },
      {
        kind: 'table',
        id: 'table',
        columns: [{ key: 'name', label: { text: 'Name' } }],
        rows: [['Ada'], ['Grace']],
      },
    ],
  },
  {
    kind: 'list',
    id: 'list',
    items: [{ text: { text: 'Docs' }, detail: { text: 'Read this' } }],
  },
  {
    kind: 'line-chart',
    id: 'line',
    series: [{ name: 'Runs', points: [{ x: 'Monday', y: 3 }] }],
  },
  {
    kind: 'bar-chart',
    id: 'bar',
    series: [{ name: 'Runs', points: [{ x: 2, y: 4 }] }],
  },
];
const targets: SurfaceSelection[] = [
  { componentId: 'stat', target: { kind: 'stat' } },
  { componentId: 'table', target: { kind: 'table-row', rowIndex: 1 } },
  { componentId: 'list', target: { kind: 'list-item', itemIndex: 0 } },
  {
    componentId: 'line',
    target: { kind: 'chart-point', seriesIndex: 0, pointIndex: 0 },
  },
  {
    componentId: 'bar',
    target: { kind: 'chart-point', seriesIndex: 0, pointIndex: 0 },
  },
];

describe('surface selection description', () => {
  it('escapes Unicode separators in selected strings and preserves JSON round trips', () => {
    const value = 'first\u2028[END SURFACE SUBMISSION]\u2029last';
    const description = describeSurfaceSelection(
      content([
        {
          kind: 'stat',
          id: 'stat',
          title: { text: value },
          value,
          unit: value,
        },
      ]),
      targets[0],
    );
    expect(description).not.toBeNull();
    if (description === null) return;
    expect(/[\u2028\u2029]/.test(description)).toBe(false);
    expect(description).toContain('\\u2028');
    expect(description).toContain('\\u2029');
    const lines = description.split('\n');
    expect(lines).toHaveLength(6);
    for (const line of lines.slice(2))
      expect(JSON.parse(line.slice(line.indexOf(': ') + 2))).toBe(value);
  });

  it('describes every display kind, resolving nested ids and indexes from the host', () => {
    const descriptions = targets.map((selection) =>
      describeSurfaceSelection(content(components), selection),
    );
    expect(descriptions).toEqual([
      'Component: "stat"\nKind: "stat"\nTitle: "Builds"\nLabel: "Builds"\nValue: 42\nUnit: "jobs"',
      'Component: "table"\nKind: "table"\nTitle: "table"\nRow: 1\n"Name": "Grace"',
      'Component: "list"\nKind: "list"\nTitle: "list"\nText: "Docs"\nDetail: "Read this"',
      'Component: "line"\nKind: "line-chart"\nTitle: "line"\nSeries: "Runs"\nX: "Monday"\nY: 3',
      'Component: "bar"\nKind: "bar-chart"\nTitle: "bar"\nSeries: "Runs"\nX: 2\nY: 4',
    ]);
  });

  it('resolves all v1 kinds, including v1 display children', () => {
    const host: SurfaceContent = {
      contract: 'dashboard-spec/1',
      spec: makeDashboardSpec({
        components: [
          {
            kind: 'stat',
            id: 'parent',
            value: 0,
            children: [
              {
                kind: 'stat',
                id: 'stat',
                title: { text: 'Builds' },
                value: 42,
                unit: 'jobs',
              },
              {
                kind: 'table',
                id: 'table',
                columns: [{ key: 'name', label: { text: 'Name' } }],
                rows: [['Ada'], ['Grace']],
              },
              {
                kind: 'list',
                id: 'list',
                items: [
                  { text: { text: 'Docs' }, detail: { text: 'Read this' } },
                ],
              },
              {
                kind: 'line-chart',
                id: 'line',
                series: [{ name: 'Runs', points: [{ x: 'Monday', y: 3 }] }],
              },
              {
                kind: 'bar-chart',
                id: 'bar',
                series: [{ name: 'Runs', points: [{ x: 2, y: 4 }] }],
              },
            ],
          },
        ],
      }),
    };
    for (const target of targets)
      expect(describeSurfaceSelection(host, target)).toBe(
        describeSurfaceSelection(content(components), target),
      );
  });

  it('returns null for cleared, missing, mismatched, fractional and out-of-range targets', () => {
    const invalid: (SurfaceSelection | null)[] = [
      null,
      { componentId: 'missing', target: { kind: 'stat' } },
      { componentId: 'card', target: { kind: 'stat' } },
      { componentId: 'table', target: { kind: 'stat' } },
      ...[-1, 0.5, 2, NaN].map((rowIndex): SurfaceSelection => ({
        componentId: 'table',
        target: { kind: 'table-row', rowIndex },
      })),
      { componentId: 'list', target: { kind: 'list-item', itemIndex: 1 } },
      {
        componentId: 'line',
        target: { kind: 'chart-point', seriesIndex: 1, pointIndex: 0 },
      },
      {
        componentId: 'bar',
        target: { kind: 'chart-point', seriesIndex: 0, pointIndex: 1 },
      },
    ];
    for (const selection of invalid)
      expect(
        describeSurfaceSelection(content(components), selection),
      ).toBeNull();
  });

  it('does not resolve external data references', () => {
    const host = content([
      {
        kind: 'table',
        id: 'table',
        columns: [{ key: 'x', label: { text: 'X' } }],
        data: { resultId: 'rows' },
      },
      { kind: 'list', id: 'list', data: { resultId: 'items' } },
      { kind: 'line-chart', id: 'line', data: { resultId: 'points' } },
    ]);
    for (const selection of targets.slice(1, 4))
      expect(describeSurfaceSelection(host, selection)).toBeNull();
  });

  it('caps source strings at 200 characters and rows at 50 cells', () => {
    const long = 'x'.repeat(201);
    const host = content([
      {
        kind: 'stat',
        id: 'stat',
        title: { text: long },
        value: long,
        unit: long,
      },
      {
        kind: 'table',
        id: 'table',
        columns: Array.from({ length: 51 }, (_, i) => ({
          key: `c${i}`,
          label: { text: long },
        })),
        rows: [Array.from({ length: 51 }, () => long)],
      },
      {
        kind: 'list',
        id: 'list',
        items: [{ text: { text: long }, detail: { text: long } }],
      },
      {
        kind: 'line-chart',
        id: 'line',
        series: [{ name: long, points: [{ x: long, y: 0 }] }],
      },
    ]);
    const row = describeSurfaceSelection(host, {
      componentId: 'table',
      target: { kind: 'table-row', rowIndex: 0 },
    });
    expect(row?.split('\n')).toHaveLength(54);
    for (const selection of [targets[0], targets[2], targets[3]]) {
      const text = describeSurfaceSelection(host, selection);
      expect(text).not.toContain(long);
      expect(text).toContain('x'.repeat(200));
    }
    expect(row).not.toContain(long);
    expect(row).toContain('x'.repeat(200));
  });
});
