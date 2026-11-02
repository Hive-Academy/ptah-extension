/**
 * HarnessManifestBuilder unit tests — desired-state assembly, collisions and
 * precedence (edge case E20 plus required-coverage items 14/15's slug-level
 * half; the "reaches the target" half of those two lives in the reconciler
 * specs, since it needs a real copy engine).
 *
 * Source-under-test: `HarnessManifestBuilder`.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ORIGIN_SIDECAR_FILENAME,
  type AgentModelLayers,
} from '@ptah-extension/shared';
import {
  desiredAgentModel,
  desiredAgentSourceHash,
  HarnessManifestBuilder,
} from './harness-manifest.builder';
import type { HarnessSourceState } from '../sources/harness-source.port';
import { hashContent, hashDir, hashFile } from '../hash/content-hash';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { WorkspaceHarnessTarget } from '../targets/workspace-target';
import type {
  HarnessAgentSource,
  IHarnessAgentTransformer,
} from '../targets/transformers/agent-transformer.port';

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

function writeAgent(root: string, slug: string): void {
  const agentsRoot = join(root, 'agents');
  mkdirSync(agentsRoot, { recursive: true });
  writeFileSync(
    join(agentsRoot, `${slug}.md`),
    `---\nname: ${slug}\ndescription: the ${slug} agent\n---\ninstructions\n`,
    'utf-8',
  );
}

function emptyLayout(root: string): HarnessSourceState['layout'] {
  return {
    skillsRoot: join(root, 'skills'),
    commandsRoot: join(root, 'commands'),
    agentsRoot: join(root, 'agents'),
  };
}

/** The no-overlay, nothing-disabled source state most cases start from. */
function emptyState(root: string): HarnessSourceState {
  return {
    layout: emptyLayout(root),
    overlayPluginPaths: [],
    disabledSkillIds: [],
    disabledPluginIds: [],
  };
}

describe('HarnessManifestBuilder', () => {
  let root: string;
  let builder: HarnessManifestBuilder;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'harness-sync-builder-'));
    builder = new HarnessManifestBuilder();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('[E20] a slug that only differs by case across two overlay plugins is reported as a case-collision, and the earlier plugin wins the slot', async () => {
    // Two directories differing only by case CANNOT coexist under the same
    // parent on default (case-insensitive) NTFS, so the collision is produced
    // across two DIFFERENT plugin directories instead — a realistic shape,
    // since two independently-authored plugins are exactly how this happens.
    const pluginA = join(root, 'plugins', 'ptah-harness-a');
    const pluginB = join(root, 'plugins', 'ptah-harness-b');
    writeSkill(join(pluginA, 'skills'), 'Run-Tests');
    writeSkill(join(pluginB, 'skills'), 'run-tests');

    const state: HarnessSourceState = {
      layout: emptyLayout(root),
      overlayPluginPaths: [pluginA, pluginB],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };

    const desired = await builder.build(state);

    expect(desired.skills).toHaveLength(1);
    expect(desired.skills[0]?.slug).toBe('Run-Tests');

    const collision = desired.collisions.find(
      (c) => c.reason === 'case-collision',
    );
    expect(collision).toMatchObject({
      slug: 'run-tests',
      reason: 'case-collision',
      shadowedPluginId: 'ptah-harness-b',
    });
  });

  it('[E20] a slug that is a reserved Windows device name (with an extension-like suffix) is rejected and nothing is written for it', async () => {
    // `com1.backup` is creatable on this filesystem (verified empirically) —
    // its STEM is `com1`, which `isReservedSlug` rejects regardless of suffix.
    writeSkill(join(root, 'skills'), 'com1.backup');
    writeSkill(join(root, 'skills'), 'legit-skill');

    const state: HarnessSourceState = {
      layout: emptyLayout(root),
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };

    const desired = await builder.build(state);

    expect(desired.skills.map((s) => s.slug)).toEqual(['legit-skill']);
    expect(desired.collisions).toContainEqual(
      expect.objectContaining({ slug: 'com1.backup', reason: 'reserved-name' }),
    );
  });

  it('[14] a skill in disabledSkillIds never enters the desired state', async () => {
    writeSkill(join(root, 'skills'), 'foo');
    writeSkill(join(root, 'skills'), 'bar');

    const state: HarnessSourceState = {
      layout: emptyLayout(root),
      overlayPluginPaths: [],
      disabledSkillIds: ['bar'],
      disabledPluginIds: [],
    };

    const desired = await builder.build(state);

    expect(desired.skills.map((s) => s.slug)).toEqual(['foo']);
  });

  it('[14] a disabled plugin id contributes no overlay skills at all', async () => {
    const pluginPath = join(root, 'plugins', 'ptah-harness-extra');
    writeSkill(join(pluginPath, 'skills'), 'only-in-plugin');

    const state: HarnessSourceState = {
      layout: emptyLayout(root),
      overlayPluginPaths: [pluginPath],
      disabledSkillIds: [],
      disabledPluginIds: ['ptah-harness-extra'],
    };

    const desired = await builder.build(state);

    expect(desired.skills).toHaveLength(0);
  });

  it('[15] a plugin skill whose slug already exists in the user layer is silently skipped, not reported as a collision (expected mirror case)', async () => {
    writeSkill(join(root, 'skills'), 'shared-skill', 'USER CONTENT');
    const pluginPath = join(root, 'plugins', 'ptah-harness-mirror');
    writeSkill(join(pluginPath, 'skills'), 'shared-skill', 'PLUGIN CONTENT');

    const state: HarnessSourceState = {
      layout: emptyLayout(root),
      overlayPluginPaths: [pluginPath],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };

    const desired = await builder.build(state);

    expect(desired.skills).toHaveLength(1);
    expect(desired.collisions).toHaveLength(0);
    // The user layer wins the claim, so its content hash (not the plugin's) is
    // what the target will end up copying.
    expect(desired.skills[0]?.contentHash).toBe(
      await hashDir(join(root, 'skills', 'shared-skill')),
    );
  });

  it('[286] an agent in disabledAgentIds never enters the desired state, and its siblings still do', async () => {
    writeAgent(root, 'backend-developer');
    writeAgent(root, 'senior-tester');

    const state: HarnessSourceState = {
      ...emptyState(root),
      disabledAgentIds: ['senior-tester'],
    };

    const desired = await builder.build(state);

    expect(desired.agents.map((a) => a.slug)).toEqual(['backend-developer']);
  });

  it('[286] agentSyncEnabled: false empties the agent facet entirely, and leaves skills and commands alone', async () => {
    writeAgent(root, 'backend-developer');
    writeSkill(join(root, 'skills'), 'run-tests');

    const desired = await builder.build(emptyState(root), {
      agentSyncEnabled: false,
    });

    // Empty is a REAP, not a skip — agents are manifest-owned, so the removal
    // sweep deletes whatever a previous pass wrote. That is the point of the
    // gate, and the reason an ABSENT flag must never resolve to a bare false.
    expect(desired.agents).toHaveLength(0);
    expect(desired.skills.map((s) => s.slug)).toEqual(['run-tests']);
  });

  it('[286] an absent agentSyncEnabled option means enabled, so a caller with no opinion never triggers a reap', async () => {
    writeAgent(root, 'backend-developer');

    const desired = await builder.build(emptyState(root));

    expect(desired.agents.map((a) => a.slug)).toEqual(['backend-developer']);
  });

  it('[E2] resolves to sources-missing with zero artifacts when the source roots do not exist', async () => {
    const state: HarnessSourceState = {
      layout: emptyLayout(join(root, 'never-created')),
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };

    const desired = await builder.build(state);

    expect(desired.skills).toHaveLength(0);
    expect(desired.commands).toHaveLength(0);
    expect(desired.sources).toBe('sources-missing');
  });

  it('[E3] resolves to pending-download instead of sources-missing when downloadPending is set', async () => {
    const state: HarnessSourceState = {
      layout: emptyLayout(join(root, 'never-created')),
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };

    const desired = await builder.build(state, { downloadPending: true });

    expect(desired.sources).toBe('pending-download');
  });
});

describe('HarnessManifestBuilder agent models (C6)', () => {
  let root: string;
  let warn: jest.Mock;
  let builder: HarnessManifestBuilder;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'harness-sync-agent-models-'));
    warn = jest.fn();
    builder = new HarnessManifestBuilder(warn);
    writeAgent(root, 'backend-developer');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function buildAgent(agentModels?: AgentModelLayers) {
    const desired = await builder.build({
      ...emptyState(root),
      ...(agentModels === undefined ? {} : { agentModels }),
    });
    expect(desired.agents).toHaveLength(1);
    return desired.agents[0];
  }

  it('[AC4] a Claude-only setting gives a rival agent no models field', async () => {
    const agent = await buildAgent({
      workspace: { 'backend-developer': { claude: 'opus' } },
      machine: { '*': { claude: 'sonnet' } },
    });

    expect('models' in agent).toBe(false);
    for (const target of ['codex', 'copilot', 'cursor', 'opencode'] as const) {
      expect(desiredAgentModel(agent, target)).toBeUndefined();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('[AC8] without models the agent and every target source hash are unchanged', async () => {
    const sourceFile = join(root, 'agents', 'backend-developer.md');
    const fileHash = await hashFile(sourceFile);
    const withoutLayers = await buildAgent();
    const withEmptyLayers = await buildAgent({ workspace: {}, machine: null });

    expect(withoutLayers).toEqual({
      slug: 'backend-developer',
      sourceFile,
      contentHash: fileHash,
    });
    expect(withEmptyLayers).toEqual(withoutLayers);
    for (const target of ['codex', 'copilot', 'cursor', 'opencode'] as const) {
      expect(desiredAgentSourceHash(withoutLayers, target)).toBe(fileHash);
    }
  });

  it('a present model changes only that target source hash', async () => {
    const agent = await buildAgent({
      workspace: { 'backend-developer': { codex: 'gpt-5-codex' } },
    });

    expect(agent.models).toEqual({ codex: 'gpt-5-codex' });
    expect(agent.contentHash).toBe(
      await hashFile(join(root, 'agents', 'backend-developer.md')),
    );
    expect(desiredAgentSourceHash(agent, 'codex')).not.toBe(agent.contentHash);
    expect(desiredAgentSourceHash(agent, 'cursor')).toBe(agent.contentHash);

    const other = await buildAgent({
      workspace: { 'backend-developer': { codex: 'gpt-5' } },
    });
    expect(desiredAgentSourceHash(other, 'codex')).not.toBe(
      desiredAgentSourceHash(agent, 'codex'),
    );
  });

  it('skips a non-emittable value with a warning and keeps the others', async () => {
    const agent = await buildAgent({
      workspace: {
        'backend-developer': {
          opencode: 'no-provider-prefix',
          copilot: 'gpt\n5',
          cursor: 'sonnet-4',
        },
      },
    });

    expect(agent.models).toEqual({ cursor: 'sonnet-4' });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('not emittable'),
      expect.objectContaining({
        slug: 'backend-developer',
        provider: 'opencode',
      }),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('not emittable'),
      expect.objectContaining({
        slug: 'backend-developer',
        provider: 'copilot',
      }),
    );
  });

  it('the workspace layer beats the machine layer, per provider', async () => {
    const agent = await buildAgent({
      workspace: {
        'backend-developer': { codex: 'ws-codex' },
        '*': { opencode: 'anthropic/ws-wildcard' },
      },
      machine: {
        'backend-developer': { codex: 'machine-codex', opencode: 'x/machine' },
        '*': { cursor: 'machine-cursor' },
      },
    });

    expect(agent.models).toEqual({
      codex: 'ws-codex',
      opencode: 'anthropic/ws-wildcard',
      cursor: 'machine-cursor',
    });
  });

  it('a target writes the bytes it planned, model included', async () => {
    const workspace = join(root, 'ws');
    mkdirSync(workspace, { recursive: true });
    const seen: HarnessAgentSource[] = [];
    const transformer: IHarnessAgentTransformer = {
      target: 'codex',
      dirRel: '.codex/agents',
      relPathFor: (agentId) => `.codex/agents/${agentId}.toml`,
      transform: (source) => {
        seen.push(source);
        return `id = "${source.agentId}"\nmodel = "${source.model ?? ''}"\n`;
      },
      isPtahOutput: () => false,
    };
    const manifestStore = new ManagedManifestStore();
    const target = new WorkspaceHarnessTarget({
      id: 'codex',
      facets: {
        skills: 'unsupported',
        commands: 'unsupported',
        agents: 'supported',
        mcp: 'unsupported',
      },
      manifestStore,
      detector: { isInstalled: () => Promise.resolve(true) },
      agentTransformer: transformer,
    });
    const desired = await builder.build({
      ...emptyState(root),
      agentModels: { workspace: { '*': { codex: 'gpt-5-codex' } } },
    });

    const plan = await target.plan(
      desired,
      workspace,
      manifestStore.load(workspace, 'codex'),
    );
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0].sourceHash).toBe(
      desiredAgentSourceHash(desired.agents[0], 'codex'),
    );

    const result = await target.apply(plan, workspace);
    const relPath = '.codex/agents/backend-developer.toml';
    const written = readFileSync(join(workspace, relPath), 'utf-8');

    expect(written).toContain('model = "gpt-5-codex"');
    expect(hashContent(written)).toBe(plan.writes[0].hash);
    expect(result.written[relPath]?.hash).toBe(plan.writes[0].hash);
    expect(seen.every((source) => source.model === 'gpt-5-codex')).toBe(true);
  });
});

describe('HarnessManifestBuilder retirement and workspace skills.sh roots (TASK_2026_853 D-2/D-3)', () => {
  let root: string;
  let builder: HarnessManifestBuilder;

  /** A user-layer clone with a sidecar naming its source. */
  function writeClone(slug: string, sourceRef?: string, pluginId?: string) {
    const dir = join(root, 'skills', slug);
    writeSkill(join(root, 'skills'), slug);
    writeFileSync(
      join(dir, ORIGIN_SIDECAR_FILENAME),
      JSON.stringify({
        kind: 'skill',
        slug,
        pluginId: pluginId ?? null,
        version: null,
        sourceHash: 'h',
        clonedAt: 1,
        diverged: false,
        lastEnhancedAt: null,
        historyDir: '',
        ...(sourceRef === undefined ? {} : { sourceRef }),
      }),
      'utf-8',
    );
  }

  /** A plugin directory with one skill, under `parent`. */
  function writePlugin(parent: string, pluginId: string, slug: string): string {
    const dir = join(parent, pluginId);
    writeSkill(join(dir, 'skills'), slug);
    return dir;
  }

  const slugs = (skills: { slug: string }[]): string[] =>
    skills.map((s) => s.slug);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'harness-sync-builder-retired-'));
    builder = new HarnessManifestBuilder();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('[D-2] a clone whose sourceRef names a retired skills.sh root is inactive under absent, all and an explicit selection of its slug; other refs stay', async () => {
    const globalPlugins = join(root, 'home', '.ptah', 'plugins');
    const retiredRoot = join(globalPlugins, 'ptah-skillssh-anthropics-skills');
    writeClone('retired-skill', 'skills-sh:ptah-skillssh-anthropics-skills');
    writeClone('live-skillssh', 'skills-sh:ptah-skillssh-acme-tools');
    writeClone('bundled', 'ptah:ptah-core', 'ptah-core');
    writeClone('no-ref');
    writeSkill(join(root, 'skills'), 'hand-authored');
    const state: HarnessSourceState = {
      ...emptyState(root),
      retired: { skillSourceRoots: [retiredRoot], mcpServerKeys: [] },
    };
    const kept = ['bundled', 'hand-authored', 'live-skillssh', 'no-ref'];

    expect(slugs((await builder.build(state)).skills)).toEqual(kept);
    expect(
      slugs(
        (await builder.build(state, { skillSync: { mode: 'all', slugs: [] } }))
          .skills,
      ),
    ).toEqual(kept);
    const selected = await builder.build(state, {
      skillSync: { mode: 'selected', slugs: ['retired-skill', 'no-ref'] },
    });
    expect(slugs(selected.skills)).toEqual(['no-ref']);
    expect(
      (await builder.build(state)).skills.map((s) => s.sourceDir),
    ).not.toContain(join(root, 'skills', 'retired-skill'));
  });

  it('[D-2] a retired or disabled clone left out by the selection does not make missing sources read as ok', async () => {
    const retiredRoot = join(
      root,
      'home',
      '.ptah',
      'plugins',
      'ptah-skillssh-anthropics-skills',
    );
    writeClone('retired-skill', 'skills-sh:ptah-skillssh-anthropics-skills');
    writeClone('disabled-skill');
    const state: HarnessSourceState = {
      ...emptyState(root),
      disabledSkillIds: ['disabled-skill'],
      retired: { skillSourceRoots: [retiredRoot], mcpServerKeys: [] },
    };

    const desired = await builder.build(state, {
      skillSync: { mode: 'selected', slugs: [] },
    });

    expect(desired.skills).toHaveLength(0);
    expect(desired.sources).toBe('sources-missing');
  });

  it('[D-2] absent or empty retired sources retire nothing, and a prefix-only or malformed sidecar fails open (decision #56)', async () => {
    writeClone('was-retired', 'skills-sh:ptah-skillssh-anthropics-skills');
    writeClone('prefix-only', 'skills-sh:');
    writeSkill(join(root, 'skills'), 'broken-sidecar');
    writeFileSync(
      join(root, 'skills', 'broken-sidecar', ORIGIN_SIDECAR_FILENAME),
      '{not json',
      'utf-8',
    );
    const all = ['broken-sidecar', 'prefix-only', 'was-retired'];

    expect(slugs((await builder.build(emptyState(root))).skills)).toEqual(all);
    expect(
      slugs(
        (
          await builder.build({
            ...emptyState(root),
            retired: { skillSourceRoots: [], mcpServerKeys: [] },
          })
        ).skills,
      ),
    ).toEqual(all);
    // A retired root with a DIFFERENT id leaves both clones alone, and the
    // empty id after the prefix never matches.
    expect(
      slugs(
        (
          await builder.build({
            ...emptyState(root),
            retired: {
              skillSourceRoots: [join(root, 'plugins', 'ptah-skillssh-other')],
              mcpServerKeys: [],
            },
          })
        ).skills,
      ),
    ).toEqual(all);
  });

  it('[D-2] an overlay path that IS a retired root contributes no skills or commands; a live global skills.sh root still does', async () => {
    const globalPlugins = join(root, 'home', '.ptah', 'plugins');
    const retiredRoot = writePlugin(
      globalPlugins,
      'ptah-skillssh-anthropics-skills',
      'pdf',
    );
    mkdirSync(join(retiredRoot, 'commands'), { recursive: true });
    writeFileSync(join(retiredRoot, 'commands', 'old.md'), '# old\n', 'utf-8');
    const liveRoot = writePlugin(globalPlugins, 'ptah-skillssh-acme', 'lint');

    const desired = await builder.build({
      ...emptyState(root),
      overlayPluginPaths: [retiredRoot, liveRoot],
      // A trailing separator must not defeat the directory match.
      retired: { skillSourceRoots: [`${retiredRoot}/`], mcpServerKeys: [] },
    });

    expect(desired.skills.map((s) => [s.slug, s.sourceDir])).toEqual([
      ['lint', join(liveRoot, 'skills', 'lint')],
    ]);
    expect(desired.commands).toHaveLength(0);
  });

  describe('[D-D4] workspace skills.sh roots bypass the selection', () => {
    let wsA: string;
    let wsB: string;
    let state: HarnessSourceState;
    const empty = { mode: 'selected' as const, slugs: [] as string[] };

    beforeEach(() => {
      wsA = join(root, 'ws-a');
      wsB = join(root, 'ws-b');
      const globalPlugins = join(root, 'home', '.ptah', 'plugins');
      // Both workspaces' roots are on the overlay at once, which no correct
      // resolver produces: it proves the exemption is keyed by the workspace
      // being BUILT, not by mere presence on the overlay.
      state = {
        ...emptyState(root),
        overlayPluginPaths: [
          writePlugin(
            join(wsA, '.ptah', 'plugins'),
            'ptah-skillssh-a-tools',
            'a-skill',
          ),
          writePlugin(
            join(wsB, '.ptah', 'plugins'),
            'ptah-skillssh-b-tools',
            'b-skill',
          ),
          writePlugin(globalPlugins, 'ptah-skillssh-global', 'global-skill'),
          writePlugin(globalPlugins, 'ptah-harness-mine', 'harness-skill'),
          writePlugin(join(root, 'bundled'), 'ptah-core', 'bundled-skill'),
          writePlugin(
            join(wsA, '.ptah', 'plugins'),
            'ptah-harness-local',
            'a-harness-skill',
          ),
        ],
      };
    });

    it("an empty selection in workspace A keeps only A's skills.sh skills, sourced from A; B gets only B's", async () => {
      const a = await builder.build(state, {
        skillSync: empty,
        workspaceRoot: wsA,
      });
      expect(a.skills.map((s) => [s.slug, s.sourceDir])).toEqual([
        [
          'a-skill',
          join(
            wsA,
            '.ptah',
            'plugins',
            'ptah-skillssh-a-tools',
            'skills',
            'a-skill',
          ),
        ],
      ]);

      const b = await builder.build(state, {
        skillSync: empty,
        workspaceRoot: `${wsB}/`,
      });
      expect(b.skills.map((s) => [s.slug, s.sourceDir])).toEqual([
        [
          'b-skill',
          join(
            wsB,
            '.ptah',
            'plugins',
            'ptah-skillssh-b-tools',
            'skills',
            'b-skill',
          ),
        ],
      ]);
    });

    it('other overlays stay subject to the selection: a selected slug is admitted, an unselected one is not, whatever its workspace', async () => {
      const desired = await builder.build(state, {
        skillSync: {
          mode: 'selected',
          slugs: ['global-skill', 'bundled-skill'],
        },
        workspaceRoot: wsA,
      });
      expect(slugs(desired.skills)).toEqual([
        'a-skill',
        'bundled-skill',
        'global-skill',
      ]);
      expect(slugs(desired.skills)).not.toContain('a-harness-skill');
      expect(slugs(desired.skills)).not.toContain('harness-skill');
      expect(slugs(desired.skills)).not.toContain('b-skill');
    });

    it('without a workspaceRoot nothing is exempt', async () => {
      const desired = await builder.build(state, { skillSync: empty });
      expect(desired.skills).toHaveLength(0);
    });

    it('a skill moved to a global root and excluded by the selection is not "sources not installed yet"', async () => {
      // After Make global: the slug left the (exempt) workspace root for a
      // global root, which the empty selection excludes.
      const globalPlugins = join(root, 'home', '.ptah', 'plugins');
      const moved: HarnessSourceState = {
        ...emptyState(join(root, 'empty-layer')),
        overlayPluginPaths: [
          writePlugin(globalPlugins, 'ptah-skillssh-moved', 'moved-skill'),
        ],
      };

      const desired = await builder.build(moved, {
        skillSync: empty,
        workspaceRoot: wsA,
      });

      expect(desired.skills).toHaveLength(0);
      expect(desired.sources).toBe('ok');

      const selected = await builder.build(moved, {
        skillSync: { mode: 'selected', slugs: ['moved-skill'] },
        workspaceRoot: wsA,
      });
      expect(slugs(selected.skills)).toEqual(['moved-skill']);
      expect(selected.sources).toBe('ok');
    });

    it('an empty selection over an empty user layer is still sources-missing', async () => {
      const desired = await builder.build(
        { ...emptyState(join(root, 'empty-layer')), overlayPluginPaths: [] },
        { skillSync: empty, workspaceRoot: wsA },
      );
      expect(desired.sources).toBe('sources-missing');
    });

    it('the exempt root still honours disabledSkillIds and disabledPluginIds', async () => {
      const disabledSkill = await builder.build(
        { ...state, disabledSkillIds: ['a-skill'] },
        { skillSync: empty, workspaceRoot: wsA },
      );
      expect(disabledSkill.skills).toHaveLength(0);

      const disabledPlugin = await builder.build(
        { ...state, disabledPluginIds: ['ptah-skillssh-a-tools'] },
        { skillSync: empty, workspaceRoot: wsA },
      );
      expect(disabledPlugin.skills).toHaveLength(0);
    });

    it('a bundled plugin outside the enabled overlay keeps its user-layer clone gated per workspace', async () => {
      writeClone('bundled-clone', 'ptah:ptah-other', 'ptah-other');
      const desired = await builder.build(
        { ...state, overlayPluginPathsKnown: true },
        { workspaceRoot: wsA },
      );
      expect(slugs(desired.skills)).not.toContain('bundled-clone');
      expect(slugs(desired.skills)).toContain('a-skill');
    });
  });
});
