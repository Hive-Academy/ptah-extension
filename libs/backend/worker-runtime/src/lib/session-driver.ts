import { randomUUID } from 'node:crypto';
import type { RpcMethodResult, SessionId } from '@ptah-extension/shared';
import { IN_PROCESS_SPECS, InProcessRpc, type RpcSpec } from './in-process-rpc';
import { SessionLogWriter } from './session-log-writer';
import { SessionEventLog } from './session-event-log';
import { Transcript } from './transcript';

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

/** The local chat RPC is the only turn admission path; its coordinator owns the lock. */
export class SessionDriver {
  private readonly tabs = new Map<string, string>();
  private readonly early = new Map<string, unknown[]>();
  private readonly turns = new Map<string, DriverTurn>();
  private readonly reservations = new Set<string>();
  constructor(
    private readonly rpc: InProcessRpc,
    private readonly transcript: Transcript,
    private readonly metadata: SessionMetadataReader,
    private readonly writerFor: (sessionId: string) => SessionLogWriter,
    private readonly providerReady: () => boolean,
    private readonly maxActiveTurns: number,
  ) {}

  resolveTab(
    tabId: string,
    sessionId: string,
    deliver: (sessionId: string, event: unknown) => void,
  ): void {
    this.tabs.set(tabId, sessionId);
    for (const event of this.early.get(tabId) ?? []) deliver(sessionId, event);
    this.early.delete(tabId);
  }
  route(
    tabId: string,
    event: unknown,
    deliver: (sessionId: string, event: unknown) => void,
  ): void {
    const sessionId = this.tabs.get(tabId);
    if (sessionId) deliver(sessionId, event);
    else {
      const queue = this.early.get(tabId) ?? [];
      if (queue.length >= 10_000) throw new SessionDriverError('WORKER_BUSY');
      queue.push(event);
      this.early.set(tabId, queue);
    }
  }
  sessionForTab(tabId: string): string | undefined {
    return this.tabs.get(tabId);
  }
  driving(sessionId: string): boolean {
    return this.turns.has(sessionId);
  }
  forgetTab(tabId: string): void {
    this.tabs.delete(tabId);
    this.early.delete(tabId);
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
    if (this.turns.has(sessionId) || this.reservations.has(sessionId))
      throw new SessionDriverError('TURN_IN_FLIGHT');
    if (this.turns.size + this.reservations.size >= this.maxActiveTurns)
      throw new SessionDriverError('WORKER_BUSY');
    this.reservations.add(sessionId);
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
      const writer = this.writerFor(sessionId);
      // Admission has acquired the coordinator lock. Only now may history be read.
      try {
        await this.transcript.baseline(sessionId, writer);
        const turn: DriverTurn = { sessionId, tabId, turnId: randomUUID() };
        await writer.enqueue('worker:turn.begin', { turnId: turn.turnId });
        this.turns.set(sessionId, turn);
        this.tabs.set(tabId, sessionId);
        return turn;
      } catch (error) {
        await this.abort(sessionId);
        throw error;
      }
    } finally {
      this.reservations.delete(sessionId);
    }
  }

  async end(sessionId: string): Promise<void> {
    const turn = this.turns.get(sessionId);
    if (!turn) return;
    const writer = this.writerFor(sessionId);
    try {
      await writer.enqueue('worker:turn.end', { turnId: turn.turnId });
      await this.transcript.mark(sessionId, turn.turnId, writer);
    } finally {
      this.turns.delete(sessionId);
    }
  }

  async abort(sessionId: string): Promise<void> {
    this.turns.delete(sessionId);
    await this.rpc.call(
      'chat:abort',
      { sessionId: sessionId as SessionId },
      IN_PROCESS_SPECS['chat:abort'] as unknown as RpcSpec<
        RpcMethodResult<'chat:abort'>
      >,
    );
  }

  /** Wire this callback into SessionLogWriterOptions.onAppendFailed. */
  onAppendFailed = (sessionId: string): void => {
    void this.abort(sessionId);
  };
}
