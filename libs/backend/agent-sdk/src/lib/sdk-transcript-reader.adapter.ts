import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  ITranscriptReader,
  TranscriptReadOptions,
} from '@ptah-extension/memory-contracts';
import { SDK_TOKENS } from './di/tokens';
import type { SessionHistoryReaderService } from './session-history-reader.service';

@injectable()
export class SdkTranscriptReaderAdapter implements ITranscriptReader {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_SESSION_HISTORY_READER)
    private readonly historyReader: SessionHistoryReaderService,
  ) {}

  /**
   * `options.tailBytes` bounds the RAW JSONL that is read and parsed, not the
   * formatted string returned. Those differ by a large factor — a transcript
   * line carries uuids, timestamps, usage and tool metadata around the text
   * this method keeps — so a caller wanting N bytes of formatted transcript
   * should ask for a comfortably larger raw window and clamp the result.
   */
  async read(
    sessionId: string,
    workspacePath: string,
    options?: TranscriptReadOptions,
  ): Promise<string> {
    try {
      const messages = await this.historyReader.readHistoryForCuration(
        sessionId,
        workspacePath,
        options?.tailBytes ? { tailBytes: options.tailBytes } : undefined,
      );
      if (messages.length === 0) return '';
      return messages
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n\n');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('[SdkTranscriptReaderAdapter] read failed', {
        sessionId,
        workspacePath,
        error: message,
      });
      return '';
    }
  }
}
