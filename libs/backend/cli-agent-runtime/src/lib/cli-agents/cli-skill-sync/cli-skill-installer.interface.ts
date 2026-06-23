/**
 * CLI Skill Installer Interface
 *
 * Each rival CLI (Cursor, Codex, Copilot) has its own installer that
 * copies Ptah skills/commands from the user layer (~/.ptah/user/) into the
 * CLI's WORKSPACE-level discovery directory, mirroring {workspace}/.claude/.
 *
 * Pattern: Strategy pattern matching CliAdapter interface in cli-adapters/.
 */

import type { CliTarget, CliSkillSyncStatus } from '@ptah-extension/shared';

/** Format used to emit workspace command files for a CLI, or null when the CLI has no project-command surface. */
export type CliCommandFormat = 'md' | null;

/** Source roots in the user layer (~/.ptah/user/) feeding workspace propagation. */
export interface CliSkillSyncSources {
  /** Absolute path to ~/.ptah/user/skills */
  skillsRoot: string;
  /** Absolute path to ~/.ptah/user/commands */
  commandsRoot: string;
}

export interface CliSkillInstallOptions {
  /**
   * Workspace root the rival dirs are written under. When undefined, workspace
   * propagation is skipped entirely (no home fallback).
   */
  workspaceRoot?: string;
  /**
   * When true, skip the command-file sync. Synthesized-skill passes set this
   * because synthesized skills have no commands.
   * Default: true.
   */
  syncCommands?: boolean;
  /**
   * When true, skip skill directories lacking a top-level SKILL.md.
   * Default: false.
   */
  requireSkillMdAtRoot?: boolean;
}

/**
 * Strategy interface for propagating Ptah skills/commands into a rival CLI's
 * WORKSPACE-level discovery directories from the user layer.
 *
 * Bare-name identity: folder name == slug (no `ptah-` prefix). Provenance is
 * tracked via a managed manifest (.ptah-managed.json), never the name.
 */
export interface ICliSkillInstaller {
  /** Which CLI this installer targets */
  readonly target: CliTarget;

  /**
   * Resolve the workspace skills directory for this CLI, or null if unsupported.
   * e.g. Codex -> {ws}/.agents/skills,
   * Copilot -> {ws}/.github/skills, Cursor -> {ws}/.cursor/skills.
   */
  resolveSkillsTarget(workspaceRoot: string): string | null;

  /**
   * Resolve the workspace commands directory for this CLI, or null if the CLI
   * has no project-command surface (Codex, Copilot -> null).
   */
  resolveCommandsTarget(workspaceRoot: string): string | null;

  /** Command file format for this CLI (md for Cursor, null otherwise). */
  readonly commandFormat: CliCommandFormat;

  /**
   * Copy skills/commands from the user layer into the CLI's workspace dirs.
   * Skips workspace writes entirely when options.workspaceRoot is undefined.
   *
   * @param sources - user-layer skills/commands roots (~/.ptah/user/)
   * @param options - workspace root + sync scope flags
   */
  install(
    sources: CliSkillSyncSources,
    options?: CliSkillInstallOptions,
  ): Promise<CliSkillSyncStatus>;

  /**
   * Remove all Ptah-managed skills/commands from this CLI's workspace dirs for
   * the given workspace. Keyed by the managed manifest, not the name.
   */
  uninstall(workspaceRoot?: string): Promise<void>;
}
