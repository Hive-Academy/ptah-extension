/**
 * Installs a plugin subtree from an external marketplace into
 * `~/.ptah/plugins/external/<owner>/<repo>/<plugin>/`.
 *
 * ## The two-call consent protocol
 *
 * `install()` without a consent token DOWNLOADS the subtree into memory,
 * inspects it, and returns a plan. Nothing is written. `install()` with the
 * plan's token writes the bytes that were already downloaded.
 *
 * Downloading at plan time rather than at confirm time is the point, not an
 * accident. It removes a time-of-check/time-of-use gap: if the confirm step
 * re-fetched, the user would approve file list A and receive whatever the
 * branch held a few seconds later. Here the token is a hash over the exact
 * bytes, and those exact bytes are what land on disk. A plan that expires or
 * whose upstream moved simply fails to validate, and the caller is handed a
 * fresh plan to approve — which is also, for free, the "re-consent when the
 * version changes" requirement.
 *
 * ## Binary payloads are refused, not guessed
 *
 * Agent skills are markdown, plus scripts (`.ps1`, `.py`, `.cs`) that are also
 * text. A plugin that ships a binary is shipping something the consent dialog
 * cannot describe and a reviewer cannot read. So any file whose bytes are not
 * valid UTF-8 is SKIPPED and named in both the plan and the result. Files are
 * never transcoded and never truncated: everything installed is byte-identical
 * to upstream and human-readable, which is what makes an install auditable.
 * See `decodeUtf8Strict` for the detection, which sniffs bytes rather than
 * trusting file extensions.
 */

import * as crypto from 'crypto';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  isSafePathToken,
  type ExternalInstallPlan,
  type ExternalInstallResult,
  type ExternalPluginMcpServer,
} from '@ptah-extension/shared';
import { GitHubContentClient } from '../github/github-content.client';
import { PluginMarketplaceError } from '../errors';
import {
  MarketplaceRegistryService,
  type ResolvedManifest,
} from '../registry/marketplace-registry.service';
import {
  PluginMetadataSchema,
  PluginVersionFileSchema,
  type MarketplaceManifestPlugin,
} from '../registry/marketplace-manifest.schema';
import {
  buildExternalPluginId,
  externalPluginDir,
  externalRootDir,
  parseExternalPluginId,
  type ExternalPluginCoordinate,
} from './external-plugin-id';
import { ExternalPluginStateStore } from './external-plugin-state.store';

/** Largest single file we will download from a plugin subtree. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Largest total payload for one plugin. */
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

/** Largest number of files in one plugin subtree. */
const MAX_FILE_COUNT = 1_000;

/** Parallel raw.githubusercontent.com downloads, matching ContentDownloadService. */
const MAX_CONCURRENCY = 10;

/** How long a pending plan (and its downloaded bytes) stays valid. */
const PLAN_TTL_MS = 10 * 60 * 1000;

/** How many plans may be pending at once before the oldest is evicted. */
const MAX_PENDING_PLANS = 4;

/** Version reported when a plugin declares none anywhere. */
const UNKNOWN_VERSION = 'unknown';

/** One downloaded file, held between plan and confirm. */
interface StagedFile {
  /** Path relative to the plugin root, forward slashes. */
  relativePath: string;
  /** Verbatim bytes. Written unchanged. */
  bytes: Buffer;
}

/** A plan plus the exact payload it describes. */
interface PendingInstall {
  plan: ExternalInstallPlan;
  coordinate: ExternalPluginCoordinate;
  files: StagedFile[];
  createdAt: number;
}

@injectable()
export class ExternalPluginInstallerService {
  private pluginsBasePath: string | null = null;

  /** Pending plans keyed by consent token. */
  private readonly pending = new Map<string, PendingInstall>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    private readonly github: GitHubContentClient,
    private readonly registry: MarketplaceRegistryService,
    private readonly store: ExternalPluginStateStore,
  ) {}

  /** Bind to `~/.ptah/plugins`. */
  initialize(pluginsBasePath: string): void {
    this.pluginsBasePath = pluginsBasePath;
  }

  /**
   * Build a plan for installing `plugin` from `source`.
   *
   * Downloads the subtree into memory; writes nothing.
   */
  async planInstall(
    source: string,
    plugin: string,
  ): Promise<ExternalInstallPlan> {
    const { resolved, entry } = await this.registry.resolvePlugin(
      source,
      plugin,
    );
    const coordinate: ExternalPluginCoordinate = {
      owner: resolved.owner,
      repo: resolved.repo,
      plugin: entry.name,
    };
    const pluginId = buildExternalPluginId(coordinate);

    const staged = await this.downloadSubtree(resolved, entry);
    const version = this.resolveVersion(entry, staged.files);
    const displayName = this.resolveDisplayName(entry, staged.files);
    const mcpServers = describeMcpServers(entry);
    const existing = this.store.findInstalled(pluginId);

    const consentToken = mintConsentToken(pluginId, version, staged.files);

    const plan: ExternalInstallPlan = {
      pluginId,
      source: resolved.source,
      plugin: entry.name,
      displayName,
      version,
      installedVersion: existing?.version,
      skills: collectSkillNames(staged.files),
      fileCount: staged.files.length,
      totalBytes: staged.files.reduce(
        (sum, file) => sum + file.bytes.length,
        0,
      ),
      scriptFiles: staged.files
        .map((file) => file.relativePath)
        .filter(isScriptPath)
        .sort(),
      skippedBinaryFiles: staged.skippedBinaryFiles,
      mcpServers,
      // Filled in by the RPC layer, which is the only place that knows which
      // skills are currently junctioned. Collisions are local state, so they
      // are deliberately NOT part of the consent token.
      collisions: [],
      consentToken,
    };

    this.rememberPlan({
      plan,
      coordinate,
      files: staged.files,
      createdAt: Date.now(),
    });

    return plan;
  }

  /**
   * Perform an install previously described by a plan.
   *
   * @throws PluginMarketplaceError `consent-required` when the token is
   *   unknown or expired — the caller must obtain and show a fresh plan.
   */
  async confirmInstall(consentToken: string): Promise<ExternalInstallResult> {
    const pluginsBasePath = this.requireInitialized();
    const pendingInstall = this.takePlan(consentToken);

    if (!pendingInstall) {
      throw new PluginMarketplaceError(
        'consent-required',
        'This installation was not approved, or the approval expired. Review the plugin details again before installing.',
      );
    }

    const { plan, coordinate, files } = pendingInstall;
    const targetDir = externalPluginDir(pluginsBasePath, coordinate);
    const externalRoot = externalRootDir(pluginsBasePath);

    // The directory is built from remote-derived tokens, so prove it landed
    // where we think before anything destructive or creative happens here.
    assertContainedIn(targetDir, externalRoot, coordinate.plugin);

    // A re-install must not leave files from the previous version behind: the
    // plan the user approved describes a complete tree, not a diff.
    await fsPromises.rm(targetDir, { recursive: true, force: true });

    for (const file of files) {
      const destination = path.resolve(
        targetDir,
        ...file.relativePath.split('/'),
      );
      assertContainedIn(destination, targetDir, file.relativePath);
      await writeFileAtomic(destination, file.bytes);
    }

    await this.store.recordInstall({
      pluginId: plan.pluginId,
      source: plan.source,
      plugin: plan.plugin,
      displayName: plan.displayName,
      version: plan.version,
      installedAt: new Date().toISOString(),
      consentToken,
      files: files.map((file) => file.relativePath),
      skippedBinaryFiles: plan.skippedBinaryFiles,
      mcpServers: plan.mcpServers,
    });

    this.registry.invalidate(plan.source);

    this.logger.debug('[ExternalPluginInstallerService] Plugin installed', {
      pluginId: plan.pluginId,
      version: plan.version,
      filesWritten: files.length,
      skippedBinaryFiles: plan.skippedBinaryFiles.length,
      declaredMcpServers: plan.mcpServers.length,
    });

    return {
      pluginId: plan.pluginId,
      displayName: plan.displayName,
      installedVersion: plan.version,
      filesWritten: files.length,
      skippedBinaryFiles: plan.skippedBinaryFiles,
      // Filled in by the RPC layer, same reason as on the plan.
      collisions: [],
    };
  }

  /**
   * Remove an installed plugin: its directory AND its consent record.
   *
   * The record goes last, so a failure mid-way leaves the id still recorded
   * (and therefore still resolvable) rather than orphaning a directory that
   * nothing can clean up.
   */
  async uninstall(pluginId: string): Promise<boolean> {
    const pluginsBasePath = this.requireInitialized();
    const coordinate = parseExternalPluginId(pluginId);
    if (!coordinate) return false;
    if (!this.store.isInstalled(pluginId)) return false;

    const targetDir = externalPluginDir(pluginsBasePath, coordinate);
    assertContainedIn(
      targetDir,
      externalRootDir(pluginsBasePath),
      coordinate.plugin,
    );

    await fsPromises.rm(targetDir, { recursive: true, force: true });
    await this.store.removeInstall(pluginId);

    this.logger.debug('[ExternalPluginInstallerService] Plugin uninstalled', {
      pluginId,
    });

    return true;
  }

  /**
   * Enumerate and download the plugin subtree.
   *
   * ONE `api.github.com` call (the recursive trees endpoint) plus N cheap
   * `raw.githubusercontent.com` calls. Doing it the other way round — walking
   * directories through the contents API — would exhaust the unauthenticated
   * 60/hour budget inside a single install.
   */
  private async downloadSubtree(
    resolved: ResolvedManifest,
    entry: MarketplaceManifestPlugin,
  ): Promise<{ files: StagedFile[]; skippedBinaryFiles: string[] }> {
    const tree = await this.github.fetchRepoTree(resolved.owner, resolved.repo);
    const prefix = `${entry.source}/`;

    const blobs = tree.filter(
      (node) => node.type === 'blob' && node.path.startsWith(prefix),
    );

    if (blobs.length === 0) {
      throw new PluginMarketplaceError(
        'plugin-not-found',
        `${resolved.source} advertises "${entry.name}" at "${entry.source}", but that directory has no files.`,
      );
    }

    if (blobs.length > MAX_FILE_COUNT) {
      throw new PluginMarketplaceError(
        'too-large',
        `"${entry.name}" contains ${blobs.length} files, more than the ${MAX_FILE_COUNT} Ptah will install.`,
      );
    }

    const declaredBytes = blobs.reduce(
      (sum, node) => sum + (node.size ?? 0),
      0,
    );
    if (declaredBytes > MAX_TOTAL_BYTES) {
      throw new PluginMarketplaceError(
        'too-large',
        `"${entry.name}" is ${Math.round(declaredBytes / 1024)} KB, more than the ${MAX_TOTAL_BYTES / 1024 / 1024} MB Ptah will install.`,
      );
    }

    const files: StagedFile[] = [];
    const skippedBinaryFiles: string[] = [];
    let totalBytes = 0;

    for (let i = 0; i < blobs.length; i += MAX_CONCURRENCY) {
      const chunk = blobs.slice(i, i + MAX_CONCURRENCY);
      const downloaded = await Promise.all(
        chunk.map(async (node) => {
          const relativePath = node.path.slice(prefix.length);
          // Reject a traversing path BEFORE spending a download on it. The
          // trees API is remote data like any other, and a plan the user could
          // approve must not contain a file that would then fail to write —
          // the confirm-time guard is a backstop, not the first line.
          assertSafeRelativePath(relativePath);
          if ((node.size ?? 0) > MAX_FILE_BYTES) {
            throw new PluginMarketplaceError(
              'too-large',
              `"${relativePath}" is larger than the ${MAX_FILE_BYTES / 1024 / 1024} MB per-file limit.`,
            );
          }
          const blob = await this.github.fetchRepoFile(
            resolved.owner,
            resolved.repo,
            node.path,
          );
          return { relativePath, blob };
        }),
      );

      for (const { relativePath, blob } of downloaded) {
        if (blob.text === null) {
          skippedBinaryFiles.push(relativePath);
          continue;
        }
        totalBytes += blob.bytes.length;
        if (totalBytes > MAX_TOTAL_BYTES) {
          throw new PluginMarketplaceError(
            'too-large',
            `"${entry.name}" exceeds the ${MAX_TOTAL_BYTES / 1024 / 1024} MB install limit.`,
          );
        }
        files.push({ relativePath, bytes: blob.bytes });
      }
    }

    if (files.length === 0) {
      throw new PluginMarketplaceError(
        'plugin-not-found',
        `"${entry.name}" contains no text files Ptah can install (${skippedBinaryFiles.length} binary file(s) were refused).`,
      );
    }

    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    skippedBinaryFiles.sort();

    return { files, skippedBinaryFiles };
  }

  /**
   * Version from, in order: `version.json`, `.claude-plugin/plugin.json`,
   * `plugin.json`, the marketplace entry, then `'unknown'`.
   *
   * The order follows dotnet/skills, which keeps the authoritative number in
   * `version.json` and lets the manifest lag.
   */
  private resolveVersion(
    entry: MarketplaceManifestPlugin,
    files: StagedFile[],
  ): string {
    const versionFile = readJsonFile(
      files,
      'version.json',
      PluginVersionFileSchema,
    );
    if (versionFile?.version) return versionFile.version;

    const metadata = this.readPluginMetadata(files);
    if (metadata?.version) return metadata.version;

    return entry.version ?? UNKNOWN_VERSION;
  }

  /** Display name from `plugin.json`, falling back to the manifest name. */
  private resolveDisplayName(
    entry: MarketplaceManifestPlugin,
    files: StagedFile[],
  ): string {
    return this.readPluginMetadata(files)?.name ?? entry.name;
  }

  private readPluginMetadata(
    files: StagedFile[],
  ): { name?: string; version?: string } | null {
    return (
      readJsonFile(files, '.claude-plugin/plugin.json', PluginMetadataSchema) ??
      readJsonFile(files, 'plugin.json', PluginMetadataSchema)
    );
  }

  /** Store a plan, evicting expired and surplus entries. */
  private rememberPlan(pendingInstall: PendingInstall): void {
    const now = Date.now();
    for (const [token, existing] of this.pending) {
      if (now - existing.createdAt > PLAN_TTL_MS) this.pending.delete(token);
    }

    this.pending.set(pendingInstall.plan.consentToken, pendingInstall);

    while (this.pending.size > MAX_PENDING_PLANS) {
      const oldest = this.pending.keys().next();
      if (oldest.done) break;
      this.pending.delete(oldest.value);
    }
  }

  /** Consume a plan by token, or null when unknown/expired. */
  private takePlan(consentToken: string): PendingInstall | null {
    const pendingInstall = this.pending.get(consentToken);
    if (!pendingInstall) return null;

    this.pending.delete(consentToken);

    if (Date.now() - pendingInstall.createdAt > PLAN_TTL_MS) return null;

    return pendingInstall;
  }

  private requireInitialized(): string {
    if (!this.pluginsBasePath) {
      throw new PluginMarketplaceError(
        'network',
        'Plugin storage is not ready yet. Try again once Ptah has finished starting up.',
      );
    }
    return this.pluginsBasePath;
  }
}

/**
 * Consent token = SHA-256 over the plugin id, the resolved version, and the
 * path + content digest of every staged file.
 *
 * Binding content — not just the file list — is what makes the token a
 * statement about exactly what the user saw. Binding the version is what makes
 * consent automatically expire when the upstream version changes, because the
 * token for v1 can never validate a v2 payload.
 */
function mintConsentToken(
  pluginId: string,
  version: string,
  files: StagedFile[],
): string {
  const hash = crypto.createHash('sha256');
  hash.update(pluginId);
  hash.update(' ');
  hash.update(version);
  for (const file of files) {
    hash.update(' ');
    hash.update(file.relativePath);
    hash.update(' ');
    hash.update(crypto.createHash('sha256').update(file.bytes).digest('hex'));
  }
  return hash.digest('hex');
}

/**
 * Throw unless `candidate` resolves strictly inside `root`.
 *
 * Mirrors the guard in `ContentDownloadService.downloadFilesBatch`. Applied to
 * every destination even though the schema layer already rejected traversing
 * manifest paths: schema validation reasons about strings, this reasons about
 * where they actually land after `path.resolve` — which is the only question
 * that matters on a case-insensitive filesystem with symlinks in it.
 */
function assertContainedIn(
  candidate: string,
  root: string,
  label: string,
): void {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const contained =
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(resolvedRoot + path.sep);

  if (!contained) {
    throw new PluginMarketplaceError(
      'path-traversal',
      `Refusing to write "${label}": it resolves outside the plugin directory.`,
    );
  }
}

/**
 * Throw unless every segment of `relativePath` is a safe single path token.
 *
 * Rejects `..`, `.`, absolute paths, drive letters and backslash separators —
 * everything that would let a repo-relative path from the trees API resolve
 * somewhere other than under the plugin directory.
 */
function assertSafeRelativePath(relativePath: string): void {
  const segments = relativePath.split('/');
  const safe =
    relativePath.length > 0 &&
    !relativePath.includes('\\') &&
    !/^[a-zA-Z]:/.test(relativePath) &&
    segments.every(isSafePathToken);

  if (!safe) {
    throw new PluginMarketplaceError(
      'path-traversal',
      `Refusing "${relativePath}": the marketplace listed a file outside the plugin directory.`,
    );
  }
}

/** Atomic write: temp file then rename, creating parents as needed. */
async function writeFileAtomic(
  destination: string,
  bytes: Buffer,
): Promise<void> {
  await fsPromises.mkdir(path.dirname(destination), { recursive: true });
  const tmpPath = `${destination}.tmp`;
  await fsPromises.writeFile(tmpPath, bytes);
  await fsPromises.rename(tmpPath, destination);
}

/** Skill directory names, from `skills/<name>/SKILL.md` entries. */
function collectSkillNames(files: StagedFile[]): string[] {
  const names = new Set<string>();
  for (const file of files) {
    const segments = file.relativePath.split('/');
    if (
      segments.length === 3 &&
      segments[0] === 'skills' &&
      segments[2].toUpperCase() === 'SKILL.MD'
    ) {
      names.add(segments[1]);
    }
  }
  return [...names].sort();
}

/** True when any path segment is a `scripts` directory. */
function isScriptPath(relativePath: string): boolean {
  const segments = relativePath.split('/');
  return segments.slice(0, -1).includes('scripts');
}

/**
 * Render a manifest's `mcpServers` for the consent dialog.
 *
 * `commandLine` is assembled here so exactly one place decides what "the
 * command verbatim" means, and the UI cannot accidentally show an abbreviated
 * form of something the user is being asked to trust.
 */
function describeMcpServers(
  entry: MarketplaceManifestPlugin,
): ExternalPluginMcpServer[] {
  if (!entry.mcpServers) return [];

  return Object.entries(entry.mcpServers).map(([name, server]) => {
    const args = server.args ?? [];
    return {
      name,
      command: server.command,
      args,
      env: server.env,
      commandLine: [server.command, ...args].join(' '),
    };
  });
}

/** Parse a staged JSON file through `schema`, or null on any failure. */
function readJsonFile<T>(
  files: StagedFile[],
  relativePath: string,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
): T | null {
  const file = files.find(
    (candidate) => candidate.relativePath === relativePath,
  );
  if (!file) return null;

  let json: unknown;
  try {
    json = JSON.parse(file.bytes.toString('utf8'));
  } catch {
    return null;
  }

  const result = schema.safeParse(json);
  return result.success && result.data !== undefined ? result.data : null;
}

/** Exposed for direct unit coverage of the guards. */
export {
  assertContainedIn,
  assertSafeRelativePath,
  collectSkillNames,
  describeMcpServers,
};
