import {
  clampActiveWorkspaceIndex,
  isWorkspaceFolder,
  persistedActiveFolderName,
  persistedWorkspaceFolders,
} from './electron-layout-persisted-state';

describe('electron-layout persisted state readers', () => {
  describe('isWorkspaceFolder', () => {
    it('accepts an entry with string path and name', () => {
      expect(isWorkspaceFolder({ path: '/a', name: 'a' })).toBe(true);
    });

    it.each([
      null,
      undefined,
      '/a',
      42,
      { path: '/a' },
      { name: 'a' },
      { path: 1, name: 'a' },
      { path: '/a', name: null },
    ])('rejects %p', (value) => {
      expect(isWorkspaceFolder(value)).toBe(false);
    });
  });

  describe('persistedWorkspaceFolders', () => {
    it('keeps only the valid entries', () => {
      expect(
        persistedWorkspaceFolders({
          workspaceFolders: [{ path: '/a', name: 'a' }, { bogus: true }, null],
        }),
      ).toEqual([{ path: '/a', name: 'a' }]);
    });

    it('is null when the state has no folder array', () => {
      expect(persistedWorkspaceFolders({})).toBeNull();
    });
  });

  describe('clampActiveWorkspaceIndex', () => {
    it.each([
      [1, 3, 1],
      [7, 3, 2],
      [-4, 3, 0],
      [0, 0, 0],
      [5, 0, 0],
      [1.5, 3, 0],
      [Number.NaN, 3, 0],
      [Number.POSITIVE_INFINITY, 3, 0],
      [undefined, 3, 0],
      ['1', 3, 0],
    ])('clamps %p over %p folders to %p', (requested, count, expected) => {
      expect(clampActiveWorkspaceIndex(requested, count)).toBe(expected);
    });
  });

  describe('persistedActiveFolderName', () => {
    const folders = [
      { path: '/projects/first', name: 'first' },
      { path: 'D:\\projects\\second\\', name: 'second-name' },
    ];

    it('names the active folder by its path basename', () => {
      expect(
        persistedActiveFolderName({
          workspaceFolders: folders,
          activeWorkspaceIndex: 1,
        }),
      ).toBe('second');
    });

    it('uses the clamped index, counting only valid entries', () => {
      expect(
        persistedActiveFolderName({
          workspaceFolders: [{ bogus: true }, ...folders],
          activeWorkspaceIndex: 9,
        }),
      ).toBe('second');
    });

    it('treats a fractional index like the restore path does (folder 0)', () => {
      expect(
        persistedActiveFolderName({
          workspaceFolders: folders,
          activeWorkspaceIndex: 1.5,
        }),
      ).toBe('first');
    });

    it('falls back to the stored name when the path has no segment', () => {
      expect(
        persistedActiveFolderName({
          workspaceFolders: [{ path: '', name: 'stored' }],
        }),
      ).toBe('stored');
    });

    it('is null for an empty or missing folder list', () => {
      expect(persistedActiveFolderName({ workspaceFolders: [] })).toBeNull();
      expect(persistedActiveFolderName({})).toBeNull();
    });
  });
});
