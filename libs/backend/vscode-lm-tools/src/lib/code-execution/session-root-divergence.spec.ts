/**
 * TASK_2026_200 Batch 5, task 5.3 — MCP surface session/root divergence
 * (acceptance criteria 1-5).
 *
 * `core-namespace.builders.spec.ts` and `ast-namespace.builder.spec.ts`
 * already cover each namespace builder IN ISOLATION with a manually-scripted
 * `workspaceProvider.getWorkspaceRoot` mock. What is new here is wiring the
 * REAL production seams — `buildSessionAwareWorkspaceProvider`,
 * `resolveSessionWorkspaceRoot` (the caller → active-session → provider
 * precedence chain), and `runWithMcpRequestContext`/`getCallerSessionId` (the
 * AsyncLocalStorage that makes concurrent sessions safe) — behind TWO
 * different namespace builders (`workspace` and `ast`, plus `search`) built
 * from the SAME session-aware provider instance `PtahAPIBuilder.build()`
 * constructs. That combination is what actually proves criterion 2 (two
 * namespaces agree) and criterion 3 (two concurrent sessions do not clobber
 * each other) — properties that do not show up when each builder is tested
 * with its own independently-scripted provider mock.
 *
 * `@ptah-extension/workspace-intelligence` is mocked because
 * `ast-namespace.builder.ts` imports `EXTENSION_LANGUAGE_MAP` as a runtime
 * value, which transitively loads `tree-sitter-parser.service.ts` →
 * `wasm-bundle-dir.ts` (`import.meta.url`, unparsable under this lib's
 * ts-jest transform) via the real barrel. Mirrors the stubbing pattern
 * already used by `ast-namespace.builder.spec.ts`.
 */
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  EXTENSION_LANGUAGE_MAP: {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
  },
  TreeSitterParserService: class TreeSitterParserServiceStub {},
  AstAnalysisService: class AstAnalysisServiceStub {},
  DEFAULT_WORKSPACE_EXCLUDES: [
    '**/node_modules/**',
    '**/dist/**',
    '**/.git/**',
    '**/build/**',
    '**/.next/**',
    '**/out/**',
    '**/coverage/**',
  ],
}));

import * as path from 'path';
import { FileType } from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  IFileSystemProvider,
} from '@ptah-extension/platform-core';
import type {
  WorkspaceAnalyzerService,
  ContextOrchestrationService,
  AstAnalysisService,
} from '@ptah-extension/workspace-intelligence';
import { buildSessionAwareWorkspaceProvider } from './session-aware-workspace-provider';
import { resolveSessionWorkspaceRoot } from './workspace-root-resolver';
import {
  runWithMcpRequestContext,
  getCallerSessionId,
} from './mcp-core/mcp-request-context';
import {
  buildWorkspaceNamespace,
  buildSearchNamespace,
} from './namespace-builders/core-namespace.builders';
import { buildAstNamespace } from './namespace-builders/ast-namespace.builder';

const IDE_ROOT = 'D:\\projects\\property-hub'; // the IDE/Electron window's folder
const SESSION_B_ROOT = 'D:\\projects\\angular-3d-showcase'; // a session bound elsewhere
const SESSION_C_ROOT = 'D:\\projects\\third-workspace';

interface SessionMap {
  [sessionId: string]: string | undefined;
}

/**
 * Build the exact resolution chain `PtahAPIBuilder.build()` wires per call:
 * a raw provider reporting the IDE/process-global root, wrapped by the
 * session-aware proxy whose resolver is the REAL caller → active-session →
 * provider precedence chain from `workspace-root-resolver.ts`.
 */
function buildSessionAwareProvider(
  rawRoot: string | undefined,
  sessions: SessionMap,
  activeSessionId?: string,
): { provider: IWorkspaceProvider; raw: jest.Mocked<IWorkspaceProvider> } {
  const raw = {
    getWorkspaceRoot: jest.fn().mockReturnValue(rawRoot),
    getWorkspaceFolders: jest.fn().mockReturnValue(rawRoot ? [rawRoot] : []),
    getConfiguration: jest.fn(),
    setConfiguration: jest.fn(),
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn(),
  } as unknown as jest.Mocked<IWorkspaceProvider>;

  const provider = buildSessionAwareWorkspaceProvider(raw, () =>
    resolveSessionWorkspaceRoot({
      getCallerSessionId,
      getSessionWorkspace: (id) => sessions[id],
      getActiveSessionWorkspace: () =>
        activeSessionId ? sessions[activeSessionId] : undefined,
      getProviderRoot: () => raw.getWorkspaceRoot(),
    }),
  );

  return { provider, raw };
}

function mockWorkspaceAnalyzer(): jest.Mocked<
  Pick<
    WorkspaceAnalyzerService,
    'getCurrentWorkspaceInfo' | 'analyzeWorkspaceStructure' | 'getProjectInfo'
  >
> {
  return {
    getCurrentWorkspaceInfo: jest.fn().mockResolvedValue(undefined),
    analyzeWorkspaceStructure: jest.fn().mockResolvedValue(null),
    getProjectInfo: jest
      .fn()
      .mockRejectedValue(new Error('No workspace folder open')),
  } as never;
}

function mockAstAnalysis(): AstAnalysisService {
  return {
    analyzeSource: jest.fn().mockResolvedValue({
      isErr: () => false,
      value: { functions: [], classes: [], imports: [], exports: [] },
    }),
  } as unknown as AstAnalysisService;
}

function mockFileSystemProvider(): IFileSystemProvider {
  return {
    stat: jest.fn().mockResolvedValue({ type: FileType.File }),
    readFile: jest.fn().mockResolvedValue(''),
  } as unknown as IFileSystemProvider;
}

describe('MCP surface — session/root divergence (TASK_2026_200 criteria 1-5)', () => {
  // ---------------------------------------------------------------------
  // Criterion 1 — IDE on A, session on B → ptah_workspace_analyze returns B.
  // ---------------------------------------------------------------------
  describe('criterion 1 — IDE window on A, calling session bound to B', () => {
    it('ptah_workspace_analyze (ptah.workspace.getInfo) resolves the session workspace, not the IDE window folder', async () => {
      const analyzer = mockWorkspaceAnalyzer();
      const { provider } = buildSessionAwareProvider(IDE_ROOT, {
        'tab-1': SESSION_B_ROOT,
      });
      const ns = buildWorkspaceNamespace({
        workspaceAnalyzer: analyzer as unknown as WorkspaceAnalyzerService,
        contextOrchestration: {} as unknown as ContextOrchestrationService,
        workspaceProvider: provider,
        fileSystemProvider: mockFileSystemProvider(),
      });

      await runWithMcpRequestContext({ callerSessionId: 'tab-1' }, () =>
        ns.getInfo(),
      );

      expect(analyzer.getCurrentWorkspaceInfo).toHaveBeenCalledWith(
        SESSION_B_ROOT,
      );
      expect(analyzer.getCurrentWorkspaceInfo).not.toHaveBeenCalledWith(
        IDE_ROOT,
      );
    });
  });

  // ---------------------------------------------------------------------
  // Criterion 2 — ptah_workspace_analyze and ptah_ast_analyze agree.
  // ---------------------------------------------------------------------
  describe('criterion 2 — ptah_workspace_analyze and ptah_ast_analyze agree on the root for the same session', () => {
    it('both namespaces resolve the identical root from the same session-aware provider', async () => {
      const analyzer = mockWorkspaceAnalyzer();
      const astAnalysis = mockAstAnalysis();
      const fileSystemProvider = mockFileSystemProvider();
      const { provider } = buildSessionAwareProvider(IDE_ROOT, {
        'tab-1': SESSION_B_ROOT,
      });

      const workspaceNs = buildWorkspaceNamespace({
        workspaceAnalyzer: analyzer as unknown as WorkspaceAnalyzerService,
        contextOrchestration: {} as unknown as ContextOrchestrationService,
        workspaceProvider: provider,
        fileSystemProvider: mockFileSystemProvider(),
      });
      const astNs = buildAstNamespace({
        treeSitterParser: {} as never,
        astAnalysis,
        fileSystemProvider,
        workspaceProvider: provider,
      });

      await runWithMcpRequestContext({ callerSessionId: 'tab-1' }, async () => {
        await workspaceNs.getInfo();
        // No explicit `workspaceRoot` arg — falls through to the identical
        // session-aware provider `resolveFilePath` reads as its fallback.
        await astNs.analyze('relative/file.ts');
      });

      expect(analyzer.getCurrentWorkspaceInfo).toHaveBeenCalledWith(
        SESSION_B_ROOT,
      );
      // `readFileForAst` -> `resolveFilePath` joins the resolved root onto the
      // relative path, so the absolute path fed to `stat`/`readFile` proves
      // which root `ast.analyze` actually resolved.
      const expectedAbsolutePath = path.join(
        SESSION_B_ROOT,
        'relative/file.ts',
      );
      expect(fileSystemProvider.stat).toHaveBeenCalledWith(
        expectedAbsolutePath,
      );
    });
  });

  // ---------------------------------------------------------------------
  // Criterion 3 — two concurrent sessions on different roots.
  // ---------------------------------------------------------------------
  describe('criterion 3 — two concurrent sessions on different roots', () => {
    it('each MCP call resolves its own session root, never the other session’s cached snapshot', async () => {
      const analyzer = mockWorkspaceAnalyzer();
      // Deliberately slow and interleaved: B's analysis resolves AFTER C's,
      // so if the resolver leaked state across AsyncLocalStorage contexts, C's
      // call (which starts second but finishes first) would be positioned to
      // observe B's still-pending root.
      analyzer.getCurrentWorkspaceInfo.mockImplementation(
        async (root?: string) => {
          await new Promise((r) =>
            setTimeout(r, root === SESSION_B_ROOT ? 10 : 1),
          );
          return {
            name: root,
            path: root,
            projectType: `type-${root}`,
          } as never;
        },
      );
      const { provider } = buildSessionAwareProvider(IDE_ROOT, {
        'tab-b': SESSION_B_ROOT,
        'tab-c': SESSION_C_ROOT,
      });
      const ns = buildWorkspaceNamespace({
        workspaceAnalyzer: analyzer as unknown as WorkspaceAnalyzerService,
        contextOrchestration: {} as unknown as ContextOrchestrationService,
        workspaceProvider: provider,
        fileSystemProvider: mockFileSystemProvider(),
      });

      const callFrom = (sessionId: string) =>
        runWithMcpRequestContext({ callerSessionId: sessionId }, () =>
          ns.getInfo(),
        );

      const [infoB, infoC] = await Promise.all([
        callFrom('tab-b'),
        callFrom('tab-c'),
      ]);

      expect(infoB?.path).toBe(SESSION_B_ROOT);
      expect(infoC?.path).toBe(SESSION_C_ROOT);
    });
  });

  // ---------------------------------------------------------------------
  // Criterion 4 — ptah_search_files scoped to the calling session, R5.
  // ---------------------------------------------------------------------
  describe('criterion 4 — ptah_search_files (ptah.search.findFiles -> fileSystemProvider.findFiles) returns the calling session’s root only', () => {
    it('forwards the session-aware root as cwd to fileSystemProvider.findFiles and returns workspace-relative paths', async () => {
      const fsProvider = {
        findFiles: jest
          .fn()
          .mockResolvedValue([path.join(SESSION_B_ROOT, 'b-only.ts')]),
      };
      const { provider } = buildSessionAwareProvider(IDE_ROOT, {
        'tab-1': SESSION_B_ROOT,
      });
      const ns = buildSearchNamespace({
        workspaceAnalyzer: {} as unknown as WorkspaceAnalyzerService,
        contextOrchestration: {} as unknown as ContextOrchestrationService,
        workspaceProvider: provider,
        fileSystemProvider: fsProvider as unknown as IFileSystemProvider,
      });

      const files = await runWithMcpRequestContext(
        { callerSessionId: 'tab-1' },
        () => ns.findFiles('*.ts'),
      );

      // The session root (SESSION_B_ROOT) must be passed as cwd, NOT IDE_ROOT.
      expect(fsProvider.findFiles.mock.calls[0][3]).toBe(SESSION_B_ROOT);
      // Results are normalized to workspace-relative paths.
      expect(files).toEqual(['b-only.ts']);
    });

    it('propagates filesystem errors instead of swallowing to [] (TASK_2026_299)', async () => {
      const fsProvider = {
        findFiles: jest
          .fn()
          .mockRejectedValue(new Error('filesystem access denied')),
      };
      const { provider } = buildSessionAwareProvider(IDE_ROOT, {
        'tab-1': SESSION_B_ROOT,
      });
      const ns = buildSearchNamespace({
        workspaceAnalyzer: {} as unknown as WorkspaceAnalyzerService,
        contextOrchestration: {} as unknown as ContextOrchestrationService,
        workspaceProvider: provider,
        fileSystemProvider: fsProvider as unknown as IFileSystemProvider,
      });

      await expect(
        runWithMcpRequestContext({ callerSessionId: 'tab-1' }, () =>
          ns.findFiles('*.ts'),
        ),
      ).rejects.toThrow('filesystem access denied');
    });
  });

  // ---------------------------------------------------------------------
  // Criterion 5 — no session and no workspace open.
  // ---------------------------------------------------------------------
  describe('criterion 5 — no session and no workspace open', () => {
    it('the session-aware provider resolves to undefined, never a $HOME fallback (ptah-api-builder.service.ts getWorkspaceRoot vs resolveSessionWorkspaceRoot)', () => {
      // No runWithMcpRequestContext wrapper (simulates stdio/CLI, no caller
      // id) and no active session either — the precedence chain has nothing
      // to resolve to but the raw provider, which also reports nothing open.
      const { provider } = buildSessionAwareProvider(undefined, {});

      expect(provider.getWorkspaceRoot()).toBeUndefined();
    });

    it('ptah.workspace.analyze() surfaces the missing-workspace state rather than an empty success or a resolved path', async () => {
      const analyzer = mockWorkspaceAnalyzer(); // getProjectInfo rejects with the contractual error
      const { provider } = buildSessionAwareProvider(undefined, {});
      const ns = buildWorkspaceNamespace({
        workspaceAnalyzer: analyzer as unknown as WorkspaceAnalyzerService,
        contextOrchestration: {} as unknown as ContextOrchestrationService,
        workspaceProvider: provider,
        fileSystemProvider: mockFileSystemProvider(),
      });

      const result = await ns.analyze();

      // `getCurrentWorkspaceInfo`/`analyzeWorkspaceStructure` degrade to
      // undefined/null (the pre-fix contract, preserved); `getProjectInfo`'s
      // rejection is caught internally by `.catch(() => undefined)` — none of
      // this is a `$HOME`-rooted or otherwise fabricated success result.
      expect(result.info).toBeUndefined();
      expect(result.projectInfo).toBeUndefined();
      expect(analyzer.getCurrentWorkspaceInfo).toHaveBeenCalledWith(undefined);
    });
  });
});
