/**
 * Whose symlink is it (TASK_2026_278 review finding 2)?
 *
 * `ClaudeTarget` has to unlink a leftover `SkillJunctionService` junction before
 * it can write a copy at the same path — otherwise the copy lands INSIDE the
 * source directory the junction points at. The original rule was "unlink any
 * symlink at a desired path", which is the same sentence as "delete whatever the
 * user linked there", and a user who symlinks
 * `{ws}/.claude/skills/orchestration` at their own checkout of a skill they are
 * authoring lost it on the next activation.
 *
 * The rule is now about the TARGET, not the shape: a link is Ptah's only when it
 * resolves inside a declared source root (`HarnessDesiredState.sourceRoots`,
 * fed by the user layer, the plugin overlay and `layout.legacyLinkRoots`).
 *
 * Windows note: `symlinkSync` with type `'junction'` needs no privilege, which
 * is exactly why `SkillJunctionService` used it. `'dir'` symlinks require
 * Developer Mode or elevation, so these tests use junctions on win32 and dir
 * symlinks elsewhere, and skip themselves if the platform refuses both.
 *
 * Source-under-test: `ClaudeTarget.planEntry` / `scanTargetDirs`,
 * `link-ownership.ts`.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { HarnessReconcilerService } from '../reconciler/harness-reconciler.service';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import type { HarnessSourceState } from '../sources/harness-source.port';
import { createClaudeTarget } from './claude-target';

function makeFakeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

/** Directory link, by whichever mechanism this platform allows unprivileged. */
function linkDir(target: string, path: string): boolean {
  try {
    symlinkSync(
      target,
      path,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function writeSkill(root: string, slug: string, body: string): string {
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${slug}\ndescription: d\n---\n${body}\n`,
    'utf-8',
  );
  return dir;
}

describe("ClaudeTarget — only Ptah's own symlinks are migrated", () => {
  let ws: string;
  let sourcesRoot: string;
  let skillsRoot: string;
  let elsewhere: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-sync-link-ws-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-sync-link-src-'));
    elsewhere = mkdtempSync(join(tmpdir(), 'harness-sync-link-mine-'));
    skillsRoot = join(sourcesRoot, 'skills');
    writeSkill(skillsRoot, 'orchestration', 'the user-layer body');
  });

  afterEach(() => {
    for (const dir of [ws, sourcesRoot, elsewhere]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function reconciler(): HarnessReconcilerService {
    const logger = makeFakeLogger();
    const store = new ManagedManifestStore((message, detail) =>
      logger.warn(message, detail),
    );
    const state: HarnessSourceState = {
      layout: {
        skillsRoot,
        commandsRoot: join(sourcesRoot, 'commands'),
        agentsRoot: join(sourcesRoot, 'agents'),
        // Stands in for `~/.ptah/plugins` and `~/.ptah/skills`: the roots a
        // legacy junction could point into that are not the user layer.
        legacyLinkRoots: [join(sourcesRoot, 'plugins')],
      },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };
    return new HarnessReconcilerService(
      logger as unknown as Logger,
      new HarnessManifestBuilder(),
      store,
      createStaticSourceResolver(state),
      [createClaudeTarget(store)],
    );
  }

  it('migrates a legacy junction that points INTO the user layer, and reports the unlink', async () => {
    const desired = join(ws, '.claude', 'skills', 'orchestration');
    mkdirSync(join(ws, '.claude', 'skills'), { recursive: true });
    if (!linkDir(join(skillsRoot, 'orchestration'), desired)) {
      console.warn('[spec] directory links unavailable; skipping');
      return;
    }

    const health = await reconciler().reconcile(ws, {
      mode: 'full',
      reason: 'legacy junction',
    });

    // The link became a real copy at the same path.
    expect(lstatSync(desired).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(desired, 'SKILL.md'), 'utf-8')).toContain(
      'the user-layer body',
    );
    // And the deletion is visible: reaping something in the user's workspace
    // must never be a silent side effect of a "reconcile".
    const claude = health.targets.find((t) => t.target === 'claude');
    expect(claude?.removed).toContain(desired);
    expect(claude?.foreign).toEqual([]);
  });

  it('migrates a legacy junction into a declared legacyLinkRoot (a disabled plugin dir)', async () => {
    const pluginSkills = join(sourcesRoot, 'plugins', 'ptah-core', 'skills');
    writeSkill(pluginSkills, 'orchestration', 'plugin body');
    const desired = join(ws, '.claude', 'skills', 'orchestration');
    mkdirSync(join(ws, '.claude', 'skills'), { recursive: true });
    if (!linkDir(join(pluginSkills, 'orchestration'), desired)) {
      console.warn('[spec] directory links unavailable; skipping');
      return;
    }

    await reconciler().reconcile(ws, {
      mode: 'full',
      reason: 'legacy plugin junction',
    });

    expect(lstatSync(desired).isSymbolicLink()).toBe(false);
    // The user layer is still the source of truth for the CONTENT.
    expect(readFileSync(join(desired, 'SKILL.md'), 'utf-8')).toContain(
      'the user-layer body',
    );
  });

  it("leaves the USER's own symlink at a desired path alone and reports it foreign", async () => {
    const mine = writeSkill(elsewhere, 'orchestration', 'MY working copy');
    const desired = join(ws, '.claude', 'skills', 'orchestration');
    mkdirSync(join(ws, '.claude', 'skills'), { recursive: true });
    if (!linkDir(mine, desired)) {
      console.warn('[spec] directory links unavailable; skipping');
      return;
    }

    const health = await reconciler().reconcile(ws, {
      mode: 'full',
      reason: 'user symlink',
    });

    expect(lstatSync(desired).isSymbolicLink()).toBe(true);
    expect(existsSync(join(mine, 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(mine, 'SKILL.md'), 'utf-8')).toContain(
      'MY working copy',
    );

    const claude = health.targets.find((t) => t.target === 'claude');
    expect(claude?.foreign).toContain('.claude/skills/orchestration');
    expect(claude?.removed).toEqual([]);
  });

  it("leaves the user's own symlink alone at a path nothing desires, too", async () => {
    const mine = writeSkill(elsewhere, 'my-scratch-skill', 'scratch');
    const stray = join(ws, '.claude', 'skills', 'my-scratch-skill');
    mkdirSync(join(ws, '.claude', 'skills'), { recursive: true });
    if (!linkDir(mine, stray)) {
      console.warn('[spec] directory links unavailable; skipping');
      return;
    }

    const health = await reconciler().reconcile(ws, {
      mode: 'full',
      reason: 'undesired user symlink',
    });

    expect(lstatSync(stray).isSymbolicLink()).toBe(true);
    expect(
      health.targets.find((t) => t.target === 'claude')?.foreign,
    ).toContain('.claude/skills/my-scratch-skill');
  });
});
