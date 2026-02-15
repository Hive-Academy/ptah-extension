/**
 * AnalysisStorageService - Persistent analysis file I/O
 *
 * Saves, lists, loads, and deletes analysis results from .claude/analysis/ directory.
 * Enables the wizard to reuse previous analysis results without re-scanning.
 *
 * File format: JSON with SavedAnalysisFile structure
 * Naming: {projectType-slug}-{YYYY-MM-DD-HHmmss}.json
 */

import { inject, injectable } from 'tsyringe';
import { join, basename } from 'path';
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  unlink,
  rm,
  stat as fsStat,
} from 'fs/promises';
import type { MultiPhaseManifest } from '../types/multi-phase.types';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  SavedAnalysisFile,
  SavedAnalysisMetadata,
  ProjectAnalysisResult,
  AgentRecommendation,
} from '@ptah-extension/shared';

@injectable()
export class AnalysisStorageService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Get the .claude/analysis/ directory path for a workspace.
   */
  getAnalysisDir(workspacePath: string): string {
    return join(workspacePath, '.claude', 'analysis');
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
   * Generate a timestamp string for filenames.
   * Format: YYYY-MM-DD-HHmmss
   */
  private generateTimestamp(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate()
    )}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  /**
   * Validate a filename to prevent path traversal attacks.
   * Only allows alphanumeric, hyphens, and .json extension.
   */
  private validateFilename(filename: string): void {
    if (!filename || typeof filename !== 'string') {
      throw new Error('Invalid filename: must be a non-empty string');
    }
    if (!filename.endsWith('.json')) {
      throw new Error('Invalid filename: must end with .json');
    }
    // Only allow safe characters
    const safeName = basename(filename);
    if (safeName !== filename || /[^a-zA-Z0-9._-]/.test(filename)) {
      throw new Error('Invalid filename: contains disallowed characters');
    }
  }

  /**
   * Save an analysis result to .claude/analysis/ directory.
   *
   * @param workspacePath - Workspace root path
   * @param analysis - Project analysis result
   * @param recommendations - Agent recommendations
   * @param method - Analysis method used ('agentic' or 'fallback')
   * @returns The generated filename
   */
  async save(
    workspacePath: string,
    analysis: ProjectAnalysisResult,
    recommendations: AgentRecommendation[],
    method: 'agentic' | 'fallback'
  ): Promise<string> {
    const dir = this.getAnalysisDir(workspacePath);

    // Ensure directory exists
    await mkdir(dir, { recursive: true });

    const projectSlug = this.slugify(
      analysis.projectTypeDescription || analysis.projectType || 'project'
    );
    const timestamp = this.generateTimestamp();
    const filename = `${projectSlug}-${timestamp}.json`;

    const data: SavedAnalysisFile = {
      version: 1,
      savedAt: new Date().toISOString(),
      analysisMethod: method,
      analysis,
      recommendations,
    };

    const filePath = join(dir, filename);
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');

    this.logger.info('[AnalysisStorage] Analysis saved', {
      filename,
      projectType: analysis.projectType,
      agentCount: recommendations.length,
    });

    return filename;
  }

  /**
   * List all saved analyses in .claude/analysis/ directory.
   * Returns metadata only (does not load full analysis data).
   * Sorted by savedAt descending (newest first).
   *
   * @param workspacePath - Workspace root path
   * @returns Array of analysis metadata
   */
  async list(workspacePath: string): Promise<SavedAnalysisMetadata[]> {
    const dir = this.getAnalysisDir(workspacePath);
    const metadata: SavedAnalysisMetadata[] = [];

    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      // Directory doesn't exist yet — return empty list
      return [];
    }

    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    for (const file of jsonFiles) {
      try {
        const filePath = join(dir, file);
        const content = await readFile(filePath, 'utf-8');
        const data = JSON.parse(content) as SavedAnalysisFile;

        // Validate structure
        if (data.version !== 1 || !data.analysis || !data.recommendations) {
          this.logger.warn('[AnalysisStorage] Skipping invalid file', { file });
          continue;
        }

        metadata.push({
          filename: file,
          savedAt: data.savedAt,
          projectType:
            data.analysis.projectTypeDescription ||
            data.analysis.projectType ||
            'Unknown',
          fileCount: data.analysis.fileCount || 0,
          qualityScore: data.analysis.qualityScore,
          analysisMethod: data.analysisMethod || 'fallback',
          agentCount: data.recommendations.length,
        });
      } catch (error) {
        this.logger.warn('[AnalysisStorage] Failed to read analysis file', {
          file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Sort by savedAt descending (newest first)
    metadata.sort(
      (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
    );

    return metadata;
  }

  /**
   * Load a saved analysis file by filename.
   *
   * @param workspacePath - Workspace root path
   * @param filename - Filename to load (must be in .claude/analysis/)
   * @returns Full saved analysis data
   */
  async load(
    workspacePath: string,
    filename: string
  ): Promise<SavedAnalysisFile> {
    this.validateFilename(filename);

    const filePath = join(this.getAnalysisDir(workspacePath), filename);
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content) as SavedAnalysisFile;

    // Validate version
    if (data.version !== 1) {
      throw new Error(
        `Unsupported analysis file version: ${data.version}. Expected version 1.`
      );
    }

    if (!data.analysis || !data.recommendations) {
      throw new Error(
        'Invalid analysis file: missing analysis or recommendations data'
      );
    }

    this.logger.info('[AnalysisStorage] Analysis loaded', {
      filename,
      projectType: data.analysis.projectType,
      agentCount: data.recommendations.length,
    });

    return data;
  }

  /**
   * Delete a saved analysis file.
   *
   * @param workspacePath - Workspace root path
   * @param filename - Filename to delete
   */
  async delete(workspacePath: string, filename: string): Promise<void> {
    this.validateFilename(filename);

    const filePath = join(this.getAnalysisDir(workspacePath), filename);
    await unlink(filePath);

    this.logger.info('[AnalysisStorage] Analysis deleted', { filename });
  }

  // =========================================================================
  // v2 Multi-Phase Analysis Storage Methods
  // =========================================================================

  /**
   * Get the absolute path for a slug subdirectory within .claude/analysis/.
   *
   * @param workspacePath - Workspace root path
   * @param slug - URL-safe slug (e.g., 'react-spa-with-supabase')
   * @returns Absolute path to the slug directory
   */
  getSlugDir(workspacePath: string, slug: string): string {
    return join(this.getAnalysisDir(workspacePath), slug);
  }

  /**
   * Create or overwrite a slug directory for multi-phase analysis.
   * Removes any existing directory with the same slug before creating a fresh one.
   *
   * @param workspacePath - Workspace root path
   * @param projectDescription - Human-readable project description to slugify
   * @returns Object with the absolute slugDir path and generated slug
   */
  async createSlugDir(
    workspacePath: string,
    projectDescription: string
  ): Promise<{ slugDir: string; slug: string }> {
    const slug = this.slugify(projectDescription);
    const slugDir = this.getSlugDir(workspacePath, slug);

    // Remove existing directory if present (overwrite strategy)
    await rm(slugDir, { recursive: true, force: true });
    await mkdir(slugDir, { recursive: true });

    this.logger.info('[AnalysisStorage] Created slug directory', {
      slug,
      slugDir,
    });

    return { slugDir, slug };
  }

  /**
   * Write a phase output file to a slug directory.
   *
   * @param slugDir - Absolute path to the slug directory
   * @param filename - Output filename (e.g., '01-project-profile.md')
   * @param content - File content (markdown)
   */
  async writePhaseFile(
    slugDir: string,
    filename: string,
    content: string
  ): Promise<void> {
    await writeFile(join(slugDir, filename), content, 'utf-8');
  }

  /**
   * Write the manifest.json file to a slug directory.
   *
   * @param slugDir - Absolute path to the slug directory
   * @param manifest - Multi-phase manifest data
   */
  async writeManifest(
    slugDir: string,
    manifest: MultiPhaseManifest
  ): Promise<void> {
    await writeFile(
      join(slugDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8'
    );
  }

  /**
   * Load and validate a manifest.json from a slug directory.
   * Returns null if the file doesn't exist, is invalid JSON, or has wrong version.
   *
   * @param slugDir - Absolute path to the slug directory
   * @returns Parsed manifest or null
   */
  async loadManifest(slugDir: string): Promise<MultiPhaseManifest | null> {
    try {
      const content = await readFile(join(slugDir, 'manifest.json'), 'utf-8');
      const data = JSON.parse(content) as MultiPhaseManifest;
      if (data.version !== 2) return null;
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Read a phase output file from a slug directory.
   * Returns null if the file doesn't exist or can't be read.
   *
   * @param slugDir - Absolute path to the slug directory
   * @param filename - Phase output filename (e.g., '03-quality-audit.md')
   * @returns File content or null
   */
  async readPhaseFile(
    slugDir: string,
    filename: string
  ): Promise<string | null> {
    try {
      return await readFile(join(slugDir, filename), 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Find the most recent multi-phase analysis for a workspace.
   * Scans all subdirectories in .claude/analysis/ for valid v2 manifests
   * and returns the one with the most recent analyzedAt timestamp.
   *
   * @param workspacePath - Workspace root path
   * @returns The latest analysis slug directory and manifest, or null
   */
  async findLatestMultiPhaseAnalysis(workspacePath: string): Promise<{
    slugDir: string;
    manifest: MultiPhaseManifest;
  } | null> {
    const analysisDir = this.getAnalysisDir(workspacePath);
    let entries: string[];
    try {
      entries = await readdir(analysisDir);
    } catch {
      return null;
    }

    let latest: { slugDir: string; manifest: MultiPhaseManifest } | null = null;

    for (const entry of entries) {
      const entryPath = join(analysisDir, entry);
      try {
        const stat = await fsStat(entryPath);
        if (!stat.isDirectory()) continue;

        const manifest = await this.loadManifest(entryPath);
        if (!manifest) continue;

        if (
          !latest ||
          new Date(manifest.analyzedAt) > new Date(latest.manifest.analyzedAt)
        ) {
          latest = { slugDir: entryPath, manifest };
        }
      } catch {
        continue;
      }
    }

    return latest;
  }

  /**
   * List all saved analyses (both v1 JSON files and v2 slug directories).
   * Returns combined metadata sorted by date descending (newest first).
   *
   * @param workspacePath - Workspace root path
   * @returns Combined array of v1 and v2 analysis metadata
   */
  async listAll(workspacePath: string): Promise<SavedAnalysisMetadata[]> {
    const v1Items = await this.list(workspacePath);

    // Scan for v2 directories with valid manifests
    const analysisDir = this.getAnalysisDir(workspacePath);
    let entries: string[];
    try {
      entries = await readdir(analysisDir);
    } catch {
      return v1Items;
    }

    const v2Items: SavedAnalysisMetadata[] = [];
    for (const entry of entries) {
      const entryPath = join(analysisDir, entry);
      try {
        const stat = await fsStat(entryPath);
        if (!stat.isDirectory()) continue;

        const manifest = await this.loadManifest(entryPath);
        if (!manifest) continue;

        v2Items.push({
          filename: entry,
          savedAt: manifest.analyzedAt,
          projectType: manifest.slug,
          fileCount: 0,
          analysisMethod: 'agentic',
          agentCount: 0,
          qualityScore: undefined,
        });
      } catch {
        continue;
      }
    }

    // Combine and sort by date descending
    return [...v1Items, ...v2Items].sort(
      (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
    );
  }
}
