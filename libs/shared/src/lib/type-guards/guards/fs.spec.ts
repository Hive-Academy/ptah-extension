import { isFileChangeToolInput } from './fs';

describe('isFileChangeToolInput', () => {
  const change = {
    path: '/a.ts',
    kind: { type: 'update' },
    diff: '@@ -1 +1 @@\n-a\n+b',
  };

  it('accepts a patch and optional move destination', () => {
    expect(isFileChangeToolInput({ changes: [change] })).toBe(true);
    expect(
      isFileChangeToolInput({ changes: [{ ...change, kind: { type: 'update', move_path: '/b.ts' } }] }),
    ).toBe(true);
  });

  it.each([
    undefined,
    { changes: [] },
    { changes: [{ ...change, path: '' }] },
    { changes: [{ ...change, kind: { type: 'other' } }] },
    { changes: [{ ...change, diff: null }] },
    { changes: [{ ...change, kind: { type: 'update', move_path: 4 } }] },
  ])('rejects malformed input %#', (input) => {
    expect(isFileChangeToolInput(input)).toBe(false);
  });
});
