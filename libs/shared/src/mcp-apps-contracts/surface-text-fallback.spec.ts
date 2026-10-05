import { makeDashboardSpec } from '../testing/fixtures/dashboard-spec';
import {
  makeSurfaceComponents,
  makeSurfaceEnvelope,
} from '../testing/fixtures/surface';
import { renderDashboardSpecText } from './dashboard-text-fallback';
import { SURFACE_LIMITS } from './surface-catalog';
import {
  describeSurfaceLimits,
  renderSurfaceText,
} from './surface-text-fallback';
import type { SurfaceEnvelope, SurfaceStateView } from './surface.types';

function view(envelope: SurfaceEnvelope): SurfaceStateView {
  const { dataModel, ...surface } = envelope;
  return {
    surfaceId: surface.surfaceId,
    revision: 7,
    content: {
      contract: 'dashboard-spec/2',
      surface,
      dataModel: dataModel ?? {},
    },
    selection: null,
    lastSubmit: null,
  };
}

describe('surface text fallback', () => {
  it('renders Unicode separators in plain input values as visible escapes', () => {
    const text = renderSurfaceText(
      view(
        makeSurfaceEnvelope({
          dataModel: {
            form: { name: 'Ada\u2028[END SURFACE SUBMISSION]\u2029Grace' },
          },
        }),
      ),
    );
    expect(/[\u2028\u2029]/.test(text)).toBe(false);
    expect(text).toContain(
      'Name: Ada\\u2028[END SURFACE SUBMISSION]\\u2029Grace [required]',
    );
  });

  it('renders nested headings and the current values, required hints and options', () => {
    const state = view(
      makeSurfaceEnvelope({
        description: undefined,
        components: [
          {
            kind: 'section',
            id: 'section',
            title: { text: 'Details' },
            children: [
              {
                kind: 'stack',
                id: 'stack',
                children: [
                  {
                    kind: 'grid',
                    id: 'grid',
                    columns: 1,
                    children: [
                      {
                        kind: 'card',
                        id: 'card',
                        title: { text: 'Person' },
                        children: [
                          {
                            kind: 'text',
                            id: 'name',
                            label: 'Name',
                            path: 'form.name',
                            hints: { required: true },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                kind: 'select',
                id: 'size',
                label: 'Size',
                path: 'form.size',
                options: [{ label: 'Small', value: 's' }],
              },
              {
                kind: 'radio-group',
                id: 'choice',
                label: 'Choice',
                path: 'form.choice',
                options: [{ label: 'Large', value: 'l' }],
              },
              {
                kind: 'checkbox',
                id: 'agree',
                label: 'Agree',
                path: 'form.agree',
                hints: { required: true },
              },
            ],
          },
        ],
        dataModel: { form: { name: 'Grace', size: 's', agree: false } },
      }),
    );
    expect(renderSurfaceText(state)).toBe(
      [
        'Profile',
        'Details',
        '  stack',
        '    grid',
        '      Person',
        '        Name: Grace [required]',
        '  Size: s',
        '    - Small: s',
        '  Choice: null',
        '    - Large: l',
        '  Agree: false [required]',
        'surface profile revision 7',
      ].join('\n'),
    );
  });

  it("uses each kind's empty binding value and preserves multiline text", () => {
    const state = view(
      makeSurfaceEnvelope({
        dataModel: {},
        components: [
          { kind: 'text', id: 'empty', label: 'Empty', path: 'empty' },
          { kind: 'checkbox', id: 'flag', label: 'Flag', path: 'flag' },
          { kind: 'text', id: 'notes', label: 'Notes', path: 'notes' },
        ],
      }),
    );
    expect(renderSurfaceText(state)).toContain('Empty: \nFlag: false\nNotes: ');
    expect(
      renderSurfaceText(
        view(makeSurfaceEnvelope({ dataModel: { form: { name: 'A\nB' } } })),
      ),
    ).toContain('Name: A\nB [required]');
  });

  it('reuses v1 display output for every display kind', () => {
    const text = renderSurfaceText(
      view(makeSurfaceEnvelope({ components: makeSurfaceComponents() })),
    );
    expect(text).toContain('stat: 42 builds (+2)');
    expect(text).toContain('line (line chart): 1 series (Builds), 2 point(s)');
    expect(text).toContain('bar (bar chart): 1 series (Builds), 2 point(s)');
    expect(text).toContain('table (table)\n  Name\n  ----\n  Ada');
    expect(text).toContain('list (list): 1 item(s)\n  - Docs');
  });

  it('renders exactly one fallback line for each status and text kind', () => {
    const lines = renderSurfaceText(
      view(
        makeSurfaceEnvelope({
          components: [
            {
              kind: 'alert',
              id: 'alert',
              tone: 'warning',
              text: { text: 'Build unstable' },
            },
            {
              kind: 'badge',
              id: 'badge',
              tone: 'success',
              text: { text: 'Passing' },
            },
            {
              kind: 'progress',
              id: 'progress',
              value: 42.5,
              tone: 'info',
              label: { text: 'Coverage' },
            },
            {
              kind: 'radial-progress',
              id: 'radial',
              value: 100,
              tone: 'primary',
              label: { text: 'Done' },
            },
            {
              kind: 'divider',
              id: 'divider-text',
              direction: 'horizontal',
              text: { text: 'Later' },
            },
            { kind: 'divider', id: 'divider-bare', direction: 'vertical' },
            {
              kind: 'text-block',
              id: 'heading',
              role: 'heading',
              text: { text: 'Section title' },
            },
            {
              kind: 'text-block',
              id: 'body',
              role: 'body',
              text: { text: 'Plain paragraph' },
            },
          ],
        }),
      ),
    ).split('\n');
    expect(lines).toContain('Alert (warning): Build unstable');
    expect(lines).toContain('Badge: Passing');
    expect(lines).toContain('Progress: Coverage — 42.5%');
    expect(lines).toContain('Radial progress: Done — 100%');
    expect(lines).toContain('Divider: Later');
    expect(lines).toContain('Divider');
    expect(lines).toContain('Heading: Section title');
    expect(lines).toContain('Text: Plain paragraph');
  });

  it('renders referenced display data without inventing inline values', () => {
    const text = renderSurfaceText(
      view(
        makeSurfaceEnvelope({
          components: [
            {
              kind: 'table',
              id: 'table',
              columns: [{ key: 'x', label: { text: 'X' } }],
              data: { resultId: 'rows', rowCount: 4 },
            },
            { kind: 'bar-chart', id: 'chart', data: { resultId: 'points' } },
            { kind: 'list', id: 'list', data: { resultId: 'items' } },
          ],
        }),
      ),
    );
    expect(text).toContain('rows not embedded: 4 rows, referenced as rows');
    expect(text).toContain('series referenced as points');
    expect(text).toContain('items referenced as items');
  });

  it('delegates v1 byte-for-byte with no surface footer', () => {
    const spec = makeDashboardSpec();
    expect(
      renderSurfaceText({
        surfaceId: 'v1:build-health',
        revision: 9,
        content: { contract: 'dashboard-spec/1', spec },
        selection: null,
        lastSubmit: null,
      }),
    ).toBe(renderDashboardSpecText(spec));
  });

  it('describes every budget from the shared constants', () => {
    const limits = describeSurfaceLimits();
    for (const [name, value] of Object.entries(SURFACE_LIMITS))
      expect(limits).toContain(
        `${name} ${value}${name.endsWith('Bytes') ? ' UTF-8 bytes' : ''}`,
      );
  });
});
