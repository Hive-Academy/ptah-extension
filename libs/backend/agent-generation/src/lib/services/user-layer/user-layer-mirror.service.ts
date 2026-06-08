import { injectable, inject } from 'tsyringe';
import { homedir } from 'os';
import { join, resolve, sep, basename, dirname } from 'path';
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rename,
  stat,
  lstat,
  unlink,
} from 'fs/promises';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import type { OriginKind, OriginSidecar } from './origin-sidecar.types';
import {
  DEFAULT_HISTORY_DIR,
  ORIGIN_SIDECAR_FILENAME,
} from './origin-sidecar.types';
import {
  computeSourceHash,
  writeSidecarAtomic,
  writeSidecarAtomicAt,
  readSidecar,
  readSidecarAt,
  isErrnoCode,
} from './source-hash';
import type { CollectFilesResult } from './source-hash';

const ORIGIN_SIDECAR_SUFFIX = '.ptah-origin.json';

export interface UserLayerRoots {
  skills: string;
  agents: string;
  commands: string;
}

export interface MirrorSources {
  pluginPaths: string[];
  synthesizedSkillsRoot: string;
  agentSourceDir?: string;
}

export interface MirrorResult {
  skillsMirrored: number;
  agentsMirrored: number;
  commandsMirrored: number;
  skipped: number;
  conflicts: number;
  errors: number;
}

export interface CloneEntry {
  slug: string;
  kind: OriginKind;
  pluginId: string | null;
  sourceHash: string;
  diverged: boolean;
  lastEnhancedAt: number | null;
}

const MAX_COPY_RECURSION_DEPTH = 20;
const SYNTH_CANDIDATES_DIR = '_candidates';

@injectable()
export class UserLayerMirrorService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  getUserLayerRoots(): UserLayerRoots {
    const base = join(homedir(), '.ptah', 'user');
    return {
      skills: join(base, 'skills'),
      agents: join(base, 'agents'),
      commands: join(base, 'commands'),
    };
  }

  async mirrorAll(sources: MirrorSources): Promise<MirrorResult> {
    const result: MirrorResult = {
      skillsMirrored: 0,
      agentsMirrored: 0,
      commandsMirrored: 0,
      skipped: 0,
      conflicts: 0,
      errors: 0,
    };
    const roots = this.getUserLayerRoots();
    const seenSkillSlugs = new Map<string, string>();

    for (const pluginPath of sources.pluginPaths) {
      const pluginId = basename(pluginPath);
      await this.mirrorPluginSkills(
        pluginPath,
        pluginId,
        roots.skills,
        seenSkillSlugs,
        result,
      );
      await this.mirrorPluginCommands(pluginPath, roots.commands, result);
    }

    await this.mirrorSynthesizedSkills(
      sources.synthesizedSkillsRoot,
      roots.skills,
      seenSkillSlugs,
      result,
    );

    if (sources.agentSourceDir) {
      await this.mirrorAgents(sources.agentSourceDir, roots.agents, result);
    }

    this.logger.info('[UserLayerMirror] mirrorAll complete', {
      ...result,
    });
    return result;
  }

  async listClones(): Promise<CloneEntry[]> {
    const roots = this.getUserLayerRoots();
    const entries: CloneEntry[] = [];
    const scanRoots: string[] = [roots.skills, roots.agents, roots.commands];

    for (const root of scanRoots) {
      let dirEntries: string[];
      try {
        dirEntries = await readdir(root);
      } catch (error: unknown) {
        if (this.isEnoent(error)) {
          continue;
        }
        throw error;
      }

      for (const name of dirEntries) {
        if (name === ORIGIN_SIDECAR_FILENAME) {
          continue;
        }
        const entryPath = join(root, name);
        let entryStat;
        try {
          entryStat = await stat(entryPath);
        } catch {
          continue;
        }

        let sidecar: OriginSidecar | null = null;
        if (entryStat.isDirectory()) {
          sidecar = await readSidecar(entryPath);
        } else if (name.endsWith(ORIGIN_SIDECAR_SUFFIX)) {
          sidecar = await readSidecarAt(entryPath);
        }

        if (!sidecar) {
          continue;
        }
        entries.push({
          slug: sidecar.slug,
          kind: sidecar.kind,
          pluginId: sidecar.pluginId,
          sourceHash: sidecar.sourceHash,
          diverged: sidecar.diverged,
          lastEnhancedAt: sidecar.lastEnhancedAt,
        });
      }
    }
    return entries;
  }

  private async mirrorPluginSkills(
    pluginPath: string,
    pluginId: string,
    skillsRoot: string,
    seenSkillSlugs: Map<string, string>,
    result: MirrorResult,
  ): Promise<void> {
    const sourceSkillsDir = join(pluginPath, 'skills');
    let slugs: string[];
    try {
      slugs = await this.listSubdirectories(sourceSkillsDir);
    } catch (error: unknown) {
      if (this.isEnoent(error)) {
        return;
      }
      result.errors += 1;
      this.logger.warn('[UserLayerMirror] failed to read plugin skills', {
        sourceSkillsDir,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const slug of slugs) {
      await this.mirrorSkillSlug(
        join(sourceSkillsDir, slug),
        slug,
        pluginId,
        skillsRoot,
        seenSkillSlugs,
        result,
      );
    }
  }

  private async mirrorSynthesizedSkills(
    synthesizedSkillsRoot: string,
    skillsRoot: string,
    seenSkillSlugs: Map<string, string>,
    result: MirrorResult,
  ): Promise<void> {
    let slugs: string[];
    try {
      slugs = await this.listSubdirectories(synthesizedSkillsRoot);
    } catch (error: unknown) {
      if (this.isEnoent(error)) {
        return;
      }
      result.errors += 1;
      this.logger.warn('[UserLayerMirror] failed to read synth skills', {
        synthesizedSkillsRoot,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const slug of slugs) {
      if (slug === SYNTH_CANDIDATES_DIR) {
        continue;
      }
      await this.mirrorSkillSlug(
        join(synthesizedSkillsRoot, slug),
        slug,
        null,
        skillsRoot,
        seenSkillSlugs,
        result,
      );
    }
  }

  private async mirrorSkillSlug(
    sourceDir: string,
    slug: string,
    pluginId: string | null,
    skillsRoot: string,
    seenSkillSlugs: Map<string, string>,
    result: MirrorResult,
  ): Promise<void> {
    const targetDir = join(skillsRoot, slug);
    this.assertUnderUserLayer(targetDir);

    if (seenSkillSlugs.has(slug)) {
      const ownerSource = seenSkillSlugs.get(slug) as string;
      await this.recordConflict(targetDir, ownerSource, sourceDir);
      result.conflicts += 1;
      this.logger.warn('[UserLayerMirror] slug collision; first-write wins', {
        slug,
        owner: ownerSource,
        loser: sourceDir,
      });
      return;
    }

    if (await this.dirExists(targetDir)) {
      const existingSidecar = await readSidecar(targetDir);
      if (!existingSidecar) {
        await this.reconcileMissingSidecar(targetDir, sourceDir, {
          kind: 'skill',
          slug,
          pluginId,
        });
      }
      seenSkillSlugs.set(slug, sourceDir);
      result.skipped += 1;
      return;
    }

    try {
      await this.copyTree(sourceDir, targetDir);
      const hashSignal: CollectFilesResult = { truncatedAtDepth: false };
      const sourceHash = await computeSourceHash(sourceDir, hashSignal);
      if (hashSignal.truncatedAtDepth) {
        this.logger.warn(
          '[UserLayerMirror] source hash truncated at recursion depth; skill tree too deep',
          { slug, sourceDir },
        );
      }
      await this.writeOriginSidecar(targetDir, {
        kind: 'skill',
        slug,
        pluginId,
        sourceHash,
      });
      seenSkillSlugs.set(slug, sourceDir);
      result.skillsMirrored += 1;
    } catch (error: unknown) {
      result.errors += 1;
      this.logger.warn('[UserLayerMirror] failed to mirror skill', {
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async reconcileMissingSidecar(
    targetDir: string,
    sourceDir: string,
    base: { kind: OriginKind; slug: string; pluginId: string | null },
  ): Promise<void> {
    try {
      const sourceHash = await computeSourceHash(targetDir);
      await this.writeOriginSidecar(targetDir, {
        kind: base.kind,
        slug: base.slug,
        pluginId: base.pluginId,
        sourceHash,
      });
    } catch (error: unknown) {
      this.logger.warn(
        '[UserLayerMirror] failed to reconcile missing sidecar',
        {
          slug: base.slug,
          sourceDir,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  private async mirrorPluginCommands(
    pluginPath: string,
    commandsRoot: string,
    result: MirrorResult,
  ): Promise<void> {
    const sourceCommandsDir = join(pluginPath, 'commands');
    let files: string[];
    try {
      files = (await readdir(sourceCommandsDir, { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name);
    } catch (error: unknown) {
      if (this.isEnoent(error)) {
        return;
      }
      result.errors += 1;
      this.logger.warn('[UserLayerMirror] failed to read plugin commands', {
        sourceCommandsDir,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const fileName of files) {
      const slug = fileName.replace(/\.md$/, '');
      const sourceFile = join(sourceCommandsDir, fileName);
      const targetFile = join(commandsRoot, fileName);
      this.assertUnderUserLayer(targetFile);

      if (await this.fileExists(targetFile)) {
        await this.reconcileMissingFileSidecar(commandsRoot, targetFile, slug, {
          kind: 'command',
          slug,
          pluginId: basename(pluginPath),
        });
        result.skipped += 1;
        continue;
      }

      try {
        await mkdir(commandsRoot, { recursive: true });
        await this.copyFileAtomic(sourceFile, targetFile);
        const sourceHash = await computeSourceHash(sourceFile);
        await this.writeFileSidecar(commandsRoot, slug, {
          kind: 'command',
          slug,
          pluginId: basename(pluginPath),
          sourceHash,
        });
        result.commandsMirrored += 1;
      } catch (error: unknown) {
        result.errors += 1;
        this.logger.warn('[UserLayerMirror] failed to mirror command', {
          slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async mirrorAgents(
    agentSourceDir: string,
    agentsRoot: string,
    result: MirrorResult,
  ): Promise<void> {
    let files: string[];
    try {
      files = (await readdir(agentSourceDir, { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name);
    } catch (error: unknown) {
      if (this.isEnoent(error)) {
        return;
      }
      result.errors += 1;
      this.logger.warn('[UserLayerMirror] failed to read agent source', {
        agentSourceDir,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const fileName of files) {
      const slug = fileName.replace(/\.md$/, '');
      const sourceFile = join(agentSourceDir, fileName);
      const targetFile = join(agentsRoot, fileName);
      this.assertUnderUserLayer(targetFile);

      if (await this.fileExists(targetFile)) {
        await this.reconcileMissingFileSidecar(agentsRoot, targetFile, slug, {
          kind: 'agent',
          slug,
          pluginId: null,
        });
        result.skipped += 1;
        continue;
      }

      try {
        await mkdir(agentsRoot, { recursive: true });
        await this.copyFileAtomic(sourceFile, targetFile);
        const sourceHash = await computeSourceHash(sourceFile);
        await this.writeFileSidecar(agentsRoot, slug, {
          kind: 'agent',
          slug,
          pluginId: null,
          sourceHash,
        });
        result.agentsMirrored += 1;
      } catch (error: unknown) {
        result.errors += 1;
        this.logger.warn('[UserLayerMirror] failed to mirror agent', {
          slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async recordConflict(
    targetDir: string,
    ownerSource: string,
    loserSource: string,
  ): Promise<void> {
    const sidecar = await readSidecar(targetDir);
    if (!sidecar) {
      return;
    }
    if (sidecar.conflictsWith) {
      return;
    }
    sidecar.conflictsWith = loserSource;
    await writeSidecarAtomic(targetDir, sidecar);
  }

  private async writeOriginSidecar(
    dir: string,
    base: {
      kind: OriginKind;
      slug: string;
      pluginId: string | null;
      sourceHash: string;
    },
  ): Promise<void> {
    const now = Date.now();
    const sidecar: OriginSidecar = {
      kind: base.kind,
      slug: base.slug,
      pluginId: base.pluginId,
      version: null,
      sourceHash: base.sourceHash,
      clonedAt: now,
      diverged: false,
      lastEnhancedAt: null,
      historyDir: DEFAULT_HISTORY_DIR,
      currentContentHash: base.sourceHash,
    };
    await writeSidecarAtomic(dir, sidecar);
  }

  private async reconcileMissingFileSidecar(
    rootDir: string,
    targetFile: string,
    slug: string,
    base: { kind: OriginKind; slug: string; pluginId: string | null },
  ): Promise<void> {
    const sidecarPath = join(rootDir, `${slug}${ORIGIN_SIDECAR_SUFFIX}`);
    const existing = await readSidecarAt(sidecarPath);
    if (existing) {
      return;
    }
    try {
      const sourceHash = await computeSourceHash(targetFile);
      await this.writeFileSidecar(rootDir, slug, {
        kind: base.kind,
        slug: base.slug,
        pluginId: base.pluginId,
        sourceHash,
      });
    } catch (error: unknown) {
      this.logger.warn(
        '[UserLayerMirror] failed to reconcile missing file sidecar',
        {
          slug,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  private async writeFileSidecar(
    rootDir: string,
    slug: string,
    base: {
      kind: OriginKind;
      slug: string;
      pluginId: string | null;
      sourceHash: string;
    },
  ): Promise<void> {
    const now = Date.now();
    const sidecar: OriginSidecar = {
      kind: base.kind,
      slug: base.slug,
      pluginId: base.pluginId,
      version: null,
      sourceHash: base.sourceHash,
      clonedAt: now,
      diverged: false,
      lastEnhancedAt: null,
      historyDir: DEFAULT_HISTORY_DIR,
      currentContentHash: base.sourceHash,
    };
    const sidecarPath = join(rootDir, `${slug}${ORIGIN_SIDECAR_SUFFIX}`);
    this.assertUnderUserLayer(sidecarPath);
    await writeSidecarAtomicAt(sidecarPath, sidecar);
  }

  private assertUnderUserLayer(targetPath: string): void {
    const userBase = resolve(join(homedir(), '.ptah', 'user'));
    const resolved = resolve(targetPath);
    if (resolved !== userBase && !resolved.startsWith(userBase + sep)) {
      throw new Error(
        `[UserLayerMirror] refusing to write outside ~/.ptah/user/: ${resolved}`,
      );
    }
    const pluginsBase = resolve(join(homedir(), '.ptah', 'plugins'));
    if (resolved === pluginsBase || resolved.startsWith(pluginsBase + sep)) {
      throw new Error(
        `[UserLayerMirror] refusing to write under ~/.ptah/plugins/: ${resolved}`,
      );
    }
  }

  private async copyTree(sourceDir: string, targetDir: string): Promise<void> {
    const rootStat = await lstat(sourceDir);
    if (rootStat.isSymbolicLink()) {
      this.logger.warn('[UserLayerMirror] skipping symlinked source root', {
        sourceDir,
      });
      return;
    }
    await this.copyTreeRec(sourceDir, targetDir, 0);
  }

  private async copyTreeRec(
    sourceDir: string,
    targetDir: string,
    depth: number,
  ): Promise<void> {
    if (depth > MAX_COPY_RECURSION_DEPTH) {
      this.logger.warn(
        '[UserLayerMirror] copy recursion depth cutoff; skill may be partially cloned',
        { sourceDir, maxDepth: MAX_COPY_RECURSION_DEPTH },
      );
      return;
    }
    await mkdir(targetDir, { recursive: true });
    const entries = await readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const sourcePath = join(sourceDir, entry.name);
      const targetPath = join(targetDir, entry.name);
      if (entry.isDirectory()) {
        await this.copyTreeRec(sourcePath, targetPath, depth + 1);
      } else if (entry.isFile()) {
        await this.copyFileAtomic(sourcePath, targetPath);
      }
    }
  }

  private async copyFileAtomic(
    sourceFile: string,
    targetFile: string,
  ): Promise<void> {
    this.assertUnderUserLayer(targetFile);
    const content = await readFile(sourceFile);
    const tempPath = `${targetFile}.${process.pid}.${Date.now()}.tmp`;
    if (dirname(tempPath) !== dirname(targetFile)) {
      throw new Error(
        `[UserLayerMirror] temp path must share the target parent dir: ${tempPath}`,
      );
    }
    let renamed = false;
    try {
      await writeFile(tempPath, content);
      await rename(tempPath, targetFile);
      renamed = true;
    } finally {
      if (!renamed) {
        await unlink(tempPath).catch(() => undefined);
      }
    }
  }

  private async listSubdirectories(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }

  private async dirExists(dir: string): Promise<boolean> {
    try {
      const s = await stat(dir);
      return s.isDirectory();
    } catch {
      return false;
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const s = await stat(filePath);
      return s.isFile();
    } catch {
      return false;
    }
  }

  private isEnoent(error: unknown): boolean {
    return isErrnoCode(error, 'ENOENT');
  }
}
