import {
  normalizeCodexWorkspaceKey,
  type CodexHistoryReader,
  type CodexSessionHistory,
} from '@ptah-extension/codex-runtime';
import type { SessionMetadata, SessionMetadataStore } from '../session-metadata-store';
import type {
  CarryOverReadOptions,
  SessionHistoryReaderService,
} from '../session-history-reader.service';
import type { CarryOverTranscript } from '../helpers/history/history.types';
import { projectCodexHistory } from './codex-history-projector';
import {
  projectCodexCarryOverTranscript,
  type CodexCarryOverTail,
} from './codex-carry-over-projector';

/** Turn and page caps of one bounded native carry-over read. */
export type NativeCarryOverBound = Parameters<CodexHistoryReader['readHistoryTail']>[2];

export interface NativeSessionHistoryPort {
  /** Read the complete snapshot using execution.sessionId when the context mapping is absent. */
  readHistory(session: SessionMetadata): Promise<CodexSessionHistory>;
  /** Read only the newest complete root turns inside `bound`; absent on hosts without it. */
  readHistoryTail?(
    session: SessionMetadata,
    bound: NativeCarryOverBound,
    signal?: AbortSignal,
  ): Promise<CodexCarryOverTail>;
}

export interface CarryOverRouteOptions extends CarryOverReadOptions {
  /**
   * Bound of the native read. A caller that passes none is refused for a
   * native session before any read, as before native sources were enabled.
   */
  readonly nativeBound?: NativeCarryOverBound;
}

export type SessionHistoryReadResult = Awaited<
  ReturnType<SessionHistoryReaderService['readSessionHistory']>
>;

export type SessionHistoryRouteErrorCode =
  | 'nativePortUnavailable'
  | 'invalidNativeIdentity'
  | 'nativeReadFailed';

/** Public errors contain no session metadata, home path, or protocol payload. */
export class SessionHistoryRouteError extends Error {
  constructor(readonly code: SessionHistoryRouteErrorCode, cause?: unknown) {
    super(
      code === 'nativePortUnavailable'
        ? 'Session history is unavailable in this host.'
        : code === 'invalidNativeIdentity'
          ? 'Saved session identity is incomplete.'
          : 'Session history could not be read.',
      { cause },
    );
    this.name = 'SessionHistoryRouteError';
  }
}

export class SessionHistoryRouter {
  constructor(
    private readonly getMetadata: () => Pick<SessionMetadataStore, 'get'>,
    private readonly getLegacy: () => Pick<
      SessionHistoryReaderService,
      'readSessionHistory' | 'readSessionEvents' | 'readCarryOverTranscript'
    >,
    private readonly getNative: () => NativeSessionHistoryPort | null | undefined,
  ) {}

  async readSessionHistory(
    sessionId: string,
    workspacePath: string,
    options?: Parameters<SessionHistoryReaderService['readSessionHistory']>[2],
  ): Promise<SessionHistoryReadResult> {
    const session = await this.nativeSession(sessionId);
    if (!session)
      return this.getLegacy().readSessionHistory(sessionId, workspacePath, options);
    const snapshot = await this.nativeHistory(session);
    const { events, stats } = this.projectHistory(sessionId, snapshot);
    return { events, stats };
  }

  async readSessionEvents(
    sessionId: string,
    workspacePath: string,
  ): Promise<SessionHistoryReadResult['events']> {
    const session = await this.nativeSession(sessionId);
    if (!session) return this.getLegacy().readSessionEvents(sessionId, workspacePath);
    const snapshot = await this.nativeHistory(session);
    return this.projectHistory(sessionId, snapshot).events;
  }

  /**
   * The bounded transcript a provider carry-over renders. A Claude session
   * reads its JSONL tail. A native session reads its newest root turns through
   * the host port's `readHistoryTail`, never the full `readHistory`.
   */
  async readCarryOverTranscript(
    sessionId: string,
    workspacePath: string,
    options: CarryOverRouteOptions,
  ): Promise<CarryOverTranscript> {
    const session = await this.nativeSession(sessionId);
    if (!session)
      return this.getLegacy().readCarryOverTranscript(sessionId, workspacePath, options);
    if (!options.nativeBound) throw new SessionHistoryRouteError('nativePortUnavailable');
    const tail = await this.nativeHistoryTail(session, options.nativeBound, options.signal);
    try {
      return projectCodexCarryOverTranscript(tail);
    } catch (error: unknown) {
      throw new SessionHistoryRouteError('nativeReadFailed', error);
    }
  }

  private async nativeSession(sessionId: string): Promise<SessionMetadata | null> {
    const session = await this.getMetadata().get(sessionId);
    if (session?.codexExecution?.runtime !== 'codex-app-server') return null;
    if (session.codexExecution.sessionId !== sessionId)
      throw new SessionHistoryRouteError('invalidNativeIdentity');
    // Execution carries the native thread id even if the separate context mapping
    // was never persisted. Read that thread; validate the mapping when present.
    if (session.codexThread) {
      let workspaceKey: string;
      try {
        workspaceKey = normalizeCodexWorkspaceKey(
          session.codexThread.workspaceId,
          process.platform,
        );
      } catch (error: unknown) {
        throw new SessionHistoryRouteError('invalidNativeIdentity', error);
      }
      if (workspaceKey !== session.codexExecution.workspaceId)
        throw new SessionHistoryRouteError('invalidNativeIdentity');
    }
    return session;
  }

  private async nativeHistory(session: SessionMetadata): Promise<CodexSessionHistory> {
    const native = this.getNative();
    if (!native)
      throw new SessionHistoryRouteError('nativePortUnavailable');
    return this.collapseNativeErrors(() => native.readHistory(session));
  }

  private async nativeHistoryTail(
    session: SessionMetadata,
    bound: NativeCarryOverBound,
    signal: AbortSignal | undefined,
  ): Promise<CodexCarryOverTail> {
    const native = this.getNative();
    const readTail = native?.readHistoryTail;
    if (!native || typeof readTail !== 'function')
      throw new SessionHistoryRouteError('nativePortUnavailable');
    return this.collapseNativeErrors(() => readTail.call(native, session, bound, signal));
  }

  private async collapseNativeErrors<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error: unknown) {
      // The Electron port has fixed codes. All other native failures are
      // collapsed here so a host cannot expose paths or protocol payloads.
      if (error instanceof Error && error.name === 'ElectronCodexHistoryError')
        throw error;
      throw new SessionHistoryRouteError('nativeReadFailed', error);
    }
  }

  private projectHistory(
    sessionId: string,
    snapshot: CodexSessionHistory,
  ): ReturnType<typeof projectCodexHistory> {
    try {
      return projectCodexHistory(sessionId, snapshot);
    } catch (error: unknown) {
      throw new SessionHistoryRouteError('nativeReadFailed', error);
    }
  }
}
