/**
 * GenerationPreviewService — unit specs (TASK_2026_701 B5).
 *
 * The service runs in a real tsyringe child container over a temp folder, so
 * every file probe, the origin store and the HMAC revisions are the
 * production code. Harness, template, settings and Library collaborators are
 * registered as plain values. Nothing is written outside the temp folder.
 */

import 'reflect-metadata';

// Same transitive-import guard as the handler specs: the agent-generation
// barrel reaches workspace-intelligence, whose tree-sitter loader evaluates
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

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { container as rootContainer, type DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  AGENT_GENERATION_TOKENS,
  WizardAgentOriginStore,
} from '@ptah-extension/agent-generation';
import { HARNESS_SYNC_TOKENS, hashContent } from '@ptah-extension/harness-sync';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import {
  Result,
  type AgentModelLayers,
  type GenerationPreviewFile,
  type WizardPreviewGenerationResponse,
} from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import {
  GenerationPreviewService,
  PREVIEW_NO_HARNESS_WARNING,
  PREVIEW_OPENED_FOLDER_WARNING,
  PREVIEW_VERIFY_FAILED_WARNING,
  previewKeyFor,
  resolveGenerationTarget,
  type DecisionRequest,
} from './generation-preview.service';

const AGENT = 'backend-developer';
const OTHER = 'tester';

const HEALTH = {
  targets: [
    {
      target: 'codex',
      detected: true,
      facets: { agents: 'supported' },
      agentsInSync: [],
    },
    {
      target: 'copilot',
      detected: false,
      facets: { agents: 'supported' },
    },
  ],
};

interface Fixture {
  root: string;
  nested: string;
  container: DependencyContainer;
  service: GenerationPreviewService;
  reconciler: { verify: jest.Mock };
  templates: { loadTemplate: jest.Mock };
  mirror: { readCloneEditState: jest.Mock };
  origins: WizardAgentOriginStore;
}

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

function makeFixture(
  opts: {
    harness?: boolean;
    templates?: boolean;
    layers?: AgentModelLayers | 'throws';
    mirror?: boolean;
  } = {},
): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-gen-preview-'));
  tempDirs.push(root);
  // A root marker, so the harness root is this folder and not an ancestor.
  fs.mkdirSync(path.join(root, '.ptah'));
  const nested = path.join(root, 'packages', 'app');
  fs.mkdirSync(nested, { recursive: true });

  const container = rootContainer.createChildContainer();
  container.register(TOKENS.LOGGER, { useValue: createMockLogger() });
  container.register(PLATFORM_TOKENS.DI_CONTAINER, { useValue: container });
  container.register(AGENT_GENERATION_TOKENS.AGENT_ORIGIN_STORE, {
    useClass: WizardAgentOriginStore,
  });

  const reconciler = { verify: jest.fn().mockResolvedValue(HEALTH) };
  if (opts.harness !== false) {
    container.register(HARNESS_SYNC_TOKENS.RECONCILER, {
      useValue: reconciler,
    });
    container.register(HARNESS_SYNC_TOKENS.SOURCE_RESOLVER, {
      useValue: {
        resolve: jest.fn().mockResolvedValue({ disabledAgentIds: [] }),
      },
    });
    container.register(HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE, {
      useValue: { enable: jest.fn() },
    });
    container.register(HARNESS_SYNC_TOKENS.PROPAGATION, {
      useValue: { propagate: jest.fn() },
    });
  }

  const templates = {
    loadTemplate: jest.fn(async (id: string) =>
      id === 'no-template'
        ? Result.err(new Error('template missing'))
        : Result.ok({ id, model: 'sonnet' }),
    ),
  };
  if (opts.templates !== false) {
    container.register(AGENT_GENERATION_TOKENS.TEMPLATE_STORAGE_SERVICE, {
      useValue: templates,
    });
  }
  if (opts.layers !== undefined) {
    const layers = opts.layers;
    container.register(SETTINGS_TOKENS.AGENT_MODEL_SETTINGS, {
      useValue: {
        layersForPath: () => {
          if (layers === 'throws') throw new Error('settings unreadable');
          return layers;
        },
      },
    });
  }
  const mirror = {
    readCloneEditState: jest.fn().mockResolvedValue({
      exists: true,
      edited: true,
      pluginId: null,
    }),
  };
  if (opts.mirror) {
    container.register(AGENT_GENERATION_TOKENS.USER_LAYER_MIRROR_SERVICE, {
      useValue: mirror,
    });
  }

  return {
    root: path.resolve(root),
    nested: path.resolve(nested),
    container,
    service: container.resolve(GenerationPreviewService),
    reconciler,
    templates,
    mirror,
    origins: container.resolve<WizardAgentOriginStore>(
      AGENT_GENERATION_TOKENS.AGENT_ORIGIN_STORE,
    ),
  };
}

function agentFile(folder: string, agentId = AGENT): string {
  return path.join(folder, '.claude', 'agents', `${agentId}.md`);
}

function writeAgent(folder: string, content: string, agentId = AGENT): void {
  fs.mkdirSync(path.dirname(agentFile(folder, agentId)), { recursive: true });
  fs.writeFileSync(agentFile(folder, agentId), content);
}

function preview(
  f: Fixture,
  extra: {
    openedFolder?: string;
    agentIds?: string[];
    target?: 'harness-root' | 'opened-folder';
    key?: string;
  } = {},
): Promise<WizardPreviewGenerationResponse> {
  const openedFolder = extra.openedFolder ?? f.root;
  return f.service.preview({
    key: extra.key ?? previewKeyFor(undefined),
    openedFolder,
    canonicalWorkspace: openedFolder,
    agentIds: extra.agentIds ?? [AGENT],
    target: extra.target,
  });
}

function claudeRow(
  response: WizardPreviewGenerationResponse,
  agentId = AGENT,
): GenerationPreviewFile {
  const row = response.agents
    .find((agent) => agent.agentId === agentId)
    ?.files.find((file) => file.target === 'claude');
  if (!row) throw new Error(`no claude row for ${agentId}`);
  return row;
}

function decide(
  f: Fixture,
  request: Partial<DecisionRequest>,
): ReturnType<GenerationPreviewService['validateDecisions']> {
  return f.service.validateDecisions({
    key: previewKeyFor(undefined),
    workspace: f.root,
    agentIds: [AGENT],
    requirePreview: false,
    ...request,
  });
}

describe('resolveGenerationTarget', () => {
  it('defaults to the harness root and offers the opened folder only when different', () => {
    const f = makeFixture();
    expect(resolveGenerationTarget(f.nested, undefined)).toEqual({
      harnessRoot: f.root,
      openedFolder: f.nested,
      chosen: 'harness-root',
      openedIsHarnessRoot: false,
    });
    expect(resolveGenerationTarget(f.nested, 'opened-folder').chosen).toBe(
      'opened-folder',
    );
    // Same folder: nothing to choose, so the choice collapses to the root.
    expect(resolveGenerationTarget(f.root, 'opened-folder')).toMatchObject({
      chosen: 'harness-root',
      openedIsHarnessRoot: true,
    });
  });
});

describe('GenerationPreviewService.preview', () => {
  describe('Claude file states', () => {
    it('new: nothing there', async () => {
      const f = makeFixture();
      const row = claudeRow(await preview(f));
      expect(row).toMatchObject({
        relPath: `.claude/agents/${AGENT}.md`,
        localState: 'new',
        willOverwrite: false,
        certainty: 'definite',
      });
      expect(typeof row.revision).toBe('string');
    });

    it('exists: a readable file; the same bytes give the same revision', async () => {
      const f = makeFixture();
      writeAgent(f.root, 'mine');
      const first = claudeRow(await preview(f));
      const second = claudeRow(await preview(f));
      expect(first).toMatchObject({ localState: 'exists', willOverwrite: true });
      expect(second.revision).toBe(first.revision);
    });

    it('unreadable: something that cannot be read as a file', async () => {
      const f = makeFixture();
      fs.mkdirSync(agentFile(f.root), { recursive: true });
      const row = claudeRow(await preview(f));
      expect(row).toMatchObject({
        localState: 'unreadable',
        willOverwrite: true,
      });
    });

    it('a different baseline gives a different revision', async () => {
      const f = makeFixture();
      writeAgent(f.root, 'version A');
      const before = claudeRow(await preview(f)).revision;
      writeAgent(f.root, 'version B');
      expect(claudeRow(await preview(f)).revision).not.toBe(before);
    });

    it('a revision made under another process secret never matches', async () => {
      const one = makeFixture();
      writeAgent(one.root, 'same');
      // Same file and bytes, another service instance (another process).
      const other = makeFixture();
      const response = await other.service.preview({
        key: previewKeyFor(undefined),
        openedFolder: one.root,
        canonicalWorkspace: one.root,
        agentIds: [AGENT],
      });
      const mine = claudeRow(await preview(one)).revision;
      expect(claudeRow(response).revision).not.toBe(mine);
    });
  });

  describe('target and rival status (R1-5)', () => {
    it('listed: harness-root target in a sub-folder computes rival rows at the harness root', async () => {
      const f = makeFixture();
      const response = await preview(f, { openedFolder: f.nested });
      expect(response.rivalStatus).toBe('listed');
      expect(response.warning).toBeUndefined();
      expect(response.target?.chosen).toBe('harness-root');
      expect(f.reconciler.verify).toHaveBeenCalledWith(
        f.root,
        'wizard:preview-generation',
      );
      expect(
        response.agents[0].files.map((file) => [file.target, file.relPath]),
      ).toEqual([
        ['claude', `../../.claude/agents/${AGENT}.md`],
        ['codex', `../../.codex/agents/${AGENT}.toml`],
      ]);
    });

    it('opened-folder-elsewhere: only for the opened-folder target, with no rival rows', async () => {
      const f = makeFixture();
      const response = await preview(f, {
        openedFolder: f.nested,
        target: 'opened-folder',
      });
      expect(response.rivalStatus).toBe('opened-folder-elsewhere');
      expect(response.warning).toBe(PREVIEW_OPENED_FOLDER_WARNING);
      expect(response.agents[0].files.map((file) => file.relPath)).toEqual([
        `.claude/agents/${AGENT}.md`,
      ]);
      expect(f.reconciler.verify).not.toHaveBeenCalled();
    });

    it('harness-unavailable: no reconciler, no rival rows', async () => {
      const f = makeFixture({ harness: false });
      const response = await preview(f);
      expect(response.rivalStatus).toBe('harness-unavailable');
      expect(response.warning).toBe(PREVIEW_NO_HARNESS_WARNING);
      expect(response.agents[0].files.map((file) => file.target)).toEqual([
        'claude',
      ]);
    });

    it('cli-detection-failed: verify throws, no rival rows', async () => {
      const f = makeFixture();
      f.reconciler.verify.mockRejectedValueOnce(new Error('EACCES'));
      const response = await preview(f);
      expect(response.rivalStatus).toBe('cli-detection-failed');
      expect(response.warning).toBe(PREVIEW_VERIFY_FAILED_WARNING);
      expect(response.agents[0].files.map((file) => file.target)).toEqual([
        'claude',
      ]);
    });
  });

  describe('model origins', () => {
    it('template model when nothing overrides it', async () => {
      const f = makeFixture();
      const response = await preview(f);
      expect(response.agents[0].agentModel).toEqual({
        value: 'sonnet',
        origin: 'template',
      });
    });

    it('a workspace override wins; it is read for the harness root', async () => {
      const f = makeFixture({
        layers: { workspace: { [AGENT]: { claude: 'opus' } } },
      });
      const response = await preview(f, { openedFolder: f.nested });
      expect(response.agents[0].agentModel).toEqual({
        value: 'opus',
        origin: 'workspace',
      });
    });

    it('a machine override applies when the workspace sets none', async () => {
      const f = makeFixture({ layers: { machine: { '*': { claude: 'haiku' } } } });
      expect((await preview(f)).agents[0].agentModel).toEqual({
        value: 'haiku',
        origin: 'machine',
      });
    });

    it('an override Claude rejects is reported and the template model is kept', async () => {
      const f = makeFixture({
        layers: { workspace: { [AGENT]: { claude: 'gpt-5' } } },
      });
      expect((await preview(f)).agents[0].agentModel).toEqual({
        value: 'sonnet',
        origin: 'template',
        ignoredOverride: 'gpt-5',
      });
    });

    it('unreadable settings fall back to the template model', async () => {
      const f = makeFixture({ layers: 'throws' });
      expect((await preview(f)).agents[0].agentModel).toEqual({
        value: 'sonnet',
        origin: 'template',
      });
    });

    it('omits the model when the template cannot load or no store exists', async () => {
      const f = makeFixture();
      const response = await preview(f, { agentIds: ['no-template'] });
      expect(response.agents[0]).not.toHaveProperty('agentModel');

      const bare = makeFixture({ templates: false });
      expect((await preview(bare)).agents[0]).not.toHaveProperty('agentModel');
    });
  });

  describe('Library copy and wizard origin', () => {
    it('flags an edited Library copy for the harness-root target only', async () => {
      const f = makeFixture({ mirror: true });
      expect((await preview(f)).agents[0].libraryCopyEdited).toBe(true);
      expect(f.mirror.readCloneEditState).toHaveBeenCalledWith(
        'agent',
        AGENT,
        f.root,
      );

      const opened = await preview(f, {
        openedFolder: f.nested,
        target: 'opened-folder',
      });
      expect(opened.agents[0]).not.toHaveProperty('libraryCopyEdited');
    });

    it('omits the flag when there is no Library or no clone', async () => {
      const none = makeFixture();
      expect((await preview(none)).agents[0]).not.toHaveProperty(
        'libraryCopyEdited',
      );
      const noClone = makeFixture({ mirror: true });
      noClone.mirror.readCloneEditState.mockResolvedValue(null);
      expect((await preview(noClone)).agents[0]).not.toHaveProperty(
        'libraryCopyEdited',
      );
    });

    it('unchanged since the wizard wrote it, until someone edits the file (D10)', async () => {
      const f = makeFixture();
      writeAgent(f.root, 'generated');
      expect((await preview(f)).agents[0]).not.toHaveProperty(
        'unchangedSinceWizardWrite',
      );

      const hash = await f.origins.hashWrittenFile(agentFile(f.root));
      expect(await f.origins.recordWritten(f.root, AGENT, hash)).toBe(true);
      expect((await preview(f)).agents[0].unchangedSinceWizardWrite).toBe(true);

      writeAgent(f.root, 'edited by hand');
      expect((await preview(f)).agents[0].unchangedSinceWizardWrite).toBe(
        false,
      );
    });
  });

  it('reads only: nothing is written into the folder', async () => {
    const f = makeFixture({ mirror: true });
    await preview(f);
    expect(fs.readdirSync(f.root).sort()).toEqual(['.ptah', 'packages']);
    expect(fs.readdirSync(path.join(f.root, '.ptah'))).toEqual([]);
  });
});

describe('GenerationPreviewService.validateDecisions', () => {
  it('no token and no replace: every agent is create-only without re-previewing', async () => {
    const f = makeFixture();
    writeAgent(f.root, 'mine');
    const result = await decide(f, {
      agentIds: [AGENT, OTHER],
      decisions: { [AGENT]: { decision: 'keep' } },
    });
    expect(result).toMatchObject({
      ok: true,
      tokenBound: false,
      guards: {
        [AGENT]: { mode: 'create-only' },
        [OTHER]: { mode: 'create-only' },
      },
    });
    expect(f.reconciler.verify).not.toHaveBeenCalled();
  });

  it('a tab-bound submit without a preview for its tab is refused', async () => {
    const f = makeFixture();
    const result = await decide(f, {
      key: previewKeyFor('tab-1'),
      requirePreview: true,
    });
    expect(result).toMatchObject({ ok: false, reason: 'preview-required' });
  });

  it('a tab-bound submit with a confirmed preview but no token is create-only', async () => {
    const f = makeFixture();
    writeAgent(f.root, 'mine');
    await preview(f, { key: previewKeyFor('tab-1') });
    const result = await decide(f, {
      key: previewKeyFor('tab-1'),
      requirePreview: true,
    });
    expect(result).toMatchObject({
      ok: true,
      tokenBound: false,
      guards: { [AGENT]: { mode: 'create-only' } },
    });
  });

  it('a valid token: keep for existing files, create-only for new ones, replace on request', async () => {
    const f = makeFixture();
    writeAgent(f.root, 'mine');
    writeAgent(f.root, 'theirs', OTHER);
    const response = await preview(f, { agentIds: [AGENT, OTHER, 'fresh'] });
    const result = await decide(f, {
      agentIds: [AGENT, OTHER, 'fresh'],
      previewToken: response.previewToken,
      decisions: {
        [OTHER]: {
          decision: 'replace',
          revision: claudeRow(response, OTHER).revision,
        },
      },
    });
    expect(result).toEqual({
      ok: true,
      tokenBound: true,
      target: expect.objectContaining({ chosen: 'harness-root' }),
      guards: {
        [AGENT]: { mode: 'keep' },
        [OTHER]: {
          mode: 'replace-allowed',
          baseline: { state: 'present', hash: hashContent('theirs') },
        },
        fresh: { mode: 'create-only' },
      },
    });
  });

  it('an unreadable file is kept even when nothing is decided', async () => {
    const f = makeFixture();
    fs.mkdirSync(agentFile(f.root), { recursive: true });
    const response = await preview(f);
    const result = await decide(f, { previewToken: response.previewToken });
    expect(result).toMatchObject({ ok: true, guards: { [AGENT]: { mode: 'keep' } } });
  });

  it.each([
    ['replace on a new file', 'new'],
    ['replace on an unreadable file', 'unreadable'],
  ])('refuses %s', async (_label, state) => {
    const f = makeFixture();
    if (state === 'unreadable')
      fs.mkdirSync(agentFile(f.root), { recursive: true });
    const response = await preview(f);
    const result = await decide(f, {
      previewToken: response.previewToken,
      decisions: {
        [AGENT]: { decision: 'replace', revision: claudeRow(response).revision },
      },
    });
    expect(result).toMatchObject({ ok: false, reason: 'preview-required' });
  });

  it('refuses a replace whose revision is missing or stale', async () => {
    const f = makeFixture();
    writeAgent(f.root, 'mine');
    const response = await preview(f);
    for (const revision of [undefined, 'not-the-revision']) {
      const result = await decide(f, {
        previewToken: response.previewToken,
        decisions: { [AGENT]: { decision: 'replace', revision } },
      });
      expect(result.ok).toBe(false);
    }
  });

  it('refuses a superseded token with a replace', async () => {
    const f = makeFixture();
    writeAgent(f.root, 'mine');
    const first = await preview(f);
    await preview(f);
    const result = await decide(f, {
      previewToken: first.previewToken,
      decisions: {
        [AGENT]: { decision: 'replace', revision: claudeRow(first).revision },
      },
    });
    expect(result.ok).toBe(false);
  });

  it('a superseded token without replaces only creates', async () => {
    const f = makeFixture();
    writeAgent(f.root, 'mine');
    const first = await preview(f);
    await preview(f);
    const result = await decide(f, { previewToken: first.previewToken });
    expect(result).toMatchObject({
      ok: true,
      tokenBound: false,
      guards: { [AGENT]: { mode: 'create-only' } },
    });
  });

  it('records are per key: another tab does not supersede this one', async () => {
    const f = makeFixture();
    writeAgent(f.root, 'mine');
    const mine = await preview(f, { key: previewKeyFor('tab-a') });
    await preview(f, { key: previewKeyFor('tab-b') });
    const result = await decide(f, {
      key: previewKeyFor('tab-a'),
      previewToken: mine.previewToken,
      decisions: {
        [AGENT]: { decision: 'replace', revision: claudeRow(mine).revision },
      },
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    ['a decision for an agent that was not selected', { decisions: { [OTHER]: { decision: 'keep' as const } } }],
    ['a different selection', { agentIds: [AGENT, OTHER] }],
    ['a different target', { target: 'opened-folder' as const }],
  ])('refuses %s', async (_label, extra) => {
    const f = makeFixture();
    writeAgent(f.root, 'mine');
    const response = await preview(f, { openedFolder: f.nested });
    const result = await decide(f, {
      workspace: f.nested,
      previewToken: response.previewToken,
      ...extra,
    });
    expect(result).toMatchObject({ ok: false, reason: 'preview-required' });
  });

  it('refuses a token presented for another workspace', async () => {
    const f = makeFixture();
    writeAgent(f.root, 'mine');
    const response = await preview(f);
    const result = await decide(f, {
      workspace: f.nested,
      previewToken: response.previewToken,
      decisions: {
        [AGENT]: { decision: 'replace', revision: claudeRow(response).revision },
      },
    });
    expect(result.ok).toBe(false);
  });

  it('refuses when the definite files changed since the preview', async () => {
    const f = makeFixture();
    const response = await preview(f);
    // new → exists after the preview: the confirmed picture no longer holds.
    writeAgent(f.root, 'appeared');
    const result = await decide(f, { previewToken: response.previewToken });
    expect(result).toMatchObject({ ok: false, reason: 'preview-required' });
  });

  it('release drops the record, so its token no longer binds a replace', async () => {
    const f = makeFixture();
    writeAgent(f.root, 'mine');
    const response = await preview(f);
    f.service.release(previewKeyFor(undefined));
    const result = await decide(f, {
      previewToken: response.previewToken,
      decisions: {
        [AGENT]: { decision: 'replace', revision: claudeRow(response).revision },
      },
    });
    expect(result.ok).toBe(false);
  });

  it('keeps at most 64 records, evicting the oldest key', async () => {
    const f = makeFixture({ harness: false, templates: false });
    writeAgent(f.root, 'mine');
    const oldest = await preview(f, { key: previewKeyFor('tab-0') });
    for (let i = 1; i <= 64; i++) {
      await preview(f, { key: previewKeyFor(`tab-${i}`) });
    }
    const result = await decide(f, {
      key: previewKeyFor('tab-0'),
      previewToken: oldest.previewToken,
      decisions: {
        [AGENT]: { decision: 'replace', revision: claudeRow(oldest).revision },
      },
    });
    expect(result.ok).toBe(false);
  });
});
