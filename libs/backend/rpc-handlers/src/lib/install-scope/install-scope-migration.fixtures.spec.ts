/**
 * Independent fixture suite for `InstallScopeMigrationService`
 * (TASK_2026_853 D-6, Batch 34). Complements the unit spec: it drives the
 * service through whole runs against REAL git workspaces (`git init` in temp
 * directories) and a temp home, and asserts only on what the user could
 * observe - the files on disk, the persisted ledger and `readNotice()`.
 *
 * The reconciler is a fixture double: for each workspace it applies a plan of
 * retired copies to the real files (a copy that `git ls-files` shows as tracked
 * is kept, an untracked one is removed, a home-config fragment is edited out of
 * the temp `~/.claude.json`) and reports the result as `HarnessHealth`. What is
 * under test is the service's ledger, retry and notice behaviour, not the D-2
 * removal policy (pinned in harness-sync).
 */

import 'reflect-metadata';

import { execFileSync } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

let fakeHome = '';

jest.mock('os', () => {
  const actual = jest.requireActual('os');
  return { ...actual, homedir: () => fakeHome };
});

// Same stub as the unit spec: the agent-generation barrel reaches
// workspace-intelligence, whose tree-sitter module cannot load under Jest.
jest.mock('@ptah-extension/workspace-intelligence', () =>
  require('../../test-utils/heavy-module-mocks').workspaceIntelligenceMock(),
);

import { tmpdir } from 'os';
import type {
  HarnessFacetMatrix,
  HarnessHealth,
  HarnessKeptRetiredPath,
  HarnessRetiredItemId,
  HarnessRetiredPath,
  HarnessWriteFailure,
} from '@ptah-extension/shared';

import {
  InstallScopeMigrationService,
  installScopeLedgerPath,
  type InstallScopeLedger,
  type InstallScopeReconciler,
} from './install-scope-migration.service';

const ITEM: HarnessRetiredItemId = 'mcp:alpha';
const HOME_FRAGMENT = '~/.claude.json#mcp.alpha';
const FACETS: HarnessFacetMatrix = {
  skills: 'supported',
  commands: 'supported',
  agents: 'supported',
  mcp: 'supported',
};

let tempBase: string;
let logger: {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};
let recent: string[];
let retiredMcp: Array<{ serverKey: string; retiredAt: string }>;

/** A retired copy the fixture reconciler knows about in one workspace. */
interface PlannedCopy {
  relPath: string;
  /** The first reconcile reports a write failure and leaves the copy. */
  failOnce?: boolean;
}

let plans: Map<string, PlannedCopy[]>;
let failedOnce: Set<string>;
let reconcileCalls: string[];

beforeEach(async () => {
  tempBase = await fs.mkdtemp(path.join(tmpdir(), 'ptah-install-scope-fx-'));
  fakeHome = path.join(tempBase, 'home');
  await fs.mkdir(path.join(fakeHome, '.ptah', 'plugins'), { recursive: true });
  logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  recent = [];
  retiredMcp = [];
  plans = new Map();
  failedOnce = new Set();
  reconcileCalls = [];
});

afterEach(async () => {
  await fs.rm(tempBase, { recursive: true, force: true });
});

// ------------------------------------------------------------------ helpers

const claudeJson = (): string => path.join(fakeHome, '.claude.json');

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function isTracked(cwd: string, relPath: string): boolean {
  try {
    git(cwd, 'ls-files', '--error-unmatch', '--', relPath);
    return true;
  } catch {
    return false;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

/** A real git repository in a temp directory; `.git` marks the root. */
async function makeGitWorkspace(name: string): Promise<string> {
  const dir = path.join(tempBase, 'workspaces', name);
  await fs.mkdir(dir, { recursive: true });
  git(dir, 'init', '-q');
  return dir;
}

async function writeCopy(
  workspace: string,
  relPath: string,
  tracked = false,
): Promise<void> {
  const target = path.join(workspace, ...relPath.split('/'), 'SKILL.md');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, '# alpha', 'utf8');
  if (tracked) git(workspace, 'add', '--', path.join(...relPath.split('/')));
}

async function writeHomeConfig(
  servers: Record<string, unknown>,
): Promise<void> {
  await fs.writeFile(
    claudeJson(),
    JSON.stringify({ mcpServers: servers }),
    'utf8',
  );
}

async function readHomeServers(): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await fs.readFile(claudeJson(), 'utf8')) as {
    mcpServers: Record<string, unknown>;
  };
  return parsed.mcpServers;
}

function healthOf(
  workspaceRoot: string,
  removed: HarnessRetiredPath[],
  kept: HarnessKeptRetiredPath[],
  failed: HarnessWriteFailure[],
): HarnessHealth {
  return {
    workspaceRoot,
    generatedAt: new Date().toISOString(),
    mode: 'full',
    reason: 'install-scope-migration',
    sources: 'ok',
    collisions: [],
    targets: [
      {
        target: 'claude',
        detected: true,
        facets: FACETS,
        expected: 0,
        found: 0,
        missing: [],
        foreign: [],
        writeFailed: failed,
        keptLocalEdit: [],
        removed: removed.map((row) => row.relPath),
        removedRetired: removed,
        keptRetired: kept,
        durationMs: 0,
      },
    ],
  };
}

/** Applies the workspace's plan to the real files; idempotent per copy. */
const reconciler: InstallScopeReconciler = {
  async reconcile(cwd): Promise<HarnessHealth> {
    reconcileCalls.push(cwd);
    const removed: HarnessRetiredPath[] = [];
    const kept: HarnessKeptRetiredPath[] = [];
    const failed: HarnessWriteFailure[] = [];
    for (const copy of plans.get(cwd) ?? []) {
      const base = { relPath: copy.relPath, itemId: ITEM };
      if (copy.relPath === HOME_FRAGMENT) {
        const servers = await readHomeServers();
        delete servers['alpha'];
        await writeHomeConfig(servers);
        removed.push(base);
        continue;
      }
      const abs = path.join(cwd, ...copy.relPath.split('/'));
      if (!(await exists(abs))) {
        removed.push(base);
      } else if (isTracked(cwd, copy.relPath)) {
        kept.push({ ...base, reason: 'git-tracked' });
      } else if (copy.failOnce && !failedOnce.has(`${cwd}|${copy.relPath}`)) {
        failedOnce.add(`${cwd}|${copy.relPath}`);
        failed.push({ ...base, reason: 'EBUSY: simulated' });
      } else {
        await fs.rm(abs, { recursive: true, force: true });
        removed.push(base);
      }
    }
    return healthOf(cwd, removed, kept, failed);
  },
};

function makeService(): InstallScopeMigrationService {
  return new InstallScopeMigrationService(
    logger as unknown as never,
    reconciler,
    { list: async () => recent.map((p) => ({ path: p })) },
    { getWorkspaceFolders: () => [] },
    fakeHome,
    null,
    { listRetired: () => retiredMcp },
  );
}

async function readLedger(): Promise<InstallScopeLedger> {
  return JSON.parse(
    await fs.readFile(installScopeLedgerPath(fakeHome), 'utf8'),
  ) as InstallScopeLedger;
}

const callsTo = (workspace: string): number =>
  reconcileCalls.filter((call) => call === workspace).length;

// -------------------------------------------------------------------- suite

describe('InstallScopeMigrationService fixtures (real git workspaces)', () => {
  beforeEach(() => {
    retiredMcp = [{ serverKey: 'alpha', retiredAt: '2026-01-01T00:00:00.000Z' }];
  });

  it('ends retired 1 / removed 2 across two git workspaces after a partial failure and retry', async () => {
    const w1 = await makeGitWorkspace('one');
    const w2 = await makeGitWorkspace('two');
    await writeCopy(w1, '.claude/skills/alpha');
    await writeCopy(w2, '.claude/skills/alpha');
    recent = [w1, w2];
    plans.set(w1, [{ relPath: '.claude/skills/alpha' }]);
    plans.set(w2, [{ relPath: '.claude/skills/alpha', failOnce: true }]);

    const first = await makeService().run();

    // Partial failure: w1 is done, w2's copy is still on disk and failed.
    expect(first.status).toBe('incomplete');
    expect(first.counts).toEqual({ retired: 1, removed: 1, kept: 0, onDisk: 0 });
    expect(await exists(path.join(w1, '.claude/skills/alpha'))).toBe(false);
    expect(await exists(path.join(w2, '.claude/skills/alpha'))).toBe(true);
    const afterFirst = await readLedger();
    expect(afterFirst.completedAt).toBeUndefined();
    expect(Object.keys(afterFirst.items[ITEM].failedPaths)).toEqual([
      `${w2}/.claude/skills/alpha`,
    ]);
    expect(afterFirst.items[ITEM].outcome).toBeUndefined();
    expect(afterFirst.workspaces[w1].passedAt).toBeDefined();
    expect(afterFirst.workspaces[w2].passedAt).toBeUndefined();
    expect(callsTo(w1)).toBe(1);
    expect(callsTo(w2)).toBe(1);

    const second = await makeService().run();

    // Retry touches the failed workspace only, and nothing is recounted.
    expect(second.status).toBe('completed');
    expect(second.counts).toEqual({ retired: 1, removed: 2, kept: 0, onDisk: 0 });
    expect(callsTo(w1)).toBe(1);
    expect(callsTo(w2)).toBe(2);
    expect(await exists(path.join(w2, '.claude/skills/alpha'))).toBe(false);
    const afterSecond = await readLedger();
    expect(afterSecond.completedAt).toBeDefined();
    expect(afterSecond.items[ITEM].failedPaths).toEqual({});
    expect(afterSecond.items[ITEM].outcome).toBe('removed');
    expect(Object.keys(afterSecond.items[ITEM].removedPaths).sort()).toEqual([
      `${w1}/.claude/skills/alpha`,
      `${w2}/.claude/skills/alpha`,
    ]);
    expect(afterSecond.items[ITEM].removedPaths[`${w1}/.claude/skills/alpha`]).toBe(
      afterFirst.items[ITEM].removedPaths[`${w1}/.claude/skills/alpha`],
    );

    const third = await makeService().run();
    expect(third.status).toBe('already-completed');
    expect(third.counts).toEqual({ retired: 1, removed: 2, kept: 0, onDisk: 0 });
    expect(reconcileCalls).toHaveLength(3);
  });

  it('keeps mixed fragments across the retry: nothing lost, nothing recounted, hand-added entries preserved', async () => {
    const w1 = await makeGitWorkspace('one');
    const w2 = await makeGitWorkspace('two');
    await writeCopy(w1, '.claude/skills/alpha');
    await writeCopy(w1, '.cursor/rules/alpha', true);
    await writeCopy(w1, '.claude/skills/handmade');
    await writeCopy(w2, '.claude/skills/alpha');
    await writeHomeConfig({
      alpha: { command: 'alpha-server' },
      handmade: { command: 'my-own-server' },
    });
    recent = [w1, w2];
    plans.set(w1, [
      { relPath: '.claude/skills/alpha' },
      { relPath: '.cursor/rules/alpha' },
      { relPath: HOME_FRAGMENT },
    ]);
    plans.set(w2, [
      { relPath: '.claude/skills/alpha', failOnce: true },
      { relPath: HOME_FRAGMENT },
    ]);

    const first = await makeService().run();

    // Both workspaces reached the shared home fragment; it counts once.
    expect(first.status).toBe('incomplete');
    expect(first.counts).toEqual({ retired: 1, removed: 2, kept: 1, onDisk: 0 });
    const afterFirst = await readLedger();
    const homeStamp = afterFirst.items[ITEM].removedPaths[HOME_FRAGMENT];
    const keptKey = `${w1}/.cursor/rules/alpha`;
    expect(homeStamp).toBeDefined();
    expect(afterFirst.items[ITEM].keptPaths[keptKey]).toBe('git-tracked');
    expect(Object.keys(afterFirst.items[ITEM].failedPaths)).toEqual([
      `${w2}/.claude/skills/alpha`,
    ]);

    const second = await makeService().run();

    expect(second.status).toBe('completed');
    expect(second.counts).toEqual({ retired: 1, removed: 3, kept: 1, onDisk: 0 });
    const afterSecond = await readLedger();
    const item = afterSecond.items[ITEM];
    // Earlier records survive the retry unchanged.
    expect(item.removedPaths[HOME_FRAGMENT]).toBe(homeStamp);
    expect(item.keptPaths[keptKey]).toBe('git-tracked');
    expect(Object.keys(item.removedPaths).sort()).toEqual(
      [
        HOME_FRAGMENT,
        `${w1}/.claude/skills/alpha`,
        `${w2}/.claude/skills/alpha`,
      ].sort(),
    );
    expect(item.failedPaths).toEqual({});
    expect(item.outcome).toBe('removed');
    expect(callsTo(w1)).toBe(1);
    expect(callsTo(w2)).toBe(2);

    // The user's own entries and the tracked copy are untouched.
    expect(await readHomeServers()).toEqual({
      handmade: { command: 'my-own-server' },
    });
    expect(await exists(path.join(w1, '.claude/skills/handmade/SKILL.md'))).toBe(
      true,
    );
    expect(await exists(path.join(w1, '.cursor/rules/alpha/SKILL.md'))).toBe(true);
    expect(JSON.stringify(afterSecond)).not.toContain('handmade');
  });

  describe('readNotice', () => {
    it('is null before any run, and null while the migration is incomplete', async () => {
      const w1 = await makeGitWorkspace('one');
      await writeCopy(w1, '.claude/skills/alpha');
      recent = [w1];
      plans.set(w1, [{ relPath: '.claude/skills/alpha', failOnce: true }]);
      const service = makeService();

      expect(await service.readNotice()).toBeNull();
      const first = await service.run();
      expect(first.status).toBe('incomplete');
      expect(await service.readNotice()).toBeNull();

      await service.run();
      expect(await service.readNotice()).not.toBeNull();
    });

    it('shows a retired-only state, persists it until dismissal and records seenAt', async () => {
      const service = makeService();

      const result = await service.run();
      expect(result.status).toBe('completed');
      expect(result.counts).toEqual({ retired: 1, removed: 0, kept: 0, onDisk: 0 });

      const notice = await service.readNotice();
      expect(notice).not.toBeNull();
      expect(notice?.counts).toEqual({ retired: 1, removed: 0, kept: 0, onDisk: 0 });
      expect(notice?.keptPaths).toEqual([]);
      expect(notice?.onDisk).toEqual([]);
      expect(notice?.completedAt).toBe((await readLedger()).completedAt);

      // Persisted: repeated reads and a fresh instance (a new app start).
      expect(await service.readNotice()).toEqual(notice);
      expect(await makeService().readNotice()).toEqual(notice);
      expect((await readLedger()).noticeSeenAt).toBeUndefined();

      expect(await service.dismissNotice()).toBe(true);
      const seenAt = (await readLedger()).noticeSeenAt;
      expect(seenAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));

      expect(await service.readNotice()).toBeNull();
      expect(await makeService().readNotice()).toBeNull();

      // seenAt is persisted once and survives a re-run and a second dismissal.
      expect((await makeService().run()).status).toBe('already-completed');
      expect(await makeService().dismissNotice()).toBe(true);
      expect((await readLedger()).noticeSeenAt).toBe(seenAt);
    });

    it('dismissNotice reports false when no ledger exists', async () => {
      expect(await makeService().dismissNotice()).toBe(false);
      expect(await exists(installScopeLedgerPath(fakeHome))).toBe(false);
    });
  });
});
