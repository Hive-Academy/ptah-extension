/**
 * Workspace Analyzer Service - Composite Facade for Workspace Intelligence
 *
 * ARCHITECTURE: Facade pattern that aggregates all workspace-intelligence services
 * into a single, cohesive API. Replaces the monolithic WorkspaceManager.
 *
 * This service acts as the orchestration layer, delegating to specialized services:
 * - ProjectDetectorService (project type detection)
 * - FrameworkDetectorService (framework detection)
 * - DependencyAnalyzerService (dependency analysis)
 * - WorkspaceService (workspace structure and file tree)
 * - ContextService (context optimization and file search)
 * - WorkspaceIndexerService (file indexing)
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  normalizeWorkspaceRoot,
} from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  IDisposable,
} from '@ptah-extension/platform-core';
import { ProjectType } from '../types/workspace.types';
import { FileSystemService } from '../services/file-system.service';
import { ProjectDetectorService } from '../project-analysis/project-detector.service';
import { FrameworkDetectorService } from '../project-analysis/framework-detector.service';
import { DependencyAnalyzerService } from '../project-analysis/dependency-analyzer.service';
import {
  WorkspaceService,
  ProjectInfo,
  WorkspaceStructureAnalysis,
} from '../workspace/workspace.service';
import { ContextService } from '../context/context.service';
import { WorkspaceIndexerService } from '../file-indexing/workspace-indexer.service';
import { TreeSitterParserService } from '../ast/tree-sitter-parser.service';
import { AstAnalysisService } from '../ast/ast-analysis.service';
import { CodeInsights } from '../ast/ast-analysis.interfaces';
import { SupportedLanguage } from '../ast/ast.types';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';

/**
 * Workspace information interface (matches old WorkspaceManager)
 */
export interface WorkspaceInfo {
  readonly name: string;
  readonly path: string;
  readonly projectType: string;
  readonly frameworks?: readonly string[];
  readonly hasPackageJson?: boolean;
  readonly hasTsConfig?: boolean;
}

/**
 * Context recommendations for AI interactions
 */
export interface ContextRecommendations {
  readonly recommendedFiles: readonly string[];
  readonly criticalFiles: readonly string[];
  readonly frameworkSpecific: readonly string[];
}

/**
 * Largest number of distinct roots whose `WorkspaceInfo` is kept in memory.
 *
 * A long-lived Electron/CLI process can be pointed at an unbounded number of
 * roots over its lifetime (every `workspace:switch`, every MCP session bound to
 * a different `projectPath`). The map is therefore capped and evicts in
 * insertion order; a cache miss only costs a re-analysis, never a wrong answer.
 */
const MAX_CACHED_WORKSPACE_ROOTS = 8;

/**
 * An in-flight `WorkspaceInfo` analysis plus its cancellation fence.
 * Setting `fence.cancelled` is the only way to stop a parked computation from
 * publishing its result into the cache.
 */
interface PendingWorkspaceInfo {
  readonly fence: { cancelled: boolean };
  readonly promise: Promise<WorkspaceInfo | undefined>;
}

/**
 * Workspace Analyzer Service - Unified facade for workspace intelligence
 *
 * @example
 * ```typescript
 * const analyzer = container.resolve<WorkspaceAnalyzerService>(TOKENS.WORKSPACE_ANALYZER);
 *
 * // Get current workspace info
 * const info = await analyzer.getCurrentWorkspaceInfo();
 *
 * // Detect project type
 * const projectType = await analyzer.detectProjectType('/path/to/workspace');
 *
 * // Analyze workspace structure
 * const analysis = await analyzer.analyzeWorkspaceStructure();
 * ```
 */
@injectable()
export class WorkspaceAnalyzerService implements IDisposable {
  private disposables: IDisposable[] = [];

  /**
   * ROOT MODEL (TASK_2026_200, task 3.2) — root-keyed, genuinely concurrent.
   *
   * This service was a single unkeyed `workspaceInfo` field populated once at
   * construction, so two concurrent MCP sessions bound to different roots both
   * received whichever snapshot happened to be cached (context.md §2.1). It is
   * now a `Map` keyed on `normalizeWorkspaceRoot(root)`.
   *
   * NOTE this deliberately differs from `WorkspaceFileIndexService`'s
   * single-active-root-with-rebuild model. context.md §7.2 rules concurrent
   * multi-root out of scope for the *picker / file-index* surface only; the
   * analyzer serves MCP sessions, which ARE concurrent, so criterion 3 (two
   * concurrent sessions, distinct roots, no folder-change event between the
   * calls) is only reachable with a real per-root map. Do not collapse this
   * back to a single snapshot field.
   *
   * Concurrency contract for every entry below: the key is derived
   * synchronously from the caller's root BEFORE any `await`, and every write is
   * guarded by a cancellation-fence check performed in the same synchronous
   * block as the write — not merely "somewhere upstream". A cache entry can
   * therefore never be published for a root other than the one its computation
   * started for, and an entry invalidated while its computation was in flight
   * is never resurrected.
   */
  private readonly workspaceInfoByRoot = new Map<string, WorkspaceInfo>();

  /**
   * De-dupes concurrent analyses of the same root AND carries that analysis's
   * invalidation fence.
   *
   * The fence is a per-computation object rather than a per-key counter on
   * purpose: a counter map has to be bounded, and pruning a counter resets it
   * to zero — which would let a long-parked computation whose key was
   * invalidated twice compare equal again and publish a stale entry. Object
   * identity cannot be reset, and it is collected with the computation.
   */
  private readonly inFlightInfoByRoot = new Map<string, PendingWorkspaceInfo>();

  /** Normalized keys of the folders the platform reported at the last check. */
  private knownFolderKeys = new Set<string>();

  constructor(
    @inject(TOKENS.FILE_SYSTEM_SERVICE)
    private readonly fileSystemService: FileSystemService,
    @inject(TOKENS.PROJECT_DETECTOR_SERVICE)
    private readonly projectDetector: ProjectDetectorService,
    @inject(TOKENS.FRAMEWORK_DETECTOR_SERVICE)
    private readonly frameworkDetector: FrameworkDetectorService,
    @inject(TOKENS.DEPENDENCY_ANALYZER_SERVICE)
    private readonly dependencyAnalyzer: DependencyAnalyzerService,
    @inject(TOKENS.WORKSPACE_SERVICE)
    private readonly workspaceService: WorkspaceService,
    @inject(TOKENS.CONTEXT_SERVICE)
    private readonly contextService: ContextService,
    @inject(TOKENS.WORKSPACE_INDEXER_SERVICE)
    private readonly indexer: WorkspaceIndexerService,
    @inject(TOKENS.TREE_SITTER_PARSER_SERVICE)
    private readonly treeSitterParser: TreeSitterParserService,
    @inject(TOKENS.AST_ANALYSIS_SERVICE)
    private readonly astAnalyzer: AstAnalysisService,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
  ) {
    this.initialize();
  }

  /**
   * Initialize workspace analyzer
   */
  private initialize(): void {
    this.knownFolderKeys = this.readCurrentFolderKeys();

    const workspaceWatcher = this.workspaceProvider.onDidChangeWorkspaceFolders(
      () => {
        this.handleWorkspaceFoldersChanged();
      },
    );

    this.disposables.push(workspaceWatcher);
    void this.primeActiveRoot();
  }

  /**
   * Get workspace information for a specific root.
   *
   * @param root - Explicit workspace root. When supplied it wins
   *   unconditionally over the process-global active folder — this is what
   *   lets an MCP session bound to workspace B get B's answer while the IDE
   *   window sits on workspace A (context.md criterion 1). When omitted, the
   *   process-global active folder is used, which is the pre-fix behaviour.
   * @returns Cached-or-computed info, or `undefined` when no workspace
   *   resolves or the analysis fails.
   */
  async getCurrentWorkspaceInfo(
    root?: string,
  ): Promise<WorkspaceInfo | undefined> {
    const target = root ?? this.workspaceProvider.getWorkspaceRoot();
    if (!target) {
      return undefined;
    }
    return this.resolveWorkspaceInfo(target);
  }

  /**
   * Detect project type for a specific workspace path
   * Delegates to ProjectDetectorService
   *
   * @param workspacePath - Path to analyze
   * @returns Project type enum value
   */
  async detectProjectType(workspacePath: string): Promise<ProjectType> {
    return await this.projectDetector.detectProjectType(workspacePath);
  }

  /**
   * Get comprehensive project information
   * Combines data from multiple detection services
   *
   * @param root - Explicit workspace root; wins over the process-global active
   *   folder when supplied. Omitted → pre-fix behaviour.
   * @returns Project info with type, dependencies, file statistics
   * @throws Error `'No workspace folder open'` when neither the explicit root
   *   nor the platform provider yields an analyzable workspace. Criterion 5:
   *   this error is contractual — never substitute a `$HOME` fallback or an
   *   empty success result for it.
   */
  async getProjectInfo(root?: string): Promise<ProjectInfo> {
    const projectInfo = await this.workspaceService.getProjectInfo(root);

    if (!projectInfo) {
      throw new Error('No workspace folder open');
    }

    return projectInfo;
  }

  /**
   * Get recommended context template based on project type
   * Uses framework detection and project analysis
   *
   * @returns Context template string (e.g., 'python', 'react', 'node')
   */
  async getRecommendedContextTemplate(): Promise<string> {
    return this.workspaceService.getRecommendedContextTemplate();
  }

  /**
   * Analyze complete workspace structure
   * Delegates to WorkspaceService for comprehensive analysis
   *
   * @param root - Explicit workspace root; wins over the process-global active
   *   folder when supplied. Omitted → pre-fix behaviour.
   * @returns Workspace structure analysis with project type and recommendations
   */
  async analyzeWorkspaceStructure(
    root?: string,
  ): Promise<WorkspaceStructureAnalysis | null> {
    return await this.workspaceService.analyzeWorkspaceStructure(root);
  }

  /**
   * Get context recommendations for AI interactions
   * Uses ContextService and file analysis
   *
   * @returns Recommended files for AI context
   */
  async getContextRecommendations(): Promise<ContextRecommendations> {
    const workspacePath = this.workspaceProvider.getWorkspaceRoot();
    if (!workspacePath) {
      return {
        recommendedFiles: [],
        criticalFiles: [],
        frameworkSpecific: [],
      };
    }
    const info = await this.getProjectInfo();
    const criticalFiles = this.getCriticalFiles(info);
    const frameworkSpecific = await this.getFrameworkSpecificFiles();
    const contextFiles = await this.contextService.getAllFiles(false, 0, 100);

    return {
      recommendedFiles: contextFiles.map((f) => f.relativePath),
      criticalFiles,
      frameworkSpecific,
    };
  }

  /**
   * Eagerly analyze the process-global active folder, preserving the pre-fix
   * behaviour of having an answer ready right after construction.
   */
  private primeActiveRoot(): Promise<void> {
    const activeRoot = this.workspaceProvider.getWorkspaceRoot();
    if (!activeRoot) {
      return Promise.resolve();
    }
    return this.resolveWorkspaceInfo(activeRoot).then(() => undefined);
  }

  /**
   * Per-key cache invalidation on a platform folder change.
   *
   * `IWorkspaceProvider.onDidChangeWorkspaceFolders` is `IEvent<void>` — it does
   * not say WHICH folder changed — so the removed set is derived by diffing the
   * folder list against the previously observed one. Only roots that were open
   * and are now gone are evicted; every other key (a still-open folder, or a
   * session root that was never in the platform's folder list at all) keeps its
   * snapshot. Wiping the whole map here would re-create the single-snapshot
   * behaviour this task removed.
   */
  private handleWorkspaceFoldersChanged(): void {
    const currentKeys = this.readCurrentFolderKeys();

    for (const key of this.knownFolderKeys) {
      if (!currentKeys.has(key)) {
        this.invalidateRoot(key);
      }
    }
    this.knownFolderKeys = currentKeys;

    // Pre-fix behaviour preserved: the active folder's snapshot is refreshed
    // eagerly on every folder-change event.
    const activeRoot = this.workspaceProvider.getWorkspaceRoot();
    if (!activeRoot) {
      return;
    }
    this.invalidateRoot(normalizeWorkspaceRoot(activeRoot));
    void this.resolveWorkspaceInfo(activeRoot);
  }

  /** Normalized keys of the folders the platform currently reports. */
  private readCurrentFolderKeys(): Set<string> {
    try {
      const folders = this.workspaceProvider.getWorkspaceFolders() ?? [];
      return new Set(folders.map((folder) => normalizeWorkspaceRoot(folder)));
    } catch (error: unknown) {
      this.logger.debug(
        `Unable to read workspace folders: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return new Set<string>();
    }
  }

  /**
   * Cache-or-compute the `WorkspaceInfo` for one root.
   *
   * Every statement between the cache read and the in-flight registration is
   * synchronous — there is no `await` between the check and the write, so a
   * second caller for the same root cannot slip past the de-dupe.
   */
  private resolveWorkspaceInfo(
    root: string,
  ): Promise<WorkspaceInfo | undefined> {
    const key = normalizeWorkspaceRoot(root);

    const cached = this.workspaceInfoByRoot.get(key);
    if (cached) {
      return Promise.resolve(cached);
    }

    const inFlight = this.inFlightInfoByRoot.get(key);
    if (inFlight) {
      return inFlight.promise;
    }

    const fence = { cancelled: false };
    const promise = this.computeWorkspaceInfo(root, key, fence).finally(() => {
      if (this.inFlightInfoByRoot.get(key)?.fence === fence) {
        this.inFlightInfoByRoot.delete(key);
      }
    });
    this.inFlightInfoByRoot.set(key, { fence, promise });
    return promise;
  }

  /**
   * Build the `WorkspaceInfo` for an explicit root.
   *
   * `key` and `fence` are captured by the caller BEFORE the first `await`, and
   * the fence is re-checked in the same synchronous block as the cache write —
   * so a result computed for root A can never be published under root B, and a
   * result whose key was invalidated mid-flight is returned to its caller but
   * never cached.
   */
  private async computeWorkspaceInfo(
    workspacePath: string,
    key: string,
    fence: { cancelled: boolean },
  ): Promise<WorkspaceInfo | undefined> {
    try {
      const info = await this.getProjectInfo(workspacePath);
      const projectType =
        await this.projectDetector.detectProjectType(workspacePath);
      const projectTypesMap = new Map<string, ProjectType>();
      projectTypesMap.set(workspacePath, projectType);

      const frameworksMap =
        await this.frameworkDetector.detectFrameworks(projectTypesMap);
      const framework = frameworksMap.get(workspacePath);
      const hasTypeScript =
        info.dependencies.some((dep) => dep === 'typescript') ||
        info.devDependencies.some((dep) => dep === 'typescript') ||
        Object.keys(info.fileStatistics).some((extension) =>
          extension.includes('.ts'),
        );

      const built: WorkspaceInfo = {
        name: info.name,
        path: info.path,
        projectType: info.type,
        frameworks: framework ? [framework] : [],
        hasPackageJson: info.dependencies.length > 0, // If we have dependencies, package.json exists
        hasTsConfig: hasTypeScript,
      };

      // Publish. Guard and write are adjacent — no `await` between them.
      if (!fence.cancelled) {
        this.rememberWorkspaceInfo(key, built);
      }

      return built;
    } catch (error: unknown) {
      this.logger.error(
        `Failed to analyze workspace ${workspacePath}`,
        error instanceof Error ? error : new Error(String(error)),
      );
      return undefined;
    }
  }

  /**
   * Drop a root's cached snapshot and fence any analysis still in flight for
   * it, so a late-resuming computation cannot resurrect the stale entry.
   * Fully synchronous.
   */
  private invalidateRoot(key: string): void {
    this.workspaceInfoByRoot.delete(key);

    const pending = this.inFlightInfoByRoot.get(key);
    if (pending) {
      pending.fence.cancelled = true;
      this.inFlightInfoByRoot.delete(key);
    }
  }

  /** Insert with an insertion-order (FIFO) bound. */
  private rememberWorkspaceInfo(key: string, info: WorkspaceInfo): void {
    this.workspaceInfoByRoot.delete(key);
    this.workspaceInfoByRoot.set(key, info);

    while (this.workspaceInfoByRoot.size > MAX_CACHED_WORKSPACE_ROOTS) {
      const oldest = this.workspaceInfoByRoot.keys().next();
      if (oldest.done) {
        break;
      }
      this.workspaceInfoByRoot.delete(oldest.value);
    }
  }

  /**
   * Get critical files for a project type
   */
  private getCriticalFiles(info: ProjectInfo): string[] {
    const critical: string[] = ['README.md'];
    if (info.dependencies.length > 0 || info.devDependencies.length > 0) {
      critical.push('package.json');
    }
    const hasTypeScript =
      info.dependencies.some((dep) => dep === 'typescript') ||
      info.devDependencies.some((dep) => dep === 'typescript');

    if (hasTypeScript) {
      critical.push('tsconfig.json');
    }
    if (info.type === ProjectType.Node) {
      critical.push('package.json', 'tsconfig.json');
    } else if (info.type === ProjectType.React) {
      critical.push('src/App.tsx', 'src/index.tsx');
    } else if (info.type === ProjectType.Angular) {
      critical.push('angular.json', 'src/main.ts');
    } else if (info.type === ProjectType.NextJS) {
      critical.push('next.config.js', 'pages/_app.tsx');
    }

    return critical;
  }

  /**
   * Get framework-specific files
   * Note: This method needs workspace URI to detect frameworks
   */
  private async getFrameworkSpecificFiles(): Promise<string[]> {
    const files: string[] = [];
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (!workspaceRoot) {
      return files;
    }
    const projectType =
      await this.projectDetector.detectProjectType(workspaceRoot);
    const projectTypesMap = new Map<string, ProjectType>();
    projectTypesMap.set(workspaceRoot, projectType);

    const frameworksMap =
      await this.frameworkDetector.detectFrameworks(projectTypesMap);
    const framework = frameworksMap.get(workspaceRoot);

    if (!framework) {
      return files;
    }

    switch (framework) {
      case 'react':
        files.push('src/**/*.tsx', 'src/**/*.jsx');
        break;
      case 'angular':
        files.push('src/**/*.component.ts', 'src/**/*.service.ts');
        break;
      case 'vue':
        files.push('src/**/*.vue');
        break;
      case 'nextjs':
        files.push('pages/**/*.tsx', 'app/**/*.tsx');
        break;
      case 'express':
        files.push('src/**/*.controller.ts', 'src/**/*.service.ts');
        break;
    }

    return files;
  }

  /**
   * Extracts code insights from a TypeScript/JavaScript file using query-based AST analysis.
   *
   * Uses AstAnalysisService.analyzeSource() which leverages tree-sitter's native query
   * pattern matching to extract functions, classes, imports, and exports directly from
   * source code. This is the preferred path as it avoids intermediate AST node conversion.
   *
   * @param filePath - Absolute path to TypeScript/JavaScript file
   * @returns Code insights (functions, classes, imports, exports) or null on failure
   *
   * @example
   * ```typescript
   * const insights = await analyzer.extractCodeInsights('/path/to/file.ts');
   * if (insights) {
   *   console.log(`Found ${insights.functions.length} functions`);
   *   console.log(`Found ${insights.classes.length} classes`);
   *   console.log(`Found ${insights.imports.length} imports`);
   * }
   * ```
   */
  async extractCodeInsights(filePath: string): Promise<CodeInsights | null> {
    try {
      const content = await this.fileSystemService.readFile(filePath);
      const language: SupportedLanguage =
        filePath.endsWith('.ts') || filePath.endsWith('.tsx')
          ? 'typescript'
          : 'javascript';

      this.logger.debug(
        `Extracting code insights from ${filePath} (language: ${language})`,
      );
      const insightsResult = await this.astAnalyzer.analyzeSource(
        content,
        language,
        filePath,
      );

      if (insightsResult.isErr()) {
        this.logger.error(
          `AST analysis failed for ${filePath}`,
          insightsResult.error ?? new Error('Unknown analysis error'),
        );
        return null;
      }

      this.logger.debug(`Code insights extracted successfully for ${filePath}`);
      return insightsResult.value ?? null;
    } catch (error) {
      this.logger.error(
        `Error extracting code insights from ${filePath}:`,
        error instanceof Error ? error : new Error(String(error)),
      );
      return null;
    }
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    this.workspaceInfoByRoot.clear();
    for (const pending of this.inFlightInfoByRoot.values()) {
      pending.fence.cancelled = true;
    }
    this.inFlightInfoByRoot.clear();
    this.knownFolderKeys = new Set<string>();
  }
}
