/**
 * The reconciler under the layered capability policy (TASK_2026_560, C3 and
 * P9 G1).
 *
 * Two halves:
 *
 *   1. The GLOBAL layer reaches the workspace copies. The plugin loader's
 *      `getEffectivePluginConfig` puts global items beneath the workspace
 *      config (`workspace ?? global ?? default`); the reader below mirrors that
 *      rule in a few lines, because this lib may not import agent-sdk. Every
 *      case is observed on disk through the real resolver, builder and
 *      `ClaudeTarget`.
 *   2. An UNKNOWN policy freezes the pass: no skill, command or agent write or
 *      removal, MCP still applies, health reads `policy-unknown`.
 *
 * No spec here touches the real home directory: the layout roots are temp dirs
 * and the MCP intent store is pointed at a temp home explicitly.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  CAPABILITY_POLICY_UNKNOWN_ERROR_NAME,
  ORIGIN_SIDECAR_FILENAME,
  type HarnessFacetMatrix,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { HarnessStateStore } from '../gitignore/harness-state-store';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import type { HarnessSourceLayout } from '../sources/harness-source.port';
import { McpIntentStore } from '../sources/mcp-intent-store';
import {
  createPluginConfigSourceResolver,
  createStaticSourceResolver,
  type HarnessEffectivePluginConfig,
  type HarnessPluginConfigReader,
} from '../sources/plugin-config-source-resolver';
import { ClaudeTarget } from '../targets/claude-target';
import type {
  HarnessApplyResult,
  HarnessPlan,
  IHarnessTarget,
} from '../targets/harness-target.port';
import { HarnessReconcilerService } from './harness-reconciler.service';

function makeFakeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

/** A skill directory, with the origin sidecar the mirror writes when `pluginId` is given. */
function writeSkill(skillsRoot: string, slug: string, pluginId?: string): void {
  const dir = join(skillsRoot, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${slug}\n---\nskill body\n`,
    'utf-8',
  );
  if (pluginId === undefined) return;
  writeFileSync(
    join(dir, ORIGIN_SIDECAR_FILENAME),
    JSON.stringify({
      kind: 'skill',
      slug,
      pluginId,
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

/** Structurally what agent-sdk's `CapabilityPolicyUnknownError` looks like. */
function policyUnknownError(): Error {
  const error = new Error("Ptah couldn't read the capability policy");
  error.name = CAPABILITY_POLICY_UNKNOWN_ERROR_NAME;
  return error;
}

interface WorkspaceLayer {
  enabledPluginIds?: string[];
  disabledPluginIds?: string[];
  disabledSkillIds?: string[];
}

interface GlobalItem {
  kind: 'plugin' | 'skill';
  id: string;
  value: 'on' | 'off';
}

/** Opt-out (default ON) plugins: present unless disabled. */
const OPT_OUT_PLUGIN = 'ptah-harness-release';
/** Opt-in (default OFF) plugin: present only when enabled. */
const OPT_IN_PLUGIN = 'ptah-angular';

describe('HarnessReconcilerService — layered capability policy', () => {
  let ws: string;
  let sourcesRoot: string;
  let tempHome: string;
  let store: ManagedManifestStore;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-capability-ws-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-capability-src-'));
    tempHome = mkdtempSync(join(tmpdir(), 'harness-capability-home-'));
    // The skill-selection gate sits outside the policy under test; recorded as
    // `'all'` so the capability policy is the only thing filtering.
    const stateStore = new HarnessStateStore();
    stateStore.save(ws, { ...stateStore.load(ws), skillSyncMode: 'all' });
    store = new ManagedManifestStore();

    for (const id of [OPT_OUT_PLUGIN, OPT_IN_PLUGIN]) {
      mkdirSync(join(sourcesRoot, 'plugins', id), { recursive: true });
    }
    writeSkill(join(sourcesRoot, 'skills'), 'release-notes', OPT_OUT_PLUGIN);
    writeSkill(join(sourcesRoot, 'skills'), 'angular-patterns', OPT_IN_PLUGIN);
    writeSkill(join(sourcesRoot, 'skills'), 'lint-rules');
    writeSkill(join(sourcesRoot, 'skills'), 'my-own-skill');
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

  const pluginPath = (id: string): string => join(sourcesRoot, 'plugins', id);

  /**
   * The loader's layering rule in miniature: a global item applies only to an
   * id the workspace records nothing about, then the overlay is the enabled
   * opt-in plugins plus the opt-out plugins, minus every disabled plugin. The
   * sync members throw, so any mixing-in of the workspace-only path fails.
   */
  function layeredReader(
    workspace: WorkspaceLayer,
    global: GlobalItem[] = [],
  ): HarnessPluginConfigReader {
    const unused = (): never => {
      throw new Error('the effective path must not call a sync member');
    };
    return {
      resolveCurrentPluginPaths: unused,
      getDisabledSkillIds: unused,
      getWorkspacePluginConfig: unused,
      getEffectivePluginConfig:
        async (): Promise<HarnessEffectivePluginConfig> => {
          const enabledPluginIds = [...(workspace.enabledPluginIds ?? [])];
          const disabledPluginIds = [...(workspace.disabledPluginIds ?? [])];
          const disabledSkillIds = [...(workspace.disabledSkillIds ?? [])];
          const recordedPlugins = new Set([
            ...enabledPluginIds,
            ...disabledPluginIds,
          ]);
          const recordedSkills = new Set(disabledSkillIds);
          for (const item of global) {
            if (item.kind === 'plugin' && !recordedPlugins.has(item.id)) {
              (item.value === 'on' ? enabledPluginIds : disabledPluginIds).push(
                item.id,
              );
            } else if (
              item.kind === 'skill' &&
              item.value === 'off' &&
              !recordedSkills.has(item.id)
            ) {
              disabledSkillIds.push(item.id);
            }
          }
          const disabled = new Set(disabledPluginIds);
          const overlayPluginPaths = [
            ...enabledPluginIds.filter((id) => id !== OPT_OUT_PLUGIN),
            OPT_OUT_PLUGIN,
          ]
            .filter((id) => !disabled.has(id))
            .map(pluginPath);
          return {
            config: { disabledSkillIds, disabledPluginIds },
            fingerprint: `fp:${JSON.stringify({ workspace, global })}`,
            overlayPluginPaths,
          };
        },
    };
  }

  function newReconciler(
    readerFactory: () => HarnessPluginConfigReader | null,
  ): HarnessReconcilerService {
    return new HarnessReconcilerService(
      makeFakeLogger(),
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

  const reconcileWith = (reader: HarnessPluginConfigReader) =>
    newReconciler(() => reader).reconcile(ws, {
      mode: 'full',
      reason: 'capability-policy-spec',
    });

  const hasCopy = (slug: string): boolean =>
    existsSync(join(ws, '.claude', 'skills', slug, 'SKILL.md'));

  it('[G1] a global OFF on an opt-out plugin with no workspace entry leaves the overlay and reaps its copies', async () => {
    await reconcileWith(layeredReader({}));
    expect(hasCopy('release-notes')).toBe(true);

    const reader = layeredReader({}, [
      { kind: 'plugin', id: OPT_OUT_PLUGIN, value: 'off' },
    ]);
    const effective = await reader.getEffectivePluginConfig?.(ws);
    expect(effective?.overlayPluginPaths).not.toContain(
      pluginPath(OPT_OUT_PLUGIN),
    );

    await reconcileWith(reader);

    expect(hasCopy('release-notes')).toBe(false);
    expect(hasCopy('my-own-skill')).toBe(true);
  });

  it('[G1] a global OFF skill gets no copy', async () => {
    await reconcileWith(
      layeredReader({}, [{ kind: 'skill', id: 'lint-rules', value: 'off' }]),
    );

    expect(hasCopy('lint-rules')).toBe(false);
    expect(hasCopy('my-own-skill')).toBe(true);
  });

  it('[G1] a global ON on an opt-in plugin gets its copies', async () => {
    await reconcileWith(layeredReader({}));
    expect(hasCopy('angular-patterns')).toBe(false);

    await reconcileWith(
      layeredReader({}, [{ kind: 'plugin', id: OPT_IN_PLUGIN, value: 'on' }]),
    );

    expect(hasCopy('angular-patterns')).toBe(true);
  });

  it('[G1] a workspace entry beats a global one, in both directions', async () => {
    await reconcileWith(
      layeredReader(
        {
          enabledPluginIds: [OPT_IN_PLUGIN],
          disabledPluginIds: [OPT_OUT_PLUGIN],
        },
        [
          { kind: 'plugin', id: OPT_IN_PLUGIN, value: 'off' },
          { kind: 'plugin', id: OPT_OUT_PLUGIN, value: 'on' },
        ],
      ),
    );

    expect(hasCopy('angular-patterns')).toBe(true);
    expect(hasCopy('release-notes')).toBe(false);
  });

  it('[AC-3.3] stamps the fingerprint on reconcile and on verify health', async () => {
    const reader = layeredReader({ enabledPluginIds: [OPT_IN_PLUGIN] });
    const expected = (await reader.getEffectivePluginConfig?.(ws))?.fingerprint;

    const reconciler = newReconciler(() => reader);
    const reconciled = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'capability-policy-spec',
    });
    const verified = await reconciler.verify(ws);

    expect(expected).toBeDefined();
    expect(reconciled.policyFingerprint).toBe(expected);
    expect(verified.policyFingerprint).toBe(expected);
    expect(reconciled.sources).not.toBe('policy-unknown');
  });

  it('[AC-3.4] a frozen pass writes and removes nothing, and a disabled plugin and its copies stay absent', async () => {
    // Known policy: the opt-in plugin is off and one skill is disabled.
    await reconcileWith(layeredReader({ disabledSkillIds: ['lint-rules'] }));
    expect(hasCopy('angular-patterns')).toBe(false);
    expect(hasCopy('lint-rules')).toBe(false);
    expect(hasCopy('my-own-skill')).toBe(true);
    const before = store.load(ws, 'claude').entries;

    // Unknown policy. The resolver can no longer say what is off, so an
    // unfiltered desired state would re-add both — the freeze must not.
    const frozenReader: HarnessPluginConfigReader = {
      ...layeredReader({}),
      getEffectivePluginConfig: () => Promise.reject(policyUnknownError()),
    };
    const health = await reconcileWith(frozenReader);

    expect(health.sources).toBe('policy-unknown');
    expect(health.policyFingerprint).toBeUndefined();
    expect(health.targets.flatMap((target) => target.removed)).toEqual([]);
    expect(health.targets.flatMap((target) => target.writeFailed)).toEqual([]);
    expect(hasCopy('angular-patterns')).toBe(false);
    expect(hasCopy('lint-rules')).toBe(false);
    expect(hasCopy('my-own-skill')).toBe(true);
    expect(hasCopy('release-notes')).toBe(true);
    expect(store.load(ws, 'claude').entries).toEqual(before);

    const verified = await newReconciler(() => frozenReader).verify(ws);
    expect(verified.sources).toBe('policy-unknown');
  });
});

describe('HarnessReconcilerService — the frozen plan', () => {
  let ws: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-capability-frozen-'));
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
  });

  const FACETS: HarnessFacetMatrix = {
    skills: 'supported',
    commands: 'supported',
    agents: 'supported',
    mcp: 'supported',
  };

  /** A target whose plan carries every kind, recording what it is asked to apply. */
  function recordingTarget(applied: HarnessPlan[]): IHarnessTarget {
    const write = (
      kind: HarnessPlan['writes'][number]['kind'],
      relPath: string,
    ) => ({
      relPath,
      kind,
      source: `/src/${relPath}`,
      hash: `h:${relPath}`,
      isDirectory: kind === 'skill',
      reason: 'create' as const,
      overwritesLocalEdit: false,
    });
    const plan: HarnessPlan = {
      target: 'claude',
      writes: [
        write('skill', '.claude/skills/a'),
        write('command', '.claude/commands/b.md'),
        write('agent', '.claude/agents/c.md'),
        write('mcp', '.mcp.json#github'),
      ],
      removals: [
        { relPath: '.claude/skills/old', kind: 'skill', isDirectory: true },
        {
          relPath: '.mcp.json#stale',
          kind: 'mcp',
          isDirectory: false,
          mcpServerKey: 'stale',
        },
      ],
      foreign: [],
      blocked: [],
      collisions: [],
      migrations: [{ kind: 'unlink-junction', path: join(ws, 'junction') }],
      adopted: ['.claude/skills/legacy'],
      baseEntries: {
        '.claude/skills/legacy': {
          hash: 'h:legacy',
          source: '/src/legacy',
          kind: 'skill',
        },
      },
      unchanged: 0,
      expected: 4,
    };
    return {
      id: 'claude',
      facets: FACETS,
      detect: async () => true,
      preflightKeys: () => new Map(),
      plan: async () => plan,
      apply: async (received): Promise<HarnessApplyResult> => {
        applied.push(received);
        return {
          written: {},
          removed: [],
          writeFailed: [],
          overwrittenLocalEdit: [],
        };
      },
      verify: async () => {
        throw new Error('not used');
      },
    };
  }

  function reconcilerOver(
    policyUnknown: boolean,
    applied: HarnessPlan[],
  ): HarnessReconcilerService {
    return new HarnessReconcilerService(
      makeFakeLogger(),
      new HarnessManifestBuilder(),
      new ManagedManifestStore(),
      createStaticSourceResolver({
        layout: {
          skillsRoot: join(ws, 'no-skills'),
          commandsRoot: join(ws, 'no-commands'),
          agentsRoot: join(ws, 'no-agents'),
        },
        overlayPluginPaths: [],
        disabledSkillIds: [],
        disabledPluginIds: [],
        ...(policyUnknown ? { policyUnknown: true } : {}),
      }),
      [recordingTarget(applied)],
    );
  }

  it('[C3] keeps only MCP writes and removals, and no migration or adoption', async () => {
    const applied: HarnessPlan[] = [];

    const health = await reconcilerOver(true, applied).reconcile(ws, {
      mode: 'full',
      reason: 'frozen-plan-spec',
    });

    expect(health.sources).toBe('policy-unknown');
    expect(applied).toHaveLength(1);
    expect(applied[0].writes.map((w) => w.relPath)).toEqual([
      '.mcp.json#github',
    ]);
    expect(applied[0].removals.map((r) => r.relPath)).toEqual([
      '.mcp.json#stale',
    ]);
    expect(applied[0].migrations).toEqual([]);
    expect(applied[0].adopted).toEqual([]);
    expect(applied[0].baseEntries).toEqual({});
  });

  it('[C3] a known policy hands the plan through untouched', async () => {
    const applied: HarnessPlan[] = [];

    await reconcilerOver(false, applied).reconcile(ws, {
      mode: 'full',
      reason: 'known-plan-spec',
    });

    expect(applied[0].writes).toHaveLength(4);
    expect(applied[0].removals).toHaveLength(2);
    expect(applied[0].migrations).toHaveLength(1);
  });
});
