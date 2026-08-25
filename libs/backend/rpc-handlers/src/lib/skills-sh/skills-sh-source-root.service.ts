/**
 * The one writer of `~/.ptah/plugins/ptah-skillssh-*`.
 *
 * Owns the whole lifecycle of a skills.sh source root — stage, adopt, list,
 * remove — and nothing else. It does NOT propagate: `HarnessPropagationService`
 * is the single entry point every trigger uses, and the trigger here is the RPC
 * handler, so the handler makes that call (the same shape
 * `plugins:install-external` uses). A service that both wrote content and
 * reconciled would be a second propagation policy.
 *
 * Grouping note: this class is deliberately the ONLY collaborator
 * `SkillsShRpcHandlers` gains for the whole feature. Install, uninstall, list
 * and the legacy sweep are four faces of one question — what is in the source
 * roots — and splitting them across four injected services is the
 * `PluginRpcHandlers` constructor-bloat pattern, not a fix for it.
 */

import { inject, injectable } from 'tsyringe';
import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type { InstalledSkill } from '@ptah-extension/shared';

import {
  SKILLS_SH_METADATA_FILE,
  SKILLS_SH_PLUGIN_PREFIX,
  SKILLS_SH_SCOPE,
  SkillsShRootMetadataSchema,
  isSkillsShRootId,
  skillsShRootId,
  type SkillsShRootMetadata,
} from './skills-sh-source-root';
import { adoptLegacySkillsShInstalls } from './skills-sh-legacy-adoption';
import {
  STAGED_SKILLS_REL,
  stageSkillsInstall,
  type SkillInstallRequest,
} from '../utils/skills-sh-cli';

/** One source root on disk, with its record parsed. */
export interface SkillsShRoot {
  /** Directory name, e.g. `ptah-skillssh-anthropics-skills`. */
  id: string;
  /** Absolute path to the root. */
  dir: string;
  /** Parsed `.ptah-skillssh.json`, or `null` when absent/corrupt. */
  metadata: SkillsShRootMetadata | null;
  /** Slugs actually present under `skills/`. */
  slugs: string[];
}

export type SkillsShInstallOutcome =
  | { success: true; rootId: string; slugs: string[] }
  | { success: false; error: string };

export type SkillsShUninstallOutcome =
  | { success: true; rootId: string; removedRoot: boolean }
  | { success: false; error: string };

@injectable()
export class SkillsShSourceRootService {
  private readonly homeDir: string;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    /**
     * Override for the home directory every path here is built from.
     *
     * A plain DEFAULTED parameter rather than an optional injection token, and
     * that is deliberate. No host registers such a token, so `@inject` on it
     * would be an injection site the DI lint gate (`tools/di-lint`) correctly
     * refuses — its whole job is to catch a token nobody registers, which is
     * otherwise a silent runtime crash. Container resolution simply omits this
     * argument and the default applies; a spec passes a temp directory
     * positionally. That matters because a spec writing to the real `~/.ptah`
     * corrupts the developer's own harness, which has happened before here
     * (harness-sync's CLAUDE.md, "Never let a spec touch the real home
     * directory").
     */
    homeDir: string | null = null,
  ) {
    this.homeDir = homeDir ?? os.homedir();
  }

  /** `~/.ptah/plugins`. */
  get pluginsBasePath(): string {
    return path.join(this.homeDir, '.ptah', 'plugins');
  }

  private rootDir(rootId: string): string {
    return path.join(this.pluginsBasePath, rootId);
  }

  // ------------------------------------------------------------------ install

  /**
   * Install one skills.sh source (optionally one skill within it) into its
   * source root.
   *
   * The sequence is stage → verify → move → record, and the order matters. The
   * third-party CLI runs in a scratch directory that nothing reads, so a
   * partial or failed fetch never leaves half a skill in a place the reconciler
   * would then propagate. Only a run that produced at least one readable slug
   * reaches the source root.
   *
   * Re-installing the same source is an UPDATE: each staged slug replaces its
   * counterpart, and the metadata's slug list becomes the union. A slug the
   * user removed upstream is left alone rather than reaped, because a
   * single-skill install (`--skill x`) must not delete the other nine skills a
   * previous whole-repo install of the same source wrote.
   */
  async install(request: SkillInstallRequest): Promise<SkillsShInstallOutcome> {
    const rootId = skillsShRootId(request.source);
    if (rootId === null) {
      return {
        success: false,
        error: `Invalid source format: "${request.source}". Expected "owner/repo".`,
      };
    }

    const stagingDir = await this.makeStagingDir();
    try {
      const staged = await stageSkillsInstall(request, stagingDir);
      if (!staged.success) {
        return { success: false, error: staged.error };
      }

      const stagedSkillsDir = path.join(stagingDir, ...STAGED_SKILLS_REL);
      const slugs = await this.listSkillSlugs(stagedSkillsDir);
      if (slugs.length === 0) {
        return {
          success: false,
          error:
            'The skills CLI reported success but wrote no readable skill. Nothing was installed.',
        };
      }

      const rootDir = this.rootDir(rootId);
      const targetSkillsDir = path.join(rootDir, 'skills');
      await fs.mkdir(targetSkillsDir, { recursive: true });

      for (const slug of slugs) {
        const target = path.join(targetSkillsDir, slug);
        await fs.rm(target, { recursive: true, force: true });
        await this.movePath(path.join(stagedSkillsDir, slug), target);
      }

      const existing = await this.readMetadata(rootDir);
      await this.writeMetadata(rootDir, {
        version: 1,
        source: request.source,
        skillIds: [
          ...new Set([...(existing?.skillIds ?? []), ...slugs]),
        ].sort(),
        installedAt: new Date().toISOString(),
      });

      this.logger.info('[skills.sh] Installed into source root', {
        rootId,
        slugs,
      });
      return { success: true, rootId, slugs };
    } finally {
      await this.discard(stagingDir);
    }
  }

  // ---------------------------------------------------------------- uninstall

  /**
   * Remove one skill slug from whichever source root holds it.
   *
   * Removing the LAST slug removes the root as well. That is not tidiness: an
   * empty root would keep contributing an entry to `overlayPluginPaths` and a
   * row to the Plugins panel for a plugin with nothing in it.
   *
   * The caller must propagate afterwards. Deleting the source is what makes the
   * copies stale; the reconciler's removal sweep is what actually reaps them
   * from all six targets.
   */
  async uninstall(name: string): Promise<SkillsShUninstallOutcome> {
    const roots = await this.listRoots();
    const owner = roots.find((root) => root.slugs.includes(name));
    if (owner === undefined) {
      return {
        success: false,
        error: `No skills.sh skill named "${name}" is installed.`,
      };
    }

    await fs.rm(path.join(owner.dir, 'skills', name), {
      recursive: true,
      force: true,
    });

    const remaining = owner.slugs.filter((slug) => slug !== name);
    if (remaining.length === 0) {
      await fs.rm(owner.dir, { recursive: true, force: true });
      this.logger.info('[skills.sh] Removed source root', {
        rootId: owner.id,
      });
      return { success: true, rootId: owner.id, removedRoot: true };
    }

    if (owner.metadata !== null) {
      await this.writeMetadata(owner.dir, {
        ...owner.metadata,
        skillIds: remaining,
      });
    }

    this.logger.info('[skills.sh] Removed skill from source root', {
      rootId: owner.id,
      name,
    });
    return { success: true, rootId: owner.id, removedRoot: false };
  }

  // --------------------------------------------------------------------- read

  /** Every skills.sh source root on disk. Never throws. */
  async listRoots(): Promise<SkillsShRoot[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.pluginsBasePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('[skills.sh] Could not read the plugins directory', {
          path: this.pluginsBasePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return [];
    }

    const roots: SkillsShRoot[] = [];
    for (const entry of entries) {
      if (!isSkillsShRootId(entry)) continue;
      const dir = path.join(this.pluginsBasePath, entry);
      const slugs = await this.listSkillSlugs(path.join(dir, 'skills'));
      roots.push({
        id: entry,
        dir,
        metadata: await this.readMetadata(dir),
        slugs,
      });
    }
    return roots;
  }

  /**
   * Every installed skills.sh skill, read from the SOURCE ROOTS.
   *
   * Deliberately not a scan of `.claude/skills` (or `~/.claude/skills`), which
   * is what this used to be. Those directories are now OUTPUTS — a managed copy
   * lands there and is reaped from there, so listing them answered "what did
   * the last reconcile write" rather than "what is installed", and reported a
   * skill from any other source as a skills.sh install.
   *
   * `agents` is deliberately empty. This surface knows what is INSTALLED; which
   * CLIs currently hold a copy is a question about propagation, and
   * `harness:health` / `ptah harness doctor` is the one place that answers it.
   * Re-deriving the target × facet matrix here would be a second copy of a rule
   * `harness-sync` owns.
   */
  async listInstalled(): Promise<InstalledSkill[]> {
    const skills: InstalledSkill[] = [];
    for (const root of await this.listRoots()) {
      for (const slug of root.slugs) {
        const skillDir = path.join(root.dir, 'skills', slug);
        const frontmatter = await this.readFrontmatter(
          path.join(skillDir, 'SKILL.md'),
        );
        skills.push({
          name: slug,
          description: frontmatter.description,
          source: root.metadata?.source ?? slug,
          path: skillDir,
          scope: SKILLS_SH_SCOPE,
          agents: [],
        });
      }
    }
    return skills;
  }

  /** Lowercased slugs of every installed skill — the install-badge lookup. */
  async installedSlugs(): Promise<Set<string>> {
    const slugs = new Set<string>();
    for (const root of await this.listRoots()) {
      for (const slug of root.slugs) slugs.add(slug.toLowerCase());
    }
    return slugs;
  }

  // ---------------------------------------------------------------- migration

  /**
   * Adopt skills a previous Ptah installed into `{ws}/.claude/skills`.
   *
   * Delegated whole to `skills-sh-legacy-adoption.ts`; see that file for what
   * counts as proof and why nothing else does.
   */
  async adoptLegacyInstalls(
    workspaceRoot: string | undefined,
  ): Promise<number> {
    if (workspaceRoot === undefined || workspaceRoot.trim() === '') return 0;
    return adoptLegacySkillsShInstalls({
      workspaceRoot,
      pluginsBasePath: this.pluginsBasePath,
      logger: this.logger,
    });
  }

  // ------------------------------------------------------------------ helpers

  private async makeStagingDir(): Promise<string> {
    const base = path.join(this.homeDir, '.ptah', 'tmp');
    await fs.mkdir(base, { recursive: true });
    return fs.mkdtemp(path.join(base, 'skillssh-'));
  }

  private async discard(dir: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error: unknown) {
      // A scratch directory that outlives the install is litter, not a failure.
      this.logger.debug('[skills.sh] Could not remove the staging directory', {
        dir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * `rename` across devices fails with EXDEV — `~/.ptah` and the OS temp
   * directory are routinely on different volumes on Windows — so fall back to a
   * recursive copy. Both branches end with the source gone.
   */
  private async movePath(from: string, to: string): Promise<void> {
    try {
      await fs.rename(from, to);
      return;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    }
    await fs.cp(from, to, { recursive: true });
    await fs.rm(from, { recursive: true, force: true });
  }

  /** Directories holding a readable `SKILL.md`. Matches the manifest builder. */
  private async listSkillSlugs(skillsDir: string): Promise<string[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(skillsDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const slugs: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        await fs.access(path.join(skillsDir, entry.name, 'SKILL.md'));
      } catch {
        continue;
      }
      slugs.push(entry.name);
    }
    return slugs.sort();
  }

  private async readMetadata(
    rootDir: string,
  ): Promise<SkillsShRootMetadata | null> {
    try {
      const raw = await fs.readFile(
        path.join(rootDir, SKILLS_SH_METADATA_FILE),
        'utf8',
      );
      const parsed = SkillsShRootMetadataSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      // Absent or unreadable reads as "no record", which downgrades `source` in
      // `listInstalled` to the slug and never removes the skill itself.
      return null;
    }
  }

  private async writeMetadata(
    rootDir: string,
    metadata: SkillsShRootMetadata,
  ): Promise<void> {
    await fs.mkdir(rootDir, { recursive: true });
    await fs.writeFile(
      path.join(rootDir, SKILLS_SH_METADATA_FILE),
      `${JSON.stringify(metadata, null, 2)}\n`,
      'utf8',
    );
  }

  private async readFrontmatter(
    skillMdPath: string,
  ): Promise<{ description: string }> {
    try {
      const content = await fs.readFile(skillMdPath, 'utf8');
      const block = content.match(/^---\n([\s\S]*?)\n---/);
      if (block === null) return { description: '' };
      const description = block[1].match(
        /^description:\s*["']?(.+?)["']?\s*$/m,
      );
      return { description: description?.[1]?.trim() ?? '' };
    } catch {
      return { description: '' };
    }
  }
}

/** Re-exported so callers do not need the pure module as a second import. */
export { SKILLS_SH_PLUGIN_PREFIX };
