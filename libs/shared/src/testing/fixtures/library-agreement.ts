/**
 * Library agreement fixtures (TASK_2026_701_9e4b, A29).
 *
 * One set of plain DTOs that the Library, the Marketplace and the wizard
 * completion specs all read, so each surface is proved against the SAME
 * plugins, clones and harness collisions instead of three hand-built
 * approximations that drift. Names follow the design-spec section 3.6 shared
 * fixture (Ptah Release Kit, Old Helper, Former Helper, Acme Toolkit,
 * tailwind-v4).
 *
 * Pure data: shared types only, no Angular, no Playwright. Every call returns
 * fresh objects, so a spec that mutates one cannot leak into another.
 */

import type { HarnessCollision } from '../../lib/types/harness-sync.types';
import type { LibraryProvenance } from '../../lib/types/library-provenance';
import type { PluginInfo } from '../../lib/types/rpc/rpc-misc.types';
import type {
  CloneSummary,
  SkillSynthesisListClonesResult,
} from '../../lib/types/rpc/rpc-skill-clone.types';

/** Harness root every fixture's clone list is scoped to. */
export const LIBRARY_AGREEMENT_SCOPE_ROOT = '/workspace/acme-app';

export type LibraryAgreementScenario =
  | 'pluginWithSkillsAndAgents'
  | 'shadowedSkill'
  | 'shadowedAgent'
  | 'communitySkill'
  | 'disabledPluginEditedClone'
  | 'uninstalledPluginEditedClone'
  | 'pluginUpdateDiverged'
  | 'twoExternalPluginsOneBasename';

export interface LibraryAgreementFixture {
  /** What the scenario proves, for spec titles. */
  description: string;
  /** `plugins:list-available` rows in play. */
  plugins: PluginInfo[];
  /** `skillSynthesis:listClones` result. */
  listClones: SkillSynthesisListClonesResult;
  /** Harness health collision slice for the same state. */
  collisions: HarnessCollision[];
  /**
   * The provenance label every surface must show, keyed `<kind>:<slug>`.
   * Derived from `provenanceLabel`; restated as literals so a regression in
   * the label function fails the agreement specs too.
   */
  expectedLabels: Record<string, string>;
}

const RELEASE_KIT: PluginInfo = {
  id: 'ptah-release-kit',
  name: 'Ptah Release Kit',
  description: 'Release automation skills, command and agent bundled with Ptah.',
  category: 'core-tools',
  skillCount: 2,
  commandCount: 1,
  isDefault: true,
  keywords: ['release', 'changelog'],
  source: 'bundled',
  status: 'ok',
  agentCount: 1,
  skillNames: ['release-notes', 'changelog'],
  agentNames: ['release-manager'],
  commandNames: ['release'],
};

const OLD_HELPER: PluginInfo = {
  id: 'old-helper',
  name: 'Old Helper',
  description: 'Legacy helper skill and agent, turned off.',
  category: 'core-tools',
  skillCount: 1,
  commandCount: 0,
  isDefault: false,
  keywords: ['helper'],
  source: 'bundled',
  status: 'ok',
  agentCount: 1,
  skillNames: ['helper-skill'],
  agentNames: ['helper-agent'],
  commandNames: [],
};

const ACME_TOOLKIT: PluginInfo = {
  id: 'external:acme/toolkit/toolkit',
  name: 'Acme Toolkit',
  description: 'API design, database review and release notes.',
  category: 'external-tools',
  skillCount: 3,
  commandCount: 1,
  isDefault: false,
  keywords: ['api', 'database'],
  source: 'external',
  status: 'ok',
  agentCount: 2,
  skillNames: ['api-design', 'db-review', 'release-notes'],
  agentNames: ['architect', 'reviewer'],
  commandNames: ['ship'],
};

/** Same directory basename (`toolkit`) as Acme Toolkit, different source. */
const BETA_TOOLKIT: PluginInfo = {
  id: 'external:beta/plugins/toolkit',
  name: 'Beta Toolkit',
  description: 'Schema migration helpers.',
  category: 'external-tools',
  skillCount: 1,
  commandCount: 0,
  isDefault: false,
  keywords: ['migrations'],
  source: 'external',
  status: 'ok',
  agentCount: 0,
  skillNames: ['schema-migrate'],
  agentNames: [],
  commandNames: [],
};

const TAILWIND_V4: PluginInfo = {
  id: 'ptah-skillssh-acme-skills-tailwind-v4',
  name: 'tailwind-v4',
  description: 'Tailwind CSS v4 conventions for utility-first styling.',
  category: 'external-tools',
  skillCount: 1,
  commandCount: 0,
  isDefault: false,
  keywords: ['tailwind', 'css'],
  source: 'skillssh',
  status: 'ok',
  agentCount: 0,
  skillNames: ['tailwind-v4'],
  agentNames: [],
  commandNames: [],
};

/** A deep copy, so a spec that mutates a row cannot leak into another. */
function copyPlugin(plugin: PluginInfo): PluginInfo {
  return {
    ...plugin,
    keywords: [...plugin.keywords],
    skillNames: plugin.skillNames && [...plugin.skillNames],
    agentNames: plugin.agentNames && [...plugin.agentNames],
    commandNames: plugin.commandNames && [...plugin.commandNames],
  };
}

function pluginProvenance(
  plugin: PluginInfo,
  state: 'active' | 'turned-off' | 'uninstalled' = 'active',
): LibraryProvenance {
  return { kind: 'plugin', pluginId: plugin.id, name: plugin.name, state };
}

/** A clean, in-sync clone; scenarios override what they are about. */
function clone(
  slug: string,
  kind: CloneSummary['kind'],
  overrides: Partial<CloneSummary> = {},
): CloneSummary {
  return {
    slug,
    kind,
    cloneStatus: 'clone',
    diverged: false,
    invocationCount: 0,
    successRate: null,
    lastEnhancedAt: null,
    historyCount: 0,
    pendingSourceHash: null,
    enhanceMinInvocations: 5,
    enhanceCooldownUntil: null,
    orphaned: false,
    ...overrides,
  };
}

function listClones(clones: CloneSummary[]): SkillSynthesisListClonesResult {
  return { clones, scopeRoot: LIBRARY_AGREEMENT_SCOPE_ROOT };
}

/** Fresh copies of every agreement scenario. */
export function makeLibraryAgreementFixtures(): Record<
  LibraryAgreementScenario,
  LibraryAgreementFixture
> {
  const releaseKit = (): PluginInfo => copyPlugin(RELEASE_KIT);
  const acme = (): PluginInfo => copyPlugin(ACME_TOOLKIT);

  return {
    pluginWithSkillsAndAgents: {
      description: 'an enabled plugin that ships skills, a command and an agent',
      plugins: [releaseKit()],
      listClones: listClones([
        clone('release-notes', 'skill', {
          provenance: pluginProvenance(RELEASE_KIT),
        }),
        clone('changelog', 'skill', {
          provenance: pluginProvenance(RELEASE_KIT),
        }),
        clone('release', 'command', {
          provenance: pluginProvenance(RELEASE_KIT),
        }),
        clone('release-manager', 'agent', {
          provenance: pluginProvenance(RELEASE_KIT),
        }),
      ]),
      collisions: [],
      expectedLabels: {
        'skill:release-notes': 'Plugin: Ptah Release Kit',
        'skill:changelog': 'Plugin: Ptah Release Kit',
        'command:release': 'Plugin: Ptah Release Kit',
        'agent:release-manager': 'Plugin: Ptah Release Kit',
      },
    },

    shadowedSkill: {
      description:
        'an external skill shadowed by an already active plugin skill of the same name',
      plugins: [releaseKit(), acme()],
      listClones: listClones([
        clone('release-notes', 'skill', {
          provenance: pluginProvenance(RELEASE_KIT),
        }),
        clone('api-design', 'skill', {
          provenance: pluginProvenance(ACME_TOOLKIT),
        }),
      ]),
      collisions: [
        {
          slug: 'release-notes',
          shadowedSource:
            '/home/user/.ptah/plugins/external/acme/toolkit/toolkit/skills/release-notes',
          shadowedPluginId: 'toolkit',
          reason: 'duplicate-slug',
        },
      ],
      expectedLabels: {
        'skill:release-notes': 'Plugin: Ptah Release Kit',
        'skill:api-design': 'Plugin: Acme Toolkit',
      },
    },

    shadowedAgent: {
      description:
        'a plugin agent shadowed by the user’s own workspace agent, which is kept',
      plugins: [acme()],
      listClones: listClones([
        clone('architect', 'agent', {
          cloneStatus: 'authored',
          provenance: { kind: 'workspace' },
        }),
      ]),
      collisions: [
        {
          slug: 'architect',
          shadowedSource:
            '/home/user/.ptah/plugins/external/acme/toolkit/toolkit/agents/architect.md',
          shadowedPluginId: 'toolkit',
          reason: 'duplicate-slug',
        },
      ],
      expectedLabels: { 'agent:architect': 'Workspace file' },
    },

    communitySkill: {
      description: 'a community skill installed from skills.sh',
      plugins: [copyPlugin(TAILWIND_V4)],
      listClones: listClones([
        clone('tailwind-v4', 'skill', {
          provenance: { kind: 'skills-sh', source: 'acme/skills' },
        }),
      ]),
      collisions: [],
      expectedLabels: { 'skill:tailwind-v4': 'skills.sh: acme/skills' },
    },

    disabledPluginEditedClone: {
      description:
        'a turned-off plugin whose edited agent copy stays in the Library',
      plugins: [copyPlugin(OLD_HELPER)],
      listClones: listClones([
        clone('helper-agent', 'agent', {
          orphaned: true,
          historyCount: 1,
          provenance: pluginProvenance(OLD_HELPER, 'turned-off'),
        }),
      ]),
      collisions: [],
      expectedLabels: { 'agent:helper-agent': 'Plugin: Old Helper' },
    },

    uninstalledPluginEditedClone: {
      description:
        'an uninstalled plugin whose display name differs from its id; the edited copy keeps the display name',
      plugins: [],
      listClones: listClones([
        clone('legacy-linter', 'agent', {
          orphaned: true,
          historyCount: 2,
          provenance: {
            kind: 'plugin',
            pluginId: 'former-helper-plugin',
            name: 'Former Helper',
            state: 'uninstalled',
          },
        }),
      ]),
      collisions: [],
      expectedLabels: { 'agent:legacy-linter': 'Plugin: Former Helper' },
    },

    pluginUpdateDiverged: {
      description:
        'a plugin update arrived for an agent the user edited, so the copy diverged',
      plugins: [acme()],
      listClones: listClones([
        clone('reviewer', 'agent', {
          cloneStatus: 'diverged',
          diverged: true,
          historyCount: 1,
          pendingSourceHash: 'sha256-acme-reviewer-2.1.0',
          provenance: pluginProvenance(ACME_TOOLKIT),
          divergedReason: { kind: 'plugin', pluginName: 'Acme Toolkit' },
        }),
      ]),
      collisions: [],
      expectedLabels: { 'agent:reviewer': 'Plugin: Acme Toolkit' },
    },

    twoExternalPluginsOneBasename: {
      description:
        'two external plugins share the directory basename `toolkit`; each copy shows its own name',
      plugins: [acme(), copyPlugin(BETA_TOOLKIT)],
      listClones: listClones([
        clone('db-review', 'skill', {
          provenance: pluginProvenance(ACME_TOOLKIT),
        }),
        clone('schema-migrate', 'skill', {
          provenance: pluginProvenance(BETA_TOOLKIT),
        }),
      ]),
      collisions: [],
      expectedLabels: {
        'skill:db-review': 'Plugin: Acme Toolkit',
        'skill:schema-migrate': 'Plugin: Beta Toolkit',
      },
    },
  };
}
