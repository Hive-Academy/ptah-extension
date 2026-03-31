/**
 * ContentDownloadService
 *
 * Downloads plugin and template content from GitHub to ~/.ptah/ local cache.
 * Platform-agnostic: NO vscode imports. Usable from VS Code and Electron.
 *
 * Pattern: PtahFileSettingsManager (file-settings-manager.ts)
 * - Uses homedir() for ~/.ptah/ path resolution
 * - Uses atomic writes (temp + rename) for safety
 * - Handles first-run gracefully (directories don't exist)
 * - Write serialization via writePromise chain pattern
 *
 * TASK_2025_248
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import * as https from 'https';
import * as http from 'http';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Cache metadata stored at ~/.ptah/.content-cache.json */
interface ContentCacheMetadata {
  contentHash: string;
  downloadedAt: string;
  manifestVersion: string;
  pluginCount: number;
  templateCount: number;
}

/** Structure of content-manifest.json */
interface ContentManifest {
  $schema: string;
  version: string;
  contentHash: string;
  generatedAt: string;
  baseUrl: string;
  plugins: {
    basePath: string;
    files: string[];
  };
  templates: {
    basePath: string;
    files: string[];
  };
}

/** Progress callback for UI integration */
export type ContentProgressCallback = (
  phase: string,
  current: number,
  total: number,
) => void;

/** Result of ensureContent() */
export interface ContentDownloadResult {
  success: boolean;
  pluginsDownloaded: number;
  templatesDownloaded: number;
  fromCache: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ContentDownloadService {
  private readonly ptahDir: string;
  private readonly pluginsDir: string;
  private readonly templatesDir: string;
  private readonly cacheMetadataPath: string;

  /** In-flight download promise for deduplicating concurrent calls */
  private inFlightPromise: Promise<ContentDownloadResult> | null = null;

  /** Write serialization -- prevents concurrent file writes from corrupting the cache */
  private writePromise: Promise<void> = Promise.resolve();

  /** Maximum parallel file downloads */
  private static readonly MAX_CONCURRENCY = 10;

  /** GitHub manifest URL (main branch) */
  private static readonly MANIFEST_URL =
    'https://raw.githubusercontent.com/Hive-Academy/ptah-extension/main/content-manifest.json';

  constructor() {
    this.ptahDir = path.join(homedir(), '.ptah');
    this.pluginsDir = path.join(this.ptahDir, 'plugins');
    this.templatesDir = path.join(this.ptahDir, 'templates', 'agents');
    this.cacheMetadataPath = path.join(this.ptahDir, '.content-cache.json');
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Ensure content is available locally.
   *
   * 1. Fetch manifest from GitHub
   * 2. Compare contentHash against local cache
   * 3. If stale/missing, download all files
   * 4. On failure, return existing cache status (offline mode)
   *
   * Safe to call multiple times -- deduplicates concurrent calls.
   * Never throws -- all errors are caught and returned in the result.
   */
  async ensureContent(
    onProgress?: ContentProgressCallback,
    forceRefresh?: boolean,
  ): Promise<ContentDownloadResult> {
    // Deduplicate concurrent calls — return the in-flight promise
    if (this.inFlightPromise) {
      return this.inFlightPromise;
    }

    this.inFlightPromise = this.doEnsureContent(onProgress, forceRefresh)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[ContentDownloadService] ensureContent failed: ${message}`,
        );
        return {
          success: false,
          pluginsDownloaded: 0,
          templatesDownloaded: 0,
          fromCache: this.isContentAvailable(),
          error: message,
        } as ContentDownloadResult;
      })
      .finally(() => {
        this.inFlightPromise = null;
      });

    return this.inFlightPromise;
  }

  /**
   * Check if content cache exists and has files.
   * Used by PluginLoaderService/TemplateStorageService to determine
   * if content is available before attempting to load.
   */
  isContentAvailable(): boolean {
    try {
      return fs.existsSync(this.pluginsDir) || fs.existsSync(this.templatesDir);
    } catch {
      return false;
    }
  }

  /**
   * Get the absolute path to the plugins cache directory.
   * Returns: ~/.ptah/plugins/
   */
  getPluginsPath(): string {
    return this.pluginsDir;
  }

  /**
   * Get the absolute path to the templates cache directory.
   * Returns: ~/.ptah/templates/agents/
   */
  getTemplatesPath(): string {
    return this.templatesDir;
  }

  // -------------------------------------------------------------------------
  // Internal implementation
  // -------------------------------------------------------------------------

  /**
   * Core download logic, separated from the public guard wrapper.
   */
  private async doEnsureContent(
    onProgress?: ContentProgressCallback,
    forceRefresh?: boolean,
  ): Promise<ContentDownloadResult> {
    // Step 1: Fetch manifest from GitHub
    onProgress?.('Fetching manifest', 0, 1);
    let manifest: ContentManifest;

    try {
      const manifestJson = await this.downloadText(
        ContentDownloadService.MANIFEST_URL,
      );
      manifest = JSON.parse(manifestJson) as ContentManifest;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[ContentDownloadService] Failed to fetch manifest: ${message}`,
      );
      return {
        success: false,
        pluginsDownloaded: 0,
        templatesDownloaded: 0,
        fromCache: this.isContentAvailable(),
        error: `Manifest fetch failed: ${message}`,
      };
    }

    // Step 2: Check if cache is up to date
    if (!forceRefresh) {
      const cachedMeta = this.loadCacheMetadata();
      if (cachedMeta && cachedMeta.contentHash === manifest.contentHash) {
        onProgress?.('Cache up to date', 1, 1);
        return {
          success: true,
          pluginsDownloaded: cachedMeta.pluginCount,
          templatesDownloaded: cachedMeta.templateCount,
          fromCache: true,
        };
      }
    }

    // Step 3: Prune stale cached files no longer present in the manifest
    this.pruneStaleFiles(this.pluginsDir, manifest.plugins.files);
    this.pruneStaleFiles(this.templatesDir, manifest.templates.files);

    // Step 4: Download all files
    const totalFiles =
      manifest.plugins.files.length + manifest.templates.files.length;
    let downloadedCount = 0;

    onProgress?.('Downloading plugins', 0, totalFiles);

    // Download plugin files
    const pluginResults = await this.downloadFilesBatch(
      manifest.plugins.files,
      manifest.baseUrl,
      manifest.plugins.basePath,
      this.pluginsDir,
      (current) => {
        downloadedCount = current;
        onProgress?.('Downloading plugins', downloadedCount, totalFiles);
      },
    );

    onProgress?.('Downloading templates', pluginResults.succeeded, totalFiles);

    // Download template files
    const templateResults = await this.downloadFilesBatch(
      manifest.templates.files,
      manifest.baseUrl,
      manifest.templates.basePath,
      this.templatesDir,
      (current) => {
        downloadedCount = pluginResults.succeeded + current;
        onProgress?.('Downloading templates', downloadedCount, totalFiles);
      },
    );

    // Step 5: Update cache metadata (serialized through writePromise chain)
    const cacheMetadata: ContentCacheMetadata = {
      contentHash: manifest.contentHash,
      downloadedAt: new Date().toISOString(),
      manifestVersion: manifest.version,
      pluginCount: pluginResults.succeeded,
      templateCount: templateResults.succeeded,
    };

    this.writePromise = this.writePromise.then(
      () => this.persistCacheMetadata(cacheMetadata),
      () => this.persistCacheMetadata(cacheMetadata),
    );
    await this.writePromise;

    onProgress?.('Complete', totalFiles, totalFiles);

    const allSucceeded =
      pluginResults.failed === 0 && templateResults.failed === 0;

    return {
      success: allSucceeded,
      pluginsDownloaded: pluginResults.succeeded,
      templatesDownloaded: templateResults.succeeded,
      fromCache: false,
      error: allSucceeded
        ? undefined
        : `${pluginResults.failed + templateResults.failed} file(s) failed to download`,
    };
  }

  /**
   * Remove cached files that are no longer listed in the manifest.
   * Walks the local directory and deletes files whose relative path
   * is not in the manifest file list.
   */
  private pruneStaleFiles(localDir: string, manifestFiles: string[]): void {
    try {
      const manifestSet = new Set(manifestFiles);
      const localFiles = this.walkLocalDir(localDir, localDir);

      for (const relPath of localFiles) {
        if (!manifestSet.has(relPath)) {
          try {
            const fullPath = path.join(localDir, ...relPath.split('/'));
            fs.unlinkSync(fullPath);
          } catch {
            // Non-fatal: file may already be removed
          }
        }
      }
    } catch {
      // Directory may not exist on first run — nothing to prune
    }
  }

  /**
   * Recursively collect all file paths relative to baseDir.
   * Returns forward-slash-separated relative paths.
   */
  private walkLocalDir(dir: string, baseDir: string): string[] {
    const results: string[] = [];
    let entries: string[];

    try {
      entries = fs.readdirSync(dir);
    } catch {
      return results;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          results.push(...this.walkLocalDir(fullPath, baseDir));
        } else if (stat.isFile()) {
          results.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
        }
      } catch {
        // Skip inaccessible entries
      }
    }

    return results;
  }

  /**
   * Download a batch of files with limited concurrency.
   *
   * @param files - Relative file paths (e.g., "ptah-core/.claude-plugin/plugin.json")
   * @param baseUrl - GitHub raw base URL
   * @param basePath - Source path in the repo (e.g., "apps/ptah-extension-vscode/assets/plugins")
   * @param localDir - Local destination directory (e.g., ~/.ptah/plugins/)
   * @param onFileComplete - Callback with count of completed files
   */
  private async downloadFilesBatch(
    files: string[],
    baseUrl: string,
    basePath: string,
    localDir: string,
    onFileComplete?: (completed: number) => void,
  ): Promise<{ succeeded: number; failed: number }> {
    let succeeded = 0;
    let failed = 0;
    let completed = 0;

    // Process files in chunks of MAX_CONCURRENCY
    for (
      let i = 0;
      i < files.length;
      i += ContentDownloadService.MAX_CONCURRENCY
    ) {
      const chunk = files.slice(i, i + ContentDownloadService.MAX_CONCURRENCY);

      const results = await Promise.allSettled(
        chunk.map(async (file) => {
          const url = `${baseUrl}/${basePath}/${file}`;
          const localPath = path.resolve(localDir, ...file.split('/'));

          // Guard against path traversal from malicious manifest entries
          if (!localPath.startsWith(path.resolve(localDir) + path.sep)) {
            throw new Error(
              `Path traversal detected: "${file}" resolves outside target directory`,
            );
          }

          await this.downloadToFile(url, localPath);
        }),
      );

      for (const result of results) {
        completed++;
        if (result.status === 'fulfilled') {
          succeeded++;
        } else {
          failed++;
          console.warn(
            `[ContentDownloadService] Failed to download file: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
          );
        }
        onFileComplete?.(completed);
      }
    }

    return { succeeded, failed };
  }

  /**
   * Download a single file from URL and write it atomically to localPath.
   * Creates parent directories as needed.
   */
  private async downloadToFile(url: string, localPath: string): Promise<void> {
    const content = await this.downloadText(url);

    // Ensure parent directory exists
    const dir = path.dirname(localPath);
    await fsPromises.mkdir(dir, { recursive: true });

    // Atomic write: write to temp file, then rename
    const tmpPath = localPath + '.tmp';
    await fsPromises.writeFile(tmpPath, content, 'utf-8');
    await fsPromises.rename(tmpPath, localPath);
  }

  /**
   * Download text content from a URL using Node's built-in https module.
   * Follows redirects (301, 302). Rejects on non-200 status codes.
   */
  private downloadText(url: string, maxRedirects = 5): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (maxRedirects <= 0) {
        reject(new Error(`Too many redirects for ${url}`));
        return;
      }

      const client = url.startsWith('https:') ? https : http;

      const req = client.get(url, (res) => {
        // Follow redirects
        if (
          (res.statusCode === 301 || res.statusCode === 302) &&
          res.headers.location
        ) {
          const redirectUrl = new URL(res.headers.location, url).toString();
          this.downloadText(redirectUrl, maxRedirects - 1).then(
            resolve,
            reject,
          );
          // Consume the response to free up the socket
          res.resume();
          return;
        }

        if (res.statusCode !== 200) {
          // Consume the response to free up the socket
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }

        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          data += chunk;
        });
        res.on('end', () => resolve(data));
        res.on('error', reject);
      });

      req.on('error', reject);

      // Timeout after 30 seconds per request
      req.setTimeout(30_000, () => {
        req.destroy(new Error(`Request timeout for ${url}`));
      });
    });
  }

  /**
   * Load cache metadata from ~/.ptah/.content-cache.json.
   * Returns null if file doesn't exist or is malformed.
   */
  private loadCacheMetadata(): ContentCacheMetadata | null {
    try {
      const raw = fs.readFileSync(this.cacheMetadataPath, 'utf-8');
      const parsed = JSON.parse(raw) as ContentCacheMetadata;

      // Validate required fields
      if (
        typeof parsed.contentHash === 'string' &&
        typeof parsed.downloadedAt === 'string'
      ) {
        return parsed;
      }

      return null;
    } catch {
      // File doesn't exist or is corrupted -- treat as no cache
      return null;
    }
  }

  /**
   * Persist cache metadata to ~/.ptah/.content-cache.json using atomic write.
   * Creates ~/.ptah/ directory if it doesn't exist.
   * Follows PtahFileSettingsManager.persist() pattern.
   */
  private async persistCacheMetadata(
    metadata: ContentCacheMetadata,
  ): Promise<void> {
    try {
      await fsPromises.mkdir(this.ptahDir, { recursive: true });

      const json = JSON.stringify(metadata, null, 2);
      const tmpPath = this.cacheMetadataPath + '.tmp';

      // Atomic write: write to temp file, then rename
      await fsPromises.writeFile(tmpPath, json, 'utf-8');
      await fsPromises.rename(tmpPath, this.cacheMetadataPath);
    } catch (error: unknown) {
      // Swallow persist errors -- matches PtahFileSettingsManager convention
      console.warn(
        `[ContentDownloadService] Failed to persist cache metadata: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
