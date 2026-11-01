/**
 * D-2 retired-copy removal proofs for the Claude target (TASK_2026_853,
 * Batch 24a, decision #59).
 *
 * Since Batch 22 the builder drops retired skills.sh roots from the desired
 * state, so their `.claude/skills/<slug>` and `.claude/commands/<slug>.md`
 * copies become removals. They must run the same proof
 * `WorkspaceHarnessTarget` runs (`retirement-proof.ts`): deleted only when
 * unchanged AND provably untracked, otherwise kept and reported `keptRetired`,
 * never snapshot-removed.
 *
 * Every case runs in its own `mkdtemp` root; removals run against a REAL
 * `git init` repository with the real git probe.
 */

import { execFileSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type {
  HarnessHealth,
  HarnessTargetHealth,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { HarnessStateStore } from '../gitignore/harness-state-store';
import { hashDir, hashFile } from '../hash/content-hash';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import type { HarnessDesiredState } from '../manifest/desired-state.types';
import {
  emptyManifest,
  managedEntry,
  ManagedManifestStore,
  type ManagedEntries,
  type ManagedManifest,
} from '../manifest-store/managed-manifest';
import { HarnessReconcilerService } from '../reconciler/harness-reconciler.service';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import { ClaudeTarget } from './claude-target';
import type {
  HarnessApplyResult,
  HarnessRetiredSources,
} from './harness-target.port';

const SKILL = '.claude/skills/retired-skill';
const COMMAND = '.claude/commands/retired-cmd.md';
const ORDINARY = '.claude/skills/ordinary';
const ROOT_ID = 'ptah-skillssh-retired';
const ITEM_ID = `skills-sh:${ROOT_ID}` as const;
const HISTORY = join('.ptah', 'harness', '.history');

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
  execFileSync(
    'git',
    [
      '-c',
      'init.defaultBranch=main',
      '-c',
      'user.name=ptah-test',
      '-c',
      'user.email=ptah-test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, env, stdio: 'ignore' },
  );
}

describe('ClaudeTarget — retired copy removal proofs (D-2)', () => {
  let tempRoot: string;
  let ws: string;
  let retiredRoot: string;
  let retired: HarnessRetiredSources;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'ptah-b24a-claude-'));
    ws = join(tempRoot, 'ws');
    mkdirSync(ws, { recursive: true });
    retiredRoot = join(tempRoot, 'plugins', ROOT_ID);
    retired = { skillSourceRoots: [retiredRoot], mcpServerKeys: [] };
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const skillDir = (relPath = SKILL) => join(ws, ...relPath.split('/'));
  const skillFile = (relPath = SKILL) => join(skillDir(relPath), 'SKILL.md');

  /** Write a skill copy and answer its hash, the one Ptah would record. */
  async function writeSkillCopy(
    relPath = SKILL,
    content = '# retired\n',
  ): Promise<string> {
    mkdirSync(skillDir(relPath), { recursive: true });
    writeFileSync(skillFile(relPath), content);
    const hash = await hashDir(skillDir(relPath));
    if (hash === null) throw new Error('fixture copy did not hash');
    return hash;
  }

  function manifestWith(entries: ManagedEntries): ManagedManifest {
    return { ...emptyManifest('claude'), entries };
  }

  function retiredSkillEntry(hash: string): ManagedEntries {
    return {
      [SKILL]: managedEntry(
        hash,
        join(retiredRoot, 'skills', 'retired-skill'),
        'skill',
      ),
    };
  }

  async function reconcileOnce(
    manifest: ManagedManifest,
  ): Promise<HarnessApplyResult> {
    const target = new ClaudeTarget(new ManagedManifestStore());
    const plan = await target.plan(
      EMPTY_DESIRED,
      ws,
      manifest,
      undefined,
      retired,
    );
    return target.apply(plan, ws);
  }

  it('tags a skill or command removal under a retired root with its item id and leaves other removals untagged', async () => {
    const plan = await new ClaudeTarget(new ManagedManifestStore()).plan(
      EMPTY_DESIRED,
      ws,
      manifestWith({
        ...retiredSkillEntry('h1'),
        [COMMAND]: managedEntry(
          'h2',
          join(retiredRoot, 'commands', 'retired-cmd.md'),
          'command',
        ),
        [ORDINARY]: managedEntry('h3', '/elsewhere/ordinary', 'skill'),
      }),
      undefined,
      retired,
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
          relPath: COMMAND,
          kind: 'command',
          isDirectory: false,
          retiredItemId: ITEM_ID,
        },
        { relPath: ORDINARY, kind: 'skill', isDirectory: true },
      ]),
    );
  });

  it('real git: removes an unchanged, owned, untracked copy and reports removedRetired', async () => {
    git(ws, 'init', '-q');
    const hash = await writeSkillCopy();

    const result = await reconcileOnce(manifestWith(retiredSkillEntry(hash)));

    expect(existsSync(skillDir())).toBe(false);
    expect(result.removed).toEqual([SKILL]);
    expect(result.removedRetired).toEqual([
      { relPath: SKILL, itemId: ITEM_ID },
    ]);
    expect(result.keptRetired ?? []).toEqual([]);
    expect(result.writeFailed).toEqual([]);
    // Deleted on proof, not snapshotted into the history store.
    expect(existsSync(join(ws, HISTORY, 'retired-skill'))).toBe(false);
  });

  it('real git: removes an unchanged untracked retired COMMAND copy', async () => {
    git(ws, 'init', '-q');
    const file = join(ws, ...COMMAND.split('/'));
    mkdirSync(join(ws, '.claude', 'commands'), { recursive: true });
    writeFileSync(file, 'run it\n');
    const hash = await hashFile(file);
    if (hash === null) throw new Error('fixture command did not hash');

    const result = await reconcileOnce(
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

  it('real git: keeps a git-tracked copy intact and reports it kept git-tracked', async () => {
    git(ws, 'init', '-q');
    const hash = await writeSkillCopy();
    git(ws, 'add', '--', SKILL);
    git(ws, 'commit', '-q', '-m', 'track the skill copy');

    const result = await reconcileOnce(manifestWith(retiredSkillEntry(hash)));

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

    const result = await reconcileOnce(manifestWith(retiredSkillEntry(hash)));

    expect(readFileSync(skillFile(), 'utf-8')).toBe(
      '# retired\nmy own notes\n',
    );
    expect(result.removed).toEqual([]);
    expect(result.keptRetired).toEqual([
      { relPath: SKILL, itemId: ITEM_ID, reason: 'edited' },
    ]);
    expect(existsSync(join(ws, HISTORY))).toBe(false);
  });

  it('real git: keeps the copy `unverifiable` outside any repository', async () => {
    const hash = await writeSkillCopy();

    const result = await reconcileOnce(manifestWith(retiredSkillEntry(hash)));

    expect(existsSync(skillFile())).toBe(true);
    expect(result.removed).toEqual([]);
    expect(result.keptRetired).toEqual([
      { relPath: SKILL, itemId: ITEM_ID, reason: 'unverifiable' },
    ]);
  });

  it('a non-retired removal keeps its plain path: a git-tracked owned copy is still removed, with no retirement outcome', async () => {
    git(ws, 'init', '-q');
    const hash = await writeSkillCopy(ORDINARY, '# ordinary\n');
    git(ws, 'add', '--', ORDINARY);
    git(ws, 'commit', '-q', '-m', 'track the ordinary copy');

    const result = await reconcileOnce(
      manifestWith({
        [ORDINARY]: managedEntry(hash, '/elsewhere/ordinary', 'skill'),
      }),
    );

    expect(existsSync(skillDir(ORDINARY))).toBe(false);
    expect(result.removed).toEqual([ORDINARY]);
    expect(result.removedRetired).toBeUndefined();
    expect(result.keptRetired).toBeUndefined();
    expect(result.writeFailed).toEqual([]);
  });

  it('reconciler: carries the Claude target retirement outcomes into health and disowns the kept copy', async () => {
    git(ws, 'init', '-q');
    const store = new HarnessStateStore();
    store.save(ws, { ...store.load(ws), skillSyncMode: 'all' });
    const removedHash = await writeSkillCopy();
    const trackedRel = '.claude/skills/tracked-skill';
    const trackedHash = await writeSkillCopy(trackedRel, '# tracked\n');
    git(ws, 'add', '--', trackedRel);
    git(ws, 'commit', '-q', '-m', 'track one retired copy');

    const manifests = new ManagedManifestStore();
    manifests.save(ws, 'claude', {
      ...retiredSkillEntry(removedHash),
      [trackedRel]: managedEntry(
        trackedHash,
        join(retiredRoot, 'skills', 'tracked-skill'),
        'skill',
      ),
    });
    const userLayer = join(tempRoot, 'user');
    const logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const reconciler = new HarnessReconcilerService(
      logger as unknown as Logger,
      new HarnessManifestBuilder(),
      manifests,
      createStaticSourceResolver({
        layout: {
          skillsRoot: join(userLayer, 'skills'),
          commandsRoot: join(userLayer, 'commands'),
          agentsRoot: join(userLayer, 'agents'),
        },
        overlayPluginPaths: [],
        disabledSkillIds: [],
        disabledPluginIds: [],
        retired,
      }),
      [new ClaudeTarget(manifests)],
    );

    const health: HarnessHealth = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'test',
    });
    const claude = health.targets.find(
      (t): t is HarnessTargetHealth => t.target === 'claude',
    );
    if (claude === undefined) throw new Error('claude target missing');

    expect(claude.removedRetired).toEqual([
      { relPath: SKILL, itemId: ITEM_ID },
    ]);
    expect(claude.keptRetired).toEqual([
      { relPath: trackedRel, itemId: ITEM_ID, reason: 'git-tracked' },
    ]);
    expect(existsSync(skillDir())).toBe(false);
    expect(readFileSync(skillFile(trackedRel), 'utf-8')).toBe('# tracked\n');
    expect(Object.keys(manifests.load(ws, 'claude').entries)).toEqual([]);
  });
});
