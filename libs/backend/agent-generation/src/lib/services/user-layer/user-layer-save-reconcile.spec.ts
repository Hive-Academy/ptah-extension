import 'reflect-metadata';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * R3.8 — THE REGRESSION THIS FILE EXISTS FOR.
 *
 * The defect this task was raised for is a reconciler silently reverting a
 * user's edit at every application start. `saveCloneBody` may therefore write
 * `currentContentHash` and nothing else: writing `sourceHash` would make
 * `liveCloneHash === sidecar.sourceHash` true on the next pass, arm the
 * fast-forward branch (`user-layer-mirror.service.ts:1260` for a directory
 * clone / `:1321` for a flat file) and overwrite the body that was just saved.
 *
 * Every `*-survives-a-moved-upstream` case below is that proof: save, MOVE the
 * upstream, reconcile, and read the body back off disk.
 *
 * ⚠️ THE BOUNDARY — R3.8 IS CONDITIONAL ON A SIDECAR EXISTING. The two
 * `sidecar-less` cases at the end are NOT a green tick for R3.8; they pin the
 * OPPOSITE outcome, measured rather than assumed. `reconcileMissingSidecar`
 * (`:1598`) / `reconcileMissingFileSidecar` (`:1869`) mint a sidecar whose
 * `sourceHash` is the hash of the clone's own CURRENT content — the user's
 * saved body — so the pass AFTER the mint sees an unmodified clone and
 * fast-forwards over it. That is a pre-existing reconciler rule, out of scope
 * for TASK_2026_426, and it is pinned here so nobody reads this suite as proof
 * that editing a sidecar-less clone is safe.
 */

let fakeHome: string;

/**
 * `homedir()` is redirected into the per-test temp root so nothing in this file
 * can resolve a path against the developer's real `~/.ptah/user`. The service
 * writes to `~/.ptah/user/**` unconditionally, so an unmocked homedir would not
 * fail the run — it would quietly edit the developer's own clones.
 */
jest.mock('os', () => ({
  ...jest.requireActual<typeof import('os')>('os'),
  homedir: () => fakeHome,
}));

/**
 * These cases drive a real temporary filesystem. Jest's 5000 ms default is
 * already marginal for the sibling `user-layer-*` suites on this project under
 * load, and a save-then-reconcile case does strictly more IO than a plain
 * reconcile case. An explicit budget is set here rather than inherited so a
 * loaded machine reports a real failure instead of a timeout.
 */
jest.setTimeout(30_000);

/**
 * Windows can transiently fail a recursive delete with EBUSY/EPERM while an
 * indexer still holds a handle, and `force` only suppresses ENOENT. Retry,
 * then give up quietly: a throwing `afterEach` fails a test that already
 * passed.
 */
async function removeTempRoot(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Best effort — cleanup must never decide the outcome of a test.
  }
}

import { UserLayerMirrorService } from './user-layer-mirror.service';
import { ORIGIN_SIDECAR_FILENAME } from './origin-sidecar.types';
import type { OriginSidecar } from './origin-sidecar.types';
import { computeSourceHash } from './source-hash';

/** Mirrors the private constant at `user-layer-mirror.service.ts:35`. */
const ORIGIN_SIDECAR_SUFFIX = '.ptah-origin.json';

interface MockLogger {
  info: jest.Mock;
  warn: jest.Mock;
  debug: jest.Mock;
  error: jest.Mock;
}

function makeLogger(): MockLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readSidecarJson(path: string): Promise<OriginSidecar> {
  return JSON.parse(await readFile(path, 'utf8')) as OriginSidecar;
}

/**
 * The four fields a save may never touch, as one comparable value.
 *
 * Compared as a JSON string rather than field by field so a future field
 * rename cannot make the assertion silently compare `undefined` to
 * `undefined`.
 */
function frozenFields(sidecar: OriginSidecar): string {
  return JSON.stringify({
    sourceHash: sidecar.sourceHash,
    diverged: sidecar.diverged,
    pendingSourceHash: sidecar.pendingSourceHash,
    lastEnhancedAt: sidecar.lastEnhancedAt,
  });
}

describe('saveCloneBody + reconcile (R3.8)', () => {
  let workRoot: string;
  let pluginRoot: string;
  let synthRoot: string;
  let agentSourceDir: string;
  let service: UserLayerMirrorService;
  let logger: MockLogger;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'ptah-save-recon-'));
    fakeHome = join(workRoot, 'home');
    pluginRoot = join(workRoot, 'plugins');
    synthRoot = join(fakeHome, '.ptah', 'skills');
    agentSourceDir = join(workRoot, 'ws', '.claude', 'agents');
    await mkdir(fakeHome, { recursive: true });
    logger = makeLogger();
    service = new UserLayerMirrorService(logger as never);
  });

  afterEach(async () => {
    await removeTempRoot(workRoot);
  });

  // ── fixture helpers ──────────────────────────────────────────────────────

  /** A one-file plugin skill at `<plugins>/<id>/skills/<slug>/SKILL.md`. */
  async function seedSkill(slug: string, body: string): Promise<string> {
    const pluginPath = join(pluginRoot, 'p');
    await mkdir(join(pluginPath, 'skills', slug), { recursive: true });
    await writeFile(join(pluginPath, 'skills', slug, 'SKILL.md'), body, 'utf8');
    await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });
    return pluginPath;
  }

  /** A one-file plugin command at `<plugins>/<id>/commands/<slug>.md`. */
  async function seedCommand(slug: string, body: string): Promise<string> {
    const pluginPath = join(pluginRoot, 'p');
    await mkdir(join(pluginPath, 'commands'), { recursive: true });
    await writeFile(join(pluginPath, 'commands', `${slug}.md`), body, 'utf8');
    await service.mirrorAll({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });
    return pluginPath;
  }

  /** A generated agent at `<ws>/.claude/agents/<slug>.md`. */
  async function seedAgent(slug: string, body: string): Promise<void> {
    await mkdir(agentSourceDir, { recursive: true });
    await writeFile(join(agentSourceDir, `${slug}.md`), body, 'utf8');
    await service.mirrorAll({ pluginPaths: [], agentSourceDir });
  }

  /**
   * Move the upstream, and PROVE it moved.
   *
   * A save-then-reconcile test passes trivially if the upstream hash is
   * unchanged — `reconcile` would take the `noop` branch and never reach the
   * fast-forward decision at all. Every case calls this and asserts the
   * returned flag, so a fixture that fails to move the source fails the test
   * instead of passing it.
   */
  async function moveUpstream(
    path: string,
    newBody: string,
    recordedSourceHash: string,
  ): Promise<boolean> {
    await writeFile(path, newBody, 'utf8');
    const liveSourceHash = await computeSourceHash(
      path.endsWith('SKILL.md') ? join(path, '..') : path,
    );
    return liveSourceHash !== recordedSourceHash;
  }

  // ── skill: the directory clone shape ─────────────────────────────────────

  it('skill: a saved body survives a moved upstream and the clone is marked diverged, not fast-forwarded', async () => {
    const pluginPath = await seedSkill('dr', '# v1');
    const roots = service.getUserLayerRoots();
    const cloneDir = join(roots.skills, 'dr');
    const cloneFile = join(cloneDir, 'SKILL.md');
    const sidecarPath = join(cloneDir, ORIGIN_SIDECAR_FILENAME);

    const saved = await service.saveCloneBody({
      kind: 'skill',
      slug: 'dr',
      body: '# saved in the app',
    });
    expect(saved.written).toBe(true);
    expect(saved.historyTs).not.toBeNull();

    const afterSave = await readSidecarJson(sidecarPath);
    const upstreamReallyMoved = await moveUpstream(
      join(pluginPath, 'skills', 'dr', 'SKILL.md'),
      '# v2 upstream',
      afterSave.sourceHash,
    );
    expect(upstreamReallyMoved).toBe(true);

    const res = await service.reconcile({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });

    // The whole point: the reconciler did NOT take the fast-forward branch.
    expect(res.fastForwarded).toBe(0);
    expect(res.noop).toBe(0);
    expect(res.diverged).toBe(1);
    expect(await readFile(cloneFile, 'utf8')).toBe('# saved in the app');

    const afterReconcile = await readSidecarJson(sidecarPath);
    expect(afterReconcile.diverged).toBe(true);
    expect(afterReconcile.pendingSourceHash).toMatch(/^sha256:/);

    // The save's snapshot is still readable through the drawer's own reader.
    const history = await service.listHistory('skill', 'dr');
    expect(history.map((h) => h.ts)).toContain(saved.historyTs);
    expect(history.find((h) => h.ts === saved.historyTs)?.hasSkillMd).toBe(
      true,
    );
  });

  it('skill: the save writes currentContentHash and leaves the four fast-forward fields byte-identical', async () => {
    await seedSkill('dr', '# v1');
    const cloneDir = join(service.getUserLayerRoots().skills, 'dr');
    const sidecarPath = join(cloneDir, ORIGIN_SIDECAR_FILENAME);

    const before = await readSidecarJson(sidecarPath);
    await service.saveCloneBody({
      kind: 'skill',
      slug: 'dr',
      body: '# saved in the app',
    });
    const after = await readSidecarJson(sidecarPath);

    // Writing any of these four arms the fast-forward branch at :1260 / :1321.
    expect(frozenFields(after)).toBe(frozenFields(before));
    expect(after.currentContentHash).not.toBe(before.currentContentHash);
    expect(after.currentContentHash).toBe(await computeSourceHash(cloneDir));
  });

  // ── command and agent: the flat-file clone shape ─────────────────────────

  it('command: a saved body survives a moved upstream and the clone is marked diverged', async () => {
    const pluginPath = await seedCommand('review', '# review v1');
    const roots = service.getUserLayerRoots();
    const cloneFile = join(roots.commands, 'review.md');
    const sidecarPath = join(
      roots.commands,
      `review${ORIGIN_SIDECAR_SUFFIX}`,
    );

    const saved = await service.saveCloneBody({
      kind: 'command',
      slug: 'review',
      body: '# saved in the app',
    });
    expect(saved.written).toBe(true);

    const afterSave = await readSidecarJson(sidecarPath);
    expect(
      await moveUpstream(
        join(pluginPath, 'commands', 'review.md'),
        '# review v2',
        afterSave.sourceHash,
      ),
    ).toBe(true);

    const res = await service.reconcile({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });

    expect(res.fastForwarded).toBe(0);
    expect(res.diverged).toBe(1);
    expect(await readFile(cloneFile, 'utf8')).toBe('# saved in the app');

    const afterReconcile = await readSidecarJson(sidecarPath);
    expect(afterReconcile.diverged).toBe(true);
    expect(afterReconcile.pendingSourceHash).toMatch(/^sha256:/);

    // The flat-file snapshot layout is `<root>/.history/<slug>/<ts>/` — a
    // different shape from the skill's, and `listHistory` must read both.
    const history = await service.listHistory('command', 'review');
    expect(history.map((h) => h.ts)).toContain(saved.historyTs);
    expect(history.find((h) => h.ts === saved.historyTs)?.hasSkillMd).toBe(
      true,
    );
  });

  it('agent: a saved body survives a moved upstream, and the flat sidecar keeps its four fields', async () => {
    await seedAgent('planner', '# planner v1');
    const roots = service.getUserLayerRoots();
    const cloneFile = join(roots.agents, 'planner.md');
    const sidecarPath = join(roots.agents, `planner${ORIGIN_SIDECAR_SUFFIX}`);

    const before = await readSidecarJson(sidecarPath);
    const saved = await service.saveCloneBody({
      kind: 'agent',
      slug: 'planner',
      body: '# saved in the app',
    });
    expect(saved.written).toBe(true);

    const afterSave = await readSidecarJson(sidecarPath);
    expect(frozenFields(afterSave)).toBe(frozenFields(before));
    expect(afterSave.currentContentHash).not.toBe(before.currentContentHash);

    expect(
      await moveUpstream(
        join(agentSourceDir, 'planner.md'),
        '# planner v2',
        afterSave.sourceHash,
      ),
    ).toBe(true);

    const res = await service.reconcile({ pluginPaths: [], agentSourceDir });

    expect(res.fastForwarded).toBe(0);
    expect(res.diverged).toBe(1);
    expect(await readFile(cloneFile, 'utf8')).toBe('# saved in the app');
    expect((await readSidecarJson(sidecarPath)).diverged).toBe(true);

    const history = await service.listHistory('agent', 'planner');
    expect(history.map((h) => h.ts)).toContain(saved.historyTs);
  });

  it('a missing clone is not created by a save, so no reconcile can resurrect it', async () => {
    const roots = service.getUserLayerRoots();

    const res = await service.saveCloneBody({
      kind: 'skill',
      slug: 'never-cloned',
      body: '# nope',
    });

    expect(res).toEqual({
      kind: 'skill',
      slug: 'never-cloned',
      historyTs: null,
      written: false,
      reason: 'clone-missing',
    });
    expect(await fileExists(join(roots.skills, 'never-cloned'))).toBe(false);
  });

  // ── the boundary: R3.8 does NOT hold for a sidecar-less clone ────────────

  it('KNOWN LIMITATION — skill with NO sidecar: the mint on pass 1 makes pass 2 fast-forward OVER the saved body', async () => {
    const pluginPath = await seedSkill('dr', '# v1');
    const roots = service.getUserLayerRoots();
    const cloneDir = join(roots.skills, 'dr');
    const cloneFile = join(cloneDir, 'SKILL.md');
    const sidecarPath = join(cloneDir, ORIGIN_SIDECAR_FILENAME);

    // "No sidecar" is the marker for user-authored, hands-off content.
    await rm(sidecarPath, { force: true });

    const saved = await service.saveCloneBody({
      kind: 'skill',
      slug: 'dr',
      body: '# saved in the app',
    });
    expect(saved.written).toBe(true);
    // The save does not mint one — that part of the contract holds.
    expect(await fileExists(sidecarPath)).toBe(false);

    await writeFile(
      join(pluginPath, 'skills', 'dr', 'SKILL.md'),
      '# v2 upstream',
      'utf8',
    );

    // Pass 1: `reconcileMissingSidecar` mints a sidecar whose `sourceHash` is
    // the hash of the USER'S OWN saved body. The body survives this pass.
    const pass1 = await service.reconcile({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });
    expect(pass1.missingSidecar).toBe(1);
    expect(pass1.fastForwarded).toBe(0);
    expect(await readFile(cloneFile, 'utf8')).toBe('# saved in the app');

    const minted = await readSidecarJson(sidecarPath);
    expect(minted.sourceHash).toBe(await computeSourceHash(cloneDir));

    // Pass 2: `liveCloneHash === sidecar.sourceHash`, so the clone reads as
    // unmodified and the fast-forward branch replaces it. THE EDIT IS LOST.
    const pass2 = await service.reconcile({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });
    expect(pass2.fastForwarded).toBe(1);
    expect(pass2.diverged).toBe(0);
    expect(await readFile(cloneFile, 'utf8')).toBe('# v2 upstream');
  });

  it('KNOWN LIMITATION — command with NO sidecar: the flat-file mint path loses the saved body on pass 2 too', async () => {
    const pluginPath = await seedCommand('review', '# review v1');
    const roots = service.getUserLayerRoots();
    const cloneFile = join(roots.commands, 'review.md');
    const sidecarPath = join(
      roots.commands,
      `review${ORIGIN_SIDECAR_SUFFIX}`,
    );

    await rm(sidecarPath, { force: true });

    await service.saveCloneBody({
      kind: 'command',
      slug: 'review',
      body: '# saved in the app',
    });
    expect(await fileExists(sidecarPath)).toBe(false);

    await writeFile(
      join(pluginPath, 'commands', 'review.md'),
      '# review v2',
      'utf8',
    );

    const pass1 = await service.reconcile({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });
    expect(pass1.missingSidecar).toBe(1);
    expect(await readFile(cloneFile, 'utf8')).toBe('# saved in the app');
    expect((await readSidecarJson(sidecarPath)).sourceHash).toBe(
      await computeSourceHash(cloneFile),
    );

    const pass2 = await service.reconcile({
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
    });
    expect(pass2.fastForwarded).toBe(1);
    expect(await readFile(cloneFile, 'utf8')).toBe('# review v2');
  });
});
