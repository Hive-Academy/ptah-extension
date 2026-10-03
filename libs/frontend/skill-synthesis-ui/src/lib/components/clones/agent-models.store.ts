/**
 * The per-agent model settings the desktop Agents tab shows (TASK_2026_609,
 * plan C6), read by `AgentModelEditorComponent` on each agent card.
 *
 * Loads the two settings layers, the suggestion lists and the lane defaults
 * once per Agents-tab entry, Refresh and workspace switch, and adopts a
 * successful save's re-read layers. Every load and save is tied to a
 * {@link AgentModelsTicket}: replies for another workspace, or older than the
 * last load or adopted save, are discarded.
 */
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import type {
  AgentListCliModelsResult,
  AgentModelProvider,
  AgentModelSettingsScope,
  AgentOrchestrationConfig,
  SkillSynthesisGetAgentModelsResult,
  SkillSynthesisSetAgentModelResult,
} from '@ptah-extension/shared';

import { SkillSynthesisRpcService } from '../../services/skill-synthesis-rpc.service';

/**
 * Which workspace an operation belongs to. A reply whose ticket is no longer
 * {@link AgentModelsStore.isCurrent} is discarded.
 */
export interface AgentModelsTicket {
  /** {@link AgentModelsStore.workspaceEpoch} when the operation started. */
  readonly epoch: number;
  /** The host's `workspaceRoot` when the operation started. */
  readonly hostRoot: string;
  /** The loaded snapshot's resolved `workspaceRoot` (what a save sends). */
  readonly workspaceRoot: string | null;
}

/** Each lane's default model in `agent:getConfig`; `''` = CLI default. */
function laneDefaults(
  config: AgentOrchestrationConfig,
): Partial<Record<AgentModelProvider, string>> {
  return {
    codex: config.codexModel,
    copilot: config.copilotModel,
    cursor: config.cursorModel,
    opencode: config.opencodeModel ?? '',
  };
}

function suggestionIds(
  lists: AgentListCliModelsResult,
): Partial<Record<AgentModelProvider, readonly string[]>> {
  const ids = (entries: readonly { id: string }[] | undefined) =>
    (entries ?? []).map((entry) => entry.id);
  return {
    codex: ids(lists.codex),
    copilot: ids(lists.copilot),
    cursor: ids(lists.cursor),
    opencode: ids(lists.opencode),
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The model settings the Agents tab shows. Provided by the Library view, so it
 * lives and dies with that surface; nothing here polls.
 */
// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- per-surface, provided by SkillClonesViewComponent (same as CloneBulkRebaseService).
@Injectable()
export class AgentModelsStore {
  private readonly rpc = inject(SkillSynthesisRpcService);
  private readonly vscode = inject(VSCodeService);

  private readonly _snapshot =
    signal<SkillSynthesisGetAgentModelsResult | null>(null);
  private readonly _suggestions = signal<
    Partial<Record<AgentModelProvider, readonly string[]>>
  >({});
  private readonly _laneDefaults = signal<Partial<
    Record<AgentModelProvider, string>
  > | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _workspaceEpoch = signal(0);

  public readonly snapshot = this._snapshot.asReadonly();
  /** Input suggestions per provider (never used to classify). */
  public readonly suggestions = this._suggestions.asReadonly();
  /** `null` while `agent:getConfig` is unread or failed. */
  public readonly laneDefaults = this._laneDefaults.asReadonly();
  public readonly loading = this._loading.asReadonly();
  public readonly error = this._error.asReadonly();
  /** Bumped on every workspace switch; editors drop their drafts on it. */
  public readonly workspaceEpoch = this._workspaceEpoch.asReadonly();

  /** Set by the first {@link load}; a workspace switch reloads only after it. */
  private requested = false;
  /**
   * Bumped by every {@link load} and every adopted save. A load reply is
   * applied only while its revision is still the latest, so neither an older
   * load nor a load that started before a successful save can overwrite it.
   */
  private revision = 0;

  public constructor() {
    // WORKSPACE_CHANGED updates `workspaceRoot` here; Electron does not reload
    // the view, so the models read for the old workspace must be replaced.
    let lastRoot: string | undefined;
    effect(() => {
      const root = this.vscode.config()?.workspaceRoot ?? '';
      const changed = lastRoot !== undefined && root !== lastRoot;
      lastRoot = root;
      if (!changed) return;
      untracked(() => {
        this._workspaceEpoch.update((n) => n + 1);
        if (this.requested) void this.load();
      });
    });
  }

  /** The workspace identity an operation starting now belongs to. */
  public ticket(): AgentModelsTicket {
    return {
      epoch: untracked(this._workspaceEpoch),
      hostRoot: this.hostRoot(),
      workspaceRoot: untracked(this._snapshot)?.workspaceRoot ?? null,
    };
  }

  /**
   * Whether a reply for `ticket` still belongs to the shown workspace. Reads
   * the host root directly as well as the epoch, so a reply that arrives
   * before the switch effect has run is already stale.
   */
  public isCurrent(ticket: AgentModelsTicket): boolean {
    return (
      ticket.epoch === untracked(this._workspaceEpoch) &&
      ticket.hostRoot === this.hostRoot()
    );
  }

  /** Read both layers, the suggestion lists and the lane defaults. */
  public async load(): Promise<void> {
    this.requested = true;
    const rev = ++this.revision;
    const ticket = this.ticket();
    this._loading.set(true);
    // `then` turns a synchronous throw into a rejection, so `load` never rejects.
    const attempt = <T>(call: () => Promise<T>): Promise<T> =>
      Promise.resolve().then(call);
    const [models, lists, config] = await Promise.allSettled([
      attempt(() => this.rpc.getAgentModels()),
      attempt(() => this.rpc.listCliModels()),
      attempt(() => this.rpc.getAgentLaneConfig()),
    ]);
    // A newer load or an adopted save superseded this reply, or the workspace
    // changed (the switch starts its own load).
    if (rev !== this.revision || !this.isCurrent(ticket)) return;
    if (models.status === 'fulfilled') {
      this._snapshot.set(models.value);
      this._error.set(null);
    } else {
      this._snapshot.set(null);
      this._error.set(messageOf(models.reason));
    }
    this._suggestions.set(
      lists.status === 'fulfilled' ? suggestionIds(lists.value) : {},
    );
    this._laneDefaults.set(
      config.status === 'fulfilled' ? laneDefaults(config.value) : null,
    );
    this._loading.set(false);
  }

  /**
   * Adopt a successful save's re-read layers and its classification, when the
   * save still belongs to the shown workspace. Loads that started before this
   * are superseded: their reply may predate the write.
   *
   * @returns whether the result was adopted.
   */
  public applySaved(
    ticket: AgentModelsTicket,
    scope: AgentModelSettingsScope,
    slug: string,
    provider: AgentModelProvider,
    result: SkillSynthesisSetAgentModelResult,
  ): boolean {
    const shown = this._snapshot();
    if (
      !this.isCurrent(ticket) ||
      shown === null ||
      shown.workspaceRoot !== ticket.workspaceRoot
    ) {
      return false;
    }
    this.revision++;
    this._loading.set(false);
    this._snapshot.update((current) => {
      if (current === null) return current;
      const layer = { ...current.classification[scope] };
      const entry = { ...(layer[slug] ?? {}) };
      if (result.classification === 'empty') delete entry[provider];
      else entry[provider] = result.classification;
      layer[slug] = entry;
      return {
        ...current,
        machine: result.machine,
        workspace: result.workspace,
        classification: { ...current.classification, [scope]: layer },
      };
    });
    return true;
  }

  private hostRoot(): string {
    return untracked(() => this.vscode.config())?.workspaceRoot ?? '';
  }
}
