import { randomUUID } from 'node:crypto';
import type { RpcMethodResult, SessionId } from '@ptah-extension/shared';
import { IN_PROCESS_SPECS, InProcessRpc, type RpcSpec } from './in-process-rpc';
import { SessionLogWriter } from './session-log-writer';
import { SessionEventLog } from './session-event-log';
import { historyMark, Transcript } from './transcript';

export type DriverErrorCode =
  | 'TURN_IN_FLIGHT'
  | 'WORKER_BUSY'
  | 'NO_PROVIDER_READY'
  | 'CODEX_UNAVAILABLE'
  | 'DRIVER_LOCK_UNAVAILABLE'
  | 'SESSION_LOG_FAILED'
  | 'INTERNAL';
export class SessionDriverError extends Error {
  constructor(readonly code: DriverErrorCode) {
    super(code);
  }
}

export interface SessionMetadataReader {
  get(
    sessionId: string,
  ): Promise<{ codexExecution?: { runtime?: string } } | null>;
}
export interface DriverTurn {
  sessionId: string;
  tabId: string;
  turnId: string;
}
export interface DriverStart {
  tabId: string;
  prompt: string;
  workspacePath: string;
  name?: string;
}
export interface SessionDriverOptions {
  /** W6: how long `start` waits for `session:id-resolved` (default 30 s). */
  resolveTimeoutMs?: number;
  /** Called after an admitted turn that never registered was aborted. */
  onAbandoned?: (sessionId: string) => void;
  /**
   * Called after the engine ended a started turn that never reported its
   * session ID. Its driver lock is keyed by a session this driver never
   * learned, so the caller decides which held lock it was.
   */
  onUnresolvedEnded?: () => void;
}
/** What `drain` could not stop: tab-only orphans and refused aborts. */
export interface DrainResult {
  unresolvedTabs: string[];
  failedAborts: string[];
}

type Deliver = (sessionId: string, event: unknown) => void;
const QUEUE_LIMIT = 10_000;

/**
 * One turn between admission and registration. `admitting` counts against the
 * active-turn limit until it registers or fails. An `orphan` is an engine turn
 * that was admitted but could not be registered or aborted yet: it keeps its
 * slot until its session ID is known and `chat:abort` succeeds.
 */
interface Admission {
  readonly key: string;
  readonly tabId: string;
  state: 'admitting' | 'orphan';
  sessionId?: string;
  /** A terminal engine event arrived before registration. */
  ended: boolean;
  /** Events for this turn that arrived before `worker:turn.begin`. */
  readonly buffer: unknown[];
  deliver?: Deliver;
  overflowed: boolean;
  waiter?: { resolve(id: string): void; reject(error: Error): void };
  readonly settled: Promise<void>;
  settle(): void;
}

/** The local chat RPC is the only turn admission path; its coordinator owns the lock. */
export class SessionDriver {
  /** Events routed to an early tab queue that overflowed. */
  dropped = 0;
  private readonly tabs = new Map<string, string>();
  private readonly early = new Map<string, unknown[]>();
  private readonly turns = new Map<string, DriverTurn>();
  private readonly ending = new Set<string>();
  private readonly admissions = new Map<string, Admission>();
  private closing = false;
  private readonly resolveTimeoutMs: number;
  constructor(
    private readonly rpc: InProcessRpc,
    private readonly transcript: Transcript,
    private readonly metadata: SessionMetadataReader,
    private readonly writerFor: (sessionId: string) => SessionLogWriter,
    private readonly providerReady: () => boolean,
    private readonly maxActiveTurns: number,
    private readonly options: SessionDriverOptions = {},
  ) {
    this.resolveTimeoutMs = options.resolveTimeoutMs ?? 30_000;
  }

  resolveTab(tabId: string, sessionId: string, deliver: Deliver): void {
    this.tabs.set(tabId, sessionId);
    for (const event of this.early.get(tabId) ?? []) deliver(sessionId, event);
    this.early.delete(tabId);
  }

  /**
   * Routes a tab-keyed event. A tab that is being admitted buffers it until
   * its turn begins. Never throws: it runs inside the synchronous push tap.
   */
  route(tabId: string, event: unknown, deliver: Deliver): void {
    const sessionId = this.tabs.get(tabId);
    if (sessionId) {
      this.routeSession(sessionId, event, deliver);
      return;
    }
    const admission = this.byTab(tabId);
    if (admission) {
      this.hold(admission, event, deliver);
      return;
    }
    const queue = this.early.get(tabId) ?? [];
    if (queue.length >= QUEUE_LIMIT) {
      this.dropped += 1;
      return;
    }
    queue.push(event);
    this.early.set(tabId, queue);
  }

  /** Routes a session-keyed event; a turn still being admitted buffers it (W7 order). */
  routeSession(sessionId: string, event: unknown, deliver: Deliver): void {
    const admission = this.bySession(sessionId);
    if (admission) this.hold(admission, event, deliver);
    else deliver(sessionId, event);
  }

  sessionForTab(tabId: string): string | undefined {
    return this.tabs.get(tabId);
  }
  /** The session of a tab, including one resolved while its start is admitting. */
  knownSession(tabId: string): string | undefined {
    return this.tabs.get(tabId) ?? this.byTab(tabId)?.sessionId;
  }
  /** True while a `start` on this tab waits for registration. */
  admittingTab(tabId: string): boolean {
    return this.byTab(tabId) !== undefined;
  }
  /**
   * True while a start on this tab has no session ID yet, including one that
   * timed out and still waits for `session:id-resolved` as an orphan.
   */
  awaitingSession(tabId: string): boolean {
    for (const admission of this.admissions.values())
      if (admission.tabId === tabId && !admission.sessionId) return true;
    return false;
  }
  /**
   * Started turns that never reported a session ID and were not ended by the
   * engine: their engine turn may still run under a driver lock whose session
   * this driver does not know.
   */
  unresolvedStarts(): number {
    let count = 0;
    for (const admission of this.admissions.values())
      if (!admission.sessionId) count += 1;
    return count;
  }
  driving(sessionId: string): boolean {
    return this.turns.has(sessionId);
  }
  /**
   * True while an engine turn of this session may still run: a registered
   * turn, a start being admitted, or an orphan whose abort was refused.
   * Its driver lock must stay held until the engine reports it ended.
   */
  running(sessionId: string): boolean {
    if (this.turns.has(sessionId)) return true;
    for (const admission of this.admissions.values())
      if (admission.sessionId === sessionId) return true;
    return false;
  }
  forgetTab(tabId: string): void {
    this.tabs.delete(tabId);
    this.early.delete(tabId);
  }

  /** The backend reported the session of a tab (`session:id-resolved`). */
  tabResolved(tabId: string, sessionId: string): void {
    for (const admission of this.admissions.values()) {
      if (admission.tabId !== tabId || admission.sessionId) continue;
      admission.sessionId = sessionId;
      if (admission.state === 'admitting') admission.waiter?.resolve(sessionId);
      else void this.retire(admission);
    }
  }

  /**
   * A terminal engine event (`session:turnEnded`, ...). A registered turn ends
   * now; a turn still being admitted ends right after it registers.
   */
  async terminal(sessionId?: string, tabId?: string): Promise<void> {
    const id = sessionId ?? (tabId ? this.knownSession(tabId) : undefined);
    if (id && this.turns.has(id)) {
      await this.end(id);
      return;
    }
    const admission =
      (id ? this.bySession(id) : undefined) ??
      (tabId ? this.byTab(tabId) : undefined);
    if (admission) {
      admission.ended = true;
      return;
    }
    // The engine ended an orphan: one whose abort was refused, or a start that
    // never reported its session (matched by its tab). Free its slot and lock.
    for (const orphan of [...this.admissions.values()]) {
      if (orphan.state !== 'orphan') continue;
      const matches = orphan.sessionId
        ? orphan.sessionId === id || (!id && orphan.tabId === tabId)
        : orphan.tabId === tabId;
      if (!matches) continue;
      this.admissions.delete(orphan.key);
      const ended = orphan.sessionId ?? sessionId;
      if (ended) this.options.onAbandoned?.(ended);
      else this.options.onUnresolvedEnded?.();
    }
  }

  async attach(
    sessionId: string,
    log: SessionEventLog | null,
    writer: SessionLogWriter | null,
    afterSeq?: number,
  ) {
    let metadata;
    try {
      metadata = await this.metadata.get(sessionId);
    } catch {
      throw new SessionDriverError('INTERNAL');
    }
    return this.transcript.attach(
      sessionId,
      log,
      writer,
      afterSeq,
      this.driving(sessionId),
      metadata?.codexExecution?.runtime === 'codex-app-server',
    );
  }

  async continue(
    sessionId: string,
    tabId: string,
    prompt: string,
  ): Promise<DriverTurn> {
    // Metadata must be read before the RPC; a failed read is a refusal.
    let metadata;
    try {
      metadata = await this.metadata.get(sessionId);
    } catch {
      throw new SessionDriverError('INTERNAL');
    }
    if (metadata?.codexExecution?.runtime === 'codex-app-server')
      throw new SessionDriverError('CODEX_UNAVAILABLE');
    if (!this.providerReady())
      throw new SessionDriverError('NO_PROVIDER_READY');
    if (
      this.turns.has(sessionId) ||
      [...this.admissions.values()].some(
        (admission) => admission.sessionId === sessionId,
      )
    )
      throw new SessionDriverError('TURN_IN_FLIGHT');
    const admission = this.admit(sessionId, tabId);
    admission.sessionId = sessionId;
    try {
      const result = await this.rpc.call(
        'chat:continue',
        { sessionId: sessionId as SessionId, tabId, prompt },
        IN_PROCESS_SPECS['chat:continue'] as unknown as RpcSpec<
          RpcMethodResult<'chat:continue'>
        >,
      );
      if (!result.ok) {
        if (result.error.code === 'DRIVER_LOCK_UNAVAILABLE')
          throw new SessionDriverError('DRIVER_LOCK_UNAVAILABLE');
        throw new SessionDriverError('INTERNAL');
      }
      // Admission has acquired the coordinator lock. Only now may history be read.
      return await this.register(admission, sessionId, async (writer) => {
        await this.transcript.baseline(sessionId, writer);
      });
    } finally {
      this.release(admission);
    }
  }

  /**
   * Starts a new session on a worker tab. The session ID comes from
   * `tabResolved`; `open` opens its log. Tab events that arrived first are
   * delivered after the empty baseline and `worker:turn.begin`, in arrival order.
   */
  async start(
    params: DriverStart,
    open: (sessionId: string) => Promise<void>,
    deliver: Deliver,
  ): Promise<DriverTurn> {
    if (!this.providerReady())
      throw new SessionDriverError('NO_PROVIDER_READY');
    // Session IDs never contain ':', so a tab key cannot collide.
    const admission = this.admit(`tab:${params.tabId}`, params.tabId);
    admission.deliver = deliver;
    try {
      const result = await this.rpc.call(
        'chat:start',
        {
          tabId: params.tabId,
          prompt: params.prompt,
          workspacePath: params.workspacePath,
          ...(params.name ? { name: params.name } : {}),
        },
        IN_PROCESS_SPECS['chat:start'] as unknown as RpcSpec<
          RpcMethodResult<'chat:start'>
        >,
      );
      if (!result.ok) {
        if (result.error.code === 'DRIVER_LOCK_UNAVAILABLE')
          throw new SessionDriverError('DRIVER_LOCK_UNAVAILABLE');
        throw new SessionDriverError('INTERNAL');
      }
      let sessionId: string;
      try {
        sessionId = await this.sessionOf(admission);
      } catch {
        if (admission.ended) {
          // The engine already ended this turn: nothing runs, so its slot
          // and its lock go now.
          this.admissions.delete(admission.key);
          this.options.onUnresolvedEnded?.();
        } else {
          // The engine turn runs without a known session: keep the slot and
          // abort it when `session:id-resolved` arrives (see tabResolved),
          // or free it on its terminal event (see terminal).
          admission.state = 'orphan';
          admission.buffer.length = 0;
        }
        throw new SessionDriverError('INTERNAL');
      }
      return await this.register(
        admission,
        sessionId,
        async (writer) => {
          // A new session has no history before its first turn.
          await writer.enqueue('worker:baseline', {
            events: [],
            historyMark: historyMark([]),
          });
        },
        open,
      );
    } finally {
      this.release(admission);
    }
  }

  async end(sessionId: string): Promise<void> {
    const turn = this.turns.get(sessionId);
    // Two terminal events for one turn write one end record.
    if (!turn || this.ending.has(sessionId)) return;
    this.ending.add(sessionId);
    const writer = this.writerFor(sessionId);
    try {
      await writer.enqueue('worker:turn.end', { turnId: turn.turnId });
      await this.transcript.mark(sessionId, turn.turnId, writer);
    } finally {
      this.ending.delete(sessionId);
      if (this.turns.get(sessionId) === turn) this.turns.delete(sessionId);
    }
  }

  /**
   * Aborts the session's engine turn. Returns false when `chat:abort` was
   * refused: the turn, its slot and its log stay as they are.
   */
  async abort(sessionId: string): Promise<boolean> {
    const turn = this.turns.get(sessionId);
    if (!(await this.chatAbort(sessionId))) return false;
    if (!turn || this.turns.get(sessionId) !== turn) return true;
    this.turns.delete(sessionId);
    await this.interrupted(sessionId, turn);
    return true;
  }

  /** Closes a begun turn in the log. */
  private async interrupted(
    sessionId: string,
    turn: DriverTurn,
  ): Promise<void> {
    const writer = this.writerFor(sessionId);
    if (writer.degraded) return;
    // degradation-audit: reported - a failed append degrades the writer, which
    // sends subscribers ctl session-state; log recovery closes the turn on restart.
    await writer
      .enqueue('worker:turn.interrupted', { turnId: turn.turnId })
      .catch(() => undefined);
  }

  /**
   * Shutdown: refuse new turns, cancel starts waiting for their session ID,
   * wait for the other admissions, then abort every admitted turn.
   */
  async drain(): Promise<DrainResult> {
    this.closing = true;
    const pending = [...this.admissions.values()].filter(
      (admission) => admission.state === 'admitting',
    );
    for (const admission of pending)
      admission.waiter?.reject(new Error('Worker is shutting down'));
    await Promise.all(pending.map((admission) => admission.settled));
    const failedAborts: string[] = [];
    for (const sessionId of [...this.turns.keys()])
      if (!(await this.abort(sessionId))) failedAborts.push(sessionId);
    const unresolvedTabs: string[] = [];
    for (const admission of [...this.admissions.values()]) {
      if (!admission.sessionId) unresolvedTabs.push(admission.tabId);
      else if (!(await this.retire(admission)))
        failedAborts.push(admission.sessionId);
    }
    return { unresolvedTabs, failedAborts };
  }

  /** Wire this callback into SessionLogWriterOptions.onAppendFailed. */
  onAppendFailed = (sessionId: string): void => {
    void this.abort(sessionId);
  };

  private admit(key: string, tabId: string): Admission {
    if (this.closing) throw new SessionDriverError('WORKER_BUSY');
    if (this.turns.size + this.admissions.size >= this.maxActiveTurns)
      throw new SessionDriverError('WORKER_BUSY');
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const admission: Admission = {
      key,
      tabId,
      state: 'admitting',
      ended: false,
      buffer: [],
      overflowed: false,
      settled,
      settle,
    };
    this.admissions.set(key, admission);
    return admission;
  }

  /** Ends an admission; an orphan keeps its slot until it is retired. */
  private release(admission: Admission): void {
    admission.waiter = undefined;
    if (admission.state === 'admitting') this.admissions.delete(admission.key);
    admission.settle();
  }

  /**
   * Writes the baseline and `worker:turn.begin`, registers the turn, flushes
   * the events that arrived during admission, and ends it if a terminal event
   * came first. A failure aborts the engine turn before it is reported.
   */
  private async register(
    admission: Admission,
    sessionId: string,
    baseline: (writer: SessionLogWriter) => Promise<void>,
    open?: (sessionId: string) => Promise<void>,
  ): Promise<DriverTurn> {
    let turn: DriverTurn | undefined;
    try {
      if (open) await open(sessionId);
      const writer = this.writerFor(sessionId);
      await baseline(writer);
      turn = { sessionId, tabId: admission.tabId, turnId: randomUUID() };
      await writer.enqueue('worker:turn.begin', { turnId: turn.turnId });
      if (admission.overflowed)
        throw new SessionDriverError('SESSION_LOG_FAILED');
      // Registration and the flush are one synchronous step, so no event
      // can overtake the buffered ones.
      this.turns.set(sessionId, turn);
      this.admissions.delete(admission.key);
      const deliver = admission.deliver;
      if (deliver) this.resolveTab(admission.tabId, sessionId, deliver);
      else this.tabs.set(admission.tabId, sessionId);
      for (const event of admission.buffer.splice(0))
        deliver?.(sessionId, event);
    } catch (error) {
      if (!(await this.chatAbort(sessionId))) {
        // Still running in the engine: keep the slot, retry at shutdown.
        admission.state = 'orphan';
        admission.sessionId = sessionId;
        admission.buffer.length = 0;
      } else {
        if (turn) await this.interrupted(sessionId, turn);
        this.options.onAbandoned?.(sessionId);
      }
      throw error;
    }
    if (admission.ended) await this.end(sessionId);
    return turn;
  }

  /** Aborts an orphan whose session is known; frees its slot when that worked. */
  private async retire(admission: Admission): Promise<boolean> {
    const sessionId = admission.sessionId;
    if (!sessionId || !(await this.chatAbort(sessionId))) return false;
    // A terminal event during the abort already freed it and its lock.
    if (this.admissions.get(admission.key) !== admission) return true;
    this.admissions.delete(admission.key);
    this.options.onAbandoned?.(sessionId);
    return true;
  }

  private sessionOf(admission: Admission): Promise<string> {
    if (admission.sessionId) return Promise.resolve(admission.sessionId);
    // Shutdown already cancelled the waiters: do not hold drain for the timeout.
    if (this.closing)
      return Promise.reject(new Error('Worker is shutting down'));
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        admission.waiter = undefined;
        reject(new Error('session:id-resolved did not arrive'));
      }, this.resolveTimeoutMs);
      admission.waiter = {
        resolve: (id) => {
          clearTimeout(timer);
          admission.waiter = undefined;
          resolve(id);
        },
        reject: (error) => {
          clearTimeout(timer);
          admission.waiter = undefined;
          reject(error);
        },
      };
    });
  }

  private async chatAbort(sessionId: string): Promise<boolean> {
    const result = await this.rpc.call(
      'chat:abort',
      { sessionId: sessionId as SessionId },
      IN_PROCESS_SPECS['chat:abort'] as unknown as RpcSpec<
        RpcMethodResult<'chat:abort'>
      >,
    );
    return result.ok;
  }

  private hold(admission: Admission, event: unknown, deliver: Deliver): void {
    if (admission.state !== 'admitting' || admission.overflowed) return;
    admission.deliver ??= deliver;
    if (admission.buffer.length >= QUEUE_LIMIT) {
      // Registration refuses an overflowed turn (SESSION_LOG_FAILED).
      admission.overflowed = true;
      admission.buffer.length = 0;
      return;
    }
    admission.buffer.push(event);
  }

  private byTab(tabId: string): Admission | undefined {
    for (const admission of this.admissions.values())
      if (admission.tabId === tabId && admission.state === 'admitting')
        return admission;
    return undefined;
  }

  private bySession(sessionId: string): Admission | undefined {
    for (const admission of this.admissions.values())
      if (admission.sessionId === sessionId && admission.state === 'admitting')
        return admission;
    return undefined;
  }
}
