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
  | 'invalidNativeIdentity';

/** Public errors contain no session metadata, home path, or protocol payload. */
export class SessionHistoryRouteError extends Error {
  constructor(readonly code: SessionHistoryRouteErrorCode) {
    super(
      code === 'nativePortUnavailable'
        ? 'Native Codex history is unavailable in this host.'
        : 'Saved Codex session identity is incomplete.',
    );
    this.name = 'SessionHistoryRouteError';
  }
}

export class SessionHistoryRouter {
  constructor(
    private readonly metadata: Pick<SessionMetadataStore, 'get'>,
    private readonly legacy: Pick<
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
      return this.legacy.readSessionHistory(sessionId, workspacePath, options);
    const snapshot = await this.nativeHistory(session);
    const { events, stats } = projectCodexHistory(sessionId, snapshot);
    return { events, stats };
  }

  async readSessionEvents(
    sessionId: string,
    workspacePath: string,
  ): Promise<SessionHistoryReadResult['events']> {
    const session = await this.nativeSession(sessionId);
    if (!session) return this.legacy.readSessionEvents(sessionId, workspacePath);
    const snapshot = await this.nativeHistory(session);
    return projectCodexHistory(sessionId, snapshot).events;
  }

  private async nativeSession(sessionId: string): Promise<SessionMetadata | null> {
    const session = await this.metadata.get(sessionId);
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
      } catch {
        throw new SessionHistoryRouteError('invalidNativeIdentity');
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
    return native.readHistory(session);
  }
}
