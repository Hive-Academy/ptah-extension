/**
 * The `skills` per-workspace selection gate and — the part that matters — its
 * migration (TASK_2026_316).
 *
 * Skills are manifest-owned, so a slug leaving the desired state is a DELETE.
 * A `skillSyncMode` that defaulted to `'selected'` with an empty allowlist
 * would not merely stop propagating: the first routine reconcile after an
 * upgrade would delete every `.claude/skills/*`, `.agents/skills/*`,
 * `.github/skills/*` and `.cursor/skills/*` Ptah had ever written, in every
 * existing workspace, silently, reported as an ordinary clean pass. This is
 * the regression guard on that failure, mirroring
 * `harness-reconciler.agent-consent.spec.ts` (TASK_2026_286) for the
 * identical shape.
 *
 * Source-under-test: `SkillSyncGate` via `HarnessReconcilerService`, plus
 * `HarnessManifestBuilder.buildSkills`'s three-level filter.
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
import { basename, join } from 'path';
import {
  ORIGIN_SIDECAR_FILENAME,
  type HarnessTargetId,
  type OriginSidecar,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  HarnessStateStore,
  harnessStatePath,
  type HarnessWorkspaceState,
} from '../gitignore/harness-state-store';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import {
  managedEntry,
  ManagedManifestStore,
} from '../manifest-store/managed-manifest';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import type {
  HarnessSourceState,
  IHarnessCliDetector,
} from '../sources/harness-source.port';
import { SkillSyncGate } from '../state/skill-sync-gate';
import { createClaudeTarget } from '../targets/claude-target';
import {
  createCodexTarget,
  createCopilotTarget,
  createCursorTarget,
} from '../targets/rival-targets';
import { HarnessReconcilerService } from './harness-reconciler.service';

function fakeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function detectorFor(installed: HarnessTargetId[]): IHarnessCliDetector {
  const set = new Set(installed);
  return { isInstalled: (target) => Promise.resolve(set.has(target)) };
}

describe('HarnessReconcilerService — the skills selection gate', () => {
  let ws: string;
  let sourcesRoot: string;
  let home: string;

  const CLAUDE_ONE = ['.claude', 'skills', 'skill-one'];
  const CLAUDE_TWO = ['.claude', 'skills', 'skill-two'];
  const CODEX_ONE = ['.agents', 'skills', 'skill-one'];
  const CODEX_TWO = ['.agents', 'skills', 'skill-two'];
  const COPILOT_ONE = ['.github', 'skills', 'skill-one'];
  const COPILOT_TWO = ['.github', 'skills', 'skill-two'];
  const CURSOR_ONE = ['.cursor', 'skills', 'skill-one'];
  const CURSOR_TWO = ['.cursor', 'skills', 'skill-two'];

  /** Every target's copy of one slug, for a one-line "propagated everywhere" assertion. */
  function allCopiesOf(slug: 'skill-one' | 'skill-two'): string[][] {
    const suffix = slug === 'skill-one' ? 'ONE' : 'TWO';
    return [
      suffix === 'ONE' ? CLAUDE_ONE : CLAUDE_TWO,
      suffix === 'ONE' ? CODEX_ONE : CODEX_TWO,
      suffix === 'ONE' ? COPILOT_ONE : COPILOT_TWO,
      suffix === 'ONE' ? CURSOR_ONE : CURSOR_TWO,
    ];
  }

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-skill-consent-ws-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-skill-consent-src-'));
    home = mkdtempSync(join(tmpdir(), 'harness-skill-consent-home-'));
    writeSkillSources('skill-one', 'skill-two');
  });

  afterEach(() => {
    for (const dir of [ws, sourcesRoot, home]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function writeSkill(root: string, slug: string): string {
    const dir = join(root, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'SKILL.md'),
      `---\nname: ${slug}\ndescription: the ${slug} skill\n---\n${slug} body\n`,
      'utf-8',
    );
    return dir;
  }

  function writeSkillSources(...slugs: string[]): void {
    const skillsRoot = join(sourcesRoot, 'skills');
    mkdirSync(skillsRoot, { recursive: true });
    for (const slug of slugs) writeSkill(skillsRoot, slug);
  }

  /** Marks a user-layer clone as coming from `pluginId` (or synthesized, if `null`). */
  function writeSidecar(cloneDir: string, pluginId: string | null): void {
    const sidecar: OriginSidecar = {
      kind: 'skill',
      slug: basename(cloneDir),
      pluginId,
      version: null,
      sourceHash: 'seed',
      clonedAt: Date.now(),
      diverged: false,
      lastEnhancedAt: null,
      historyDir: join(cloneDir, '.history'),
    };
    writeFileSync(
      join(cloneDir, ORIGIN_SIDECAR_FILENAME),
      JSON.stringify(sidecar),
      'utf-8',
    );
  }

  function sourceState(
    overrides: Partial<HarnessSourceState> = {},
  ): HarnessSourceState {
    return {
      layout: {
        skillsRoot: join(sourcesRoot, 'skills'),
        commandsRoot: join(sourcesRoot, 'commands'),
        agentsRoot: join(sourcesRoot, 'agents'),
      },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
      disabledAgentIds: [],
      ...overrides,
    };
  }

  function newReconciler(
    overrides: Partial<HarnessSourceState> = {},
  ): HarnessReconcilerService {
    const store = new ManagedManifestStore();
    const deps = {
      manifestStore: store,
      detector: detectorFor(['codex', 'copilot', 'cursor']),
      homeDir: home,
    };
    return new HarnessReconcilerService(
      fakeLogger(),
      new HarnessManifestBuilder(),
      store,
      createStaticSourceResolver(sourceState(overrides)),
      [
        createClaudeTarget(store),
        createCodexTarget(deps),
        createCopilotTarget(deps),
        createCursorTarget(deps),
      ],
    );
  }

  function readState(): HarnessWorkspaceState | null {
    const path = harnessStatePath(ws);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8')) as HarnessWorkspaceState;
  }

  function exists(...segments: string[]): boolean {
    return existsSync(join(ws, ...segments));
  }

  function expectPropagatedEverywhere(slug: 'skill-one' | 'skill-two'): void {
    for (const segments of allCopiesOf(slug)) {
      expect(exists(...segments)).toBe(true);
    }
  }

  function expectAbsentEverywhere(slug: 'skill-one' | 'skill-two'): void {
    for (const segments of allCopiesOf(slug)) {
      expect(exists(...segments)).toBe(false);
    }
  }

  // ----------------------------------------------------------- the migration

  describe('the migration', () => {
    it('THE MIGRATION: an absent mode over a manifest that already owns a skill resolves to `all`, and a full reconcile propagates every skill — assert on files, not the decision object', async () => {
      const store = new ManagedManifestStore();
      // Stands in for a previous, ungated version of Ptah that had already
      // propagated a skill into this workspace, recorded against a REGISTERED
      // target (cursor). No `skillSyncMode` is recorded — this is exactly what
      // a user upgrading into the gate looks like.
      store.save(ws, 'cursor', {
        '.cursor/skills/legacy-skill': managedEntry(
          'seed-hash',
          '/legacy/path',
          'skill',
        ),
      });

      await newReconciler().reconcile(ws, {
        mode: 'full',
        reason: 'first pass after the upgrade',
      });

      expectPropagatedEverywhere('skill-one');
      expectPropagatedEverywhere('skill-two');
      expect(readState()?.skillSyncMode).toBe('all');
    });

    it('an absent mode over manifests owning only command/agent/mcp entries is NOT skill evidence and resolves `selected` with `[]`', async () => {
      const store = new ManagedManifestStore();
      store.save(ws, 'claude', {
        '.claude/commands/some-cmd.md': managedEntry(
          'h1',
          '/src/cmd',
          'command',
        ),
      });
      store.save(ws, 'codex', {
        '.codex/agents/some-agent.toml': managedEntry(
          'h2',
          '/src/agent',
          'agent',
        ),
      });
      store.save(ws, 'cursor', {
        '.cursor/mcp.json#some-server': managedEntry('h3', '', 'mcp'),
      });

      await newReconciler().reconcile(ws, {
        mode: 'full',
        reason: 'no skill evidence anywhere',
      });

      expect(readState()?.skillSyncMode).toBe('selected');
      expect(readState()?.enabledSkillSlugs).toEqual([]);
      expectAbsentEverywhere('skill-one');
      expectAbsentEverywhere('skill-two');
    });

    it('U2: a fresh workspace with no manifests at all resolves `selected` with `[]` and propagates nothing', async () => {
      await newReconciler().reconcile(ws, {
        mode: 'full',
        reason: 'brand new workspace',
      });

      expect(readState()?.skillSyncMode).toBe('selected');
      expect(readState()?.enabledSkillSlugs).toEqual([]);
      expectAbsentEverywhere('skill-one');
      expectAbsentEverywhere('skill-two');
    });

    it('evidence is read for every id in HARNESS_TARGET_IDS, including a target this host did not register', async () => {
      const store = new ManagedManifestStore();
      // `vscode` is a valid HarnessTargetId, but this reconciler registers only
      // claude/codex/copilot/cursor. A CLI host registering fewer targets than
      // the extension must not read this workspace as un-propagated.
      store.save(ws, 'vscode', {
        '.vscode/skills/legacy-skill': managedEntry(
          'seed-hash',
          '/legacy/path',
          'skill',
        ),
      });

      await newReconciler().reconcile(ws, {
        mode: 'full',
        reason: 'evidence lives on an unregistered target',
      });

      expect(readState()?.skillSyncMode).toBe('all');
      expectPropagatedEverywhere('skill-one');
      expectPropagatedEverywhere('skill-two');
    });

    it('the derived decision is persisted, so a second pass does not re-walk and cannot flip after a reap empties the manifests', async () => {
      const store = new ManagedManifestStore();
      store.save(ws, 'vscode', {
        '.vscode/skills/legacy-skill': managedEntry(
          'seed-hash',
          '/legacy/path',
          'skill',
        ),
      });

      await newReconciler().reconcile(ws, {
        mode: 'full',
        reason: 'pass one — derives `all`',
      });
      expect(readState()?.skillSyncMode).toBe('all');

      // Simulate a reap: every manifest this pass could read now owns nothing.
      for (const target of [
        'claude',
        'codex',
        'copilot',
        'cursor',
        'vscode',
      ] as HarnessTargetId[]) {
        store.save(ws, target, {});
      }

      // The evidence walk must not run again: the recorded decision short-
      // circuits it entirely.
      expect(new SkillSyncGate(store).resolve(ws)).toEqual({
        mode: 'all',
        slugs: [],
        derived: false,
      });

      await newReconciler().reconcile(ws, {
        mode: 'full',
        reason:
          'pass two — must not reap on the strength of an emptied manifest',
      });

      expect(readState()?.skillSyncMode).toBe('all');
      expectPropagatedEverywhere('skill-one');
      expectPropagatedEverywhere('skill-two');
    });
  });

  // ------------------------------------------------------ never-overwrite

  describe('the never-overwrite rule', () => {
    it('persist() on a workspace with a recorded mode leaves it unchanged', async () => {
      const store = new ManagedManifestStore();
      new HarnessStateStore().save(ws, {
        version: 1,
        skillSyncMode: 'selected',
        enabledSkillSlugs: ['skill-one'],
      });

      const gate = new SkillSyncGate(store);
      expect(gate.persist(ws, { mode: 'all', slugs: [] })).toBe(true);

      expect(readState()?.skillSyncMode).toBe('selected');
      expect(readState()?.enabledSkillSlugs).toEqual(['skill-one']);
    });

    it('select() DOES overwrite a recorded mode — that is the difference between the migration and the user-driven surface', async () => {
      const store = new ManagedManifestStore();
      new HarnessStateStore().save(ws, { version: 1, skillSyncMode: 'all' });

      const gate = new SkillSyncGate(store);
      expect(gate.select(ws, ['skill-one'])).toBe(true);

      const state = readState();
      expect(state?.skillSyncMode).toBe('selected');
      expect(state?.enabledSkillSlugs).toEqual(['skill-one']);
      expect(typeof state?.skillSelectionAt).toBe('string');
    });
  });

  // -------------------------------------------------------------- verify()

  it('verify() resolves an absent mode without recording anything — asking must not decide', async () => {
    const health = await newReconciler().verify(ws);

    expect(health.targets.some((target) => target.detected)).toBe(true);
    expect(readState()).toBeNull();
  });

  // ---------------------------------------------- the filter is a conjunction

  describe('the filter is a conjunction, outermost first', () => {
    it('a slug in the allowlist AND in disabledSkillIds is NOT propagated', async () => {
      const store = new ManagedManifestStore();
      new SkillSyncGate(store).select(ws, ['skill-one', 'skill-two']);

      await newReconciler({ disabledSkillIds: ['skill-one'] }).reconcile(ws, {
        mode: 'full',
        reason: 'allowlisted but disabled',
      });

      expectAbsentEverywhere('skill-one');
      expectPropagatedEverywhere('skill-two');
    });

    it('a slug in the allowlist whose plugin is disabled is NOT propagated', async () => {
      const store = new ManagedManifestStore();
      // A base-layer clone with a plugin origin, alongside the plain skills.
      const pluginSkill = writeSkill(
        join(sourcesRoot, 'skills'),
        'plugin-skill',
      );
      writeSidecar(pluginSkill, 'ptah-widgets');
      new SkillSyncGate(store).select(ws, ['plugin-skill', 'skill-one']);

      await newReconciler({
        overlayPluginPathsKnown: true,
        overlayPluginPaths: [], // ptah-widgets is not enabled here
      }).reconcile(ws, { mode: 'full', reason: 'allowlisted but plugin off' });

      expect(exists('.claude', 'skills', 'plugin-skill')).toBe(false);
      expect(exists('.agents', 'skills', 'plugin-skill')).toBe(false);
      expect(exists('.github', 'skills', 'plugin-skill')).toBe(false);
      expect(exists('.cursor', 'skills', 'plugin-skill')).toBe(false);
      expectPropagatedEverywhere('skill-one');
    });

    it("under 'selected', an overlay opt-out (harness) plugin skill outside the allowlist is NOT propagated — the selection gates the overlay loop too", async () => {
      const store = new ManagedManifestStore();
      const pluginDir = join(sourcesRoot, 'plugins', 'ptah-harness-widgets');
      writeSkill(join(pluginDir, 'skills'), 'harness-skill');
      new SkillSyncGate(store).select(ws, ['skill-one']);

      await newReconciler({
        overlayPluginPathsKnown: true,
        overlayPluginPaths: [pluginDir],
      }).reconcile(ws, {
        mode: 'full',
        reason: 'opt-out overlay skill outside the allowlist',
      });

      expect(exists('.claude', 'skills', 'harness-skill')).toBe(false);
      expect(exists('.agents', 'skills', 'harness-skill')).toBe(false);
      expect(exists('.github', 'skills', 'harness-skill')).toBe(false);
      expect(exists('.cursor', 'skills', 'harness-skill')).toBe(false);
      expectPropagatedEverywhere('skill-one');
    });

    it("under 'all', behaviour is exactly Batch 1's — the selection level is inert", async () => {
      const store = new ManagedManifestStore();
      const pluginSkill = writeSkill(
        join(sourcesRoot, 'skills'),
        'plugin-skill',
      );
      writeSidecar(pluginSkill, 'ptah-widgets');
      // Recorded, not derived — proves the mode really is `'all'`, not merely
      // the absent-mode default.
      new SkillSyncGate(store).enableAll(ws);

      await newReconciler({
        overlayPluginPathsKnown: true,
        overlayPluginPaths: [join(sourcesRoot, 'plugins', 'ptah-widgets')],
      }).reconcile(ws, { mode: 'full', reason: 'plugin enabled, mode all' });
      expect(exists('.claude', 'skills', 'plugin-skill')).toBe(true);

      // Disable the plugin. `'all'` still means "everything the plugin gate
      // admits" — the selection adds no extra restriction and no extra grant.
      await newReconciler({
        overlayPluginPathsKnown: true,
        overlayPluginPaths: [],
      }).reconcile(ws, { mode: 'full', reason: 'plugin disabled, mode all' });
      expect(exists('.claude', 'skills', 'plugin-skill')).toBe(false);
      expect(readState()?.skillSyncMode).toBe('all');
    });
  });

  // -------------------------------------------------------------- the reap

  describe('the reap', () => {
    it("a workspace at 'all' with propagated copies, switched to 'selected' with a subset, has the excluded copies removed from every target directory while survivors are untouched — and the user-layer clone survives", async () => {
      const store = new ManagedManifestStore();
      const gate = new SkillSyncGate(store);
      gate.enableAll(ws);

      await newReconciler().reconcile(ws, { mode: 'full', reason: 'all' });
      expectPropagatedEverywhere('skill-one');
      expectPropagatedEverywhere('skill-two');

      gate.select(ws, ['skill-one']);
      await newReconciler().reconcile(ws, {
        mode: 'full',
        reason: 'narrowed to skill-one',
      });

      expectPropagatedEverywhere('skill-one');
      expectAbsentEverywhere('skill-two');
      // The user-layer clone is untouched by the reap.
      expect(existsSync(join(sourcesRoot, 'skills', 'skill-two'))).toBe(true);

      // Re-selecting restores the copy with no download — the source clone
      // never left.
      gate.select(ws, ['skill-one', 'skill-two']);
      await newReconciler().reconcile(ws, {
        mode: 'full',
        reason: 're-selected',
      });
      expectPropagatedEverywhere('skill-one');
      expectPropagatedEverywhere('skill-two');
    });
  });

  // --------------------------------------------------- empty-allowlist honesty

  it("'selected' with `[]` is a legitimate state, not an error: zero skills propagated, no throw", async () => {
    const store = new ManagedManifestStore();
    new SkillSyncGate(store).select(ws, []);

    const health = await newReconciler().reconcile(ws, {
      mode: 'full',
      reason: 'deliberately nothing selected',
    });

    expectAbsentEverywhere('skill-one');
    expectAbsentEverywhere('skill-two');
    for (const target of health.targets) {
      expect(target.writeFailed).toEqual([]);
    }
    expect(readState()?.skillSyncMode).toBe('selected');
    expect(readState()?.enabledSkillSlugs).toEqual([]);
  });

  // ------------------------------------------------------- builder pre-gate

  it('a caller with no `skillSync` option at all gets pre-gate behaviour (the builder default is `all`)', async () => {
    const builder = new HarnessManifestBuilder();
    const desired = await builder.build(sourceState(), {});

    expect(desired.skills.map((skill) => skill.slug)).toEqual([
      'skill-one',
      'skill-two',
    ]);
  });
});
