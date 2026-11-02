/**
 * D-2 retirement outcomes across a whole reconcile pass (TASK_2026_853,
 * Batch 24).
 *
 * The target-level proofs live in `workspace-target.retirement.spec.ts` and
 * `mcp-facet-planner.retirement.spec.ts`. This suite owns what the RECONCILER
 * does with them:
 *
 * - it hands `source.retired` to every target's plan, so a removal of a retired
 *   copy runs the proof policy instead of a plain delete;
 * - it prunes the manifest only from what the apply REPORTED: `removed` goes,
 *   `keptRetired` is disowned (entry dropped, file kept), a `writeFailed` row
 *   keeps its entry so the next pass retries it;
 * - it carries `removedRetired` / `keptRetired` into the target health, keyed
 *   for the ledger by `harnessPathIdentity(workspaceRoot, relPath)`;
 * - it passes the workspace root to the builder, which activates the workspace
 *   skills.sh exemption (D-D4) on both `reconcile` and `verify`.
 *
 * Every case runs in its own `mkdtemp` root. Removals that must happen run in a
 * REAL `git init` repository with the real git probe.
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
import {
  harnessPathIdentity,
  type HarnessFacetMatrix,
  type HarnessHealth,
  type HarnessTargetHealth,
  type McpServerConfig,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { HarnessStateStore } from '../gitignore/harness-state-store';
import { hashDir } from '../hash/content-hash';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import {
  managedEntry,
  ManagedManifestStore,
  type ManagedEntries,
} from '../manifest-store/managed-manifest';
import type { HarnessSourceState } from '../sources/harness-source.port';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import type { IHarnessMcpFacet } from '../targets/mcp/mcp-facet.port';
import { createMcpFacet } from '../targets/mcp/mcp-facet.registry';
import { hashMcpConfig } from '../targets/mcp/mcp-json-format';
import { WorkspaceHarnessTarget } from '../targets/workspace-target';
import { HarnessReconcilerService } from './harness-reconciler.service';

const ROOT_ID = 'ptah-skillssh-retired';
const SKILL_ITEM = `skills-sh:${ROOT_ID}` as const;
const RETIRED_SKILL = '.cursor/skills/retired-skill';
const TRACKED_SKILL = '.cursor/skills/tracked-skill';
const MCP_CONFIG = '.cursor/mcp.json';
const KEY_REMOVED = 'srv-removed';
const KEY_EDITED = 'srv-edited';
const KEY_FAILING = 'srv-failing';
const KEY_HAND = 'srv-hand';
const RETIRED_KEYS = [KEY_REMOVED, KEY_EDITED, KEY_FAILING];

const FACETS: HarnessFacetMatrix = {
  skills: 'supported',
  commands: 'supported',
  agents: 'unsupported',
  mcp: 'supported',
};

/** Raw config entries as a user's JSON file spells them. */
const RAW_SERVERS = {
  [KEY_REMOVED]: { command: 'npx', args: ['removed'] },
  [KEY_EDITED]: { command: 'npx', args: ['edited'] },
  [KEY_FAILING]: { command: 'npx', args: ['failing'] },
  [KEY_HAND]: { command: 'my-own', args: [] },
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

function grantSkills(
  workspaceRoot: string,
  mode: 'all' | 'selected',
  slugs: string[] = [],
): void {
  const store = new HarnessStateStore();
  store.save(workspaceRoot, {
    ...store.load(workspaceRoot),
    skillSyncMode: mode,
    ...(mode === 'selected' ? { enabledSkillSlugs: slugs } : {}),
  });
}

function writeSkillDir(dir: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: x\n---\n${body}\n`);
}

/**
 * The cursor facet with one key whose removal fails while `failing.on` holds —
 * an I/O error on one path in the middle of an otherwise good pass.
 */
function flakyCursorFacet(failing: { on: boolean }): IHarnessMcpFacet {
  const real = createMcpFacet('cursor');
  const canonicalize = real.canonicalize?.bind(real);
  return {
    ...(canonicalize === undefined ? {} : { canonicalize }),
    target: real.target,
    mcpTarget: real.mcpTarget,
    configRelPath: () => real.configRelPath(),
    configPath: (ws) => real.configPath(ws),
    readAll: (ws) => real.readAll(ws),
    inspect: (ws) => real.inspect(ws),
    write: (ws, key, config) => real.write(ws, key, config),
    remove: (ws, key) => {
      if (failing.on && key === KEY_FAILING) {
        return Promise.reject(new Error('EBUSY: resource busy'));
      }
      return real.remove(ws, key);
    },
  };
}

function cursorHealth(health: HarnessHealth): HarnessTargetHealth {
  const target = health.targets.find((t) => t.target === 'cursor');
  if (target === undefined) throw new Error('cursor target missing');
  return target;
}

describe('HarnessReconcilerService — retirement outcomes (D-2)', () => {
  let tempRoot: string;
  let retiredRoot: string;
  let userLayer: string;
  let failing: { on: boolean };
  let store: ManagedManifestStore;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'ptah-b24-recon-'));
    retiredRoot = join(tempRoot, 'plugins', ROOT_ID);
    userLayer = join(tempRoot, 'user');
    failing = { on: false };
    store = new ManagedManifestStore();
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function sourceState(
    overrides: Partial<HarnessSourceState> = {},
  ): HarnessSourceState {
    return {
      layout: {
        skillsRoot: join(userLayer, 'skills'),
        commandsRoot: join(userLayer, 'commands'),
        agentsRoot: join(userLayer, 'agents'),
      },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
      retired: {
        skillSourceRoots: [retiredRoot],
        mcpServerKeys: RETIRED_KEYS,
      },
      ...overrides,
    };
  }

  function newReconciler(
    state: HarnessSourceState,
    builder = new HarnessManifestBuilder(),
  ): HarnessReconcilerService {
    const logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    return new HarnessReconcilerService(
      logger as unknown as Logger,
      builder,
      store,
      createStaticSourceResolver(state),
      [
        new WorkspaceHarnessTarget({
          id: 'cursor',
          facets: FACETS,
          manifestStore: store,
          detector: { isInstalled: () => Promise.resolve(true) },
          skillsDirRel: '.cursor/skills',
          commandsDirRel: '.cursor/commands',
          mcpFacet: flakyCursorFacet(failing),
        }),
      ],
    );
  }

  /** A git workspace with one untracked retired skill copy owned by the manifest. */
  async function seedRetiredSkill(ws: string): Promise<ManagedEntries> {
    const dir = join(ws, ...RETIRED_SKILL.split('/'));
    writeSkillDir(dir, 'retired');
    const hash = await hashDir(dir);
    if (hash === null) throw new Error('fixture copy did not hash');
    return {
      [RETIRED_SKILL]: managedEntry(
        hash,
        join(retiredRoot, 'skills', 'retired-skill'),
        'skill',
      ),
    };
  }

  function newGitWorkspace(name: string): string {
    const ws = join(tempRoot, name);
    mkdirSync(ws, { recursive: true });
    git(ws, 'init', '-q');
    grantSkills(ws, 'all');
    return ws;
  }

  const manifestFile = (ws: string) =>
    join(ws, '.ptah', 'harness', 'cursor.manifest.json');
  const ownedKeys = (ws: string) =>
    Object.keys(store.load(ws, 'cursor').entries).sort();
  const mcpKeys = (ws: string) =>
    Object.keys(
      (
        JSON.parse(readFileSync(join(ws, MCP_CONFIG), 'utf-8')) as {
          mcpServers: object;
        }
      ).mcpServers,
    ).sort();
  const frag = (key: string) => `${MCP_CONFIG}#${key}`;

  it('passes the workspace root to both builder.build calls (verify and reconcile)', async () => {
    const ws = newGitWorkspace('ws');
    const builder = new HarnessManifestBuilder();
    const build = jest.spyOn(builder, 'build');
    const reconciler = newReconciler(sourceState(), builder);

    await reconciler.verify(ws);
    await reconciler.reconcile(ws, { mode: 'full', reason: 'test' });

    expect(build).toHaveBeenCalledTimes(2);
    for (const call of build.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ workspaceRoot: ws }));
    }
  });

  it("activates the workspace skills.sh exemption: this workspace's own root bypasses an empty selection, another workspace's does not", async () => {
    const ws = newGitWorkspace('ws');
    grantSkills(ws, 'selected', []);
    const localRoot = join(ws, '.ptah', 'plugins', 'ptah-skillssh-local');
    const otherRoot = join(
      tempRoot,
      'other-ws',
      '.ptah',
      'plugins',
      'ptah-skillssh-other',
    );
    writeSkillDir(join(localRoot, 'skills', 'local-skill'), 'local');
    writeSkillDir(join(otherRoot, 'skills', 'other-skill'), 'other');
    const reconciler = newReconciler(
      sourceState({ overlayPluginPaths: [localRoot, otherRoot] }),
    );

    const verified = cursorHealth(await reconciler.verify(ws));
    expect(verified.missing).toEqual(['.cursor/skills/local-skill']);

    const health = cursorHealth(
      await reconciler.reconcile(ws, { mode: 'full', reason: 'test' }),
    );
    expect(health.missing).toEqual([]);
    expect(health.found).toBe(1);
    expect(existsSync(join(ws, '.cursor', 'skills', 'local-skill'))).toBe(true);
    expect(existsSync(join(ws, '.cursor', 'skills', 'other-skill'))).toBe(
      false,
    );
  });

  it('mixed pass: one skill and one MCP key removed, one of each kept and disowned, one MCP key failed and kept owned; the retry removes it; a third pass is a no-op', async () => {
    const ws = newGitWorkspace('ws');
    const skillEntries = await seedRetiredSkill(ws);

    // A retired copy the user committed: provably tracked, so it must stay.
    const trackedDir = join(ws, ...TRACKED_SKILL.split('/'));
    writeSkillDir(trackedDir, 'tracked');
    git(ws, 'add', '--', TRACKED_SKILL);
    git(ws, 'commit', '-q', '-m', 'track one skill copy');
    const trackedHash = await hashDir(trackedDir);
    if (trackedHash === null) throw new Error('fixture copy did not hash');

    // One shared config file (untracked) holding three retired keys + one hand key.
    const facet = createMcpFacet('cursor');
    mkdirSync(join(ws, '.cursor'), { recursive: true });
    writeFileSync(
      join(ws, MCP_CONFIG),
      JSON.stringify({ mcpServers: RAW_SERVERS }, null, 2),
    );
    const mcpEntries: ManagedEntries = {};
    for (const key of RETIRED_KEYS) {
      const config = facet.readAll(ws).get(key) as McpServerConfig;
      mcpEntries[frag(key)] = managedEntry(
        hashMcpConfig(config),
        `registry/${key}`,
        'mcp',
      );
    }
    // The user edits one retired entry after Ptah wrote it.
    writeFileSync(
      join(ws, MCP_CONFIG),
      JSON.stringify(
        {
          mcpServers: {
            ...RAW_SERVERS,
            [KEY_EDITED]: { command: 'npx', args: ['edited', '--mine'] },
          },
        },
        null,
        2,
      ),
    );
    store.save(ws, 'cursor', {
      ...skillEntries,
      [TRACKED_SKILL]: managedEntry(
        trackedHash,
        join(retiredRoot, 'skills', 'tracked-skill'),
        'skill',
      ),
      ...mcpEntries,
    });

    const reconciler = newReconciler(sourceState());

    // Pass 1 — every outcome at once.
    failing.on = true;
    const first = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'pass-1',
    });
    const t1 = cursorHealth(first);
    expect(t1.removedRetired).toEqual([
      { relPath: RETIRED_SKILL, itemId: SKILL_ITEM },
      { relPath: frag(KEY_REMOVED), itemId: `mcp:${KEY_REMOVED}` },
    ]);
    expect(t1.removed.sort()).toEqual(
      [RETIRED_SKILL, frag(KEY_REMOVED)].sort(),
    );
    expect(t1.keptRetired).toEqual(
      expect.arrayContaining([
        { relPath: TRACKED_SKILL, itemId: SKILL_ITEM, reason: 'git-tracked' },
        {
          relPath: frag(KEY_EDITED),
          itemId: `mcp:${KEY_EDITED}`,
          reason: 'edited',
        },
      ]),
    );
    expect(t1.keptRetired).toHaveLength(2);
    expect(t1.writeFailed).toEqual([
      expect.objectContaining({
        relPath: frag(KEY_FAILING),
        itemId: `mcp:${KEY_FAILING}`,
      }),
    ]);
    // Ledger keys: one identity per path, under this workspace root.
    expect(
      (t1.removedRetired ?? []).map((row) =>
        harnessPathIdentity(first.workspaceRoot, row.relPath),
      ),
    ).toEqual([`${ws}/${RETIRED_SKILL}`, `${ws}/${frag(KEY_REMOVED)}`]);

    // Disk: deleted only what was proven; kept copies untouched.
    expect(existsSync(join(ws, ...RETIRED_SKILL.split('/')))).toBe(false);
    expect(existsSync(join(trackedDir, 'SKILL.md'))).toBe(true);
    expect(mcpKeys(ws)).toEqual([KEY_EDITED, KEY_FAILING, KEY_HAND].sort());
    // Manifest: removed and disowned entries gone, the failed one still owned.
    expect(ownedKeys(ws)).toEqual([frag(KEY_FAILING)]);

    // Pass 2 — the I/O error has cleared; only the failed key is retried.
    failing.on = false;
    const t2 = cursorHealth(
      await reconciler.reconcile(ws, { mode: 'full', reason: 'pass-2' }),
    );
    expect(t2.removedRetired).toEqual([
      { relPath: frag(KEY_FAILING), itemId: `mcp:${KEY_FAILING}` },
    ]);
    expect(t2.keptRetired).toEqual([]);
    expect(t2.writeFailed).toEqual([]);
    expect(mcpKeys(ws)).toEqual([KEY_EDITED, KEY_HAND].sort());
    expect(ownedKeys(ws)).toEqual([]);

    // Pass 3 — nothing owned is retired any more: no outcome, no manifest write.
    const manifestBefore = readFileSync(manifestFile(ws), 'utf-8');
    const t3 = cursorHealth(
      await reconciler.reconcile(ws, { mode: 'full', reason: 'pass-3' }),
    );
    expect(t3.removed).toEqual([]);
    expect(t3.removedRetired).toEqual([]);
    expect(t3.keptRetired).toEqual([]);
    expect(t3.writeFailed).toEqual([]);
    expect(readFileSync(manifestFile(ws), 'utf-8')).toBe(manifestBefore);
    expect(existsSync(join(trackedDir, 'SKILL.md'))).toBe(true);
    expect(mcpKeys(ws)).toEqual([KEY_EDITED, KEY_HAND].sort());
  });

  it('late-discovered workspace: a workspace first reconciled after the retirement gets its own copies proven and removed, under its own identity', async () => {
    const wsA = newGitWorkspace('ws-a');
    const wsB = newGitWorkspace('ws-b');
    store.save(wsA, 'cursor', await seedRetiredSkill(wsA));
    store.save(wsB, 'cursor', await seedRetiredSkill(wsB));
    const reconciler = newReconciler(sourceState());

    const healthA = await reconciler.reconcile(wsA, {
      mode: 'full',
      reason: 'open-a',
    });
    expect(cursorHealth(healthA).removedRetired).toEqual([
      { relPath: RETIRED_SKILL, itemId: SKILL_ITEM },
    ]);
    // Workspace B has not been opened yet: nothing of it was touched.
    expect(existsSync(join(wsB, ...RETIRED_SKILL.split('/')))).toBe(true);
    expect(ownedKeys(wsB)).toEqual([RETIRED_SKILL]);

    const healthB = await reconciler.reconcile(wsB, {
      mode: 'full',
      reason: 'open-b-later',
    });
    const tB = cursorHealth(healthB);
    expect(tB.removedRetired).toEqual([
      { relPath: RETIRED_SKILL, itemId: SKILL_ITEM },
    ]);
    expect(existsSync(join(wsB, ...RETIRED_SKILL.split('/')))).toBe(false);
    expect(ownedKeys(wsB)).toEqual([]);

    // Same item, same relPath, two distinct ledger paths.
    const identities = [healthA, healthB].map((health) =>
      harnessPathIdentity(health.workspaceRoot, RETIRED_SKILL),
    );
    expect(identities).toEqual([
      `${wsA}/${RETIRED_SKILL}`,
      `${wsB}/${RETIRED_SKILL}`,
    ]);
  });

  it('without a retired registry an orphaned copy is an ordinary removal with no retirement outcome', async () => {
    const ws = newGitWorkspace('ws');
    store.save(ws, 'cursor', await seedRetiredSkill(ws));
    const reconciler = newReconciler(sourceState({ retired: undefined }));

    const t = cursorHealth(
      await reconciler.reconcile(ws, { mode: 'full', reason: 'test' }),
    );
    expect(t.removed).toEqual([RETIRED_SKILL]);
    expect(t.removedRetired).toEqual([]);
    expect(t.keptRetired).toEqual([]);
  });
});
