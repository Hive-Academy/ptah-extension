import {
  normalizeCodexWorkspaceKey,
  type CodexSessionHistory,
} from '@ptah-extension/codex-runtime';
import type { SessionMetadata, SessionMetadataStore } from '../session-metadata-store';
import type { SessionHistoryReaderService } from '../session-history-reader.service';
import { projectCodexHistory } from './codex-history-projector';

export interface NativeSessionHistoryPort {
  /** Read the complete snapshot using execution.sessionId when the context mapping is absent. */
  readHistory(session: SessionMetadata): Promise<CodexSessionHistory>;
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
      'readSessionHistory' | 'readSessionEvents'
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
    try {
      return await native.readHistory(session);
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
