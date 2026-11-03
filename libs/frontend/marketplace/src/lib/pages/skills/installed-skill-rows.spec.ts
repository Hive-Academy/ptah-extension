/**
 * installed-skill-rows specs — the pure view model behind the installed skills
 * page and its detail route (plan C9). Row identity, group state isolation,
 * search, and ref lookup (including an external id with `/` and `:`).
 * Install scope (design-spec §2): community rows carry their scope, plugins
 * none, and the "Make global" feedback names the whole converted root.
 */

import {
  provenanceLabel,
  type CloneSummary,
  type ExternalPluginListing,
  type InstalledSkill,
  type PluginInfo,
} from '@ptah-extension/shared';
import type {
  InventoryConversionOutcome,
  InventorySlice,
} from '../../data/marketplace-inventory.store';
import { decodeSkillRef, encodeSkillRef } from '../../data/skill-ref';
import {
  INSTALL_SCOPE_BADGE_LABELS,
  SKILL_KIND_ICONS,
  communityRow,
  plural,
  filterInstalledSkillGroups,
  findInstalledSkill,
  installedSkillGroups,
  marketplaceRow,
  orphanedCopyNames,
  pluginContents,
  pluginRow,
  pluginSourceLabel,
  shadowedAgentNames,
  skillConversionNotice,
  type InstalledSkillSlices,
} from './installed-skill-rows';

function plugin(overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    id: 'ptah-core',
    name: 'Ptah Core',
    description: 'Core orchestration skills.',
    category: 'core-tools',
    skillCount: 3,
    commandCount: 1,
    isDefault: true,
    keywords: [],
    ...overrides,
  };
}

function skill(overrides: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    name: 'deep-research',
    description: 'Research a topic in depth.',
    source: 'owner/skills',
    path: '/root/skills/deep-research',
    scope: 'global',
    agents: [],
    ...overrides,
  };
}

const EXTERNAL_ID = 'external:acme/tools/lint-kit';

function listing(
  overrides: Partial<ExternalPluginListing> = {},
): ExternalPluginListing {
  return {
    id: EXTERNAL_ID,
    name: 'lint-kit',
    description: 'Linting commands.',
    source: 'acme/tools',
    path: 'plugins/lint-kit',
    installed: true,
    installedVersion: '1.2.0',
    version: '1.3.0',
    ...overrides,
  };
}

function ready<T>(data: readonly T[]): InventorySlice<T> {
  return { state: 'ready', data };
}

function slices(
  overrides: Partial<InstalledSkillSlices> = {},
): InstalledSkillSlices {
  return {
    plugins: ready([plugin()]),
    community: ready([skill()]),
    marketplaces: ready([listing()]),
    ...overrides,
  };
}

describe('installed-skill-rows', () => {
  describe('rows', () => {
    it('maps a Ptah plugin to a Manage row with its counts', () => {
      const row = pluginRow(plugin({ skillCount: 1, commandCount: 2 }));

      expect(row).toEqual({
        ref: 'ptah-plugin:ptah-core',
        kind: 'ptah-plugin',
        id: 'ptah-core',
        name: 'Ptah Core',
        description: 'Core orchestration skills.',
        source: 'Ptah',
        version: null,
        detail: '1 skill · 2 commands',
        action: 'manage',
        provenance: {
          kind: 'plugin',
          pluginId: 'ptah-core',
          name: 'Ptah Core',
          state: 'active',
        },
        contents: {
          summary: '1 skill · 2 commands',
          skills: [],
          commands: [],
          agents: [],
        },
        shadowedAgents: [],
        scope: null,
      });
    });

    it('pluralises counts and has an icon for every kind', () => {
      expect(plural(1, 'skill', 'skills')).toBe('1 skill');
      expect(plural(0, 'skill', 'skills')).toBe('0 skills');
      expect(Object.keys(SKILL_KIND_ICONS).sort()).toEqual([
        'community-skill',
        'marketplace-plugin',
        'ptah-plugin',
      ]);
    });

    it('labels every plugin source and treats a missing one as bundled', () => {
      expect(pluginSourceLabel(undefined)).toBe('Ptah');
      expect(pluginSourceLabel('bundled')).toBe('Ptah');
      expect(pluginSourceLabel('harness')).toBe('Your harness');
      expect(pluginSourceLabel('external')).toBe('External marketplace');
      expect(pluginSourceLabel('skillssh')).toBe('skills.sh');
    });

    it('keys a community skill by name, the id its removal uses', () => {
      const row = communityRow(skill({ description: '   ' }));

      expect(row.ref).toBe('community-skill:deep-research');
      expect(row.id).toBe('deep-research');
      expect(row.description).toBeNull();
      expect(row.action).toBe('uninstall');
    });

    it('falls back to "local" when a community skill has no source', () => {
      expect(communityRow(skill({ source: '' })).source).toBe('local');
    });

    it('prefers the installed version of a marketplace plugin', () => {
      expect(marketplaceRow(listing()).version).toBe('1.2.0');
      expect(
        marketplaceRow(listing({ installedVersion: undefined })).version,
      ).toBe('1.3.0');
      expect(
        marketplaceRow(
          listing({ installedVersion: undefined, version: undefined }),
        ).version,
      ).toBeNull();
    });

    it('builds a marketplace ref that round-trips an id with / and :', () => {
      const row = marketplaceRow(listing());

      expect(row.ref).toBe(`marketplace-plugin:${EXTERNAL_ID}`);
      expect(decodeSkillRef(row.ref)).toEqual({
        kind: 'marketplace-plugin',
        id: EXTERNAL_ID,
      });
    });
  });

  describe('contents, provenance and agent shadow state', () => {
    const named = plugin({
      id: 'ptah-release-kit',
      name: 'Ptah Release Kit',
      skillCount: 2,
      commandCount: 1,
      agentCount: 1,
      skillNames: ['release-notes', 'changelog'],
      commandNames: ['release'],
      agentNames: ['release-manager'],
    });

    const agentClone = (
      slug: string,
      provenance?: CloneSummary['provenance'],
    ): CloneSummary => ({
      slug,
      kind: 'agent',
      cloneStatus: 'clone',
      diverged: false,
      invocationCount: 0,
      successRate: null,
      lastEnhancedAt: null,
      historyCount: 0,
      pendingSourceHash: null,
      enhanceMinInvocations: 3,
      enhanceCooldownUntil: null,
      ...(provenance === undefined ? {} : { provenance }),
    });

    it('says "N skills · M commands · K agents" and keeps the names', () => {
      const row = pluginRow(named);

      expect(row.detail).toBe('2 skills · 1 command · 1 agent');
      expect(row.contents).toEqual({
        summary: '2 skills · 1 command · 1 agent',
        skills: ['release-notes', 'changelog'],
        commands: ['release'],
        agents: ['release-manager'],
      });
    });

    it('counts agents from their names when the host sent no agent count', () => {
      expect(pluginContents(plugin({ agentNames: ['a', 'b'] })).summary).toBe(
        '3 skills · 1 command · 2 agents',
      );
    });

    it('labels the provenance of every kind with the shared label function', () => {
      expect(provenanceLabel(pluginRow(named).provenance)).toBe(
        'Plugin: Ptah Release Kit',
      );
      expect(
        provenanceLabel(
          communityRow(skill({ source: 'acme/skills' })).provenance,
        ),
      ).toBe('skills.sh: acme/skills');
      expect(
        provenanceLabel(communityRow(skill({ source: 'local' })).provenance),
      ).toBe('Workspace file');
      expect(provenanceLabel(marketplaceRow(listing()).provenance)).toBe(
        'Plugin: lint-kit',
      );
    });

    it('marks an agent shadowed by a Library copy with another origin (F7f)', () => {
      const row = pluginRow(named, [
        agentClone('release-manager', { kind: 'setup-wizard' }),
      ]);

      expect(row.shadowedAgents).toEqual(['release-manager']);
    });

    it('does not mark the plugin’s own copy, another kind, or an unknown origin', () => {
      const own = agentClone('release-manager', {
        kind: 'plugin',
        pluginId: 'ptah-release-kit',
        name: 'Ptah Release Kit',
        state: 'active',
      });
      const skillCopy: CloneSummary = {
        ...agentClone('release-manager', { kind: 'workspace' }),
        kind: 'skill',
      };
      const unknown = agentClone('release-manager');

      expect(
        shadowedAgentNames(
          'ptah-release-kit',
          ['release-manager'],
          [own, skillCopy, unknown],
        ),
      ).toEqual([]);
    });

    it('joins a marketplace plugin with its catalogue entry for contents', () => {
      const groups = installedSkillGroups(
        slices({
          plugins: ready([
            plugin({
              id: EXTERNAL_ID,
              name: 'lint-kit',
              agentNames: ['linter'],
            }),
          ]),
          libraryClones: [agentClone('linter', { kind: 'workspace' })],
        }),
      );

      expect(groups[2].rows[0].detail).toBe('3 skills · 1 command · 1 agent');
      expect(groups[2].rows[0].shadowedAgents).toEqual(['linter']);
    });

    it('names Library copies whose plugin is no longer installed', () => {
      expect(
        orphanedCopyNames([
          agentClone('legacy-linter', {
            kind: 'plugin',
            pluginId: 'former-helper',
            name: 'Former Helper',
            state: 'uninstalled',
          }),
          agentClone('helper-agent', {
            kind: 'plugin',
            pluginId: 'old-helper',
            name: 'Old Helper',
            state: 'turned-off',
          }),
        ]),
      ).toEqual(['legacy-linter (plugin "Former Helper")']);
    });
  });

  describe('groups', () => {
    it('returns the three groups in display order with their browse sources', () => {
      const groups = installedSkillGroups(slices());

      expect(groups.map((g) => g.id)).toEqual([
        'plugins',
        'community',
        'marketplaces',
      ]);
      expect(groups.map((g) => g.browse.source)).toEqual([
        'ptah-plugins',
        'community',
        'marketplaces',
      ]);
      expect(groups.map((g) => g.total)).toEqual([1, 1, 1]);
    });

    it('keeps each group state independent', () => {
      const groups = installedSkillGroups(
        slices({
          community: { state: 'error', data: [], error: 'skills.sh down' },
          marketplaces: { state: 'loading', data: [] },
        }),
      );

      expect(groups[0].state).toBe('ready');
      expect(groups[0].rows).toHaveLength(1);
      expect(groups[1]).toMatchObject({
        state: 'error',
        error: 'skills.sh down',
        rows: [],
      });
      expect(groups[2]).toMatchObject({ state: 'loading', error: null });
    });

    it('exposes an inline removal failure without dropping rows', () => {
      const groups = installedSkillGroups(
        slices({
          community: {
            state: 'ready',
            data: [skill()],
            actionError: 'Could not uninstall "deep-research".',
          },
        }),
      );

      expect(groups[1].actionError).toBe(
        'Could not uninstall "deep-research".',
      );
      expect(groups[1].rows).toHaveLength(1);
    });

    it('ignores a stale error text outside the error state', () => {
      const groups = installedSkillGroups(
        slices({ plugins: { state: 'ready', data: [], error: 'old' } }),
      );

      expect(groups[0].error).toBeNull();
    });
  });

  describe('search', () => {
    const groups = installedSkillGroups(
      slices({
        community: ready([
          skill(),
          skill({ name: 'pdf-tools', description: 'Read PDFs', source: 'x/y' }),
        ]),
      }),
    );

    it('keeps every row for a blank query', () => {
      expect(filterInstalledSkillGroups(groups, '   ')).toBe(groups);
    });

    it('matches name, description and source, case-insensitively, every word', () => {
      const byDescription = filterInstalledSkillGroups(groups, 'READ pdfs');
      expect(byDescription[1].rows.map((r) => r.name)).toEqual(['pdf-tools']);
      expect(byDescription[0].rows).toEqual([]);

      const bySource = filterInstalledSkillGroups(groups, 'acme');
      expect(bySource[2].rows.map((r) => r.name)).toEqual(['lint-kit']);
    });

    it('matches when every word appears across name, description, source or kind (R1-1)', () => {
      const withAcme = installedSkillGroups(
        slices({
          community: ready([
            skill({ name: 'tailwind-v4', source: 'acme/skills' }),
            skill(),
          ]),
        }),
      );

      // `acme/skills` is a source: it finds the community skill only.
      const bySource = filterInstalledSkillGroups(withAcme, 'acme/skills');
      expect(bySource[1].rows.map((r) => r.name)).toEqual(['tailwind-v4']);
      expect(bySource[2].rows).toEqual([]);

      // Kind plus name, in either order, across two fields.
      const byKind = filterInstalledSkillGroups(withAcme, 'lint marketplace');
      expect(byKind.map((g) => g.rows.map((r) => r.name))).toEqual([
        [],
        [],
        ['lint-kit'],
      ]);

      // One word missing from all four fields drops the row.
      expect(
        filterInstalledSkillGroups(withAcme, 'marketplace tailwind')[2].rows,
      ).toEqual([]);
    });

    it('keeps the unfiltered total so "no match" differs from "none"', () => {
      const filtered = filterInstalledSkillGroups(groups, 'nothing-matches');

      expect(filtered.map((g) => g.rows.length)).toEqual([0, 0, 0]);
      expect(filtered.map((g) => g.total)).toEqual([1, 2, 1]);
    });
  });

  describe('findInstalledSkill', () => {
    it('resolves each kind to its raw record', () => {
      const all = slices();

      expect(
        findInstalledSkill({ kind: 'ptah-plugin', id: 'ptah-core' }, all),
      ).toMatchObject({ kind: 'ptah-plugin', plugin: { id: 'ptah-core' } });
      expect(
        findInstalledSkill(
          { kind: 'community-skill', id: 'deep-research' },
          all,
        ),
      ).toMatchObject({
        kind: 'community-skill',
        skill: { name: 'deep-research' },
      });
      const decoded = decodeSkillRef(
        encodeSkillRef({ kind: 'marketplace-plugin', id: EXTERNAL_ID }),
      );
      expect(decoded).not.toBeNull();
      expect(decoded && findInstalledSkill(decoded, all)).toMatchObject({
        kind: 'marketplace-plugin',
        listing: { id: EXTERNAL_ID },
      });
    });

    it('returns null when the slice does not hold the id', () => {
      expect(
        findInstalledSkill({ kind: 'community-skill', id: 'gone' }, slices()),
      ).toBeNull();
      expect(
        findInstalledSkill(
          { kind: 'ptah-plugin', id: 'ptah-core' },
          slices({ plugins: { state: 'loading', data: [] } }),
        ),
      ).toBeNull();
    });

    it('never crosses kinds: a plugin id is not a community skill', () => {
      expect(
        findInstalledSkill(
          { kind: 'community-skill', id: 'ptah-core' },
          slices(),
        ),
      ).toBeNull();
    });
  });

  describe('install scope', () => {
    it('carries a community skill scope and gives plugins none', () => {
      expect(communityRow(skill({ scope: 'workspace' })).scope).toBe(
        'workspace',
      );
      expect(communityRow(skill({ scope: 'global' })).scope).toBe('global');
      expect(pluginRow(plugin()).scope).toBeNull();
      expect(marketplaceRow(listing()).scope).toBeNull();
      expect(INSTALL_SCOPE_BADGE_LABELS).toEqual({
        workspace: 'This workspace',
        global: 'All workspaces',
      });
    });

    it('keeps workspace and global skills in the one community group, in host order', () => {
      const groups = installedSkillGroups(
        slices({
          community: ready([
            skill({ name: 'nx-workspace', scope: 'workspace' }),
            skill({ name: 'deep-research', scope: 'global' }),
            skill({ name: 'jest-runner', scope: 'workspace' }),
          ]),
        }),
      );
      const community = groups.find((group) => group.id === 'community');

      expect(groups.map((group) => group.id)).toEqual([
        'plugins',
        'community',
        'marketplaces',
      ]);
      expect(community?.rows.map((row) => [row.name, row.scope])).toEqual([
        ['nx-workspace', 'workspace'],
        ['deep-research', 'global'],
        ['jest-runner', 'workspace'],
      ]);
      expect(community?.total).toBe(3);
      expect(
        groups
          .filter((group) => group.id !== 'community')
          .flatMap((group) => group.rows.map((row) => row.scope)),
      ).toEqual([null, null]);
    });

    const row = communityRow(
      skill({ name: 'nx-workspace', scope: 'workspace' }),
    );

    const converted = (
      convertedSkills: readonly string[],
    ): InventoryConversionOutcome => ({
      status: 'converted',
      message: 'nx-workspace is now available in all workspaces.',
      convertedSkills,
      failedTargets: [],
    });

    it('confirms a one-skill conversion with the fixed copy', () => {
      expect(skillConversionNotice(row, converted(['nx-workspace']))).toEqual({
        ref: row.ref,
        role: 'status',
        text: 'nx-workspace is now available in all workspaces.',
      });
    });

    it('names every other skill of the converted root (whole-root move)', () => {
      expect(
        skillConversionNotice(
          row,
          converted(['nx-workspace', 'nx-generators', 'nx-migrate']),
        ).text,
      ).toBe(
        'nx-workspace is now available in all workspaces. It was installed together with nx-generators, nx-migrate, which are now available in all workspaces too.',
      );
      expect(
        skillConversionNotice(row, converted(['nx-generators', 'nx-workspace']))
          .text,
      ).toBe(
        'nx-workspace is now available in all workspaces. It was installed together with nx-generators, which is now available in all workspaces too.',
      );
    });

    it('shows a failed conversion as an alert with the fixed copy only', () => {
      expect(
        skillConversionNotice(row, {
          status: 'failed',
          message: 'Could not change where nx-workspace is installed.',
        }),
      ).toEqual({
        ref: row.ref,
        role: 'alert',
        text: 'Could not change where nx-workspace is installed.',
      });
    });

    it('shows a refused conversion as an alert', () => {
      const notice = skillConversionNotice(row, {
        status: 'refused',
        reason: 'in-progress',
        message: '"nx-workspace" is already being changed.',
      });
      expect(notice.role).toBe('alert');
      expect(notice.text).toBe('"nx-workspace" is already being changed.');
    });
  });
});
