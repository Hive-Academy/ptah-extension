/**
 * Contract tests — TASK_2026_493_9f58 deliverables 1, 3 and 5.
 *
 * Three things beyond the budgets and the trust boundary:
 *
 * - The envelope and the five component kinds are what the contract says.
 * - Fail closed and atomic: an unknown version or kind rejects the WHOLE spec,
 *   and a rejection yields no spec at all, so a caller has nothing partial to
 *   broadcast.
 * - The plain-text fallback carries the three elements `context.md` fixes: the
 *   title, each stat as `label: value`, and each table capped at 20 rows.
 */

import {
  DASHBOARD_CATALOG_VERSION,
  DASHBOARD_COMPONENT_KINDS,
  DASHBOARD_SCHEMA_VERSION,
  DASHBOARD_TEXT_FALLBACK_MAX_TABLE_ROWS,
} from './dashboard-catalog';
import {
  DashboardComponentSchema,
  DashboardSpecEnvelopeSchema,
  collectDashboardComponentIds,
  countDashboardComponents,
  dashboardTreeDepth,
} from './dashboard-spec.schemas';
import { validateDashboardSpec } from './dashboard-spec.validator';
import {
  describeDashboardLimits,
  renderDashboardSpecText,
} from './dashboard-text-fallback';
import {
  dashboardJsonBytes,
  makeChart,
  makeDashboardSpec,
  makeList,
  makeNestedStats,
  makeStat,
  makeStats,
  makeTable,
} from '../testing/fixtures/dashboard-spec';

const validate = (spec: unknown) =>
  validateDashboardSpec(spec, dashboardJsonBytes);

function specWith(overrides: Record<string, unknown>): unknown {
  return { ...makeDashboardSpec(), ...overrides };
}

describe('the envelope', () => {
  it('accepts the minimal valid spec', () => {
    const result = validate(makeDashboardSpec());

    expect(result.ok).toBe(true);
    expect(result.ok && result.spec.specId).toBe('build-health');
  });

  it.each([
    'schemaVersion',
    'catalogVersion',
    'specId',
    'revision',
    'generatedAt',
    'title',
    'components',
  ])('requires %s', (field) => {
    const spec: Record<string, unknown> = { ...makeDashboardSpec() };
    delete spec[field];

    expect(validate(spec).ok).toBe(false);
  });

  it('accepts an ISO 8601 generatedAt with Z or with an offset, and nothing else', () => {
    expect(validate(specWith({ generatedAt: '2026-09-22T10:00:00Z' })).ok).toBe(
      true,
    );
    expect(
      validate(specWith({ generatedAt: '2026-09-22T10:00:00+02:00' })).ok,
    ).toBe(true);
    expect(validate(specWith({ generatedAt: '2026-09-22T10:00:00' })).ok).toBe(
      false,
    );
    expect(validate(specWith({ generatedAt: 'yesterday' })).ok).toBe(false);
  });

  it('accepts a slug specId and rejects one carrying a separator or whitespace', () => {
    expect(validate(specWith({ specId: 'build.health_2-v1:x' })).ok).toBe(true);
    expect(validate(specWith({ specId: 'build/health' })).ok).toBe(false);
    expect(validate(specWith({ specId: 'build health' })).ok).toBe(false);
    expect(validate(specWith({ specId: 'build\nhealth' })).ok).toBe(false);
    expect(validate(specWith({ specId: '../escape' })).ok).toBe(false);
    expect(validate(specWith({ specId: '-leading-dash' })).ok).toBe(false);
    expect(validate(specWith({ specId: '' })).ok).toBe(false);
  });
});

describe('fail closed', () => {
  it('rejects an unknown schemaVersion instead of best-effort rendering it', () => {
    const result = validate(specWith({ schemaVersion: 'dashboard-spec/2' }));

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toContain('schemaVersion');
  });

  it('rejects an unknown catalogVersion', () => {
    const result = validate(
      specWith({ catalogVersion: 'dashboard-catalog/99' }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toContain('catalogVersion');
  });

  it('accepts only the versions the catalog declares supported', () => {
    expect(validate(specWith({ schemaVersion: DASHBOARD_SCHEMA_VERSION })).ok)
      .toBe(true);
    expect(validate(specWith({ catalogVersion: DASHBOARD_CATALOG_VERSION })).ok)
      .toBe(true);
  });

  it('rejects an unknown component kind', () => {
    const result = validate(
      specWith({ components: [{ id: 'p', kind: 'pie-chart', value: 1 }] }),
    );

    expect(result.ok).toBe(false);
  });

  it('offers exactly the five documented kinds', () => {
    expect([...DASHBOARD_COMPONENT_KINDS]).toEqual([
      'stat',
      'line-chart',
      'bar-chart',
      'table',
      'list',
    ]);

    for (const kind of DASHBOARD_COMPONENT_KINDS) {
      const node: Record<string, unknown> = { id: `n-${kind}`, kind };
      if (kind === 'stat') node['value'] = 1;
      if (kind === 'line-chart' || kind === 'bar-chart') {
        node['series'] = [{ name: 's', points: [{ x: 0, y: 1 }] }];
      }
      if (kind === 'table') {
        node['columns'] = [{ key: 'a', label: { text: 'A' } }];
        node['rows'] = [[1]];
      }
      if (kind === 'list') node['items'] = [{ text: { text: 'one' } }];

      expect(DashboardComponentSchema.safeParse(node).success).toBe(true);
    }
  });
});

describe('atomic specs', () => {
  it('yields no spec at all when one node of many is invalid', () => {
    const result = validate(
      specWith({
        components: [
          makeStat({ id: 'good-1' }),
          { id: 'bad', kind: 'stat' },
          makeStat({ id: 'good-2' }),
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect('spec' in result).toBe(false);
  });

  it('rejects a deeply nested invalid node, not only a top-level one', () => {
    const result = validate(
      specWith({
        components: [
          {
            id: 'root',
            kind: 'stat',
            value: 1,
            children: [
              {
                id: 'mid',
                kind: 'stat',
                value: 2,
                children: [{ id: 'leaf', kind: 'stat', value: 'x', bogus: 1 }],
              },
            ],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toContain('bogus');
  });

  it('reports at most a handful of issues and says how many it dropped', () => {
    const result = validate(
      specWith({
        components: Array.from({ length: 20 }, (_unused, index) => ({
          id: `n-${index}`,
          kind: 'stat',
        })),
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toContain('more issues');
  });
});

describe('component data sources', () => {
  it('requires exactly one of inline data or a data reference', () => {
    const both = validate(
      specWith({
        components: [
          {
            id: 't',
            kind: 'table',
            columns: [{ key: 'a', label: { text: 'A' } }],
            rows: [[1]],
            data: { resultId: 'q1' },
          },
        ],
      }),
    );
    const neither = validate(
      specWith({
        components: [
          {
            id: 't',
            kind: 'table',
            columns: [{ key: 'a', label: { text: 'A' } }],
          },
        ],
      }),
    );

    expect(both.ok).toBe(false);
    expect(neither.ok).toBe(false);
  });

  it('requires one cell per declared column', () => {
    const result = validate(
      specWith({
        components: [
          {
            id: 't',
            kind: 'table',
            columns: [
              { key: 'a', label: { text: 'A' } },
              { key: 'b', label: { text: 'B' } },
            ],
            rows: [[1, 2], [3]],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toContain('rows.1');
  });

  it('accepts a table row of scalars including null', () => {
    const result = validate(
      specWith({
        components: [
          {
            id: 't',
            kind: 'table',
            columns: [
              { key: 'a', label: { text: 'A' } },
              { key: 'b', label: { text: 'B' } },
              { key: 'c', label: { text: 'C' } },
            ],
            rows: [['x', 1, null], [false, 2, 'y']],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
  });
});

describe('tree measurements', () => {
  it('counts every node, not only the roots', () => {
    expect(countDashboardComponents(makeStats(5))).toBe(5);
    expect(countDashboardComponents(makeNestedStats(4))).toBe(4);
    expect(countDashboardComponents([])).toBe(0);
  });

  it('reports 1 for a flat row of tiles and 0 for nothing', () => {
    expect(dashboardTreeDepth(makeStats(9))).toBe(1);
    expect(dashboardTreeDepth(makeNestedStats(6))).toBe(6);
    expect(dashboardTreeDepth([])).toBe(0);
  });

  it('collects ids in document order, duplicates included', () => {
    expect(collectDashboardComponentIds(makeNestedStats(3))).toEqual([
      'level-1',
      'level-2',
      'level-3',
    ]);
  });
});

describe('the plain-text fallback', () => {
  const spec = DashboardSpecEnvelopeSchema.parse(
    makeDashboardSpec({
      title: { text: 'Build health' },
      description: { text: 'Last 24 hours' },
      components: [
        makeStat({ id: 'passing', title: { text: 'Passing' }, value: 412 }),
        makeStat({
          id: 'avg-duration',
          title: { text: 'Avg duration' },
          value: 94,
          unit: 's',
          delta: -12,
        }),
        makeTable(3, 2),
        makeChart([2, 3]),
        makeList(['flaky-a', 'flaky-b']),
      ],
    }),
  );

  it('opens with the title', () => {
    expect(renderDashboardSpecText(spec).startsWith('Build health')).toBe(true);
  });

  it('renders each stat as "label: value"', () => {
    const text = renderDashboardSpecText(spec);

    expect(text).toContain('Passing: 412');
    expect(text).toContain('Avg duration: 94 s (-12)');
  });

  it('labels a stat by its id when it carries no title', () => {
    const untitled = DashboardSpecEnvelopeSchema.parse(
      makeDashboardSpec({ components: [{ id: 'orphan', kind: 'stat', value: 7 }] }),
    );

    expect(renderDashboardSpecText(untitled)).toContain('orphan: 7');
  });

  it('renders a table as a text table', () => {
    const text = renderDashboardSpecText(spec);

    expect(text).toContain('Slowest tests (table)');
    expect(text).toContain('Column 0');
    expect(text).toContain('| Column 1');
  });

  it(`caps a table at ${DASHBOARD_TEXT_FALLBACK_MAX_TABLE_ROWS} rows and says how many it dropped`, () => {
    const wide = DashboardSpecEnvelopeSchema.parse(
      makeDashboardSpec({ components: [makeTable(50, 1)] }),
    );
    const text = renderDashboardSpecText(wide);
    const dataRows = text
      .split('\n')
      .filter((line) => /^ {2}\d+$/.test(line)).length;

    expect(dataRows).toBe(DASHBOARD_TEXT_FALLBACK_MAX_TABLE_ROWS);
    expect(text).toContain('more row(s) of 50 not shown');
  });

  it('summarises a chart and a list so a host without a UI is told about them', () => {
    const text = renderDashboardSpecText(spec);

    expect(text).toContain('Duration (line chart): 2 series');
    expect(text).toContain('5 point(s)');
    expect(text).toContain('Failures (list): 2 item(s)');
    expect(text).toContain('- flaky-a');
  });

  it('names the referenced dataset instead of pretending the rows are present', () => {
    const referenced = DashboardSpecEnvelopeSchema.parse(
      makeDashboardSpec({
        components: [
          {
            id: 'big',
            kind: 'table',
            title: { text: 'All tests' },
            columns: [{ key: 'n', label: { text: 'Name' } }],
            data: { resultId: 'query-9f58', rowCount: 120000 },
          },
        ],
      }),
    );
    const text = renderDashboardSpecText(referenced);

    expect(text).toContain('rows not embedded: 120000 rows, referenced as query-9f58');
  });

  it('closes with the spec identity, so a transcript can be traced to a revision', () => {
    expect(renderDashboardSpecText(spec)).toContain(
      'spec build-health revision 1',
    );
  });

  it('describes the current limits from the catalog, never from a retyped list', () => {
    const described = describeDashboardLimits();

    expect(described).toContain('components 200');
    expect(described).toContain('total 262144 UTF-8 bytes');
  });
});
