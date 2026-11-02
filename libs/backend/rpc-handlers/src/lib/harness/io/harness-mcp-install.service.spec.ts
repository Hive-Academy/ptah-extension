/**
 * Behaviour spec for {@link HarnessMcpInstallService}.
 *
 * Applying a harness records each installable MCP server as a WORKSPACE
 * intent (TASK_2026_853, D-4): workspace A's apply never reaches workspace B,
 * and a home-folder target is left out with a warning instead of leaking the
 * server into every workspace.
 *
 * The service builds its own `McpInstallService` over the default intent
 * store, so `os.homedir()` is redirected to a scratch directory before the SUT
 * is imported. No reconciler is registered, so nothing is written to any
 * target config file; only the intent file is.
 */

import 'reflect-metadata';

jest.mock('os', () => {
  const actual = jest.requireActual('os');
  return {
    ...actual,
    homedir: () =>
      require('path').join(
        actual.tmpdir(),
        `ptah-harness-mcp-install-spec-home-${process.pid}`,
      ),
  };
});

// `@ptah-extension/cli-agent-runtime` transitively pulls
// `@ptah-extension/workspace-intelligence`, whose TreeSitter module uses
// `import.meta.url` (unparseable under ts-jest CJS). Same stub as
// `mcp-directory-rpc.handlers.spec.ts`; nothing here uses it.
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {},
  Framework: {},
  MonorepoType: {},
  FileType: {},
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
import * as os from 'os';
import * as path from 'path';
import type { DependencyContainer } from 'tsyringe';
import { McpInstallService } from '@ptah-extension/cli-agent-runtime';
import { McpIntentStore } from '@ptah-extension/harness-sync';
import type { McpServerEntry } from '@ptah-extension/shared';
import { HarnessMcpInstallService } from './harness-mcp-install.service';

const intentPath = path.join(os.homedir(), '.ptah', 'mcp-installed.json');
const stdio = { type: 'stdio' as const, command: 'node', args: ['s.js'] };

/** A container with no harness reconciler: intents are recorded, nothing is written. */
const noReconciler = {
  isRegistered: () => false,
  resolve: () => {
    throw new Error('not registered');
  },
} as unknown as DependencyContainer;

const makeService = (): HarnessMcpInstallService =>
  new HarnessMcpInstallService(
    {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as never,
    noReconciler,
  );

const entry = (overrides: Partial<McpServerEntry> = {}): McpServerEntry => ({
  name: 'alpha',
  url: 'https://example.invalid/alpha',
  enabled: true,
  config: stdio,
  ...overrides,
});

describe('HarnessMcpInstallService — workspace intent (D-4)', () => {
  const created: string[] = [];

  const workspaces = (): { a: string; b: string } => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-mcp-ws-'));
    created.push(base);
    const make = (name: string): string => {
      const root = path.join(base, name);
      fs.mkdirSync(path.join(root, '.git'), { recursive: true });
      fs.mkdirSync(path.join(root, '.ptah'), { recursive: true });
      return root;
    };
    return { a: make('a'), b: make('b') };
  };

  const store = (): McpIntentStore => new McpIntentStore(intentPath);

  beforeEach(() => {
    fs.rmSync(os.homedir(), { recursive: true, force: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(os.homedir(), { recursive: true, force: true });
    for (const dir of created.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records the applied server for workspace A only; it is absent from B', async () => {
    const { a, b } = workspaces();

    await makeService().installServers([entry()], a);

    expect(store().scopeOf('alpha', a)).toBe('workspace');
    expect(store().targetsIn('alpha', 'workspace', a)).toEqual([
      'claude',
      'vscode',
    ]);
    expect(store().scopeOf('alpha', b)).toBeUndefined();
    expect(store().listFor(b)).toEqual([]);
    expect(store().targetsIn('alpha', 'global')).toEqual([]);
  });

  it('passes workspace scope explicitly to the installer', async () => {
    const { a } = workspaces();
    const spy = jest
      .spyOn(McpInstallService.prototype, 'install')
      .mockResolvedValue([
        { target: 'claude', success: true, configPath: '/a/.mcp.json' },
      ]);

    const outcome = await makeService().installServers(
      [entry({ serverKey: 'alpha-key', installTargets: ['claude'] })],
      a,
    );

    expect(spy).toHaveBeenCalledWith(
      'alpha',
      'alpha-key',
      stdio,
      ['claude'],
      a,
      'workspace',
    );
    expect(outcome).toEqual({
      installedPaths: ['/a/.mcp.json'],
      warnings: [],
    });
  });

  it('leaves home-folder targets out with a warning and installs the workspace targets', async () => {
    const { a } = workspaces();

    const outcome = await makeService().installServers(
      [entry({ installTargets: ['claude', 'codex', 'copilot'] })],
      a,
    );

    expect(store().targetsIn('alpha', 'workspace', a)).toEqual(['claude']);
    expect(store().targetsIn('alpha', 'global')).toEqual([]);
    expect(outcome.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'MCP server "alpha" was not added to codex, copilot',
        ),
      ]),
    );
  });

  it('records nothing when every requested target is a home-folder target', async () => {
    const { a } = workspaces();
    const spy = jest.spyOn(McpInstallService.prototype, 'install');

    const outcome = await makeService().installServers(
      [entry({ installTargets: ['codex'] })],
      a,
    );

    expect(spy).not.toHaveBeenCalled();
    expect(fs.existsSync(intentPath)).toBe(false);
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.installedPaths).toEqual([]);
  });

  it('with no workspace open warns and records nothing', async () => {
    const spy = jest.spyOn(McpInstallService.prototype, 'install');

    const outcome = await makeService().installServers([entry()], undefined);

    expect(spy).not.toHaveBeenCalled();
    expect(fs.existsSync(intentPath)).toBe(false);
    expect(outcome.warnings).toEqual([
      'No workspace folder open. MCP servers were not installed.',
    ]);
  });
});
