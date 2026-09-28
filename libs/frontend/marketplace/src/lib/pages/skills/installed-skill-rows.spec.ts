/**
 * installed-skill-rows specs — the pure view model behind the installed skills
 * page and its detail route (plan C9). Row identity, group state isolation,
 * search, and ref lookup (including an external id with `/` and `:`).
 */

import type {
  ExternalPluginListing,
  InstalledSkill,
  PluginInfo,
} from '@ptah-extension/shared';
import type { InventorySlice } from '../../data/marketplace-inventory.store';
import { decodeSkillRef, encodeSkillRef } from '../../data/skill-ref';
import {
  SKILL_KIND_ICONS,
  communityRow,
  plural,
  filterInstalledSkillGroups,
  findInstalledSkill,
  installedSkillGroups,
  marketplaceRow,
  pluginRow,
  pluginSourceLabel,
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
        findInstalledSkill(
          { kind: 'community-skill', id: 'gone' },
          slices(),
        ),
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
});
