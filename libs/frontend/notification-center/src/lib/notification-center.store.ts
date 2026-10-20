import { effect, inject, Injectable, signal } from '@angular/core';
import {
  ATTENTION_ACTION_DISPATCHER,
  NOTIFICATION_FOCUS_ROUTER,
  NotificationService,
  LoggingService,
  type AttentionItem,
  type NotificationFocusResult,
} from '@ptah-extension/core';

/** Shell-scoped actions and presentation state for the shared attention model. */
@Injectable()
export class NotificationCenterStore {
  private readonly notifications = inject(NotificationService);
  private readonly logger = inject(LoggingService);
  private readonly dispatcher = inject(ATTENTION_ACTION_DISPATCHER, { optional: true });
  private readonly focusRouter = inject(NOTIFICATION_FOCUS_ROUTER, { optional: true });
  private readonly panelOpen = signal(false);
  private readonly suppressed = new Set<string>();
  private readonly submitting = signal<ReadonlySet<string>>(new Set());
  private readonly statuses = signal<ReadonlyMap<string, string>>(new Map());
  private readonly unavailable = signal<ReadonlyMap<string, string>>(new Map());

  readonly needsYou = this.notifications.needsYou;
  readonly recentNotices = this.notifications.recentNotices;
  readonly badgeCount = this.notifications.badgeCount;
  readonly canClearAll = this.notifications.canClearAll;

  constructor() {
    effect(() => {
      const open = this.panelOpen();
      const keys = open
        ? new Set([...this.needsYou(), ...this.recentNotices()].map(item => item.key))
        : new Set<string>();
      const live = new Set([...this.needsYou(), ...this.recentNotices()].map(item => `${item.key}:${item.generation}`));
      this.statuses.update(current => new Map([...current].filter(([key]) => live.has(key))));
      this.unavailable.update(current => new Map([...current].filter(([key]) => [...live].some(id => key.startsWith(`${id}:`)))));
      for (const key of this.suppressed) {
        if (!keys.has(key)) {
          this.notifications.setSnackbarSuppressed(key, false, 'panel');
          this.suppressed.delete(key);
        }
      }
      for (const key of keys) {
        if (!this.suppressed.has(key)) {
          this.notifications.setSnackbarSuppressed(key, true, 'panel');
          this.suppressed.add(key);
        }
      }
    });
  }

  setPanelOpen(open: boolean): void {
    if (this.panelOpen() === open) return;
    if (open) this.notifications.pauseAll();
    else this.notifications.resumeAll();
    this.panelOpen.set(open);
  }

  clearAll(): void {
    if (this.canClearAll()) this.notifications.clearAll();
  }

  dismissRecent(key: string): void {
    this.notifications.dismissRecent(key);
  }

  dismissPresentation(key: string): void {
    this.notifications.dismissPresentation(key);
  }

  isSubmitting(item: AttentionItem): boolean {
    return this.submitting().has(`${item.key}:${item.generation}`);
  }

  status(item: AttentionItem): string | undefined {
    return this.statuses().get(`${item.key}:${item.generation}`);
  }

  disabledReason(item: AttentionItem, actionId: string): string | undefined {
    return item.actions.find(action => action.id === actionId)?.disabledReason
      ?? this.unavailable().get(`${item.key}:${item.generation}:${actionId}`);
  }

  async activate(item: AttentionItem, actionId: string, reason?: string): Promise<boolean> {
    const current = [...this.needsYou(), ...this.recentNotices()].find(
      candidate => candidate.key === item.key && candidate.generation === item.generation,
    );
    const action = current?.actions.find(candidate => candidate.id === actionId);
    if (!current || !action || action.disabledReason) return false;
    const request = `${item.key}:${item.generation}`;
    if (this.submitting().has(request)) return false;
    this.submitting.update(current => new Set([...current, request]));
    try {
      if (item.kind === 'failure' && actionId.toLowerCase() === 'open') {
        const result = await this.focus(item);
        if (!result.success) this.statuses.update(current => new Map(current).set(request, 'Session unavailable'));
        return result.success;
      }
      if (this.dispatcher?.dispatchOutcome) {
        const outcome = reason === undefined
          ? await this.dispatcher.dispatchOutcome(item.key, item.generation, actionId)
          : await this.dispatcher.dispatchOutcome(item.key, item.generation, actionId, reason);
        if (outcome.kind === 'stale') this.statuses.update(current => new Map(current).set(request, 'Already answered'));
        if (outcome.kind === 'unavailable') {
          this.statuses.update(current => new Map(current).set(request, outcome.reason));
          this.unavailable.update(current => new Map(current).set(`${request}:${actionId}`, outcome.reason));
        }
        return outcome.kind === 'completed';
      }
      if (this.dispatcher) return reason === undefined
        ? await this.dispatcher.dispatch(item.key, item.generation, actionId)
        : await this.dispatcher.dispatch(item.key, item.generation, actionId, reason);
      if (actionId.toLowerCase() === 'open') {
        return (await this.focus(item)).success;
      }
      return false;
    } catch (error: unknown) {
      // degradation-audit: reported - log the failed action and show a fixed row status.
      this.logger.error('NotificationCenterStore', 'Action unavailable', error);
      this.statuses.update(current => new Map(current).set(request, 'Action unavailable'));
      return false;
    } finally {
      this.submitting.update(current => new Set([...current].filter(key => key !== request)));
    }
  }

  async focus(item: AttentionItem): Promise<NotificationFocusResult> {
    if (!item.sessionId || !this.focusRouter)
      return { success: false, outcome: 'missing' };
    return this.focusRouter.focus({
      workspacePath: item.workspacePath,
      sessionId: item.sessionId,
      tabId: item.tabId,
    });
  }
}
