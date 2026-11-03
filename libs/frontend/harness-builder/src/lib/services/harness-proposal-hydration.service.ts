import { inject, Injectable, signal } from '@angular/core';
import { LoggingService } from '@ptah-extension/core';
import {
  mergeHarnessConfigUpdates,
  type HarnessConfig,
  type HarnessConfigProposedPayload,
  type HarnessProposal,
  type HarnessProposalRevision,
} from '@ptah-extension/shared';
import { HarnessProposalSchema } from '@ptah-extension/shared/schemas';
import {
  canonicalHarnessRoot,
  HARNESS_CHOICE_FIELDS,
  type HarnessChoiceField,
  type HarnessUserSnapshot,
} from './harness-builder-records.service';
import { HarnessRpcService } from './harness-rpc.service';

interface BoundProposalTab {
  readonly workspaceRoot: string;
  readonly originalWorkspaceRoot: string;
  readonly tabId: string;
  readonly sessionIds: ReadonlySet<string>;
}

interface ScopedRevision {
  readonly sessionId: string;
  readonly revision: HarnessProposalRevision;
}

export interface HarnessFoldedRevision {
  readonly id: string;
  readonly sessionId: string;
  readonly ordinal: number;
  readonly updatedAt: string;
  readonly isConfigComplete: boolean;
  readonly config: Partial<HarnessConfig>;
}

function mergeById<T>(
  base: readonly T[],
  update: readonly T[],
  id: (entry: T) => string,
): T[] {
  const byId = new Map(base.map((entry) => [id(entry), entry]));
  for (const entry of update) byId.set(id(entry), entry);
  return [...byId.values()];
}

/** Merge list proposals without deleting omitted IDs. Preset entries win matching IDs. */
export function mergeBuilderUpdates(
  base: Partial<HarnessConfig>,
  update: Partial<HarnessConfig>,
): Partial<HarnessConfig> {
  const agents = update.agents
    ? {
        ...update.agents,
        harnessSubagents:
          update.agents.harnessSubagents === undefined
            ? undefined
            : mergeById(
                base.agents?.harnessSubagents ?? [],
                update.agents.harnessSubagents,
                (item) => item.id,
              ),
      }
    : undefined;
  const skills = update.skills
    ? {
        ...update.skills,
        selectedSkills:
          update.skills.selectedSkills === undefined
            ? undefined
            : [
                ...new Set([
                  ...(base.skills?.selectedSkills ?? []),
                  ...update.skills.selectedSkills,
                ]),
              ],
        selectedSkillRefs:
          update.skills.selectedSkillRefs === undefined
            ? undefined
            : mergeById(
                base.skills?.selectedSkillRefs ?? [],
                update.skills.selectedSkillRefs,
                (item) => item.skillId,
              ),
        createdSkills:
          update.skills.createdSkills === undefined
            ? undefined
            : mergeById(
                base.skills?.createdSkills ?? [],
                update.skills.createdSkills,
                (item) => item.name,
              ),
      }
    : undefined;
  const mcp = update.mcp
    ? {
        ...update.mcp,
        servers:
          update.mcp.servers === undefined
            ? undefined
            : mergeById(
                base.mcp?.servers ?? [],
                update.mcp.servers,
                (item) => item.serverKey ?? item.name,
              ),
      }
    : undefined;
  return mergeHarnessConfigUpdates(base, {
    ...update,
    ...(agents ? { agents: agents as HarnessConfig['agents'] } : {}),
    ...(skills ? { skills: skills as HarnessConfig['skills'] } : {}),
    ...(mcp ? { mcp: mcp as HarnessConfig['mcp'] } : {}),
  });
}

function orderedRevisions(
  revisions: Iterable<ScopedRevision>,
): ScopedRevision[] {
  return [...revisions]
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const a =
        left.entry.revision.turnStartedAt ?? left.entry.revision.updatedAt;
      const b =
        right.entry.revision.turnStartedAt ?? right.entry.revision.updatedAt;
      const turnOrder = a.localeCompare(b);
      return (
        turnOrder ||
        left.entry.revision.updatedAt.localeCompare(
          right.entry.revision.updatedAt,
        ) ||
        left.index - right.index
      );
    })
    .map(({ entry }) => entry);
}

@Injectable({ providedIn: 'root' })
export class HarnessProposalHydrationService {
  private readonly rpc = inject(HarnessRpcService);
  private readonly logger = inject(LoggingService);
  private readonly _config = signal<Partial<HarnessConfig>>({});
  private readonly _status = signal<
    'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  >('idle');
  private readonly _isConfigComplete = signal(false);
  private readonly _foldedRevisions = signal<readonly HarnessFoldedRevision[]>([]);
  readonly config = this._config.asReadonly();
  readonly status = this._status.asReadonly();
  readonly isConfigComplete = this._isConfigComplete.asReadonly();
  readonly revisions = this._foldedRevisions.asReadonly();

  private bound: BoundProposalTab | null = null;
  private generation = 0;
  private revisionEntries = new Map<string, ScopedRevision>();
  private readonly knownProposalSessions = new Set<string>();
  private missingKnownProposal = false;
  private buffered: HarnessConfigProposedPayload[] = [];
  private snapshot: HarnessUserSnapshot | null = null;
  private loading = false;

  /** Bind only the session IDs owned by this route tab. An empty set has no fallback. */
  async bind(
    workspaceRoot: string,
    tabId: string,
    sessionIds: readonly string[],
    snapshot: HarnessUserSnapshot | null = null,
  ): Promise<void> {
    const root = canonicalHarnessRoot(workspaceRoot);
    const generation = ++this.generation;
    this.bound =
      root && tabId.trim()
        ? {
            workspaceRoot: root,
            originalWorkspaceRoot: workspaceRoot,
            tabId,
            sessionIds: new Set(sessionIds.filter(Boolean)),
          }
        : null;
    this.snapshot = this.belongsToBoundTab(snapshot) ? snapshot : null;
    this.revisionEntries.clear();
    this.missingKnownProposal = false;
    this.buffered = [];
    this._config.set({});
    this._foldedRevisions.set([]);
    this._isConfigComplete.set(false);
    if (!this.bound) {
      this._status.set('idle');
      return;
    }
    this.loading = true;
    this._status.set('loading');
    const bound = this.bound;
    try {
      const reads = await Promise.all(
        [...bound.sessionIds].map(async (sessionId) => {
          const result = await this.rpc.getProposal(
            sessionId,
            bound.originalWorkspaceRoot,
          );
          return { sessionId, proposal: result.proposal };
        }),
      );
      if (generation !== this.generation) return;
      this.missingKnownProposal = false;
      for (const { sessionId, proposal } of reads)
        this.addProposal(sessionId, proposal);
      const buffered = this.buffered;
      this.buffered = [];
      this.loading = false;
      for (const push of buffered) this.acceptPush(push);
      this.recompute();
    } catch (err) {
      if (generation !== this.generation) return;
      this.loading = false;
      this.buffered = [];
      this.logger.error(
        'HarnessProposalHydrationService',
        'Could not restore bound session proposals',
        err instanceof Error ? err : new Error(String(err)),
      );
      this._status.set('error');
    }
  }

  /** A live message carries the saved revision; older senders trigger a scoped read. */
  handlePush(push: HarnessConfigProposedPayload): void {
    if (!this.bound?.sessionIds.has(push.sessionId)) return;
    if (this.loading) {
      this.buffered.push(push);
      return;
    }
    this.acceptPush(push);
  }

  setSnapshot(snapshot: HarnessUserSnapshot | null): void {
    this.snapshot = this.belongsToBoundTab(snapshot) ? snapshot : null;
    this.recompute();
  }

  /** Retry a failed read without rebinding another tab or clearing the visible preview. */
  async retry(): Promise<void> {
    const bound = this.bound;
    if (!bound) return;
    const generation = this.generation;
    this._status.set('loading');
    this.loading = true;
    try {
      const reads = await Promise.all(
        [...bound.sessionIds].map(async (sessionId) => ({
          sessionId,
          proposal: (
            await this.rpc.getProposal(sessionId, bound.originalWorkspaceRoot)
          ).proposal,
        })),
      );
      if (generation !== this.generation) return;
      this.missingKnownProposal = false;
      for (const { sessionId, proposal } of reads)
        this.addProposal(sessionId, proposal);
      const buffered = this.buffered;
      this.buffered = [];
      this.loading = false;
      for (const push of buffered) this.acceptPush(push);
      this.recompute();
    } catch (err) {
      if (generation !== this.generation) return;
      this.loading = false;
      this.buffered = [];
      this.logger.error(
        'HarnessProposalHydrationService',
        'Could not retry bound session proposals',
        err instanceof Error ? err : new Error(String(err)),
      );
      this._status.set('error');
    }
  }

  clear(): void {
    this.generation++;
    this.bound = null;
    this.snapshot = null;
    this.revisionEntries.clear();
    this.missingKnownProposal = false;
    this.buffered = [];
    this.loading = false;
    this._config.set({});
    this._isConfigComplete.set(false);
    this._status.set('idle');
  }

  private belongsToBoundTab(snapshot: HarnessUserSnapshot | null): boolean {
    return (
      !!snapshot &&
      !!this.bound &&
      snapshot.workspaceRoot === this.bound.workspaceRoot &&
      snapshot.tabId === this.bound.tabId
    );
  }

  private addProposal(
    sessionId: string,
    proposal: HarnessProposal | null,
  ): void {
    if (!this.bound?.sessionIds.has(sessionId)) return;
    const key = `${this.bound.workspaceRoot}\u0000${sessionId}`;
    if (!proposal) {
      if (this.knownProposalSessions.has(key)) this.missingKnownProposal = true;
      return;
    }
    const parsed = HarnessProposalSchema.safeParse(proposal);
    if (
      !parsed.success ||
      parsed.data.sessionId !== sessionId ||
      canonicalHarnessRoot(parsed.data.workspaceRoot) !==
        this.bound.workspaceRoot
    ) {
      this.missingKnownProposal = true;
      return;
    }
    this.knownProposalSessions.add(key);
    for (const revision of parsed.data.revisions ?? [])
      this.addRevision(sessionId, revision);
  }

  private addRevision(
    sessionId: string,
    revision: HarnessProposalRevision,
  ): void {
    if (this.bound) {
      this.knownProposalSessions.add(
        `${this.bound.workspaceRoot}\u0000${sessionId}`,
      );
    }
    const key = `${sessionId}\u0000${revision.id}`;
    if (!this.revisionEntries.has(key))
      this.revisionEntries.set(key, { sessionId, revision });
  }

  private acceptPush(push: HarnessConfigProposedPayload): void {
    if (!this.bound?.sessionIds.has(push.sessionId)) return;
    if (!push.revision) {
      void this.refreshSession(push.sessionId, this.generation);
      return;
    }
    const parsed = HarnessProposalSchema.safeParse({
      version: 1,
      workspaceRoot: this.bound.workspaceRoot,
      sessionId: push.sessionId,
      configUpdates: push.revision.configUpdates,
      isConfigComplete: push.revision.isConfigComplete,
      updatedAt: push.revision.updatedAt,
      revisions: [push.revision],
    });
    if (!parsed.success) return;
    this.addRevision(push.sessionId, push.revision);
    this.recompute();
  }

  private async refreshSession(
    sessionId: string,
    generation: number,
  ): Promise<void> {
    const bound = this.bound;
    if (!bound) return;
    try {
      const result = await this.rpc.getProposal(
        sessionId,
        bound.originalWorkspaceRoot,
      );
      if (generation !== this.generation) return;
      this.addProposal(sessionId, result.proposal);
      this.recompute();
    } catch {
      if (generation === this.generation) {
        this.logger.warn(
          'HarnessProposalHydrationService',
          'Could not refresh bound session proposal',
        );
        this._status.set('error');
      }
    }
  }

  private recompute(): void {
    if (!this.bound || this.loading || this._status() === 'error') return;
    let config: Partial<HarnessConfig> = {};
    let folded: Partial<HarnessConfig> = {};
    const foldedRevisions: HarnessFoldedRevision[] = [];
    let complete = false;
    const pending = new Set<HarnessChoiceField>(
      HARNESS_CHOICE_FIELDS.filter(
        (field) => this.snapshot?.fields[field] !== undefined,
      ),
    );
    const applyChoice = (field: HarnessChoiceField): void => {
      pending.delete(field);
      const value = this.snapshot?.configUpdates[field];
      if (value !== undefined) {
        const choice: Partial<HarnessConfig> = {};
        Object.assign(choice, { [field]: value });
        config = mergeBuilderUpdates(config, choice);
      }
    };
    for (const { sessionId, revision } of orderedRevisions(this.revisionEntries.values())) {
      folded = mergeBuilderUpdates(folded, revision.configUpdates);
      foldedRevisions.push({
        id: revision.id,
        sessionId,
        ordinal: foldedRevisions.length + 1,
        updatedAt: revision.updatedAt,
        isConfigComplete: revision.isConfigComplete,
        config: { ...folded },
      });
      if (revision.turnStartedAt) {
        for (const field of [...pending]) {
          const chosenAt = this.snapshot?.fields[field]?.chosenAt;
          if (chosenAt && chosenAt < revision.turnStartedAt) applyChoice(field);
        }
      }
      config = mergeBuilderUpdates(config, revision.configUpdates);
      if (!revision.turnStartedAt) {
        for (const field of HARNESS_CHOICE_FIELDS) {
          if (
            this.snapshot?.fields[field] !== undefined &&
            revision.configUpdates[field] !== undefined
          )
            applyChoice(field);
        }
      }
      complete = revision.isConfigComplete;
    }
    for (const field of [...pending]) applyChoice(field);
    this._config.set(config);
    this._foldedRevisions.set(foldedRevisions);
    this._isConfigComplete.set(complete);
    this._status.set(
      this.revisionEntries.size || this.snapshot || !this.missingKnownProposal
        ? 'ready'
        : 'unavailable',
    );
  }
}
