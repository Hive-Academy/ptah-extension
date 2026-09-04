/**
 * The agent-clone workspace key (TASK_2026_365).
 *
 * The defect this key closes: `~/.ptah/user/agents` was one directory per
 * MACHINE while its source was the per-workspace `{ws}/.claude/agents`, so two
 * projects whose wizard-tailored agents share a slug addressed one file and
 * overwrote each other on every activation. Every case below is a property that
 * has to hold for the key to keep them apart, or a spelling that must NOT split
 * one workspace into two directories.
 */

import {
  USER_LAYER_AGENTS_DIR_NAME,
  userLayerAgentDirName,
} from './user-layer-agents';

describe('userLayerAgentDirName', () => {
  it('gives two different workspaces two different directories', () => {
    expect(userLayerAgentDirName('/home/u/alpha', 'linux')).not.toBe(
      userLayerAgentDirName('/home/u/beta', 'linux'),
    );
  });

  it('separates two checkouts of the SAME project name', () => {
    // The readable label is identical, so only the hash can tell them apart —
    // and it must, or a second clone of a repository silently shares the first
    // one's agents.
    const a = userLayerAgentDirName('/home/u/work/ptah', 'linux');
    const b = userLayerAgentDirName('/home/u/archive/ptah', 'linux');
    expect(a).not.toBe(b);
    expect(a.startsWith('ptah-')).toBe(true);
    expect(b.startsWith('ptah-')).toBe(true);
  });

  it('answers the same for every spelling of one root', () => {
    const answers = new Set([
      userLayerAgentDirName('D:\\projects\\ptah', 'win32'),
      userLayerAgentDirName('D:/projects/ptah', 'win32'),
      userLayerAgentDirName('D:\\projects\\ptah\\', 'win32'),
      userLayerAgentDirName('d:\\PROJECTS\\Ptah', 'win32'),
    ]);
    expect(answers.size).toBe(1);
  });

  it('folds case on win32 and NEVER on linux', () => {
    // On NTFS `D:\App` and `D:\app` are one directory; on ext4 they are two.
    // Folding unconditionally would merge two real workspaces, which is the
    // collision this key exists to remove.
    expect(userLayerAgentDirName('/a/App', 'win32')).toBe(
      userLayerAgentDirName('/a/app', 'win32'),
    );
    expect(userLayerAgentDirName('/a/App', 'linux')).not.toBe(
      userLayerAgentDirName('/a/app', 'linux'),
    );
  });

  it('is a single safe path segment', () => {
    const name = userLayerAgentDirName(
      '/home/u/My Project (v2)! & more',
      'linux',
    );
    expect(name).toMatch(/^[a-z0-9._-]+$/);
    expect(name).not.toContain('/');
    expect(name).not.toContain('\\');
  });

  it('still produces a usable name for a root with no readable segment', () => {
    const name = userLayerAgentDirName('/', 'linux');
    expect(name).toMatch(/^ws-[0-9a-f]+$/);
  });

  it('is stable across calls', () => {
    expect(userLayerAgentDirName('/home/u/alpha', 'linux')).toBe(
      userLayerAgentDirName('/home/u/alpha', 'linux'),
    );
  });

  it('keeps the base directory name the mirror and the reconciler share', () => {
    // Both sides join this constant before the key. A second spelling of it is
    // how the writer and the reader come to use two different directories.
    expect(USER_LAYER_AGENTS_DIR_NAME).toBe('agents');
  });
});
