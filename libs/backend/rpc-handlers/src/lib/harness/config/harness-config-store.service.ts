/**
 * HarnessConfigStore.
 *
 * Filesystem + configuration persistence for the harness wizard:
 *   - Writes CLAUDE.md to the workspace .claude/ directory (with backup).
 *   - Merges agent config into `~/.ptah/settings.json`.
 *   - Normalises partial configs coming from the conversational builder.
 *   - Persists/loads harness presets in `~/.ptah/harnesses/*.json`.
 *
 * Extracted from `harness-rpc.handlers.ts` (lines 204–214, 2160–2403, 3794–3802).
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { HarnessConfig, HarnessPreset } from '@ptah-extension/shared';
import { HARNESS_TOKENS } from '../tokens';
import { HarnessPromptBuilderService } from './harness-prompt-builder.service';

/** Directory name under ~/.ptah/ for harness presets */
const HARNESSES_DIR = 'harnesses';

/** ~/.ptah base directory */
function getPtahHome(): string {
  return path.join(os.homedir(), '.ptah');
}

/** Harness presets directory */
function getHarnessesDir(): string {
  return path.join(getPtahHome(), HARNESSES_DIR);
}

@injectable()
export class HarnessConfigStore {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(HARNESS_TOKENS.PROMPT_BUILDER)
    private readonly promptBuilder: HarnessPromptBuilderService,
  ) {}

  /** Absolute path to `~/.ptah/settings.json` (used by callers for reporting). */
  get settingsPath(): string {
    return path.join(getPtahHome(), 'settings.json');
  }

  /**
   * Write CLAUDE.md to the workspace .claude/ directory.
   * If an existing CLAUDE.md is found, backs it up to CLAUDE.md.bak first.
   *
   * @returns Object with the written path and optional backup path
   */
  async writeClaudeMdToWorkspace(
    workspaceRoot: string,
    config: HarnessConfig,
  ): Promise<{ claudeMdPath: string; backupPath?: string }> {
    const claudeDir = path.join(workspaceRoot, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });

    const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');

    // Back up existing CLAUDE.md before overwriting
    let backupPath: string | undefined;
    try {
      await fs.access(claudeMdPath);
      backupPath = claudeMdPath + '.bak';
      await fs.copyFile(claudeMdPath, backupPath);
      this.logger.info('Backed up existing CLAUDE.md', { backupPath });
    } catch {
      // File doesn't exist, no backup needed
    }

    // Use preview content if available, otherwise generate
    const content = config.claudeMd.previewContent
      ? config.claudeMd.previewContent
      : this.promptBuilder.buildClaudeMdContent(config);

    await fs.writeFile(claudeMdPath, content, 'utf-8');

    this.logger.debug('Wrote CLAUDE.md to workspace', {
      path: claudeMdPath,
      contentLength: content.length,
      backedUp: !!backupPath,
    });

    return { claudeMdPath, backupPath };
  }

  /**
   * Update ~/.ptah/settings.json with agent configuration from the harness config.
   *
   * Merges agent overrides into the existing settings file,
   * preserving any unrelated settings.
   */
  async updatePtahSettings(config: HarnessConfig): Promise<void> {
    const settingsPath = path.join(getPtahHome(), 'settings.json');

    let existingSettings: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(settingsPath, 'utf-8');
      existingSettings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // File doesn't exist or is invalid JSON; start fresh
    }

    // Merge agent configuration
    const agentConfig: Record<string, unknown> = {};
    for (const [agentId, override] of Object.entries(
      config.agents.enabledAgents,
    )) {
      if (override.enabled) {
        agentConfig[agentId] = {
          enabled: true,
          ...(override.modelTier ? { modelTier: override.modelTier } : {}),
          ...(override.autoApprove !== undefined
            ? { autoApprove: override.autoApprove }
            : {}),
          ...(override.customInstructions
            ? { customInstructions: override.customInstructions }
            : {}),
        };
      }
    }

    existingSettings['harness.agents'] = agentConfig;
    existingSettings['harness.lastApplied'] = config.name;
    existingSettings['harness.lastAppliedAt'] = new Date().toISOString();

    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(
      settingsPath,
      JSON.stringify(existingSettings, null, 2),
      'utf-8',
    );
  }

  /**
   * Fill in missing fields with safe defaults so partial configs from the
   * conversational builder are applyable without schema violations.
   */
  normalizeHarnessConfig(
    config: Partial<HarnessConfig> | HarnessConfig,
  ): HarnessConfig {
    const now = new Date().toISOString();
    return {
      name:
        config.name && config.name.trim().length > 0 ? config.name : 'harness',
      persona: config.persona ?? {
        label: '',
        description: '',
        goals: [],
      },
      agents: {
        enabledAgents: config.agents?.enabledAgents ?? {},
        harnessSubagents: config.agents?.harnessSubagents ?? [],
      },
      skills: {
        selectedSkills: config.skills?.selectedSkills ?? [],
        createdSkills: config.skills?.createdSkills ?? [],
      },
      prompt: {
        systemPrompt: config.prompt?.systemPrompt ?? '',
        enhancedSections: config.prompt?.enhancedSections ?? {},
      },
      mcp: {
        servers: config.mcp?.servers ?? [],
        enabledTools: config.mcp?.enabledTools ?? {},
      },
      claudeMd: {
        generateProjectClaudeMd:
          config.claudeMd?.generateProjectClaudeMd ?? true,
        customSections: config.claudeMd?.customSections ?? {},
        previewContent: config.claudeMd?.previewContent ?? '',
      },
      createdAt: config.createdAt ?? now,
      updatedAt: now,
    };
  }

  /**
   * Write a preset to disk at ~/.ptah/harnesses/{name}.json.
   *
   * Handles filename collisions: if the sanitized name maps to an existing file
   * belonging to a different preset (different original name), a numeric suffix
   * is appended to avoid silent overwrites. Same-name presets are updated in place.
   */
  async writePresetToDisk(
    name: string,
    config: HarnessConfig,
    description?: string,
  ): Promise<string> {
    const harnessesDir = getHarnessesDir();
    await fs.mkdir(harnessesDir, { recursive: true });

    const baseName = this.sanitizeFileName(name);
    let fileName = `${baseName}.json`;
    let presetPath = path.join(harnessesDir, fileName);

    // Avoid overwriting existing presets with different names
    let counter = 1;
    while (true) {
      try {
        await fs.access(presetPath);
        // File exists — check if it belongs to the same preset (same name = update)
        const existing = JSON.parse(
          await fs.readFile(presetPath, 'utf-8'),
        ) as HarnessPreset;
        if (existing.name === name) break; // Same preset, safe to overwrite
        // Different preset with colliding filename, try next suffix
        fileName = `${baseName}-${counter}.json`;
        presetPath = path.join(harnessesDir, fileName);
        counter++;
      } catch {
        break; // File doesn't exist, safe to write
      }
    }

    const presetId = fileName.replace(/\.json$/, '');

    const preset: HarnessPreset = {
      id: presetId,
      name,
      description: description || `Harness preset: ${name}`,
      config: {
        ...config,
        updatedAt: new Date().toISOString(),
      },
      createdAt: config.createdAt || new Date().toISOString(),
    };

    await fs.writeFile(presetPath, JSON.stringify(preset, null, 2), 'utf-8');

    this.logger.debug('Wrote harness preset to disk', {
      presetId,
      presetPath,
    });

    return presetPath;
  }

  /**
   * Load all presets from ~/.ptah/harnesses/ directory.
   * Malformed files are skipped with a debug log.
   */
  async loadPresetsFromDisk(): Promise<HarnessPreset[]> {
    const harnessesDir = getHarnessesDir();
    const presets: HarnessPreset[] = [];

    let entries: string[];
    try {
      entries = await fs.readdir(harnessesDir);
    } catch {
      // Directory doesn't exist yet — no presets
      return [];
    }

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;

      const filePath = path.join(harnessesDir, entry);
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(raw) as HarnessPreset;

        // Basic validation: ensure required fields exist
        if (parsed.id && parsed.name && parsed.config) {
          presets.push(parsed);
        } else {
          this.logger.debug('Skipping malformed harness preset', {
            file: entry,
          });
        }
      } catch (parseError) {
        this.logger.debug('Failed to parse harness preset', {
          file: entry,
          error:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
        });
      }
    }

    return presets;
  }

  /**
   * Sanitize a name for use as a filename (no path separators, special chars).
   */
  sanitizeFileName(name: string): string {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'unnamed'
    );
  }
}
