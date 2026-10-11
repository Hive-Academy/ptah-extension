import { inject, Injectable } from '@angular/core';
import {
  NOTIFICATION_FOCUS_ROUTER,
  type NotificationFocusResult,
  type NotificationFocusTarget,
} from '@ptah-extension/core';
import { NotificationLedgerService } from './notification-ledger.service';
import type {
  CompletionNotificationEntry,
  PendingNotificationEntry,
} from './notification-center.types';

/**
 * The bell's view of the root {@link NotificationLedgerService}, plus the one
 * thing the ledger cannot do: focus a card's target.
 *
 * Component-provided because `NOTIFICATION_FOCUS_ROUTER` is provided by each
 * shell, not at the root, so only an injector under the shell resolves it. It
 * owns no effects, timers or state, so detaching the bell (TASK_2026_524
 * batch 3) pauses nothing but its rendering.
 */
@Injectable()
export class NotificationCenterStore {
  private readonly ledger = inject(NotificationLedgerService);
  private readonly focusRouter = inject(NOTIFICATION_FOCUS_ROUTER, {
    optional: true,
  });

  readonly completionEntries = this.ledger.completionEntries;
  readonly announcement = this.ledger.announcement;
  readonly pendingEntries = this.ledger.pendingEntries;
  readonly unreadCount = this.ledger.unreadCount;
  readonly completionGroups = this.ledger.completionGroups;

  markAllRead(now = Date.now()): void {
    this.ledger.markAllRead(now);
  }

  dismissCompletion(id: string): void {
    this.ledger.dismissCompletion(id);
  }

  async activateCompletion(
    entry: CompletionNotificationEntry,
  ): Promise<NotificationFocusResult> {
    const result = await this.focus(entry.target);
    if (result.success) this.ledger.markRead(entry.id);
    return result;
  }

  activatePrompt(
    entry: PendingNotificationEntry,
  ): Promise<NotificationFocusResult> {
    return entry.target
      ? this.focus(entry.target)
      : Promise.resolve({ success: false, outcome: 'missing' });
  }

  private focus(
    target: NotificationFocusTarget,
  ): Promise<NotificationFocusResult> {
    return this.focusRouter
      ? this.focusRouter.focus(target)
      : Promise.resolve({ success: false, outcome: 'missing' });
  }
}
