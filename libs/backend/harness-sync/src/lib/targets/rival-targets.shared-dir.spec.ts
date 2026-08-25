/**
 * Codex and Antigravity both write `{ws}/.agents/skills` — the one directory
 * two harness targets share. Each must accept the other's manifest as proof of
 * Ptah ownership, or whichever CLI reconciles second finds the directory full
 * of files it cannot prove it wrote and classifies every one of them foreign
 * forever.
 *
 * Source-under-test: `createCodexTarget` + `createAntigravityTarget` via
 * `HarnessReconcilerService`.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import type { HarnessTargetId } from '@ptah-extension/shared';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { HarnessReconcilerService } from '../reconciler/harness-reconciler.service';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import type {
  HarnessSourceState,
  IHarnessCliDetector,
} from '../sources/harness-source.port';
import { createAntigravityTarget, createCodexTarget } from './rival-targets';
import type { IHarnessTarget } from './harness-target.port';
import { HarnessStateStore } from '../gitignore/harness-state-store';

/**
 * Skills are gated per workspace since TASK_2026_316, and a fresh temp
 * workspace has no manifest evidence, so the migration correctly gates it. This
 * suite is about Codex and Antigravity SHARING `{ws}/.agents/skills`, so the
 * selection is recorded up front rather than re-tested.
 */
function grantSkillSync(workspaceRoot: string): void {
  const store = new HarnessStateStore();
  store.save(workspaceRoot, {
    ...store.load(workspaceRoot),
    skillSyncMode: 'all',
  });
}

interface FakeLogger {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

function makeFakeLogger(): FakeLogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

/** Reports every id in `installed` as present, nothing else. */
function detectorFor(installed: HarnessTargetId[]): IHarnessCliDetector {
  const set = new Set(installed);
  return { isInstalled: (target) => Promise.resolve(set.has(target)) };
}

function writeSkill(skillsRoot: string, slug: string): void {
  const dir = join(skillsRoot, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${slug}\n---\nbody\n`,
    'utf-8',
  );
}

describe('Codex + Antigravity shared `.agents/skills` directory', () => {
  let ws: string;
  let sourcesRoot: string;
  let tempHome: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-sync-shareddir-ws-'));
    grantSkillSync(ws);
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-sync-shareddir-src-'));
    tempHome = mkdtempSync(join(tmpdir(), 'harness-sync-shareddir-home-'));
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
    rmSync(sourcesRoot, { recursive: true, force: true });
    rmSync(tempHome, { recursive: true, force: true });
  });

  function sourceStateWith(
    skillSlugs: string[],
    disabledSkillIds: string[] = [],
  ): HarnessSourceState {
    const skillsRoot = join(sourcesRoot, 'skills');
    for (const slug of skillSlugs) writeSkill(skillsRoot, slug);
    return {
      layout: {
        skillsRoot,
        commandsRoot: join(sourcesRoot, 'commands'),
        agentsRoot: join(sourcesRoot, 'agents'),
      },
      overlayPluginPaths: [],
      disabledSkillIds,
      disabledPluginIds: [],
    };
  }

  function reconcilerFor(
    sourceState: HarnessSourceState,
    targets: IHarnessTarget[],
  ): HarnessReconcilerService {
    const logger = makeFakeLogger();
    return new HarnessReconcilerService(
      logger as unknown as Logger,
      new HarnessManifestBuilder(),
      new ManagedManifestStore((message, detail) =>
        logger.warn(message, detail),
      ),
      createStaticSourceResolver(sourceState),
      targets,
    );
  }

  it('reconcile with both targets: the skill lands once, and BOTH manifests own it', async () => {
    const sourceState = sourceStateWith(['foo']);
    const detector = detectorFor(['codex', 'antigravity']);
    const store = new ManagedManifestStore();
    const codexTarget = createCodexTarget({
      manifestStore: store,
      detector,
      homeDir: tempHome,
    });
    const antigravityTarget = createAntigravityTarget({
      manifestStore: store,
      detector,
      homeDir: tempHome,
    });
    const reconciler = reconcilerFor(sourceState, [
      codexTarget,
      antigravityTarget,
    ]);

    await reconciler.reconcile(ws, { mode: 'full', reason: 'seed' });

    const skillDir = join(ws, '.agents', 'skills', 'foo');
    expect(existsSync(skillDir)).toBe(true);
    // Only one physical copy — not one per target.
    expect(readdirSync(join(ws, '.agents', 'skills'))).toEqual(['foo']);

    const codexManifest = new ManagedManifestStore().load(ws, 'codex');
    const antigravityManifest = new ManagedManifestStore().load(
      ws,
      'antigravity',
    );
    expect(codexManifest.entries['.agents/skills/foo']).toBeDefined();
    // BOTH manifests, not just the one that did the writing. Borrowed
    // ownership is not ownership: if the sibling were dropped from a later
    // partial reconcile, a target whose proof lived only in the sibling's
    // manifest would find a perfectly good copy it could no longer prove it
    // wrote, and would freeze on it as foreign.
    expect(antigravityManifest.entries['.agents/skills/foo']).toBeDefined();
  });

  it("the second target to reconcile does not classify the first's copy as foreign, and ends up owning it too", async () => {
    const sourceState = sourceStateWith(['foo']);
    const store = new ManagedManifestStore();

    const codexOnly = reconcilerFor(sourceState, [
      createCodexTarget({
        manifestStore: store,
        detector: detectorFor(['codex']),
        homeDir: tempHome,
      }),
    ]);
    await codexOnly.reconcile(ws, { mode: 'full', reason: 'seed codex' });

    const antigravityOnly = reconcilerFor(sourceState, [
      createAntigravityTarget({
        manifestStore: store,
        detector: detectorFor(['antigravity']),
        homeDir: tempHome,
      }),
    ]);
    const health = await antigravityOnly.reconcile(ws, {
      mode: 'full',
      reason: 'seed antigravity',
    });

    expect(health.targets[0]?.foreign).not.toContain('.agents/skills/foo');

    // Recognising the copy is only half of it — the second target must also
    // adopt it into its own manifest, so its ownership survives the first
    // target being dropped from a later pass.
    const antigravityManifest = new ManagedManifestStore().load(
      ws,
      'antigravity',
    );
    expect(antigravityManifest.entries['.agents/skills/foo']).toBeDefined();
  });

  it('a skill removed from the desired state is reaped, and reaping it twice (once per target) does not error', async () => {
    const seeded = sourceStateWith(['foo']);
    const detector = detectorFor(['codex', 'antigravity']);
    const store = new ManagedManifestStore();
    const seedReconciler = reconcilerFor(seeded, [
      createCodexTarget({ manifestStore: store, detector, homeDir: tempHome }),
      createAntigravityTarget({
        manifestStore: store,
        detector,
        homeDir: tempHome,
      }),
    ]);
    await seedReconciler.reconcile(ws, { mode: 'full', reason: 'seed' });
    const skillDir = join(ws, '.agents', 'skills', 'foo');
    expect(existsSync(skillDir)).toBe(true);

    const withoutFoo = sourceStateWith([], ['foo']);
    const reapReconciler = reconcilerFor(withoutFoo, [
      createCodexTarget({ manifestStore: store, detector, homeDir: tempHome }),
      createAntigravityTarget({
        manifestStore: store,
        detector,
        homeDir: tempHome,
      }),
    ]);

    const health = await reapReconciler.reconcile(ws, {
      mode: 'full',
      reason: 'reap',
    });

    expect(existsSync(skillDir)).toBe(false);
    for (const targetHealth of health.targets) {
      expect(targetHealth.writeFailed).toEqual([]);
    }
  });
});
