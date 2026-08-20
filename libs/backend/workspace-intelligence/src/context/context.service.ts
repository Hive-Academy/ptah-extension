import { injectable, inject } from 'tsyringe';
import * as fs from 'fs';
import * as path from 'path';
import {
  PLATFORM_TOKENS,
  normalizeWorkspaceRoot,
} from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
  IEditorProvider,
  ICommandRegistry,
  IDisposable,
} from '@ptah-extension/platform-core';
import type {
  ContextInfo,
  OptimizationSuggestion,
} from '@ptah-extension/shared';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import {
  IgnorePatternResolverService,
  type ParsedIgnoreFile,
} from '../file-indexing/ignore-pattern-resolver.service';
import { DEFAULT_WORKSPACE_EXCLUDES } from '../file-indexing/workspace-default-excludes';
import {
  WorkspaceFileIndexService,
  type FileSearchResult,
} from '../file-indexing/workspace-file-index.service';

const LOGGER = Symbol.for('Logger');
const CONFIG_MANAGER = Symbol.for('ConfigManager');

/**
 * Logger interface (avoids circular dependency with vscode-core)
 */
interface ILogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, error?: unknown): void;
  debug(message: string, ...args: unknown[]): void;
}

/**
 * ConfigManager interface (avoids circular dependency with vscode-core)
 */
interface IConfigManager {
  get(key: string): unknown;
}

/**
 * File search result with metadata for `@` syntax autocomplete.
 *
 * Re-exported from the live index service so the public API path
 * (`context.service.ts` + the lib barrel) is unchanged.
 */
export type { FileSearchResult };

/**
 * Search options for file queries with performance optimizations
 */
export interface FileSearchOptions {
  readonly query: string;
  readonly includeImages?: boolean;
  readonly includeHidden?: boolean;
  readonly maxResults?: number;
  readonly sortBy?: 'name' | 'path' | 'modified' | 'relevance';
  readonly fileTypes?: string[];
  /**
   * Answer for this workspace root specifically. Omit for the process-global
   * active folder (today's behaviour). See {@link WorkspaceRootMismatchError}.
   */
  readonly workspaceRoot?: string;
}

/**
 * Thrown when a caller asked for a specific workspace root and the file index
 * is not — or is no longer — holding it.
 *
 * This is the "loud mismatch" half of TASK_2026_200's R5 rule. The index is
 * single-active-root by design (context.md §7.2): a request for root B
 * supersedes root A, so two roots cannot be served at the same instant. The one
 * outcome that is NEVER acceptable is quietly returning the other root's files
 * — that silent wrong answer is the entire defect class this task exists to
 * kill. When a rebuild for the requested root cannot be honoured, the caller
 * gets this error instead of somebody else's file list.
 */
export class WorkspaceRootMismatchError extends Error {
  constructor(
    readonly requestedRoot: string,
    readonly indexedRoot: string | undefined,
  ) {
    super(
      `Workspace file index is not serving the requested root. ` +
        `Requested "${requestedRoot}", index currently holds ` +
        `"${indexedRoot ?? '<none>'}". The index serves one workspace at a ` +
        `time; a concurrent request for another workspace superseded this one.`,
    );
    this.name = 'WorkspaceRootMismatchError';
  }
}

/**
 * ContextService - Manages file context for AI interactions
 *
 * BUSINESS LOGIC: File search, context optimization, token estimation.
 *
 * File-search (`@` autocomplete) is served entirely by the live, watcher-
 * maintained {@link WorkspaceFileIndexService}: no per-query disk walk, no TTL
 * caches, no redundant ignore re-filtering, no serial stat loop. New/deleted
 * files show up immediately because the index patches itself from file-watcher
 * events.
 */
@injectable()
export class ContextService {
  private includedFiles: Set<string> = new Set();
  private excludedFiles: Set<string> = new Set();
  private readonly MAX_TOKENS = 200000;
  private readonly CHARS_PER_TOKEN = 4; // Rough estimate
  private readonly MAX_SEARCH_RESULTS = 1000;
  private readonly IGNORE_CACHE_TTL_MS = 60 * 1000;
  private ignoreFilesCache = new Map<
    string,
    { ignoreFiles: ParsedIgnoreFile[]; expiresAt: number }
  >();

  constructor(
    @inject(LOGGER) private readonly logger: ILogger,
    @inject(CONFIG_MANAGER) private readonly configManager: IConfigManager,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fsProvider: IFileSystemProvider,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.EDITOR_PROVIDER)
    private readonly editorProvider: IEditorProvider,
    @inject(PLATFORM_TOKENS.COMMAND_REGISTRY)
    private readonly commandRegistry: ICommandRegistry,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(TOKENS.IGNORE_PATTERN_RESOLVER_SERVICE)
    private readonly ignoreResolver: IgnorePatternResolverService,
    @inject(TOKENS.WORKSPACE_FILE_INDEX_SERVICE)
    private readonly fileIndex: WorkspaceFileIndexService,
  ) {
    this.loadFromWorkspaceState();
  }

  /**
   * Include file in context
   */
  async includeFile(filePath: string): Promise<void> {
    if (this.includedFiles.has(filePath)) {
      return; // Already included
    }
    if (!filePath || filePath.trim() === '' || filePath === 'tasks') {
      this.logger.warn(`Invalid file path provided: ${filePath}`);
      return;
    }
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      this.logger.warn(`Cannot include file (not readable): ${filePath}`);
      throw new Error(`File is not readable: ${filePath}`);
    }

    this.includedFiles.add(filePath);
    this.excludedFiles.delete(filePath); // Remove from excluded if it was there

    this.logger.info(`Included file in context: ${filePath}`);

    await this.saveToWorkspaceState();
    await this.notifyContextChanged();
  }

  /**
   * Exclude file from context
   */
  async excludeFile(filePath: string): Promise<void> {
    this.includedFiles.delete(filePath);
    this.excludedFiles.add(filePath);

    this.logger.info(`Excluded file from context: ${filePath}`);

    await this.saveToWorkspaceState();
    await this.notifyContextChanged();
  }

  /**
   * Check if file is included in context
   */
  isFileIncluded(filePath: string): boolean {
    return this.includedFiles.has(filePath);
  }

  /**
   * Check if file is excluded from context
   */
  isFileExcluded(filePath: string): boolean {
    return this.excludedFiles.has(filePath);
  }

  /**
   * Get current context information
   */
  getCurrentContext(): ContextInfo {
    const tokenEstimate = this.getTokenEstimate();
    const optimizations = this.getOptimizationSuggestions();

    return {
      includedFiles: Array.from(this.includedFiles),
      excludedFiles: Array.from(this.excludedFiles),
      tokenEstimate,
      optimizations,
    };
  }

  /**
   * Estimate total tokens in current context
   */
  getTokenEstimate(): number {
    let totalChars = 0;

    for (const filePath of this.includedFiles) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        totalChars += content.length;
      } catch (error) {
        this.logger.warn(
          `Failed to read file for token estimation: ${filePath}`,
          error,
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'ContextService.getTokenEstimate' },
        );
      }
    }

    return Math.ceil(totalChars / this.CHARS_PER_TOKEN);
  }

  /**
   * Generate optimization suggestions based on current context
   */
  getOptimizationSuggestions(): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];
    const currentTokens = this.getTokenEstimate();

    if (currentTokens > this.MAX_TOKENS * 0.8) {
      const largeFiles = this.findLargeFiles();
      if (largeFiles.length > 0) {
        suggestions.push({
          type: 'exclude_pattern',
          description: `Exclude ${largeFiles.length} large files to reduce token usage`,
          estimatedSavings: this.estimateTokenSavings(largeFiles),
          autoApplicable: true,
          files: largeFiles,
        });
      }
      const testFiles = this.findTestFiles();
      if (testFiles.length > 0) {
        suggestions.push({
          type: 'exclude_pattern',
          description: `Exclude ${testFiles.length} test files`,
          estimatedSavings: this.estimateTokenSavings(testFiles),
          autoApplicable: true,
          files: testFiles,
        });
      }
      const buildFiles = this.findBuildFiles();
      if (buildFiles.length > 0) {
        suggestions.push({
          type: 'exclude_pattern',
          description: `Exclude ${buildFiles.length} build/generated files`,
          estimatedSavings: this.estimateTokenSavings(buildFiles),
          autoApplicable: true,
          files: buildFiles,
        });
      }
    }

    return suggestions;
  }

  /**
   * Apply optimization suggestion
   */
  async applyOptimization(suggestion: OptimizationSuggestion): Promise<void> {
    if (suggestion.files) {
      for (const filePath of suggestion.files) {
        await this.excludeFile(filePath);
      }
    }

    this.logger.info(`Applied optimization: ${suggestion.description}`);
  }

  /**
   * Refresh context by removing non-existent files
   */
  async refreshContext(): Promise<void> {
    const filesToRemove: string[] = [];

    for (const filePath of this.includedFiles) {
      try {
        await fs.promises.access(filePath, fs.constants.R_OK);
      } catch {
        filesToRemove.push(filePath);
      }
    }

    for (const filePath of filesToRemove) {
      this.includedFiles.delete(filePath);
      this.logger.info(`Removed non-existent file from context: ${filePath}`);
    }

    if (filesToRemove.length > 0) {
      await this.saveToWorkspaceState();
      await this.notifyContextChanged();
    }
  }

  /**
   * Update file content (for future use)
   */
  async updateFileContent(filePath: string, _content: string): Promise<void> {
    this.logger.info(`File content updated: ${filePath}`);
  }

  /**
   * Apply project template for context initialization
   */
  async applyProjectTemplate(projectType: string): Promise<void> {
    const templates: Record<string, { include: string[]; exclude: string[] }> =
      {
        react: {
          include: ['src/**/*.{ts,tsx,js,jsx}', 'package.json', 'README.md'],
          exclude: [
            'node_modules/**',
            'build/**',
            'dist/**',
            '**/*.test.*',
            '**/*.spec.*',
          ],
        },
        python: {
          include: ['**/*.py', 'requirements.txt', 'README.md', 'setup.py'],
          exclude: [
            '__pycache__/**',
            'venv/**',
            '.venv/**',
            '**/*test*.py',
            '**/*spec*.py',
          ],
        },
        node: {
          include: ['src/**/*.{ts,js}', 'package.json', 'README.md'],
          exclude: [
            'node_modules/**',
            'dist/**',
            'build/**',
            '**/*.test.*',
            '**/*.spec.*',
          ],
        },
        java: {
          include: ['src/**/*.java', 'pom.xml', 'build.gradle', 'README.md'],
          exclude: [
            'target/**',
            'build/**',
            '**/test/**',
            '**/*Test.java',
            '**/*Tests.java',
          ],
        },
      };

    const template = templates[projectType];
    if (!template) {
      this.logger.warn(`Unknown project template: ${projectType}`);
      return;
    }
    this.includedFiles.clear();
    this.excludedFiles.clear();

    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }
    const templateExcludes = await this.getEffectiveExcludes(
      workspaceRoot,
      template.exclude,
    );
    for (const pattern of template.include) {
      const rawIncluded = await this.fsProvider.findFiles(
        pattern,
        templateExcludes,
        undefined,
        workspaceRoot,
      );
      const included = await this.filterIgnored(rawIncluded, workspaceRoot);
      for (const file of included) {
        this.includedFiles.add(file);
      }
    }
    for (const pattern of template.exclude) {
      const files = await this.fsProvider.findFiles(
        pattern,
        undefined,
        undefined,
        workspaceRoot,
      );
      for (const file of files) {
        this.excludedFiles.add(file);
        this.includedFiles.delete(file);
      }
    }

    this.logger.info(
      `Applied ${projectType} project template: ${this.includedFiles.size} files included`,
    );

    await this.saveToWorkspaceState();
    await this.notifyContextChanged();
  }

  /**
   * ENHANCED FILE SEARCH FUNCTIONALITY - For `@` syntax autocomplete
   *
   * All queries are served from the in-memory {@link WorkspaceFileIndexService}.
   */

  /**
   * Ask the file index to hold `workspaceRoot`, or — when it is omitted — the
   * process-global active folder (today's behaviour, no throw).
   *
   * This is the REBUILD half of R5: `ensureReadyFor` supersedes whatever root
   * the index currently holds and rebuilds for the requested one, so the normal
   * outcome of "requested root ≠ built root" is a rebuild, not an error.
   *
   * ⚠️ This method AWAITS. It therefore cannot be the last word on which root
   * the index holds — see {@link assertIndexServes}, which every caller must
   * run again in the same synchronous block as its query.
   */
  private async ensureIndexFor(workspaceRoot?: string): Promise<void> {
    if (workspaceRoot === undefined) {
      await this.fileIndex.ensureReady();
      return;
    }
    await this.fileIndex.ensureReadyFor(workspaceRoot);
  }

  /**
   * The ERROR half of R5, and the reason it is a separate, SYNCHRONOUS method.
   *
   * `ensureIndexFor` awaits. Awaiting yields to the microtask queue, and the
   * index is a process-wide singleton whose `ensureReadyFor` clears the maps
   * SYNCHRONOUSLY before its first await. So between "our rebuild for A
   * resolved" and "we read the maps", another in-flight request for root B can
   * run its continuation and take the index away from us. Re-checking after the
   * await is not paranoia — it is the only point at which the answer is true.
   *
   * Callers MUST invoke this immediately before their `fileIndex.*` read, with
   * NO await in between. Every read below (`search`, `getAll`,
   * `searchDirectories`) is synchronous, so guard + read form one atomic block
   * and the check cannot go stale between them. If you ever introduce an await
   * into one of those blocks, this guard stops working and the silent
   * wrong-workspace answer comes back.
   *
   * We do not retry/rebuild in a loop here: under two callers contending for
   * different roots that livelocks. Losing the race is rare, and a loud error
   * is an acceptable outcome under context.md §7.2 — a quiet one is not.
   */
  private assertIndexServes(workspaceRoot?: string): void {
    if (workspaceRoot === undefined) return;
    const requestedKey = normalizeWorkspaceRoot(workspaceRoot);
    if (this.fileIndex.indexedRoot === requestedKey) return;
    throw new WorkspaceRootMismatchError(
      workspaceRoot,
      this.fileIndex.indexedRoot,
    );
  }

  /**
   * Search files by fuzzy query. Backed by the live index (synchronous scoring
   * over the in-memory list) — instant and always fresh.
   *
   * `options.workspaceRoot` scopes the answer to one workspace; omitting it
   * keeps the pre-TASK_2026_200 behaviour (process-global active folder).
   */
  async searchFiles(options: FileSearchOptions): Promise<FileSearchResult[]> {
    await this.ensureIndexFor(options.workspaceRoot);

    const {
      query,
      includeImages = false,
      maxResults = 100,
      fileTypes = [],
    } = options;

    // R5 guard + index read: one synchronous block, do not separate them.
    this.assertIndexServes(options.workspaceRoot);
    let results = this.fileIndex.search(
      query,
      Math.max(maxResults * 2, maxResults),
    );

    if (fileTypes.length > 0) {
      const exts = fileTypes.map((ext) =>
        ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`,
      );
      results = results.filter((r) =>
        exts.some((ext) => r.fileName.toLowerCase().endsWith(ext)),
      );
    } else if (!includeImages) {
      results = results.filter((r) => r.fileType !== 'image');
    }

    return results.slice(0, maxResults);
  }

  /**
   * Get all workspace files (and directories) with pagination. Served from the
   * live index; supports virtual scrolling via offset/limit.
   */
  async getAllFiles(
    includeImages = false,
    offset = 0,
    limit = this.MAX_SEARCH_RESULTS,
    workspaceRoot?: string,
  ): Promise<FileSearchResult[]> {
    await this.ensureIndexFor(workspaceRoot);

    // R5 guard + index read: one synchronous block, do not separate them.
    this.assertIndexServes(workspaceRoot);
    let all = this.fileIndex.getAll(this.MAX_SEARCH_RESULTS);
    if (!includeImages) {
      all = all.filter((f) => f.fileType !== 'image');
    }
    return all.slice(offset, offset + limit);
  }

  /**
   * Search for image files specifically
   */
  async searchImageFiles(query: string): Promise<FileSearchResult[]> {
    const imageExtensions = [
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.bmp',
      '.svg',
      '.webp',
      '.ico',
    ];

    return this.searchFiles({
      query,
      includeImages: true,
      fileTypes: imageExtensions,
      maxResults: 100,
      sortBy: 'relevance',
    });
  }

  /**
   * Get file suggestions based on current context and patterns
   */
  async getFileSuggestions(
    query: string,
    limit = 20,
    workspaceRoot?: string,
  ): Promise<FileSearchResult[]> {
    await this.ensureIndexFor(workspaceRoot);

    if (!query || query.length < 2) {
      // Delegates: `getAllFiles` re-asserts the root itself in its own atomic
      // block, so the await here is safe — we never read the index after it.
      const allFiles = await this.getAllFiles(true, 0, limit, workspaceRoot);
      return allFiles.slice(0, limit);
    }

    // R5 guard + index reads: one synchronous block, do not separate them.
    // `search`, `searchDirectories` and the `isFileIncluded` comparator below
    // are ALL synchronous — introducing an await among them reopens the
    // cross-workspace leak this guard closes.
    this.assertIndexServes(workspaceRoot);
    const searchResults = this.fileIndex.search(query, limit * 2);
    const directoryMatches = this.searchDirectories(query, limit);

    const merged = [...directoryMatches, ...searchResults];
    const prioritized = merged.sort((a, b) => {
      const aIncluded = this.isFileIncluded(a.path) ? 1 : 0;
      const bIncluded = this.isFileIncluded(b.path) ? 1 : 0;
      return bIncluded - aIncluded;
    });

    return prioritized.slice(0, limit);
  }

  /**
   * Filter indexed directories by query. Directory entries are tracked in the
   * live index alongside files.
   */
  private searchDirectories(query: string, limit: number): FileSearchResult[] {
    return this.fileIndex.searchDirectories(query, limit);
  }

  /**
   * Clear caches - retained for API compatibility. The live index owns its own
   * state and stays fresh via the file watcher, so there is nothing to clear.
   */
  clearFileCache(): void {
    this.logger.debug('clearFileCache is a no-op (live index is watcher-fed)');
  }

  /**
   * Setup auto-include functionality
   * Returns disposables for cleanup
   */
  setupAutoInclude(): IDisposable[] {
    const config = this.workspaceProvider.getConfiguration<boolean>(
      'ptah',
      'autoIncludeOpenFiles',
      true,
    );
    const autoInclude = config ?? true;

    const disposables: IDisposable[] = [];

    if (autoInclude) {
      disposables.push(
        this.editorProvider.onDidChangeActiveEditor(async (event) => {
          if (event.filePath) {
            await this.includeFile(event.filePath);
          }
        }),
      );
      disposables.push(
        this.editorProvider.onDidOpenDocument(async (event) => {
          if (event.filePath && !event.filePath.includes('://')) {
            await this.includeFile(event.filePath);
          }
        }),
      );
    }

    return disposables;
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.logger.info('Disposing Context Service...');
  }

  /**
   * PRIVATE HELPER METHODS
   */

  private findLargeFiles(): string[] {
    const largeFiles: string[] = [];
    const threshold = 50000; // 50KB threshold

    for (const filePath of this.includedFiles) {
      const stats = fs.statSync(filePath);
      if (stats.size > threshold) {
        largeFiles.push(filePath);
      }
    }

    return largeFiles;
  }

  private findTestFiles(): string[] {
    const testFiles: string[] = [];
    const testPatterns = [
      /\.test\./i,
      /\.spec\./i,
      /\/test\//i,
      /\/tests\//i,
      /__tests__/i,
    ];

    for (const filePath of this.includedFiles) {
      if (testPatterns.some((pattern) => pattern.test(filePath))) {
        testFiles.push(filePath);
      }
    }

    return testFiles;
  }

  private findBuildFiles(): string[] {
    const buildFiles: string[] = [];
    const buildPatterns = [
      /\/dist\//i,
      /\/build\//i,
      /\/out\//i,
      /\/target\//i,
      /\.min\./i,
      /\.bundle\./i,
      /\.compiled\./i,
    ];

    for (const filePath of this.includedFiles) {
      if (buildPatterns.some((pattern) => pattern.test(filePath))) {
        buildFiles.push(filePath);
      }
    }

    return buildFiles;
  }

  private estimateTokenSavings(files: string[]): number {
    let totalChars = 0;

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8');
      totalChars += content.length;
    }

    return Math.ceil(totalChars / this.CHARS_PER_TOKEN);
  }

  private async loadFromWorkspaceState(): Promise<void> {
    try {
      const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        return;
      }

      const includedFiles = this.workspaceProvider.getConfiguration<string[]>(
        'ptah',
        'context.includedFiles',
        [],
      );
      const excludedFiles = this.workspaceProvider.getConfiguration<string[]>(
        'ptah',
        'context.excludedFiles',
        [],
      );

      this.includedFiles = new Set(includedFiles || []);
      this.excludedFiles = new Set(excludedFiles || []);

      this.logger.info(
        `Loaded context state: ${this.includedFiles.size} included, ${this.excludedFiles.size} excluded`,
      );
    } catch (error) {
      this.logger.error('Failed to load context state', error);
    }
  }

  private async saveToWorkspaceState(): Promise<void> {
    try {
      this.logger.debug('Context state save requested (handled by app layer)');
    } catch (error) {
      this.logger.error('Failed to save context state', error);
    }
  }

  private async notifyContextChanged(): Promise<void> {
    await this.commandRegistry.executeCommand(
      'setContext',
      'ptah.contextFilesCount',
      this.includedFiles.size,
    );
  }

  private async getCachedIgnoreFiles(
    workspaceRoot: string,
  ): Promise<ParsedIgnoreFile[]> {
    const entry = this.ignoreFilesCache.get(workspaceRoot);
    const now = Date.now();
    if (entry && entry.expiresAt > now) {
      return entry.ignoreFiles;
    }
    try {
      const ignoreFiles =
        await this.ignoreResolver.parseWorkspaceIgnoreFiles(workspaceRoot);
      this.ignoreFilesCache.set(workspaceRoot, {
        ignoreFiles,
        expiresAt: now + this.IGNORE_CACHE_TTL_MS,
      });
      return ignoreFiles;
    } catch (error) {
      this.logger.warn(
        `Failed to parse workspace ignore files for ${workspaceRoot}`,
        error,
      );
      return [];
    }
  }

  private async getEffectiveExcludes(
    workspaceRoot: string,
    extra: string[] = [],
  ): Promise<string[]> {
    const ignoreFiles = await this.getCachedIgnoreFiles(workspaceRoot);
    const ignoreGlobs: string[] = [];
    for (const file of ignoreFiles) {
      for (const pattern of file.patterns) {
        if (pattern.isNegation) continue;
        ignoreGlobs.push(pattern.pattern);
      }
    }
    const merged = new Set<string>([
      ...DEFAULT_WORKSPACE_EXCLUDES,
      ...ignoreGlobs,
      ...extra,
    ]);
    return Array.from(merged);
  }

  private async filterIgnored(
    paths: string[],
    workspaceRoot: string,
  ): Promise<string[]> {
    const ignoreFiles = await this.getCachedIgnoreFiles(workspaceRoot);
    if (ignoreFiles.length === 0) return paths;
    const relativePaths = paths.map((p) => path.relative(workspaceRoot, p));
    const survivors: string[] = [];
    for (let i = 0; i < paths.length; i++) {
      const result = await this.ignoreResolver.isIgnored(
        relativePaths[i],
        ignoreFiles,
        workspaceRoot,
      );
      if (!result.ignored) {
        survivors.push(paths[i]);
      }
    }
    return survivors;
  }
}
