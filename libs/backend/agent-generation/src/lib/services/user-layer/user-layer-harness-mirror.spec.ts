import 'reflect-metadata';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'fs/promises';
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
import { ORIGIN_SIDECAR_FILENAME } from './origin-sidecar.types';
import type { OriginSidecar } from './origin-sidecar.types';

/**
 * TASK_2026_278 batch 1b — edge case E15, SOURCE half.
 *
 * `~/.ptah/plugins/ptah-harness-*` dirs are produced by the harness builder,
 * not by `resolvePluginPaths(enabledIds)`. They were therefore present in every
 * junction call and absent from every mirror call: junctioned into `.claude/`
 * but never cloned, so no sidecar, no divergence tracking, and nothing for the
 * rival-CLI sync to copy (defect 6).
 *
 * The fix is deliberately NOT "discover `ptah-harness-*` inside the mirror" —
 * that would put plugin discovery in two places. The caller passes the roots on
 * `harnessPluginRoots`, and from there they are treated exactly like a bundled
 * plugin. These tests assert the "exactly like" half.
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

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe('user layer — harness-builder plugins (E15 source half)', () => {
  let workRoot: string;
  let pluginsBase: string;
  let synthRoot: string;
  let service: UserLayerMirrorService;
  let logger: MockLogger;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'ptah-harness-mirror-'));
    fakeHome = join(workRoot, 'home');
    pluginsBase = join(fakeHome, 'plugins-base');
    synthRoot = join(fakeHome, '.ptah', 'skills');
    await mkdir(fakeHome, { recursive: true });
    logger = makeLogger();
    service = new UserLayerMirrorService(logger as never);
  });

  afterEach(async () => {
    await removeTempRoot(workRoot);
  });

  async function seedHarnessPlugin(
    slug: string,
    body: string,
  ): Promise<string> {
    const pluginDir = join(pluginsBase, `ptah-harness-${slug}`);
    const skillDir = join(pluginDir, 'skills', slug);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), body, 'utf8');
    return pluginDir;
  }

  async function readSidecar(dir: string): Promise<OriginSidecar> {
    return JSON.parse(
      await readFile(join(dir, ORIGIN_SIDECAR_FILENAME), 'utf8'),
    ) as OriginSidecar;
  }

  it('mirrors a harness plugin skill into the user layer with a ptah-harness-* sidecar', async () => {
    const pluginDir = await seedHarnessPlugin('deploy-check', '# harness v1');

    const result = await service.mirrorAll({
      pluginPaths: [],
      harnessPluginRoots: [pluginDir],
      synthesizedSkillsRoot: synthRoot,
    });

    expect(result.skillsMirrored).toBe(1);
    const roots = service.getUserLayerRoots();
    const cloneDir = join(roots.skills, 'deploy-check');
    expect(await readFile(join(cloneDir, 'SKILL.md'), 'utf8')).toBe(
      '# harness v1',
    );

    const sidecar = await readSidecar(cloneDir);
    expect(sidecar).toMatchObject({
      kind: 'skill',
      slug: 'deploy-check',
      pluginId: 'ptah-harness-deploy-check',
      diverged: false,
    });
    expect(sidecar.sourceHash).toMatch(/^sha256:/);
  });

  it('mirrors harness commands too, on the same code path as a bundled plugin', async () => {
    const pluginDir = join(pluginsBase, 'ptah-harness-deploy');
    await mkdir(join(pluginDir, 'commands'), { recursive: true });
    await writeFile(
      join(pluginDir, 'commands', 'deploy.md'),
      '# deploy v1',
      'utf8',
    );

    const result = await service.mirrorAll({
      pluginPaths: [],
      harnessPluginRoots: [pluginDir],
      synthesizedSkillsRoot: synthRoot,
    });

    expect(result.commandsMirrored).toBe(1);
    const roots = service.getUserLayerRoots();
    expect(await readFile(join(roots.commands, 'deploy.md'), 'utf8')).toBe(
      '# deploy v1',
    );
    const sidecar = JSON.parse(
      await readFile(join(roots.commands, 'deploy.ptah-origin.json'), 'utf8'),
    ) as OriginSidecar;
    expect(sidecar.pluginId).toBe('ptah-harness-deploy');
  });

  it('works with no synth root named at all (the harness builder names only its own plugin)', async () => {
    const pluginDir = await seedHarnessPlugin('quick', '# quick v1');

    const result = await service.mirrorAll({
      pluginPaths: [],
      harnessPluginRoots: [pluginDir],
    });

    expect(result.skillsMirrored).toBe(1);
    expect(result.errors).toBe(0);
    const roots = service.getUserLayerRoots();
    expect(await exists(join(roots.skills, 'quick'))).toBe(true);
  });

  it('fast-forwards a harness skill the builder rewrote (re-apply of the same skill)', async () => {
    const pluginDir = await seedHarnessPlugin('deploy-check', '# harness v1');
    await service.mirrorAll({
      pluginPaths: [],
      harnessPluginRoots: [pluginDir],
      synthesizedSkillsRoot: synthRoot,
    });

    await writeFile(
      join(pluginDir, 'skills', 'deploy-check', 'SKILL.md'),
      '# harness v2',
      'utf8',
    );

    const result = await service.reconcileAll({
      pluginPaths: [],
      harnessPluginRoots: [pluginDir],
      synthesizedSkillsRoot: synthRoot,
    });

    expect(result.fastForwarded).toBe(1);
    expect(result.diverged).toBe(0);
    const roots = service.getUserLayerRoots();
    expect(
      await readFile(join(roots.skills, 'deploy-check', 'SKILL.md'), 'utf8'),
    ).toBe('# harness v2');
  });

  it('reaps the clone when the user deletes the harness plugin from disk', async () => {
    const pluginDir = await seedHarnessPlugin('deploy-check', '# harness v1');
    await service.mirrorAll({
      pluginPaths: [],
      harnessPluginRoots: [pluginDir],
      synthesizedSkillsRoot: synthRoot,
    });

    await rm(pluginDir, { recursive: true, force: true });

    const result = await service.reconcileAll({
      pluginPaths: [],
      harnessPluginRoots: [],
      synthesizedSkillsRoot: synthRoot,
      pluginsBasePath: pluginsBase,
    });

    expect(result.reaped).toBe(1);
    const roots = service.getUserLayerRoots();
    expect(await exists(join(roots.skills, 'deploy-check'))).toBe(false);
  });
});
