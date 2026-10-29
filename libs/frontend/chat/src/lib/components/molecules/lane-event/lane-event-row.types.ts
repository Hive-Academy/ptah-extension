import type { LaneEnvelopeKind } from '@ptah-extension/shared';

export interface LaneEventItem {
  readonly kind: LaneEnvelopeKind;
  readonly status?: string;
  readonly verdict?: string;
  readonly body: string;
  readonly timestamp: number;
  readonly messageId: string;
  readonly files?: readonly string[];
  readonly imageCount?: number;
}

export interface LaneEventRow {
  readonly rowKey: string;
  readonly agentId: string;
  readonly agent: string;
  readonly cli: string;
  readonly peerLabel: string;
  readonly events: readonly LaneEventItem[];
  /** Earlier events from this agent, including previous runs. */
  readonly earlier: readonly LaneEventItem[];
  readonly liveLane: boolean;
}

export type LaneSlot =
  | { readonly kind: 'row'; readonly row: LaneEventRow }
  | { readonly kind: 'merged'; readonly rowKey: string };
