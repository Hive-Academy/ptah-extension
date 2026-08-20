import * as path from 'path';
import { normalizeWorkspaceRoot } from './normalize-workspace-root';

describe('normalizeWorkspaceRoot', () => {
  it('is idempotent', () => {
    const once = normalizeWorkspaceRoot('d:/projects/ws');
    expect(normalizeWorkspaceRoot(once)).toBe(once);
  });

  it('produces the same key regardless of trailing separators', () => {
    const a = normalizeWorkspaceRoot('d:/projects/ws');
    const b = normalizeWorkspaceRoot('d:/projects/ws/');
    expect(a).toBe(b);
  });

  it('resolves to an absolute path', () => {
    expect(path.isAbsolute(normalizeWorkspaceRoot('d:/projects/ws'))).toBe(
      true,
    );
  });

  it('lower-cases a Windows drive letter so casing never forks the key', () => {
    // Only assert the drive-casing invariant on Windows path semantics.
    if (path.sep !== '\\') return;
    const upper = normalizeWorkspaceRoot('D:\\projects\\ws');
    const lower = normalizeWorkspaceRoot('d:\\projects\\ws');
    expect(upper).toBe(lower);
    expect(upper.startsWith('d:')).toBe(true);
  });

  it('collapses mixed separators to one canonical key on Windows', () => {
    if (path.sep !== '\\') return;
    const back = normalizeWorkspaceRoot('D:\\projects\\ws');
    const fwd = normalizeWorkspaceRoot('D:/projects/ws');
    expect(back).toBe(fwd);
  });
});
