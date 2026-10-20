import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { NotificationService, type AttentionItem } from '@ptah-extension/core';

/**
 * One shell-owned live region for new attention lifecycles.
 */
@Component({
  selector: 'ptah-notification-announcer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ polite() }}</span>
    <span class="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{{ assertive() }}</span>
  `,
})
export class NotificationAnnouncerComponent {
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly announced = new Set<string>();
  private readonly queue: { message: string; assertive: boolean }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  protected readonly polite = signal('');
  protected readonly assertive = signal('');

  constructor() {
    this.destroyRef.onDestroy(() => { if (this.timer) clearTimeout(this.timer); });
    effect(() => {
      const items = [...this.notifications.needsYou(), ...this.notifications.recentNotices()];
      const live = new Set(items.map(item => `${item.key}:${item.generation}`));
      for (const identity of this.announced) if (!live.has(identity)) this.announced.delete(identity);
      for (const item of items) {
        const identity = `${item.key}:${item.generation}`;
        if (this.announced.has(identity)) continue;
        this.announced.add(identity);
        const message = this.message(item);
        this.queue.push({ message, assertive: item.kind === 'failure' });
        if (this.queue.length > 100) this.queue.shift();
      }
      this.pump();
    });
  }

  private pump(): void {
    if (this.timer || !this.queue.length) return;
    const next = this.queue.shift();
    if (!next) return;
    const region = next.assertive ? this.assertive : this.polite;
    region.set('');
    this.timer = setTimeout(() => {
      region.set(next.message);
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.pump();
      }, 100);
    }, 0);
  }

  private message(item: AttentionItem): string {
    const location = item.workspaceName ? ` in ${item.workspaceName}` : '';
    if (item.kind === 'failure') return `Attention needed: ${item.title}${location}`;
    if (item.kind === 'warning') return `Warning: ${item.title}${location}`;
    return `${item.title}${location}. Needs your attention.`;
  }
}
