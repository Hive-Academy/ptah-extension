/**
 * `InstallScopeMigrationService` (TASK_2026_853 D-6) against real temp
 * directories. Nothing here touches the real home directory: `os.homedir()` is
 * mocked to a temp home (the user-layer reaper's write guard and the harness
 * root resolver read it), and the service gets the same home explicitly.
 *
 * The reconciler is a fake that returns per-workspace health, because what is
 * under test is how the ledger merges and retries those results; the D-2
 * policy itself is pinned in harness-sync. The clone pass uses the REAL
 * `UserLayerOrphanReaper` except where a failure has to be injected.
 */

import 'reflect-metadata';

import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

let fakeHome = '';

jest.mock('os', () => {
  const actual = jest.requireActual('os');
  return { ...actual, homedir: () => fakeHome };
});

// The agent-generation barrel (the reaper's home) reaches workspace-
// intelligence, whose tree-sitter module cannot load under Jest's CJS
// transform; the shared stub keeps the module graph short of it.
jest.mock('@ptah-extension/workspace-intelligence', () =>
  require('../../test-utils/heavy-module-mocks').workspaceIntelligenceMock(),
);

import { tmpdir } from 'os';
import {
  SKILLS_SH_OWNER_MARKER,
  SKILLS_SH_RETIRED_FILE,
  type HarnessFacetMatrix,
  type HarnessHealth,
  type HarnessKeptRetiredPath,
  type HarnessRetiredPath,
  type HarnessWriteFailure,
} from '@ptah-extension/shared';
import type { ReapResult } from '@ptah-extension/agent-generation';

import {
  InstallScopeMigrationService,
  installScopeLedgerPath,
  type InstallScopeCloneReaper,
  type InstallScopeLedger,
  type InstallScopeMigrationRunResult,
  type InstallScopeReconciler,
} from './install-scope-migration.service';
import { SKILLS_SH_METADATA_FILE } from '../skills-sh/skills-sh-source-root';

const sha256 = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

let tempBase: string;
let pluginsDir: string;
let logger: {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};
let recent: string[];
let openFolders: string[];
let retiredMcp: Array<{ serverKey: string; retiredAt: string }>;
let reconcile: jest.Mock<
  Promise<HarnessHealth>,
  Parameters<InstallScopeReconciler['reconcile']>
>;

beforeEach(async () => {
  tempBase = await fs.mkdtemp(path.join(tmpdir(), 'ptah-install-scope-'));
  fakeHome = path.join(tempBase, 'home');
  pluginsDir = path.join(fakeHome, '.ptah', 'plugins');
  await fs.mkdir(pluginsDir, { recursive: true });
  logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  recent = [];
  openFolders = [];
  retiredMcp = [];
  reconcile = jest.fn<
    Promise<HarnessHealth>,
    Parameters<InstallScopeReconciler['reconcile']>
  >(async (cwd) => health(cwd, {}));
});

afterEach(async () => {
  await fs.rm(tempBase, { recursive: true, force: true });
});

function makeService(
  reaper: InstallScopeCloneReaper | null = null,
): InstallScopeMigrationService {
  return new InstallScopeMigrationService(
    logger as unknown as never,
    { reconcile },
    { list: async () => recent.map((p) => ({ path: p })) },
    { getWorkspaceFolders: () => openFolders },
    fakeHome,
    reaper,
    { listRetired: () => retiredMcp },
  );
}

// ------------------------------------------------------------------ fixtures

const rootDir = (rootId: string): string => path.join(pluginsDir, rootId);

async function writeFiles(
  dir: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split('/'));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }
}

/** A root Ptah wrote: v2 metadata, owner marker, every file hashed. */
async function writeV2Root(
  rootId: string,
  files: Record<string, string> = { 'skills/a/SKILL.md': '# a' },
  overrides: { ownerMarker?: string } = {},
): Promise<string> {
  const dir = rootDir(rootId);
  await writeFiles(dir, files);
  const hashes: Record<string, string> = {};
  for (const [rel, content] of Object.entries(files)) {
    hashes[rel] = sha256(content);
  }
  await fs.writeFile(
    path.join(dir, SKILLS_SH_METADATA_FILE),
    JSON.stringify({
      version: 2,
      owner: 'ptah',
      ownerMarker: overrides.ownerMarker ?? SKILLS_SH_OWNER_MARKER,
      source: 'owner/repo',
      skillIds: ['a'],
      installedAt: '2026-01-01T00:00:00.000Z',
      scope: 'global',
      files: hashes,
    }),
    'utf8',
  );
  return dir;
}

/** A pre-D-8 root: provenance only, never proof. */
async function writeV1Root(
  rootId: string,
  files: Record<string, string> = { 'skills/a/SKILL.md': '# a' },
): Promise<string> {
  const dir = rootDir(rootId);
  await writeFiles(dir, files);
  await fs.writeFile(
    path.join(dir, SKILLS_SH_METADATA_FILE),
    JSON.stringify({
      version: 1,
      source: 'owner/repo',
      skillIds: ['a'],
      installedAt: '2026-01-01T00:00:00.000Z',
    }),
    'utf8',
  );
  return dir;
}

/**
 * A one-file user-layer skill clone of `rootId`. `sourceHash` is the mirror's
 * hash of a one-file tree: `sha256:` + sha256 of the JSON manifest
 * `{"SKILL.md": sha256(content)}` (source-hash.ts `computeSourceHash`).
 */
async function seedClone(
  slug: string,
  content: string,
  rootId: string,
): Promise<string> {
  const dir = path.join(fakeHome, '.ptah', 'user', 'skills', slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), content, 'utf8');
  const sourceHash = `sha256:${sha256(
    JSON.stringify({ 'SKILL.md': sha256(content) }),
  )}`;
  await fs.writeFile(
    path.join(dir, '.ptah-origin.json'),
    JSON.stringify({
      kind: 'skill',
      slug,
      pluginId: rootId,
      version: null,
      sourceHash,
      clonedAt: 1,
      diverged: false,
      lastEnhancedAt: null,
      historyDir: '.history',
      sourceRef: `skills-sh:${rootId}`,
    }),
    'utf8',
  );
  return dir;
}

/** A workspace that resolves to itself (`.ptah` is the first root marker). */
async function makeWorkspace(name: string): Promise<string> {
  const dir = path.join(tempBase, 'workspaces', name);
  await fs.mkdir(path.join(dir, '.ptah'), { recursive: true });
  return dir;
}

const FACETS: HarnessFacetMatrix = {
  skills: 'supported',
  commands: 'supported',
  agents: 'supported',
  mcp: 'supported',
};

function health(
  workspaceRoot: string,
  parts: {
    removed?: HarnessRetiredPath[];
    kept?: HarnessKeptRetiredPath[];
    failed?: HarnessWriteFailure[];
  },
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
        writeFailed: parts.failed ?? [],
        keptLocalEdit: [],
        removed: (parts.removed ?? []).map((row) => row.relPath),
        removedRetired: parts.removed ?? [],
        keptRetired: parts.kept ?? [],
        durationMs: 0,
      },
    ],
  };
}

async function readLedger(): Promise<InstallScopeLedger> {
  return JSON.parse(
    await fs.readFile(installScopeLedgerPath(fakeHome), 'utf8'),
  ) as InstallScopeLedger;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

function fakeReaper(
  results: Array<Partial<ReapResult>>,
): InstallScopeCloneReaper & { reapRetired: jest.Mock } {
  const queue = [...results];
  return {
    reapRetired: jest.fn(async () => ({
      reaped: 0,
      orphaned: 0,
      errors: 0,
      reapedClones: [],
      orphanedClones: [],
      reapedPaths: [],
      keptPaths: [],
      failedPaths: [],
      ...(queue.shift() ?? {}),
    })),
  };
}

// --------------------------------------------------------------------- tests

describe('InstallScopeMigrationService — retire', () => {
  it('retires every global skills.sh root and v1 MCP server, and never lists bundled, external, harness, staging or synced items', async () => {
    await writeV1Root('ptah-skillssh-acme-tools');
    await writeFiles(path.join(pluginsDir, 'ptah-core'), { 'x.md': 'x' });
    await writeFiles(path.join(pluginsDir, 'external', 'o', 'r'), {
      'y.md': 'y',
    });
    await writeFiles(path.join(pluginsDir, 'ptah-harness-mine'), {
      'z.md': 'z',
    });
    await writeFiles(path.join(pluginsDir, '.staging-ptah-skillssh-x-1'), {
      'w.md': 'w',
    });
    const synced = path.join(
      fakeHome,
      '.claude',
      'skills',
      'synced',
      'acct_org',
    );
    await writeFiles(synced, { 'manifest.json': '{"skills":[]}' });
    retiredMcp = [{ serverKey: 'github', retiredAt: '2026-02-02T00:00:00Z' }];

    const result = await makeService().run();

    expect(result.status).toBe('completed');
    const registry = JSON.parse(
      await fs.readFile(path.join(pluginsDir, SKILLS_SH_RETIRED_FILE), 'utf8'),
    );
    expect(Object.keys(registry.roots)).toEqual(['ptah-skillssh-acme-tools']);
    const ledger = await readLedger();
    expect(Object.keys(ledger.items).sort()).toEqual([
      'mcp:github',
      'skills-sh:ptah-skillssh-acme-tools',
    ]);
    expect(ledger.items['mcp:github']).toMatchObject({
      kind: 'mcp',
      retired: true,
      retiredAt: '2026-02-02T00:00:00Z',
      outcome: 'retired',
    });
    for (const untouched of [
      path.join(pluginsDir, 'ptah-core', 'x.md'),
      path.join(pluginsDir, 'external', 'o', 'r', 'y.md'),
      path.join(pluginsDir, 'ptah-harness-mine', 'z.md'),
      path.join(pluginsDir, '.staging-ptah-skillssh-x-1', 'w.md'),
      path.join(synced, 'manifest.json'),
    ]) {
      expect(await exists(untouched)).toBe(true);
    }
  });

  it('keeps an existing registry entry and its retiredAt', async () => {
    await writeV1Root('ptah-skillssh-acme-tools');
    await fs.writeFile(
      path.join(pluginsDir, SKILLS_SH_RETIRED_FILE),
      JSON.stringify({
        version: 1,
        roots: { 'ptah-skillssh-old-one': { retiredAt: '2025-01-01T00:00:00Z' } },
      }),
      'utf8',
    );

    await makeService().run();

    const registry = JSON.parse(
      await fs.readFile(path.join(pluginsDir, SKILLS_SH_RETIRED_FILE), 'utf8'),
    );
    expect(registry.roots['ptah-skillssh-old-one']).toEqual({
      retiredAt: '2025-01-01T00:00:00Z',
    });
    expect(Object.keys(registry.roots).sort()).toEqual([
      'ptah-skillssh-acme-tools',
      'ptah-skillssh-old-one',
    ]);
  });
});

describe('InstallScopeMigrationService — global deletes with proof', () => {
  it('deletes a v2 root with the owner marker and every hash proved', async () => {
    const dir = await writeV2Root('ptah-skillssh-acme-tools');

    const result = await makeService().run();

    expect(result).toEqual({
      status: 'completed',
      counts: { retired: 1, removed: 1, kept: 0, onDisk: 0 },
    });
    expect(await exists(dir)).toBe(false);
    const item = (await readLedger()).items['skills-sh:ptah-skillssh-acme-tools'];
    expect(Object.keys(item.removedPaths)).toEqual([dir]);
    expect(item.outcome).toBe('removed');
  });

  it('keeps a v1 root whose user-layer clone matches it: the root is onDisk, the clone follows the clone rule', async () => {
    const dir = await writeV1Root('ptah-skillssh-acme-tools', {
      'skills/a/SKILL.md': '# a',
      'skills/b/SKILL.md': '# b',
    });
    const unchanged = await seedClone('a', '# a', 'ptah-skillssh-acme-tools');
    const edited = await seedClone('b', '# b', 'ptah-skillssh-acme-tools');
    await fs.writeFile(path.join(edited, 'SKILL.md'), '# my edit', 'utf8');

    const result = await makeService().run();

    expect(result.status).toBe('completed');
    // A matching clone sidecar is never ownership proof for the root.
    expect(await exists(path.join(dir, 'skills', 'a', 'SKILL.md'))).toBe(true);
    // The real reaper deleted the unchanged clone and kept the edited one.
    expect(await exists(unchanged)).toBe(false);
    expect(await fs.readFile(path.join(edited, 'SKILL.md'), 'utf8')).toBe(
      '# my edit',
    );
    const item = (await readLedger()).items['skills-sh:ptah-skillssh-acme-tools'];
    expect(item).toMatchObject({
      onDisk: dir,
      onDiskReason: 'legacy-v1',
      removedPaths: { [unchanged]: expect.any(String) },
      keptPaths: { [edited]: 'edited' },
      failedPaths: {},
      outcome: 'removed',
    });
    expect(result.counts).toEqual({
      retired: 1,
      removed: 1,
      kept: 1,
      onDisk: 1,
    });
  });

  const refusals: Array<{
    name: string;
    reason: string;
    setup: (dir: string) => Promise<void>;
    ownerMarker?: string;
  }> = [
    {
      name: 'an edited file',
      reason: 'hash-mismatch',
      setup: (dir) =>
        fs.writeFile(path.join(dir, 'skills', 'a', 'SKILL.md'), '# edit'),
    },
    {
      name: 'an extra unlisted file',
      reason: 'unlisted-file',
      setup: (dir) => fs.writeFile(path.join(dir, 'skills', 'a', 'x.md'), 'x'),
    },
    {
      name: 'the owner marker removed',
      reason: 'wrong-marker',
      ownerMarker: 'not-the-marker',
      setup: async () => undefined,
    },
    {
      name: 'a symlink inside the root',
      reason: 'not-regular-file',
      setup: async (dir) => {
        const outside = path.join(tempBase, 'outside.md');
        await fs.writeFile(outside, 'outside');
        await fs.symlink(outside, path.join(dir, 'skills', 'a', 'link.md'));
      },
    },
  ];

  it.each(refusals)(
    'refuses a v2 root with $name: retired, kept onDisk ($reason)',
    async ({ reason, setup, ownerMarker }) => {
      const dir = await writeV2Root(
        'ptah-skillssh-acme-tools',
        undefined,
        ownerMarker === undefined ? {} : { ownerMarker },
      );
      await setup(dir);

      const result = await makeService().run();

      expect(await exists(path.join(dir, SKILLS_SH_METADATA_FILE))).toBe(true);
      const item = (await readLedger()).items['skills-sh:ptah-skillssh-acme-tools'];
      expect(item).toMatchObject({
        retired: true,
        onDisk: dir,
        onDiskReason: reason,
        removedPaths: {},
        outcome: 'onDisk',
      });
      expect(result.counts).toEqual({
        retired: 1,
        removed: 0,
        kept: 0,
        onDisk: 1,
      });
    },
  );

  it('refuses a markerless root (no metadata) and a root that is itself a symlink', async () => {
    const bare = rootDir('ptah-skillssh-bare-root');
    await writeFiles(bare, { 'skills/a/SKILL.md': '# a' });
    const target = await writeV2Root('ptah-skillssh-real-root');
    // The link points at a fully proven root; the link itself is never owned.
    await fs.rename(target, path.join(tempBase, 'elsewhere'));
    await fs.symlink(
      path.join(tempBase, 'elsewhere'),
      rootDir('ptah-skillssh-linked-root'),
    );

    await makeService().run();

    const ledger = await readLedger();
    expect(ledger.items['skills-sh:ptah-skillssh-bare-root']).toMatchObject({
      onDisk: bare,
      onDiskReason: 'metadata-missing',
    });
    expect(ledger.items['skills-sh:ptah-skillssh-linked-root']).toMatchObject({
      onDisk: rootDir('ptah-skillssh-linked-root'),
      onDiskReason: 'root-not-directory',
    });
    expect(await exists(path.join(bare, 'skills', 'a', 'SKILL.md'))).toBe(true);
    expect(
      await exists(path.join(tempBase, 'elsewhere', SKILLS_SH_METADATA_FILE)),
    ).toBe(true);
  });
});

describe('InstallScopeMigrationService — workspace pass and ledger', () => {
  it('reconciles recent ∪ open existing workspaces once each, with the migration reason', async () => {
    const w1 = await makeWorkspace('w1');
    const w2 = await makeWorkspace('w2');
    recent = [w1, path.join(tempBase, 'gone'), 'relative/path'];
    openFolders = [w2, w1];

    const result = await makeService().run();

    expect(result.status).toBe('completed');
    expect(reconcile.mock.calls.map(([cwd]) => cwd).sort()).toEqual(
      [w1, w2].sort(),
    );
    expect(reconcile.mock.calls[0][1]).toEqual({
      mode: 'full',
      reason: 'install-scope-migration',
    });
    const ledger = await readLedger();
    expect(ledger.workspaces[w1].passedAt).toEqual(expect.any(String));
    expect(ledger.workspaces[w2].passedAt).toEqual(expect.any(String));
  });

  it('writes the ledger after a workspace before the next workspace starts', async () => {
    const w1 = await makeWorkspace('w1');
    const w2 = await makeWorkspace('w2');
    recent = [w1, w2];
    retiredMcp = [{ serverKey: 'S', retiredAt: '2026-02-02T00:00:00Z' }];
    let seenAtW2: InstallScopeLedger | null = null;
    reconcile.mockImplementation(async (cwd: string) => {
      if (cwd === w2) seenAtW2 = await readLedger();
      return health(cwd, {
        removed: [{ relPath: '.mcp.json#S', itemId: 'mcp:S' }],
      });
    });

    await makeService().run();

    const ledgerAtW2 = seenAtW2 as InstallScopeLedger | null;
    expect(ledgerAtW2?.workspaces[w1].passedAt).toEqual(expect.any(String));
    expect(Object.keys(ledgerAtW2?.items['mcp:S'].removedPaths ?? {})).toEqual(
      [`${w1}/.mcp.json#S`],
    );
  });

  it('two workspaces, one fragment fails: incomplete, then a retry of only that workspace completes; retired 1, removed counts each path once (two workspace copies + one shared home fragment)', async () => {
    const w1 = await makeWorkspace('w1');
    const w2 = await makeWorkspace('w2');
    recent = [w1, w2];
    retiredMcp = [{ serverKey: 'S', retiredAt: '2026-02-02T00:00:00Z' }];
    let failW2 = true;
    reconcile.mockImplementation(async (cwd: string) => {
      if (cwd === w2 && failW2) {
        return health(cwd, {
          failed: [{ relPath: '.mcp.json#S', reason: 'EBUSY', itemId: 'mcp:S' }],
        });
      }
      return health(cwd, {
        removed: [
          { relPath: '.mcp.json#S', itemId: 'mcp:S' },
          // A home-config fragment reached from both workspaces counts once.
          { relPath: '~/.codex/config.toml#S', itemId: 'mcp:S' },
        ],
      });
    });
    const service = makeService();

    const first = await service.run();

    expect(first.status).toBe('incomplete');
    let ledger = await readLedger();
    expect(ledger.completedAt).toBeUndefined();
    expect(ledger.workspaces[w2].passedAt).toBeUndefined();
    expect(ledger.items['mcp:S'].failedPaths).toEqual({
      [`${w2}/.mcp.json#S`]: 'EBUSY',
    });
    expect(ledger.items['mcp:S'].outcome).toBeUndefined();
    expect(await service.readNotice()).toBeNull();

    failW2 = false;
    reconcile.mockClear();
    const second = await service.run();

    expect(second.status).toBe('completed');
    // Only the failed workspace was reconciled again.
    expect(reconcile.mock.calls.map(([cwd]) => cwd)).toEqual([w2]);
    ledger = await readLedger();
    expect(ledger.items['mcp:S'].failedPaths).toEqual({});
    expect(Object.keys(ledger.items['mcp:S'].removedPaths).sort()).toEqual(
      [`${w1}/.mcp.json#S`, `${w2}/.mcp.json#S`, '~/.codex/config.toml#S'].sort(),
    );
    expect(second.counts).toEqual({
      retired: 1,
      removed: 3,
      kept: 0,
      onDisk: 0,
    });
  });

  it('a mixed pass (one fragment removed, a second failed) keeps the removed one and counts the failed one once it is removed on retry', async () => {
    const w1 = await makeWorkspace('w1');
    recent = [w1];
    retiredMcp = [
      { serverKey: 'A', retiredAt: '2026-02-02T00:00:00Z' },
      { serverKey: 'B', retiredAt: '2026-02-02T00:00:00Z' },
    ];
    reconcile
      .mockResolvedValueOnce(
        health(w1, {
          removed: [{ relPath: '.mcp.json#A', itemId: 'mcp:A' }],
          failed: [{ relPath: '.mcp.json#B', reason: 'EPERM', itemId: 'mcp:B' }],
        }),
      )
      // The reconciler pruned A's manifest entry, so the retry reports B only.
      .mockResolvedValueOnce(
        health(w1, { removed: [{ relPath: '.mcp.json#B', itemId: 'mcp:B' }] }),
      );
    const service = makeService();

    expect((await service.run()).status).toBe('incomplete');
    const second = await service.run();

    expect(second).toEqual({
      status: 'completed',
      counts: { retired: 2, removed: 2, kept: 0, onDisk: 0 },
    });
  });

  it('a reconcile that throws never rejects the run and leaves the workspace for the next start', async () => {
    const w1 = await makeWorkspace('w1');
    recent = [w1];
    reconcile.mockRejectedValueOnce(new Error('lock timeout'));
    const service = makeService();

    await expect(service.run()).resolves.toMatchObject({
      status: 'incomplete',
    });
    const ledger = await readLedger();
    expect(ledger.workspaces[w1]).toMatchObject({ lastError: 'lock timeout' });
    expect(ledger.workspaces[w1].passedAt).toBeUndefined();

    expect((await service.run()).status).toBe('completed');
  });

  it('a workspace that failed and was deleted since stops blocking completion', async () => {
    const w1 = await makeWorkspace('w1');
    recent = [w1];
    retiredMcp = [{ serverKey: 'S', retiredAt: '2026-02-02T00:00:00Z' }];
    reconcile.mockResolvedValueOnce(
      health(w1, {
        failed: [{ relPath: '.mcp.json#S', reason: 'EBUSY', itemId: 'mcp:S' }],
      }),
    );
    const service = makeService();
    expect((await service.run()).status).toBe('incomplete');

    await fs.rm(w1, { recursive: true, force: true });
    recent = [];
    const second = await service.run();

    expect(second.status).toBe('completed');
    const ledger = await readLedger();
    expect(ledger.workspaces[w1].missingAt).toEqual(expect.any(String));
    expect(ledger.items['mcp:S'].failedPaths).toEqual({});
  });
});

describe('InstallScopeMigrationService — retries and idempotence', () => {
  it('second run after completion is a no-op: no write, no reconcile, no recount', async () => {
    await writeV2Root('ptah-skillssh-acme-tools');
    const w1 = await makeWorkspace('w1');
    recent = [w1];
    const service = makeService();
    const first = await service.run();
    const before = await fs.readFile(installScopeLedgerPath(fakeHome), 'utf8');
    const statBefore = await fs.stat(installScopeLedgerPath(fakeHome));
    reconcile.mockClear();

    const second = await service.run();

    expect(second).toEqual({
      status: 'already-completed',
      counts: first.counts,
    });
    expect(reconcile).not.toHaveBeenCalled();
    expect(await fs.readFile(installScopeLedgerPath(fakeHome), 'utf8')).toBe(
      before,
    );
    expect((await fs.stat(installScopeLedgerPath(fakeHome))).mtimeMs).toBe(
      statBefore.mtimeMs,
    );
  });

  it('a failed clone is retried alone; decided roots are never re-proved', async () => {
    const dir = await writeV1Root('ptah-skillssh-acme-tools');
    const clonePath = path.join(fakeHome, '.ptah', 'user', 'skills', 'a');
    // Still on disk after the failed delete, so the retry must ask the reaper.
    await fs.mkdir(clonePath, { recursive: true });
    const row = {
      kind: 'skill' as const,
      slug: 'a',
      path: clonePath,
      sourceRef: 'skills-sh:ptah-skillssh-acme-tools',
    };
    const reaper = fakeReaper([
      { errors: 1, failedPaths: [{ ...row, error: 'EBUSY' }] },
      { reaped: 1, reapedPaths: [{ ...row, removedPaths: [clonePath] }] },
    ]);
    const service = makeService(reaper);

    const first = await service.run();

    expect(first.status).toBe('incomplete');
    let ledger = await readLedger();
    expect(ledger.clonesPassedAt).toBeUndefined();
    expect(ledger.items['skills-sh:ptah-skillssh-acme-tools'].failedPaths).toEqual(
      { [clonePath]: 'EBUSY' },
    );
    // The reaper only ever sees this ledger's retired roots.
    expect(reaper.reapRetired.mock.calls[0][1]).toEqual({
      version: 1,
      roots: { 'ptah-skillssh-acme-tools': { retiredAt: expect.any(String) } },
    });

    // Turn the kept v1 root into a fully proven v2 root: a decided root is
    // final, so the retry must not re-prove or delete it.
    await fs.rm(dir, { recursive: true, force: true });
    await writeV2Root('ptah-skillssh-acme-tools');

    const second = await service.run();

    expect(second.status).toBe('completed');
    expect(reaper.reapRetired).toHaveBeenCalledTimes(2);
    expect(await exists(dir)).toBe(true);
    ledger = await readLedger();
    const item = ledger.items['skills-sh:ptah-skillssh-acme-tools'];
    expect(item.failedPaths).toEqual({});
    expect(Object.keys(item.removedPaths)).toEqual([clonePath]);
    expect(item.onDisk).toBe(dir);
    expect(second.counts).toEqual({
      retired: 1,
      removed: 1,
      kept: 0,
      onDisk: 1,
    });
  });

  it('a clone sweep that passed is not run again for a workspace-only retry', async () => {
    await writeV1Root('ptah-skillssh-acme-tools');
    const w1 = await makeWorkspace('w1');
    recent = [w1];
    reconcile.mockRejectedValueOnce(new Error('busy'));
    const reaper = fakeReaper([{}, {}]);
    const service = makeService(reaper);

    expect((await service.run()).status).toBe('incomplete');
    expect((await service.run()).status).toBe('completed');

    expect(reaper.reapRetired).toHaveBeenCalledTimes(1);
  });

  it('a ledger that cannot be written stops the run before any delete and resolves failed', async () => {
    const dir = await writeV2Root('ptah-skillssh-acme-tools');
    // A read-only ledger directory: the read finds no ledger, the write fails.
    const migrations = path.join(fakeHome, '.ptah', 'migrations');
    await fs.mkdir(migrations, { recursive: true });
    await fs.chmod(migrations, 0o555);

    let result: InstallScopeMigrationRunResult | undefined;
    try {
      result = await makeService().run();
    } finally {
      await fs.chmod(migrations, 0o755);
    }

    expect(result?.status).toBe('failed');
    expect(await exists(path.join(dir, SKILLS_SH_METADATA_FILE))).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('resumes on the next start'),
      expect.any(Error),
    );
  });

  it('a malformed ledger is set aside and the run starts fresh', async () => {
    await fs.mkdir(path.join(fakeHome, '.ptah', 'migrations'), {
      recursive: true,
    });
    await fs.writeFile(installScopeLedgerPath(fakeHome), '{not json', 'utf8');

    const result = await makeService().run();

    expect(result.status).toBe('completed');
    const entries = await fs.readdir(path.join(fakeHome, '.ptah', 'migrations'));
    expect(entries.some((name) => name.includes('.corrupt-'))).toBe(true);
  });
});

describe('InstallScopeMigrationService — notice', () => {
  it('is null before completion, shown when retired-only, and persists until dismissed', async () => {
    const service = makeService();
    expect(await service.readNotice()).toBeNull();
    expect(await service.dismissNotice()).toBe(false);

    retiredMcp = [{ serverKey: 'S', retiredAt: '2026-02-02T00:00:00Z' }];
    await service.run();

    const notice = await service.readNotice();
    expect(notice).toEqual({
      completedAt: expect.any(String),
      counts: { retired: 1, removed: 0, kept: 0, onDisk: 0 },
      keptPaths: [],
      onDisk: [],
    });
    expect(await service.readNotice()).toEqual(notice);

    expect(await service.dismissNotice()).toBe(true);
    expect(await service.readNotice()).toBeNull();
    expect((await readLedger()).noticeSeenAt).toEqual(expect.any(String));
  });

  it('reports kept paths (minus removed) and onDisk sources', async () => {
    const dir = await writeV1Root('ptah-skillssh-acme-tools');
    const w1 = await makeWorkspace('w1');
    recent = [w1];
    reconcile.mockResolvedValueOnce(
      health(w1, {
        kept: [
          {
            relPath: '.claude/skills/a',
            itemId: 'skills-sh:ptah-skillssh-acme-tools',
            reason: 'git-tracked',
          },
        ],
      }),
    );
    const service = makeService();

    await service.run();

    expect(await service.readNotice()).toMatchObject({
      counts: { retired: 1, removed: 0, kept: 1, onDisk: 1 },
      keptPaths: [
        {
          path: `${w1}/.claude/skills/a`,
          reason: 'git-tracked',
          itemId: 'skills-sh:ptah-skillssh-acme-tools',
        },
      ],
      onDisk: [
        {
          itemId: 'skills-sh:ptah-skillssh-acme-tools',
          path: dir,
          reason: 'legacy-v1',
        },
      ],
    });
  });

  it('is null after completion when nothing was retired', async () => {
    const service = makeService();
    expect((await service.run()).status).toBe('completed');
    expect(await service.readNotice()).toBeNull();
  });
});
