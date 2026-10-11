import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import {
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';

/**
 * A follow-up has to go through session resume when the continuation record
 * expired or the agent never supported in-process continuation. Only true
 * when there is a session to resume with — without `cliSessionId` there is no
 * path at all, and saying "resumes the session" would promise one.
 */
export function followUpResumesInstead(agent: MonitoredAgent): boolean {
  return (
    !!agent.cliSessionId &&
    (agent.continuationExpired === true || agent.supportsContinuation !== true)
  );
}

const GENERIC_FAILURE = 'Could not send the follow-up. Try again.';

type AgentTextMap = ReadonlyMap<string, string>;

function withEntry(map: AgentTextMap, key: string, value: string): AgentTextMap {
  const next = new Map(map);
  next.set(key, value);
  return next;
}

function withoutEntry<T>(map: ReadonlyMap<string, T>, key: string) {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}

function withoutMissing<T>(
  map: ReadonlyMap<string, T>,
  present: ReadonlySet<string>,
): ReadonlyMap<string, T> {
  let next: Map<string, T> | null = null;
  for (const key of map.keys()) {
    if (present.has(key)) continue;
    next ??= new Map(map);
    next.delete(key);
  }
  return next ?? map;
}

/**
 * AgentFollowUpQueueService — holds a follow-up typed into an agent card while
 * the agent was still running, and sends it when the run ends
 * (TASK_2026_294 follow-up, moved out of the component in TASK_2026_524).
 *
 * The queue used to live in `AgentContinueInputComponent`, flushed by a
 * component effect. That component sits inside the shell row, which
 * `*ptahRetainWhile` detaches on a standalone surface, so its effect paused
 * and a queued follow-up waited until the user returned to chat. The flush
 * now runs from a root effect over `AgentMonitorStore.agents`, so it fires
 * whatever surface is showing.
 *
 * Everything is keyed by `agentId`. A message that fails to send is kept in
 * `undelivered` until a visible box takes it back into its draft, so a
 * background failure never drops the text. State for an agent that leaves
 * the store (its card was dismissed) is dropped, as it was when the
 * component was destroyed.
 *
 * Root singleton, instantiated eagerly by the shells.
 */
@Injectable({ providedIn: 'root' })
export class AgentFollowUpQueueService {
  private readonly store = inject(AgentMonitorStore);

  private readonly _queued = signal<AgentTextMap>(new Map());
  private readonly _undelivered = signal<AgentTextMap>(new Map());
  private readonly _errors = signal<AgentTextMap>(new Map());
  private readonly _sending = signal<ReadonlySet<string>>(new Set());

  /**
   * The agent object last considered for each queued entry. The flush only
   * retries once that agent's card has changed — the same cadence the old
   * per-card effect had — so a `busy` re-queue cannot spin on unrelated agent
   * updates.
   */
  private readonly lastSeen = new Map<string, MonitoredAgent>();

  constructor() {
    // Tracks `agents()` alone; the maps are read and written untracked so a
    // re-queue cannot re-trigger the flush that produced it.
    effect(() => {
      const agents = this.store.agents();
      untracked(() => this.flushIdle(agents));
    });
  }

  queued(agentId: string): string | null {
    return this._queued().get(agentId) ?? null;
  }

  undelivered(agentId: string): string | null {
    return this._undelivered().get(agentId) ?? null;
  }

  error(agentId: string): string | null {
    return this._errors().get(agentId) ?? null;
  }

  sending(agentId: string): boolean {
    return this._sending().has(agentId);
  }

  /**
   * Hold a follow-up for the end of the current run, coalescing repeats into
   * one message the same way `ConversationService.queueOrAppendMessage` does —
   * a second thought should not become a second turn.
   */
  enqueue(agentId: string, message: string): void {
    this._errors.update((map) => withoutEntry(map, agentId));
    const existing = this.queued(agentId);
    this._queued.update((map) =>
      withEntry(map, agentId, existing ? `${existing}\n${message}` : message),
    );
    const current = this.store.agents().find((a) => a.agentId === agentId);
    if (current) this.lastSeen.set(agentId, current);
  }

  /** Remove and return the queued follow-up, for editing in the box. */
  unqueue(agentId: string): string | null {
    const pending = this.queued(agentId);
    if (pending === null) return null;
    this.dropQueued(agentId);
    return pending;
  }

  /** Remove and return text that failed to send, for the box to restore. */
  takeUndelivered(agentId: string): string | null {
    const message = this.undelivered(agentId);
    if (message === null) return null;
    this._undelivered.update((map) => withoutEntry(map, agentId));
    return message;
  }

  /**
   * Actually send a follow-up. Shared by the box's direct send and the
   * background flush. Never throws; a failure lands in `undelivered` and
   * `error`.
   */
  async send(agent: MonitoredAgent, message: string): Promise<void> {
    const agentId = agent.agentId;
    this._sending.update((set) => new Set(set).add(agentId));
    this._errors.update((map) => withoutEntry(map, agentId));
    try {
      // A card whose record we already know is gone skips the round trip that
      // can only answer `not_found` and resumes straight away.
      const current = this.latestCard(agent);
      if (followUpResumesInstead(current)) {
        await this.sendByResuming(current, message);
        return;
      }

      const result = await this.store.continueAgent(agentId, message);
      if (result.ok) return;
      if (result.code === 'busy') {
        // The card's status had not caught up with the backend yet. Re-queue
        // rather than erroring — the flush retries at the real turn end.
        this.enqueue(agentId, message);
      } else if (
        result.code === 'not_found' ||
        result.code === 'released' ||
        result.code === 'unsupported'
      ) {
        // `not_found`: the record aged out (or the host restarted) without us
        // hearing about it. `released`: the record is still there but its
        // process was reclaimed after idling, so there is nothing in memory to
        // continue INTO. `unsupported` means the adapter has no in-process
        // continuation capability. In every case the CONVERSATION is still on
        // disk, so resume it rather than telling the user to start over and lose
        // the context. Re-read the card: the store can merge a late
        // `cliSessionId` into it while `agent:continue` was in flight, and the
        // snapshot taken before the await would wrongly say there is no
        // session to resume.
        await this.sendByResuming(this.latestCard(agent), message);
      } else {
        this.fail(agentId, message, GENERIC_FAILURE);
      }
    } catch (error: unknown) {
      this.fail(
        agentId,
        message,
        error instanceof Error ? error.message : GENERIC_FAILURE,
      );
    } finally {
      this._sending.update((set) => {
        const next = new Set(set);
        next.delete(agentId);
        return next;
      });
    }
  }

  /**
   * The store's current card for this agent, or the caller's snapshot when the
   * card is gone. Sends hold a card across awaits, and the store keeps merging
   * fields such as `cliSessionId` into it meanwhile.
   */
  private latestCard(snapshot: MonitoredAgent): MonitoredAgent {
    return (
      this.store.agents().find((a) => a.agentId === snapshot.agentId) ??
      snapshot
    );
  }

  /**
   * Deliver the follow-up by resuming the CLI-native session. The resumed run
   * arrives as a fresh agent card (a new `agentId`), which replaces this one.
   */
  private async sendByResuming(
    agent: MonitoredAgent,
    message: string,
  ): Promise<void> {
    if (!agent.cliSessionId) {
      this.fail(
        agent.agentId,
        message,
        'Agent expired and has no session to resume.',
      );
      return;
    }

    const resumed = await this.store.resumeAgentWithMessage(agent, message);
    if (resumed.ok) return;
    this.fail(
      agent.agentId,
      message,
      resumed.error
        ? `Could not resume the session: ${resumed.error}`
        : 'Could not resume the session. Try again.',
    );
  }

  /**
   * Keep a message that failed to send. Without this a queued follow-up that
   * fails at flush time is gone — the user never retyped it and never saw it
   * leave, which is the loss this whole queue exists to stop.
   */
  private fail(agentId: string, message: string, reason: string): void {
    const earlier = this.undelivered(agentId);
    this._undelivered.update((map) =>
      withEntry(map, agentId, earlier ? `${earlier}\n${message}` : message),
    );
    this._errors.update((map) => withEntry(map, agentId, reason));
  }

  private flushIdle(agents: readonly MonitoredAgent[]): void {
    this.dropDismissed(agents);
    for (const agent of agents) {
      const pending = this.queued(agent.agentId);
      if (pending === null) continue;
      if (this.lastSeen.get(agent.agentId) === agent) continue;
      this.lastSeen.set(agent.agentId, agent);
      if (agent.status === 'running') continue;
      this.dropQueued(agent.agentId);
      void this.send(agent, pending);
    }
  }

  private dropDismissed(agents: readonly MonitoredAgent[]): void {
    const present = new Set(agents.map((a) => a.agentId));
    this._queued.update((map) => withoutMissing(map, present));
    this._undelivered.update((map) => withoutMissing(map, present));
    this._errors.update((map) => withoutMissing(map, present));
    for (const agentId of this.lastSeen.keys()) {
      if (!present.has(agentId)) this.lastSeen.delete(agentId);
    }
  }

  private dropQueued(agentId: string): void {
    this._queued.update((map) => withoutEntry(map, agentId));
    this.lastSeen.delete(agentId);
  }
}
