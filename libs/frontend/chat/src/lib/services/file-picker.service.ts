import { Injectable, signal, computed, inject } from '@angular/core';
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
  private readonly rpcService = inject(ClaudeRpcService);

  // === ANGULAR 20 PATTERN: Private signals for internal state ===
  private readonly _workspaceFiles = signal<FileSuggestion[]>([]);
  private readonly _includedFiles = signal<ChatFile[]>([]);
  private readonly _isLoading = signal(false);
  private readonly _lastUpdate = signal<number>(0);
  private readonly _fetchError = signal<string | null>(null);
  private _pendingFetch: Promise<void> | null = null;

  // Remote search state (server-side results via context:getFileSuggestions)
  private readonly _remoteResults = signal<FileSuggestion[]>([]);
  private readonly _isRemoteSearching = signal(false);
  private _remoteSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private _remoteSearchAbortId = 0; // Monotonic ID to discard stale responses

  /** Last error from file fetch, exposed for UI display */
  readonly fetchError = this._fetchError.asReadonly();

  // === ANGULAR 20 PATTERN: Readonly signals for external access ===
  readonly workspaceFiles = this._workspaceFiles.asReadonly();
  readonly includedFiles = this._includedFiles.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly remoteResults = this._remoteResults.asReadonly();
  readonly isRemoteSearching = this._isRemoteSearching.asReadonly();

  // === ANGULAR 20 PATTERN: Computed signals for derived state ===
  readonly fileCount = computed(() => this._includedFiles().length);

  readonly totalSize = computed(() =>
    this._includedFiles().reduce((total, file) => total + file.size, 0),
  );

  readonly totalTokens = computed(() =>
    this._includedFiles().reduce(
      (total, file) => total + file.tokenEstimate,
      0,
    ),
  );

  readonly hasLargeFiles = computed(() =>
    this._includedFiles().some((file) => file.isLarge),
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
        `${largeFiles.length} large files detected - consider file compression`,
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
   * Fetch workspace files from backend via RPC.
   * Populates _workspaceFiles signal for @ autocomplete.
   */
  async fetchWorkspaceFiles(): Promise<void> {
    // Deduplicate: if a fetch is already in-flight, await it instead of returning empty
    if (this._isLoading() && this._pendingFetch) {
      return this._pendingFetch;
    }

    this._isLoading.set(true);
    this._fetchError.set(null);

    this._pendingFetch = this._doFetchWorkspaceFiles();
    try {
      await this._pendingFetch;
    } finally {
      this._pendingFetch = null;
    }
  }

  private async _doFetchWorkspaceFiles(): Promise<void> {
    try {
      const result = await this.rpcService.call('context:getAllFiles', {
        includeImages: false,
        limit: 1000,
      });

      // Check both RPC-level success AND backend-level success (nested in data)
      const backendData = result.data as
        | { success?: boolean; error?: { message: string }; files?: unknown[] }
        | undefined;
      const backendFailed = backendData?.success === false;

      if (result.success && !backendFailed && backendData?.files) {
        const files = result.data!.files!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
        const suggestions: FileSuggestion[] = files.map((file) => {
          // Normalize Windows backslashes for directory extraction
          const normalizedPath = file.relativePath.replace(/\\/g, '/');
          const lastSlashIndex = normalizedPath.lastIndexOf('/');
          const directory =
            lastSlashIndex > 0
              ? normalizedPath.substring(0, lastSlashIndex)
              : '';

          // Extract actual file extension from fileName (not fileType category)
          const dotIndex = file.fileName.lastIndexOf('.');
          const ext =
            dotIndex > 0 ? file.fileName.substring(dotIndex).toLowerCase() : '';

          return {
            path: file.fsPath || file.uri,
            name: file.fileName,
            directory,
            type: file.isDirectory ? 'directory' : 'file',
            extension: ext || undefined,
            size: file.size,
            lastModified: file.lastModified,
            isImage: this.imageExtensions.has(ext),
            isText: this.textExtensions.has(ext),
          };
        });

        this._workspaceFiles.set(suggestions);
        this._lastUpdate.set(Date.now());
        console.debug(
          `[FilePickerService] Loaded ${suggestions.length} workspace files`,
        );
      } else {
        // Extract error from nested backend response or RPC-level error
        const errorMsg =
          backendData?.error?.message ||
          result.error ||
          'No files returned from workspace';
        console.warn(
          `[FilePickerService] context:getAllFiles failed: ${errorMsg}`,
        );
        this._fetchError.set(errorMsg);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(
        '[FilePickerService] Failed to fetch workspace files:',
        error,
      );
      this._fetchError.set(errorMsg);
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Ensure files are loaded before showing dropdown.
   * Retries once with backoff for transient errors (skips retry on timeout).
   */
  async ensureFilesLoaded(): Promise<void> {
    this._fetchError.set(null);

    const files = this._workspaceFiles();
    const lastUpdate = this._lastUpdate();
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    if (files.length === 0 || lastUpdate < fiveMinutesAgo) {
      await this.fetchWorkspaceFiles();

      // Retry once with delay — skip if error was a timeout (would just timeout again)
      const error = this._fetchError();
      if (
        this._workspaceFiles().length === 0 &&
        error &&
        !error.toLowerCase().includes('timeout')
      ) {
        await new Promise((r) => setTimeout(r, 1500));
        await this.fetchWorkspaceFiles();
      }
    }
  }

  /**
   * Search workspace files for @ syntax autocomplete with fuzzy token matching.
   *
   * Matching strategy (in priority order):
   * 1. Exact substring match on name/path/directory (highest score)
   * 2. Token-based fuzzy match: splits query and filenames on `-`, `.`, `/`, `_`
   *    and checks if all query tokens appear in the file tokens.
   *    e.g., "chatinp" matches "chat-input.component.ts" because "chatinp" prefix-matches "chat" + "input"
   *
   * @param query - Search query string
   * @returns Filtered and sorted file suggestions (max 30)
   */
  searchFiles(query: string): FileSuggestion[] {
    if (!query || query.length < 1) {
      return this._workspaceFiles().slice(0, 50);
    }

    const searchTerm = query.toLowerCase();

    // Score each file and collect matches
    const scored: Array<{ file: FileSuggestion; score: number }> = [];

    for (const file of this._workspaceFiles()) {
      const score = this.scoreFileMatch(file, searchTerm);
      if (score > 0) {
        scored.push({ file, score });
      }
    }

    // Sort by score descending, then alphabetically
    scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.file.name.localeCompare(b.file.name);
    });

    return scored.map((s) => s.file).slice(0, 30);
  }

  /**
   * Score how well a file matches the search query.
   * Returns 0 for no match, higher scores for better matches.
   */
  private scoreFileMatch(file: FileSuggestion, searchTerm: string): number {
    const nameLower = file.name.toLowerCase();
    const pathLower = file.path.toLowerCase();
    const dirLower = file.directory.toLowerCase();

    let score = 0;

    // Tier 1: Exact name match (200 points)
    if (nameLower === searchTerm) return 200;

    // Tier 2: Name starts with query (100 points)
    if (nameLower.startsWith(searchTerm)) score = 100;
    // Tier 3: Name contains query as substring (80 points)
    else if (nameLower.includes(searchTerm)) score = 80;
    // Tier 4: Path contains query (40 points)
    else if (pathLower.includes(searchTerm)) score = 40;
    // Tier 5: Directory contains query (30 points)
    else if (dirLower.includes(searchTerm)) score = 30;

    // If exact substring matched, add bonus for text files and return
    if (score > 0) {
      if (file.isText) score += 5;
      return score;
    }

    // Tier 6: Fuzzy token matching (20 base points)
    // Split both query and filename into tokens on delimiters
    const queryTokens = this.tokenize(searchTerm);
    const fileTokens = this.tokenize(nameLower);
    const pathTokens = this.tokenize(dirLower);
    const allFileTokens = [...fileTokens, ...pathTokens];

    if (
      queryTokens.length > 0 &&
      this.tokensMatch(queryTokens, allFileTokens)
    ) {
      score = 20;
      // Bonus: if all query tokens match name tokens (not just path)
      if (this.tokensMatch(queryTokens, fileTokens)) score = 25;
      if (file.isText) score += 5;
      return score;
    }

    // Tier 7: Contiguous character matching (for queries without delimiters)
    // e.g., "chatinp" should match "chat-input" by matching chars sequentially
    if (
      searchTerm.length >= 3 &&
      this.sequentialCharMatch(searchTerm, nameLower)
    ) {
      score = 15;
      if (file.isText) score += 5;
      return score;
    }

    return 0;
  }

  /**
   * Tokenize a string by splitting on common delimiters: - . / _ \
   * Also splits camelCase boundaries.
   */
  private tokenize(str: string): string[] {
    return str
      .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase split
      .split(/[-._/\\]+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
  }

  /**
   * Check if all query tokens prefix-match at least one file token.
   * e.g., queryTokens=["chat","inp"] matches fileTokens=["chat","input","component","ts"]
   */
  private tokensMatch(queryTokens: string[], fileTokens: string[]): boolean {
    return queryTokens.every((qt) =>
      fileTokens.some((ft) => ft.startsWith(qt) || ft.includes(qt)),
    );
  }

  /**
   * Check if query characters appear sequentially in the target,
   * skipping delimiter characters in the target.
   * e.g., "chatinput" matches "chat-input.component.ts"
   */
  private sequentialCharMatch(query: string, target: string): boolean {
    // Strip delimiters from target for contiguous matching
    const stripped = target.replace(/[-._/\\]/g, '');
    if (stripped.includes(query)) return true;

    // Subsequence match: each query char appears in order
    let qi = 0;
    for (let ti = 0; ti < stripped.length && qi < query.length; ti++) {
      if (stripped[ti] === query[qi]) qi++;
    }
    return qi === query.length;
  }

  /**
   * Trigger a server-side file search via context:getFileSuggestions RPC.
   * Debounces by 200ms internally. Results stored in _remoteResults signal.
   * Calling components should read remoteResults() for the results.
   */
  searchFilesRemote(query: string): void {
    // Clear pending timer
    if (this._remoteSearchTimer) {
      clearTimeout(this._remoteSearchTimer);
      this._remoteSearchTimer = null;
    }

    // Clear results if query too short
    if (!query || query.length < 2) {
      this._remoteResults.set([]);
      this._isRemoteSearching.set(false);
      return;
    }

    this._isRemoteSearching.set(true);
    const searchId = ++this._remoteSearchAbortId;

    this._remoteSearchTimer = setTimeout(async () => {
      try {
        const result = await this.rpcService.call(
          'context:getFileSuggestions',
          { query: query.trim(), limit: 30 },
        );

        // Discard if a newer search was started
        if (searchId !== this._remoteSearchAbortId) return;

        const backendData = result.data as
          | {
              success?: boolean;
              files?: Array<Record<string, unknown>>;
              suggestions?: Array<Record<string, unknown>>;
            }
          | undefined;

        // Handle both `files` (correct) and `suggestions` (legacy) field names
        const rawFiles = backendData?.files ?? backendData?.suggestions;

        if (result.success && rawFiles && rawFiles.length > 0) {
          const suggestions: FileSuggestion[] = rawFiles.map(
            (file: Record<string, unknown>) => {
              const relativePath = String(file['relativePath'] ?? '').replace(
                /\\/g,
                '/',
              );
              const lastSlash = relativePath.lastIndexOf('/');
              const directory =
                lastSlash > 0 ? relativePath.substring(0, lastSlash) : '';
              const fileName = String(file['fileName'] ?? '');
              const dotIdx = fileName.lastIndexOf('.');
              const ext =
                dotIdx > 0 ? fileName.substring(dotIdx).toLowerCase() : '';

              return {
                path: String(file['fsPath'] ?? file['uri'] ?? ''),
                name: fileName,
                directory,
                type: file['isDirectory'] ? 'directory' : 'file',
                extension: ext || undefined,
                size: Number(file['size'] ?? 0),
                lastModified: Number(file['lastModified'] ?? 0),
                isImage: this.imageExtensions.has(ext),
                isText: this.textExtensions.has(ext),
              } as FileSuggestion;
            },
          );

          this._remoteResults.set(suggestions);
        } else {
          this._remoteResults.set([]);
        }
      } catch (error) {
        console.warn('[FilePickerService] Remote file search failed:', error);
        // Don't clear results on error — keep stale results visible
      } finally {
        if (searchId === this._remoteSearchAbortId) {
          this._isRemoteSearching.set(false);
        }
      }
    }, 200);
  }

  /**
   * Clear remote search results (call when dropdown closes)
   */
  clearRemoteResults(): void {
    this._remoteResults.set([]);
    this._isRemoteSearching.set(false);
    if (this._remoteSearchTimer) {
      clearTimeout(this._remoteSearchTimer);
      this._remoteSearchTimer = null;
    }
  }

  /**
   * Remove a file from inclusion
   *
   * @param filePath - Absolute path to file
   */
  removeFile(filePath: string): void {
    this._includedFiles.update((files) =>
      files.filter((f) => f.path !== filePath),
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
}
