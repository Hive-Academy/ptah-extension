/**
 * UserLayerPluginAgents — plugin agents as Library clones (TASK_2026_701, B10).
 *
 * A plugin ships `<plugin>/agents/*.md`. Those files are content the user
 * installed on purpose, like the plugin's skills and commands, so they become
 * clones in the Library's agent root (`getUserLayerRoots(libraryScopeRoot)
 * .agents`) whenever the host names that root, independent of agent-sync
 * consent.
 *
 * Consent still decides what PROPAGATES: the harness manifest builder's
 * `buildAgents` returns `[]` for a workspace without agent sync, so a clone
 * made here reaches no `.codex`, `.github` or `.cursor` agent directory until
 * the user opts in. Mirroring and propagation are two different gates.
 *
 * Rules, per slug:
 *
 * - **Create-if-absent.** A new clone gets a sidecar with
 *   `pluginId = basename(pluginPath)` and, when the host supplied a
 *   descriptor, the durable `sourceRef` and display `sourceLabel`.
 * - **Collision (A8).** A clone that exists and is not this source's — a
 *   workspace agent (`pluginId: null`), another plugin, an external plugin with
 *   the same directory basename but a different `sourceRef`, or a sidecar-less
 *   user-authored file — is never overwritten. The pass skips it and records
 *   `conflictsWith` on the owner's sidecar.
 * - **Reconcile** goes through the mirror's `reconcileFileClone`, so an edited
 *   clone diverges and an unedited one fast-forwards. A sidecar-less file is
 *   user-authored, so the reconcile never mints a sidecar for it.
 *
 * Per-file failures are counted in `errors` and logged, never thrown, so one
 * unreadable agent does not abandon the pass.
 */
import { basename, join } from 'path';
import { mkdir } from 'fs/promises';
import type { Logger } from '@ptah-extension/vscode-core';
import type { OriginSidecar } from './origin-sidecar.types';
import { DEFAULT_HISTORY_DIR } from './origin-sidecar.types';
import {
  computeSourceHash,
  readSidecarAt,
  writeSidecarAtomicAt,
} from './source-hash';
import type { UserLayerFsOps } from './user-layer-fs-ops';

const ORIGIN_SIDECAR_SUFFIX = '.ptah-origin.json';

/** Durable identity and display label of one plugin source directory (A28). */
export interface MirrorPluginDescriptor {
  /** `ptah:<id>`, `harness:<dir>`, `skills-sh:<dir>` or `external:<owner>/<repo>/<plugin>`. */
  readonly sourceRef: string;
  readonly label: string;
}

/** Plugin descriptors keyed by absolute plugin path, as the host supplies them. */
export type MirrorPluginDescriptors = Readonly<
  Record<string, MirrorPluginDescriptor>
>;

/** Serialises work on one agent slug with every other user-layer operation. */
export type PluginAgentSlugLock = <T>(
  slug: string,
  fn: () => Promise<T>,
) => Promise<T>;

/** The mirror's three-way reconcile for one agent file clone. */
export type ReconcilePluginAgentClone = (args: {
  readonly slug: string;
  readonly pluginId: string;
  readonly sourceFile: string;
  readonly cloneFile: string;
  readonly agentsRoot: string;
  readonly descriptor: MirrorPluginDescriptor | undefined;
}) => Promise<void>;

/** The counters of `MirrorResult` this pass writes. */
export interface PluginAgentMirrorCounters {
  agentsMirrored: number;
  skipped: number;
  conflicts: number;
  errors: number;
}

/** The counter of `ReconcileResult` this pass writes beside `reconcileFileClone`. */
export interface PluginAgentReconcileCounters {
  errors: number;
}

export interface PluginAgentPass {
  readonly pluginPaths: readonly string[];
  readonly agentsRoot: string;
  readonly descriptors: MirrorPluginDescriptors | undefined;
  readonly withSlugLock: PluginAgentSlugLock;
}

/** One `<plugin>/agents/<slug>.md` source file. */
interface PluginAgentSource {
  readonly slug: string;
  readonly pluginId: string;
  readonly sourceFile: string;
  readonly descriptor: MirrorPluginDescriptor | undefined;
}

/**
 * The sidecar with `sourceRef`/`sourceLabel` set from `descriptor`, or the
 * sidecar unchanged when no descriptor was supplied, so existing values carry
 * forward.
 */
export function withSourceIdentity(
  sidecar: OriginSidecar,
  descriptor: MirrorPluginDescriptor | undefined,
): OriginSidecar {
  if (descriptor === undefined) return sidecar;
  return {
    ...sidecar,
    sourceRef: descriptor.sourceRef,
    sourceLabel: descriptor.label,
  };
}

/** True when applying `descriptor` would change the sidecar's source fields. */
export function sourceIdentityChanged(
  sidecar: OriginSidecar,
  descriptor: MirrorPluginDescriptor | undefined,
): boolean {
  return (
    descriptor !== undefined &&
    (sidecar.sourceRef !== descriptor.sourceRef ||
      sidecar.sourceLabel !== descriptor.label)
  );
}

/**
 * Does this source own this clone?
 *
 * Slugs are global across the user layer but sources are not: two plugins can
 * ship the same slug, and the first-write-wins rule picks ONE owner and
 * records `conflictsWith` on the loser. Reconciling the clone against the
 * loser's bytes would flag a divergence that is really just "the other
 * plugin's copy differs", and offer a rebase onto content the clone was never
 * made from. It is also what lets the synthesized-skill and workspace-agent
 * passes walk the same roots as the plugin passes: only the sidecar says which
 * source a clone came from.
 *
 * `pluginId` is a directory basename, so two external plugins can share it.
 * When both the sidecar and the caller know a `sourceRef`, it must match too.
 * A sidecar written before `sourceRef` existed is owned on `pluginId` alone,
 * and the next reconcile records the ref.
 */
export function ownsSourcedClone(
  sidecar: OriginSidecar,
  expectedPluginId: string | null,
  descriptor: MirrorPluginDescriptor | undefined,
): boolean {
  if (sidecar.pluginId !== expectedPluginId) return false;
  if (descriptor === undefined || sidecar.sourceRef === undefined) return true;
  return sidecar.sourceRef === descriptor.sourceRef;
}

export class UserLayerPluginAgents {
  constructor(
    private readonly logger: Logger,
    private readonly fs: UserLayerFsOps,
  ) {}

  /** Create-if-absent pass over every plugin's `agents/*.md`. */
  async mirror(
    pass: PluginAgentPass,
    result: PluginAgentMirrorCounters,
  ): Promise<void> {
    // First write wins inside one pass, as `mirrorSkillSlug` does for skills.
    const claimed = new Map<string, string>();
    for (const source of await this.listSources(pass, result)) {
      await pass.withSlugLock(source.slug, () =>
        this.mirrorOne(source, pass.agentsRoot, claimed, result),
      );
    }
  }

  /** Three-way reconcile of every plugin agent clone this pass's sources own. */
  async reconcile(
    pass: PluginAgentPass,
    result: PluginAgentReconcileCounters,
    reconcileClone: ReconcilePluginAgentClone,
  ): Promise<void> {
    for (const source of await this.listSources(pass, result)) {
      const cloneFile = join(pass.agentsRoot, `${source.slug}.md`);
      const sidecarPath = this.sidecarPath(pass.agentsRoot, source.slug);
      await pass.withSlugLock(source.slug, async () => {
        try {
          // A clone with no sidecar is user-authored. `reconcileFileClone`
          // would mint one naming this plugin, so it is left alone here.
          if (
            (await this.fs.fileExists(cloneFile)) &&
            (await readSidecarAt(sidecarPath)) === null
          ) {
            return;
          }
        } catch (error: unknown) {
          // degradation-audit: reported - the failure is counted in
          // result.errors and logged; skipping the slug leaves the clone as it
          // is, and the next pass retries it.
          result.errors += 1;
          this.logger.warn(
            '[UserLayerMirror] plugin agent reconcile could not read sidecar',
            { slug: source.slug, error: errorMessage(error) },
          );
          return;
        }
        await reconcileClone({
          slug: source.slug,
          pluginId: source.pluginId,
          sourceFile: source.sourceFile,
          cloneFile,
          agentsRoot: pass.agentsRoot,
          descriptor: source.descriptor,
        });
      });
    }
  }

  private async mirrorOne(
    source: PluginAgentSource,
    agentsRoot: string,
    claimed: Map<string, string>,
    result: PluginAgentMirrorCounters,
  ): Promise<void> {
    const cloneFile = join(agentsRoot, `${source.slug}.md`);
    const sidecarPath = this.sidecarPath(agentsRoot, source.slug);
    try {
      this.fs.assertUnderUserLayer(cloneFile);
      const owner = claimed.get(source.slug);
      if (owner !== undefined) {
        await this.recordConflict(sidecarPath, source.sourceFile);
        result.conflicts += 1;
        this.logger.warn(
          '[UserLayerMirror] plugin agent slug collision; first-write wins',
          { slug: source.slug, owner, loser: source.sourceFile },
        );
        return;
      }

      if (await this.fs.fileExists(cloneFile)) {
        const sidecar = await readSidecarAt(sidecarPath);
        if (
          sidecar !== null &&
          ownsSourcedClone(sidecar, source.pluginId, source.descriptor)
        ) {
          claimed.set(source.slug, source.sourceFile);
          result.skipped += 1;
          return;
        }
        await this.recordConflict(sidecarPath, source.sourceFile);
        result.conflicts += 1;
        this.logger.info(
          '[UserLayerMirror] plugin agent not mirrored: clone owned by another source',
          {
            slug: source.slug,
            pluginId: source.pluginId,
            owner: sidecar === null ? 'user-authored' : sidecar.pluginId,
          },
        );
        return;
      }

      await mkdir(agentsRoot, { recursive: true });
      await this.fs.copyFileAtomic(source.sourceFile, cloneFile);
      const sourceHash = await computeSourceHash(source.sourceFile);
      this.fs.assertUnderUserLayer(sidecarPath);
      await writeSidecarAtomicAt(
        sidecarPath,
        withSourceIdentity(
          {
            kind: 'agent',
            slug: source.slug,
            pluginId: source.pluginId,
            version: null,
            sourceHash,
            clonedAt: Date.now(),
            diverged: false,
            lastEnhancedAt: null,
            historyDir: DEFAULT_HISTORY_DIR,
            currentContentHash: sourceHash,
          },
          source.descriptor,
        ),
      );
      claimed.set(source.slug, source.sourceFile);
      result.agentsMirrored += 1;
    } catch (error: unknown) {
      result.errors += 1;
      this.logger.warn('[UserLayerMirror] failed to mirror plugin agent', {
        slug: source.slug,
        pluginId: source.pluginId,
        error: errorMessage(error),
      });
    }
  }

  /** Record the first losing source on the owner's sidecar; no sidecar, no record. */
  private async recordConflict(
    sidecarPath: string,
    loserSource: string,
  ): Promise<void> {
    const sidecar = await readSidecarAt(sidecarPath);
    if (sidecar === null || sidecar.conflictsWith) return;
    this.fs.assertUnderUserLayer(sidecarPath);
    await writeSidecarAtomicAt(sidecarPath, {
      ...sidecar,
      conflictsWith: loserSource,
    });
  }

  /** Every `<plugin>/agents/*.md`, in plugin order. A missing `agents/` is normal. */
  private async listSources(
    pass: PluginAgentPass,
    result: { errors: number },
  ): Promise<PluginAgentSource[]> {
    const sources: PluginAgentSource[] = [];
    for (const pluginPath of pass.pluginPaths) {
      const agentsDir = join(pluginPath, 'agents');
      let files: string[];
      try {
        files = await this.fs.listMarkdownFiles(agentsDir);
      } catch (error: unknown) {
        // degradation-audit: optional-capability - ENOENT means this plugin
        // ships no `agents/` directory, which is a normal, optional plugin
        // layout; a real error is counted in result.errors and logged.
        if (!this.fs.isEnoent(error)) {
          result.errors += 1;
          this.logger.warn('[UserLayerMirror] failed to read plugin agents', {
            agentsDir,
            error: errorMessage(error),
          });
        }
        continue;
      }
      const pluginId = basename(pluginPath);
      for (const fileName of files) {
        sources.push({
          slug: fileName.replace(/\.md$/, ''),
          pluginId,
          sourceFile: join(agentsDir, fileName),
          descriptor: pass.descriptors?.[pluginPath],
        });
      }
    }
    return sources;
  }

  private sidecarPath(agentsRoot: string, slug: string): string {
    return join(agentsRoot, `${slug}${ORIGIN_SIDECAR_SUFFIX}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
