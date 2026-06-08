import { injectable, inject } from 'tsyringe';
import { homedir } from 'os';
import { join, resolve, sep, basename, dirname } from 'path';
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rename,
  rm,
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
  pendingSourceHash: string | null;
}

export interface DivergedClone {
  kind: OriginKind;
  slug: string;
  pendingSourceHash: string;
}

export interface ReconcileResult {
  noop: number;
  fastForwarded: number;
  diverged: number;
  missingSidecar: number;
  errors: number;
  divergedSlugs: DivergedClone[];
}

export interface RebaseCloneArgs {
  kind: OriginKind;
  slug: string;
  sourceDir: string;
}

export interface RebaseResult {
  kind: OriginKind;
  slug: string;
  sourceHash: string;
  snapshotPath: string | null;
}

export interface KeepCloneArgs {
  kind: OriginKind;
  slug: string;
}

export interface KeepResult {
  kind: OriginKind;
  slug: string;
  sourceHash: string;
}

const MAX_COPY_RECURSION_DEPTH = 20;
const SYNTH_CANDIDATES_DIR = '_candidates';

@injectable()
export class UserLayerMirrorService {
  private readonly inflight = new Map<string, Promise<void>>();

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
          pendingSourceHash: sidecar.pendingSourceHash ?? null,
        });
      }
    }
    return entries;
  }

  async reconcile(sources: MirrorSources): Promise<ReconcileResult> {
    const result: ReconcileResult = {
      noop: 0,
      fastForwarded: 0,
      diverged: 0,
      missingSidecar: 0,
      errors: 0,
      divergedSlugs: [],
    };
    const roots = this.getUserLayerRoots();

    for (const pluginPath of sources.pluginPaths) {
      const pluginId = basename(pluginPath);
      await this.reconcilePluginSkills(pluginPath, roots.skills, result);
      await this.reconcilePluginCommands(
        pluginPath,
        pluginId,
        roots.commands,
        result,
      );
    }

    if (sources.agentSourceDir) {
      await this.reconcileAgents(sources.agentSourceDir, roots.agents, result);
    }

    this.logger.info('[UserLayerMirror] reconcile complete', {
      noop: result.noop,
      fastForwarded: result.fastForwarded,
      diverged: result.diverged,
      missingSidecar: result.missingSidecar,
      errors: result.errors,
    });
    return result;
  }

  async rebaseClone(args: RebaseCloneArgs): Promise<RebaseResult> {
    return this.withSlugLock(args.kind, args.slug, async () => {
      const roots = this.getUserLayerRoots();
      if (args.kind === 'skill') {
        return this.rebaseDirClone(args.slug, args.sourceDir, roots.skills);
      }
      const root = args.kind === 'agent' ? roots.agents : roots.commands;
      return this.rebaseFileClone(args.kind, args.slug, args.sourceDir, root);
    });
  }

  async keepClone(args: KeepCloneArgs): Promise<KeepResult> {
    return this.withSlugLock(args.kind, args.slug, async () => {
      const roots = this.getUserLayerRoots();
      if (args.kind === 'skill') {
        return this.keepDirClone(args.slug, roots.skills);
      }
      const root = args.kind === 'agent' ? roots.agents : roots.commands;
      return this.keepFileClone(args.kind, args.slug, root);
    });
  }

  private async rebaseDirClone(
    slug: string,
    sourceDir: string,
    skillsRoot: string,
  ): Promise<RebaseResult> {
    const cloneDir = join(skillsRoot, slug);
    this.assertUnderUserLayer(cloneDir);
    let snapshotPath: string | null = null;
    if (await this.dirExists(cloneDir)) {
      snapshotPath = await this.snapshotDirToHistory(cloneDir);
      await this.clearCloneTrackedContent(cloneDir);
    }
    await this.copyTree(sourceDir, cloneDir);
    const newSourceHash = await computeSourceHash(sourceDir);
    const existing = await readSidecar(cloneDir);
    const sidecar: OriginSidecar = existing
      ? {
          ...existing,
          sourceHash: newSourceHash,
          clonedAt: Date.now(),
          currentContentHash: newSourceHash,
          diverged: false,
          pendingSourceHash: undefined,
        }
      : this.buildSidecar('skill', slug, null, newSourceHash);
    this.assertUnderUserLayer(cloneDir);
    await writeSidecarAtomic(cloneDir, sidecar);
    return { kind: 'skill', slug, sourceHash: newSourceHash, snapshotPath };
  }

  private async rebaseFileClone(
    kind: OriginKind,
    slug: string,
    sourceFile: string,
    rootDir: string,
  ): Promise<RebaseResult> {
    const cloneFile = join(rootDir, `${slug}.md`);
    const sidecarPath = join(rootDir, `${slug}${ORIGIN_SIDECAR_SUFFIX}`);
    this.assertUnderUserLayer(cloneFile);
    let snapshotPath: string | null = null;
    if (await this.fileExists(cloneFile)) {
      snapshotPath = await this.snapshotFileToHistory(rootDir, slug, cloneFile);
    }
    await mkdir(rootDir, { recursive: true });
    await this.copyFileAtomic(sourceFile, cloneFile);
    const newSourceHash = await computeSourceHash(sourceFile);
    const existing = await readSidecarAt(sidecarPath);
    const sidecar: OriginSidecar = existing
      ? {
          ...existing,
          sourceHash: newSourceHash,
          clonedAt: Date.now(),
          currentContentHash: newSourceHash,
          diverged: false,
          pendingSourceHash: undefined,
        }
      : this.buildSidecar(kind, slug, null, newSourceHash);
    this.assertUnderUserLayer(sidecarPath);
    await writeSidecarAtomicAt(sidecarPath, sidecar);
    return { kind, slug, sourceHash: newSourceHash, snapshotPath };
  }

  private async keepDirClone(
    slug: string,
    skillsRoot: string,
  ): Promise<KeepResult> {
    const cloneDir = join(skillsRoot, slug);
    this.assertUnderUserLayer(cloneDir);
    const sidecar = await readSidecar(cloneDir);
    if (!sidecar) {
      return { kind: 'skill', slug, sourceHash: '' };
    }
    const liveCloneHash = await computeSourceHash(cloneDir);
    const newSourceHash = sidecar.pendingSourceHash ?? sidecar.sourceHash;
    const updated: OriginSidecar = {
      ...sidecar,
      sourceHash: newSourceHash,
      currentContentHash: liveCloneHash,
      diverged: false,
      pendingSourceHash: undefined,
    };
    await writeSidecarAtomic(cloneDir, updated);
    return { kind: 'skill', slug, sourceHash: newSourceHash };
  }

  private async keepFileClone(
    kind: OriginKind,
    slug: string,
    rootDir: string,
  ): Promise<KeepResult> {
    const cloneFile = join(rootDir, `${slug}.md`);
    const sidecarPath = join(rootDir, `${slug}${ORIGIN_SIDECAR_SUFFIX}`);
    this.assertUnderUserLayer(sidecarPath);
    const sidecar = await readSidecarAt(sidecarPath);
    if (!sidecar) {
      return { kind, slug, sourceHash: '' };
    }
    const liveCloneHash = await computeSourceHash(cloneFile);
    const newSourceHash = sidecar.pendingSourceHash ?? sidecar.sourceHash;
    const updated: OriginSidecar = {
      ...sidecar,
      sourceHash: newSourceHash,
      currentContentHash: liveCloneHash,
      diverged: false,
      pendingSourceHash: undefined,
    };
    await writeSidecarAtomicAt(sidecarPath, updated);
    return { kind, slug, sourceHash: newSourceHash };
  }

  private buildSidecar(
    kind: OriginKind,
    slug: string,
    pluginId: string | null,
    sourceHash: string,
  ): OriginSidecar {
    return {
      kind,
      slug,
      pluginId,
      version: null,
      sourceHash,
      clonedAt: Date.now(),
      diverged: false,
      lastEnhancedAt: null,
      historyDir: DEFAULT_HISTORY_DIR,
      currentContentHash: sourceHash,
    };
  }

  private async reconcilePluginSkills(
    pluginPath: string,
    skillsRoot: string,
    result: ReconcileResult,
  ): Promise<void> {
    const sourceSkillsDir = join(pluginPath, 'skills');
    let slugs: string[];
    try {
      slugs = await this.listSubdirectories(sourceSkillsDir);
    } catch (error: unknown) {
      if (!this.isEnoent(error)) {
        result.errors += 1;
        this.logger.warn(
          '[UserLayerMirror] reconcile failed to read plugin skills',
          {
            sourceSkillsDir,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
      return;
    }

    for (const slug of slugs) {
      const sourceDir = join(sourceSkillsDir, slug);
      const cloneDir = join(skillsRoot, slug);
      await this.withSlugLock('skill', slug, async () => {
        await this.reconcileDirClone(
          'skill',
          slug,
          sourceDir,
          cloneDir,
          result,
        );
      });
    }
  }

  private async reconcilePluginCommands(
    pluginPath: string,
    pluginId: string,
    commandsRoot: string,
    result: ReconcileResult,
  ): Promise<void> {
    const sourceCommandsDir = join(pluginPath, 'commands');
    let files: string[];
    try {
      files = (await readdir(sourceCommandsDir, { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name);
    } catch (error: unknown) {
      if (!this.isEnoent(error)) {
        result.errors += 1;
        this.logger.warn(
          '[UserLayerMirror] reconcile failed to read plugin commands',
          {
            sourceCommandsDir,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
      return;
    }

    for (const fileName of files) {
      const slug = fileName.replace(/\.md$/, '');
      const sourceFile = join(sourceCommandsDir, fileName);
      const cloneFile = join(commandsRoot, fileName);
      await this.withSlugLock('command', slug, async () => {
        await this.reconcileFileClone(
          'command',
          slug,
          pluginId,
          sourceFile,
          cloneFile,
          commandsRoot,
          result,
        );
      });
    }
  }

  private async reconcileAgents(
    agentSourceDir: string,
    agentsRoot: string,
    result: ReconcileResult,
  ): Promise<void> {
    let files: string[];
    try {
      files = (await readdir(agentSourceDir, { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name);
    } catch (error: unknown) {
      if (!this.isEnoent(error)) {
        result.errors += 1;
        this.logger.warn(
          '[UserLayerMirror] reconcile failed to read agent source',
          {
            agentSourceDir,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
      return;
    }

    for (const fileName of files) {
      const slug = fileName.replace(/\.md$/, '');
      const sourceFile = join(agentSourceDir, fileName);
      const cloneFile = join(agentsRoot, fileName);
      await this.withSlugLock('agent', slug, async () => {
        await this.reconcileFileClone(
          'agent',
          slug,
          null,
          sourceFile,
          cloneFile,
          agentsRoot,
          result,
        );
      });
    }
  }

  private async reconcileDirClone(
    kind: OriginKind,
    slug: string,
    sourceDir: string,
    cloneDir: string,
    result: ReconcileResult,
  ): Promise<void> {
    try {
      if (!(await this.dirExists(cloneDir))) {
        return;
      }
      this.assertUnderUserLayer(cloneDir);

      const sidecar = await readSidecar(cloneDir);
      if (!sidecar) {
        await this.reconcileMissingSidecar(cloneDir, sourceDir, {
          kind,
          slug,
          pluginId: null,
        });
        result.missingSidecar += 1;
        return;
      }

      const liveSourceHash = await computeSourceHash(sourceDir);
      if (liveSourceHash === sidecar.sourceHash) {
        result.noop += 1;
        return;
      }

      const liveCloneHash = await computeSourceHash(cloneDir);
      if (liveCloneHash === sidecar.sourceHash) {
        await this.snapshotDirToHistory(cloneDir);
        await this.clearCloneTrackedContent(cloneDir);
        await this.copyTree(sourceDir, cloneDir);
        await this.refreshSidecarDir(cloneDir, sidecar, liveSourceHash);
        result.fastForwarded += 1;
        return;
      }

      await this.markDivergedDir(cloneDir, sidecar, liveSourceHash);
      result.diverged += 1;
      result.divergedSlugs.push({
        kind,
        slug,
        pendingSourceHash: liveSourceHash,
      });
    } catch (error: unknown) {
      result.errors += 1;
      this.logger.warn('[UserLayerMirror] reconcile failed for skill', {
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async reconcileFileClone(
    kind: OriginKind,
    slug: string,
    pluginId: string | null,
    sourceFile: string,
    cloneFile: string,
    rootDir: string,
    result: ReconcileResult,
  ): Promise<void> {
    try {
      if (!(await this.fileExists(cloneFile))) {
        return;
      }
      this.assertUnderUserLayer(cloneFile);

      const sidecarPath = join(rootDir, `${slug}${ORIGIN_SIDECAR_SUFFIX}`);
      const sidecar = await readSidecarAt(sidecarPath);
      if (!sidecar) {
        await this.reconcileMissingFileSidecar(rootDir, cloneFile, slug, {
          kind,
          slug,
          pluginId,
        });
        result.missingSidecar += 1;
        return;
      }

      const liveSourceHash = await computeSourceHash(sourceFile);
      if (liveSourceHash === sidecar.sourceHash) {
        result.noop += 1;
        return;
      }

      const liveCloneHash = await computeSourceHash(cloneFile);
      if (liveCloneHash === sidecar.sourceHash) {
        await this.snapshotFileToHistory(rootDir, slug, cloneFile);
        await this.copyFileAtomic(sourceFile, cloneFile);
        await this.refreshSidecarAt(sidecarPath, sidecar, liveSourceHash);
        result.fastForwarded += 1;
        return;
      }

      await this.markDivergedAt(sidecarPath, sidecar, liveSourceHash);
      result.diverged += 1;
      result.divergedSlugs.push({
        kind,
        slug,
        pendingSourceHash: liveSourceHash,
      });
    } catch (error: unknown) {
      result.errors += 1;
      this.logger.warn('[UserLayerMirror] reconcile failed for file clone', {
        kind,
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async refreshSidecarDir(
    cloneDir: string,
    sidecar: OriginSidecar,
    newSourceHash: string,
  ): Promise<void> {
    const updated: OriginSidecar = {
      ...sidecar,
      sourceHash: newSourceHash,
      clonedAt: Date.now(),
      currentContentHash: newSourceHash,
      diverged: false,
      pendingSourceHash: undefined,
    };
    this.assertUnderUserLayer(cloneDir);
    await writeSidecarAtomic(cloneDir, updated);
  }

  private async refreshSidecarAt(
    sidecarPath: string,
    sidecar: OriginSidecar,
    newSourceHash: string,
  ): Promise<void> {
    const updated: OriginSidecar = {
      ...sidecar,
      sourceHash: newSourceHash,
      clonedAt: Date.now(),
      currentContentHash: newSourceHash,
      diverged: false,
      pendingSourceHash: undefined,
    };
    this.assertUnderUserLayer(sidecarPath);
    await writeSidecarAtomicAt(sidecarPath, updated);
  }

  private async markDivergedDir(
    cloneDir: string,
    sidecar: OriginSidecar,
    pendingSourceHash: string,
  ): Promise<void> {
    const updated: OriginSidecar = {
      ...sidecar,
      diverged: true,
      pendingSourceHash,
    };
    this.assertUnderUserLayer(cloneDir);
    await writeSidecarAtomic(cloneDir, updated);
  }

  private async markDivergedAt(
    sidecarPath: string,
    sidecar: OriginSidecar,
    pendingSourceHash: string,
  ): Promise<void> {
    const updated: OriginSidecar = {
      ...sidecar,
      diverged: true,
      pendingSourceHash,
    };
    this.assertUnderUserLayer(sidecarPath);
    await writeSidecarAtomicAt(sidecarPath, updated);
  }

  private async snapshotDirToHistory(cloneDir: string): Promise<string> {
    const historyTsDir = await this.makeUniqueHistoryDir(
      join(cloneDir, DEFAULT_HISTORY_DIR),
      String(Date.now()),
    );
    await this.snapshotTreeRec(cloneDir, historyTsDir, 0);
    return historyTsDir;
  }

  private async makeUniqueHistoryDir(
    parentDir: string,
    ts: string,
  ): Promise<string> {
    this.assertUnderUserLayer(parentDir);
    await mkdir(parentDir, { recursive: true });
    let candidate = join(parentDir, ts);
    let counter = 0;
    for (;;) {
      this.assertUnderUserLayer(candidate);
      try {
        await mkdir(candidate, { recursive: false });
        return candidate;
      } catch (error: unknown) {
        if (!isErrnoCode(error, 'EEXIST')) {
          throw error;
        }
        counter += 1;
        candidate = join(parentDir, `${ts}-${counter}`);
      }
    }
  }

  private async snapshotTreeRec(
    sourceDir: string,
    targetDir: string,
    depth: number,
  ): Promise<void> {
    if (depth > MAX_COPY_RECURSION_DEPTH) {
      this.logger.warn(
        '[UserLayerMirror] snapshot recursion depth cutoff; history may be partial',
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
      if (entry.name === DEFAULT_HISTORY_DIR) {
        continue;
      }
      if (entry.name === ORIGIN_SIDECAR_FILENAME) {
        continue;
      }
      const sourcePath = join(sourceDir, entry.name);
      const targetPath = join(targetDir, entry.name);
      if (entry.isDirectory()) {
        await this.snapshotTreeRec(sourcePath, targetPath, depth + 1);
      } else if (entry.isFile()) {
        await this.copyFileAtomic(sourcePath, targetPath);
      }
    }
  }

  private async snapshotFileToHistory(
    rootDir: string,
    slug: string,
    cloneFile: string,
  ): Promise<string> {
    const historyTsDir = await this.makeUniqueHistoryDir(
      join(rootDir, DEFAULT_HISTORY_DIR, slug),
      String(Date.now()),
    );
    const targetFile = join(historyTsDir, basename(cloneFile));
    await this.copyFileAtomic(cloneFile, targetFile);
    return historyTsDir;
  }

  private async withSlugLock<T>(
    kind: OriginKind,
    slug: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const key = `${kind}/${slug}`;
    const prior = this.inflight.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    this.inflight.set(key, gate);
    await prior;
    try {
      return await fn();
    } finally {
      release();
      if (this.inflight.get(key) === gate) {
        this.inflight.delete(key);
      }
    }
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

  private async clearCloneTrackedContent(cloneDir: string): Promise<void> {
    this.assertUnderUserLayer(cloneDir);
    const entries = await readdir(cloneDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === DEFAULT_HISTORY_DIR) {
        continue;
      }
      if (entry.name === ORIGIN_SIDECAR_FILENAME) {
        continue;
      }
      const entryPath = join(cloneDir, entry.name);
      this.assertUnderUserLayer(entryPath);
      await rm(entryPath, { recursive: true, force: true });
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
