import type {
  IHostAttentionNotifications,
  SafeHostAttentionNotice,
} from '@ptah-extension/platform-core';
import type { AttentionOpenTargetPayload } from '@ptah-extension/shared';

/** Headless CLI has no native notification surface. */
export class CliHostAttentionNotifications implements IHostAttentionNotifications {
  isEligible(): boolean {
    return false;
  }

  present(_notice: SafeHostAttentionNotice): void {
    return;
  }

  resolve(_key: string, _generation: number): void {
    return;
  }

  open(_target: AttentionOpenTargetPayload): void {
    return;
  }

  dispose(): void {
    return;
  }
}
