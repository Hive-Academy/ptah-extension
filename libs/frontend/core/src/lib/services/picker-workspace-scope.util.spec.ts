/**
 * pickerWorkspaceScope() unit specs (TASK_2026_200, Batch 4).
 *
 * The whole point of this helper is the asymmetry between "absent" and "empty":
 * absent is a documented contract meaning "process-global active folder", while
 * `''` is rejected by the backend Zod schemas because it would `path.resolve`
 * to the process CWD. These specs lock that distinction — a regression that
 * emitted `workspaceRoot: ''` would still typecheck and still look correct in a
 * `toHaveBeenCalledWith` written with `expect.objectContaining`.
 */

import { pickerWorkspaceScope } from './picker-workspace-scope.util';

describe('pickerWorkspaceScope', () => {
  it('emits workspaceRoot for a non-empty absolute path', () => {
    expect(pickerWorkspaceScope('D:\\projects\\ptah-extension')).toEqual({
      workspaceRoot: 'D:\\projects\\ptah-extension',
    });
  });

  it('preserves the host-native path verbatim (no normalization here)', () => {
    // Normalization is the backend's job (normalizeWorkspaceRoot); the wire
    // carries the host-native form the frontend actually has.
    expect(pickerWorkspaceScope('/home/me/repo/')).toEqual({
      workspaceRoot: '/home/me/repo/',
    });
  });

  it('omits the key entirely for an empty string — never sends ""', () => {
    const scope = pickerWorkspaceScope('');
    expect(scope).toEqual({});
    expect('workspaceRoot' in scope).toBe(false);
  });

  it('omits the key for a whitespace-only root', () => {
    expect('workspaceRoot' in pickerWorkspaceScope('   ')).toBe(false);
  });

  it('omits the key for null and undefined', () => {
    expect('workspaceRoot' in pickerWorkspaceScope(null)).toBe(false);
    expect('workspaceRoot' in pickerWorkspaceScope(undefined)).toBe(false);
  });

  it('trims surrounding whitespace off an otherwise usable root', () => {
    expect(pickerWorkspaceScope('  D:\\ws  ')).toEqual({
      workspaceRoot: 'D:\\ws',
    });
  });

  it('spreads into params without introducing a present-but-undefined key', () => {
    const params = { query: 'x', limit: 30, ...pickerWorkspaceScope(null) };
    expect(Object.keys(params)).toEqual(['query', 'limit']);
  });
});
