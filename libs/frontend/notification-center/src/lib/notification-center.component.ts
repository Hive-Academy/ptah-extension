import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  Bell,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  MessageCircleQuestion,
  ShieldQuestion,
  Volume2,
  VolumeX,
  LucideAngularModule,
} from 'lucide-angular';
import { NotificationCenterStore } from './notification-center.store';
import { NotificationSoundService } from './notification-sound.service';
import type {
  CompletionNotificationEntry,
  PendingNotificationEntry,
} from './notification-center.types';

@Component({
  selector: 'ptah-notification-center',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative inline-flex' },
  template: `
    <button
      #bellButton
      type="button"
      class="btn btn-ghost btn-square btn-xs relative focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      aria-haspopup="dialog"
      [attr.aria-expanded]="open()"
      aria-controls="ptah-notification-center-panel"
      [attr.aria-label]="bellLabel()"
      title="Notifications"
      data-testid="notification-center-bell"
      (click)="toggle()"
    >
      <lucide-angular [img]="BellIcon" class="w-3.5 h-3.5" />
      @if (store.unreadCount() > 0) {
        <span
          class="absolute -right-1 -top-1 min-w-4 h-4 px-1 rounded-full bg-error text-error-content text-[10px] leading-4 text-center font-semibold"
          aria-hidden="true"
          data-testid="notification-count-badge"
          >{{ visualCount() }}</span
        >
      }
    </button>

    @if (open()) {
      <section
        id="ptah-notification-center-panel"
        role="dialog"
        aria-modal="false"
        aria-labelledby="ptah-notification-center-heading"
        class="absolute right-0 top-full mt-2 z-50 w-80 max-h-[70vh] overflow-y-auto rounded-xl border border-base-content/15 bg-base-100 shadow-xl"
        data-testid="notification-center-panel"
        (keydown.escape)="close(true)"
      >
        <header
          class="sticky top-0 z-10 flex items-center gap-2 border-b border-base-content/10 bg-base-100 p-3"
        >
          <h2
            #panelHeading
            id="ptah-notification-center-heading"
            tabindex="-1"
            class="flex-1 text-sm font-semibold outline-none"
          >
            Notifications
          </h2>
          <button
            type="button"
            class="btn btn-ghost btn-square btn-xs"
            [attr.aria-label]="
              sound.muted()
                ? 'Unmute notification sounds'
                : 'Mute notification sounds'
            "
            (click)="sound.setMuted(!sound.muted())"
          >
            <lucide-angular
              [img]="sound.muted() ? VolumeXIcon : Volume2Icon"
              class="w-3.5 h-3.5"
            />
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-xs gap-1"
            (click)="store.markAllRead()"
          >
            <lucide-angular [img]="CheckAllIcon" class="w-3.5 h-3.5" />
            Read all
          </button>
        </header>

        <div class="p-2 space-y-2">
          @for (entry of store.pendingEntries(); track entry.id) {
            <button
              type="button"
              class="notification-row flex w-full items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60"
              [disabled]="entry.target === null"
              (click)="activatePrompt(entry)"
            >
              <lucide-angular
                [img]="
                  entry.kind === 'question' ? QuestionIcon : PermissionIcon
                "
                class="mt-0.5 w-4 h-4 shrink-0"
              />
              <span class="min-w-0">
                <span class="block text-xs font-semibold">{{
                  entry.statusText
                }}</span>
                <span class="block truncate text-xs">{{ entry.title }}</span>
                <span class="block truncate text-[11px] text-base-content/60">{{
                  entry.workspaceLabel
                }}</span>
              </span>
            </button>
          }

          @for (group of store.completionGroups(); track group.id) {
            <section
              class="rounded-lg border border-base-content/10 p-1.5"
              [attr.aria-label]="group.workspaceLabel"
            >
              <h3
                class="px-1 pb-1 text-[11px] font-semibold text-base-content/60"
              >
                {{ group.workspaceLabel }} · {{ group.entries.length }}
              </h3>
              @for (entry of group.entries; track entry.id) {
                <button
                  type="button"
                  class="notification-row flex w-full items-start gap-2 rounded-md p-2 text-left hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  [class.opacity-60]="entry.readAt !== null"
                  (click)="activateCompletion(entry)"
                >
                  <span
                    class="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                    [style.background]="entry.sessionColor"
                  ></span>
                  <lucide-angular
                    [img]="
                      entry.classification === 'error' ? ErrorIcon : SuccessIcon
                    "
                    class="mt-0.5 w-4 h-4 shrink-0"
                  />
                  <span class="min-w-0">
                    <span class="block text-xs font-semibold">{{
                      entry.classification === 'error' ? 'Failed' : 'Finished'
                    }}</span>
                    <span class="block truncate text-xs">{{
                      entry.title
                    }}</span>
                  </span>
                </button>
              }
            </section>
          }

          @if (
            store.pendingEntries().length === 0 &&
            store.completionGroups().length === 0
          ) {
            <p class="p-6 text-center text-xs text-base-content/60">
              No notifications
            </p>
          }
        </div>
      </section>
    }

    <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{
      store.announcement()
    }}</span>
  `,
  styles: `
    .notification-row {
      transition:
        opacity 120ms ease,
        transform 120ms ease;
    }
    .notification-row:hover {
      transform: translateY(-1px);
    }
    @media (prefers-reduced-motion: reduce) {
      .notification-row {
        transition: none;
      }
      .notification-row:hover {
        transform: none;
      }
    }
  `,
})
export class NotificationCenterComponent {
  protected readonly store = inject(NotificationCenterStore);
  protected readonly sound = inject(NotificationSoundService);
  protected readonly open = signal(false);
  private readonly bellButton =
    viewChild<ElementRef<HTMLButtonElement>>('bellButton');
  private readonly panelHeading =
    viewChild<ElementRef<HTMLElement>>('panelHeading');

  protected readonly BellIcon = Bell;
  protected readonly CheckAllIcon = CheckCheck;
  protected readonly ErrorIcon = CircleAlert;
  protected readonly SuccessIcon = CircleCheck;
  protected readonly QuestionIcon = MessageCircleQuestion;
  protected readonly PermissionIcon = ShieldQuestion;
  protected readonly Volume2Icon = Volume2;
  protected readonly VolumeXIcon = VolumeX;

  protected bellLabel(): string {
    const count = this.store.unreadCount();
    return `Notifications, ${count} unread`;
  }

  protected visualCount(): string {
    const count = this.store.unreadCount();
    return count > 9 ? '9+' : String(count);
  }

  protected toggle(): void {
    if (this.open()) {
      this.close(false);
      return;
    }
    this.open.set(true);
    setTimeout(() => {
      const actionable = document.querySelector<HTMLElement>(
        '#ptah-notification-center-panel .notification-row:not(:disabled)',
      );
      (actionable ?? this.panelHeading()?.nativeElement)?.focus();
    }, 0);
  }

  protected close(restoreFocus: boolean): void {
    this.open.set(false);
    if (restoreFocus)
      setTimeout(() => this.bellButton()?.nativeElement.focus(), 0);
  }

  protected activateCompletion(entry: CompletionNotificationEntry): void {
    void this.store.activateCompletion(entry);
  }

  protected activatePrompt(entry: PendingNotificationEntry): void {
    void this.store.activatePrompt(entry);
  }
}
