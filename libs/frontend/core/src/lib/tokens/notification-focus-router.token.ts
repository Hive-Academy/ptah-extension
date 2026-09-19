import { InjectionToken } from '@angular/core';

export type NotificationFocusOutcome =
  | 'focused'
  | 'adopted'
  | 'opened'
  | 'cap-reached'
  | 'missing';

export interface NotificationFocusTarget {
  readonly workspacePath: string;
  readonly tabId?: string;
  readonly sessionId: string;
}

export interface NotificationFocusResult {
  readonly success: boolean;
  readonly outcome: NotificationFocusOutcome;
}

export interface NotificationFocusRouter {
  focus(target: NotificationFocusTarget): Promise<NotificationFocusResult>;
}

export const NOTIFICATION_FOCUS_ROUTER =
  new InjectionToken<NotificationFocusRouter>('NOTIFICATION_FOCUS_ROUTER');
