/**
 * AnalysisStorageService - The single owner of `.ptah/analysis` I/O.
 *
 * Owns every durable artifact under `<workspace>/.ptah/analysis/`:
 * - `<slug>/manifest.json` — the version-3 or version-4 analysis checkpoint
 * - `<slug>/NN-phase.md` — phase output files
 * - `<slug>/generation-manifest.json` — the generation checkpoint
 *   (`<root>/generation-manifest.json` when a run has no analysis slug)
 * - `enhanced-prompt.md` + `enhanced-prompt.json` — the enhanced-prompt trace
 *
 * Every manifest read is validated with Zod. A version-2 or malformed manifest
 * is reported as unavailable and is NEVER deleted. All file I/O goes through
 * `IFileSystemProvider`; parent directories are created explicitly before the
 * first write because the VS Code adapter's `writeFile()` does not create them.
 */

import { inject, injectable } from 'tsyringe';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path';
import { ulid } from 'ulid';
import {
  PLATFORM_TOKENS,
  FileType,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  SavedAnalysisMetadata,
  MultiPhaseAnalysisResponse,
} from '@ptah-extension/shared';
import {
  MultiPhaseManifestV3Schema,
  MultiPhaseManifestV4Schema,
  type MultiPhaseManifest,
  type MultiPhaseManifestV3,
  type MultiPhaseManifestV4,
} from '../types/multi-phase.types';
import {
  GenerationCheckpointManifestSchema,
  type GenerationCheckpointManifest,
} from '../types/generation-checkpoint.types';
import type { EnhancedPromptTraceMetadata } from '../types/enhanced-prompts.types';

const SERVICE_TAG = '[AnalysisStorage]';
const MANIFEST_FILE = 'manifest.json';
const GENERATION_MANIFEST_FILE = 'generation-manifest.json';
const ENHANCED_PROMPT_MARKDOWN_FILE = 'enhanced-prompt.md';
const ENHANCED_PROMPT_METADATA_FILE = 'enhanced-prompt.json';
export const LEGACY_FALLBACK_SUFFIX = '--v4';
export const LEGACY_ARCHIVE_MARKER = '-v3-archive-';
export type RunDirVariant = 'primary' | 'legacy-fallback';

export function isLegacyArchiveDirName(name: string): boolean {
  return name.includes(LEGACY_ARCHIVE_MARKER);
}

/** The latest run that still has work a resume can pick up. */
export interface ResumableRun {
  /** Slug directory of the analysis run, or null for a slug-less generation. */
  slugDir: string | null;
  /** Validated version-3 or version-4 analysis manifest, or null when only a generation exists. */
  manifest: MultiPhaseManifest | null;
  /** Validated generation checkpoint stored beside the analysis, if any. */
  generation: GenerationCheckpointManifest | null;
}

export type ManifestReadResult =
  | { kind: 'current'; manifest: MultiPhaseManifestV4 }
  | { kind: 'legacy-v3'; manifest: MultiPhaseManifestV3 };

/** Archiving failed before a verified v3 copy could replace the source. */
export class LegacyRunArchiveError extends Error {
  constructor(
    message: string,
    cause?: unknown,
    readonly archiveDir: string | null = null,
  ) {
    super(message, { cause });
    this.name = 'LegacyRunArchiveError';
  }
}

@injectable()
export class AnalysisStorageService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
  ) {}

  // ---------------------------------------------------------------------------
  // Paths
  // ---------------------------------------------------------------------------

  /**
   * Get the .ptah/analysis/ directory path for a workspace.
   */
  getAnalysisDir(workspacePath: string): string {
    return join(workspacePath, '.ptah', 'analysis');
  }

  /**
   * Generate a slug from a project type string.
   * e.g., "Angular Nx Monorepo" -> "angular-nx-monorepo"
   */
  slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 40);
  }

  /**
   * Get the absolute path for a slug subdirectory within .ptah/analysis/.
   */
  getSlugDir(workspacePath: string, slug: string): string {
    return join(this.getAnalysisDir(workspacePath), slug);
  }

  /** Resolve a run directory without I/O. Slugify never emits `--`, so the
   * fallback suffix cannot collide with a real project slug. */
  getRunDir(
    workspacePath: string,
    projectDescription: string,
    variant: RunDirVariant = 'primary',
  ): { slugDir: string; slug: string } {
    const baseSlug = this.slugify(projectDescription);
    const slug =
      variant === 'legacy-fallback'
        ? `${baseSlug}${LEGACY_FALLBACK_SUFFIX}`
        : baseSlug;
    return { slugDir: this.getSlugDir(workspacePath, slug), slug };
  }

  /**
   * Canonicalize a caller-supplied analysis directory and confirm it stays
   * under `<workspace>/.ptah/analysis`.
   *
   * Accepts an absolute path or a path relative to the workspace. Returns the
   * canonical absolute path, or null when the candidate escapes the analysis
   * root through `..` segments or an absolute path elsewhere.
   */
  resolveAuthorizedAnalysisDir(
    workspacePath: string,
    candidate: string,
  ): string | null {
    const root = resolve(this.getAnalysisDir(workspacePath));
    const canonical = isAbsolute(candidate)
      ? resolve(candidate)
      : resolve(workspacePath, candidate);
    const rel = relative(root, canonical);
    if (rel === '') return canonical;
    if (rel.startsWith('..') || isAbsolute(rel)) return null;
    return canonical;
  }

  /**
   * Path of the generation checkpoint for a run. It sits beside the analysis
   * manifest when the run has a slug, and in the analysis root otherwise.
   */
  getGenerationManifestPath(
    workspacePath: string,
    analysisDir: string | null,
  ): string {
    return join(
      analysisDir ?? this.getAnalysisDir(workspacePath),
      GENERATION_MANIFEST_FILE,
    );
  }

  // ---------------------------------------------------------------------------
  // Slug directories
  // ---------------------------------------------------------------------------

  /**
   * Create a slug directory for a FRESH multi-phase analysis. Any previous
   * content under the slug is removed first.
   */
  async createSlugDir(
    workspacePath: string,
    projectDescription: string,
    variant: RunDirVariant = 'primary',
  ): Promise<{ slugDir: string; slug: string }> {
    const { slug, slugDir } = this.getRunDir(
      workspacePath,
      projectDescription,
      variant,
    );

    if (await this.fs.exists(slugDir)) {
      await this.fs.delete(slugDir, { recursive: true });
    }
    await this.fs.createDirectory(slugDir);

    this.logger.info(`${SERVICE_TAG} Created slug directory`, {
      slug,
      slugDir,
    });

    return { slugDir, slug };
  }

  /**
   * Make sure a slug directory exists WITHOUT touching its content. This is
   * the resume path: checkpoints and partial phase files stay in place.
   */
  async ensureSlugDir(
    workspacePath: string,
    projectDescription: string,
  ): Promise<{ slugDir: string; slug: string }> {
    const slug = this.slugify(projectDescription);
    const slugDir = this.getSlugDir(workspacePath, slug);
    await this.fs.createDirectory(slugDir);
    return { slugDir, slug };
  }

  // ---------------------------------------------------------------------------
  // Phase files
  // ---------------------------------------------------------------------------

  /**
   * Write a phase output file to a slug directory.
   */
  async writePhaseFile(
    slugDir: string,
    filename: string,
    content: string,
  ): Promise<void> {
    await this.fs.createDirectory(slugDir);
    await this.fs.writeFile(join(slugDir, filename), content);
  }

  /**
   * Whether a phase output file exists in a slug directory.
   */
  async phaseFileExists(slugDir: string, filename: string): Promise<boolean> {
    return this.fs.exists(join(slugDir, filename));
  }

  /**
   * Read a phase output file from a slug directory.
   * Returns null if the file doesn't exist or can't be read.
   */
  async readPhaseFile(
    slugDir: string,
    filename: string,
  ): Promise<string | null> {
    try {
      return await this.fs.readFile(join(slugDir, filename));
    } catch {
      // degradation-audit: optional-capability - the doc comment above says a
      // missing or unreadable phase file returns null; callers (loadMultiPhase)
      // skip that phase's content instead of failing the whole analysis load.
      return null;
    }
  }

  /**
   * Read a phase output file's modification time.
   * Returns null if the file doesn't exist or stats aren't available.
   *
   * The mtime is an OPTIONAL signal by design: `recordPhaseOutcome` uses it to
   * tell "the agent rewrote the file with identical bytes" apart from "the
   * agent wrote nothing", and falls back to comparing content when it is
   * absent. A provider that cannot stat therefore behaves exactly as it did
   * before the mtime signal existed, which is why null is an answer here and
   * not a failure.
   */
  async readPhaseFileMtime(
    slugDir: string,
    filename: string,
  ): Promise<number | null> {
    try {
      return (await this.fs.stat(join(slugDir, filename))).mtime;
    } catch {
      // degradation-audit: optional-capability - a missing file or a provider
      // with no usable stat returns null, and the caller falls back to the
      // content comparison. Nothing downstream is skipped or degraded.
      return null;
    }
  }

  /**
   * Remove a readable stale phase file before a resumed phase runs.
   * Returns false when the provider cannot remove it so callers can retain
   * their observational freshness fallback.
   */
  async tryRemovePhaseFile(
    slugDir: string,
    filename: string,
  ): Promise<boolean> {
    try {
      await this.fs.delete(join(slugDir, filename));
      return true;
    } catch {
      // degradation-audit: optional-capability - some providers may reject a
      // phase-file delete; the caller then retains content/mtime freshness.
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Analysis manifest (version 3)
  // ---------------------------------------------------------------------------

  /**
   * Persist the analysis manifest. This is the checkpoint write: it runs once
   * per lifecycle transition, never per stream delta.
   */
  async writeManifest(
    slugDir: string,
    manifest: MultiPhaseManifest,
  ): Promise<void> {
    await this.fs.createDirectory(slugDir);
    await this.fs.writeFile(
      join(slugDir, MANIFEST_FILE),
      JSON.stringify(manifest, null, 2),
    );
  }

  /**
   * Load and validate a manifest of a slug directory.
   *
   * Returns null when the file is missing, is not valid JSON, or does not
   * satisfy its versioned schema (a version-2 manifest included). The
   * file is left untouched in every one of those cases.
   */
  async loadManifest(slugDir: string): Promise<MultiPhaseManifest | null> {
    return (await this.readManifest(slugDir))?.manifest ?? null;
  }

  /** Read a current v4 or legacy-v3 manifest. Missing, malformed, v2, and
   * unknown versions return null; this method never rewrites the file. */
  async readManifest(slugDir: string): Promise<ManifestReadResult | null> {
    const parsed = await this.readJson(join(slugDir, MANIFEST_FILE));
    if (parsed === undefined) return null;
    const version =
      typeof parsed === 'object' && parsed !== null && 'version' in parsed
        ? parsed.version
        : undefined;
    const result =
      version === 3
        ? MultiPhaseManifestV3Schema.safeParse(parsed)
        : version === 4
          ? MultiPhaseManifestV4Schema.safeParse(parsed)
          : null;
    if (result === null) return null;
    if (!result.success) {
      this.logger.debug(`${SERVICE_TAG} Manifest rejected by schema`, {
        slugDir,
        issues: result.error.issues.slice(0, 3).map((i) => i.message),
      });
      return null;
    }
    return version === 3
      ? { kind: 'legacy-v3', manifest: result.data as MultiPhaseManifestV3 }
      : { kind: 'current', manifest: result.data as MultiPhaseManifestV4 };
  }

  /** Copy a v3 run into a unique archive directory before removing its source. */
  async archiveLegacyRun(
    workspacePath: string,
    slugDir: string,
  ): Promise<string> {
    const root = resolve(this.getAnalysisDir(workspacePath));
    const source = resolve(slugDir);
    if (dirname(source) !== root) {
      throw new LegacyRunArchiveError(
        'Analysis run is outside the workspace analysis root.',
      );
    }
    const legacy = await this.readManifest(source);
    if (legacy?.kind !== 'legacy-v3') {
      throw new LegacyRunArchiveError(
        'Analysis run is not a valid v3 manifest.',
      );
    }

    const archive = join(
      root,
      `${basename(source)}${LEGACY_ARCHIVE_MARKER}${ulid()}`,
    );
    let created = false;
    let deleteStarted = false;
    let archiveKept = false;
    try {
      await this.fs.createDirectoryExclusive(archive);
      created = true;
      archiveKept = true;
      await this.copyDirectoryVerified(source, archive);
      const copied = await this.readManifest(archive);
      if (
        copied?.kind !== 'legacy-v3' ||
        JSON.stringify(copied.manifest) !== JSON.stringify(legacy.manifest)
      ) {
        throw new Error('Archived manifest failed v3 validation.');
      }
      try {
        deleteStarted = true;
        await this.fs.delete(source, { recursive: true });
      } catch (error: unknown) {
        // A provider may have deleted some files before failing. Restore from
        // the verified archive and retain that copy if restoration also fails.
        await this.fs.createDirectory(source);
        await this.copyDirectoryVerified(archive, source);
        throw error;
      }
      return archive;
    } catch (error: unknown) {
      if (
        created &&
        !deleteStarted &&
        (await this.readManifest(source))?.kind === 'legacy-v3'
      ) {
        try {
          await this.fs.delete(archive, { recursive: true });
          archiveKept = false;
        } catch {
          // Keep the partial archive when its cleanup fails; the v3 source remains.
        }
      }
      throw new LegacyRunArchiveError(
        archiveKept
          ? deleteStarted
            ? `Could not archive the legacy analysis run; the verified copy is kept at ${archive}.`
            : `Could not archive the legacy analysis run; the partial archive is kept at ${archive}.`
          : 'Could not archive the legacy analysis run.',
        error,
        archiveKept ? archive : null,
      );
    }
  }

  private async copyDirectoryVerified(
    source: string,
    destination: string,
  ): Promise<void> {
    const entries = await this.fs.readDirectory(source);
    for (const entry of entries) {
      const from = join(source, entry.name);
      const to = join(destination, entry.name);
      if (entry.type === FileType.Directory) {
        await this.fs.createDirectory(to);
        await this.copyDirectoryVerified(from, to);
      } else if (entry.type === FileType.File) {
        await this.fs.copy(from, to, { overwrite: true });
        const original = await this.fs.readFileBytes(from);
        const copied = await this.fs.readFileBytes(to);
        if (!Buffer.from(original).equals(Buffer.from(copied))) {
          throw new Error('Archived file failed byte verification.');
        }
      } else {
        throw new Error('Unsupported entry in analysis run.');
      }
    }
  }

  /**
   * Find the most recent valid multi-phase analysis for a workspace.
   */
  async findLatestMultiPhaseAnalysis(workspacePath: string): Promise<{
    slugDir: string;
    manifest: MultiPhaseManifest;
  } | null> {
    const runs = await this.listValidRuns(workspacePath);
    let latest: { slugDir: string; manifest: MultiPhaseManifest } | null = null;
    for (const run of runs) {
      if (isLegacyArchiveDirName(run.entry)) continue;
      if (
        !latest ||
        new Date(run.manifest.analyzedAt) > new Date(latest.manifest.analyzedAt)
      ) {
        latest = run;
      }
    }
    return latest;
  }

  /**
   * Find the latest run that a resume can continue: an analysis whose
   * lifecycle is not `completed`, or a generation checkpoint that is not
   * `completed`. An optional predicate skips candidates while keeping the
   * newest eligible run. Read-only: nothing on disk is changed.
   */
  async findLatestResumableRun(
    workspacePath: string,
    accepts?: (run: ResumableRun) => boolean,
  ): Promise<ResumableRun | null> {
    const runs = await this.listValidRuns(workspacePath);
    runs.sort(
      (a, b) =>
        new Date(b.manifest.updatedAt).getTime() -
        new Date(a.manifest.updatedAt).getTime(),
    );

    for (const run of runs) {
      if (isLegacyArchiveDirName(run.entry)) continue;
      if (run.manifest.version === 3) continue;
      const generation = await this.loadGenerationManifest(
        workspacePath,
        run.slugDir,
      );
      const analysisUnfinished = run.manifest.lifecycle !== 'completed';
      const generationUnfinished =
        generation !== null && generation.lifecycle !== 'completed';
      if (analysisUnfinished || generationUnfinished) {
        const candidate = {
          slugDir: run.slugDir,
          manifest: run.manifest,
          generation,
        };
        if (!accepts || accepts(candidate)) return candidate;
      }
    }

    const rootGeneration = await this.loadGenerationManifest(
      workspacePath,
      null,
    );
    if (rootGeneration && rootGeneration.lifecycle !== 'completed') {
      const candidate = {
        slugDir: null,
        manifest: null,
        generation: rootGeneration,
      };
      if (!accepts || accepts(candidate)) return candidate;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Generation checkpoint
  // ---------------------------------------------------------------------------

  /**
   * Persist a generation checkpoint (create or overwrite).
   * Returns the path that was written.
   */
  async writeGenerationManifest(
    workspacePath: string,
    analysisDir: string | null,
    manifest: GenerationCheckpointManifest,
  ): Promise<string> {
    const filePath = this.getGenerationManifestPath(workspacePath, analysisDir);
    await this.fs.createDirectory(dirname(filePath));
    await this.fs.writeFile(filePath, JSON.stringify(manifest, null, 2));
    return filePath;
  }

  /**
   * Load and validate a generation checkpoint. Returns null when the file is
   * missing or fails `GenerationCheckpointManifestSchema`; never deletes it.
   */
  async loadGenerationManifest(
    workspacePath: string,
    analysisDir: string | null,
  ): Promise<GenerationCheckpointManifest | null> {
    const filePath = this.getGenerationManifestPath(workspacePath, analysisDir);
    const parsed = await this.readJson(filePath);
    if (parsed === undefined) return null;
    const result = GenerationCheckpointManifestSchema.safeParse(parsed);
    if (!result.success) {
      this.logger.debug(
        `${SERVICE_TAG} Generation manifest rejected by schema`,
        {
          filePath,
          issues: result.error.issues.slice(0, 3).map((i) => i.message),
        },
      );
      return null;
    }
    return result.data as GenerationCheckpointManifest;
  }

  /**
   * Apply a change to a persisted generation checkpoint and write it back.
   * Returns the updated manifest, or null when no valid checkpoint exists.
   */
  async updateGenerationManifest(
    workspacePath: string,
    analysisDir: string | null,
    patch: (
      current: GenerationCheckpointManifest,
    ) => GenerationCheckpointManifest,
  ): Promise<GenerationCheckpointManifest | null> {
    const current = await this.loadGenerationManifest(
      workspacePath,
      analysisDir,
    );
    if (!current) return null;
    const next = patch(current);
    next.updatedAt = new Date().toISOString();
    await this.writeGenerationManifest(workspacePath, analysisDir, next);
    return next;
  }

  // ---------------------------------------------------------------------------
  // Enhanced-prompt trace
  // ---------------------------------------------------------------------------

  /**
   * Write the enhanced-prompt trace: the full Markdown prompt and its JSON
   * metadata. The target is the analysis slug directory when one is known,
   * and `<workspace>/.ptah/analysis/` otherwise. Throws on any write failure
   * so the caller can refuse to report success.
   */
  async writeEnhancedPromptTrace(
    workspacePath: string,
    analysisDir: string | null,
    prompt: string,
    metadata: EnhancedPromptTraceMetadata,
  ): Promise<{ markdownPath: string; metadataPath: string }> {
    const targetDir = analysisDir ?? this.getAnalysisDir(workspacePath);
    const markdownPath = join(targetDir, ENHANCED_PROMPT_MARKDOWN_FILE);
    const metadataPath = join(targetDir, ENHANCED_PROMPT_METADATA_FILE);

    await this.fs.createDirectory(targetDir);
    await this.fs.writeFile(markdownPath, prompt);
    await this.fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    this.logger.info(`${SERVICE_TAG} Enhanced prompt trace written`, {
      markdownPath,
      promptLength: metadata.promptLength,
      analysisPhaseIds: metadata.analysisPhaseIds,
    });

    return { markdownPath, metadataPath };
  }

  // ---------------------------------------------------------------------------
  // Listing / loading for the UI
  // ---------------------------------------------------------------------------

  /**
   * List all valid multi-phase analyses in .ptah/analysis/ directory.
   * Returns metadata sorted by date descending (newest first).
   */
  async list(workspacePath: string): Promise<SavedAnalysisMetadata[]> {
    const runs = await this.listValidRuns(workspacePath);
    const items: SavedAnalysisMetadata[] = runs.map(({ entry, manifest }) => {
      const completedPhases = Object.values(manifest.phases).filter(
        (p) => p.status === 'completed',
      );
      return {
        filename: entry,
        savedAt: manifest.analyzedAt,
        projectType: manifest.slug
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase()),
        phaseCount: completedPhases.length,
        model: manifest.model,
        durationMs: manifest.totalDurationMs,
      };
    });
    items.sort(
      (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
    );
    return items;
  }

  /**
   * Load a multi-phase analysis by slug directory name.
   * Reads the manifest and all completed phase markdown files.
   */
  async loadMultiPhase(
    workspacePath: string,
    slugDirName: string,
  ): Promise<MultiPhaseAnalysisResponse> {
    const slugDir = this.getSlugDir(workspacePath, slugDirName);
    const manifest = await this.loadManifest(slugDir);

    if (!manifest) {
      throw new Error(`Invalid or missing analysis manifest in ${slugDirName}`);
    }

    const phaseContents: Record<string, string> = {};
    for (const [phaseId, phaseResult] of Object.entries(manifest.phases)) {
      if (phaseResult.status === 'completed') {
        const content = await this.readPhaseFile(slugDir, phaseResult.file);
        if (content) {
          phaseContents[phaseId] = content;
        }
      }
    }

    this.logger.info(`${SERVICE_TAG} Multi-phase analysis loaded`, {
      slug: slugDirName,
      phaseCount: Object.keys(phaseContents).length,
    });

    return this.toResponse(slugDir, manifest, phaseContents);
  }

  /**
   * Build the wire response for a manifest. Shared by the load path and by
   * the handlers that answer with the manifest they just produced.
   */
  toResponse(
    slugDir: string,
    manifest: MultiPhaseManifest,
    phaseContents: Record<string, string>,
  ): MultiPhaseAnalysisResponse {
    return {
      isMultiPhase: true,
      manifest,
      phaseContents,
      analysisDir: slugDir,
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Every slug directory holding a valid version-3 or version-4 manifest. */
  private async listValidRuns(workspacePath: string): Promise<
    Array<{
      entry: string;
      slugDir: string;
      manifest: MultiPhaseManifest;
    }>
  > {
    const analysisDir = this.getAnalysisDir(workspacePath);
    let entries: Array<{ name: string; type: FileType }>;
    try {
      entries = await this.fs.readDirectory(analysisDir);
    } catch {
      // degradation-audit: optional-capability - a read failure here almost
      // always means `.ptah/analysis` does not exist yet (no analysis has ever
      // run), which is correctly reported as "zero valid runs".
      return [];
    }

    const runs: Array<{
      entry: string;
      slugDir: string;
      manifest: MultiPhaseManifest;
    }> = [];
    for (const entry of entries) {
      if (entry.type !== FileType.Directory) continue;
      const slugDir = join(analysisDir, entry.name);
      const manifest = await this.loadManifest(slugDir);
      if (!manifest) continue;
      runs.push({ entry: entry.name, slugDir, manifest });
    }
    return runs;
  }

  /**
   * Read and parse a JSON file. Returns `undefined` when the file is missing
   * or is not valid JSON; the file itself is never modified.
   */
  private async readJson(filePath: string): Promise<unknown | undefined> {
    let content: string;
    try {
      content = await this.fs.readFile(filePath);
    } catch {
      // degradation-audit: optional-capability - a missing manifest file means
      // "no manifest saved yet", which is this method's documented undefined
      // return.
      return undefined;
    }
    try {
      return JSON.parse(content) as unknown;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - a malformed manifest is
      // treated as absent (never deleted) per this method's documented
      // contract; the warn above already surfaces the parse failure to the log.
      this.logger.warn(
        `${SERVICE_TAG} Manifest is not valid JSON; left as-is`,
        {
          filePath,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return undefined;
    }
  }
}
