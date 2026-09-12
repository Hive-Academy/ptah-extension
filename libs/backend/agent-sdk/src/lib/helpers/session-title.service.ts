import { inject, injectable } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '../di/tokens';
import { SessionMetadataStore } from '../session-metadata-store';

/**
 * The session TITLE — the SDK-persisted name a human reads.
 *
 * This is the SECOND of the two name surfaces a session carries, and the two
 * are routinely confused (TASK_2026_402 Requirement 9):
 *
 *  - the REGISTRY name is the `--name` flag `buildSessionName` composes. It is
 *    written into `~/.claude/sessions/<pid>.json` when the process spawns, it
 *    is what a PEER session reads, and it is FIXED AT SPAWN. Nothing in this
 *    file changes it, and no documented API does.
 *  - the TITLE is `Options.title` on a new session, persisted in the JSONL and
 *    surfaced as `SDKSessionInfo.customTitle`. It is the one of the two that
 *    CAN be changed afterwards, through the SDK's exported `renameSession`.
 *
 * The SDK call lives here rather than in {@link SessionMetadataStore} on
 * purpose: that store is Ptah's own UI metadata and must stay free of any SDK
 * dependency. The rename path owns both writes and calls them in order.
 *
 * Every failure is logged and swallowed. A title is a convenience, and a
 * rename the user performed in the UI has already succeeded in Ptah's own
 * metadata by the time this runs — failing it afterwards would undo nothing
 * and report a false error.
 */
@injectable()
export class SessionTitleService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly metadataStore: SessionMetadataStore,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
  ) {}

  /**
   * Retitle an existing session's transcript.
   *
   * @returns `true` when the SDK accepted the rename, `false` when it did not.
   * The boolean is for observability and tests; a caller that treats `false`
   * as a user-visible failure is misreading what a title is.
   */
  async retitle(sessionId: string, title: string): Promise<boolean> {
    try {
      const sdkModule = (await import('@anthropic-ai/claude-agent-sdk')) as {
        renameSession?: (
          sessionId: string,
          title: string,
          options?: { dir?: string },
        ) => Promise<void>;
      };
      const rename = sdkModule.renameSession;
      if (typeof rename !== 'function') {
        this.logger.warn(
          "[SessionTitleService] SDK module loaded but 'renameSession' is " +
            'not a function — the session title was left unchanged',
          { sessionId, exportType: typeof rename },
        );
        return false;
      }

      // Pin the project directory so the SDK reads the same transcript Ptah's
      // metadata is keyed on instead of scanning every project. Omitted when
      // neither is known, which is the SDK's documented "search all" mode.
      const metadata = await this.metadataStore.get(sessionId);
      const dir =
        metadata?.workspaceId ?? this.workspaceProvider.getWorkspaceRoot();

      await rename(sessionId, title, dir ? { dir } : undefined);
      this.logger.info('[SessionTitleService] Session title updated', {
        sessionId,
        hasDir: !!dir,
      });
      return true;
    } catch (error: unknown) {
      this.logger.warn(
        '[SessionTitleService] Could not update the session title — the ' +
          "rename of Ptah's own session metadata is unaffected",
        {
          sessionId,
          reason: error instanceof Error ? error.message : String(error),
        },
      );
      return false;
    }
  }
}
