/** Valid v2 fixtures shared by contract, validator and host tests. */
import type {
  SurfaceAction,
  SurfaceComponent,
  SurfaceDataValue,
  SurfaceEnvelope,
  SurfaceTextInput,
} from '../../mcp-apps-contracts/surface.types';

export function makeSurfaceTextInput(
  overrides: Partial<SurfaceTextInput> = {},
): SurfaceTextInput {
  return {
    kind: 'text',
    id: 'name',
    label: 'Name',
    path: 'form.name',
    description: { text: 'Your display name', format: 'plain' },
    placeholder: 'Ada',
    multiline: false,
    hints: { required: true, minLength: 1, maxLength: 40 },
    ...overrides,
  };
}

export function makeSurfaceEnvelope(
  overrides: Partial<SurfaceEnvelope> = {},
): SurfaceEnvelope {
  return {
    schemaVersion: 'dashboard-spec/2',
    catalogVersion: 'dashboard-catalog/2',
    surfaceId: 'profile',
    title: { text: 'Profile', format: 'plain' },
    description: { text: 'Edit your profile' },
    components: [makeSurfaceTextInput()],
    dataModel: { form: { name: 'Ada' } },
    ...overrides,
  };
}

/** One populated instance of every kind; each call owns its mutable test data. */
export function makeSurfaceComponents(): SurfaceComponent[] {
  const action = (id: string): SurfaceAction => ({
    id: `${id}-select`,
    action: 'dashboard.select',
    label: { text: 'Select', format: 'plain' },
    params: { row: 0, name: 'Ada', active: true },
  });
  const display = (id: string) => ({
    id,
    title: { text: id, format: 'plain' as const },
    description: { text: 'Details' },
    actions: [action(id)],
  });
  const chart = (id: string) => ({
    ...display(id),
    xLabel: { text: 'Day' },
    yLabel: { text: 'Count' },
    series: [
      {
        name: 'Builds',
        points: [
          { x: 'Monday', y: 3 },
          { x: 2, y: 4 },
        ],
      },
    ],
  });
  const options = [
    { value: 'small', label: 'Small' },
    { value: 'large', label: 'Large' },
  ];
  return [
    {
      kind: 'section',
      id: 'section',
      title: { text: 'Section' },
      description: { text: 'Introduction' },
      children: [makeSurfaceTextInput({ id: 'section-name' })],
      actions: [
        { id: 'submit', action: 'surface.submit', label: { text: 'Save' } },
      ],
    },
    {
      kind: 'stack',
      id: 'stack',
      direction: 'horizontal',
      gap: 'medium',
      children: [],
      actions: [action('stack')],
    },
    {
      kind: 'grid',
      id: 'grid',
      columns: 2,
      gap: 'small',
      children: [],
      actions: [action('grid')],
    },
    {
      kind: 'card',
      id: 'card',
      title: { text: 'Card' },
      description: { text: 'Description' },
      children: [],
      actions: [action('card')],
    },
    makeSurfaceTextInput(),
    {
      kind: 'select',
      id: 'size',
      label: 'Size',
      path: 'form.size',
      options,
      hints: { required: true },
    },
    {
      kind: 'radio-group',
      id: 'choice',
      label: 'Choice',
      path: 'form.choice',
      options,
      hints: { required: false },
    },
    {
      kind: 'checkbox',
      id: 'agree',
      label: 'I agree',
      path: 'form.agree',
      hints: { required: true },
    },
    { ...display('stat'), kind: 'stat', value: 42, unit: 'builds', delta: 2 },
    { ...chart('line'), kind: 'line-chart' },
    { ...chart('bar'), kind: 'bar-chart' },
    {
      ...display('table'),
      kind: 'table',
      columns: [{ key: 'name', label: { text: 'Name' }, align: 'left' }],
      rows: [['Ada'], [null], [true], [1]],
    },
    {
      ...display('list'),
      kind: 'list',
      ordered: true,
      items: [
        {
          text: { text: 'Docs' },
          detail: { text: 'Read more' },
          url: 'https://example.com/docs',
        },
      ],
    },
  ];
}

/** A root container counts as depth 1; scalars have depth 0. */
export function makeSurfaceDataAtDepth(depth: number): SurfaceDataValue {
  let value: SurfaceDataValue = 'leaf';
  for (let level = 0; level < depth; level++) value = { child: value };
  return value;
}
