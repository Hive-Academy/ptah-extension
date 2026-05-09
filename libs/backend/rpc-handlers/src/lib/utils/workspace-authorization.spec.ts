/**
 * isAuthorizedWorkspace — unit specs (PR-267 Fix #1).
 *
 * Contracts locked in:
 *   1. Returns false for empty/falsy workspacePath.
 *   2. Returns false when no folders are open.
 *   3. Exact match (after normalization) returns true.
 *   4. Sub-path within a folder returns true.
 *   5. Path that shares only a prefix (not a separator boundary) is rejected —
 *      `/foo/bar` must not accept `/foo/barbaz`.
 *   6. Case-insensitive comparison (Windows paths).
 *   7. Trailing-slash normalization — `/foo/bar/` is accepted when `/foo/bar`
 *      is the registered folder.
 *   8. Backslash paths (Windows) are normalized to forward slashes before
 *      comparison.
 *
 * Mocking posture: explicit IWorkspaceProvider mock with a concrete folder
 * list — the gate logic is actually exercised, never trivially bypassed.
 */

import 'reflect-metadata';

import { isAuthorizedWorkspace } from './workspace-authorization';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

function makeProvider(folders: string[]): IWorkspaceProvider {
  return {
    getWorkspaceFolders: jest.fn().mockReturnValue(folders),
    getWorkspaceRoot: jest.fn().mockReturnValue(folders[0] ?? null),
    getActiveFolder: jest.fn().mockReturnValue(folders[0] ?? null),
  } as unknown as IWorkspaceProvider;
}

const FOLDER = '/c/projects/my-repo';

describe('isAuthorizedWorkspace', () => {
  describe('early-out guards', () => {
    it('returns false for empty string', () => {
      const provider = makeProvider([FOLDER]);
      expect(isAuthorizedWorkspace('', provider)).toBe(false);
    });

    it('returns false when provider has no folders', () => {
      const provider = makeProvider([]);
      expect(isAuthorizedWorkspace(FOLDER, provider)).toBe(false);
    });

    it('returns false when provider returns null', () => {
      const provider = {
        getWorkspaceFolders: jest.fn().mockReturnValue(null),
      } as unknown as IWorkspaceProvider;
      expect(isAuthorizedWorkspace(FOLDER, provider)).toBe(false);
    });
  });

  describe('exact match', () => {
    it('accepts the exact registered folder', () => {
      const provider = makeProvider([FOLDER]);
      expect(isAuthorizedWorkspace(FOLDER, provider)).toBe(true);
    });

    it('accepts the folder with a trailing slash', () => {
      const provider = makeProvider([FOLDER]);
      expect(isAuthorizedWorkspace(FOLDER + '/', provider)).toBe(true);
    });
  });

  describe('sub-path match', () => {
    it('accepts a path inside the registered folder', () => {
      const provider = makeProvider([FOLDER]);
      expect(isAuthorizedWorkspace(FOLDER + '/src/index.ts', provider)).toBe(
        true,
      );
    });

    it('accepts a deeply-nested path', () => {
      const provider = makeProvider([FOLDER]);
      expect(
        isAuthorizedWorkspace(FOLDER + '/a/b/c/d/file.txt', provider),
      ).toBe(true);
    });
  });

  describe('separator boundary check (prefix safety)', () => {
    it('rejects a path that shares only a non-boundary prefix', () => {
      const provider = makeProvider([FOLDER]);
      // /c/projects/my-repo-extra is NOT inside /c/projects/my-repo
      expect(isAuthorizedWorkspace('/c/projects/my-repo-extra', provider)).toBe(
        false,
      );
    });

    it('rejects a sibling directory with a similar name', () => {
      const provider = makeProvider([FOLDER]);
      expect(isAuthorizedWorkspace('/c/projects/my-repo2', provider)).toBe(
        false,
      );
    });

    it('rejects the parent of the registered folder', () => {
      const provider = makeProvider([FOLDER]);
      expect(isAuthorizedWorkspace('/c/projects', provider)).toBe(false);
    });
  });

  describe('case normalization (Windows)', () => {
    it('accepts the same path in a different case', () => {
      const provider = makeProvider([FOLDER]);
      expect(isAuthorizedWorkspace('/C/Projects/My-Repo', provider)).toBe(true);
    });

    it('accepts a sub-path in a different case', () => {
      const provider = makeProvider([FOLDER]);
      expect(
        isAuthorizedWorkspace('/C/Projects/My-Repo/SRC/File.TS', provider),
      ).toBe(true);
    });
  });

  describe('backslash normalization', () => {
    it('accepts a Windows-style backslash path', () => {
      const provider = makeProvider(['C:\\projects\\my-repo']);
      // Forward-slash equivalent should also be accepted
      expect(
        isAuthorizedWorkspace('C:\\projects\\my-repo\\src', provider),
      ).toBe(true);
    });
  });

  describe('multiple folders', () => {
    it('accepts a path that matches the second registered folder', () => {
      const other = '/c/projects/other-repo';
      const provider = makeProvider([FOLDER, other]);
      expect(isAuthorizedWorkspace(other + '/src', provider)).toBe(true);
    });

    it('rejects a path that does not match any registered folder', () => {
      const provider = makeProvider([FOLDER, '/c/projects/other-repo']);
      expect(isAuthorizedWorkspace('/c/projects/unrelated', provider)).toBe(
        false,
      );
    });
  });
});
