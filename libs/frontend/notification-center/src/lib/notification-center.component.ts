import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Bell, Check, CircleAlert, MessageCircleQuestion, ShieldQuestion, Trash2, TriangleAlert, Volume2, VolumeX, X, LucideAngularModule } from 'lucide-angular';
import type { AttentionItem } from '@ptah-extension/core';
import { NotificationCenterStore } from './notification-center.store';
import { NotificationSoundService } from './notification-sound.service';

@Component({
  selector: 'ptah-notification-center',
  standalone: true,
  imports: [LucideAngularModule],
  providers: [NotificationCenterStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative inline-flex',
    '(document:click)': 'onDocumentClick($event)',
  },
  template: `
    <button #bellButton type="button"
      class="btn btn-ghost btn-square btn-xs relative focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      aria-haspopup="dialog" [attr.aria-expanded]="panelOpen()"
      aria-controls="ptah-notification-center-panel" [attr.aria-label]="bellLabel()"
      title="Notifications" data-testid="notification-center-bell" (click)="toggle()">
      <lucide-angular [img]="BellIcon" class="w-3.5 h-3.5" />
      @if (store.badgeCount() > 0) {
        <span class="absolute -right-1 -top-1 min-w-4 h-4 px-1 rounded-full bg-warning text-warning-content text-[10px] leading-4 text-center font-semibold"
          aria-hidden="true" data-testid="notification-count-badge">{{ visualCount() }}</span>
      }
    </button>

    @if (panelOpen()) {
      <section id="ptah-notification-center-panel" role="dialog" aria-modal="false"
        aria-labelledby="ptah-notification-center-heading"
        class="surface-3 absolute right-0 top-full mt-2 z-50 w-80 max-w-[calc(100vw-1rem)] max-h-[70vh] overflow-y-auto rounded-xl"
        data-testid="notification-center-panel" (keydown.escape)="close(true)">
        <header class="sticky top-0 z-10 flex items-center gap-2 border-b border-base-300 bg-base-100 p-3">
          <h2 #panelHeading id="ptah-notification-center-heading" tabindex="-1"
            class="flex-1 text-sm font-semibold outline-none">Notifications</h2>
          <button type="button" class="btn btn-ghost btn-square btn-xs"
            [attr.aria-label]="sound.muted() ? 'Unmute notification sounds' : 'Mute notification sounds'"
            (click)="sound.setMuted(!sound.muted())">
            <lucide-angular [img]="sound.muted() ? VolumeXIcon : Volume2Icon" class="w-3.5 h-3.5" />
          </button>
          <button type="button" class="btn btn-ghost btn-xs" aria-label="Clear all notices"
            [disabled]="!store.canClearAll()" (click)="store.clearAll()">
            <lucide-angular [img]="ClearIcon" class="w-3.5 h-3.5" />
            Clear all notices
          </button>
        </header>
        @if (store.needsYou().length === 0 && store.recentNotices().length === 0) {
          <div class="px-3 py-11 text-center">
            <lucide-angular [img]="EmptyIcon" class="mx-auto w-7 h-7 text-success" aria-hidden="true" />
            <h3 class="mt-2 text-sm font-semibold">All clear</h3>
            <p class="mt-1 text-xs text-base-content-muted">Nothing needs your attention.</p>
          </div>
        } @else {
        <div class="p-2 space-y-3">
          <section aria-labelledby="ptah-needs-you-heading">
            <div class="flex items-center gap-2 px-1 pb-1">
              <h3 id="ptah-needs-you-heading" class="text-xs font-semibold">Needs you</h3>
              <span class="text-xs text-base-content-muted">{{ store.needsYou().length }}</span>
            </div>
            @for (item of store.needsYou(); track item.key) {
              <div class="notification-row rounded-lg border border-warning bg-base-200 p-2 mb-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                [attr.tabindex]="item.actionable ? 0 : -1" [attr.aria-label]="item.title">
                <div class="flex items-start gap-2">
                  <lucide-angular [img]="item.kind === 'question' ? QuestionIcon : PermissionIcon"
                    class="mt-0.5 w-4 h-4 shrink-0 text-state-need" />
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-semibold">{{ item.title }}</p>
                    @if (item.context) { <p class="text-xs text-base-content-muted">{{ item.context }}</p> }
                    <p class="text-[11px] text-base-content-muted">{{ item.workspaceName }}</p>
                  </div>
                </div>
                <div class="flex flex-wrap gap-1 mt-2">
                  @for (action of item.actions; track action.id) {
                    <button type="button" class="btn btn-xs min-h-11"
                      [class.btn-primary]="action.id === 'allow'"
                      [class.btn-ghost]="action.id !== 'allow'"
                      [disabled]="!!store.disabledReason(item, action.id) || store.isSubmitting(item)"
                      [attr.title]="store.disabledReason(item, action.id)"
                      [attr.aria-label]="action.label + ' ' + item.title"
                      (click)="activate(item, action.id)">{{ action.label }}</button>
                  }
                </div>
                @if (store.status(item)) { <p role="status" class="text-xs text-base-content-muted">{{ store.status(item) }}</p> }
              </div>
            } @empty {
              <p class="px-2 py-3 text-xs text-base-content-muted">Nothing needs your response</p>
            }
          </section>
          <section aria-labelledby="ptah-recent-heading">
            <div class="flex items-center gap-2 px-1 pb-1">
              <h3 id="ptah-recent-heading" class="flex-1 text-xs font-semibold">Recent notices</h3>
            </div>
            @for (item of store.recentNotices(); track item.key) {
              <div class="notification-row rounded-lg border border-base-300 bg-base-200 p-2 mb-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                [attr.tabindex]="item.actionable ? 0 : -1" [attr.aria-label]="item.title">
                <div class="flex items-start gap-2">
                  <lucide-angular [img]="item.kind === 'warning' ? WarningIcon : ErrorIcon"
                    class="mt-0.5 w-4 h-4 shrink-0 text-state-err" />
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-semibold">{{ item.title }}</p>
                    @if (item.context) { <p class="text-xs text-base-content-muted">{{ item.context }}</p> }
                    <p class="text-[11px] text-base-content-muted">{{ item.workspaceName }}</p>
                  </div>
                  <button type="button" class="btn btn-ghost btn-square btn-xs min-w-11 min-h-11"
                    [attr.aria-label]="'Dismiss ' + item.title"
                    (click)="store.dismissRecent(item.key)">
                    <lucide-angular [img]="DismissIcon" class="w-3.5 h-3.5" />
                  </button>
                </div>
                @if (item.actions.length) {
                  <div class="flex flex-wrap gap-1 mt-2">
                    @for (action of item.actions; track action.id) {
                      <button type="button" class="btn btn-ghost btn-xs min-h-11"
                        [disabled]="!!store.disabledReason(item, action.id) || store.isSubmitting(item)"
                        [attr.title]="store.disabledReason(item, action.id)"
                        [attr.aria-label]="action.label + ' ' + item.title"
                        (click)="activate(item, action.id)">{{ action.label }}</button>
                    }
                  </div>
                }
                @if (store.status(item)) { <p role="status" class="text-xs text-base-content-muted">{{ store.status(item) }}</p> }
              </div>
            } @empty {
              <p class="px-2 py-3 text-xs text-base-content-muted">No recent notices</p>
            }
          </section>
        </div>
        }
      </section>
    }
  `,
})
export class NotificationCenterComponent {
  protected readonly store = inject(NotificationCenterStore);
  protected readonly sound = inject(NotificationSoundService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly panelOpen = signal(false);
  private readonly bellButton = viewChild<ElementRef<HTMLButtonElement>>('bellButton');
  private readonly panelHeading = viewChild<ElementRef<HTMLElement>>('panelHeading');
  protected readonly BellIcon = Bell;
  protected readonly EmptyIcon = Check;
  protected readonly ClearIcon = Trash2;
  protected readonly ErrorIcon = CircleAlert;
  protected readonly WarningIcon = TriangleAlert;
  protected readonly QuestionIcon = MessageCircleQuestion;
  protected readonly PermissionIcon = ShieldQuestion;
  protected readonly Volume2Icon = Volume2;
  protected readonly VolumeXIcon = VolumeX;
  protected readonly DismissIcon = X;

  protected bellLabel(): string {
    const count = this.store.badgeCount();
    return `Notifications, ${count} need${count === 1 ? 's' : ''} your response`;
  }

  protected visualCount(): string {
    const count = this.store.badgeCount();
    return count > 9 ? '9+' : String(count);
  }

  protected toggle(): void {
    if (this.panelOpen()) { this.close(false); return; }
    this.openPanel();
  }

  openPanel(): void {
    if (this.panelOpen()) return;
    this.panelOpen.set(true);
    this.store.setPanelOpen(true);
    setTimeout(() => {
      const row = this.host.nativeElement.querySelector<HTMLElement>(
        '#ptah-notification-center-panel .notification-row[tabindex="0"]',
      );
      (row ?? this.panelHeading()?.nativeElement)?.focus();
    }, 0);
  }

  protected close(restoreFocus: boolean): void {
    if (!this.panelOpen()) return;
    this.panelOpen.set(false);
    this.store.setPanelOpen(false);
    if (restoreFocus) setTimeout(() => this.bellButton()?.nativeElement.focus(), 0);
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this.panelOpen() && event.target instanceof Node && !this.host.nativeElement.contains(event.target))
      this.close(true);
  }

  protected async activate(item: AttentionItem, actionId: string): Promise<void> {
    const success = await this.store.activate(item, actionId);
    if (success && actionId.toLowerCase() === 'open') this.close(false);
  }
}
