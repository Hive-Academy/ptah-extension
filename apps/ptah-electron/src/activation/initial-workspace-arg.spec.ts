import * as path from 'path';

import { resolveInitialWorkspaceArg } from './initial-workspace-arg';

describe('resolveInitialWorkspaceArg', () => {
  const executable = 'electron.exe';
  const flag = '--remote-debugging-port=9334';
  const entry = 'dist/apps/ptah-electron/main.mjs';
  const folder = 'projects/workspace';

  it('ignores the entry file when a flag occupies argv[1]', () => {
    expect(
      resolveInitialWorkspaceArg([executable, flag, entry], () => false),
    ).toBeUndefined();
  });

  it('returns the resolved directory argument', () => {
    expect(
      resolveInitialWorkspaceArg(
        [executable, entry, folder],
        (candidate) => candidate === path.resolve(folder),
      ),
    ).toBe(path.resolve(folder));
  });

  it('ignores a missing path', () => {
    expect(
      resolveInitialWorkspaceArg([executable, entry, 'missing'], () => false),
    ).toBeUndefined();
  });

  it('skips a file and chooses a later directory', () => {
    expect(
      resolveInitialWorkspaceArg(
        [executable, flag, entry, folder],
        (candidate) => candidate === path.resolve(folder),
      ),
    ).toBe(path.resolve(folder));
  });
});
