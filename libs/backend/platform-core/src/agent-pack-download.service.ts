/**
 * AgentPackDownloadService
 *
 * Downloads pre-built agent packs from curated GitHub repositories to local directories.
 * Platform-agnostic: NO vscode imports. Usable from VS Code and Electron.
 *
 * Pattern: ContentDownloadService (content-download.service.ts)
 * - Uses homedir() for ~/.ptah/ path resolution
 * - Uses atomic writes (temp + rename) for safety
 * - Handles first-run gracefully (directories don't exist)
 * - In-flight promise deduplication
 * - 30s timeout per download
 *
 * TASK_2025_257
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Agent pack manifest structure (hosted at repo: agent-pack-manifest.json) */
interface AgentPackManifest {
  name: string;
  version: string;
  description: string;
  contentHash: string;
  baseUrl: string;
  agents: AgentPackEntry[];
}

/** A single agent entry within a pack manifest */
export interface AgentPackEntry {
  file: string;
  name: string;
  description: string;
  category: string;
}

/** Public info about an agent pack (returned to callers) */
export interface AgentPackInfo {
  name: string;
  version: string;
  description: string;
  agents: AgentPackEntry[];
  source: string;
}

/** Result of a download operation */
export interface AgentPackDownloadResult {
  success: boolean;
  agentsDownloaded: number;
  fromCache: boolean;
  error?: string;
}

/** Cache metadata stored at ~/.ptah/.agent-pack-cache.json */
interface AgentPackCacheMetadata {
  /** Map of manifest URL -> cache entry */
  packs: Record<
    string,
    {
      contentHash: string;
      downloadedAt: string;
      version: string;
      agentCount: number;
    }
  >;
}

/** Progress callback for UI integration */
type AgentPackProgressCallback = (downloaded: number, total: number) => void;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AgentPackDownloadService {
  private readonly ptahDir: string;
  private readonly cacheMetadataPath: string;

  /** In-flight download promises for deduplicating concurrent calls, keyed by manifest URL */
  private readonly inFlightPromises = new Map<
    string,
    Promise<AgentPackDownloadResult>
  >();

  /** Write serialization -- prevents concurrent file writes from corrupting the cache */
  private writePromise: Promise<void> = Promise.resolve();

  /** Maximum parallel file downloads */
  private static readonly MAX_CONCURRENCY = 10;

  /** Default curated pack manifest URLs */
  private static readonly CURATED_PACKS: string[] = [
    'https://raw.githubusercontent.com/Hive-Academy/ptah-extension/main/agent-pack-manifest.json',
  ];

  constructor() {
    this.ptahDir = path.join(homedir(), '.ptah');
    this.cacheMetadataPath = path.join(this.ptahDir, '.agent-pack-cache.json');
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Fetch information about an agent pack from its manifest URL.
   *
   * Never throws -- returns a pack info object or an object with empty agents
   * on failure.
   */
  async fetchPackInfo(manifestUrl: string): Promise<AgentPackInfo> {
    try {
      const manifest = await this.fetchManifest(manifestUrl);
      return {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        agents: manifest.agents,
        source: manifestUrl,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[AgentPackDownloadService] Failed to fetch pack info from ${manifestUrl}: ${message}`,
      );
      return {
        name: 'Unknown Pack',
        version: '0.0.0',
        description: `Failed to load: ${message}`,
        agents: [],
        source: manifestUrl,
      };
    }
  }

  /**
   * Download selected agents from a pack to the target directory.
   *
   * 1. Fetch manifest from the manifest URL
   * 2. Validate requested agent files against the manifest
   * 3. Check cache to avoid re-downloading unchanged content
   * 4. Download agent files to targetDir with atomic writes
   *
   * Safe to call multiple times with the same manifest URL -- deduplicates
   * concurrent calls. Never throws -- all errors are caught and returned
   * in the result.
   *
   * @param manifestUrl - URL to the agent pack manifest JSON
   * @param agentFiles - List of agent file names to download (must match manifest entries)
   * @param targetDir - Local directory to save downloaded agent files
   * @param onProgress - Optional progress callback (downloaded count, total count)
   */
  async downloadAgents(
    manifestUrl: string,
    agentFiles: string[],
    targetDir: string,
    onProgress?: AgentPackProgressCallback,
  ): Promise<AgentPackDownloadResult> {
    // Create a cache key combining manifest URL and specific agent selection
    const cacheKey = this.buildCacheKey(manifestUrl, agentFiles);

    // Deduplicate concurrent calls for the same manifest URL
    const existing = this.inFlightPromises.get(cacheKey);
    if (existing) {
      return existing;
    }

    const promise = this.doDownloadAgents(
      manifestUrl,
      agentFiles,
      targetDir,
      onProgress,
    )
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[AgentPackDownloadService] downloadAgents failed: ${message}`,
        );
        return {
          success: false,
          agentsDownloaded: 0,
          fromCache: false,
          error: message,
        } as AgentPackDownloadResult;
      })
      .finally(() => {
        this.inFlightPromises.delete(cacheKey);
      });

    this.inFlightPromises.set(cacheKey, promise);
    return promise;
  }

  /**
   * Fetch info for all curated (built-in) agent packs.
   *
   * Never throws -- packs that fail to load are returned with empty agents
   * and an error description.
   */
  async listCuratedPacks(): Promise<AgentPackInfo[]> {
    const results: AgentPackInfo[] = [];

    for (const url of AgentPackDownloadService.CURATED_PACKS) {
      const info = await this.fetchPackInfo(url);
      results.push(info);
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Internal implementation
  // -------------------------------------------------------------------------

  /**
   * Core download logic, separated from the public deduplication wrapper.
   */
  private async doDownloadAgents(
    manifestUrl: string,
    agentFiles: string[],
    targetDir: string,
    onProgress?: AgentPackProgressCallback,
  ): Promise<AgentPackDownloadResult> {
    // Step 1: Validate agent file names for security
    const validationError = this.validateAgentFiles(agentFiles);
    if (validationError) {
      return {
        success: false,
        agentsDownloaded: 0,
        fromCache: false,
        error: validationError,
      };
    }

    // Step 2: Fetch manifest
    let manifest: AgentPackManifest;
    try {
      manifest = await this.fetchManifest(manifestUrl);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        agentsDownloaded: 0,
        fromCache: false,
        error: `Manifest fetch failed: ${message}`,
      };
    }

    // Step 3: Verify requested files exist in the manifest
    const manifestFileSet = new Set(manifest.agents.map((a) => a.file));
    const missingFiles = agentFiles.filter((f) => !manifestFileSet.has(f));
    if (missingFiles.length > 0) {
      return {
        success: false,
        agentsDownloaded: 0,
        fromCache: false,
        error: `Files not found in manifest: ${missingFiles.join(', ')}`,
      };
    }

    // Step 4: Check cache (skip if contentHash is empty — forces re-download)
    const cacheEntry = this.getCacheEntry(manifestUrl);
    if (
      cacheEntry &&
      manifest.contentHash &&
      cacheEntry.contentHash === manifest.contentHash &&
      cacheEntry.agentCount === agentFiles.length
    ) {
      // Verify that all requested files actually exist on disk
      const allExist = agentFiles.every((file) => {
        const localPath = path.join(targetDir, path.basename(file));
        return fs.existsSync(localPath);
      });

      if (allExist) {
        onProgress?.(agentFiles.length, agentFiles.length);
        return {
          success: true,
          agentsDownloaded: agentFiles.length,
          fromCache: true,
        };
      }
    }

    // Step 5: Download agent files
    const totalFiles = agentFiles.length;
    let succeeded = 0;
    let failed = 0;
    let completed = 0;

    onProgress?.(0, totalFiles);

    // Process files in chunks of MAX_CONCURRENCY
    for (
      let i = 0;
      i < agentFiles.length;
      i += AgentPackDownloadService.MAX_CONCURRENCY
    ) {
      const chunk = agentFiles.slice(
        i,
        i + AgentPackDownloadService.MAX_CONCURRENCY,
      );

      const results = await Promise.allSettled(
        chunk.map(async (file) => {
          const url = `${manifest.baseUrl}/${file}`;
          const localPath = path.resolve(targetDir, path.basename(file));

          // Guard against path traversal
          if (!localPath.startsWith(path.resolve(targetDir) + path.sep)) {
            throw new Error(
              `Path traversal detected: "${file}" resolves outside target directory`,
            );
          }

          await this.downloadFile(url, localPath);
        }),
      );

      for (const result of results) {
        completed++;
        if (result.status === 'fulfilled') {
          succeeded++;
        } else {
          failed++;
          console.warn(
            `[AgentPackDownloadService] Failed to download file: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
          );
        }
        onProgress?.(completed, totalFiles);
      }
    }

    // Step 6: Update cache metadata
    const cacheMetadata = this.loadCacheMetadata();
    cacheMetadata.packs[manifestUrl] = {
      contentHash: manifest.contentHash,
      downloadedAt: new Date().toISOString(),
      version: manifest.version,
      agentCount: succeeded,
    };

    this.writePromise = this.writePromise.then(
      () => this.persistCacheMetadata(cacheMetadata),
      () => this.persistCacheMetadata(cacheMetadata),
    );
    await this.writePromise;

    return {
      success: failed === 0,
      agentsDownloaded: succeeded,
      fromCache: false,
      error: failed === 0 ? undefined : `${failed} file(s) failed to download`,
    };
  }

  /**
   * Validate agent file names for security.
   * Returns an error message if validation fails, undefined if valid.
   */
  private validateAgentFiles(agentFiles: string[]): string | undefined {
    if (agentFiles.length === 0) {
      return 'No agent files specified';
    }

    for (const file of agentFiles) {
      // Reject path traversal attempts
      if (file.includes('..') || path.isAbsolute(file)) {
        return `Invalid file path: "${file}" -- path traversal not allowed`;
      }

      // Only allow .md files
      if (!file.endsWith('.md')) {
        return `Invalid file type: "${file}" -- only .md files are allowed`;
      }

      // Reject control characters and suspicious patterns
      // eslint-disable-next-line no-control-regex
      if (/[\x00-\x1f]/.test(file)) {
        return `Invalid file name: "${file}" -- control characters not allowed`;
      }
    }

    return undefined;
  }

  /**
   * Fetch and parse an agent pack manifest from a URL.
   */
  private async fetchManifest(manifestUrl: string): Promise<AgentPackManifest> {
    const json = await this.fetchJson(manifestUrl);
    const manifest = json as AgentPackManifest;

    // Basic structural validation
    if (
      !manifest.name ||
      !manifest.version ||
      !Array.isArray(manifest.agents) ||
      !manifest.baseUrl
    ) {
      throw new Error(
        `Invalid agent pack manifest: missing required fields (name, version, agents, baseUrl)`,
      );
    }

    return manifest;
  }

  /**
   * Fetch JSON from a URL using Node's built-in https/http module.
   */
  private async fetchJson(url: string): Promise<unknown> {
    const text = await this.downloadText(url);
    return JSON.parse(text);
  }

  /**
   * Download a single file from URL and write it atomically to destPath.
   * Creates parent directories as needed.
   */
  private async downloadFile(url: string, destPath: string): Promise<void> {
    const content = await this.downloadText(url);

    // Ensure parent directory exists
    await this.ensureDir(path.dirname(destPath));

    // Atomic write: write to temp file, then rename
    const tmpPath = destPath + '.tmp';
    await fsPromises.writeFile(tmpPath, content, 'utf-8');
    try {
      await fsPromises.rename(tmpPath, destPath);
    } catch (renameErr) {
      // Clean up orphaned tmp file
      await fsPromises.unlink(tmpPath).catch(() => undefined);
      throw renameErr;
    }
  }

  /**
   * Ensure a directory exists, creating it recursively if needed.
   */
  private async ensureDir(dirPath: string): Promise<void> {
    await fsPromises.mkdir(dirPath, { recursive: true });
  }

  /**
   * Download text content from a URL using Node's built-in https module.
   * Follows redirects (301, 302). Rejects on non-200 status codes.
   * Timeout: 30 seconds per request.
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

        const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB guard
        let data = '';
        let size = 0;
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          size += Buffer.byteLength(chunk, 'utf8');
          if (size > MAX_BODY_SIZE) {
            req.destroy(
              new Error(
                `Response body exceeds ${MAX_BODY_SIZE} bytes for ${url}`,
              ),
            );
            return;
          }
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
   * Build a deduplication key for in-flight promise tracking.
   */
  private buildCacheKey(manifestUrl: string, agentFiles: string[]): string {
    const filesHash = crypto
      .createHash('sha256')
      .update([...agentFiles].sort().join('|'))
      .digest('hex')
      .substring(0, 12);
    return `${manifestUrl}::${filesHash}`;
  }

  /**
   * Get cache entry for a specific manifest URL.
   */
  private getCacheEntry(
    manifestUrl: string,
  ): AgentPackCacheMetadata['packs'][string] | null {
    const metadata = this.loadCacheMetadata();
    return metadata.packs[manifestUrl] ?? null;
  }

  /**
   * Load cache metadata from ~/.ptah/.agent-pack-cache.json.
   * Returns empty metadata if file doesn't exist or is malformed.
   */
  private loadCacheMetadata(): AgentPackCacheMetadata {
    try {
      const raw = fs.readFileSync(this.cacheMetadataPath, 'utf-8');
      const parsed = JSON.parse(raw) as AgentPackCacheMetadata;

      // Validate structure
      if (parsed && typeof parsed.packs === 'object' && parsed.packs !== null) {
        return parsed;
      }

      return { packs: {} };
    } catch {
      // File doesn't exist or is corrupted -- treat as no cache
      return { packs: {} };
    }
  }

  /**
   * Persist cache metadata to ~/.ptah/.agent-pack-cache.json using atomic write.
   * Creates ~/.ptah/ directory if it doesn't exist.
   */
  private async persistCacheMetadata(
    metadata: AgentPackCacheMetadata,
  ): Promise<void> {
    try {
      await fsPromises.mkdir(this.ptahDir, { recursive: true });

      const json = JSON.stringify(metadata, null, 2);
      const tmpPath = this.cacheMetadataPath + '.tmp';

      // Atomic write: write to temp file, then rename
      await fsPromises.writeFile(tmpPath, json, 'utf-8');
      await fsPromises.rename(tmpPath, this.cacheMetadataPath);
    } catch (error: unknown) {
      // Swallow persist errors -- matches ContentDownloadService convention
      console.warn(
        `[AgentPackDownloadService] Failed to persist cache metadata: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
