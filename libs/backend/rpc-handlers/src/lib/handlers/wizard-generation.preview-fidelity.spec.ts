/**
 * `wizard:preview-generation` fidelity against the real
 * `wizard:submit-selection` (TASK_2026_609 C3, risk PR6): every `definite` path
 * holds the generated content after generation, and every agent file present
 * afterwards was listed (`definite` or `conditional`). The preview never
 * promises a file that is not there and never misses one that is.
 *
 * Wiring is the production wiring, in a real tsyringe child container over a
 * temp workspace and a temp home:
 *
 *   - `registerHarnessSyncServices` — the real `HarnessReconcilerService`,
 *     `HarnessPropagationService`, `AgentSyncGate`, manifest builder and every
 *     target, with a `PluginConfigSourceResolver` over the temp home and a CLI
 *     detector that reports codex, copilot, opencode and antigravity installed.
 *   - `registerAgentGenerationServices` — the real orchestrator (it decides the
 *     `.claude/agents/<id>.md` path), `AgentFileWriterService`,
 *     `AnalysisStorageService` and `UserLayerMirrorService`. The user-layer
 *     refresher is the hosts' sequence: mirror then reconcileAll, gated by
 *     `resolveAgentMirrorSource`.
 *
 * Stubbed at the content boundary (Assumption A-6): the template body
 * (`TEMPLATE_STORAGE_SERVICE`), the LLM pass (`CONTENT_GENERATION_SERVICE`),
 * the output validator, and workspace analysis (workspace-intelligence). The
 * platform file-system port is backed by Node `fs`, as the CLI host's is.
 */

import 'reflect-metadata';

// The user layer, the legacy agent root and every lock resolve through
// `os.homedir()`, so each fixture points it at its own temp home. Jest hands
// the sandbox a COPY of `process.env` (an env override never reaches libuv)
// and the `os` namespace is not spy-able, hence a module mock.
let mockHome: string | undefined;
jest.mock('os', () => {
  const actual = jest.requireActual<typeof import('os')>('os');
  return { ...actual, homedir: () => mockHome ?? actual.homedir() };
});

// Same transitive-import guard as `wizard-generation-rpc.handlers.spec.ts`:
// the workspace-intelligence barrel evaluates `import.meta` at load time.
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {
    Node: 'node',
    React: 'react',
    Vue: 'vue',
    Angular: 'angular',
    NextJS: 'nextjs',
    Python: 'python',
    Java: 'java',
    Rust: 'rust',
    Go: 'go',
    DotNet: 'dotnet',
    PHP: 'php',
    Ruby: 'ruby',
    General: 'general',
    Unknown: 'unknown',
  },
  Framework: {
    React: 'react',
    Vue: 'vue',
    Angular: 'angular',
    NextJS: 'nextjs',
    Nuxt: 'nuxt',
    Express: 'express',
    Django: 'django',
    Laravel: 'laravel',
    Rails: 'rails',
    Svelte: 'svelte',
    Astro: 'astro',
    NestJS: 'nestjs',
    Fastify: 'fastify',
    Flask: 'flask',
    FastAPI: 'fastapi',
    Spring: 'spring',
  },
  MonorepoType: {
    Nx: 'nx',
    Lerna: 'lerna',
    Rush: 'rush',
    Turborepo: 'turborepo',
    PnpmWorkspaces: 'pnpm-workspaces',
    YarnWorkspaces: 'yarn-workspaces',
  },
  FileType: {
    Source: 'source',
    Test: 'test',
    Config: 'config',
    Documentation: 'docs',
    Asset: 'asset',
  },
  TreeSitterParserService: class TreeSitterParserServiceStub {},
  AstAnalysisService: class AstAnalysisServiceStub {},
  DependencyGraphService: class DependencyGraphServiceStub {},
  WorkspaceAnalyzerService: class WorkspaceAnalyzerServiceStub {},
  ContextService: class ContextServiceStub {},
  ContextOrchestrationService: class ContextOrchestrationServiceStub {},
  WorkspaceService: class WorkspaceServiceStub {},
  TokenCounterService: class TokenCounterServiceStub {},
  FileSystemService: class FileSystemServiceStub {},
  FileSystemError: class FileSystemErrorStub extends Error {},
  ProjectDetectorService: class ProjectDetectorServiceStub {},
  FrameworkDetectorService: class FrameworkDetectorServiceStub {},
  DependencyAnalyzerService: class DependencyAnalyzerServiceStub {},
  MonorepoDetectorService: class MonorepoDetectorServiceStub {},
  PatternMatcherService: class PatternMatcherServiceStub {},
  IgnorePatternResolverService: class IgnorePatternResolverServiceStub {},
  WorkspaceIndexerService: class WorkspaceIndexerServiceStub {},
  FileTypeClassifierService: class FileTypeClassifierServiceStub {},
  FileRelevanceScorerService: class FileRelevanceScorerServiceStub {},
  ContextSizeOptimizerService: class ContextSizeOptimizerServiceStub {},
  ContextEnrichmentService: class ContextEnrichmentServiceStub {},
}));

import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { container as rootContainer } from 'tsyringe';
import {
  TOKENS,
  type Logger,
  type RpcHandler,
  type SentryService,
} from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockSentryService,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import { FileType, PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  createMockFileSystemProvider,
  createMockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import type { PluginLoaderService } from '@ptah-extension/agent-sdk';
import {
  AGENT_GENERATION_TOKENS,
  registerAgentGenerationServices,
  type AgentTemplate,
  type UserLayerMirrorService,
} from '@ptah-extension/agent-generation';
import {
  HARNESS_SYNC_TOKENS,
  McpIntentStore,
  codexHomeDir,
  createPluginConfigSourceResolver,
  defaultHarnessSourceLayout,
  registerHarnessSyncServices,
  resolveAgentMirrorSource,
  type AgentSyncGate,
  type HarnessReconcilerService,
  type IHarnessCliDetector,
} from '@ptah-extension/harness-sync';
import {
  Result,
  type GenerationCompletePayload,
  type HarnessTargetId,
  type WizardPreviewGenerationResponse,
} from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { WizardGenerationRpcHandlers } from './wizard-generation-rpc.handlers';
import { GenerationCheckpointService } from './wizard-generation-checkpoint.service';
import { GenerationRunSupervisor } from './wizard-generation-run.supervisor';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/** antigravity is installed but carries no agents; cursor is not installed. */
const INSTALLED: ReadonlySet<HarnessTargetId> = new Set<HarnessTargetId>([
  'codex',
  'copilot',
  'opencode',
  'antigravity',
]);

/** Every directory any target writes agent copies into. */
const AGENT_DIRS = [
  '.claude/agents',
  '.codex/agents',
  '.github/agents',
  '.cursor/agents',
  '.opencode/agent',
];

const STEP_TIMEOUT_MS = 30_000;

function template(id: string): AgentTemplate {
  return {
    id,
    name: id,
    version: '1.0.0',
    content: `# ${id}\n\nAuthored guidance for ${id}.\n`,
    applicabilityRules: {
      projectTypes: [],
      frameworks: [],
      monorepoTypes: [],
      minimumRelevanceScore: 0,
      alwaysInclude: false,
    },
    variables: [],
    llmSections: [],
    description: `Use when ${id} work is needed.`,
  };
}

/** The platform file-system port over Node `fs`, as the CLI host provides it. */
function nodeFileSystem() {
  return createMockFileSystemProvider({
    readFile: (p: string) => fsp.readFile(p, 'utf8'),
    writeFile: async (p: string, content: string) => {
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, content, 'utf8');
    },
    createDirectory: async (p: string) => {
      await fsp.mkdir(p, { recursive: true });
    },
    delete: (p: string, options?: { recursive?: boolean }) =>
      fsp.rm(p, { recursive: options?.recursive === true }),
    exists: (p: string) =>
      fsp.access(p).then(
        () => true,
        () => false,
      ),
    stat: async (p: string) => {
      const s = await fsp.stat(p);
      return {
        type: s.isDirectory() ? FileType.Directory : FileType.File,
        ctime: s.ctimeMs,
        mtime: s.mtimeMs,
        size: s.size,
      };
    },
    readDirectory: async (p: string) =>
      (await fsp.readdir(p, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        type: entry.isDirectory()
          ? FileType.Directory
          : entry.isFile()
            ? FileType.File
            : FileType.Unknown,
      })),
  });
}

interface Fixture {
  workspace: string;
  rpcHandler: MockRpcHandler;
  gate: AgentSyncGate;
  reconciler: HarnessReconcilerService;
  contentGenerator: { generateContent: jest.Mock };
  /** Resolves with the one completion payload of the next generation. */
  nextCompletion: () => Promise<GenerationCompletePayload>;
}

let tempRoot: string;

function buildFixture(opts: { disabledAgentIds?: string[] } = {}): Fixture {
  const home = path.join(tempRoot, 'home');
  const workspace = path.join(tempRoot, 'workspace');
  fs.mkdirSync(home, { recursive: true });
  // The root marker, so the harness root is this folder and never an ancestor.
  fs.mkdirSync(path.join(workspace, '.ptah'), { recursive: true });

  const logger = createMockLogger() as unknown as Logger;
  const container = rootContainer.createChildContainer();
  container.register(TOKENS.LOGGER, { useValue: logger });
  container.register(TOKENS.SENTRY_SERVICE, {
    useValue: createMockSentryService(),
  });
  container.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, {
    useValue: nodeFileSystem(),
  });

  // --- agent-generation: real orchestrator, writer, storage and mirror. ---
  registerAgentGenerationServices(container, logger);
  container.register(AGENT_GENERATION_TOKENS.TEMPLATE_STORAGE_SERVICE, {
    useValue: {
      loadTemplate: async (id: string) => Result.ok(template(id)),
    },
  });
  const contentGenerator = {
    generateContent: jest.fn(async (t: AgentTemplate) =>
      Result.ok({
        content: `${t.content}\nTailored for this workspace.\n`,
        warnings: [],
        rejectedSections: 0,
        tailoredSections: 1,
      }),
    ),
  };
  container.register(AGENT_GENERATION_TOKENS.CONTENT_GENERATION_SERVICE, {
    useValue: contentGenerator,
  });
  container.register(AGENT_GENERATION_TOKENS.OUTPUT_VALIDATION_SERVICE, {
    useValue: {
      validate: async () =>
        Result.ok({ isValid: true, issues: [], score: 100 }),
    },
  });
  container.register(AGENT_GENERATION_TOKENS.AGENT_SELECTION_SERVICE, {
    useValue: { selectAgents: jest.fn() },
  });
  container.register(AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE, {
    useValue: { getEnhancedPromptContent: async () => null },
  });
  container.register(TOKENS.WORKSPACE_ANALYZER_SERVICE, {
    useValue: {
      getProjectInfo: async () => ({
        path: workspace,
        type: 'node',
        dependencies: [],
        devDependencies: [],
      }),
    },
  });
  container.register(TOKENS.PROJECT_DETECTOR_SERVICE, { useValue: {} });
  container.register(TOKENS.FRAMEWORK_DETECTOR_SERVICE, {
    useValue: { detectFramework: async () => undefined },
  });
  container.register(TOKENS.MONOREPO_DETECTOR_SERVICE, {
    useValue: { detectMonorepo: async () => ({ isMonorepo: false }) },
  });

  // --- harness-sync: the production registration. ---
  const detector: IHarnessCliDetector = {
    isInstalled: async (target) => INSTALLED.has(target),
  };
  registerHarnessSyncServices(container, logger, {
    sourceResolver: createPluginConfigSourceResolver(
      () => ({
        resolveCurrentPluginPaths: () => [],
        getDisabledSkillIds: () => [],
        getWorkspacePluginConfig: () => ({
          disabledPluginIds: [],
          disabledAgentIds: opts.disabledAgentIds ?? [],
        }),
      }),
      defaultHarnessSourceLayout(home),
      new McpIntentStore(path.join(home, '.ptah', 'mcp-installed.json')),
    ),
    cliDetector: detector,
    // The hosts' refresh: mirror, then reconcileAll, gated on agent consent.
    userLayerRefresher: {
      refresh: async (cwd) => {
        const mirror = container.resolve<UserLayerMirrorService>(
          AGENT_GENERATION_TOKENS.USER_LAYER_MIRROR_SERVICE,
        );
        // Never let a broken home redirect write into the real user layer.
        if (!mirror.getUserLayerRoots(cwd).agents.startsWith(home)) {
          throw new Error('user layer is not under the temp home');
        }
        const sources = {
          pluginPaths: [],
          ...resolveAgentMirrorSource(
            cwd,
            container.resolve<AgentSyncGate>(
              HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE,
            ),
          ),
        };
        await mirror.mirrorAll(sources);
        await mirror.reconcileAll(sources);
      },
    },
  });

  // --- the handler under test, with a broadcaster that reports completion. ---
  const completions: Array<(payload: GenerationCompletePayload) => void> = [];
  container.register(TOKENS.WEBVIEW_MANAGER, {
    useValue: {
      broadcastMessage: async (type: string, payload: unknown) => {
        if (type === 'setup-wizard:generation-complete') {
          completions.shift()?.(payload as GenerationCompletePayload);
        }
      },
    },
  });
  const rpcHandler = createMockRpcHandler();
  const handlers = new WizardGenerationRpcHandlers(
    logger,
    rpcHandler as unknown as RpcHandler,
    {
      getWorkspacePluginConfig: () => ({ enabledPluginIds: [] }),
      resolvePluginPaths: () => [],
    } as unknown as PluginLoaderService,
    createMockWorkspaceProvider({
      folders: [workspace],
    }) as unknown as IWorkspaceProvider,
    container,
    createMockSentryService() as unknown as SentryService,
    new GenerationCheckpointService(logger, container),
    new GenerationRunSupervisor(logger),
  );
  handlers.register();

  return {
    workspace,
    rpcHandler,
    gate: container.resolve<AgentSyncGate>(HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE),
    reconciler: container.resolve<HarnessReconcilerService>(
      HARNESS_SYNC_TOKENS.RECONCILER,
    ),
    contentGenerator,
    nextCompletion: () =>
      new Promise<GenerationCompletePayload>((resolve) =>
        completions.push(resolve),
      ),
  };
}

async function call<T>(
  f: Fixture,
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const response = await f.rpcHandler.handleMessage({
    method,
    params,
    correlationId: `corr-${method}`,
  });
  if (!response.success) {
    throw new Error(`RPC ${method} failed: ${response.error}`);
  }
  return response.data as T;
}

/** Run the real submit and wait for its one completion payload. */
async function generate(
  f: Fixture,
  selectedAgentIds: string[],
): Promise<GenerationCompletePayload> {
  const completion = f.nextCompletion();
  const accepted = await call<{ success: boolean; error?: string }>(
    f,
    'wizard:submit-selection',
    { selectedAgentIds },
  );
  expect(accepted).toEqual({ success: true });
  return completion;
}

const WRITE_DEPENDENT_CONDITION =
  'generation changes at least one selected agent file; other CLIs are only synced when a file is written';

function pathsWith(
  preview: WizardPreviewGenerationResponse,
  certainty: 'definite' | 'conditional',
): string[] {
  return preview.agents
    .flatMap((agent) => agent.files)
    .filter((file) => file.certainty === certainty)
    .map((file) => file.relPath)
    .sort();
}

function definiteSet(preview: WizardPreviewGenerationResponse): string[] {
  return pathsWith(preview, 'definite');
}

function conditionalSet(preview: WizardPreviewGenerationResponse): string[] {
  return pathsWith(preview, 'conditional');
}

/**
 * The fidelity invariant: every `definite` path exists after generation, and
 * every agent file present was listed — the preview never promises a file that
 * is not written and never misses one that is.
 */
function expectFaithful(
  preview: WizardPreviewGenerationResponse,
  written: string[],
): void {
  for (const relPath of definiteSet(preview)) {
    expect(written).toContain(relPath);
  }
  const listed = new Set([...definiteSet(preview), ...conditionalSet(preview)]);
  expect(written.filter((relPath) => !listed.has(relPath))).toEqual([]);
}

/** Every agent file present under any target's agent directory. */
function writtenAgentPaths(workspace: string): string[] {
  const found: string[] = [];
  for (const dir of AGENT_DIRS) {
    const abs = path.join(workspace, ...dir.split('/'));
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.isFile()) found.push(`${dir}/${entry.name}`);
    }
  }
  return found.sort();
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('wizard:preview-generation fidelity against the real wizard:submit-selection', () => {
  let savedCodexHome: string | undefined;

  beforeEach(() => {
    // `codexHomeDir()` reads CODEX_HOME before `os.homedir()`; a machine that
    // exports it would let the real reconciler reach the real Codex home.
    savedCodexHome = process.env['CODEX_HOME'];
    delete process.env['CODEX_HOME'];
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-preview-fidelity-'));
    mockHome = path.join(tempRoot, 'home');
    expect(os.homedir()).toBe(mockHome);
    expect(codexHomeDir()).toBe(path.join(mockHome, '.codex'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockHome = undefined;
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (savedCodexHome === undefined) {
      delete process.env['CODEX_HOME'];
    } else {
      process.env['CODEX_HOME'] = savedCodexHome;
    }
  });

  it(
    'fresh workspace with sync enabled: rival copies are conditional (nothing in sync yet) and generation writes them, honouring a per-agent opt-out',
    async () => {
      const f = buildFixture({ disabledAgentIds: ['tester'] });
      f.gate.enable(f.workspace);
      const ids = ['backend-developer', 'frontend-developer', 'tester'];

      const preview = await call<WizardPreviewGenerationResponse>(
        f,
        'wizard:preview-generation',
        { selectedAgentIds: ids },
      );
      expect(preview.warning).toBeUndefined();
      expect(definiteSet(preview)).toEqual([
        '.claude/agents/backend-developer.md',
        '.claude/agents/frontend-developer.md',
        '.claude/agents/tester.md',
      ]);
      // codex/copilot/opencode for the two synced agents; tester opted out.
      expect(conditionalSet(preview)).toHaveLength(6);
      expect(conditionalSet(preview)).not.toContain(
        '.codex/agents/tester.toml',
      );
      expect(
        preview.agents
          .flatMap((a) => a.files)
          .filter((file) => file.certainty === 'conditional')
          .map((file) => file.condition),
      ).toEqual(Array(6).fill(WRITE_DEPENDENT_CONDITION));
      // The preview wrote nothing.
      expect(writtenAgentPaths(f.workspace)).toEqual([]);

      const payload = await generate(f, ids);
      expect(payload.writtenCount).toBe(3);
      expect(f.contentGenerator.generateContent).toHaveBeenCalledTimes(3);

      const written = writtenAgentPaths(f.workspace);
      expectFaithful(preview, written);
      // This run wrote, so every conditional copy was synced too.
      expect(written).toEqual(
        [...definiteSet(preview), ...conditionalSet(preview)].sort(),
      );
      expect(written).toHaveLength(9);
      expect(written).toContain('.codex/agents/backend-developer.toml');
      expect(written).toContain('.github/agents/frontend-developer.agent.md');
      expect(written).toContain('.opencode/agent/backend-developer.md');
      expect(written).not.toContain('.codex/agents/tester.toml');
    },
    STEP_TIMEOUT_MS,
  );

  it(
    'agent sync recorded as disabled: rival copies are conditional, the wizard grants consent, the preview does not',
    async () => {
      const f = buildFixture();
      expect(f.gate.persist(f.workspace, false)).toBe(true);
      expect(f.gate.resolve(f.workspace)).toEqual({
        enabled: false,
        derived: false,
      });
      const ids = ['backend-developer', 'reviewer'];

      const preview = await call<WizardPreviewGenerationResponse>(
        f,
        'wizard:preview-generation',
        { selectedAgentIds: ids },
      );
      // Read-only: the preview recorded no consent.
      expect(f.gate.resolve(f.workspace).enabled).toBe(false);
      expect(definiteSet(preview)).toHaveLength(2);
      expect(conditionalSet(preview)).toHaveLength(6);

      await generate(f, ids);

      expect(f.gate.resolve(f.workspace).enabled).toBe(true);
      const written = writtenAgentPaths(f.workspace);
      expectFaithful(preview, written);
      expect(written).toHaveLength(8);
    },
    STEP_TIMEOUT_MS,
  );

  it(
    'an all-unchanged regeneration syncs nothing: rival copies were conditional, none is written and the gate stays disabled',
    async () => {
      const f = buildFixture();
      expect(f.gate.persist(f.workspace, false)).toBe(true);
      const ids = ['backend-developer', 'reviewer'];
      // First generation while the gate stays disabled: the consent grant is
      // refused, so the propagation that follows syncs no agent copy.
      const enable = jest.spyOn(f.gate, 'enable').mockReturnValueOnce(false);
      const first = await generate(f, ids);
      expect(first.writtenCount).toBe(2);
      expect(f.gate.resolve(f.workspace).enabled).toBe(false);
      expect(writtenAgentPaths(f.workspace)).toEqual([
        '.claude/agents/backend-developer.md',
        '.claude/agents/reviewer.md',
      ]);

      const preview = await call<WizardPreviewGenerationResponse>(
        f,
        'wizard:preview-generation',
        { selectedAgentIds: ids },
      );
      expect(definiteSet(preview)).toEqual([
        '.claude/agents/backend-developer.md',
        '.claude/agents/reviewer.md',
      ]);
      expect(conditionalSet(preview)).toHaveLength(6);

      // Same ids, same stubbed content: every Claude file is unchanged.
      const second = await generate(f, ids);

      expect(second.writtenCount).toBe(0);
      expect(second.unchangedCount).toBe(2);
      // No write, no propagation: no consent grant and no rival copy.
      expect(enable).toHaveBeenCalledTimes(1);
      expect(f.gate.resolve(f.workspace).enabled).toBe(false);
      const written = writtenAgentPaths(f.workspace);
      expectFaithful(preview, written);
      expect(written).toEqual(definiteSet(preview));
    },
    STEP_TIMEOUT_MS,
  );

  it(
    'after a synced generation the rival copies are in sync, so the preview marks them definite and an unchanged rerun keeps them',
    async () => {
      const f = buildFixture();
      f.gate.enable(f.workspace);
      const ids = ['backend-developer', 'reviewer'];
      const first = await generate(f, ids);
      expect(first.writtenCount).toBe(2);
      expect(writtenAgentPaths(f.workspace)).toHaveLength(8);

      const preview = await call<WizardPreviewGenerationResponse>(
        f,
        'wizard:preview-generation',
        { selectedAgentIds: ids },
      );
      expect(preview.warning).toBeUndefined();
      expect(conditionalSet(preview)).toEqual([]);
      expect(definiteSet(preview)).toHaveLength(8);
      expect(definiteSet(preview)).toContain(
        '.codex/agents/backend-developer.toml',
      );

      const second = await generate(f, ids);

      expect(second.writtenCount).toBe(0);
      const written = writtenAgentPaths(f.workspace);
      expectFaithful(preview, written);
      for (const relPath of definiteSet(preview)) {
        expect(
          fs.readFileSync(path.join(f.workspace, relPath), 'utf8'),
        ).toContain('Tailored for this workspace.');
      }
    },
    STEP_TIMEOUT_MS,
  );

  it(
    'a preview failure still lets generation write the Claude files, and the Claude-only preview holds',
    async () => {
      const f = buildFixture();
      jest
        .spyOn(f.reconciler, 'verify')
        .mockRejectedValueOnce(new Error('verify exploded'));
      const ids = ['backend-developer', 'tester'];

      const preview = await call<WizardPreviewGenerationResponse>(
        f,
        'wizard:preview-generation',
        { selectedAgentIds: ids },
      );
      expect(preview.warning).toMatch(/only the Claude agent files/i);
      expect(definiteSet(preview)).toEqual([
        '.claude/agents/backend-developer.md',
        '.claude/agents/tester.md',
      ]);

      const payload = await generate(f, ids);

      expect(payload.writtenCount).toBe(2);
      const written = writtenAgentPaths(f.workspace);
      expect(
        written.filter((relPath) => relPath.startsWith('.claude/')),
      ).toEqual(definiteSet(preview));
      for (const relPath of definiteSet(preview)) {
        expect(
          fs.readFileSync(path.join(f.workspace, relPath), 'utf8'),
        ).toContain('Tailored for this workspace.');
      }
    },
    STEP_TIMEOUT_MS,
  );
});
