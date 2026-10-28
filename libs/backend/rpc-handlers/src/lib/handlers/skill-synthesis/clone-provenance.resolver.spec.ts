/**
 * CloneProvenanceResolver (TASK_2026_701 B13): labels from recorded origin
 * markers only, plugin state from the live sources, A11 diverged reasons.
 */
import 'reflect-metadata';

// The agent-generation barrel (origin store token) reaches
// workspace-intelligence, whose tree-sitter loader evaluates
// `import.meta.url` at load time (unparseable under ts-jest's CJS transform).
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: { Node: 'node', General: 'general', Unknown: 'unknown' },
  Framework: {},
  MonorepoType: {},
  FileType: {},
  TreeSitterParserService: class TreeSitterParserServiceStub {},
  WorkspaceAnalyzerService: class WorkspaceAnalyzerServiceStub {},
  ProjectDetectorService: class ProjectDetectorServiceStub {},
  FrameworkDetectorService: class FrameworkDetectorServiceStub {},
  MonorepoDetectorService: class MonorepoDetectorServiceStub {},
}));

import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import { provenanceLabel } from '@ptah-extension/shared';
import {
  CloneProvenanceResolver,
  type CloneOriginFacts,
} from './clone-provenance.resolver';

const SCOPE = resolve('/workspace/acme-app');
const PLUGINS = resolve('/home/user/.ptah/plugins');
const RELEASE_KIT_PATH = join(PLUGINS, 'ptah-release-kit');
const OLD_HELPER_PATH = join(PLUGINS, 'old-helper');
const ACME_PATH = join(PLUGINS, 'external', 'acme', 'toolkit', 'toolkit');
const BETA_PATH = join(PLUGINS, 'external', 'beta', 'plugins', 'toolkit');

const WIZARD_HASH = `sha256:${'a'.repeat(64)}`;

interface Setup {
  descriptors?: Record<string, { sourceRef: string; label: string }>;
  active?: string[];
  wizardAgents?: Record<string, string>;
  loaderThrows?: boolean;
  withLoader?: boolean;
}

function build(setup: Setup = {}) {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const pluginLoader = {
    getPluginSourceDescriptors: jest.fn(() => {
      if (setup.loaderThrows) throw new Error('loader exploded');
      return setup.descriptors ?? {};
    }),
    resolveCurrentPluginPaths: jest.fn(() => setup.active ?? []),
  };
  const origins = Object.fromEntries(
    Object.entries(setup.wizardAgents ?? {}).map(([slug, hash]) => [
      slug,
      { hash, writtenAt: 1 },
    ]),
  );
  const originStore = { read: jest.fn(async () => origins) };

  const child = container.createChildContainer();
  child.registerInstance(TOKENS.LOGGER, logger);
  if (setup.withLoader !== false) {
    child.registerInstance(SDK_TOKENS.SDK_PLUGIN_LOADER, pluginLoader);
  }
  child.registerInstance(AGENT_GENERATION_TOKENS.AGENT_ORIGIN_STORE, originStore);
  return {
    resolver: child.resolve(CloneProvenanceResolver),
    pluginLoader,
    originStore,
    logger,
  };
}

function facts(overrides: Partial<CloneOriginFacts>): CloneOriginFacts {
  return {
    kind: 'agent',
    slug: 'backend-developer',
    pluginId: null,
    diverged: false,
    pendingSourceHash: null,
    ...overrides,
  };
}

async function resolveOne(setup: Setup, clone: CloneOriginFacts) {
  const { resolver } = build(setup);
  const resolved = await resolver.resolveAll(SCOPE, [clone]);
  expect(resolved).not.toBeNull();
  return resolved?.[0];
}

describe('CloneProvenanceResolver — plugin-less clones', () => {
  it('a legacy wizard file with no origin record is a workspace file', async () => {
    const origin = await resolveOne({}, facts({}));
    expect(origin?.provenance).toEqual({ kind: 'workspace' });
  });

  it('an agent the wizard wrote is labelled setup-wizard', async () => {
    const { resolver, originStore } = build({
      wizardAgents: { 'backend-developer': WIZARD_HASH },
    });
    const [origin] = (await resolver.resolveAll(SCOPE, [facts({})])) ?? [];
    expect(origin.provenance).toEqual({ kind: 'setup-wizard' });
    expect(originStore.read).toHaveBeenCalledWith(SCOPE);
  });

  it('a hand edit keeps the setup-wizard label (Diverged is a separate badge)', async () => {
    const origin = await resolveOne(
      { wizardAgents: { 'backend-developer': WIZARD_HASH } },
      facts({ diverged: true, pendingSourceHash: `sha256:${'b'.repeat(64)}` }),
    );
    expect(origin?.provenance).toEqual({ kind: 'setup-wizard' });
    expect(origin?.divergedReason).toEqual({ kind: 'source-changed' });
  });

  it('a file a community pack replaced (origin forgotten) is a workspace file', async () => {
    const origin = await resolveOne(
      { wizardAgents: { 'frontend-developer': WIZARD_HASH } },
      facts({}),
    );
    expect(origin?.provenance).toEqual({ kind: 'workspace' });
  });

  it('only agents can be wizard-written; a skill of the same slug is a workspace file', async () => {
    const origin = await resolveOne(
      { wizardAgents: { 'backend-developer': WIZARD_HASH } },
      facts({ kind: 'skill' }),
    );
    expect(origin?.provenance).toEqual({ kind: 'workspace' });
  });
});

describe('CloneProvenanceResolver — plugin sources', () => {
  it('labels an active bundled plugin by its live display name', async () => {
    const origin = await resolveOne(
      {
        descriptors: {
          [RELEASE_KIT_PATH]: { sourceRef: 'ptah:ptah-release-kit', label: 'Ptah Release Kit' },
        },
        active: [RELEASE_KIT_PATH],
      },
      facts({
        kind: 'skill',
        slug: 'release-notes',
        pluginId: 'ptah-release-kit',
        sourceRef: 'ptah:ptah-release-kit',
        sourceLabel: 'Old Name',
      }),
    );
    expect(origin?.provenance).toEqual({
      kind: 'plugin',
      pluginId: 'ptah-release-kit',
      name: 'Ptah Release Kit',
      state: 'active',
    });
    expect(provenanceLabel(origin?.provenance)).toBe('Plugin: Ptah Release Kit');
  });

  it('a turned-off plugin keeps its label with state turned-off', async () => {
    const origin = await resolveOne(
      {
        descriptors: {
          [OLD_HELPER_PATH]: { sourceRef: 'ptah:old-helper', label: 'Old Helper' },
        },
        active: [],
      },
      facts({ slug: 'helper-agent', pluginId: 'old-helper', sourceRef: 'ptah:old-helper' }),
    );
    expect(origin?.provenance).toEqual({
      kind: 'plugin',
      pluginId: 'old-helper',
      name: 'Old Helper',
      state: 'turned-off',
    });
  });

  it('uninstall of a plugin whose display name differs from its id keeps the display name', async () => {
    const origin = await resolveOne(
      { descriptors: {} },
      facts({
        slug: 'legacy-linter',
        pluginId: 'former-helper-plugin',
        sourceRef: 'ptah:former-helper-plugin',
        sourceLabel: 'Former Helper',
      }),
    );
    expect(origin?.provenance).toEqual({
      kind: 'plugin',
      pluginId: 'former-helper-plugin',
      name: 'Former Helper',
      state: 'uninstalled',
    });
    expect(provenanceLabel(origin?.provenance)).toBe('Plugin: Former Helper');
  });

  it('an uninstalled plugin with no recorded name falls back to its id', async () => {
    const origin = await resolveOne(
      {},
      facts({ pluginId: 'gone-plugin', sourceRef: 'ptah:gone-plugin' }),
    );
    expect(origin?.provenance).toMatchObject({ name: 'gone-plugin', state: 'uninstalled' });
  });

  it('two external plugins with the same basename show their own names', async () => {
    const { resolver } = build({
      descriptors: {
        [ACME_PATH]: { sourceRef: 'external:acme/toolkit/toolkit', label: 'Acme Toolkit' },
        [BETA_PATH]: { sourceRef: 'external:beta/plugins/toolkit', label: 'Beta Toolkit' },
      },
      active: [ACME_PATH, BETA_PATH],
    });
    const resolved = await resolver.resolveAll(SCOPE, [
      facts({
        kind: 'skill',
        slug: 'api-design',
        pluginId: 'toolkit',
        sourceRef: 'external:acme/toolkit/toolkit',
      }),
      facts({
        kind: 'skill',
        slug: 'schema-migrate',
        pluginId: 'toolkit',
        sourceRef: 'external:beta/plugins/toolkit',
      }),
    ]);
    expect(resolved?.map((r) => r.provenance)).toEqual([
      { kind: 'plugin', pluginId: 'external:acme/toolkit/toolkit', name: 'Acme Toolkit', state: 'active' },
      { kind: 'plugin', pluginId: 'external:beta/plugins/toolkit', name: 'Beta Toolkit', state: 'active' },
    ]);
  });

  it('a legacy sidecar (no sourceRef) uses a live descriptor only when exactly one basename matches', async () => {
    const unique = await resolveOne(
      {
        descriptors: {
          [OLD_HELPER_PATH]: { sourceRef: 'ptah:old-helper', label: 'Old Helper' },
        },
        active: [OLD_HELPER_PATH],
      },
      facts({ pluginId: 'old-helper' }),
    );
    expect(unique?.provenance).toEqual({
      kind: 'plugin',
      pluginId: 'old-helper',
      name: 'Old Helper',
      state: 'active',
    });

    const ambiguous = await resolveOne(
      {
        descriptors: {
          [ACME_PATH]: { sourceRef: 'external:acme/toolkit/toolkit', label: 'Acme Toolkit' },
          [BETA_PATH]: { sourceRef: 'external:beta/plugins/toolkit', label: 'Beta Toolkit' },
        },
        active: [ACME_PATH],
      },
      facts({ pluginId: 'toolkit' }),
    );
    expect(ambiguous?.provenance).toEqual({
      kind: 'plugin',
      pluginId: 'toolkit',
      name: 'toolkit',
      state: 'active',
    });
  });
});

describe('CloneProvenanceResolver — skills.sh sources', () => {
  let root: string;
  let skillsShPath: string;

  beforeEach(() => {
    root = fs.mkdtempSync(join(tmpdir(), 'clone-provenance-'));
    skillsShPath = join(root, 'ptah-skillssh-acme-skills');
    fs.mkdirSync(skillsShPath, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('labels a community skill from the root metadata source', async () => {
    fs.writeFileSync(
      join(skillsShPath, '.ptah-skillssh.json'),
      JSON.stringify({
        version: 1,
        source: 'acme/skills',
        skillIds: ['tailwind-v4'],
        installedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    const origin = await resolveOne(
      {
        descriptors: {
          [skillsShPath]: { sourceRef: 'skills-sh:ptah-skillssh-acme-skills', label: 'Acme Skills' },
        },
        active: [skillsShPath],
      },
      facts({
        kind: 'skill',
        slug: 'tailwind-v4',
        pluginId: 'ptah-skillssh-acme-skills',
        sourceRef: 'skills-sh:ptah-skillssh-acme-skills',
      }),
    );
    expect(origin?.provenance).toEqual({ kind: 'skills-sh', source: 'acme/skills' });
    expect(provenanceLabel(origin?.provenance)).toBe('skills.sh: acme/skills');
  });

  it('a removed community source keeps the recorded label', async () => {
    const origin = await resolveOne(
      {},
      facts({
        kind: 'skill',
        slug: 'tailwind-v4',
        pluginId: 'ptah-skillssh-acme-skills',
        sourceRef: 'skills-sh:ptah-skillssh-acme-skills',
        sourceLabel: 'acme/skills',
      }),
    );
    expect(origin?.provenance).toEqual({ kind: 'skills-sh', source: 'acme/skills' });
  });
});

describe('CloneProvenanceResolver — diverged reason (A11)', () => {
  it('names the wizard when the pending source is the hash the wizard wrote', async () => {
    const origin = await resolveOne(
      { wizardAgents: { 'backend-developer': WIZARD_HASH } },
      facts({ diverged: true, pendingSourceHash: WIZARD_HASH }),
    );
    expect(origin?.divergedReason).toEqual({ kind: 'setup-wizard' });
  });

  it('names the plugin for a diverged plugin clone', async () => {
    const origin = await resolveOne(
      {
        descriptors: {
          [ACME_PATH]: { sourceRef: 'external:acme/toolkit/toolkit', label: 'Acme Toolkit' },
        },
        active: [ACME_PATH],
      },
      facts({
        slug: 'reviewer',
        pluginId: 'toolkit',
        sourceRef: 'external:acme/toolkit/toolkit',
        diverged: true,
        pendingSourceHash: 'sha256-acme-reviewer-2.1.0',
      }),
    );
    expect(origin?.divergedReason).toEqual({ kind: 'plugin', pluginName: 'Acme Toolkit' });
  });

  it('a source change with no specific origin carries no reason wording', async () => {
    const origin = await resolveOne(
      {},
      facts({ diverged: true, pendingSourceHash: `sha256:${'c'.repeat(64)}` }),
    );
    expect(origin?.divergedReason).toEqual({ kind: 'source-changed' });
  });

  it('a clone that has not diverged carries no reason', async () => {
    const origin = await resolveOne({}, facts({}));
    expect(origin?.divergedReason).toBeUndefined();
  });
});

describe('CloneProvenanceResolver — failure', () => {
  it('returns null (provenance omitted) when the plugin sources cannot be read', async () => {
    const { resolver, logger } = build({ loaderThrows: true });
    await expect(resolver.resolveAll(SCOPE, [facts({})])).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns null when the host has no plugin loader', async () => {
    const { resolver } = build({ withLoader: false });
    await expect(resolver.resolveAll(SCOPE, [facts({})])).resolves.toBeNull();
  });

  it('with no folder open the wizard record is not read', async () => {
    const { resolver, originStore } = build({
      wizardAgents: { 'backend-developer': WIZARD_HASH },
    });
    const [origin] = (await resolver.resolveAll(undefined, [facts({})])) ?? [];
    expect(origin.provenance).toEqual({ kind: 'workspace' });
    expect(originStore.read).not.toHaveBeenCalled();
  });
});
