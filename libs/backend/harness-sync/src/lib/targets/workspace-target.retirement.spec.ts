/**
 * D-2 retirement removal policy for workspace copies (TASK_2026_853, Batch 23).
 *
 * A manifest-owned copy of a RETIRED skills.sh source is deleted only when it
 * is unchanged AND git proves it untracked; every other outcome keeps the copy
 * on disk, untouched and never snapshotted, and reports it `keptRetired`. An
 * I/O failure keeps the entry owned (`writeFailed` with the item id).
 *
 * Every destructive case runs in its own `mkdtemp` root. The positive cases use
 * a REAL `git init` repository and the real git probe; git-missing, timeout and
 * unknown-stderr outcomes substitute the runner, because a real git cannot be
 * made to produce them on demand.
 */

import { execFileSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { HarnessFacetMatrix } from '@ptah-extension/shared';
import { hashDir, hashFile } from '../hash/content-hash';
import type { HarnessDesiredState } from '../manifest/desired-state.types';
import {
  emptyManifest,
  managedEntry,
  ManagedManifestStore,
  type ManagedEntries,
  type ManagedManifest,
} from '../manifest-store/managed-manifest';
import type {
  HarnessApplyResult,
  HarnessRetiredSources,
} from './harness-target.port';
import {
  classifyGitLsFiles,
  containedTargetPath,
  createGitTrackingProbe,
  GIT_NO_MATCH_MESSAGE,
  type GitRunner,
  type GitTrackingProbe,
} from './retirement-proof';
import { WorkspaceHarnessTarget } from './workspace-target';

const SKILL = '.cursor/skills/retired-skill';
const COMMAND = '.cursor/commands/retired-cmd.md';
const ROOT_ID = 'ptah-skillssh-retired';
const ITEM_ID = `skills-sh:${ROOT_ID}`;
const HISTORY = join('.ptah', 'harness', '.history');

const FACETS: HarnessFacetMatrix = {
  skills: 'supported',
  commands: 'supported',
  agents: 'unsupported',
  mcp: 'unsupported',
};

const EMPTY_DESIRED: HarnessDesiredState = {
  skills: [],
  commands: [],
  agents: [],
  mcp: [],
  collisions: [],
  sources: 'ok',
  sourceRoots: [],
};

/** Git with no inherited repository location, as the production probe runs it. */
function git(cwd: string, ...args: string[]): void {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['GIT_DIR'];
  delete env['GIT_WORK_TREE'];
  delete env['GIT_INDEX_FILE'];
  execFileSync('git', ['-c', 'init.defaultBranch=main', ...args], {
    cwd,
    env,
    stdio: 'ignore',
  });
}

/** A runner that answers one fixed outcome and records each call. */
function stubRunner(
  outcome: Awaited<ReturnType<GitRunner>>,
): GitRunner & { calls: Array<{ args: readonly string[]; cwd: string }> } {
  const calls: Array<{ args: readonly string[]; cwd: string }> = [];
  const run = ((args: readonly string[], cwd: string) => {
    calls.push({ args, cwd });
    return Promise.resolve(outcome);
  }) as GitRunner & { calls: typeof calls };
  run.calls = calls;
  return run;
}

const UNTRACKED_RUN = {
  kind: 'exited',
  exitCode: 1,
  stderr: `error: pathspec 'x' ${GIT_NO_MATCH_MESSAGE}\nDid you forget to 'git add'?\n`,
} as const;

describe('WorkspaceHarnessTarget — retired copy removal proofs (D-2)', () => {
  let tempRoot: string;
  let ws: string;
  let retiredRoot: string;
  let retired: HarnessRetiredSources;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'ptah-b23-ws-'));
    ws = join(tempRoot, 'ws');
    mkdirSync(ws, { recursive: true });
    retiredRoot = join(tempRoot, 'plugins', ROOT_ID);
    retired = { skillSourceRoots: [retiredRoot], mcpServerKeys: [] };
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function makeTarget(gitTrackingProbe?: GitTrackingProbe) {
    return new WorkspaceHarnessTarget({
      id: 'cursor',
      facets: FACETS,
      manifestStore: new ManagedManifestStore(),
      detector: { isInstalled: () => Promise.resolve(true) },
      skillsDirRel: '.cursor/skills',
      commandsDirRel: '.cursor/commands',
      ...(gitTrackingProbe === undefined ? {} : { gitTrackingProbe }),
    });
  }

  /** Write the skill copy and answer its hash, the one Ptah would record. */
  async function writeSkillCopy(content = '# retired\n'): Promise<string> {
    const dir = join(ws, ...SKILL.split('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), content);
    const hash = await hashDir(dir);
    if (hash === null) throw new Error('fixture copy did not hash');
    return hash;
  }

  function manifestWith(entries: ManagedEntries): ManagedManifest {
    return { ...emptyManifest('cursor'), entries };
  }

  function skillEntry(hash: string): ManagedEntries {
    return {
      [SKILL]: managedEntry(
        hash,
        join(retiredRoot, 'skills', 'retired-skill'),
        'skill',
      ),
    };
  }

  async function reconcileOnce(
    target: WorkspaceHarnessTarget,
    manifest: ManagedManifest,
  ): Promise<HarnessApplyResult> {
    const plan = await target.plan(
      EMPTY_DESIRED,
      ws,
      manifest,
      undefined,
      retired,
    );
    return target.apply(plan, ws);
  }

  const skillFile = () => join(ws, ...SKILL.split('/'), 'SKILL.md');

  it('marks a removal under a retired root with skillsShRetiredItemId(basename(root))', async () => {
    const hash = await writeSkillCopy();
    const plan = await makeTarget().plan(
      EMPTY_DESIRED,
      ws,
      manifestWith({
        ...skillEntry(hash),
        '.cursor/skills/ordinary': managedEntry(
          'h',
          '/elsewhere/ordinary',
          'skill',
        ),
      }),
      undefined,
      // A trailing separator must not change the root id.
      { skillSourceRoots: [`${retiredRoot}/`], mcpServerKeys: [] },
    );
    expect(plan.removals).toEqual(
      expect.arrayContaining([
        {
          relPath: SKILL,
          kind: 'skill',
          isDirectory: true,
          retiredItemId: ITEM_ID,
        },
        {
          relPath: '.cursor/skills/ordinary',
          kind: 'skill',
          isDirectory: true,
        },
      ]),
    );
  });

  it('real git: deletes an unchanged, owned, untracked copy (exit 1 + no-match)', async () => {
    git(ws, 'init', '-q');
    const hash = await writeSkillCopy();

    const result = await reconcileOnce(
      makeTarget(),
      manifestWith(skillEntry(hash)),
    );

    expect(existsSync(join(ws, ...SKILL.split('/')))).toBe(false);
    expect(result.removed).toEqual([SKILL]);
    expect(result.removedRetired).toEqual([
      { relPath: SKILL, itemId: ITEM_ID },
    ]);
    expect(result.keptRetired ?? []).toEqual([]);
    expect(result.writeFailed).toEqual([]);
    expect(result.removedLocalEdit).toEqual([]);
    // Deleted, not snapshotted: nothing left in the history store.
    expect(existsSync(join(ws, HISTORY, 'retired-skill'))).toBe(false);
  });

  it('real git: deletes an unchanged untracked retired COMMAND file', async () => {
    git(ws, 'init', '-q');
    const file = join(ws, ...COMMAND.split('/'));
    mkdirSync(join(ws, '.cursor', 'commands'), { recursive: true });
    writeFileSync(file, 'run it\n');
    const hash = (await hashFile(file)) as string;

    const result = await reconcileOnce(
      makeTarget(),
      manifestWith({
        [COMMAND]: managedEntry(
          hash,
          join(retiredRoot, 'commands', 'retired-cmd.md'),
          'command',
        ),
      }),
    );

    expect(existsSync(file)).toBe(false);
    expect(result.removedRetired).toEqual([
      { relPath: COMMAND, itemId: ITEM_ID },
    ]);
  });

  it('real git: keeps a git-tracked copy (exit 0) and disowns it', async () => {
    git(ws, 'init', '-q');
    const hash = await writeSkillCopy();
    git(ws, 'add', '--', SKILL);

    const result = await reconcileOnce(
      makeTarget(),
      manifestWith(skillEntry(hash)),
    );

    expect(readFileSync(skillFile(), 'utf-8')).toBe('# retired\n');
    expect(result.removed).toEqual([]);
    expect(result.removedRetired ?? []).toEqual([]);
    expect(result.keptRetired).toEqual([
      { relPath: SKILL, itemId: ITEM_ID, reason: 'git-tracked' },
    ]);
    expect(result.writeFailed).toEqual([]);
  });

  it('real git: keeps an edited copy as `edited`, untouched and never snapshotted', async () => {
    git(ws, 'init', '-q');
    const hash = await writeSkillCopy();
    writeFileSync(skillFile(), '# retired\nmy own notes\n');

    const result = await reconcileOnce(
      makeTarget(),
      manifestWith(skillEntry(hash)),
    );

    expect(readFileSync(skillFile(), 'utf-8')).toBe(
      '# retired\nmy own notes\n',
    );
    expect(result.removed).toEqual([]);
    expect(result.removedLocalEdit).toEqual([]);
    expect(result.keptRetired).toEqual([
      { relPath: SKILL, itemId: ITEM_ID, reason: 'edited' },
    ]);
    expect(existsSync(join(ws, HISTORY))).toBe(false);
  });

  it('real git: keeps the copy `unverifiable` outside any repository (exit 128)', async () => {
    const hash = await writeSkillCopy();

    const result = await reconcileOnce(
      makeTarget(),
      manifestWith(skillEntry(hash)),
    );

    expect(existsSync(skillFile())).toBe(true);
    expect(result.removed).toEqual([]);
    expect(result.keptRetired).toEqual([
      { relPath: SKILL, itemId: ITEM_ID, reason: 'unverifiable' },
    ]);
  });

  it.each([
    ['git missing (ENOENT)', { kind: 'failed', reason: 'ENOENT' } as const],
    ['git timed out', { kind: 'failed', reason: 'timed out' } as const],
    [
      'exit 1 with another message',
      { kind: 'exited', exitCode: 1, stderr: 'fatal: something else' } as const,
    ],
    [
      'exit 128 not a repository',
      {
        kind: 'exited',
        exitCode: 128,
        stderr:
          'fatal: not a git repository (or any of the parent directories): .git',
      } as const,
    ],
  ])('keeps the copy `unverifiable` when %s', async (_label, outcome) => {
    const hash = await writeSkillCopy();
    const run = stubRunner(outcome);

    const result = await reconcileOnce(
      makeTarget(createGitTrackingProbe(run)),
      manifestWith(skillEntry(hash)),
    );

    expect(existsSync(skillFile())).toBe(true);
    expect(result.removed).toEqual([]);
    expect(result.keptRetired).toEqual([
      { relPath: SKILL, itemId: ITEM_ID, reason: 'unverifiable' },
    ]);
    // Argument array, workspace root as cwd, literal pathspec after `--`.
    expect(run.calls).toEqual([
      {
        args: [
          '--literal-pathspecs',
          'ls-files',
          '--error-unmatch',
          '--',
          SKILL,
        ],
        cwd: ws,
      },
    ]);
  });

  it('an I/O failure while deleting stays owned: writeFailed with the item id, copy intact', async () => {
    const hash = await writeSkillCopy();
    // `.ptah` as a FILE makes the detach's history directory impossible.
    writeFileSync(join(ws, '.ptah'), 'not a directory');

    const result = await reconcileOnce(
      makeTarget(createGitTrackingProbe(stubRunner(UNTRACKED_RUN))),
      manifestWith(skillEntry(hash)),
    );

    expect(existsSync(skillFile())).toBe(true);
    expect(result.removed).toEqual([]);
    expect(result.keptRetired ?? []).toEqual([]);
    expect(result.writeFailed).toEqual([
      expect.objectContaining({ relPath: SKILL, itemId: ITEM_ID }),
    ]);
  });

  it('a link on the way to the copy keeps it `unverifiable` and follows nothing', async () => {
    const outside = join(tempRoot, 'outside-skills');
    mkdirSync(join(outside, 'retired-skill'), { recursive: true });
    writeFileSync(join(outside, 'retired-skill', 'SKILL.md'), '# retired\n');
    const hash = (await hashDir(join(outside, 'retired-skill'))) as string;
    mkdirSync(join(ws, '.cursor'), { recursive: true });
    symlinkSync(outside, join(ws, '.cursor', 'skills'), 'dir');
    const run = stubRunner(UNTRACKED_RUN);

    const result = await reconcileOnce(
      makeTarget(createGitTrackingProbe(run)),
      manifestWith(skillEntry(hash)),
    );

    expect(existsSync(join(outside, 'retired-skill', 'SKILL.md'))).toBe(true);
    expect(result.keptRetired).toEqual([
      { relPath: SKILL, itemId: ITEM_ID, reason: 'unverifiable' },
    ]);
    expect(run.calls).toEqual([]);
  });

  it('a manifest path escaping the workspace is kept `unverifiable` and never probed', async () => {
    const outsideFile = join(tempRoot, 'escape.md');
    writeFileSync(outsideFile, 'outside\n');
    const run = stubRunner(UNTRACKED_RUN);

    const result = await reconcileOnce(
      makeTarget(createGitTrackingProbe(run)),
      manifestWith({
        '../escape.md': managedEntry(
          (await hashFile(outsideFile)) as string,
          join(retiredRoot, 'commands', 'escape.md'),
          'command',
        ),
      }),
    );

    expect(existsSync(outsideFile)).toBe(true);
    expect(result.keptRetired).toEqual([
      { relPath: '../escape.md', itemId: ITEM_ID, reason: 'unverifiable' },
    ]);
    expect(run.calls).toEqual([]);
  });

  it('an already-absent retired copy counts as removed without asking git', async () => {
    const run = stubRunner(UNTRACKED_RUN);

    const result = await reconcileOnce(
      makeTarget(createGitTrackingProbe(run)),
      manifestWith(skillEntry('h-gone')),
    );

    expect(result.removed).toEqual([SKILL]);
    expect(result.removedRetired).toEqual([
      { relPath: SKILL, itemId: ITEM_ID },
    ]);
    expect(run.calls).toEqual([]);
  });

  it('a non-retired removal keeps the existing retire-with-snapshot path', async () => {
    const hash = await writeSkillCopy();
    const run = stubRunner(UNTRACKED_RUN);

    const result = await reconcileOnce(
      makeTarget(createGitTrackingProbe(run)),
      manifestWith({
        [SKILL]: managedEntry(hash, '/some/live/source/retired-skill', 'skill'),
      }),
    );

    expect(existsSync(skillFile())).toBe(false);
    expect(result.removed).toEqual([SKILL]);
    expect(result.removedRetired).toBeUndefined();
    expect(result.keptRetired).toBeUndefined();
    expect(run.calls).toEqual([]);
  });
});

describe('classifyGitLsFiles (D-D7)', () => {
  it.each([
    [{ kind: 'exited', exitCode: 0, stderr: '' }, 'tracked'],
    [UNTRACKED_RUN, 'untracked'],
    [{ kind: 'exited', exitCode: 1, stderr: 'error: other' }, 'unverifiable'],
    [
      { kind: 'exited', exitCode: 128, stderr: 'fatal: not a git repository' },
      'unverifiable',
    ],
    [
      { kind: 'exited', exitCode: 2, stderr: GIT_NO_MATCH_MESSAGE },
      'unverifiable',
    ],
    [{ kind: 'failed', reason: 'ENOENT' }, 'unverifiable'],
    [{ kind: 'failed', reason: 'timed out' }, 'unverifiable'],
  ] as const)('%j -> %s', (outcome, expected) => {
    expect(classifyGitLsFiles(outcome)).toBe(expected);
  });
});

describe('containedTargetPath', () => {
  const root = join(tmpdir(), 'ptah-b23-root');

  it.each([
    '',
    '/abs/path',
    'C:/drive',
    '../up',
    'a/../../up',
    'a/./b',
    'a//b',
    'a\\b',
    '~/home/file',
    '.',
  ])('rejects %j', (relPath) => {
    expect(containedTargetPath(root, relPath)).toBeNull();
  });

  it('accepts a plain relative POSIX path inside the root', () => {
    expect(containedTargetPath(root, '.cursor/skills/x')).toBe(
      join(root, '.cursor', 'skills', 'x'),
    );
  });
});
