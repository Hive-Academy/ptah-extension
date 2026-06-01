import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type { ITranscriptReader } from '@ptah-extension/memory-contracts';
import { SDK_TOKENS } from './di/tokens';
import type { SessionHistoryReaderService } from './session-history-reader.service';

@injectable()
export class SdkTranscriptReaderAdapter implements ITranscriptReader {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_SESSION_HISTORY_READER)
    private readonly historyReader: SessionHistoryReaderService,
  ) {}

  async read(sessionId: string, workspacePath: string): Promise<string> {
    try {
      const messages = await this.historyReader.readHistoryForCuration(
        sessionId,
        workspacePath,
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
