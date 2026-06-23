import { readdir, lstat, access } from 'fs/promises';
import { join } from 'path';
import type { CliTarget, CliSkillSyncStatus } from '@ptah-extension/shared';
import type {
  CliCommandFormat,
  CliSkillInstallOptions,
  CliSkillSyncSources,
  ICliSkillInstaller,
} from './cli-skill-installer.interface';
import {
  copyWorkspaceSkill,
  copyWorkspaceCommandMd,
  readManagedManifest,
  writeManagedManifest,
  reapExactEntries,
  type CliManagedManifest,
} from './skill-sync-utils';

const LEGACY_PREFIXES = ['ptah-', 'ptahsynth-'];

export abstract class WorkspaceSkillInstaller implements ICliSkillInstaller {
  abstract readonly target: CliTarget;
  abstract readonly commandFormat: CliCommandFormat;

  abstract resolveSkillsTarget(workspaceRoot: string): string | null;
  abstract resolveCommandsTarget(workspaceRoot: string): string | null;

  async install(
    sources: CliSkillSyncSources,
    options?: CliSkillInstallOptions,
  ): Promise<CliSkillSyncStatus> {
    const workspaceRoot = options?.workspaceRoot;
    const syncCommandsEnabled = options?.syncCommands ?? true;
    const requireSkillMd = options?.requireSkillMdAtRoot ?? false;
    const errors: string[] = [];
    let skillCount = 0;

    if (!workspaceRoot) {
      return {
        cli: this.target,
        synced: true,
        skillCount: 0,
        lastSyncedAt: new Date().toISOString(),
      };
    }

    try {
      const skillsTarget = this.resolveSkillsTarget(workspaceRoot);
      if (skillsTarget) {
        skillCount += await this.syncSkills(
          sources.skillsRoot,
          skillsTarget,
          requireSkillMd,
          errors,
        );
      }

      const commandsTarget =
        syncCommandsEnabled && this.commandFormat
          ? this.resolveCommandsTarget(workspaceRoot)
          : null;
      if (commandsTarget) {
        await this.syncCommands(sources.commandsRoot, commandsTarget, errors);
      }

      return {
        cli: this.target,
        synced: errors.length === 0,
        skillCount,
        lastSyncedAt: new Date().toISOString(),
        error: errors.length > 0 ? errors.join('; ') : undefined,
      };
    } catch (error: unknown) {
      return {
        cli: this.target,
        synced: false,
        skillCount: 0,
        error: `${this.target} skill install failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  async uninstall(workspaceRoot?: string): Promise<void> {
    if (!workspaceRoot) {
      return;
    }
    const skillsTarget = this.resolveSkillsTarget(workspaceRoot);
    const commandsTarget = this.resolveCommandsTarget(workspaceRoot);

    if (skillsTarget) {
      const manifest = await readManagedManifest(skillsTarget);
      const next: CliManagedManifest = { ...manifest, skills: [] };
      await reapExactEntries(skillsTarget, manifest.skills ?? []);
      await writeManagedManifest(skillsTarget, next);
    }
    if (commandsTarget) {
      const manifest = await readManagedManifest(commandsTarget);
      const next: CliManagedManifest = { ...manifest, commands: [] };
      await reapExactEntries(commandsTarget, manifest.commands ?? []);
      await writeManagedManifest(commandsTarget, next);
    }
  }

  protected legacyPrefixes(): string[] {
    return LEGACY_PREFIXES;
  }

  private async syncSkills(
    skillsRoot: string,
    skillsTarget: string,
    requireSkillMd: boolean,
    errors: string[],
  ): Promise<number> {
    let slugs: string[];
    try {
      slugs = await this.listSkillSlugs(skillsRoot);
    } catch {
      return 0;
    }

    const manifest = await readManagedManifest(skillsTarget);
    const written: string[] = [];
    let skillCount = 0;

    for (const slug of slugs) {
      const sourceDir = join(skillsRoot, slug);
      try {
        if (requireSkillMd && !(await this.hasSkillMd(sourceDir))) {
          continue;
        }
        const result = await copyWorkspaceSkill(
          sourceDir,
          skillsTarget,
          slug,
          manifest,
        );
        if (result.skipped) {
          errors.push(
            `Skipped skill ${slug} for ${this.target}: foreign entry exists (not Ptah-managed)`,
          );
          continue;
        }
        skillCount += result.filesCopied;
        written.push(slug);
      } catch (error: unknown) {
        errors.push(
          `Failed to copy skill ${slug}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const merged = this.mergeManaged(manifest.skills ?? [], written);
    await writeManagedManifest(skillsTarget, { ...manifest, skills: merged });
    return skillCount;
  }

  private async syncCommands(
    commandsRoot: string,
    commandsTarget: string,
    errors: string[],
  ): Promise<void> {
    let files: string[];
    try {
      files = (await readdir(commandsRoot, { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name);
    } catch {
      return;
    }

    const manifest = await readManagedManifest(commandsTarget);
    const written: string[] = [];

    for (const fileName of files) {
      const sourceFile = join(commandsRoot, fileName);
      const commandName = fileName.replace(/\.md$/, '');
      try {
        const result = await copyWorkspaceCommandMd(
          sourceFile,
          commandsTarget,
          fileName,
          manifest,
        );
        if (result.skipped) {
          errors.push(
            `Skipped command ${commandName} for ${this.target}: foreign entry exists`,
          );
          continue;
        }
        written.push(fileName);
      } catch (error: unknown) {
        errors.push(
          `Failed to write command ${commandName}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const merged = this.mergeManaged(manifest.commands ?? [], written);
    await writeManagedManifest(commandsTarget, {
      ...manifest,
      commands: merged,
    });
  }

  private mergeManaged(existing: string[], written: string[]): string[] {
    return Array.from(new Set([...existing, ...written]));
  }

  private async listSkillSlugs(skillsRoot: string): Promise<string[]> {
    const entries = await readdir(skillsRoot, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.isSymbolicLink())
      .map((e) => e.name);
  }

  private async hasSkillMd(skillDir: string): Promise<boolean> {
    try {
      const s = await lstat(skillDir);
      if (!s.isDirectory() || s.isSymbolicLink()) {
        return false;
      }
      await access(join(skillDir, 'SKILL.md'));
      return true;
    } catch {
      return false;
    }
  }
}
