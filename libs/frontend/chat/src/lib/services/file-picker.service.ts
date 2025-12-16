import { Injectable, signal, computed, inject, Injector } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';

/**
 * File information for inclusion in chat messages
 */
export interface ChatFile {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly type: 'text' | 'image' | 'binary';
  readonly content?: string;
  readonly encoding?: string;
  readonly preview?: string;
  readonly isLarge: boolean;
  readonly tokenEstimate: number;
}

/**
 * File picker suggestion for @ syntax autocomplete
 */
export interface FileSuggestion {
  readonly path: string;
  readonly name: string;
  readonly directory: string;
  readonly type: 'file' | 'directory';
  readonly extension?: string;
  readonly size?: number;
  readonly lastModified?: number;
  readonly isImage: boolean;
  readonly isText: boolean;
}

/**
 * File Picker Service - Angular 20+ Modernized
 *
 * Manages workspace file discovery and inclusion with:
 * - @ syntax autocomplete with workspace files
 * - File content retrieval and optimization
 * - File previews and metadata
 * - VS Code workspace API integration
 *
 * ARCHITECTURE:
 * - Signal-based reactive state management
 * - Computed signals for derived values
 * - Integration with VSCodeService for extension communication
 * - Token estimation for context optimization
 *
 * ANGULAR 20 PATTERNS:
 * - inject() for dependency injection
 * - signal() for reactive state
 * - computed() for derived state
 * - asReadonly() for public signal exposure
 */
@Injectable({
  providedIn: 'root',
})
export class FilePickerService {
  // === ANGULAR 20 PATTERN: Injected services ===
  private readonly injector = inject(Injector);
  private readonly rpcService = inject(ClaudeRpcService);

  // === ANGULAR 20 PATTERN: Private signals for internal state ===
  private readonly _workspaceFiles = signal<FileSuggestion[]>([]);
  private readonly _includedFiles = signal<ChatFile[]>([]);
  private readonly _isLoading = signal(false);
  private readonly _lastUpdate = signal<number>(0);

  // === ANGULAR 20 PATTERN: Readonly signals for external access ===
  readonly workspaceFiles = this._workspaceFiles.asReadonly();
  readonly includedFiles = this._includedFiles.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();

  // === ANGULAR 20 PATTERN: Computed signals for derived state ===
  readonly fileCount = computed(() => this._includedFiles().length);

  readonly totalSize = computed(() =>
    this._includedFiles().reduce((total, file) => total + file.size, 0)
  );

  readonly totalTokens = computed(() =>
    this._includedFiles().reduce((total, file) => total + file.tokenEstimate, 0)
  );

  readonly hasLargeFiles = computed(() =>
    this._includedFiles().some((file) => file.isLarge)
  );

  readonly optimizationSuggestions = computed(() => {
    const files = this._includedFiles();
    const suggestions: string[] = [];

    if (this.totalSize() > 1024 * 1024) {
      // > 1MB
      suggestions.push('Consider excluding large files to improve performance');
    }

    if (this.totalTokens() > 10000) {
      suggestions.push('High token count - consider summarizing file contents');
    }

    const largeFiles = files.filter((f) => f.isLarge);
    if (largeFiles.length > 0) {
      suggestions.push(
        `${largeFiles.length} large files detected - consider file compression`
      );
    }

    return suggestions;
  });

  // Image file extensions
  private readonly imageExtensions = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.bmp',
    '.svg',
    '.webp',
    '.ico',
  ]);

  // Text file extensions
  private readonly textExtensions = new Set([
    '.ts',
    '.js',
    '.html',
    '.css',
    '.scss',
    '.json',
    '.md',
    '.txt',
    '.xml',
    '.yaml',
    '.yml',
    '.py',
    '.java',
    '.cs',
    '.cpp',
    '.c',
    '.go',
    '.rs',
    '.php',
    '.rb',
    '.sh',
    '.sql',
    '.log',
  ]);

  /**
   * Fetch workspace files from backend via RPC
   * TASK_2025_019 Phase 1: Populates _workspaceFiles signal for @ autocomplete
   */
  async fetchWorkspaceFiles(): Promise<void> {
    if (this._isLoading()) return; // Prevent duplicate fetches
    if (!this.rpcService) {
      console.warn('[FilePickerService] ClaudeRpcService not initialized');
      return;
    }

    this._isLoading.set(true);

    try {
      // Call backend via RPC
      const result = await this.rpcService.call('context:getAllFiles', {
        includeImages: false,
        limit: 500,
      });

      if (result.success && result.data?.files) {
        // Transform backend format to FileSuggestion format
        const suggestions: FileSuggestion[] = result.data.files.map((file) => {
          // Extract directory from relativePath (everything before the last /)
          const lastSlashIndex = file.relativePath.lastIndexOf('/');
          const directory =
            lastSlashIndex > 0
              ? file.relativePath.substring(0, lastSlashIndex)
              : file.relativePath; // Use full path if no slash or at root

          return {
            path: file.uri,
            name: file.fileName,
            directory,
            type: file.isDirectory ? 'directory' : 'file',
            extension: file.fileType || undefined,
            size: file.size,
            lastModified: file.lastModified,
            isImage: this.imageExtensions.has(`.${file.fileType}`),
            isText: this.textExtensions.has(`.${file.fileType}`),
          };
        });

        this._workspaceFiles.set(suggestions);
        this._lastUpdate.set(Date.now());
      }
    } catch (error) {
      console.error(
        '[FilePickerService] Failed to fetch workspace files:',
        error
      );
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Ensure files are loaded before showing dropdown
   * TASK_2025_019 Phase 1: Call this when @ is typed
   */
  async ensureFilesLoaded(): Promise<void> {
    const files = this._workspaceFiles();
    const lastUpdate = this._lastUpdate();
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    // Fetch if: no files OR last update > 5 minutes ago
    if (files.length === 0 || lastUpdate < fiveMinutesAgo) {
      await this.fetchWorkspaceFiles();
    }
  }

  /**
   * Search workspace files for @ syntax autocomplete
   *
   * @param query - Search query string
   * @returns Filtered and sorted file suggestions (max 20)
   */
  searchFiles(query: string): FileSuggestion[] {
    if (!query || query.length < 1) {
      return this._workspaceFiles().slice(0, 10); // Return first 10 files
    }

    const searchTerm = query.toLowerCase();
    return this._workspaceFiles()
      .filter(
        (file) =>
          file.name.toLowerCase().includes(searchTerm) ||
          file.path.toLowerCase().includes(searchTerm)
      )
      .sort((a, b) => {
        // Sort by relevance - exact matches first
        const aExact = a.name.toLowerCase().startsWith(searchTerm) ? 0 : 1;
        const bExact = b.name.toLowerCase().startsWith(searchTerm) ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;

        // Then by file type preference (text files first)
        const aScore = a.isText ? 0 : a.isImage ? 1 : 2;
        const bScore = b.isText ? 0 : b.isImage ? 1 : 2;
        if (aScore !== bScore) return aScore - bScore;

        // Finally alphabetically
        return a.name.localeCompare(b.name);
      })
      .slice(0, 20); // Limit to 20 results
  }

  /**
   * Remove a file from inclusion
   *
   * @param filePath - Absolute path to file
   */
  removeFile(filePath: string): void {
    this._includedFiles.update((files) =>
      files.filter((f) => f.path !== filePath)
    );
  }

  /**
   * Clear all included files
   */
  clearFiles(): void {
    this._includedFiles.set([]);
  }

  /**
   * Get file paths for message transmission to extension
   *
   * @returns Array of absolute file paths
   */
  getFilePathsForMessage(): string[] {
    return this._includedFiles().map((f) => f.path);
  }

  /**
   * Estimate token count for a file
   *
   * @param size - File size in bytes
   * @param isText - Whether file is text-based
   * @returns Estimated token count
   */
  private estimateTokens(size: number, isText: boolean): number {
    if (!isText) return 0;

    // Rough estimate: ~4 characters per token for code/text files
    return Math.ceil(size / 4);
  }

  /**
   * Check if file is supported for inclusion
   *
   * @param path - File path to check
   * @returns True if file type is supported
   */
  isFileSupported(path: string): boolean {
    const extension = path.substring(path.lastIndexOf('.')).toLowerCase();
    return (
      this.textExtensions.has(extension) || this.imageExtensions.has(extension)
    );
  }

  /**
   * Get file type icon for UI display
   *
   * @param file - File or suggestion to get icon for
   * @returns Emoji icon representing file type
   */
  getFileTypeIcon(file: FileSuggestion | ChatFile): string {
    if ('isImage' in file && file.isImage) return '🖼️';
    if ('isText' in file && file.isText) return '📄';
    if (file.type === 'image') return '🖼️';
    if (file.type === 'text') return '📄';
    return '📁';
  }
}
