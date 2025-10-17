/**
 * Workspace Indexer Service
 *
 * Indexes all workspace files with intelligent filtering via ignore patterns
 * and file type classification. Provides async generators for large workspaces.
 */

import { injectable } from 'tsyringe';
import * as vscode from 'vscode';
import { FileSystemService } from '../services/file-system.service';
import { TokenCounterService } from '../services/token-counter.service';
import { PatternMatcherService } from './pattern-matcher.service';
import { IgnorePatternResolverService } from './ignore-pattern-resolver.service';
import { FileTypeClassifierService } from '../context-analysis/file-type-classifier.service';
import { FileIndex, IndexedFile } from '../types/workspace.types';

/**
 * Workspace indexing options
 */
export interface WorkspaceIndexOptions {
  /** Include patterns (glob) - if empty, includes all files */
  includePatterns?: string[];
  /** Exclude patterns (glob) - takes precedence over include */
  excludePatterns?: string[];
  /** Whether to respect .gitignore and other ignore files */
  respectIgnoreFiles?: boolean;
  /** Maximum file size to index (in bytes) - default 1MB */
  maxFileSize?: number;
  /** Whether to estimate token counts for files */
  estimateTokens?: boolean;
  /** Workspace folder to index - defaults to first workspace folder */
  workspaceFolder?: vscode.Uri;
}

/**
 * Workspace indexing progress callback
 */
export interface IndexingProgress {
  /** Current file being indexed */
  currentFile: string;
  /** Number of files indexed so far */
  filesIndexed: number;
  /** Total files discovered (may increase during indexing) */
  totalFiles: number;
  /** Percentage complete (0-100) */
  percentComplete: number;
}

/**
 * Service for indexing workspace files with filtering and classification
 *
 * This service ties together:
 * - FileSystemService: Reading directories and files
 * - PatternMatcherService: Glob pattern matching
 * - IgnorePatternResolverService: Ignore file parsing
 * - FileTypeClassifierService: File type detection
 * - TokenCounterService: Token count estimation
 */
@injectable()
export class WorkspaceIndexerService {
  private readonly defaultMaxFileSize = 1024 * 1024; // 1MB

  constructor(
    private readonly fileSystemService: FileSystemService,
    private readonly patternMatcher: PatternMatcherService,
    private readonly ignoreResolver: IgnorePatternResolverService,
    private readonly fileClassifier: FileTypeClassifierService,
    private readonly tokenCounter: TokenCounterService
  ) {}

  /**
   * Index all files in a workspace folder
   *
   * @param options - Indexing options
   * @param onProgress - Optional progress callback
   * @returns File index with all indexed files
   */
  public async indexWorkspace(
    options: WorkspaceIndexOptions = {},
    onProgress?: (progress: IndexingProgress) => void
  ): Promise<FileIndex> {
    const workspaceFolder =
      options.workspaceFolder ?? this.getDefaultWorkspaceFolder();

    if (!workspaceFolder) {
      throw new Error('No workspace folder available for indexing');
    }

    const maxFileSize = options.maxFileSize ?? this.defaultMaxFileSize;
    const respectIgnoreFiles = options.respectIgnoreFiles ?? true;

    // Load ignore patterns if requested
    const ignoredPatterns: string[] = [];
    let parsedIgnoreFiles: Awaited<
      ReturnType<typeof this.ignoreResolver.parseWorkspaceIgnoreFiles>
    > = [];

    if (respectIgnoreFiles) {
      parsedIgnoreFiles = await this.ignoreResolver.parseWorkspaceIgnoreFiles(
        workspaceFolder
      );
      for (const ignoreFile of parsedIgnoreFiles) {
        ignoredPatterns.push(...ignoreFile.patterns.map((p) => p.pattern));
      }
    }

    // Add user-provided exclude patterns
    if (options.excludePatterns) {
      ignoredPatterns.push(...options.excludePatterns);
    }

    // Discover all files
    const allFiles = await this.discoverFiles(
      workspaceFolder,
      options.includePatterns
    );

    // Filter files based on ignore patterns and size
    const indexedFiles: IndexedFile[] = [];
    let filesIndexed = 0;

    for (const fileUri of allFiles) {
      const relativePath = vscode.workspace.asRelativePath(fileUri, false);

      // Check if file should be ignored
      if (respectIgnoreFiles && parsedIgnoreFiles.length > 0) {
        const ignoreResult = await this.ignoreResolver.isIgnored(
          relativePath,
          parsedIgnoreFiles
        );
        if (ignoreResult.ignored) {
          continue; // Skip ignored files
        }
      }

      // Check against exclude patterns
      if (options.excludePatterns && options.excludePatterns.length > 0) {
        const excluded = this.patternMatcher.matchFiles(
          [relativePath],
          options.excludePatterns
        );
        if (excluded && excluded.length > 0) {
          continue; // Skip excluded files
        }
      }

      // Get file stats
      const stat = await this.fileSystemService.stat(fileUri);

      // Skip files that are too large
      if (stat.size > maxFileSize) {
        continue;
      }

      // Classify file type
      const classification = this.fileClassifier.classifyFile(relativePath);

      // Estimate token count if requested
      let estimatedTokens = 0;
      if (options.estimateTokens) {
        try {
          const content = await this.fileSystemService.readFile(fileUri);
          estimatedTokens = await this.tokenCounter.countTokens(content);
        } catch {
          // If we can't read the file, skip it
          continue;
        }
      }

      // Create indexed file entry
      const indexedFile: IndexedFile = {
        path: fileUri.fsPath,
        relativePath,
        type: classification.type,
        size: stat.size,
        language: classification.language,
        estimatedTokens,
      };

      indexedFiles.push(indexedFile);
      filesIndexed++;

      // Report progress
      if (onProgress) {
        onProgress({
          currentFile: relativePath,
          filesIndexed,
          totalFiles: allFiles.length,
          percentComplete: Math.round((filesIndexed / allFiles.length) * 100),
        });
      }
    }

    // Calculate totals
    const totalSize = indexedFiles.reduce((sum, file) => sum + file.size, 0);

    return {
      files: indexedFiles,
      ignoredPatterns,
      totalFiles: indexedFiles.length,
      totalSize,
    };
  }

  /**
   * Index workspace files as an async generator for memory efficiency
   *
   * Useful for very large workspaces where loading all files at once
   * would consume too much memory.
   *
   * @param options - Indexing options
   * @yields Indexed files one at a time
   */
  public async *indexWorkspaceStream(
    options: WorkspaceIndexOptions = {}
  ): AsyncGenerator<IndexedFile, void, undefined> {
    const workspaceFolder =
      options.workspaceFolder ?? this.getDefaultWorkspaceFolder();

    if (!workspaceFolder) {
      throw new Error('No workspace folder available for indexing');
    }

    const maxFileSize = options.maxFileSize ?? this.defaultMaxFileSize;
    const respectIgnoreFiles = options.respectIgnoreFiles ?? true;

    // Load ignore patterns
    let parsedIgnoreFiles: Awaited<
      ReturnType<typeof this.ignoreResolver.parseWorkspaceIgnoreFiles>
    > = [];

    if (respectIgnoreFiles) {
      parsedIgnoreFiles = await this.ignoreResolver.parseWorkspaceIgnoreFiles(
        workspaceFolder
      );
    }

    // Discover and yield files one at a time
    const allFiles = await this.discoverFiles(
      workspaceFolder,
      options.includePatterns
    );

    for (const fileUri of allFiles) {
      const relativePath = vscode.workspace.asRelativePath(fileUri, false);

      // Check if file should be ignored
      if (respectIgnoreFiles && parsedIgnoreFiles.length > 0) {
        const ignoreResult = await this.ignoreResolver.isIgnored(
          relativePath,
          parsedIgnoreFiles
        );
        if (ignoreResult.ignored) {
          continue;
        }
      }

      // Check against exclude patterns
      if (options.excludePatterns && options.excludePatterns.length > 0) {
        const excluded = this.patternMatcher.matchFiles(
          [relativePath],
          options.excludePatterns
        );
        if (excluded && excluded.length > 0) {
          continue;
        }
      }

      // Get file stats
      const stat = await this.fileSystemService.stat(fileUri);

      // Skip files that are too large
      if (stat.size > maxFileSize) {
        continue;
      }

      // Classify file type
      const classification = this.fileClassifier.classifyFile(relativePath);

      // Estimate token count if requested
      let estimatedTokens = 0;
      if (options.estimateTokens) {
        try {
          const content = await this.fileSystemService.readFile(fileUri);
          estimatedTokens = await this.tokenCounter.countTokens(content);
        } catch {
          continue;
        }
      }

      // Yield indexed file
      yield {
        path: fileUri.fsPath,
        relativePath,
        type: classification.type,
        size: stat.size,
        language: classification.language,
        estimatedTokens,
      };
    }
  }

  /**
   * Get total file count in workspace (without full indexing)
   *
   * Useful for progress estimation before indexing starts.
   *
   * @param options - Indexing options
   * @returns Estimated file count
   */
  public async getFileCount(
    options: WorkspaceIndexOptions = {}
  ): Promise<number> {
    const workspaceFolder =
      options.workspaceFolder ?? this.getDefaultWorkspaceFolder();

    if (!workspaceFolder) {
      return 0;
    }

    const allFiles = await this.discoverFiles(
      workspaceFolder,
      options.includePatterns
    );

    return allFiles.length;
  }

  /**
   * Discover all files in workspace folder matching include patterns
   *
   * @param workspaceFolder - Workspace folder URI
   * @param includePatterns - Optional glob patterns to include
   * @returns Array of file URIs
   */
  private async discoverFiles(
    workspaceFolder: vscode.Uri,
    includePatterns?: string[]
  ): Promise<vscode.Uri[]> {
    // Use VS Code's findFiles API for efficient file discovery
    const pattern = includePatterns?.length
      ? `{${includePatterns.join(',')}}`
      : '**/*';

    const relativePattern = new vscode.RelativePattern(
      workspaceFolder,
      pattern
    );

    // Exclude common build/dependency directories by default
    const defaultExcludes =
      '**/node_modules/**,**/dist/**,**/build/**,**/.git/**,**/out/**,**/target/**,**/.nx/**';

    const files = await vscode.workspace.findFiles(
      relativePattern,
      defaultExcludes
    );

    return files;
  }

  /**
   * Get the default workspace folder
   *
   * @returns First workspace folder or undefined
   */
  private getDefaultWorkspaceFolder(): vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.[0]?.uri;
  }
}
