import {
  makeSurfaceComponents,
  makeSurfaceTextInput,
} from '../testing/fixtures/surface';
import {
  checkBindingCompatibility,
  checkDraftValue,
  checkSubmitValues,
  collectSubmitScope,
  collectSurfaceInputs,
  visitSurfaceComponents,
} from './surface-bindings';
import { SURFACE_LIMITS } from './surface-catalog';
import type {
  SurfaceCheckboxInput,
  SurfaceComponent,
  SurfaceInput,
  SurfaceRadioGroupInput,
  SurfaceSelectInput,
} from './surface.types';

const options = [
  { value: 'small', label: 'Small' },
  { value: 'large', label: 'Large' },
];
const select = (
  overrides: Partial<SurfaceSelectInput> = {},
): SurfaceSelectInput => ({
  kind: 'select',
  id: 'size',
  label: 'Size',
  path: 'form.size',
  options,
  ...overrides,
});
const radio = (
  overrides: Partial<SurfaceRadioGroupInput> = {},
): SurfaceRadioGroupInput => ({
  kind: 'radio-group',
  id: 'choice',
  label: 'Choice',
  path: 'form.choice',
  options,
  ...overrides,
});
const checkbox = (
  overrides: Partial<SurfaceCheckboxInput> = {},
): SurfaceCheckboxInput => ({
  kind: 'checkbox',
  id: 'agree',
  label: 'Agree',
  path: 'form.agree',
  ...overrides,
});

describe('surface component walk', () => {
  it('visits in document order with root depth 1 and stops when asked', () => {
    const seen: string[] = [];
    visitSurfaceComponents(makeSurfaceComponents(), (component, depth) => {
      seen.push(`${component.id}@${depth}`);
    });
    expect(seen.slice(0, 3)).toEqual([
      'section@1',
      'section-name@2',
      'stack@1',
    ]);
    const stopped: string[] = [];
    visitSurfaceComponents(makeSurfaceComponents(), (component) => {
      stopped.push(component.id);
      return component.id !== 'section-name';
    });
    expect(stopped).toEqual(['section', 'section-name']);
  });

  it('collects every input, nested ones included, in document order', () => {
    expect(
      collectSurfaceInputs(makeSurfaceComponents()).map((input) => input.id),
    ).toEqual(['section-name', 'name', 'size', 'choice', 'agree']);
  });
});

describe('binding compatibility (Req 3.7)', () => {
  it('lets same-type inputs share one exact path', () => {
    expect(
      checkBindingCompatibility([
        makeSurfaceTextInput({ id: 'a' }),
        makeSurfaceTextInput({ id: 'b', hints: { maxLength: 3 } }),
      ]),
    ).toEqual({ ok: true });
    expect(
      checkBindingCompatibility([
        checkbox({ id: 'a' }),
        checkbox({ id: 'b', hints: { required: true } }),
      ]).ok,
    ).toBe(true);
  });

  it('lets select and radio-group share a path only with identical option values', () => {
    expect(
      checkBindingCompatibility([
        select({ path: 'pick' }),
        radio({ path: 'pick', options: [...options].reverse() }),
      ]).ok,
    ).toBe(true);
    const differing = checkBindingCompatibility([
      select({ path: 'pick' }),
      radio({ path: 'pick', options: [options[0]] }),
    ]);
    expect(differing).toMatchObject({ ok: false, paths: ['pick'] });
    if (!differing.ok) expect(differing.reason).toContain('option values');
  });

  it.each<[string, SurfaceInput, SurfaceInput]>([
    [
      'text and checkbox',
      makeSurfaceTextInput({ path: 'x' }),
      checkbox({ path: 'x' }),
    ],
    [
      'text and select',
      makeSurfaceTextInput({ path: 'x' }),
      select({ path: 'x' }),
    ],
    ['checkbox and radio', checkbox({ path: 'x' }), radio({ path: 'x' })],
  ])('rejects %s on one path, naming the path', (_label, a, b) => {
    const result = checkBindingCompatibility([a, b]);
    expect(result).toMatchObject({ ok: false, paths: ['x'] });
    if (!result.ok) expect(result.reason).toContain('different value types');
  });

  it('rejects ancestor/descendant overlap in either order, but not a shared prefix', () => {
    for (const [a, b] of [
      ['form', 'form.name'],
      ['form.name.first', 'form'],
    ]) {
      const result = checkBindingCompatibility([
        makeSurfaceTextInput({ id: 'a', path: a }),
        makeSurfaceTextInput({ id: 'b', path: b }),
      ]);
      expect(result).toMatchObject({ ok: false, paths: [a, b] });
    }
    expect(
      checkBindingCompatibility([
        makeSurfaceTextInput({ id: 'a', path: 'form.a' }),
        makeSurfaceTextInput({ id: 'b', path: 'form.ab' }),
      ]).ok,
    ).toBe(true);
  });

  it('rejects a denied path segment instead of comparing it', () => {
    const result = checkBindingCompatibility([
      makeSurfaceTextInput({ path: '__proto__.polluted' }),
    ]);
    expect(result.ok).toBe(false);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('draft values (Req 3.4, 3.6)', () => {
  it('accepts an absent path and every documented empty value as a draft', () => {
    const inputs = [makeSurfaceTextInput(), select(), radio(), checkbox()];
    for (const input of inputs)
      expect(checkDraftValue(input, undefined)).toEqual({ ok: true });
    expect(checkDraftValue(makeSurfaceTextInput(), '')).toEqual({ ok: true });
    expect(
      checkDraftValue(select({ hints: { required: true } }), null),
    ).toEqual({
      ok: true,
    });
    expect(checkDraftValue(radio(), null)).toEqual({ ok: true });
    expect(
      checkDraftValue(checkbox({ hints: { required: true } }), false),
    ).toEqual({
      ok: true,
    });
  });

  it('stores short and long text as drafts; length hints are for submit', () => {
    const text = makeSurfaceTextInput({
      hints: { minLength: 5, maxLength: 6 },
    });
    expect(checkDraftValue(text, 'ab').ok).toBe(true);
    expect(checkDraftValue(text, 'abcdefghij').ok).toBe(true);
    expect(
      checkDraftValue(text, 'x'.repeat(SURFACE_LIMITS.maxStringLength)).ok,
    ).toBe(true);
    expect(
      checkDraftValue(text, 'x'.repeat(SURFACE_LIMITS.maxStringLength + 1)),
    ).toMatchObject({ ok: false });
  });

  it.each<[string, SurfaceInput, unknown]>([
    ['a number at a text path', makeSurfaceTextInput(), 7],
    ['a string at a checkbox path', checkbox(), 'true'],
    ['a number at a checkbox path', checkbox(), 1],
    ['null at a checkbox path', checkbox(), null],
    ['a non-option at a select path', select(), 'medium'],
    ['an empty string at a select path', select(), ''],
    ['a number at a radio path', radio(), 1],
    ['an object at a text path', makeSurfaceTextInput(), { a: 1 }],
  ])('rejects %s at every write', (_label, input, value) => {
    const result = checkDraftValue(input, value as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(input.path);
  });
});

describe('submit values (Req 10.2)', () => {
  it('names every failing path, not only the first', () => {
    const inputs: SurfaceInput[] = [
      makeSurfaceTextInput({
        id: 'name',
        path: 'f.name',
        hints: { required: true },
      }),
      makeSurfaceTextInput({
        id: 'code',
        path: 'f.code',
        hints: { minLength: 3 },
      }),
      makeSurfaceTextInput({
        id: 'tag',
        path: 'f.tag',
        hints: { maxLength: 2 },
      }),
      select({ id: 'size', path: 'f.size', hints: { required: true } }),
      checkbox({ id: 'agree', path: 'f.agree', hints: { required: true } }),
    ];
    const result = checkSubmitValues(inputs, {
      f: { name: '   ', code: 'ab', tag: 'abc', agree: false },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toEqual([
      'f.name',
      'f.code',
      'f.tag',
      'f.size',
      'f.agree',
    ]);
    expect(result.reason).toContain('f.agree (agree): must be checked.');
    expect(result.reason).toContain('f.size (size): is required.');
  });

  it('returns one value per input, with missing paths read as the empty value', () => {
    const inputs: SurfaceInput[] = [
      makeSurfaceTextInput({
        id: 'name',
        path: 'f.name',
        hints: { minLength: 3 },
      }),
      select({ id: 'size', path: 'f.size' }),
      checkbox({ id: 'agree', path: 'f.agree', hints: { required: true } }),
    ];
    const result = checkSubmitValues(inputs, {
      f: { size: 'large', agree: true },
    });
    expect(result).toEqual({
      ok: true,
      values: [
        { componentId: 'name', path: 'f.name', value: '' },
        { componentId: 'size', path: 'f.size', value: 'large' },
        { componentId: 'agree', path: 'f.agree', value: true },
      ],
    });
  });

  it('rejects a wrong-typed stored value at submit too', () => {
    const result = checkSubmitValues([checkbox()], { form: { agree: 'yes' } });
    expect(result).toMatchObject({
      ok: false,
      issues: [{ componentId: 'agree', path: 'form.agree' }],
    });
  });
});

describe('submit scope (Req 10.6)', () => {
  const surface = (): SurfaceComponent[] => [
    {
      kind: 'section',
      id: 'profile',
      title: { text: 'Profile' },
      children: [
        makeSurfaceTextInput({ id: 'name', path: 'p.name' }),
        {
          kind: 'card',
          id: 'nested',
          children: [checkbox({ id: 'agree', path: 'p.agree' })],
        },
      ],
      actions: [
        {
          id: 'save-profile',
          action: 'surface.submit',
          label: { text: 'Save' },
        },
      ],
    },
    {
      kind: 'stack',
      id: 'billing',
      children: [select({ id: 'plan', path: 'b.plan' })],
      actions: [
        {
          id: 'save-billing',
          action: 'surface.submit',
          label: { text: 'Save' },
        },
        { id: 'pick', action: 'dashboard.select', label: { text: 'Pick' } },
      ],
    },
    {
      kind: 'stat',
      id: 'total',
      value: 1,
      actions: [
        { id: 'stat-submit', action: 'surface.submit', label: { text: 'Go' } },
      ],
    },
    {
      kind: 'card',
      id: 'empty',
      children: [],
      actions: [
        { id: 'empty-submit', action: 'surface.submit', label: { text: 'Go' } },
      ],
    },
  ];

  it('scopes a submit to exactly the inputs in its layout subtree', () => {
    const profile = collectSubmitScope(surface(), 'save-profile');
    expect(profile).toMatchObject({ ok: true, scopeComponentId: 'profile' });
    if (profile.ok)
      expect(profile.inputs.map((input) => input.id)).toEqual([
        'name',
        'agree',
      ]);
    const billing = collectSubmitScope(surface(), 'save-billing');
    if (billing.ok)
      expect(billing.inputs.map((input) => input.id)).toEqual(['plan']);
    expect(billing.ok).toBe(true);
  });

  it.each([
    ['missing', 'undeclared'],
    ['pick', 'not-submit'],
    ['stat-submit', 'invalid-scope'],
    ['empty-submit', 'invalid-scope'],
  ])('rejects action %s as %s', (actionId, code) => {
    expect(collectSubmitScope(surface(), actionId)).toMatchObject({
      ok: false,
      code,
    });
  });
});
