import { InjectionToken } from '@angular/core';
import type { AttentionActionOutcome } from './attention-action-dispatcher.token';

/**
 * Runs a non-open action (for example "switch-to-local" or "retry") on a
 * notice that a feature lib published to NotificationService. The attention
 * dispatcher asks each handler in turn when no live chat request owns the key.
 */
export interface NoticeActionHandler {
  canHandle(key: string, actionId: string): boolean;
  run(key: string, generation: number, actionId: string): Promise<AttentionActionOutcome>;
}

export const NOTICE_ACTION_HANDLER =
  new InjectionToken<readonly NoticeActionHandler[]>('NOTICE_ACTION_HANDLER');
