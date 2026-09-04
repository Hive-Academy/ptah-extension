import { join } from 'node:path';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  CloneEntry,
  UserLayerMirrorService,
  UserLayerRoots,
} from '@ptah-extension/agent-generation';
import {
  SKILL_SYNTHESIS_TOKENS,
  USER_LAYER_MIRROR_SERVICE_TOKEN,
} from './di/tokens';
import { SkillCandidateStore } from './skill-candidate.store';
import {
  SkillRegistryStore,
  type CloneStatus,
  type SkillRegistryEntry,
  type SkillRegistryKind,
} from './skill-registry.store';

export interface CatalogSyncResult {
  readonly upserted: number;
  readonly linked: number;
}

@injectable()
export class SkillRegistryCatalogService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_STORE)
    private readonly registry: SkillRegistryStore,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE)
    private readonly candidates: SkillCandidateStore,
    @inject(USER_LAYER_MIRROR_SERVICE_TOKEN)
    private readonly mirror: UserLayerMirrorService,
  ) {}

  /**
   * @param workspaceRoot The workspace whose AGENT clones to catalogue. Agent
   *   clones are keyed by it (TASK_2026_365); skills and commands are
   *   per-machine and are catalogued whatever it says. Must be the same root
   *   `harness-sync` reconciles, or this reads a directory the mirror never
   *   wrote to and every agent row disappears from the catalog.
   */
  async sync(workspaceRoot?: string): Promise<CatalogSyncResult> {
    const clones = await this.mirror.listClones(workspaceRoot);
    const roots = this.mirror.getUserLayerRoots(workspaceRoot);
    return this.syncFromClones(clones, roots);
  }

  syncFromClones(
    clones: readonly CloneEntry[],
    roots: UserLayerRoots,
  ): CatalogSyncResult {
    let upserted = 0;
    let linked = 0;

    for (const clone of clones) {
      const candidate =
        clone.kind === 'skill' && clone.pluginId === null
          ? this.candidates.findByName(clone.slug)
          : null;
      const candidateId = candidate ? String(candidate.id) : null;
      const cloneStatus = this.deriveStatus(clone, candidateId !== null);
      const entry: SkillRegistryEntry = {
        slug: clone.slug,
        kind: clone.kind,
        userPath: this.resolveUserPath(roots, clone.kind, clone.slug),
        originPluginId: clone.pluginId,
        originVersion: null,
        sourceHash: clone.sourceHash,
        cloneStatus,
        diverged: clone.diverged,
        historyDir: null,
        lastEnhancedAt: clone.lastEnhancedAt,
        candidateId,
        pendingSourceHash: clone.pendingSourceHash,
      };
      this.registry.upsert(entry);
      upserted += 1;
      if (candidateId !== null) linked += 1;
    }

    this.logger.info('[skill-synthesis] skill_registry catalog synced', {
      upserted,
      linked,
    });
    return { upserted, linked };
  }

  private deriveStatus(clone: CloneEntry, hasCandidate: boolean): CloneStatus {
    if (clone.diverged) return 'diverged';
    if (hasCandidate) return 'synth';
    if (clone.pluginId !== null) return 'clone';
    return 'authored';
  }

  private resolveUserPath(
    roots: UserLayerRoots,
    kind: SkillRegistryKind,
    slug: string,
  ): string {
    const base =
      kind === 'skill'
        ? roots.skills
        : kind === 'agent'
          ? roots.agents
          : roots.commands;
    return join(base, slug);
  }
}
