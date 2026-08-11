/**
 * `EXCLUDED_DIRS_GLOB` specs — TASK_2026_206.
 *
 * The glob that `editor:searchInFiles` and `editor:listAllFiles` hand to
 * `findFiles` used to be two hand-written literals naming 5 of
 * `TREE_HIDDEN_DIRS`' 11 members. These tests pin the derivation itself, not
 * a snapshot of today's names, so adding a member to the shared set keeps
 * them green while reverting to a literal turns them red.
 */

import { TREE_HIDDEN_DIRS } from '@ptah-extension/shared';
import { EXCLUDED_DIRS_GLOB } from './editor-rpc.handlers';

/** The brace body, i.e. what sits between `**\/{` and `}/**`. */
function braceMembers(glob: string): string[] {
  const match = glob.match(/^\*\*\/\{(.+)\}\/\*\*$/);
  if (!match) {
    throw new Error(`EXCLUDED_DIRS_GLOB is not a brace glob: ${glob}`);
  }
  return match[1].split(',');
}

describe('EXCLUDED_DIRS_GLOB', () => {
  it('names every TREE_HIDDEN_DIRS member and nothing else', () => {
    expect(braceMembers(EXCLUDED_DIRS_GLOB).sort()).toEqual(
      [...TREE_HIDDEN_DIRS].sort(),
    );
  });

  it('covers the six names the previous hand-written literal missed', () => {
    const members = new Set(braceMembers(EXCLUDED_DIRS_GLOB));
    for (const name of [
      '.hg',
      '.svn',
      '.DS_Store',
      '.Trash',
      '.tmp',
      '.temp',
    ]) {
      expect(members.has(name)).toBe(true);
    }
  });

  it('is derived from the shared set rather than restated', () => {
    expect(EXCLUDED_DIRS_GLOB).toBe(
      `**/{${[...TREE_HIDDEN_DIRS].join(',')}}/**`,
    );
  });
});
