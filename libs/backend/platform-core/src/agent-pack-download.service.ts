/**
 * AgentPackDownloadService
 *
 * Fetches pre-built agent packs from curated GitHub repositories and installs
 * their agent files under per-file keep/replace guards.
 * Platform-agnostic: NO vscode imports. Usable from VS Code, Electron and CLI.
 *
 * Two steps (TASK_2026_701 B8):
 * - {@link AgentPackDownloadService.planDownload} fetches the requested files
 *   into memory and compares each with the file on disk. It writes nothing.
 * - {@link AgentPackDownloadService.installFiles} writes caller-supplied
 *   content under a guard per file, re-reading every destination right before
 *   the write, so a decision made on an earlier plan never overwrites content
 *   the user did not see.
 *
 * Concurrency (A22): network fetches are deduplicated by URL only. Writes are
 * never shared between callers: installs into one canonical target directory
 * run one after another, each with its own guards and outcomes.
 *
 * The guard rules mirror the agent-generation writer (B2). They are restated
 * here because platform-core cannot depend on agent-generation:
 * - unreadable destination → `kept`;
 * - destination already holds the incoming bytes → `unchanged`;
 * - `create-only`: write only when nothing is there, else `kept`;
 * - `keep`: never write (`kept`);
 * - `replace`: write when the destination still hashes to the baseline the
 *   user saw (or was deleted since), else `changed-since-preview`.
 */

import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import type { FileOutcome, PackFileState } from '@ptah-extension/shared';

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

/**
 * One requested pack file after planning: either fetched and compared with
 * the destination, or not fetched (that file failed; the others proceed).
 */
export type AgentPackFilePlan =
  | {
      file: string;
      fetched: true;
      state: PackFileState;
      /** Incoming pack text. */
      content: string;
      /** Hash of the destination text; present for `identical` and `differs`. */
      baselineHash?: string;
      /** Destination text; present for `differs` only. */
      localText?: string;
    }
  | { file: string; fetched: false; error: string };

/**
 * Result of {@link AgentPackDownloadService.planDownload}. `ok: false` means
 * the request as a whole could not be planned (invalid file names, manifest
 * unavailable, files missing from the manifest).
 */
export type AgentPackPlanResult =
  | { ok: true; files: AgentPackFilePlan[] }
  | { ok: false; error: string };

/** The write permission one install item carries. */
export type PackFileGuard =
  | { mode: 'create-only' }
  | { mode: 'keep' }
  | { mode: 'replace'; baselineHash: string };

/** One file to install with its incoming content and guard. */
export interface AgentPackInstallItem {
  file: string;
  content: string;
  guard: PackFileGuard;
}

/** Terminal outcome of one install item. `error` is set for `failed` only. */
export interface AgentPackInstallOutcome {
  file: string;
  outcome: FileOutcome;
  error?: string;
}

/** What is at a destination right now. */
type LocalFile =
  | { state: 'absent' }
  | { state: 'present'; text: string }
  | { state: 'unreadable'; code: string | undefined };

/** Hash used for pack baselines: SHA-256 of the UTF-8 text. */
export function hashPackContent(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * The `code` of a Node system error. Structural, not `instanceof Error`: an
 * fs error can come from another realm.
 */
function errnoCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Key that names one directory however it was spelled: resolved, and
 * case-folded on win32 where `C:\A` and `c:\a` are the same folder.
 */
function canonicalDirKey(dir: string): string {
  const resolved = path.resolve(dir);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** True when `candidate` is `root` or lies under it. */
function isInsideRoot(candidate: string, root: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export class AgentPackDownloadService {
  /** In-flight network fetches keyed by URL. Never holds a write. */
  private readonly inFlightFetches = new Map<string, Promise<string>>();

  /** Tail of the install chain per canonical target directory. */
  private readonly targetChains = new Map<string, Promise<void>>();

  /** Maximum parallel file downloads */
  private static readonly MAX_CONCURRENCY = 10;

  /** Default curated pack manifest URLs */
  private static readonly CURATED_PACKS: string[] = [
    'https://raw.githubusercontent.com/Hive-Academy/ptah-extension/main/agent-pack-manifest.json',
  ];

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
      const message = errorMessage(error);
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

  /**
   * Fetch the requested pack files into memory and compare each with its
   * destination under `targetDir`. Writes nothing.
   *
   * `agentFiles` may name one file (per-file install or retry) or the whole
   * pack; duplicates are planned once. A file whose download fails is
   * returned as `fetched: false` and the others proceed. Never throws.
   */
  async planDownload(
    manifestUrl: string,
    agentFiles: readonly string[],
    targetDir: string,
  ): Promise<AgentPackPlanResult> {
    const files = [...new Set(agentFiles)];
    const validationError = this.validateAgentFiles(files);
    if (validationError) {
      return { ok: false, error: validationError };
    }

    let manifest: AgentPackManifest;
    try {
      manifest = await this.fetchManifest(manifestUrl);
    } catch (error: unknown) {
      return {
        ok: false,
        error: `Manifest fetch failed: ${errorMessage(error)}`,
      };
    }

    const manifestFileSet = new Set(manifest.agents.map((a) => a.file));
    const missingFiles = files.filter((f) => !manifestFileSet.has(f));
    if (missingFiles.length > 0) {
      return {
        ok: false,
        error: `Files not found in manifest: ${missingFiles.join(', ')}`,
      };
    }

    const planned: AgentPackFilePlan[] = [];
    for (
      let i = 0;
      i < files.length;
      i += AgentPackDownloadService.MAX_CONCURRENCY
    ) {
      const chunk = files.slice(i, i + AgentPackDownloadService.MAX_CONCURRENCY);
      const results = await Promise.all(
        chunk.map((file) => this.planFile(manifest.baseUrl, file, targetDir)),
      );
      planned.push(...results);
    }
    return { ok: true, files: planned };
  }

  /**
   * Write each item under its guard into `targetDir`, in order. Calls for the
   * same canonical directory are serialized; each evaluates its own guards
   * against the destination as it is when its turn comes. Never throws: a
   * write error is that item's `failed` outcome.
   */
  installFiles(
    targetDir: string,
    items: readonly AgentPackInstallItem[],
  ): Promise<AgentPackInstallOutcome[]> {
    const key = canonicalDirKey(targetDir);
    const previous = this.targetChains.get(key) ?? Promise.resolve();
    const run = previous.then(() => this.installSequentially(targetDir, items));
    // `installSequentially` settles every item into an outcome, so `run`
    // resolves; the tail only orders the next caller after this one.
    const tail = run.then(() => undefined);
    this.targetChains.set(key, tail);
    void tail.then(() => {
      if (this.targetChains.get(key) === tail) {
        this.targetChains.delete(key);
      }
    });
    return run;
  }

  private async installSequentially(
    targetDir: string,
    items: readonly AgentPackInstallItem[],
  ): Promise<AgentPackInstallOutcome[]> {
    const outcomes: AgentPackInstallOutcome[] = [];
    for (const item of items) {
      outcomes.push(await this.installOne(targetDir, item));
    }
    return outcomes;
  }

  private async installOne(
    targetDir: string,
    item: AgentPackInstallItem,
  ): Promise<AgentPackInstallOutcome> {
    const { file } = item;
    const nameError = this.validateAgentFiles([file]);
    if (nameError) {
      return { file, outcome: 'failed', error: nameError };
    }
    const destPath = this.destinationFor(targetDir, file);
    if (destPath === null) {
      return {
        file,
        outcome: 'failed',
        error: `Path traversal detected: "${file}" resolves outside target directory`,
      };
    }

    const local = await this.readLocal(destPath);
    if (local.state === 'unreadable') {
      return { file, outcome: 'kept' };
    }
    if (local.state === 'present' && local.text === item.content) {
      return { file, outcome: 'unchanged' };
    }
    const blocked = this.blockedByGuard(item.guard, local);
    if (blocked !== null) {
      return { file, outcome: blocked };
    }

    try {
      await this.writeAtomically(destPath, item.content);
      return { file, outcome: 'written' };
    } catch (error: unknown) {
      return { file, outcome: 'failed', error: errorMessage(error) };
    }
  }

  /**
   * The outcome that leaves the file alone, or `null` when the guard allows
   * the write. Called only after unreadable and equal bytes were ruled out.
   */
  private blockedByGuard(
    guard: PackFileGuard,
    local: Exclude<LocalFile, { state: 'unreadable' }>,
  ): FileOutcome | null {
    switch (guard.mode) {
      case 'keep':
        return 'kept';
      case 'create-only':
        return local.state === 'absent' ? null : 'kept';
      case 'replace':
        // A file deleted since the plan holds nothing to lose.
        if (local.state === 'absent') return null;
        return hashPackContent(local.text) === guard.baselineHash
          ? null
          : 'changed-since-preview';
    }
  }

  private async planFile(
    baseUrl: string,
    file: string,
    targetDir: string,
  ): Promise<AgentPackFilePlan> {
    const destPath = this.destinationFor(targetDir, file);
    if (destPath === null) {
      return {
        file,
        fetched: false,
        error: `Path traversal detected: "${file}" resolves outside target directory`,
      };
    }
    let content: string;
    try {
      content = await this.fetchText(`${baseUrl}/${file}`);
    } catch (error: unknown) {
      return { file, fetched: false, error: errorMessage(error) };
    }

    const local = await this.readLocal(destPath);
    switch (local.state) {
      case 'absent':
        return { file, fetched: true, state: 'new', content };
      case 'unreadable':
        return { file, fetched: true, state: 'unreadable', content };
      case 'present': {
        const baselineHash = hashPackContent(local.text);
        return local.text === content
          ? { file, fetched: true, state: 'identical', content, baselineHash }
          : {
              file,
              fetched: true,
              state: 'differs',
              content,
              baselineHash,
              localText: local.text,
            };
      }
    }
  }

  /** Absolute destination of `file` inside `targetDir`, or `null` if outside. */
  private destinationFor(targetDir: string, file: string): string | null {
    const root = path.resolve(targetDir);
    const destPath = path.resolve(root, path.basename(file));
    return destPath !== root && isInsideRoot(destPath, root) ? destPath : null;
  }

  /**
   * Read the destination as it is now. Only ENOENT means "absent"; every
   * other read error is `unreadable`, because replacing a file nobody could
   * read would destroy content nobody has seen.
   */
  private async readLocal(destPath: string): Promise<LocalFile> {
    try {
      const text = await fsPromises.readFile(destPath, 'utf-8');
      return { state: 'present', text };
    } catch (error: unknown) {
      const code = errnoCode(error);
      if (code === 'ENOENT') return { state: 'absent' };
      return { state: 'unreadable', code };
    }
  }

  /**
   * Write through a uniquely named temp sibling and rename it over the
   * destination, so a reader never sees a half-written agent file.
   */
  private async writeAtomically(
    destPath: string,
    content: string,
  ): Promise<void> {
    await fsPromises.mkdir(path.dirname(destPath), { recursive: true });
    const tmpPath = `${destPath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    await fsPromises.writeFile(tmpPath, content, 'utf-8');
    try {
      await fsPromises.rename(tmpPath, destPath);
    } catch (renameError: unknown) {
      await fsPromises.rm(tmpPath, { force: true });
      throw renameError;
    }
  }

  /**
   * Validate agent file names for security.
   * Returns an error message if validation fails, undefined if valid.
   */
  private validateAgentFiles(agentFiles: readonly string[]): string | undefined {
    if (agentFiles.length === 0) {
      return 'No agent files specified';
    }

    for (const file of agentFiles) {
      if (file.includes('..') || path.isAbsolute(file)) {
        return `Invalid file path: "${file}" -- path traversal not allowed`;
      }
      if (!file.endsWith('.md')) {
        return `Invalid file type: "${file}" -- only .md files are allowed`;
      }
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
    const json: unknown = JSON.parse(await this.fetchText(manifestUrl));
    const manifest = json as AgentPackManifest;
    if (
      !manifest ||
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
   * Fetch text from `url`, sharing one request between concurrent callers of
   * the same URL. Only reads are shared; every caller decides its own writes.
   */
  private fetchText(url: string): Promise<string> {
    const existing = this.inFlightFetches.get(url);
    if (existing) return existing;
    const request = this.downloadText(url).finally(() => {
      this.inFlightFetches.delete(url);
    });
    this.inFlightFetches.set(url, request);
    return request;
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
        if (
          (res.statusCode === 301 || res.statusCode === 302) &&
          res.headers.location
        ) {
          const redirectUrl = new URL(res.headers.location, url).toString();
          this.downloadText(redirectUrl, maxRedirects - 1).then(
            resolve,
            reject,
          );
          res.resume();
          return;
        }

        if (res.statusCode !== 200) {
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
      req.setTimeout(30_000, () => {
        req.destroy(new Error(`Request timeout for ${url}`));
      });
    });
  }
}
