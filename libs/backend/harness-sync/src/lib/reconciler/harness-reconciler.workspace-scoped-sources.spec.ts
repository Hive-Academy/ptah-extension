/**
 * The desired state is a function of the ROOT BEING RECONCILED, not of the
 * folder the host happens to have active (TASK_2026_346).
 *
 * ### The captured failure
 *
 * `tmp/logs/log.log`, one Electron session with two folders open:
 *
 * - `:1109` — `workspace:addFolder property-hub` fires
 *   `onDidChangeWorkspaceFolders` while `qa3elhamor` is still the ACTIVE
 *   workspace, and the host propagates `qa3elhamor`.
 * - `:1122` — `workspace:switch` flips the workspace-aware state storage to
 *   `property-hub` (3 plugins) BEFORE that pass reaches its source resolve.
 * - `:1225` — the `qa3elhamor` pass resolves `property-hub`'s overlay and writes
 *   44 skill copies into `qa3elhamor` (11 per target across claude, codex,
 *   copilot and antigravity), recording every one of them in `qa3elhamor`'s
 *   manifests.
 * - `:1647` — switching back reaps all 44 again, correctly, because they are
 *   manifest-owned and the now-correct desired state does not name them.
 *
 * Every tab switch between two open folders therefore tore down and
 * re-materialised the other folder's harness. Nothing about the reconciler's
 * removal rules was wrong; the desired state it was handed described the wrong
 * workspace.
 *
 * Source-under-test: `HarnessReconcilerService.reconcile` / `.verify` +
 * `IHarnessSourceResolver.resolve(workspaceRoot)`.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import { ClaudeTarget } from '../targets/claude-target';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { HarnessStateStore } from '../gitignore/harness-state-store';
import { resolveHarnessWorkspaceRoot } from '../workspace/workspace-root';
import type {
  HarnessSourceState,
  IHarnessSourceResolver,
} from '../sources/harness-source.port';
import { HarnessReconcilerService } from './harness-reconciler.service';

/** See the note in `harness-reconciler.workspace-isolation.spec.ts`. */
function grantSkillSync(workspaceRoot: string): void {
  const store = new HarnessStateStore();
  store.save(workspaceRoot, {
    ...store.load(workspaceRoot),
    skillSyncMode: 'all',
  });
}

function makeFakeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function writeSkill(skillsRoot: string, slug: string): void {
  mkdirSync(join(skillsRoot, slug), { recursive: true });
  writeFileSync(
    join(skillsRoot, slug, 'SKILL.md'),
    `---\nname: ${slug}\ndescription: the ${slug} skill\n---\n${slug} body\n`,
    'utf-8',
  );
}

function skillCopy(workspaceRoot: string, slug: string): string {
  return join(workspaceRoot, '.claude', 'skills', slug, 'SKILL.md');
}

function manifestSlugs(workspaceRoot: string): string[] {
  return Object.keys(
    new ManagedManifestStore().load(workspaceRoot, 'claude').entries,
  ).sort();
}

/** Every path this pass removed, across every target. */
function removedCount(health: {
  targets: readonly { removed: readonly string[] }[];
}): number {
  return health.targets.reduce(
    (total, target) => total + target.removed.length,
    0,
  );
}

describe('HarnessReconcilerService — the desired state is scoped to the root being reconciled', () => {
  let wsA: string;
  let wsB: string;
  let sourcesRoot: string;
  let pluginA: string;
  let pluginB: string;

  /**
   * One user layer shared by both folders (it is one directory per MACHINE),
   * plus one overlay plugin per folder — the workspace-scoped
   * `{ws}/.ptah/plugins` shape, which is exactly what differed between
   * `qa3elhamor` and `property-hub`.
   */
  beforeEach(() => {
    wsA = mkdtempSync(join(tmpdir(), 'harness-scoped-wsA-'));
    wsB = mkdtempSync(join(tmpdir(), 'harness-scoped-wsB-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-scoped-src-'));
    grantSkillSync(wsA);
    grantSkillSync(wsB);

    writeSkill(join(sourcesRoot, 'skills'), 'shared-skill');
    pluginA = join(sourcesRoot, 'plugins', 'ptah-harness-only-a');
    pluginB = join(sourcesRoot, 'plugins', 'ptah-harness-only-b');
    writeSkill(join(pluginA, 'skills'), 'only-a');
    writeSkill(join(pluginB, 'skills'), 'only-b');
  });

  afterEach(() => {
    for (const dir of [wsA, wsB, sourcesRoot]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function stateFor(workspaceRoot: string): HarnessSourceState {
    return {
      layout: {
        skillsRoot: join(sourcesRoot, 'skills'),
        commandsRoot: join(sourcesRoot, 'commands'),
        agentsRoot: join(sourcesRoot, 'agents'),
      },
      overlayPluginPaths: [
        resolveHarnessWorkspaceRoot(workspaceRoot) ===
        resolveHarnessWorkspaceRoot(wsA)
          ? pluginA
          : pluginB,
      ],
      overlayPluginPathsKnown: true,
      disabledSkillIds: [],
      disabledPluginIds: [],
    };
  }

  /**
   * ONE reconciler for both folders, as every host has: it is a singleton, and
   * the pass is told which root it is for by its argument alone.
   */
  function newReconciler(
    resolver: IHarnessSourceResolver,
  ): HarnessReconcilerService {
    const logger = makeFakeLogger();
    const store = new ManagedManifestStore();
    return new HarnessReconcilerService(
      logger,
      new HarnessManifestBuilder(),
      store,
      resolver,
      [new ClaudeTarget(store)],
    );
  }

  it('[346/1] A → B → A over one reconciler converges: the third pass removes nothing and A holds only A-derived entries', async () => {
    const reconciler = newReconciler({ resolve: (ws) => stateFor(ws ?? wsA) });

    await reconciler.reconcile(wsA, { mode: 'full', reason: 'activation' });
    expect(manifestSlugs(wsA)).toEqual([
      '.claude/skills/only-a',
      '.claude/skills/shared-skill',
    ]);

    await reconciler.reconcile(wsB, {
      mode: 'full',
      reason: 'workspace-folders-changed',
    });
    expect(manifestSlugs(wsB)).toEqual([
      '.claude/skills/only-b',
      '.claude/skills/shared-skill',
    ]);

    // The switch back. Before the fix this pass reported `removed 44` — every
    // artifact the previous pass had written into the WRONG workspace.
    const back = await reconciler.reconcile(wsA, {
      mode: 'full',
      reason: 'workspace-folders-changed',
    });

    expect(removedCount(back)).toBe(0);
    expect(manifestSlugs(wsA)).toEqual([
      '.claude/skills/only-a',
      '.claude/skills/shared-skill',
    ]);
    // A never learned about B's skill, so there was never anything to reap.
    expect(existsSync(skillCopy(wsA, 'only-b'))).toBe(false);
    expect(existsSync(skillCopy(wsA, 'only-a'))).toBe(true);
    // And B is untouched by A's pass, which is E13 restated for the overlay.
    expect(existsSync(skillCopy(wsB, 'only-b'))).toBe(true);
    expect(existsSync(skillCopy(wsB, 'only-a'))).toBe(false);
  });

  it("[346/2] a workspace switch landing between the trigger and the source resolve cannot put B's entries in A", async () => {
    // The ambient scope a workspace-aware state storage would answer with. The
    // reconciler must not consult it, so flipping it mid-pass must change
    // nothing about the pass already in flight for A.
    let active = wsA;
    const reconciler = newReconciler({
      resolve: (ws) => stateFor(ws ?? active),
    });

    // `serializePerWorkspace` chains the pass onto a promise, so the body — and
    // therefore the source resolve — runs on a later microtask. That is the
    // real ordering from the log: the folder-change trigger fires for A
    // (`:1109`) and `workspace:switch` flips storage to B (`:1122`) before A's
    // pass reads its sources (`:1225`). Modelled as the mechanism rather than
    // as a sleep: no timer is involved in the defect.
    const passA = reconciler.reconcile(wsA, {
      mode: 'full',
      reason: 'workspace-folders-changed',
    });
    active = wsB;
    const health = await passA;

    expect(health.workspaceRoot).toBe(resolveHarnessWorkspaceRoot(wsA));
    expect(removedCount(health)).toBe(0);
    expect(manifestSlugs(wsA)).toEqual([
      '.claude/skills/only-a',
      '.claude/skills/shared-skill',
    ]);
    expect(existsSync(skillCopy(wsA, 'only-b'))).toBe(false);
  });

  it('[346/3] resolve is called with the NORMALIZED root — for a full pass, a preflight and a verify alike', async () => {
    const resolve = jest.fn((ws?: string) => stateFor(ws ?? wsA));
    const reconciler = newReconciler({ resolve });
    const normalized = resolveHarnessWorkspaceRoot(wsA);

    // A cwd INSIDE the workspace, as a rival CLI spawned for a sub-package
    // hands us (E14). The resolver must see the root, never the sub-directory,
    // or `{ws}/.ptah/plugins` would be looked for in the wrong place.
    const cwd = join(wsA, 'packages', 'api');
    mkdirSync(cwd, { recursive: true });

    await reconciler.reconcile(cwd, { mode: 'full', reason: 'activation' });
    await reconciler.reconcile(cwd, {
      mode: 'preflight',
      reason: 'session-start',
    });
    await reconciler.verify(cwd);

    expect(resolve).toHaveBeenCalledTimes(3);
    for (const call of resolve.mock.calls) {
      expect(call[0]).toBe(normalized);
    }
    expect(normalized).not.toBe(cwd);
  });
});
