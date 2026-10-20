import type {
  AttentionOpenTargetPayload,
  AttentionRequestKind,
  AttentionTarget,
} from '@ptah-extension/shared';
import type { IDisposable } from '../types/platform.types';

/** Shared whitelisted fields for native host notifications. */
interface HostAttentionNoticeBase {
  readonly key: string;
  readonly generation: number;
  readonly actionLabel: 'Open Ptah';
  /** Authoritative display title, with a generic fallback supplied by the coordinator. */
  readonly sessionTitle: string;
  readonly target: AttentionTarget;
}

/** Only fixed labels may reach a host; request content stays in the renderer. */
export type SafeHostAttentionNotice =
  | (HostAttentionNoticeBase & {
      readonly kind: AttentionRequestKind;
      readonly severity: 'info' | 'warning';
      readonly label: 'Permission needed' | 'Question needs an answer';
    })
  | (HostAttentionNoticeBase & {
      readonly kind: 'failure';
      readonly severity: 'error';
      readonly label: 'Session failed' | 'Lane failed' | 'Task failed';
    });

/** Native notification seam. Resolved generations must not accept late actions. */
export interface IHostAttentionNotifications extends IDisposable {
  present(safeNotice: SafeHostAttentionNotice): void;
  resolve(key: string, generation: number): void;
  isEligible(): boolean;
  /** A stale key/generation is a no-op. */
  open(target: AttentionOpenTargetPayload): void;
}
