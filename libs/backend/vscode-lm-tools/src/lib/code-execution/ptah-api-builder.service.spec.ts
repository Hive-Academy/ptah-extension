/**
 * TASK_2026_200 Batch 5, task 5.1 — structural guard for criterion 6.
 *
 * Criterion 6: `PtahAPIBuilder.build()` passes a session-aware provider to
 * every namespace dependency bag, so a future namespace cannot be added
 * without one.
 *
 * The Batch 3 review rejected the naive version of this test: asserting
 * "every bag holds the session-aware instance" (identity) flags `webSearch`
 * as a false positive, because `WebSearchService` legitimately holds the RAW
 * provider — it only ever reads `getConfiguration()`, never
 * `getWorkspaceRoot()`. The `memory` namespace is the other documented raw
 * look-alike, but it is NOT actually an exception: it resolves its root via
 * the `getWorkspaceRoot()` closure, which itself calls the private
 * `resolveSessionWorkspaceRoot()` — session-aware by a different channel.
 *
 * So this test asserts on root RESOLUTION, not provider identity: for every
 * dependency bag `build()` constructs, if that bag exposes a capability that
 * can produce a workspace root (`workspaceProvider.getWorkspaceRoot()`, a
 * `getWorkspaceRoot()` callback, or a `workspaceRoot` getter), invoking that
 * capability must yield the CALLING SESSION'S root, never the raw
 * process-global provider's root.
 *
 * Generic by construction, but with one environmental concession. The ideal
 * mechanism would be `jest.requireActual('./namespace-builders')` plus
 * `Object.keys()` — genuinely dynamic, no name list anywhere. That was tried
 * first and does not work in THIS lib's jest environment: the real barrel
 * transitively loads `ast-namespace.builder.ts` → the real
 * `@ptah-extension/workspace-intelligence` barrel → `tree-sitter-parser.service.ts`
 * → `wasm-bundle-dir.ts`, which uses `import.meta.url` for WASM asset
 * resolution — a syntax ts-jest's CommonJS transform in this project cannot
 * parse (confirmed by running it: `SyntaxError: Cannot use 'import.meta'
 * outside a module`, independent of and in addition to the more familiar
 * `vscode` ambient-module wall). No existing spec in this lib imports that
 * barrel for exactly this reason.
 *
 * So the export-NAME list below is read from the barrel's SOURCE TEXT via
 * `fs.readFileSync` + a regex over its `export { ... } from '...'` blocks —
 * not from the loaded module, and not hand-maintained. A 22nd namespace
 * builder added to `namespace-builders/index.ts` is picked up the next time
 * this spec runs with no edit here; only a builder that is exported under a
 * default export or a bare `export function` at the barrel's own top level
 * (neither pattern used anywhere in this barrel today) would be missed. This
 * is the acknowledged concession the task brief invites documenting rather
 * than silently enumerating: true dynamic discovery is blocked by the WASM
 * loader's `import.meta.url`, not by anything in `PtahAPIBuilder` itself. The
 * minimal production-side seam that would remove even this concession is
 * moving `EXTENSION_LANGUAGE_MAP` off the `workspace-intelligence` barrel's
 * eager import graph (e.g. a `/constants` subpath), so `ast-namespace.builder.ts`
 * no longer drags in the tree-sitter/WASM chain just to read a lookup table —
 * out of scope for a spec-only batch.
 *
 * `harness` is excluded from the per-bag assertion below: it requires
 * `SDK_PLUGIN_LOADER` (optional; left undefined here so real
 * `cli-agent-runtime` collaborators are never constructed), and
 * `buildNamespaceSafe` proxies its failure away rather than calling
 * `buildHarnessNamespace` at all. Its `getWorkspaceRoot()` capability is the
 * identical convention this test already verifies for
 * agent/git/memory/corpus/code/tasks and is exercised directly in
 * `harness-namespace.builder.spec.ts`.
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Extract the runtime (non-`type`) identifiers `namespace-builders/index.ts`
 * re-exports, by reading its SOURCE TEXT rather than loading it — see the
 * file header for why loading it is not viable in this lib's jest env.
 */
function readNamespaceBuilderExportNames(): string[] {
  const source = fs.readFileSync(
    path.join(__dirname, 'namespace-builders', 'index.ts'),
    'utf8',
  );
  const names: string[] = [];
  const blockPattern = /export\s*{([^}]*)}\s*from/g;
  let block: RegExpExecArray | null;
  while ((block = blockPattern.exec(source))) {
    for (const rawItem of block[1].split(',')) {
      const item = rawItem.trim();
      if (!item || item.startsWith('type ')) continue;
      const parts = item.split(/\s+as\s+/);
      names.push(parts[parts.length - 1].trim());
    }
  }
  return names;
}

const NAMESPACE_BUILDER_EXPORT_NAMES = readNamespaceBuilderExportNames();

jest.mock('./namespace-builders', () => {
  const mocked: Record<string, jest.Mock> = {};
  for (const name of NAMESPACE_BUILDER_EXPORT_NAMES) {
    mocked[name] = jest.fn(() => ({}));
  }
  return mocked;
});

jest.mock('./services/web-search.service', () => ({
  WebSearchService: jest.fn().mockImplementation((deps: unknown) => ({
    __deps: deps,
  })),
}));

/**
 * `@ptah-extension/vscode-core`'s `error-handler.ts` unconditionally
 * `import * as vscode from 'vscode'` — a package with no runtime
 * implementation outside the extension host — so importing
 * `ptah-api-builder.service.ts` for real (it imports `TOKENS`/`Logger`/
 * `FileSystemManager` from this package as VALUES, needed by tsyringe's
 * `emitDecoratorMetadata`) explodes the same way `di/register.spec.ts` and
 * `mcp-http/http-mcp-server.service.spec.ts` already had to work around. A
 * `Proxy` stands in for `TOKENS` so every `TOKENS.X` access used by ANY
 * `@inject()` decorator below resolves to a stable Symbol without this file
 * enumerating token names.
 */
jest.mock('@ptah-extension/vscode-core', () => ({
  TOKENS: new Proxy(
    {},
    { get: (_target, prop) => Symbol.for(`vscode-core:${String(prop)}`) },
  ),
  Logger: class LoggerStub {},
  FileSystemManager: class FileSystemManagerStub {},
}));

/**
 * `@ptah-extension/workspace-intelligence`'s barrel transitively loads
 * `tree-sitter-parser.service.ts` → `wasm-bundle-dir.ts`, which uses
 * `import.meta.url` for WASM asset resolution — syntax this lib's ts-jest
 * CommonJS transform cannot parse. `ptah-api-builder.service.ts` imports 13
 * service classes from this barrel purely for `@injectable()` constructor
 * parameter metadata (never invoked directly in `build()`) plus the real
 * `CODE_SYMBOL_INDEXER` Symbol used as a decorator token — stub classes and a
 * Proxy-backed Symbol source cover both without loading the real barrel.
 */
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  WorkspaceAnalyzerService: class WorkspaceAnalyzerServiceStub {},
  ContextOrchestrationService: class ContextOrchestrationServiceStub {},
  ContextSizeOptimizerService: class ContextSizeOptimizerServiceStub {},
  MonorepoDetectorService: class MonorepoDetectorServiceStub {},
  DependencyAnalyzerService: class DependencyAnalyzerServiceStub {},
  FileRelevanceScorerService: class FileRelevanceScorerServiceStub {},
  TokenCounterService: class TokenCounterServiceStub {},
  WorkspaceIndexerService: class WorkspaceIndexerServiceStub {},
  ProjectDetectorService: class ProjectDetectorServiceStub {},
  TreeSitterParserService: class TreeSitterParserServiceStub {},
  AstAnalysisService: class AstAnalysisServiceStub {},
  ContextEnrichmentService: class ContextEnrichmentServiceStub {},
  DependencyGraphService: class DependencyGraphServiceStub {},
  CODE_SYMBOL_INDEXER: Symbol.for('workspace-intelligence:CODE_SYMBOL_INDEXER'),
}));

/**
 * `@ptah-extension/task-specs` depends on `persistence-sqlite` →
 * `better-sqlite3` (native binary) — `ptah-api-builder.service.ts` only needs
 * `TASK_SPECS_TOKENS`'s two Symbol values as optional-injection tokens.
 */
jest.mock('@ptah-extension/task-specs', () => ({
  TASK_SPECS_TOKENS: new Proxy(
    {},
    { get: (_target, prop) => Symbol.for(`task-specs:${String(prop)}`) },
  ),
}));

/**
 * `@ptah-extension/cli-agent-runtime`'s barrel transitively loads
 * `auth-providers` → `vscode-copilot-auth.service.ts` → the same real
 * `vscode` ambient import. `pluginLoader` is left `undefined` in every test
 * below, so `harness`'s closure that would actually `new McpRegistryProvider`
 * etc. never runs (`buildNamespaceSafe` throws first) — only the
 * `@injectable()` constructor-metadata reference needs these names to exist.
 */
jest.mock('@ptah-extension/cli-agent-runtime', () => ({
  AgentProcessManager: class AgentProcessManagerStub {},
  CliDetectionService: class CliDetectionServiceStub {},
  McpRegistryProvider: class McpRegistryProviderStub {},
  McpInstallService: class McpInstallServiceStub {},
  SmitheryRegistrySource: class SmitheryRegistrySourceStub {},
  PulseMcpRegistrySource: class PulseMcpRegistrySourceStub {},
  SkillsShApiClient: class SkillsShApiClientStub {},
}));

import * as namespaceBuilders from './namespace-builders';
import { WebSearchService } from './services/web-search.service';
import { PtahAPIBuilder } from './ptah-api-builder.service';
import type { Logger, FileSystemManager } from '@ptah-extension/vscode-core';
import type {
  IWorkspaceProvider,
  IFileSystemProvider,
  IDiagnosticsProvider,
  ISecretStorage,
} from '@ptah-extension/platform-core';
import type {
  WorkspaceAnalyzerService,
  ContextOrchestrationService,
  ContextSizeOptimizerService,
  MonorepoDetectorService,
  DependencyAnalyzerService,
  FileRelevanceScorerService,
  TokenCounterService,
  WorkspaceIndexerService,
  ProjectDetectorService,
  ContextEnrichmentService,
  DependencyGraphService,
  TreeSitterParserService,
  AstAnalysisService,
} from '@ptah-extension/workspace-intelligence';
import type {
  AgentProcessManager,
  CliDetectionService,
} from '@ptah-extension/cli-agent-runtime';

const PLATFORM_ROOT = 'D:\\platform-root';
const SESSION_ROOT = 'D:\\session-root';

/**
 * The count of currently-known root-resolving capability sites `build()`
 * constructs: workspace, search (coreDeps, 2 calls), files (systemDeps),
 * json, context, project, relevance, dependencies (analysisDeps, 4 calls),
 * ast (astDeps), orchestration, agent, git, memory, corpus, code, tasks (6
 * standalone `getWorkspaceRoot` closures) = 16. `harness` is excluded (see
 * file header). Update this constant deliberately — with a comment — if a
 * namespace's root-resolution shape genuinely changes; do NOT loosen it to a
 * range, because a range would stop catching a namespace that silently lost
 * (or gained, unguarded) its session-aware capability.
 */
const EXPECTED_ROOT_CAPABLE_SITES = 16;

function makeRawWorkspaceProvider(): IWorkspaceProvider {
  return {
    getWorkspaceRoot: jest.fn().mockReturnValue(PLATFORM_ROOT),
    getWorkspaceFolders: jest.fn().mockReturnValue([PLATFORM_ROOT]),
    getConfiguration: jest.fn(
      (_section: string, _key: string, dflt?: unknown) => dflt,
    ),
    setConfiguration: jest.fn(),
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn(),
  } as unknown as IWorkspaceProvider;
}

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function makeSessionManager(): {
  getActiveSessionIds: jest.Mock;
  getActiveSessionWorkspace: jest.Mock;
  getSessionWorkspace: jest.Mock;
  find: jest.Mock;
} {
  return {
    getActiveSessionIds: jest.fn().mockReturnValue([]),
    // Tier 2 of resolveSessionWorkspaceRoot's precedence chain (no caller
    // session id is bound in this test, so tier 1 does not apply).
    getActiveSessionWorkspace: jest.fn().mockReturnValue(SESSION_ROOT),
    getSessionWorkspace: jest.fn().mockReturnValue(undefined),
    find: jest.fn().mockReturnValue(undefined),
  };
}

/**
 * Every root-resolving capability a namespace-builder call's arguments might
 * expose, evaluated the same way real namespace code would use it. This is
 * the "assert on root RESOLUTION, not provider identity" mechanism: it does
 * not check whether a bag holds a specific object reference, it checks what
 * value the bag's capability actually PRODUCES.
 */
function extractResolvedRoots(args: unknown[]): unknown[] {
  const roots: unknown[] = [];
  for (const arg of args) {
    if (!arg || typeof arg !== 'object') continue;
    const obj = arg as Record<string, unknown>;

    if (typeof obj['getWorkspaceRoot'] === 'function') {
      roots.push((obj['getWorkspaceRoot'] as () => unknown)());
    }

    const provider = obj['workspaceProvider'] as
      | { getWorkspaceRoot?: () => unknown }
      | undefined;
    if (provider && typeof provider.getWorkspaceRoot === 'function') {
      roots.push(provider.getWorkspaceRoot());
    }

    if ('workspaceRoot' in obj && typeof obj['workspaceRoot'] !== 'function') {
      roots.push(obj['workspaceRoot']);
    }
  }
  return roots;
}

function spyOnEveryNamespaceBuilder(): jest.Mock[] {
  return Object.values(namespaceBuilders).filter(
    (value): value is jest.Mock =>
      typeof value === 'function' && 'mock' in value,
  );
}

function buildTestBuilder(
  rawProvider: IWorkspaceProvider,
  sessionManager: ReturnType<typeof makeSessionManager>,
): PtahAPIBuilder {
  return new PtahAPIBuilder(
    {} as unknown as WorkspaceAnalyzerService,
    {} as unknown as ContextOrchestrationService,
    makeLogger(),
    {} as unknown as FileSystemManager,
    {} as unknown as ContextSizeOptimizerService,
    {} as unknown as MonorepoDetectorService,
    {} as unknown as DependencyAnalyzerService,
    {} as unknown as FileRelevanceScorerService,
    {} as unknown as TokenCounterService,
    {} as unknown as WorkspaceIndexerService,
    {} as unknown as ProjectDetectorService,
    {} as unknown as ContextEnrichmentService,
    {} as unknown as DependencyGraphService,
    {} as unknown as TreeSitterParserService,
    {} as unknown as AstAnalysisService,
    {} as unknown as AgentProcessManager,
    {} as unknown as CliDetectionService,
    rawProvider,
    {} as unknown as IFileSystemProvider,
    {} as unknown as IDiagnosticsProvider,
    {} as unknown as ISecretStorage,
    sessionManager as never, // sdkSessionLifecycleManager
    undefined, // enhancedPromptsService
    undefined, // pluginLoader — see file header re: `harness` exclusion
    undefined, // harnessReconciler
    undefined, // ptahCliRegistry
    undefined, // memorySearch
    undefined, // memoryStore
    undefined, // knowledgeAgent
    undefined, // codeSymbolReader
    undefined, // memoryWriter
    undefined, // symbolIndexer
    undefined, // webviewManager
    undefined, // ideCapabilities
    undefined, // browserCapabilities
    undefined, // skillsShApiClient
    undefined, // authSecretsService
    undefined, // taskWriter
    undefined, // taskIndex
  );
}

describe('PtahAPIBuilder.build() — session-aware root resolution (criterion 6)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('resolves the calling session root, never the raw process-global provider root, from every root-capable namespace bag it constructs', () => {
    const rawProvider = makeRawWorkspaceProvider();
    const sessionManager = makeSessionManager();
    const spies = spyOnEveryNamespaceBuilder();

    const builder = buildTestBuilder(rawProvider, sessionManager);
    builder.build();

    const collectedRoots = spies.flatMap((spy) =>
      spy.mock.calls.flatMap((call) => extractResolvedRoots(call)),
    );

    // Non-vacuity: must find exactly the currently-known root-capable sites.
    // A regression that drops a bag's `workspaceProvider`/`getWorkspaceRoot`
    // (the pre-Batch-3 shape) shrinks this count instead of silently passing.
    expect(collectedRoots.length).toBe(EXPECTED_ROOT_CAPABLE_SITES);
    for (const root of collectedRoots) {
      expect(root).toBe(SESSION_ROOT);
      expect(root).not.toBe(PLATFORM_ROOT);
    }
  });

  it('webSearch is the one documented exception — it holds the raw provider but only ever reads getConfiguration(), never getWorkspaceRoot() (Batch 3 audit)', () => {
    const rawProvider = makeRawWorkspaceProvider();
    const sessionManager = makeSessionManager();
    spyOnEveryNamespaceBuilder();

    const builder = buildTestBuilder(rawProvider, sessionManager);
    builder.build();

    const mockedCtor = WebSearchService as unknown as jest.Mock;
    expect(mockedCtor).toHaveBeenCalledTimes(1);
    const deps = mockedCtor.mock.calls[0][0] as {
      workspaceProvider: IWorkspaceProvider;
    };
    // Documented, audited exception (research-report.md §5; Batch 3 record):
    // grepping `web-search.service.ts` confirms it calls
    // `this.deps.workspaceProvider.getConfiguration(...)` and nothing else on
    // this dependency — never `getWorkspaceRoot()`. Legitimately excluded from
    // the root-resolution assertion above.
    expect(deps.workspaceProvider).toBe(rawProvider);
  });
});
