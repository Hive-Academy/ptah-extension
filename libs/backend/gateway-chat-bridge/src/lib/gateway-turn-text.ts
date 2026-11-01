/**
 * Assistant text for one gateway turn.
 *
 * The webview accumulator appends `source: 'stream'` (and a missing source)
 * and replaces the block for `complete` or `history`, including an empty
 * replacement. Messages stay in first-seen order. Blocks inside a message
 * are joined by `blockIndex`, which is how the execution tree orders them.
 * The gateway seal sends one message, so the blocks are concatenated.
 *
 * Used by `GatewayChatBridge` only. Not part of the lib's public entry.
 */

/**
 * One `text_delta` the gateway can reconcile. Field names match the shared
 * text-delta event: `messageId`, `blockIndex`, `delta`, and `source`.
 */
export interface GatewayTextDelta {
  readonly messageId: string;
  readonly blockIndex?: number;
  readonly delta: string;
  readonly source?: 'stream' | 'complete' | 'history' | 'hook';
}

export class GatewayTurnText {
  private readonly messageOrder: string[] = [];
  private readonly blocks = new Map<string, Map<number, string>>();

  /**
   * Records message order the way the webview does: on `message_start`.
   * `accept()` calls it too, for streams that send text without a start.
   */
  noteMessage(messageId: string): Map<number, string> {
    let messageBlocks = this.blocks.get(messageId);
    if (messageBlocks === undefined) {
      messageBlocks = new Map<number, string>();
      this.blocks.set(messageId, messageBlocks);
      this.messageOrder.push(messageId);
    }
    return messageBlocks;
  }

  accept(event: GatewayTextDelta): void {
    const blockIndex = event.blockIndex ?? 0;
    const messageBlocks = this.noteMessage(event.messageId);
    if (event.source === 'complete' || event.source === 'history') {
      messageBlocks.set(blockIndex, event.delta);
      return;
    }
    const current = messageBlocks.get(blockIndex) ?? '';
    messageBlocks.set(blockIndex, current + event.delta);
  }

  join(): string {
    let body = '';
    for (const messageId of this.messageOrder) {
      const messageBlocks = this.blocks.get(messageId);
      if (messageBlocks === undefined) continue;
      const indexes = [...messageBlocks.keys()].sort(
        (left, right) => left - right,
      );
      for (const index of indexes) {
        body += messageBlocks.get(index) ?? '';
      }
    }
    return body;
  }
}
