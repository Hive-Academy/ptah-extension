import { injectable, inject } from 'tsyringe';
import * as fs from 'fs';
import * as path from 'path';
import { PLATFORM_TOKENS, FileType } from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
  IEditorProvider,
  ICommandRegistry,
  DirectoryEntry,
  FileStat,
  IDisposable,
} from '@ptah-extension/platform-core';
import type {
  ContextInfo,
  OptimizationSuggestion,
} from '@ptah-extension/shared';

// Import token symbols directly (avoids circular dependency with vscode-core)
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
  // Minimal interface, not used yet but required for DI
  get(key: string): unknown;
}

/**
 * File search result with metadata for @ syntax autocomplete
 */
export interface FileSearchResult {
  readonly path: string;
  readonly relativePath: string;
  readonly fileName: string;
  readonly fileType: 'text' | 'image' | 'binary' | 'unknown';
  readonly size: number;
  readonly lastModified: number;
  readonly isDirectory: boolean;
  readonly relevanceScore?: number;
}

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
}

/**
 * File cache entry with TTL and metadata
 */
interface FileCacheEntry {
  readonly results: FileSearchResult[];
  readonly timestamp: number;
  readonly query: string;
  readonly ttl: number;
}

/**
 * Debounced search state
 */
interface DebounceState {
  timerId?: NodeJS.Timeout;
  lastQuery: string;
  pendingResolvers: Array<{
    resolve: (results: FileSearchResult[]) => void;
    reject: (error: Error) => void;
  }>;
}

/**
 * ContextService - Manages file context for AI interactions
 *
 * BUSINESS LOGIC: File search, context optimization, token estimation, caching
 *
 * Verification:
 * - Migrated from apps/ptah-extension-vscode/src/services/context-manager.ts (845 lines)
 * - Pattern: Complete business logic implementation in library (not delegation)
 * - Dependencies: Logger, ConfigManager from vscode-core (infrastructure)
 * - Integration: Will be resolved from DI in main app, methods delegated
 */
@injectable()
export class ContextService {
  private includedFiles: Set<string> = new Set();
  private excludedFiles: Set<string> = new Set();
  private readonly MAX_TOKENS = 200000;
  private readonly CHARS_PER_TOKEN = 4; // Rough estimate

  // Enhanced file search capabilities
  private fileCache = new Map<string, FileCacheEntry>();
  private allFilesCache: FileSearchResult[] = [];
  private allFilesCacheTimestamp = 0;
  private debounceState: DebounceState = {
    lastQuery: '',
    pendingResolvers: [],
  };

  // Performance constants
  private readonly DEBOUNCE_MS = 300;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly ALL_FILES_CACHE_TTL = 2 * 60 * 1000; // 2 minutes
  private readonly MAX_CACHE_ENTRIES = 100;
  private readonly MAX_SEARCH_RESULTS = 1000;

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

    // Validate file path
    if (!filePath || filePath.trim() === '' || filePath === 'tasks') {
      this.logger.warn(`Invalid file path provided: ${filePath}`);
      return;
    }

    // Check if file exists and is readable
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
      // Suggest excluding large files
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

      // Suggest excluding test files
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

      // Suggest excluding build artifacts
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
    // Remove files that no longer exist
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
    // This method is called when a file's content changes
    // For now, we just log it. In the future, we might want to
    // update token estimates or trigger re-analysis
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

    // Clear current context
    this.includedFiles.clear();
    this.excludedFiles.clear();

    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }

    // Apply include patterns using IFileSystemProvider.findFiles
    for (const pattern of template.include) {
      const files = await this.fsProvider.findFiles(
        pattern,
        undefined,
        undefined,
        workspaceRoot,
      );
      for (const file of files) {
        this.includedFiles.add(file);
      }
    }

    // Apply exclude patterns
    for (const pattern of template.exclude) {
      const files = await this.fsProvider.findFiles(
        pattern,
        undefined,
        undefined,
        workspaceRoot,
      );
      for (const file of files) {
        this.excludedFiles.add(file);
        this.includedFiles.delete(file); // Remove from included if it was there
      }
    }

    this.logger.info(
      `Applied ${projectType} project template: ${this.includedFiles.size} files included`,
    );

    await this.saveToWorkspaceState();
    await this.notifyContextChanged();
  }

  /**
   * ENHANCED FILE SEARCH FUNCTIONALITY - For @ syntax autocomplete
   */

  /**
   * Search files with debouncing and intelligent caching
   * Optimized for @ syntax compatibility
   */
  async searchFiles(options: FileSearchOptions): Promise<FileSearchResult[]> {
    const cacheKey = this.generateCacheKey(options);

    // Check cache first for 60% API call reduction
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      this.logger.debug(`File search cache hit for query: ${options.query}`);
      return cached;
    }

    // Use debouncing to prevent excessive API calls
    return new Promise<FileSearchResult[]>((resolve, reject) => {
      this.addToDebounceQueue(resolve, reject);

      // Clear existing timer
      if (this.debounceState.timerId) {
        clearTimeout(this.debounceState.timerId);
      }

      this.debounceState.lastQuery = options.query;

      // Setup new debounced search
      this.debounceState.timerId = setTimeout(async () => {
        try {
          const results = await this.performFileSearch(options);
          this.cacheResults(cacheKey, results);

          // Resolve all pending promises
          this.debounceState.pendingResolvers.forEach(({ resolve }) => {
            resolve(results);
          });
          this.debounceState.pendingResolvers = [];

          this.logger.debug(
            `File search completed: ${results.length} results for "${options.query}"`,
          );
        } catch (error) {
          this.logger.error('File search failed', error);

          // Reject all pending promises
          const errorToReject =
            error instanceof Error ? error : new Error('File search failed');
          this.debounceState.pendingResolvers.forEach(({ reject }) => {
            reject(errorToReject);
          });
          this.debounceState.pendingResolvers = [];
        }
      }, this.DEBOUNCE_MS);
    });
  }

  /**
   * Get all workspace files with caching for performance
   * Supports virtual scrolling with pagination
   */
  async getAllFiles(
    includeImages = false,
    offset = 0,
    limit = this.MAX_SEARCH_RESULTS,
  ): Promise<FileSearchResult[]> {
    // Check if cached data is still fresh
    const now = Date.now();
    if (
      this.allFilesCache.length > 0 &&
      now - this.allFilesCacheTimestamp < this.ALL_FILES_CACHE_TTL
    ) {
      return this.paginateResults(
        this.allFilesCache,
        offset,
        limit,
        includeImages,
      );
    }

    try {
      this.logger.debug('Refreshing all files cache');

      const workspaceFolders = this.workspaceProvider.getWorkspaceFolders();
      if (workspaceFolders.length === 0) {
        return [];
      }

      // Find all files excluding common ignore patterns
      const excludePatterns = [
        '**/node_modules/**',
        '**/.git/**',
        '**/.svn/**',
        '**/.hg/**',
        '**/dist/**',
        '**/build/**',
        '**/out/**',
        '**/*.log',
        '**/.DS_Store',
        '**/coverage/**',
        '**/.nyc_output/**',
      ];

      // Search ALL workspace folders using findFiles
      const filePaths = await this.fsProvider.findFiles(
        '**/*',
        `{${excludePatterns.join(',')}}`,
        this.MAX_SEARCH_RESULTS * 2,
        workspaceFolders[0],
      );

      const results: FileSearchResult[] = [];
      // Use first workspace folder as base for relative paths (for display)
      const primaryWorkspacePath = workspaceFolders[0];

      // Process files — batch stat calls in parallel for performance
      // Sequential stat calls on 2000+ files can take 10-30s and cause RPC timeouts
      const BATCH_SIZE = 50;
      for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
        const batch = filePaths.slice(i, i + BATCH_SIZE);
        const statResults = await Promise.allSettled(
          batch.map(async (filePath) => {
            const stat = await this.fsProvider.stat(filePath);
            const relativePath = path.relative(primaryWorkspacePath, filePath);
            const fileName = path.basename(filePath);
            const fileType = this.detectFileType(fileName);

            return {
              path: filePath,
              relativePath,
              fileName,
              fileType,
              size: stat.size,
              lastModified: stat.mtime,
              isDirectory: stat.type === FileType.Directory,
            } as FileSearchResult;
          }),
        );

        for (const result of statResults) {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          }
          // Skip inaccessible files silently
        }
      }

      // Also discover directories from ALL workspace folders
      for (const folder of workspaceFolders) {
        const directories = await this.discoverDirectories(
          folder,
          primaryWorkspacePath,
          excludePatterns,
        );
        results.push(...directories);
      }

      // Sort by relevance (recently modified first)
      results.sort((a, b) => b.lastModified - a.lastModified);

      // Cache the results
      this.allFilesCache = results;
      this.allFilesCacheTimestamp = now;

      this.logger.info(
        `Cached ${results.length} workspace files and directories from ${workspaceFolders.length} folder(s)`,
      );

      return this.paginateResults(results, offset, limit, includeImages);
    } catch (error) {
      this.logger.error('Failed to get all files', error);
      return [];
    }
  }

  /**
   * Discover directories in workspace (findFiles doesn't return directories)
   * Uses recursive directory reading with depth limit for performance
   */
  private async discoverDirectories(
    rootPath: string,
    workspacePath: string,
    _excludePatterns: string[],
    maxDepth = 4,
  ): Promise<FileSearchResult[]> {
    const directories: FileSearchResult[] = [];
    const excludeSet = new Set([
      'node_modules',
      '.git',
      'dist',
      'build',
      'out',
    ]);

    const processDirectory = async (
      dirPath: string,
      depth: number,
    ): Promise<void> => {
      if (depth > maxDepth) return;

      try {
        const entries = await this.fsProvider.readDirectory(dirPath);
        const dirEntries = entries.filter(
          (e) =>
            e.type === FileType.Directory &&
            !excludeSet.has(e.name) &&
            !e.name.startsWith('.'),
        );

        // Batch stat calls for all directories at this level
        const statResults = await Promise.allSettled(
          dirEntries.map(async (entry) => {
            const subPath = path.join(dirPath, entry.name);
            const stat = await this.fsProvider.stat(subPath);
            return { entry, subPath, stat };
          }),
        );

        const subDirs: string[] = [];
        for (const result of statResults) {
          if (result.status !== 'fulfilled') continue;
          const { entry, subPath, stat } = result.value;
          const relativePath = path.relative(workspacePath, subPath);

          directories.push({
            path: subPath,
            relativePath,
            fileName: entry.name,
            fileType: 'unknown',
            size: 0,
            lastModified: stat.mtime,
            isDirectory: true,
          });

          subDirs.push(subPath);
        }

        // Recurse into subdirectories
        for (const subDir of subDirs) {
          await processDirectory(subDir, depth + 1);
        }
      } catch {
        // Skip if directory listing fails
      }
    };

    await processDirectory(rootPath, 0);
    return directories;
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
  ): Promise<FileSearchResult[]> {
    if (!query || query.length < 2) {
      // For short queries, return recently modified files
      const allFiles = await this.getAllFiles(true, 0, limit);
      return allFiles.slice(0, limit);
    }

    const searchResults = await this.searchFiles({
      query,
      includeImages: true,
      maxResults: limit * 2, // Get extra to filter
      sortBy: 'relevance',
    });

    // Prioritize files already in context
    const prioritized = searchResults.sort((a, b) => {
      const aIncluded = this.isFileIncluded(a.path) ? 1 : 0;
      const bIncluded = this.isFileIncluded(b.path) ? 1 : 0;
      return bIncluded - aIncluded;
    });

    return prioritized.slice(0, limit);
  }

  /**
   * Clear all caches - useful for testing and manual refresh
   */
  clearFileCache(): void {
    this.fileCache.clear();
    this.allFilesCache = [];
    this.allFilesCacheTimestamp = 0;
    this.logger.info('File search cache cleared');
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
      // Include currently open files
      disposables.push(
        this.editorProvider.onDidChangeActiveEditor(async (event) => {
          if (event.filePath) {
            await this.includeFile(event.filePath);
          }
        }),
      );

      // Include files when they are opened
      disposables.push(
        this.editorProvider.onDidOpenDocument(async (event) => {
          // Only include file-scheme paths (skip untitled, etc.)
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

    // Clear debounce timer
    if (this.debounceState.timerId) {
      clearTimeout(this.debounceState.timerId);
    }

    // Clear all caches
    this.clearFileCache();
  }

  /**
   * PRIVATE HELPER METHODS
   */

  private findLargeFiles(): string[] {
    const largeFiles: string[] = [];
    const threshold = 50000; // 50KB threshold

    for (const filePath of this.includedFiles) {
      try {
        const stats = fs.statSync(filePath);
        if (stats.size > threshold) {
          largeFiles.push(filePath);
        }
      } catch {
        // Ignore errors for files that can't be read
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
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        totalChars += content.length;
      } catch {
        // Ignore errors
      }
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
      // Configuration update is not supported via IWorkspaceProvider read-only getConfiguration.
      // State persistence will be handled at the application layer.
      // This is an intentional simplification for the platform abstraction.
      this.logger.debug('Context state save requested (handled by app layer)');
    } catch (error) {
      this.logger.error('Failed to save context state', error);
    }
  }

  private async notifyContextChanged(): Promise<void> {
    // This would trigger UI updates in providers
    try {
      await this.commandRegistry.executeCommand(
        'setContext',
        'ptah.contextFilesCount',
        this.includedFiles.size,
      );
    } catch {
      // Command may not be available in all contexts
    }
  }

  private async performFileSearch(
    options: FileSearchOptions,
  ): Promise<FileSearchResult[]> {
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (!workspaceRoot) {
      return [];
    }

    const {
      query,
      includeImages = false,
      maxResults = 100,
      fileTypes = [],
    } = options;

    // Build search pattern
    let searchPattern = `**/*${query}*`;
    if (fileTypes.length > 0) {
      const extensions = fileTypes.map((ext) =>
        ext.startsWith('.') ? ext.slice(1) : ext,
      );
      searchPattern = `**/*${query}*.{${extensions.join(',')}}`;
    }

    // Build exclude pattern
    let excludePattern = '**/node_modules/**';
    if (!includeImages && fileTypes.length === 0) {
      const imageExts = [
        'png',
        'jpg',
        'jpeg',
        'gif',
        'bmp',
        'svg',
        'webp',
        'ico',
      ];
      excludePattern += `,**/*.{${imageExts.join(',')}}`;
    }

    const filePaths = await this.fsProvider.findFiles(
      searchPattern,
      excludePattern,
      maxResults,
      workspaceRoot,
    );

    const results: FileSearchResult[] = [];

    for (const filePath of filePaths) {
      try {
        const stat = await this.fsProvider.stat(filePath);
        const relativePath = path.relative(workspaceRoot, filePath);
        const fileName = path.basename(filePath);
        const fileType = this.detectFileType(fileName);

        // Calculate relevance score
        const relevanceScore = this.calculateRelevanceScore(
          fileName,
          relativePath,
          query,
        );

        results.push({
          path: filePath,
          relativePath,
          fileName,
          fileType,
          size: stat.size,
          lastModified: stat.mtime,
          isDirectory: stat.type === FileType.Directory,
          relevanceScore,
        });
      } catch {
        // Skip inaccessible files
      }
    }

    // Sort by relevance and recency
    results.sort((a, b) => {
      const scoreA = a.relevanceScore || 0;
      const scoreB = b.relevanceScore || 0;

      if (scoreA !== scoreB) {
        return scoreB - scoreA; // Higher relevance first
      }

      return b.lastModified - a.lastModified; // More recent first
    });

    return results;
  }

  private detectFileType(fileName: string): FileSearchResult['fileType'] {
    const ext = path.extname(fileName).toLowerCase();

    const imageExts = [
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.bmp',
      '.svg',
      '.webp',
      '.ico',
    ];
    const textExts = [
      '.txt',
      '.md',
      '.json',
      '.js',
      '.ts',
      '.jsx',
      '.tsx',
      '.css',
      '.scss',
      '.html',
      '.xml',
      '.yaml',
      '.yml',
    ];
    const binaryExts = [
      '.exe',
      '.dll',
      '.so',
      '.dylib',
      '.bin',
      '.zip',
      '.tar',
      '.gz',
    ];

    if (imageExts.includes(ext)) return 'image';
    if (textExts.includes(ext)) return 'text';
    if (binaryExts.includes(ext)) return 'binary';

    return 'unknown';
  }

  private calculateRelevanceScore(
    fileName: string,
    relativePath: string,
    query: string,
  ): number {
    let score = 0;
    const queryLower = query.toLowerCase();
    const fileNameLower = fileName.toLowerCase();
    const pathLower = relativePath.toLowerCase();

    // Exact filename match gets highest score
    if (fileNameLower === queryLower) score += 100;

    // Filename starts with query
    if (fileNameLower.startsWith(queryLower)) score += 50;

    // Filename contains query
    if (fileNameLower.includes(queryLower)) score += 20;

    // Path contains query
    if (pathLower.includes(queryLower)) score += 10;

    // Prefer shorter paths (closer to root)
    const pathDepth = relativePath.split(path.sep).length;
    score += Math.max(0, 10 - pathDepth);

    return score;
  }

  private generateCacheKey(options: FileSearchOptions): string {
    return JSON.stringify({
      query: options.query.toLowerCase(),
      includeImages: options.includeImages || false,
      maxResults: options.maxResults || 100,
      fileTypes: options.fileTypes || [],
    });
  }

  private getFromCache(cacheKey: string): FileSearchResult[] | null {
    const entry = this.fileCache.get(cacheKey);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.fileCache.delete(cacheKey);
      return null;
    }

    return entry.results;
  }

  private cacheResults(cacheKey: string, results: FileSearchResult[]): void {
    // Implement LRU-like behavior
    if (this.fileCache.size >= this.MAX_CACHE_ENTRIES) {
      const firstKey = this.fileCache.keys().next().value;
      if (firstKey) {
        this.fileCache.delete(firstKey);
      }
    }

    this.fileCache.set(cacheKey, {
      results,
      timestamp: Date.now(),
      query: cacheKey,
      ttl: this.CACHE_TTL_MS,
    });
  }

  private addToDebounceQueue(
    resolve: (results: FileSearchResult[]) => void,
    reject: (error: Error) => void,
  ): void {
    this.debounceState.pendingResolvers.push({ resolve, reject });
  }

  private paginateResults(
    results: FileSearchResult[],
    offset: number,
    limit: number,
    includeImages: boolean,
  ): FileSearchResult[] {
    let filteredResults = results;

    if (!includeImages) {
      filteredResults = results.filter((f) => f.fileType !== 'image');
    }

    return filteredResults.slice(offset, offset + limit);
  }
}
