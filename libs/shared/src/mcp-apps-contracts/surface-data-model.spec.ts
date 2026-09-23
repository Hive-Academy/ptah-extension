import {
  SURFACE_INPUT_EMPTY_VALUES,
  SURFACE_INPUT_KINDS,
  SURFACE_LIMITS,
  SURFACE_PATH_DENYLIST,
} from './surface-catalog';
import {
  applyDataModelOps,
  parseSurfacePath,
  pathsOverlap,
  readSurfacePath,
} from './surface-data-model';
import type { SurfaceDataModel, SurfaceDataValue } from './surface.types';
import { makeSurfaceDataAtDepth } from '../testing/fixtures/surface';

describe('surface paths', () => {
  it('parses the bounded dot syntax', () => {
    expect(parseSurfacePath('_form.first-name')).toEqual({
      ok: true,
      segments: ['_form', 'first-name'],
    });
    expect(
      parseSurfacePath(
        Array(SURFACE_LIMITS.maxPathSegments)
          .fill('a'.repeat(SURFACE_LIMITS.maxPathSegmentLength))
          .join('.'),
      ).ok,
    ).toBe(true);
    expect(
      parseSurfacePath('a'.repeat(SURFACE_LIMITS.maxPathSegmentLength + 1)).ok,
    ).toBe(false);
    expect(
      parseSurfacePath(
        Array(SURFACE_LIMITS.maxPathSegments + 1)
          .fill('a')
          .join('.'),
      ).ok,
    ).toBe(false);
  });
  it.each(['', '.a', 'a.', 'a..b', 'a[0]', 'a.0', '/a', 'a b', 'a\nb'])(
    'rejects malformed path %p',
    (path) => expect(parseSurfacePath(path).ok).toBe(false),
  );
  it.each(SURFACE_PATH_DENYLIST)(
    'rejects %s in every position before a write',
    (segment) => {
      const before = Object.getOwnPropertyDescriptors(Object.prototype);
      const model = Object.freeze({ safe: Object.freeze({ value: 1 }) });
      for (const path of [
        segment,
        `safe.${segment}`,
        `${segment}.polluted`,
        `safe.${segment}.polluted`,
      ]) {
        expect(parseSurfacePath(path).ok).toBe(false);
        expect(readSurfacePath(model, path).ok).toBe(false);
        const result = applyDataModelOps(model, [
          { op: 'set-data', path, value: true },
        ]);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain(path);
        expect(applyDataModelOps(model, [{ op: 'remove-data', path }]).ok).toBe(
          false,
        );
      }
      expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(
        before,
      );
      expect(model).toEqual({ safe: { value: 1 } });
    },
  );
  it('compares whole segments and treats equality and ancestry symmetrically', () => {
    for (const [a, b] of [
      ['form', 'form'],
      ['form', 'form.name'],
      ['form.name', 'form'],
    ])
      expect(pathsOverlap(a, b)).toBe(true);
    for (const [a, b] of [
      ['form', 'forms'],
      ['form.name', 'form.age'],
      ['', ''],
      ['a.__proto__', 'a'],
    ])
      expect(pathsOverlap(a, b)).toBe(false);
  });
});

describe('surface path reads', () => {
  it.each(SURFACE_INPUT_KINDS)(
    'reads missing %s bindings as the documented empty value',
    (kind) => {
      expect(readSurfacePath({}, 'form.absent', kind)).toEqual({
        ok: true,
        value: SURFACE_INPUT_EMPTY_VALUES[kind],
      });
    },
  );
  it('preserves stored false, empty string and null, and distinguishes missing without a kind', () => {
    for (const value of [false, '', null, 0])
      expect(
        readSurfacePath({ form: { value } }, 'form.value', 'text'),
      ).toEqual({ ok: true, value });
    expect(readSurfacePath({}, 'missing')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(readSurfacePath({}, 'toString', 'text')).toEqual({
      ok: true,
      value: '',
    });
    expect(readSurfacePath({ form: [] }, 'form.name', 'text')).toEqual({
      ok: true,
      value: '',
    });
  });
  it('returns a rejection when an in-process getter throws', () => {
    const model: SurfaceDataModel = {
      get name(): string {
        throw new Error('private diagnostic');
      },
    };
    expect(readSurfacePath(model, 'name')).toEqual({
      ok: false,
      reason: 'Cannot read surface path "name".',
    });
  });
});

describe('applyDataModelOps', () => {
  it('sets, replaces and removes in order without mutating frozen input', () => {
    const stable = Object.freeze({ unchanged: true });
    const model = Object.freeze({
      form: Object.freeze({ name: 'Ada', old: true }),
      stable,
    });
    const result = applyDataModelOps(model, [
      { op: 'set-data', path: 'form.name', value: 'Grace' },
      { op: 'set-data', path: 'new.parent.value', value: [1, false, null] },
      { op: 'remove-data', path: 'form.old' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next).toEqual({
      form: { name: 'Grace' },
      stable,
      new: { parent: { value: [1, false, null] } },
    });
    expect(result.next).not.toBe(model);
    expect(result.next['stable']).toBe(stable);
    expect(result.next['form']).not.toBe(model.form);
    expect(model.form).toEqual({ name: 'Ada', old: true });
    expect(Object.getPrototypeOf(result.next)).toBe(Object.prototype);
  });
  it('replaces entire object values and recreates removed parents', () => {
    expect(
      applyDataModelOps({ form: { old: 1 } }, [
        { op: 'set-data', path: 'form', value: { replacement: true } },
        { op: 'remove-data', path: 'form' },
        { op: 'set-data', path: 'form.name', value: 'Ada' },
      ]),
    ).toEqual({ ok: true, next: { form: { name: 'Ada' } } });
  });
  it('remove-missing is a no-op, including beneath a scalar, and creates no parents', () => {
    const model = Object.freeze({ scalar: 1 });
    const result = applyDataModelOps(model, [
      { op: 'remove-data', path: 'missing.child' },
      { op: 'remove-data', path: 'scalar.child' },
    ]);
    expect(result).toEqual({ ok: true, next: model });
    if (result.ok) expect(result.next).toBe(model);
    expect(applyDataModelOps(model, [])).toEqual({ ok: true, next: model });
  });
  it.each([1, false, null, 'text', []])(
    'rejects setting through non-object %p, naming the path',
    (value) => {
      const model = { form: value };
      const result = applyDataModelOps(model, [
        { op: 'set-data', path: 'before', value: true },
        { op: 'set-data', path: 'form.name', value: 'Ada' },
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('form.name');
      expect(model).toEqual({ form: value });
    },
  );
  it.each(SURFACE_PATH_DENYLIST)(
    'rejects nested %s payload keys before copying',
    (key) => {
      const before = Object.getOwnPropertyDescriptors(Object.prototype);
      expect(
        applyDataModelOps({}, [
          { op: 'set-data', path: 'safe', value: { nested: { [key]: true } } },
        ]).ok,
      ).toBe(false);
      expect(applyDataModelOps({ [key]: true }, []).ok).toBe(false);
      expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(
        before,
      );
    },
  );
  it('bounds resulting depth, including missing parents created by set', () => {
    const atLimit = Array(SURFACE_LIMITS.maxDataModelDepth).fill('a').join('.');
    expect(
      applyDataModelOps({}, [{ op: 'set-data', path: atLimit, value: 1 }]).ok,
    ).toBe(true);
    expect(
      applyDataModelOps({}, [
        { op: 'set-data', path: `${atLimit}.a`, value: 1 },
      ]).ok,
    ).toBe(false);
    expect(
      applyDataModelOps({}, [
        {
          op: 'set-data',
          path: 'value',
          value: makeSurfaceDataAtDepth(SURFACE_LIMITS.maxDataModelDepth),
        },
      ]).ok,
    ).toBe(false);
  });
  it('rejects non-finite values and oversized strings, arrays, objects and operation lists', () => {
    const invalid: SurfaceDataValue[] = [
      NaN,
      Infinity,
      -Infinity,
      'x'.repeat(SURFACE_LIMITS.maxStringLength + 1),
      Array(SURFACE_LIMITS.maxDataModelArrayLength + 1).fill(null),
      Object.fromEntries(
        Array.from(
          { length: SURFACE_LIMITS.maxDataModelObjectKeys + 1 },
          (_, i) => [`k${i}`, i],
        ),
      ),
    ];
    for (const value of invalid)
      expect(
        applyDataModelOps({}, [{ op: 'set-data', path: 'value', value }]).ok,
      ).toBe(false);
    expect(
      applyDataModelOps(
        {},
        Array.from({ length: SURFACE_LIMITS.maxPatchOps + 1 }, () => ({
          op: 'remove-data' as const,
          path: 'missing',
        })),
      ).ok,
    ).toBe(false);
  });
  it('fails closed without leaking diagnostics from throwing accessors', () => {
    const model: SurfaceDataModel = {
      get value(): string {
        throw new Error('private diagnostic');
      },
    };
    expect(applyDataModelOps(model, [])).toEqual({
      ok: false,
      reason: 'Cannot apply surface data operations.',
    });
  });
});
