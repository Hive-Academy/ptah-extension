/**
 * The one writer of skills.sh source roots — `~/.ptah/plugins/ptah-skillssh-*`
 * (global) and `{ws}/.ptah/plugins/ptah-skillssh-*` (workspace, TASK_2026_853
 * D-3).
 *
 * Owns the whole lifecycle of a skills.sh source root — stage, adopt, list,
 * remove, convert workspace → global — and nothing else. It does NOT decide
 * when to propagate: `HarnessPropagationService` is the single entry point
 * every trigger uses, and the trigger here is the RPC handler, so the handler
 * makes that call (the same shape `plugins:install-external` uses). Make
 * global needs a propagation in the MIDDLE of its transaction, so the handler
 * hands it in as a hook ({@link SkillsShMakeGlobalHooks}) rather than this
 * service gaining a second propagation policy.
 *
 * Grouping note: this class is deliberately the ONLY collaborator
 * `SkillsShRpcHandlers` gains for the whole feature. Install, uninstall, list,
 * conversion and the legacy sweep are faces of one question — what is in the
 * source roots — and splitting them across injected services is the
 * `PluginRpcHandlers` constructor-bloat pattern, not a fix for it.
 */

import { inject, injectable } from 'tsyringe';
import { randomBytes } from 'crypto';
import { constants as fsConstants } from 'fs';
import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  SKILLS_SH_OWNER_MARKER,
  SKILLS_SH_RETIRED_FILE,
  isRetiredSkillsShRoot,
  parseSkillsShRetiredRegistry,
  workspacePluginsDir,
  type CapabilityScope,
  type InstalledSkill,
  type SkillsShRetiredRegistry,
} from '@ptah-extension/shared';

import {
  SKILLS_SH_METADATA_FILE,
  SKILLS_SH_NO_WORKSPACE_ERROR,
  SKILLS_SH_OWNER,
  SKILLS_SH_PLUGIN_PREFIX,
  SKILLS_SH_STAGING_PREFIX,
  hashRegularFile,
  hashTree,
  isContainedRelPath,
  isSkillsShRootId,
  readRootMetadata,
  resolveRelPath,
  sameFileHashes,
  skillsShRootId,
  verifyOwnedRoot,
  type SkillsShLocation,
  type SkillsShRootMetadata,
  type SkillsShRootMetadataV2,
  type SkillsShUnprovenReason,
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
  /** Where the root lives. */
  scope: CapabilityScope;
  /** Parsed `.ptah-skillssh.json` (v1 or v2), or `null` when absent/corrupt. */
  metadata: SkillsShRootMetadata | null;
  /** Slugs actually present under `skills/`. */
  slugs: string[];
}

export type SkillsShInstallOutcome =
  | {
      success: true;
      rootId: string;
      rootDir: string;
      scope: CapabilityScope;
      slugs: string[];
    }
  | { success: false; error: string };

export type SkillsShUninstallOutcome =
  | { success: true; rootId: string; removedRoot: boolean }
  | { success: false; error: string };

/** Which propagation Make global is asking for. */
export type SkillsShMakeGlobalPhase =
  /** Step 6: register the new global root (must refresh the user layer). */
  | 'register'
  /** After a rollback: put the workspace back the way it was. */
  | 'rollback'
  /** Step 8: the workspace root was removed; reap its overlay copies. */
  | 'workspace-removed';

/**
 * What Make global needs from its caller. The RPC handler owns propagation
 * and the plugin loader; this service owns the files and the order.
 */
export interface SkillsShMakeGlobalHooks {
  /**
   * Run one propagation. A rejection, or `userLayerRefreshed: false` for the
   * `register` phase, is a failed step 6. Results of the `rollback` and
   * `workspace-removed` phases are logged, never fatal.
   */
  propagate(
    phase: SkillsShMakeGlobalPhase,
  ): Promise<{ userLayerRefreshed: boolean }>;
  /**
   * Step 7: true when the plugin loader's global skills.sh discovery
   * (`discoverSkillsShPluginPaths()`) lists `globalRootDir`.
   */
  isDiscovered(globalRootDir: string): boolean | Promise<boolean>;
}

export type SkillsShMakeGlobalFailureCode =
  | 'no-workspace'
  | 'not-installed'
  | 'workspace-root-unproven'
  | 'global-collision'
  | 'staging-failed'
  | 'metadata-write-failed'
  | 'commit-failed'
  | 'registration-failed'
  | 'propagation-failed'
  | 'validation-failed';

export type SkillsShMakeGlobalOutcome =
  | {
      success: true;
      rootId: string;
      globalRootDir: string;
      /** Every slug the converted root holds. */
      convertedSkills: string[];
      /** True when an owned global root from an earlier attempt was reused. */
      resumed: boolean;
      /**
       * False when step 8 did not remove the workspace root. The conversion
       * is still done; the next Make global retries only the removal.
       */
      workspaceRootRemoved: boolean;
    }
  | {
      success: false;
      code: SkillsShMakeGlobalFailureCode;
      /** Fixed user-facing copy (design spec). Host error text never. */
      error: string;
      rootId?: string;
      /** For `workspace-root-unproven` / `global-collision`. */
      reason?: SkillsShUnprovenReason;
      /**
       * Steps 6–7 only: false when the just-written global root could not be
       * removed again. It is left owned and complete, so the next call
       * resumes at step 6. The workspace install is intact either way.
       */
      rollbackComplete?: boolean;
    };

/** Fixed copy for every Make global failure (design spec). */
export function makeGlobalFailureCopy(name: string): string {
  return `Could not change where ${name} is installed.`;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

@injectable()
export class SkillsShSourceRootService {
  private readonly homeDir: string;

  /**
   * Make global calls run one at a time. Two overlapping conversions of the
   * same root would race on the staging/rename/remove order this service
   * exists to keep.
   */
  private conversionTail: Promise<void> = Promise.resolve();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    /**
     * Override for the home directory every global path here is built from.
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

  /** `~/.ptah/plugins/<rootId>`. */
  globalRootDir(rootId: string): string {
    return path.join(this.pluginsBasePath, rootId);
  }

  /**
   * `workspacePluginsDir(ws)/<rootId>`, or `null` when no workspace is open —
   * the caller must then refuse rather than invent a path.
   */
  workspaceRootDir(
    workspaceRoot: string | null | undefined,
    rootId: string,
  ): string | null {
    const base = workspacePluginsDir(workspaceRoot);
    return base === null ? null : path.join(base, rootId);
  }

  private rootDirFor(
    location: SkillsShLocation,
    rootId: string,
  ): string | null {
    return location.scope === 'global'
      ? this.globalRootDir(rootId)
      : this.workspaceRootDir(location.workspaceRoot, rootId);
  }

  // ------------------------------------------------------------------ install

  /**
   * Install one skills.sh source (optionally one skill within it) into its
   * source root, global or in one workspace.
   *
   * The sequence is stage → verify → hash → move → record, and the order
   * matters. The third-party CLI runs in a scratch directory under
   * `~/.ptah/tmp` that nothing reads (never under `{ws}/.ptah/plugins`, where a
   * `ptah-skillssh-*` directory would count as an active root), so a partial
   * or failed fetch never leaves half a skill in a place the reconciler would
   * then propagate. Only a run that produced at least one readable slug
   * reaches the source root.
   *
   * The v2 metadata (D-D8) hashes the staged bytes — exactly what Ptah moves
   * into the root — before the metadata write. Files a previous Ptah install
   * wrote keep their recorded hash; files with no Ptah record (a v1 root, a
   * user's addition) are deliberately left unlisted, so the root stays
   * unproven instead of Ptah claiming bytes it did not write.
   *
   * Re-installing the same source is an UPDATE: each staged slug replaces its
   * counterpart, and the metadata's slug list becomes the union. A slug the
   * user removed upstream is left alone rather than reaped, because a
   * single-skill install (`--skill x`) must not delete the other nine skills a
   * previous whole-repo install of the same source wrote.
   *
   * A global install over a retired root id clears that id from the retired
   * registry after the write, so the root is active again.
   */
  async install(
    request: SkillInstallRequest,
    location: SkillsShLocation = { scope: 'global' },
  ): Promise<SkillsShInstallOutcome> {
    const rootId = skillsShRootId(request.source);
    if (rootId === null) {
      return {
        success: false,
        error: `Invalid source format: "${request.source}". Expected "owner/repo".`,
      };
    }
    const rootDir = this.rootDirFor(location, rootId);
    if (rootDir === null) {
      return { success: false, error: SKILLS_SH_NO_WORKSPACE_ERROR };
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

      const writtenHashes: Record<string, string> = {};
      for (const slug of slugs) {
        const hashed = await hashTree(
          path.join(stagedSkillsDir, slug),
          `skills/${slug}/`,
        );
        Object.assign(writtenHashes, hashed.files);
      }

      const targetSkillsDir = path.join(rootDir, 'skills');
      await fs.mkdir(targetSkillsDir, { recursive: true });
      for (const slug of slugs) {
        const target = path.join(targetSkillsDir, slug);
        await fs.rm(target, { recursive: true, force: true });
        await this.movePath(path.join(stagedSkillsDir, slug), target);
      }

      const existing = await this.readMetadata(rootDir);
      const replaced = slugs.map((slug) => `skills/${slug}/`);
      const carried: Record<string, string> = {};
      if (existing?.version === 2) {
        for (const [rel, hash] of Object.entries(existing.files)) {
          if (!isContainedRelPath(rel)) continue;
          if (replaced.some((prefix) => rel.startsWith(prefix))) continue;
          carried[rel] = hash;
        }
      }
      await this.writeMetadata(rootDir, {
        version: 2,
        owner: SKILLS_SH_OWNER,
        ownerMarker: SKILLS_SH_OWNER_MARKER,
        source: request.source,
        skillIds: [
          ...new Set([...(existing?.skillIds ?? []), ...slugs]),
        ].sort(),
        installedAt: new Date().toISOString(),
        scope: location.scope,
        files: { ...carried, ...writtenHashes },
      });

      if (location.scope === 'global') {
        try {
          await this.clearRetired(rootId);
        } catch (error: unknown) {
          this.logger.error(
            '[skills.sh] Installed, but could not clear the retired mark',
            toError(error),
          );
          return {
            success: false,
            error:
              'The skill was written but Ptah could not re-enable it. Install it again to retry.',
          };
        }
      }

      this.logger.info('[skills.sh] Installed into source root', {
        rootId,
        scope: location.scope,
        slugs,
      });
      return { success: true, rootId, rootDir, scope: location.scope, slugs };
    } finally {
      await this.discard(stagingDir);
    }
  }

  // ---------------------------------------------------------------- uninstall

  /**
   * Remove one skill slug from whichever root at `location` holds it.
   *
   * Removing the LAST slug removes the root as well. That is not tidiness: an
   * empty root would keep contributing an entry to `overlayPluginPaths` and a
   * row to the Plugins panel for a plugin with nothing in it.
   *
   * The caller must propagate afterwards. Deleting the source is what makes the
   * copies stale; the reconciler's removal sweep is what actually reaps them
   * from all six targets.
   */
  async uninstall(
    name: string,
    location: SkillsShLocation = { scope: 'global' },
  ): Promise<SkillsShUninstallOutcome> {
    const roots = await this.listRootsAt(location);
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
      await this.removeRootDir(owner.dir);
      this.logger.info('[skills.sh] Removed source root', {
        rootId: owner.id,
        scope: owner.scope,
      });
      return { success: true, rootId: owner.id, removedRoot: true };
    }

    if (owner.metadata !== null) {
      await this.writeMetadata(
        owner.dir,
        owner.metadata.version === 2
          ? {
              ...owner.metadata,
              skillIds: remaining,
              files: Object.fromEntries(
                Object.entries(owner.metadata.files).filter(
                  ([rel]) => !rel.startsWith(`skills/${name}/`),
                ),
              ),
            }
          : { ...owner.metadata, skillIds: remaining },
      );
    }

    this.logger.info('[skills.sh] Removed skill from source root', {
      rootId: owner.id,
      scope: owner.scope,
      name,
    });
    return { success: true, rootId: owner.id, removedRoot: false };
  }

  // ------------------------------------------------------------- make global

  /**
   * Convert the workspace root holding skill `name` into a global root
   * (D-D9). The whole root moves, every slug in it.
   *
   * The workspace root stays the source of truth until the very last step:
   *
   *   1. `verifyOwnedRoot(workspaceRoot)`; unproven → refuse, nothing written.
   *      An existing global root with the same id is a resumed attempt only
   *      when it is owned, global and lists identical hashes (→ step 6);
   *      anything else there → refuse, nothing written.
   *   2. copy every listed file into `~/.ptah/plugins/.staging-ptah-skillssh-*`;
   *   3. verify every staged file against the workspace root's hashes;
   *   4. write global v2 metadata (same `files`) into staging;
   *   5. atomic rename staging → `~/.ptah/plugins/<rootId>`;
   *   6. clear the id from the retired registry, then propagate — a rejection
   *      or an unrefreshed user layer is a failure;
   *   7. validate: the global root is owned, global, has identical hashes,
   *      and the plugin loader discovers it;
   *   8. only then remove the workspace root (re-proven first) and
   *      re-propagate.
   *
   * Steps 2–5 failing discard staging. Steps 6–7 failing remove the global
   * root again (only while it is still provably this conversion's), restore
   * the retired entry and re-propagate. Step 8 failing reports success with
   * `workspaceRootRemoved: false`; the next call resumes and retries only the
   * removal.
   */
  makeGlobal(
    name: string,
    workspaceRoot: string | null | undefined,
    hooks: SkillsShMakeGlobalHooks,
  ): Promise<SkillsShMakeGlobalOutcome> {
    const run = this.conversionTail.then(() =>
      this.runMakeGlobal(name, workspaceRoot, hooks),
    );
    // The queue only orders calls; each caller observes its own result above.
    this.conversionTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async runMakeGlobal(
    name: string,
    workspaceRoot: string | null | undefined,
    hooks: SkillsShMakeGlobalHooks,
  ): Promise<SkillsShMakeGlobalOutcome> {
    const fail = (
      code: SkillsShMakeGlobalFailureCode,
      extra: Partial<
        Extract<SkillsShMakeGlobalOutcome, { success: false }>
      > = {},
    ): SkillsShMakeGlobalOutcome => ({
      success: false,
      code,
      error: makeGlobalFailureCopy(name),
      ...extra,
    });

    if (workspacePluginsDir(workspaceRoot) === null) {
      return fail('no-workspace');
    }
    const workspaceRoots = await this.listRootsAt({
      scope: 'workspace',
      workspaceRoot,
    });
    const source = workspaceRoots.find((root) => root.slugs.includes(name));
    if (source === undefined) return fail('not-installed');
    const rootId = source.id;

    // Step 1.
    const sourceProof = await verifyOwnedRoot(source.dir);
    if (sourceProof.status !== 'owned') {
      this.logger.warn(
        '[skills.sh] Make global refused: workspace root unproven',
        {
          rootId,
          reason: sourceProof.reason,
          path: sourceProof.path,
        },
      );
      return fail('workspace-root-unproven', {
        rootId,
        reason: sourceProof.reason,
      });
    }
    const files = sourceProof.metadata.files;
    const globalDir = this.globalRootDir(rootId);

    const existingGlobal = await verifyOwnedRoot(globalDir);
    let resumed = false;
    if (existingGlobal.status === 'owned') {
      if (
        existingGlobal.metadata.scope !== 'global' ||
        !sameFileHashes(existingGlobal.metadata.files, files)
      ) {
        this.logger.warn(
          '[skills.sh] Make global refused: a different global install exists',
          {
            rootId,
          },
        );
        return fail('global-collision', { rootId });
      }
      resumed = true;
    } else if (existingGlobal.reason !== 'root-missing') {
      this.logger.warn(
        '[skills.sh] Make global refused: a different global install exists',
        {
          rootId,
          reason: existingGlobal.reason,
        },
      );
      return fail('global-collision', {
        rootId,
        reason: existingGlobal.reason,
      });
    }

    if (!resumed) {
      const staged = await this.stageGlobalCopy(
        source.dir,
        globalDir,
        sourceProof.metadata,
      );
      if (staged !== 'ok') return fail(staged, { rootId });
    }

    // Step 6.
    let clearedEntry: SkillsShRetiredRegistry['roots'][string] | null = null;
    try {
      clearedEntry = await this.clearRetired(rootId);
    } catch (error: unknown) {
      this.logger.error(
        '[skills.sh] Make global: could not clear the retired mark',
        toError(error),
      );
      const rollbackComplete = await this.rollbackGlobal(
        rootId,
        globalDir,
        files,
        null,
        hooks,
      );
      return fail('registration-failed', { rootId, rollbackComplete });
    }

    let registered = false;
    try {
      registered = (await hooks.propagate('register')).userLayerRefreshed;
      if (!registered) {
        this.logger.warn(
          '[skills.sh] Make global: propagation left the user layer unrefreshed',
          { rootId },
        );
      }
    } catch (error: unknown) {
      this.logger.error(
        '[skills.sh] Make global: propagation failed',
        toError(error),
      );
    }
    if (!registered) {
      const rollbackComplete = await this.rollbackGlobal(
        rootId,
        globalDir,
        files,
        clearedEntry,
        hooks,
      );
      return fail('propagation-failed', { rootId, rollbackComplete });
    }

    // Step 7.
    const validation = await this.validateGlobal(globalDir, files, hooks);
    if (validation !== null) {
      this.logger.error('[skills.sh] Make global: validation failed', {
        rootId,
        problem: validation,
      });
      const rollbackComplete = await this.rollbackGlobal(
        rootId,
        globalDir,
        files,
        clearedEntry,
        hooks,
      );
      return fail('validation-failed', { rootId, rollbackComplete });
    }

    // Step 8. Re-prove the workspace root: an edit made since step 1 is the
    // user's work and is never removed.
    let workspaceRootRemoved = false;
    const finalProof = await verifyOwnedRoot(source.dir);
    if (
      finalProof.status === 'owned' &&
      sameFileHashes(finalProof.metadata.files, files)
    ) {
      try {
        await this.removeRootDir(source.dir);
        workspaceRootRemoved = true;
      } catch (error: unknown) {
        this.logger.error(
          '[skills.sh] Make global: converted, but the workspace root could not be removed; the next Make global retries the removal',
          toError(error),
        );
      }
    } else {
      this.logger.warn(
        '[skills.sh] Make global: workspace root changed during conversion; kept',
        {
          rootId,
          reason:
            finalProof.status === 'unproven'
              ? finalProof.reason
              : 'files-changed',
        },
      );
    }
    if (workspaceRootRemoved) {
      await this.propagateQuietly(hooks, 'workspace-removed', rootId);
    }

    this.logger.info('[skills.sh] Made global', {
      rootId,
      resumed,
      workspaceRootRemoved,
    });
    return {
      success: true,
      rootId,
      globalRootDir: globalDir,
      convertedSkills: [...sourceProof.metadata.skillIds].sort(),
      resumed,
      workspaceRootRemoved,
    };
  }

  /**
   * Steps 2–5. Any failure discards the staging directory; neither the
   * workspace root nor the global base is changed.
   */
  private async stageGlobalCopy(
    sourceDir: string,
    globalDir: string,
    sourceMetadata: SkillsShRootMetadataV2,
  ): Promise<
    'ok' | 'staging-failed' | 'metadata-write-failed' | 'commit-failed'
  > {
    let stagingDir: string;
    try {
      await fs.mkdir(this.pluginsBasePath, { recursive: true });
      stagingDir = path.join(
        this.pluginsBasePath,
        `${SKILLS_SH_STAGING_PREFIX}${path.basename(globalDir)}-${randomBytes(6).toString('hex')}`,
      );
      await fs.mkdir(stagingDir);
    } catch (error: unknown) {
      this.logger.error(
        '[skills.sh] Make global: could not create the staging directory',
        toError(error),
      );
      return 'staging-failed';
    }

    try {
      // Steps 2–3.
      for (const [rel, hash] of Object.entries(sourceMetadata.files)) {
        const target = resolveRelPath(stagingDir, rel);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(
          resolveRelPath(sourceDir, rel),
          target,
          fsConstants.COPYFILE_EXCL,
        );
        if ((await hashRegularFile(target)) !== hash) {
          throw new Error(`Staged file does not match its hash: ${rel}`);
        }
      }
    } catch (error: unknown) {
      this.logger.error(
        '[skills.sh] Make global: staging copy failed',
        toError(error),
      );
      await this.discard(stagingDir);
      return 'staging-failed';
    }

    try {
      // Step 4.
      await this.writeMetadata(stagingDir, {
        ...sourceMetadata,
        scope: 'global',
        installedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      this.logger.error(
        '[skills.sh] Make global: global metadata write failed',
        toError(error),
      );
      await this.discard(stagingDir);
      return 'metadata-write-failed';
    }

    try {
      // Step 5.
      await this.commitStagedRoot(stagingDir, globalDir);
    } catch (error: unknown) {
      this.logger.error(
        '[skills.sh] Make global: could not move the staged root into place',
        toError(error),
      );
      await this.discard(stagingDir);
      return 'commit-failed';
    }
    return 'ok';
  }

  /** Step 7. `null` when valid, else what failed. */
  private async validateGlobal(
    globalDir: string,
    files: Readonly<Record<string, string>>,
    hooks: SkillsShMakeGlobalHooks,
  ): Promise<string | null> {
    const proof = await verifyOwnedRoot(globalDir);
    if (proof.status !== 'owned') return `unproven: ${proof.reason}`;
    if (proof.metadata.scope !== 'global') return 'scope is not global';
    if (!sameFileHashes(proof.metadata.files, files)) return 'files differ';
    try {
      if (!(await hooks.isDiscovered(globalDir))) {
        return 'not discovered by the plugin loader';
      }
    } catch (error: unknown) {
      return `discovery check failed: ${toError(error).message}`;
    }
    return null;
  }

  /**
   * Undo steps 5–6. The global root is removed only while it is still owned
   * and lists exactly the converted hashes — i.e. still this conversion's
   * output. Returns true when the global root is gone.
   */
  private async rollbackGlobal(
    rootId: string,
    globalDir: string,
    files: Readonly<Record<string, string>>,
    clearedEntry: SkillsShRetiredRegistry['roots'][string] | null,
    hooks: SkillsShMakeGlobalHooks,
  ): Promise<boolean> {
    let removed = false;
    const proof = await verifyOwnedRoot(globalDir);
    if (
      proof.status === 'owned' &&
      sameFileHashes(proof.metadata.files, files)
    ) {
      try {
        await this.removeRootDir(globalDir);
        removed = true;
      } catch (error: unknown) {
        this.logger.error(
          '[skills.sh] Make global rollback: could not remove the global root; the next Make global resumes from it',
          toError(error),
        );
      }
    } else if (proof.status === 'unproven' && proof.reason === 'root-missing') {
      removed = true;
    } else {
      this.logger.warn(
        '[skills.sh] Make global rollback: global root no longer matches; kept',
        { rootId },
      );
    }

    if (clearedEntry !== null) {
      try {
        await this.restoreRetired(rootId, clearedEntry);
      } catch (error: unknown) {
        this.logger.error(
          '[skills.sh] Make global rollback: could not restore the retired mark',
          toError(error),
        );
      }
    }
    await this.propagateQuietly(hooks, 'rollback', rootId);
    return removed;
  }

  private async propagateQuietly(
    hooks: SkillsShMakeGlobalHooks,
    phase: SkillsShMakeGlobalPhase,
    rootId: string,
  ): Promise<void> {
    try {
      await hooks.propagate(phase);
    } catch (error: unknown) {
      // Reported, not fatal: the files are already in their final state and
      // the next activation reconciles them.
      this.logger.error(
        `[skills.sh] Make global: ${phase} propagation failed for ${rootId}`,
        toError(error),
      );
    }
  }

  // --------------------------------------------------------------------- read

  /**
   * Every skills.sh source root on disk: the global ones, plus the roots of
   * `workspaceRoot` when given. Never throws.
   */
  async listRoots(workspaceRoot?: string | null): Promise<SkillsShRoot[]> {
    const roots = await this.listRootsAt({ scope: 'global' });
    if (workspacePluginsDir(workspaceRoot) !== null) {
      roots.push(
        ...(await this.listRootsAt({ scope: 'workspace', workspaceRoot })),
      );
    }
    return roots;
  }

  private async listRootsAt(
    location: SkillsShLocation,
  ): Promise<SkillsShRoot[]> {
    const baseDir =
      location.scope === 'global'
        ? this.pluginsBasePath
        : workspacePluginsDir(location.workspaceRoot);
    if (baseDir === null) return [];

    let entries: string[];
    try {
      entries = await fs.readdir(baseDir);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - the plugins base directory is
      // created on demand; an empty list means no skills.sh source roots are
      // installed, which the method's contract already promises.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('[skills.sh] Could not read the plugins directory', {
          path: baseDir,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return [];
    }

    const roots: SkillsShRoot[] = [];
    for (const entry of entries) {
      if (!isSkillsShRootId(entry)) continue;
      const dir = path.join(baseDir, entry);
      const slugs = await this.listSkillSlugs(path.join(dir, 'skills'));
      roots.push({
        id: entry,
        dir,
        scope: location.scope,
        metadata: await this.readMetadata(dir),
        slugs,
      });
    }
    return roots;
  }

  /**
   * Every installed skills.sh skill, read from the SOURCE ROOTS — the global
   * ones plus `workspaceRoot`'s — each with its scope.
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
  async listInstalled(
    workspaceRoot?: string | null,
  ): Promise<InstalledSkill[]> {
    const skills: InstalledSkill[] = [];
    for (const root of await this.listRoots(workspaceRoot)) {
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
          scope: root.scope,
          agents: [],
        });
      }
    }
    return skills;
  }

  /** Lowercased slugs of every installed skill — the install-badge lookup. */
  async installedSlugs(workspaceRoot?: string | null): Promise<Set<string>> {
    const slugs = new Set<string>();
    for (const root of await this.listRoots(workspaceRoot)) {
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

  // ------------------------------------------------------- filesystem steps
  //
  // The three writes a Make global step can fail on, kept as protected methods
  // so the failure-path spec can make exactly one of them fail without mocking
  // the filesystem module.

  /**
   * Write a root's metadata. Written to a temporary sibling and renamed, so a
   * failed write never leaves a half-written record that still parses.
   */
  protected async writeMetadata(
    rootDir: string,
    metadata: SkillsShRootMetadata,
  ): Promise<void> {
    await fs.mkdir(rootDir, { recursive: true });
    await this.writeJsonAtomic(
      path.join(rootDir, SKILLS_SH_METADATA_FILE),
      metadata,
    );
  }

  /** Step 5: move a fully staged root into place. Same volume by design. */
  protected async commitStagedRoot(
    stagingDir: string,
    targetDir: string,
  ): Promise<void> {
    await fs.rename(stagingDir, targetDir);
  }

  /** Remove a whole root directory. */
  protected async removeRootDir(dir: string): Promise<void> {
    await fs.rm(dir, { recursive: true, force: true });
  }

  // --------------------------------------------------------- retired registry

  private get retiredRegistryPath(): string {
    return path.join(this.pluginsBasePath, SKILLS_SH_RETIRED_FILE);
  }

  /**
   * The registry, or `null` when it is absent or malformed — both of which
   * retire nothing (D-2). A read error other than ENOENT throws.
   */
  private async readRetiredRegistry(): Promise<SkillsShRetiredRegistry | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.retiredRegistryPath, 'utf8');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    try {
      return parseSkillsShRetiredRegistry(JSON.parse(raw));
    } catch (error: unknown) {
      // degradation-audit: optional-capability - a malformed registry retires
      // nothing by contract (D-2), so there is no retired mark to clear.
      this.logger.warn('[skills.sh] Retired registry is not valid JSON', {
        path: this.retiredRegistryPath,
        error: toError(error).message,
      });
      return null;
    }
  }

  /**
   * Remove `rootId` from the retired registry. Returns the removed entry (so
   * a rollback can put it back), or `null` when it was not retired.
   */
  private async clearRetired(
    rootId: string,
  ): Promise<SkillsShRetiredRegistry['roots'][string] | null> {
    const registry = await this.readRetiredRegistry();
    if (registry === null || !isRetiredSkillsShRoot(rootId, registry)) {
      return null;
    }
    const entry = registry.roots[rootId];
    const roots = { ...registry.roots };
    delete roots[rootId];
    await this.writeJsonAtomic(this.retiredRegistryPath, {
      version: 1,
      roots,
    } satisfies SkillsShRetiredRegistry);
    this.logger.info('[skills.sh] Cleared retired mark', { rootId });
    return entry;
  }

  /** Put a cleared entry back (Make global rollback). */
  private async restoreRetired(
    rootId: string,
    entry: SkillsShRetiredRegistry['roots'][string],
  ): Promise<void> {
    const registry = await this.readRetiredRegistry();
    await this.writeJsonAtomic(this.retiredRegistryPath, {
      version: 1,
      roots: { ...(registry?.roots ?? {}), [rootId]: entry },
    } satisfies SkillsShRetiredRegistry);
  }

  // ------------------------------------------------------------------ helpers

  private async writeJsonAtomic(
    filePath: string,
    value: unknown,
  ): Promise<void> {
    const tempPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      await fs.rename(tempPath, filePath);
    } catch (error: unknown) {
      await fs.rm(tempPath, { force: true }).catch((cleanupError: unknown) => {
        this.logger.debug('[skills.sh] Could not remove a temporary file', {
          tempPath,
          error: toError(cleanupError).message,
        });
      });
      throw error;
    }
  }

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
   * `rename` across devices fails with EXDEV — `~/.ptah` and a workspace are
   * routinely on different volumes — so fall back to a recursive copy. Both
   * branches end with the source gone.
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
      // degradation-audit: optional-capability - an absent skills directory is
      // an ordinary source-root layout; an empty list contributes no slugs.
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

  /**
   * The root's metadata, v1 or v2, or `null` when absent, corrupt or
   * unreadable. `null` downgrades `source` in `listInstalled` to the slug and
   * never removes the skill itself; ownership is a separate, stricter question
   * answered only by `verifyOwnedRoot`.
   */
  private async readMetadata(
    rootDir: string,
  ): Promise<SkillsShRootMetadata | null> {
    try {
      const read = await readRootMetadata(rootDir);
      return read.status === 'ok' ? read.metadata : null;
    } catch {
      // degradation-audit: optional-capability - the root metadata file is
      // optional provenance; null downgrades `source` to the slug and never
      // removes the skill itself.
      return null;
    }
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
