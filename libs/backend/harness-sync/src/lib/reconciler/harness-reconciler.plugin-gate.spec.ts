/**
 * Plugin enablement as the outer gate over the USER-LAYER base (TASK_2026_316
 * Batch 1).
 *
 * The user layer is one directory per MACHINE and the mirror is
 * create-if-absent, so a workspace that enabled nothing was inheriting the union
 * of every plugin ever enabled anywhere on that machine — and unchecking a
 * plugin removed it from the overlay while its clone kept claiming the slug.
 * `plugin-origin-gate.ts` applies the workspace's plugin state to the base loop
 * by reading each clone's `.ptah-origin.json`.
 *
 * Every rule in that file is a refusal to delete, so most of what is pinned here
 * is what must SURVIVE. The first case is the load-bearing one: skills are
 * manifest-owned, which makes a slug leaving the desired state a DELETE, and
 * `PluginConfigSourceResolver` has three failure paths that all return an empty
 * overlay. A filter that read those as "everything is disabled" would empty
 * `.claude/skills`, `.agents/skills`, `.github/skills` and `.cursor/skills` in
 * one pass reported as clean.
 *
 * Sources under test: `HarnessManifestBuilder` + `createPluginOriginGate`, and
 * `HarnessReconcilerService` + `ClaudeTarget` for the cases that have to be
 * observed on disk.
 *
 * No spec here touches the real home directory: the layout roots are temp dirs
 * and the MCP intent store is pointed at a temp home explicitly.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { HarnessStateStore } from '../gitignore/harness-state-store';
import { tmpdir } from 'os';
import { join } from 'path';
import { ORIGIN_SIDECAR_FILENAME } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import type {
  HarnessSourceLayout,
  HarnessSourceState,
} from '../sources/harness-source.port';
import { McpIntentStore } from '../sources/mcp-intent-store';
import {
  createPluginConfigSourceResolver,
  type HarnessPluginConfigReader,
} from '../sources/plugin-config-source-resolver';
import { ClaudeTarget } from '../targets/claude-target';
import { HarnessReconcilerService } from './harness-reconciler.service';

function makeFakeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

/**
 * Write a skill directory, optionally with the origin sidecar the user-layer
 * mirror would have written beside it.
 *
 * Omitting `pluginId` writes NO sidecar at all, which is the user-authored case
 * — deliberately distinct from passing `null`, which writes a sidecar that names
 * no plugin (a synthesized skill).
 */
function writeSkill(
  skillsRoot: string,
  slug: string,
  options: { pluginId?: string | null; body?: string } = {},
): void {
  const dir = join(skillsRoot, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${slug}\n---\n${options.body ?? 'skill body'}\n`,
    'utf-8',
  );
  if (!('pluginId' in options)) return;
  writeFileSync(
    join(dir, ORIGIN_SIDECAR_FILENAME),
    JSON.stringify({
      kind: 'skill',
      slug,
      pluginId: options.pluginId ?? null,
      version: null,
      sourceHash: 'sha256:test',
      clonedAt: 1_700_000_000_000,
      diverged: false,
      lastEnhancedAt: null,
      historyDir: '.history',
    }),
    'utf-8',
  );
}

describe('HarnessManifestBuilder — the plugin gate over the user layer', () => {
  let root: string;
  let builder: HarnessManifestBuilder;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'harness-plugin-gate-'));
    builder = new HarnessManifestBuilder();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** A source state whose overlay IS authoritative — the post-1.2 normal case. */
  function knownOverlay(enabledPluginIds: string[]): HarnessSourceState {
    return {
      layout: {
        skillsRoot: join(root, 'skills'),
        commandsRoot: join(root, 'commands'),
        agentsRoot: join(root, 'agents'),
      },
      overlayPluginPaths: enabledPluginIds.map((id) =>
        join(root, 'plugins', id),
      ),
      overlayPluginPathsKnown: true,
      disabledSkillIds: [],
      disabledPluginIds: [],
    };
  }

  const desiredSlugs = (state: HarnessSourceState): string[] =>
    builder.build(state).skills.map((skill) => skill.slug);

  it('[316/2] a user-layer clone whose plugin is no longer enabled leaves the desired state', () => {
    writeSkill(join(root, 'skills'), 'angular-patterns', {
      pluginId: 'ptah-angular',
    });
    writeSkill(join(root, 'skills'), 'nest-patterns', {
      pluginId: 'ptah-nestjs',
    });

    expect(desiredSlugs(knownOverlay(['ptah-nestjs']))).toEqual([
      'nest-patterns',
    ]);
  });

  it('[316/3] a ptah-harness-* clone is OPT-OUT, so absence from the enabled set never drops it', () => {
    writeSkill(join(root, 'skills'), 'release-notes', {
      pluginId: 'ptah-harness-release-notes',
    });

    // Nothing enabled at all, and the overlay is authoritative about that.
    expect(desiredSlugs(knownOverlay([]))).toEqual(['release-notes']);
  });

  it('[316/4] a ptah-skillssh-* clone is OPT-OUT for the same reason — the user asked for it by clicking Install', () => {
    writeSkill(join(root, 'skills'), 'sh-installed', {
      pluginId: 'ptah-skillssh-acme-tools',
    });

    expect(desiredSlugs(knownOverlay([]))).toEqual(['sh-installed']);
  });

  it('[316/5] a clone with NO sidecar is user-authored and is never filtered', () => {
    writeSkill(join(root, 'skills'), 'my-own-skill');

    expect(desiredSlugs(knownOverlay([]))).toEqual(['my-own-skill']);
  });

  it('[316/6] a clone whose sidecar names no plugin (synthesized skill) is never filtered', () => {
    writeSkill(join(root, 'skills'), 'synthesized', { pluginId: null });

    expect(desiredSlugs(knownOverlay([]))).toEqual(['synthesized']);
  });

  it('[316/7] disabledPluginIds is the one filter that DOES apply to a harness plugin', () => {
    writeSkill(join(root, 'skills'), 'release-notes', {
      pluginId: 'ptah-harness-release-notes',
    });

    const state: HarnessSourceState = {
      ...knownOverlay([]),
      disabledPluginIds: ['ptah-harness-release-notes'],
    };

    expect(desiredSlugs(state)).toEqual([]);
  });

  it('[316/1] an overlay the resolver could not vouch for filters nothing, even for a plugin that is plainly absent from it', () => {
    writeSkill(join(root, 'skills'), 'angular-patterns', {
      pluginId: 'ptah-angular',
    });

    // The same empty overlay as a "nothing enabled" state — the ONLY difference
    // is the missing flag, and it has to be the difference between keeping the
    // skill and deleting it.
    const unknown: HarnessSourceState = {
      ...knownOverlay([]),
      overlayPluginPathsKnown: undefined,
    };

    expect(desiredSlugs(unknown)).toEqual(['angular-patterns']);
    expect(desiredSlugs(knownOverlay([]))).toEqual([]);
  });

  it('[316] a malformed sidecar reads as NO sidecar, so a corrupt file can never cause a delete', () => {
    writeSkill(join(root, 'skills'), 'half-written', {
      pluginId: 'ptah-angular',
    });
    writeFileSync(
      join(root, 'skills', 'half-written', ORIGIN_SIDECAR_FILENAME),
      '{"kind":"skill","pluginId":',
      'utf-8',
    );

    expect(desiredSlugs(knownOverlay([]))).toEqual(['half-written']);
  });

  it('[316] a filtered clone vacates its slug, so a DIFFERENT enabled plugin shipping it still wins the slot', () => {
    writeSkill(join(root, 'skills'), 'shared-skill', {
      pluginId: 'ptah-angular',
      body: 'CLONE FROM DISABLED PLUGIN',
    });
    const enabledPlugin = join(root, 'plugins', 'ptah-nestjs');
    writeSkill(join(enabledPlugin, 'skills'), 'shared-skill', {
      body: 'ENABLED PLUGIN CONTENT',
    });

    const desired = builder.build(knownOverlay(['ptah-nestjs'])).skills;

    expect(desired.map((skill) => skill.slug)).toEqual(['shared-skill']);
    expect(desired[0]?.sourceDir).toBe(
      join(enabledPlugin, 'skills', 'shared-skill'),
    );
  });
});

describe('HarnessReconcilerService — the plugin gate on disk', () => {
  let ws: string;
  let sourcesRoot: string;
  let tempHome: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-plugin-gate-ws-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-plugin-gate-src-'));
    tempHome = mkdtempSync(join(tmpdir(), 'harness-plugin-gate-home-'));
    // The skill-sync gate (TASK_2026_316 Batch 2) sits OUTSIDE the plugin gate
    // this suite tests, and a fresh temp workspace has no manifest evidence, so
    // its migration would gate everything before the plugin rules were reached.
    // Recorded as `'all'` so the level under test is the only one filtering.
    const stateStore = new HarnessStateStore();
    stateStore.save(ws, { ...stateStore.load(ws), skillSyncMode: 'all' });
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
    rmSync(sourcesRoot, { recursive: true, force: true });
    rmSync(tempHome, { recursive: true, force: true });
  });

  const layout = (): HarnessSourceLayout => ({
    skillsRoot: join(sourcesRoot, 'skills'),
    commandsRoot: join(sourcesRoot, 'commands'),
    agentsRoot: join(sourcesRoot, 'agents'),
  });

  /** A plugin loader that answers with the given enabled ids. */
  function reader(enabledPluginIds: string[]): HarnessPluginConfigReader {
    return {
      resolveCurrentPluginPaths: () =>
        enabledPluginIds.map((id) => join(sourcesRoot, 'plugins', id)),
      getDisabledSkillIds: () => [],
      getWorkspacePluginConfig: () => ({}),
    };
  }

  /**
   * A reconciler over the REAL `PluginConfigSourceResolver`, so the fail-open
   * case below exercises the actual `return empty` path rather than a source
   * state assembled by hand to look like it.
   */
  function newReconciler(
    readerFactory: () => HarnessPluginConfigReader | null,
  ): HarnessReconcilerService {
    const logger = makeFakeLogger();
    const store = new ManagedManifestStore((message, detail) =>
      logger.warn(message, detail),
    );
    return new HarnessReconcilerService(
      logger,
      new HarnessManifestBuilder(),
      store,
      createPluginConfigSourceResolver(
        readerFactory,
        layout(),
        new McpIntentStore(join(tempHome, '.ptah', 'mcp-installed.json')),
      ),
      [new ClaudeTarget(store)],
    );
  }

  const copyPath = (slug: string): string =>
    join(ws, '.claude', 'skills', slug, 'SKILL.md');

  const clonePath = (slug: string): string =>
    join(sourcesRoot, 'skills', slug, 'SKILL.md');

  it('[316/1 — R1] a plugin-config read failure reaps NOTHING: skills propagated by the previous pass survive', async () => {
    writeSkill(join(sourcesRoot, 'skills'), 'angular-patterns', {
      pluginId: 'ptah-angular',
    });

    // Pass one: the loader answers, the plugin is enabled, the copy lands.
    await newReconciler(() => reader(['ptah-angular'])).reconcile(ws, {
      mode: 'full',
      reason: 'test-pass-1',
    });
    expect(existsSync(copyPath('angular-patterns'))).toBe(true);

    // Pass two: the loader factory throws, exactly as it does before
    // `initialize()` has run. The resolver degrades to an empty overlay and
    // says nothing about whether that overlay is trustworthy.
    const health = await newReconciler(() => {
      throw new Error('plugin loader not initialized');
    }).reconcile(ws, { mode: 'full', reason: 'test-pass-2' });

    expect(existsSync(copyPath('angular-patterns'))).toBe(true);
    expect(health.targets.flatMap((target) => target.removed)).toHaveLength(0);
  });

  it('[316/2] disabling the plugin removes its per-workspace copy', async () => {
    writeSkill(join(sourcesRoot, 'skills'), 'angular-patterns', {
      pluginId: 'ptah-angular',
    });
    writeSkill(join(sourcesRoot, 'skills'), 'my-own-skill');

    await newReconciler(() => reader(['ptah-angular'])).reconcile(ws, {
      mode: 'full',
      reason: 'test-enabled',
    });
    expect(existsSync(copyPath('angular-patterns'))).toBe(true);

    await newReconciler(() => reader([])).reconcile(ws, {
      mode: 'full',
      reason: 'test-disabled',
    });

    expect(existsSync(copyPath('angular-patterns'))).toBe(false);
    // The user-authored skill beside it is untouched: it has no sidecar, so no
    // plugin toggle speaks for it.
    expect(existsSync(copyPath('my-own-skill'))).toBe(true);
  });

  it('[316/8 — R3] the user-layer CLONE survives that reap, so re-enabling is instant and offline', async () => {
    writeSkill(join(sourcesRoot, 'skills'), 'angular-patterns', {
      pluginId: 'ptah-angular',
    });

    await newReconciler(() => reader(['ptah-angular'])).reconcile(ws, {
      mode: 'full',
      reason: 'test-enabled',
    });
    await newReconciler(() => reader([])).reconcile(ws, {
      mode: 'full',
      reason: 'test-disabled',
    });

    // Only the per-workspace COPY is manifest-owned. Nothing in this lib writes
    // or deletes under `~/.ptah/user`; every removal is resolved against the
    // workspace root. Keeping the clone is also the mirror reaper's deliberate
    // verdict — `classifyUpstream` answers `check-plugin-dir` for a plugin it
    // did not scan, and a DISABLED plugin's directory is still on disk.
    expect(existsSync(copyPath('angular-patterns'))).toBe(false);
    expect(existsSync(clonePath('angular-patterns'))).toBe(true);
    expect(
      existsSync(
        join(
          sourcesRoot,
          'skills',
          'angular-patterns',
          ORIGIN_SIDECAR_FILENAME,
        ),
      ),
    ).toBe(true);

    // Re-check the box: the copy comes back from the surviving clone, with no
    // download and no network.
    await newReconciler(() => reader(['ptah-angular'])).reconcile(ws, {
      mode: 'full',
      reason: 'test-re-enabled',
    });
    expect(existsSync(copyPath('angular-patterns'))).toBe(true);
  });
});
