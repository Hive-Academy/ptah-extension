/**
 * AnalysisStorageService - Persistent analysis file I/O (v2 multi-phase only)
 *
 * Lists, loads, and manages multi-phase analysis results from
 * .claude/analysis/{slug}/ directories. Each slug directory contains
 * a manifest.json and phase markdown files.
 */

import { inject, injectable } from 'tsyringe';
import { join } from 'path';
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rm,
  stat as fsStat,
} from 'fs/promises';
import type { MultiPhaseManifest } from '../types/multi-phase.types';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  SavedAnalysisMetadata,
  MultiPhaseAnalysisResponse,
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
   * Get the absolute path for a slug subdirectory within .claude/analysis/.
   */
  getSlugDir(workspacePath: string, slug: string): string {
    return join(this.getAnalysisDir(workspacePath), slug);
  }

  /**
   * Create or overwrite a slug directory for multi-phase analysis.
   */
  async createSlugDir(
    workspacePath: string,
    projectDescription: string
  ): Promise<{ slugDir: string; slug: string }> {
    const slug = this.slugify(projectDescription);
    const slugDir = this.getSlugDir(workspacePath, slug);

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
        const entryStat = await fsStat(entryPath);
        if (!entryStat.isDirectory()) continue;

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
   * List all v2 multi-phase analyses in .claude/analysis/ directory.
   * Scans subdirectories for valid manifests.
   * Returns metadata sorted by date descending (newest first).
   */
  async list(workspacePath: string): Promise<SavedAnalysisMetadata[]> {
    const analysisDir = this.getAnalysisDir(workspacePath);
    let entries: string[];
    try {
      entries = await readdir(analysisDir);
    } catch {
      return [];
    }

    const items: SavedAnalysisMetadata[] = [];
    for (const entry of entries) {
      const entryPath = join(analysisDir, entry);
      try {
        const entryStat = await fsStat(entryPath);
        if (!entryStat.isDirectory()) continue;

        const manifest = await this.loadManifest(entryPath);
        if (!manifest) continue;

        const completedPhases = Object.values(manifest.phases).filter(
          (p) => p.status === 'completed'
        );

        items.push({
          filename: entry,
          savedAt: manifest.analyzedAt,
          projectType: manifest.slug
            .replace(/-/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase()),
          phaseCount: completedPhases.length,
          model: manifest.model,
          durationMs: manifest.totalDurationMs,
        });
      } catch {
        continue;
      }
    }

    // Sort by savedAt descending (newest first)
    items.sort(
      (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
    );

    return items;
  }

  /**
   * Load a multi-phase analysis by slug directory name.
   * Reads the manifest and all completed phase markdown files.
   * Returns a MultiPhaseAnalysisResponse suitable for frontend consumption.
   */
  async loadMultiPhase(
    workspacePath: string,
    slugDirName: string
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

    this.logger.info('[AnalysisStorage] Multi-phase analysis loaded', {
      slug: slugDirName,
      phaseCount: Object.keys(phaseContents).length,
    });

    return {
      isMultiPhase: true,
      manifest: {
        slug: manifest.slug,
        analyzedAt: manifest.analyzedAt,
        model: manifest.model,
        totalDurationMs: manifest.totalDurationMs,
        phases: manifest.phases,
      },
      phaseContents,
      analysisDir: slugDir,
    };
  }
}
