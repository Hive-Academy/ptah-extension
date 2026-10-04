import { convertPtahUi } from './ptah-ui-converter';
import type { PtahUiDocument } from './ptah-ui.types';

describe('convertPtahUi', () => {
  const convert = (doc: PtahUiDocument) => convertPtahUi(doc, 'ptah-ui-1');

  it.each<[string, PtahUiDocument, unknown]>([
    ['stats', { title: 'T', elements: [{ kind: 'stats', items: [{ label: 'Files', value: { source: 'diff', field: 'files' } }, { label: 'Text', value: 'literal' }] }] }, { components: [{ kind: 'stat', id: 'c0', title: { text: 'Files' }, value: '$diff.files' }, { kind: 'stat', id: 'c1', title: { text: 'Text' }, value: 'literal' }], bindings: [{ kind: 'scalar', componentId: 'c0', source: 'diff', field: 'files' }] }],
    ['literal table', { elements: [{ kind: 'table', columns: ['A', 'B'], rows: [['x', 'y']] }] }, { components: [{ kind: 'table', id: 'c0', columns: [{ key: 'c0', label: { text: 'A' } }, { key: 'c1', label: { text: 'B' } }], rows: [['x', 'y']] }], bindings: [] }],
    ['source table', { elements: [{ kind: 'table', source: 'diff', columns: ['path'] }] }, { components: [{ kind: 'table', id: 'c0', columns: [{ key: 'c0', label: { text: 'path' } }], rows: [] }], bindings: [{ kind: 'rows', componentId: 'c0', source: 'diff', columns: ['path'] }] }],
    ['literal list', { elements: [{ kind: 'list', items: ['one'] }] }, { components: [{ kind: 'list', id: 'c0', items: [{ text: { text: 'one' } }] }], bindings: [] }],
    ['source list', { elements: [{ kind: 'list', source: 'tests' }] }, { components: [{ kind: 'list', id: 'c0', items: [] }], bindings: [{ kind: 'rows', componentId: 'c0', source: 'tests', columns: ['command', 'outcome'] }] }],
    ['chart', { elements: [{ kind: 'chart', chart: 'bar', title: 'Size', points: [{ label: 'main', value: 4 }] }] }, { components: [{ kind: 'bar-chart', id: 'c0', title: { text: 'Size' }, series: [{ name: 'Size', points: [{ x: 'main', y: 4 }] }] }], bindings: [] }],
  ])('deep equals the %s fixture', (_name, doc, expected) => {
    expect(convert(doc)).toEqual({
      envelope: { schemaVersion: 'dashboard-spec/2', catalogVersion: 'dashboard-catalog/2', surfaceId: 'ptah-ui-1', title: { text: doc.title ?? '' }, components: (expected as { components: unknown }).components },
      bindings: (expected as { bindings: unknown }).bindings,
    });
  });
});
