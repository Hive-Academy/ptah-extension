import type { SDKMessage } from '../../../types/sdk-types/claude-sdk.types';
import {
  isMessageStart,
  isStreamEvent,
} from '../../../types/sdk-types/claude-sdk.types';
import {
  readSubagentRequestUsage,
  type SubagentRequestUsage,
} from '../subagent-budget-monitor';
import {
  IDLE_ANCHOR_SKEW_MS,
  type CacheTtlClass,
  type LastRequestSnapshot,
} from './idle-compaction.types';

export function classifyCacheTtl(
  usage: SubagentRequestUsage | undefined,
): CacheTtlClass {
  const split = usage?.cacheWriteByTtl;
  return split && split['1h'] > 0 && split['5m'] === 0 ? '1h' : 'not-1h';
}

/** Tracks only top-level frames; the tap filters subagent frames before calling observe. */
export class MainRequestTracker {
  private turnStartAt: number;
  private lastNonRequestFrameAt: number;
  private requestKey: string | null = null;
  private anchorAt = 0;
  private usage: SubagentRequestUsage | undefined;
  private cacheRequestKey: string | null = null;
  private cacheAnchorAt: number | null = null;
  private cacheUsage: SubagentRequestUsage | undefined;

  constructor(startAt: number) {
    this.turnStartAt = startAt;
    this.lastNonRequestFrameAt = startAt;
  }

  observe(message: unknown, at: number): 'request-started' | null {
    try {
      if (
        typeof message !== 'object' ||
        message === null ||
        !Number.isFinite(at)
      )
        return null;
      const frame = message as SDKMessage;
      if ('parent_tool_use_id' in frame && frame.parent_tool_use_id !== null)
        return null;
      let key: string | undefined;
      if (isStreamEvent(frame) && frame.event && isMessageStart(frame.event)) {
        key = frame.event.message?.id;
      } else if (frame.type === 'assistant') {
        key = frame.message?.id;
      }
      if (typeof key !== 'string' || key.length === 0) {
        this.lastNonRequestFrameAt = at;
        return null;
      }
      const started = key !== this.requestKey;
      if (started) {
        this.requestKey = key;
        this.anchorAt = Math.max(
          this.turnStartAt,
          this.lastNonRequestFrameAt - IDLE_ANCHOR_SKEW_MS,
        );
        this.usage = undefined;
      }
      if (frame.type === 'assistant') {
        this.usage = readSubagentRequestUsage(frame);
      }
      const model = frame.type === 'assistant' ? frame.message?.model :
        isStreamEvent(frame) && frame.event && isMessageStart(frame.event)
          ? frame.event.message?.model
          : undefined;
      if (typeof model === 'string' && model.startsWith('<')) {
        return started ? 'request-started' : null;
      }
      if (key !== this.cacheRequestKey) {
        this.cacheRequestKey = key;
        this.cacheAnchorAt = this.anchorAt;
        this.cacheUsage = undefined;
      }
      if (frame.type === 'assistant') {
        this.cacheUsage = this.usage;
      }
      return started ? 'request-started' : null;
    } catch {
      // degradation-audit: optional-capability - an unreadable frame only skips
      // idle request tracking for it; idle compaction then does not arm, and
      // the session stream is unaffected.
      return null;
    }
  }

  endTurn(at: number): LastRequestSnapshot | null {
    const snapshot: LastRequestSnapshot | null =
      this.requestKey === null
        ? null
        : {
            requestKey: this.requestKey,
            anchorAt: this.anchorAt,
            ttl: classifyCacheTtl(this.usage),
            cacheAnchorAt: this.cacheAnchorAt,
            cacheReadTokens: this.cacheUsage?.cacheReadTokens ?? 0,
            cacheWriteTokens: this.cacheUsage?.cacheWriteTokens ?? 0,
            cacheWriteTtl: this.cacheUsage?.cacheWriteByTtl
              ? this.cacheUsage.cacheWriteByTtl['5m'] > 0
                ? '5m'
                : this.cacheUsage.cacheWriteByTtl['1h'] > 0
                  ? '1h'
                  : null
              : null,
          };
    this.requestKey = null;
    this.usage = undefined;
    this.cacheRequestKey = null;
    this.cacheAnchorAt = null;
    this.cacheUsage = undefined;
    if (Number.isFinite(at)) {
      this.turnStartAt = at;
      this.lastNonRequestFrameAt = at;
    }
    return snapshot;
  }
}
