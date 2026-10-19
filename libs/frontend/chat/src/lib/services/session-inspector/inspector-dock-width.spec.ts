import {
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_LARGE_DEFAULT_WIDTH,
  INSPECTOR_MAIN_MIN_WIDTH,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  INSPECTOR_WIDE_DEFAULT_WIDTH,
  inspectorDefaultWidthFor,
  inspectorDockWidth,
  inspectorMaxWidthFor,
} from './inspector-dock-width';

describe('inspector dock width functions', () => {
  it('keeps the single-focus tile floor of decisions.md row 18', () => {
    expect(INSPECTOR_MAIN_MIN_WIDTH).toBe(360);
  });

  it.each([
    [0, INSPECTOR_MAX_WIDTH],
    [Number.NaN, INSPECTOR_MAX_WIDTH],
    [552, INSPECTOR_MIN_WIDTH],
    [660, INSPECTOR_MIN_WIDTH],
    [672, 312],
    [672.9, 312],
    [880, 520],
    [880.5, 520],
    [1064, INSPECTOR_MAX_WIDTH],
  ])('inspectorMaxWidthFor(%p) = %p', (availableWidth, expected) => {
    expect(inspectorMaxWidthFor(availableWidth)).toBe(expected);
  });

  it.each([
    [0, INSPECTOR_DEFAULT_WIDTH],
    [Number.NaN, INSPECTOR_DEFAULT_WIDTH],
    [880, INSPECTOR_DEFAULT_WIDTH],
    [1099, INSPECTOR_DEFAULT_WIDTH],
    [1100, INSPECTOR_LARGE_DEFAULT_WIDTH],
    [1124, INSPECTOR_LARGE_DEFAULT_WIDTH],
    [1499, INSPECTOR_LARGE_DEFAULT_WIDTH],
    [1500, INSPECTOR_WIDE_DEFAULT_WIDTH],
  ])('inspectorDefaultWidthFor(%p) = %p', (availableWidth, expected) => {
    expect(inspectorDefaultWidthFor(availableWidth)).toBe(expected);
  });

  it.each([
    [null, 0, 336],
    [null, 880, 336],
    [null, 1124, 400],
    [null, 1500, 448],
    [900, 880, 520],
    [900, 1600, 560],
    [900, 0, 560],
    [100, 1124, 300],
    [420.6, 1600, 421],
    [560, 672.5, 312],
    [519.6, 880.9, 520],
    [null, 552, 300],
    [Number.NaN, 1124, 400],
    [Number.POSITIVE_INFINITY, 1124, 400],
  ])(
    'inspectorDockWidth(%p, %p) = %p',
    (preference, availableWidth, expected) => {
      expect(inspectorDockWidth(preference, availableWidth)).toBe(expected);
    },
  );
});
