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
 *   descriptor, the durable `sourceRef` and display `sourceLabel`. The body
 *   and sidecar are published behind an intent record, so a pass interrupted
 *   between them is finished by the next pass instead of leaving a body that
 *   reads as user-authored.
 * - **Legacy ownership.** A sidecar without `sourceRef` is owned on its
 *   directory basename only while no other INSTALLED plugin (enabled or not)
 *   shares that basename; otherwise it is kept untouched and reported as
 *   ambiguous.
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
import { basename, join, resolve } from 'path';
import { mkdir, readFile } from 'fs/promises';
import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import type { OriginSidecar } from './origin-sidecar.types';
import { DEFAULT_HISTORY_DIR } from './origin-sidecar.types';
import {
  computeSourceHash,
  contentSourceHash,
  readSidecarAt,
  writeSidecarAtomicAt,
} from './source-hash';
import type { UserLayerFsOps } from './user-layer-fs-ops';

const ORIGIN_SIDECAR_SUFFIX = '.ptah-origin.json';

/**
 * Suffix of a publication's intent record. It ends in neither
 * `.ptah-origin.json` nor `.md`, so no clone, sidecar or harness listing sees it.
 */
const PENDING_PUBLICATION_SUFFIX = '.ptah-origin-pending.json';

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
  /** Another installed plugin has the same basename (see `sourceOwnership`). */
  readonly basenameShared: boolean;
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
 * Who owns this clone, from the point of view of one source?
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
 * - `foreign` — the sidecar names another `pluginId`, or both sides know a
 *   `sourceRef` and they differ.
 * - `owned` — the ids match and, when both know one, so do the refs.
 * - `ambiguous` — the ids match but one side has no `sourceRef` (a sidecar
 *   written before `sourceRef` existed, or a source with no descriptor), so the
 *   directory basename is the only evidence, AND another installed plugin
 *   (enabled or disabled) has that basename. Neither source may adopt the
 *   clone: whichever came first, or whichever is still enabled, would record
 *   its own identity and redirect the clone's upstream for good. The clone is
 *   kept as it is until only one installed candidate remains.
 *
 * `basenameShared` is {@link sharedPluginBasenames}`.has(expectedPluginId)`
 * over the pass's plugin roots and described paths; `false` for a source that
 * is not a plugin.
 */
export type SourceOwnership = 'owned' | 'foreign' | 'ambiguous';

export function sourceOwnership(
  sidecar: OriginSidecar,
  expectedPluginId: string | null,
  descriptor: MirrorPluginDescriptor | undefined,
  basenameShared: boolean,
): SourceOwnership {
  if (sidecar.pluginId !== expectedPluginId) return 'foreign';
  if (descriptor !== undefined && sidecar.sourceRef !== undefined) {
    return sidecar.sourceRef === descriptor.sourceRef ? 'owned' : 'foreign';
  }
  return basenameShared ? 'ambiguous' : 'owned';
}

/**
 * Plugin directory basenames that more than one INSTALLED plugin directory
 * ends in.
 *
 * A pass names only the enabled plugin roots, so the pass alone cannot see a
 * disabled plugin that shares a basename: with the true owner disabled, the
 * other plugin would be the only candidate and would adopt the owner's legacy
 * clone. Every host builds `descriptors` with
 * `PluginLoaderService.getPluginSourceDescriptors()`, which describes every
 * installed source whether enabled or not (all bundled ids, every harness and
 * skills.sh directory, every external consent record). So the installed set
 * is the pass's roots plus the described paths. A path in both counts once.
 *
 * A caller that supplies no descriptors cannot record a `sourceRef` on any
 * clone (see {@link withSourceIdentity}), so its basename match only acts on
 * the basename identity a legacy sidecar already has.
 */
export function sharedPluginBasenames(
  pluginPaths: readonly string[],
  descriptors: MirrorPluginDescriptors | undefined,
): ReadonlySet<string> {
  const installed = new Set(
    [...pluginPaths, ...Object.keys(descriptors ?? {})].map((p) => resolve(p)),
  );
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const pluginPath of installed) {
    const id = basename(pluginPath);
    if (seen.has(id)) shared.add(id);
    seen.add(id);
  }
  return shared;
}

/**
 * The durable intent written before a plugin agent's body is published
 * (`<slug>.ptah-origin-pending.json`). The body and its sidecar are two files,
 * so a failure or an exit between them leaves a body with no sidecar, which
 * every reader treats as user-authored. This record names the source and the
 * hash of the exact text being published, so a later pass can tell its own
 * interrupted publication (the body hash still matches) from a user's file.
 */
const PendingPublicationSchema = z.object({
  version: z.literal(1),
  slug: z.string(),
  pluginId: z.string(),
  sourceFile: z.string(),
  sourceRef: z.string().optional(),
  contentHash: z.string(),
});
type PendingPublication = z.infer<typeof PendingPublicationSchema>;

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
    const shared = sharedPluginBasenames(pass.pluginPaths, pass.descriptors);
    for (const source of await this.listSources(pass, result)) {
      await pass.withSlugLock(source.slug, () =>
        this.mirrorOne(
          source,
          pass.agentsRoot,
          claimed,
          shared.has(source.pluginId),
          result,
        ),
      );
    }
  }

  /** Three-way reconcile of every plugin agent clone this pass's sources own. */
  async reconcile(
    pass: PluginAgentPass,
    result: PluginAgentReconcileCounters,
    reconcileClone: ReconcilePluginAgentClone,
  ): Promise<void> {
    const shared = sharedPluginBasenames(pass.pluginPaths, pass.descriptors);
    for (const source of await this.listSources(pass, result)) {
      const cloneFile = join(pass.agentsRoot, `${source.slug}.md`);
      const sidecarPath = this.sidecarPath(pass.agentsRoot, source.slug);
      await pass.withSlugLock(source.slug, async () => {
        try {
          // A clone with no sidecar is user-authored: an interrupted
          // publication is resumed by `mirror`, which runs first in a pass.
          // `reconcileFileClone` would mint a sidecar naming this plugin, so
          // the file is left alone here.
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
          basenameShared: shared.has(source.pluginId),
        });
      });
    }
  }

  private async mirrorOne(
    source: PluginAgentSource,
    agentsRoot: string,
    claimed: Map<string, string>,
    basenameShared: boolean,
    result: PluginAgentMirrorCounters,
  ): Promise<void> {
    const cloneFile = join(agentsRoot, `${source.slug}.md`);
    const sidecarPath = this.sidecarPath(agentsRoot, source.slug);
    const pendingPath = this.pendingPath(agentsRoot, source.slug);
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
        await this.mirrorExisting(
          source,
          cloneFile,
          sidecarPath,
          pendingPath,
          claimed,
          basenameShared,
          result,
        );
        return;
      }

      await this.publish(source, agentsRoot, cloneFile, sidecarPath, pendingPath);
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

  /** A clone file already exists for this slug: whose is it? */
  private async mirrorExisting(
    source: PluginAgentSource,
    cloneFile: string,
    sidecarPath: string,
    pendingPath: string,
    claimed: Map<string, string>,
    basenameShared: boolean,
    result: PluginAgentMirrorCounters,
  ): Promise<void> {
    const sidecar = await readSidecarAt(sidecarPath);
    if (sidecar === null) {
      if (
        await this.resumePublication(source, cloneFile, sidecarPath, pendingPath)
      ) {
        claimed.set(source.slug, source.sourceFile);
        result.agentsMirrored += 1;
        return;
      }
      result.conflicts += 1;
      this.logger.info(
        '[UserLayerMirror] plugin agent not mirrored: clone owned by another source',
        { slug: source.slug, pluginId: source.pluginId, owner: 'user-authored' },
      );
      return;
    }

    const ownership = sourceOwnership(
      sidecar,
      source.pluginId,
      source.descriptor,
      basenameShared,
    );
    if (ownership === 'owned') {
      // A publication that stopped after its sidecar leaves its intent record
      // behind; the sidecar now says everything that record did.
      await this.fs.removePath(pendingPath);
      claimed.set(source.slug, source.sourceFile);
      result.skipped += 1;
      return;
    }
    if (ownership === 'ambiguous') {
      result.skipped += 1;
      this.logger.warn(
        '[UserLayerMirror] plugin agent kept: its legacy sidecar matches more than one plugin with this directory name',
        {
          slug: source.slug,
          pluginId: source.pluginId,
          sourceFile: source.sourceFile,
        },
      );
      return;
    }
    await this.recordConflict(sidecarPath, source.sourceFile);
    result.conflicts += 1;
    this.logger.info(
      '[UserLayerMirror] plugin agent not mirrored: clone owned by another source',
      { slug: source.slug, pluginId: source.pluginId, owner: sidecar.pluginId },
    );
  }

  /**
   * Publish a new clone: intent record, then body, then sidecar, then clear
   * the intent. The text is read once and hashed before it is written, so the
   * intent and the sidecar describe exactly the text in the body even when the
   * source changes during the copy.
   */
  private async publish(
    source: PluginAgentSource,
    agentsRoot: string,
    cloneFile: string,
    sidecarPath: string,
    pendingPath: string,
  ): Promise<void> {
    const content = await readFile(source.sourceFile, 'utf8');
    const contentHash = contentSourceHash(content);
    const pending: PendingPublication = {
      version: 1,
      slug: source.slug,
      pluginId: source.pluginId,
      sourceFile: source.sourceFile,
      ...(source.descriptor === undefined
        ? {}
        : { sourceRef: source.descriptor.sourceRef }),
      contentHash,
    };
    await mkdir(agentsRoot, { recursive: true });
    await this.fs.writeTextAtomic(pendingPath, JSON.stringify(pending, null, 2));
    await this.fs.writeTextAtomic(cloneFile, content);
    await this.writeOriginSidecar(source, sidecarPath, contentHash);
    await this.fs.removePath(pendingPath);
  }

  /**
   * Finish this source's interrupted publication of `cloneFile`, when that is
   * what the sidecar-less body is: an intent record for this exact source
   * whose hash still matches the body. A body edited since then is the user's
   * file, and its intent record is dropped so it can never be adopted later.
   *
   * @returns true when the sidecar was written and the clone is this source's.
   */
  private async resumePublication(
    source: PluginAgentSource,
    cloneFile: string,
    sidecarPath: string,
    pendingPath: string,
  ): Promise<boolean> {
    const pending = await this.readPending(pendingPath);
    if (
      pending === null ||
      pending.slug !== source.slug ||
      pending.pluginId !== source.pluginId ||
      pending.sourceFile !== source.sourceFile ||
      pending.sourceRef !== source.descriptor?.sourceRef
    ) {
      // Absent, or another source's intent: that source's own turn resumes it.
      return false;
    }
    if ((await computeSourceHash(cloneFile)) !== pending.contentHash) {
      await this.fs.removePath(pendingPath);
      this.logger.info(
        '[UserLayerMirror] interrupted plugin agent publication was edited since; kept as user-authored',
        { slug: source.slug, pluginId: source.pluginId },
      );
      return false;
    }
    await this.writeOriginSidecar(source, sidecarPath, pending.contentHash);
    await this.fs.removePath(pendingPath);
    this.logger.info(
      '[UserLayerMirror] resumed an interrupted plugin agent publication',
      { slug: source.slug, pluginId: source.pluginId },
    );
    return true;
  }

  /** The intent record at `pendingPath`, or null when absent or unreadable. */
  private async readPending(
    pendingPath: string,
  ): Promise<PendingPublication | null> {
    let raw: string;
    try {
      raw = await readFile(pendingPath, 'utf8');
    } catch (error: unknown) {
      if (this.fs.isEnoent(error)) return null;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error: unknown) {
      // degradation-audit: reported - a torn or hand-edited intent record
      // proves nothing about the body, so the body stays user-authored; the
      // warning names the file.
      this.logger.warn('[UserLayerMirror] unreadable plugin agent intent record', {
        pendingPath,
        error: errorMessage(error),
      });
      return null;
    }
    const checked = PendingPublicationSchema.safeParse(parsed);
    if (!checked.success) {
      this.logger.warn('[UserLayerMirror] malformed plugin agent intent record', {
        pendingPath,
        error: checked.error.message,
      });
      return null;
    }
    return checked.data;
  }

  private async writeOriginSidecar(
    source: PluginAgentSource,
    sidecarPath: string,
    sourceHash: string,
  ): Promise<void> {
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

  private pendingPath(agentsRoot: string, slug: string): string {
    return join(agentsRoot, `${slug}${PENDING_PUBLICATION_SUFFIX}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
