/**
 * Pins the contract of the shared workspace-root key (TASK_2026_364, moved
 * from `apps/ptah-electron/src/activation/workspace-root-key.ts`).
 *
 * The function answers "are these two strings the same open folder", so it
 * must fold case and separators — unlike platform-core's same-named function,
 * which resolves a path and keeps case. Three consumers (the Electron boot
 * latch, the user-layer coalescer, `AgentProcessManager`'s status scoping)
 * share this definition; a behavioural change here changes all three.
 */
import { NO_WORKSPACE_KEY, normalizeWorkspaceRoot } from './workspace-root-key';

describe('normalizeWorkspaceRoot (shared workspace key)', () => {
  it('maps undefined (no folder open) to the dedicated key', () => {
    expect(normalizeWorkspaceRoot(undefined)).toBe(NO_WORKSPACE_KEY);
  });

  it('folds backslashes to forward slashes', () => {
    expect(normalizeWorkspaceRoot('D:\\projects\\ptah-extension')).toBe(
      'd:/projects/ptah-extension',
    );
  });

  it('folds case', () => {
    expect(normalizeWorkspaceRoot('D:/Projects/Ptah-Extension')).toBe(
      'd:/projects/ptah-extension',
    );
  });

  it('strips trailing separators, in any mix', () => {
    expect(normalizeWorkspaceRoot('D:/projects/ptah-extension\\/')).toBe(
      'd:/projects/ptah-extension',
    );
  });

  it('gives two spellings of one directory the same key', () => {
    expect(normalizeWorkspaceRoot('D:\\Projects\\Ptah-Extension\\')).toBe(
      normalizeWorkspaceRoot('d:/projects/ptah-extension'),
    );
  });

  it('keeps distinct sibling directories distinct (no prefix collapse)', () => {
    expect(normalizeWorkspaceRoot('D:/projects/app')).not.toBe(
      normalizeWorkspaceRoot('D:/projects/app-two'),
    );
  });

  it('NO_WORKSPACE_KEY cannot collide with a real key', () => {
    // Every real key is a normalized absolute path; none begins with '::'.
    expect(NO_WORKSPACE_KEY.startsWith('::')).toBe(true);
    expect(normalizeWorkspaceRoot('C:/x')).not.toBe(NO_WORKSPACE_KEY);
  });
});
