import { Injectable, signal, computed, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VSCodeService } from './vscode.service';

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
 * File Picker Service - Manages workspace file discovery and inclusion
 * - Provides @ syntax autocomplete with workspace files
 * - Handles file content retrieval and optimization
 * - Manages file previews and metadata
 * - Integrates with VS Code workspace APIs
 */
@Injectable({
  providedIn: 'root',
})
export class FilePickerService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly vscode = inject(VSCodeService);

  // ANGULAR 20 PATTERN: Private signals for internal state
  private readonly _workspaceFiles = signal<FileSuggestion[]>([]);
  private readonly _includedFiles = signal<ChatFile[]>([]);
  private readonly _isLoading = signal(false);
  private readonly _lastUpdate = signal<number>(0);

  // ANGULAR 20 PATTERN: Readonly signals for external access
  readonly workspaceFiles = this._workspaceFiles.asReadonly();
  readonly includedFiles = this._includedFiles.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();

  // ANGULAR 20 PATTERN: Computed signals for derived state
  readonly fileCount = computed(() => this._includedFiles().length);
  readonly totalSize = computed(() =>
    this._includedFiles().reduce((total, file) => total + file.size, 0),
  );
  readonly totalTokens = computed(() =>
    this._includedFiles().reduce((total, file) => total + file.tokenEstimate, 0),
  );

  readonly hasLargeFiles = computed(() => this._includedFiles().some((file) => file.isLarge));

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
      suggestions.push(`${largeFiles.length} large files detected - consider file compression`);
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

  constructor() {
    this.setupMessageHandlers();
    this.refreshWorkspaceFiles();
  }

  /**
   * Set up message handlers for file operations
   */
  private setupMessageHandlers(): void {
    // Listen for workspace file updates
    this.vscode
      .onMessageType('context:updateFiles')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => {
        this.processWorkspaceFiles(payload.files);
      });

    // Listen for workspace files response (this will be handled by the extension)
    // For now, we'll use the context:updateFiles message type
    // this.vscode.onMessageType('context:workspaceFiles')
    //   .pipe(takeUntilDestroyed(this.destroyRef))
    //   .subscribe((payload) => {
    //     this.processWorkspaceFilesResponse(payload.files);
    //   });

    // Listen for file content responses
    this.vscode
      .onMessageType('context:fileContent')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => {
        this.processFileContent(payload);
      });
  }

  /**
   * Request workspace files from VS Code
   */
  refreshWorkspaceFiles(): void {
    this._isLoading.set(true);
    // Use the existing getContextFiles method for now
    this.vscode.getContextFiles();
  }

  /**
   * Process workspace files from VS Code (legacy format)
   */
  private processWorkspaceFiles(filePaths: readonly string[]): void {
    const suggestions: FileSuggestion[] = filePaths.map((path) => {
      const name = path.split('/').pop() || path;
      const directory = path.substring(0, path.lastIndexOf('/')) || '';
      const extension = name.includes('.') ? name.substring(name.lastIndexOf('.')) : '';

      return {
        path,
        name,
        directory,
        type: 'file' as const,
        extension,
        isImage: this.imageExtensions.has(extension.toLowerCase()),
        isText: this.textExtensions.has(extension.toLowerCase()),
      };
    });

    this._workspaceFiles.set(suggestions);
    this._lastUpdate.set(Date.now());
    this._isLoading.set(false);
  }

  /**
   * Process workspace files response with metadata
   */
  private processWorkspaceFilesResponse(
    files: readonly {
      readonly path: string;
      readonly name: string;
      readonly size?: number;
      readonly type: 'file' | 'directory';
      readonly extension?: string;
      readonly lastModified?: number;
    }[],
  ): void {
    const suggestions: FileSuggestion[] = files
      .filter((file) => file.type === 'file') // Only include files, not directories
      .map((file) => {
        const directory = file.path.substring(0, file.path.lastIndexOf('/')) || '';
        const extension = file.extension || '';

        return {
          path: file.path,
          name: file.name,
          directory,
          type: 'file' as const,
          extension,
          size: file.size,
          lastModified: file.lastModified,
          isImage: this.imageExtensions.has(extension.toLowerCase()),
          isText: this.textExtensions.has(extension.toLowerCase()),
        };
      });

    this._workspaceFiles.set(suggestions);
    this._lastUpdate.set(Date.now());
    this._isLoading.set(false);
  }

  /**
   * Process file content response
   */
  private processFileContent(payload: {
    readonly filePath: string;
    readonly content: string;
    readonly encoding: string;
    readonly size: number;
    readonly type: 'text' | 'image' | 'binary';
    readonly preview?: string;
    readonly error?: string;
  }): void {
    if (payload.error) {
      console.error('File content error:', payload.error);
      return;
    }

    // Update the included file with content
    this._includedFiles.update((files) =>
      files.map((file) => {
        if (file.path === payload.filePath) {
          return {
            ...file,
            content: payload.content,
            encoding: payload.encoding,
            size: payload.size,
            type: payload.type,
            preview: payload.preview,
            tokenEstimate: this.estimateTokens(payload.size, payload.type === 'text'),
          };
        }
        return file;
      }),
    );
  }

  /**
   * Search workspace files for @ syntax autocomplete
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
          file.path.toLowerCase().includes(searchTerm),
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
   * Include a file in the chat message
   */
  async includeFile(filePath: string): Promise<void> {
    // Check if file is already included
    if (this._includedFiles().some((f) => f.path === filePath)) {
      return;
    }

    // Create a placeholder file entry first
    const suggestion = this._workspaceFiles().find((f) => f.path === filePath);
    if (suggestion) {
      const chatFile: ChatFile = {
        path: filePath,
        name: suggestion.name,
        size: suggestion.size || 0,
        type: suggestion.isImage ? 'image' : suggestion.isText ? 'text' : 'binary',
        isLarge: (suggestion.size || 0) > 100000, // > 100KB
        tokenEstimate: this.estimateTokens(suggestion.size || 0, suggestion.isText),
      };

      this._includedFiles.update((files) => [...files, chatFile]);

      // Request file content from VS Code for text files and images
      if (suggestion.isText || suggestion.isImage) {
        this.vscode.includeFile(filePath);
      }
    }
  }

  /**
   * Remove a file from inclusion
   */
  removeFile(filePath: string): void {
    this._includedFiles.update((files) => files.filter((f) => f.path !== filePath));
  }

  /**
   * Clear all included files
   */
  clearFiles(): void {
    this._includedFiles.set([]);
  }

  /**
   * Get file paths for message transmission
   */
  getFilePathsForMessage(): string[] {
    return this._includedFiles().map((f) => f.path);
  }

  /**
   * Estimate token count for a file
   */
  private estimateTokens(size: number, isText: boolean): number {
    if (!isText) return 0;

    // Rough estimate: ~4 characters per token for code/text files
    return Math.ceil(size / 4);
  }

  /**
   * Check if file is supported for inclusion
   */
  isFileSupported(path: string): boolean {
    const extension = path.substring(path.lastIndexOf('.')).toLowerCase();
    return this.textExtensions.has(extension) || this.imageExtensions.has(extension);
  }

  /**
   * Get file type icon for UI display
   */
  getFileTypeIcon(file: FileSuggestion | ChatFile): string {
    if ('isImage' in file && file.isImage) return '🖼️';
    if ('isText' in file && file.isText) return '📄';
    if (file.type === 'image') return '🖼️';
    if (file.type === 'text') return '📄';
    return '📁';
  }
}
