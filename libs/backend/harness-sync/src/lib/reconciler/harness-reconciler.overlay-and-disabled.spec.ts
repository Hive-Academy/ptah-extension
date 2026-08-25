/**
 * Disabled ids and overlay precedence, materialized on disk (required
 * coverage items 14/15 — the "reaches the target" half; the slug-level half
 * is unit-tested directly against `HarnessManifestBuilder`).
 *
 * Source-under-test: `HarnessReconcilerService` + `ClaudeTarget`.
 */

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
import type { Logger } from '@ptah-extension/vscode-core';
import { ClaudeTarget } from '../targets/claude-target';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { HarnessReconcilerService } from './harness-reconciler.service';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { HarnessStateStore } from '../gitignore/harness-state-store';

/**
 * Skills are gated per workspace since TASK_2026_316, and a fresh temp
 * workspace has no manifest evidence, so the migration correctly gates it. This
 * suite is about the plugin OVERLAY and `disabledSkillIds` — the two INNER
 * levels — so the outer selection is recorded up front rather than re-tested.
 * The gate itself is owned by `reconciler/harness-reconciler.skill-consent.spec.ts`.
 */
function grantSkillSync(workspaceRoot: string): void {
  const store = new HarnessStateStore();
  store.save(workspaceRoot, {
    ...store.load(workspaceRoot),
    skillSyncMode: 'all',
  });
}
import { HarnessSourceState } from '../sources/harness-source.port';

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

function writeSkill(
  skillsRoot: string,
  slug: string,
  body = 'skill body',
): void {
  const dir = join(skillsRoot, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${slug}\n---\n${body}\n`,
    'utf-8',
  );
}

function newReconciler(
  sourceState: HarnessSourceState,
): HarnessReconcilerService {
  const logger = makeFakeLogger();
  const store = new ManagedManifestStore((message, detail) =>
    logger.warn(message, detail),
  );
  const resolver = createStaticSourceResolver(sourceState);
  return new HarnessReconcilerService(
    logger as unknown as Logger,
    new HarnessManifestBuilder(),
    store,
    resolver,
    [new ClaudeTarget(store)],
  );
}

describe('HarnessReconcilerService — disabled ids', () => {
  let ws: string;
  let sourcesRoot: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-sync-recon-'));
    grantSkillSync(ws);
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-sync-src-'));
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
    rmSync(sourcesRoot, { recursive: true, force: true });
  });

  it('[14] a skill in disabledSkillIds is never written to the target', async () => {
    const skillsRoot = join(sourcesRoot, 'skills');
    writeSkill(skillsRoot, 'foo');
    writeSkill(skillsRoot, 'bar');
    const sourceState: HarnessSourceState = {
      layout: {
        skillsRoot,
        commandsRoot: join(sourcesRoot, 'commands'),
        agentsRoot: join(sourcesRoot, 'agents'),
      },
      overlayPluginPaths: [],
      disabledSkillIds: ['bar'],
      disabledPluginIds: [],
    };
    const reconciler = newReconciler(sourceState);

    await reconciler.reconcile(ws, { mode: 'full', reason: 'test' });

    expect(existsSync(join(ws, '.claude', 'skills', 'foo'))).toBe(true);
    expect(existsSync(join(ws, '.claude', 'skills', 'bar'))).toBe(false);
  });

  it('[14] a disabled plugin id contributes no overlay skills to the target', async () => {
    const pluginPath = join(sourcesRoot, 'plugins', 'ptah-harness-extra');
    writeSkill(join(pluginPath, 'skills'), 'only-in-plugin');
    const sourceState: HarnessSourceState = {
      layout: {
        skillsRoot: join(sourcesRoot, 'skills'),
        commandsRoot: join(sourcesRoot, 'commands'),
        agentsRoot: join(sourcesRoot, 'agents'),
      },
      overlayPluginPaths: [pluginPath],
      disabledSkillIds: [],
      disabledPluginIds: ['ptah-harness-extra'],
    };
    const reconciler = newReconciler(sourceState);

    await reconciler.reconcile(ws, { mode: 'full', reason: 'test' });

    expect(existsSync(join(ws, '.claude', 'skills', 'only-in-plugin'))).toBe(
      false,
    );
  });
});

describe('HarnessReconcilerService — overlay precedence', () => {
  let ws: string;
  let sourcesRoot: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-sync-recon-'));
    grantSkillSync(ws);
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-sync-src-'));
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
    rmSync(sourcesRoot, { recursive: true, force: true });
  });

  it('[15] an overlay-only plugin skill reaches the target', async () => {
    const pluginPath = join(sourcesRoot, 'plugins', 'ptah-harness-x');
    writeSkill(
      join(pluginPath, 'skills'),
      'only-in-plugin',
      'plugin-only content',
    );
    const sourceState: HarnessSourceState = {
      layout: {
        skillsRoot: join(sourcesRoot, 'skills'),
        commandsRoot: join(sourcesRoot, 'commands'),
        agentsRoot: join(sourcesRoot, 'agents'),
      },
      overlayPluginPaths: [pluginPath],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };
    const reconciler = newReconciler(sourceState);

    const health = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'test',
    });

    const copiedFile = join(
      ws,
      '.claude',
      'skills',
      'only-in-plugin',
      'SKILL.md',
    );
    expect(existsSync(copiedFile)).toBe(true);
    expect(readFileSync(copiedFile, 'utf-8')).toContain('plugin-only content');
    expect(health.collisions).toHaveLength(0);
  });

  it('[15] an overlay skill sharing a slug with the user layer produces no collision report, and the USER LAYER content is what gets copied', async () => {
    writeSkill(join(sourcesRoot, 'skills'), 'shared-skill', 'USER CONTENT');
    const pluginPath = join(sourcesRoot, 'plugins', 'ptah-harness-mirror');
    writeSkill(join(pluginPath, 'skills'), 'shared-skill', 'PLUGIN CONTENT');
    const sourceState: HarnessSourceState = {
      layout: {
        skillsRoot: join(sourcesRoot, 'skills'),
        commandsRoot: join(sourcesRoot, 'commands'),
        agentsRoot: join(sourcesRoot, 'agents'),
      },
      overlayPluginPaths: [pluginPath],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };
    const reconciler = newReconciler(sourceState);

    const health = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'test',
    });

    expect(health.collisions).toHaveLength(0);
    const copiedFile = join(
      ws,
      '.claude',
      'skills',
      'shared-skill',
      'SKILL.md',
    );
    expect(readFileSync(copiedFile, 'utf-8')).toContain('USER CONTENT');
    expect(readFileSync(copiedFile, 'utf-8')).not.toContain('PLUGIN CONTENT');
  });
});
