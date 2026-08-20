import 'reflect-metadata';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

let fakeHome: string;

/**
 * `homedir()` is redirected into the per-test temp root so nothing in this file
 * can resolve a path against the developer's real `~/.ptah/user`. The service
 * writes to `~/.ptah/user/**` unconditionally, so an unmocked homedir would not
 * fail the run — it would quietly edit the developer's own clones. That accident
 * has happened once in this repo already; see harness-sync's CLAUDE.md, "Never
 * let a spec touch the real home directory".
 *
 * Mocking the bare `'os'` specifier is sufficient: Jest resolves `'node:os'` to
 * the same core module, so a `node:`-prefixed import in the code under test is
 * covered by this one mock (verified, not assumed).
 */
jest.mock('os', () => ({
  ...jest.requireActual<typeof import('os')>('os'),
  homedir: () => fakeHome,
}));

/**
 * Windows can transiently fail a recursive delete with EBUSY/EPERM while an
 * indexer or a sibling worker still holds a handle, and `force` only suppresses
 * ENOENT. Retry those, then give up quietly: a leaked temp dir is the OS's
 * problem, whereas a throwing `afterEach` fails a test that already passed.
 */
async function removeTempRoot(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Best effort — cleanup must never decide the outcome of a test.
  }
}

import { UserLayerMirrorService } from './user-layer-mirror.service';
import {
  DEFAULT_HISTORY_DIR,
  ORIGIN_SIDECAR_FILENAME,
} from './origin-sidecar.types';
import type { OriginSidecar } from './origin-sidecar.types';

/**
 * TASK_2026_278 batch 1b — edge case E7, the halves that had no coverage.
 *
 * `rebaseClone`/`keepClone` were only ever exercised against PLUGIN upstreams.
 * The two origins that had no test are exactly the two the RPC layer could not
 * resolve an upstream for, so nothing failed and the gap read as "unsupported":
 *
 *   - a SYNTH skill, upstream `<skillsRoot>/<slug>/`
 *   - an AGENT clone, upstream `{ws}/.claude/agents/<slug>.md`
 *
 * These drive the full cycle — mirror, edit, upstream moves, reconcile flags
 * divergence, then rebase or keep — so the engine and the resolution are pinned
 * on both sides of the RPC boundary.
 */

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

describe('rebase / keep across every clone origin (E7)', () => {
  let workRoot: string;
  let synthRoot: string;
  let agentSourceDir: string;
  let service: UserLayerMirrorService;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'ptah-rebase-origins-'));
    fakeHome = join(workRoot, 'home');
    synthRoot = join(fakeHome, '.ptah', 'skills');
    agentSourceDir = join(workRoot, 'workspace', '.claude', 'agents');
    await mkdir(fakeHome, { recursive: true });
    service = new UserLayerMirrorService(makeLogger() as never);
  });

  afterEach(async () => {
    await removeTempRoot(workRoot);
  });

  async function readSidecarDir(dir: string): Promise<OriginSidecar> {
    return JSON.parse(
      await readFile(join(dir, ORIGIN_SIDECAR_FILENAME), 'utf8'),
    ) as OriginSidecar;
  }

  async function readSidecarFile(path: string): Promise<OriginSidecar> {
    return JSON.parse(await readFile(path, 'utf8')) as OriginSidecar;
  }

  it('a diverged SYNTH skill rebases from <skillsRoot>/<slug>', async () => {
    const upstream = join(synthRoot, 'promoted-thing');
    await mkdir(upstream, { recursive: true });
    await writeFile(join(upstream, 'SKILL.md'), '# synth v1', 'utf8');

    await service.mirrorAll({
      pluginPaths: [],
      synthesizedSkillsRoot: synthRoot,
    });

    const roots = service.getUserLayerRoots();
    const cloneDir = join(roots.skills, 'promoted-thing');
    // Sidecar proves the origin: a synth clone carries no plugin id, which is
    // exactly the shape the upstream resolver used to give up on.
    expect((await readSidecarDir(cloneDir)).pluginId).toBeNull();

    await writeFile(join(cloneDir, 'SKILL.md'), '# my edit', 'utf8');
    await writeFile(join(upstream, 'SKILL.md'), '# synth v2', 'utf8');

    const reconciled = await service.reconcileAll({
      pluginPaths: [],
      synthesizedSkillsRoot: synthRoot,
    });
    expect(reconciled.diverged).toBe(1);
    expect(reconciled.reaped).toBe(0);

    const result = await service.rebaseClone({
      kind: 'skill',
      slug: 'promoted-thing',
      sourceDir: upstream,
    });

    expect(result.failed).toBeUndefined();
    expect(await readFile(join(cloneDir, 'SKILL.md'), 'utf8')).toBe(
      '# synth v2',
    );
    const sidecar = await readSidecarDir(cloneDir);
    expect(sidecar.diverged).toBe(false);
    expect(sidecar.pendingSourceHash).toBeUndefined();

    // The user's edit is recoverable, not gone.
    const snaps = await readdir(join(cloneDir, DEFAULT_HISTORY_DIR));
    expect(
      await readFile(
        join(cloneDir, DEFAULT_HISTORY_DIR, snaps[0], 'SKILL.md'),
        'utf8',
      ),
    ).toBe('# my edit');
  });

  it('a diverged SYNTH skill can instead keep the local body and adopt the new baseline', async () => {
    const upstream = join(synthRoot, 'promoted-thing');
    await mkdir(upstream, { recursive: true });
    await writeFile(join(upstream, 'SKILL.md'), '# synth v1', 'utf8');
    await service.mirrorAll({
      pluginPaths: [],
      synthesizedSkillsRoot: synthRoot,
    });

    const roots = service.getUserLayerRoots();
    const cloneDir = join(roots.skills, 'promoted-thing');
    await writeFile(join(cloneDir, 'SKILL.md'), '# my edit', 'utf8');
    await writeFile(join(upstream, 'SKILL.md'), '# synth v2', 'utf8');
    const reconciled = await service.reconcileAll({
      pluginPaths: [],
      synthesizedSkillsRoot: synthRoot,
    });
    const pending = reconciled.divergedSlugs[0].pendingSourceHash;

    const result = await service.keepClone({
      kind: 'skill',
      slug: 'promoted-thing',
    });

    expect(result.sourceHash).toBe(pending);
    expect(await readFile(join(cloneDir, 'SKILL.md'), 'utf8')).toBe(
      '# my edit',
    );
    const sidecar = await readSidecarDir(cloneDir);
    expect(sidecar.diverged).toBe(false);

    // The whole point of adopting the baseline: the next reconcile is a no-op,
    // not a re-flagged divergence.
    const again = await service.reconcileAll({
      pluginPaths: [],
      synthesizedSkillsRoot: synthRoot,
    });
    expect(again.diverged).toBe(0);
    expect(again.noop).toBe(1);
  });

  it('a diverged AGENT clone rebases from {ws}/.claude/agents/<slug>.md', async () => {
    await mkdir(agentSourceDir, { recursive: true });
    const upstreamFile = join(agentSourceDir, 'backend-developer.md');
    await writeFile(upstreamFile, '# agent v1', 'utf8');

    await service.mirrorAll({
      pluginPaths: [],
      synthesizedSkillsRoot: synthRoot,
      agentSourceDir,
    });

    const roots = service.getUserLayerRoots();
    const cloneFile = join(roots.agents, 'backend-developer.md');
    await writeFile(cloneFile, '# my agent edit', 'utf8');
    await writeFile(upstreamFile, '# agent v2', 'utf8');

    const reconciled = await service.reconcileAll({
      pluginPaths: [],
      synthesizedSkillsRoot: synthRoot,
      agentSourceDir,
    });
    expect(reconciled.divergedSlugs).toEqual([
      {
        kind: 'agent',
        slug: 'backend-developer',
        pendingSourceHash: expect.stringMatching(/^sha256:/),
      },
    ]);

    const result = await service.rebaseClone({
      kind: 'agent',
      slug: 'backend-developer',
      sourceDir: upstreamFile,
    });

    expect(result.failed).toBeUndefined();
    expect(await readFile(cloneFile, 'utf8')).toBe('# agent v2');
    const sidecar = await readSidecarFile(
      join(roots.agents, 'backend-developer.ptah-origin.json'),
    );
    expect(sidecar.diverged).toBe(false);
    expect(sidecar.pendingSourceHash).toBeUndefined();

    const snaps = await readdir(
      join(roots.agents, DEFAULT_HISTORY_DIR, 'backend-developer'),
    );
    expect(
      await readFile(
        join(
          roots.agents,
          DEFAULT_HISTORY_DIR,
          'backend-developer',
          snaps[0],
          'backend-developer.md',
        ),
        'utf8',
      ),
    ).toBe('# my agent edit');
  });

  it('reconcileAll flags divergence on every activation, with or without a download', async () => {
    const upstream = join(synthRoot, 'promoted-thing');
    await mkdir(upstream, { recursive: true });
    await writeFile(join(upstream, 'SKILL.md'), '# synth v1', 'utf8');
    await service.mirrorAll({
      pluginPaths: [],
      synthesizedSkillsRoot: synthRoot,
    });

    // No download, no source change — just a user hand-edit between two
    // activations. `reconcile` used to run only when a download happened, so
    // this was invisible until one did.
    const roots = service.getUserLayerRoots();
    await writeFile(
      join(roots.skills, 'promoted-thing', 'SKILL.md'),
      '# my edit',
      'utf8',
    );
    await writeFile(join(upstream, 'SKILL.md'), '# synth v2', 'utf8');

    const result = await service.reconcileAll({
      pluginPaths: [],
      synthesizedSkillsRoot: synthRoot,
    });

    expect(result.diverged).toBe(1);
    expect(result.errors).toBe(0);
  });
});
