import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Bell, Check, CircleAlert, MessageCircleQuestion, ShieldQuestion, Trash2, TriangleAlert, Volume2, VolumeX, X, LucideAngularModule } from 'lucide-angular';
import { AttentionPermissionActionsComponent, type AttentionItem } from '@ptah-extension/core';
import { NotificationCenterStore } from './notification-center.store';
import { NotificationSoundService } from './notification-sound.service';

@Component({
  selector: 'ptah-notification-center',
  standalone: true,
  imports: [LucideAngularModule, AttentionPermissionActionsComponent],
  providers: [NotificationCenterStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative inline-flex',
    '(document:click)': 'onDocumentClick($event)',
  },
  template: `
    <button #bellButton type="button" class="btn btn-ghost btn-square btn-xs relative focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      aria-haspopup="dialog" [attr.aria-expanded]="panelOpen()" aria-controls="ptah-notification-center-panel"
      [attr.aria-label]="bellLabel()" title="Notifications" data-testid="notification-center-bell" (click)="toggle()">
      <lucide-angular [img]="BellIcon" class="size-3.5" />
      @if (store.badgeCount() > 0) { <span class="absolute -right-1 -top-1 min-w-4 h-4 px-1 rounded-full bg-warning text-warning-content text-[10px] leading-4 text-center font-semibold" aria-hidden="true" data-testid="notification-count-badge">{{ visualCount() }}</span> }
    </button>
    @if (panelOpen()) {
      <section id="ptah-notification-center-panel" role="dialog" aria-modal="false" aria-labelledby="ptah-notification-center-heading"
        class="surface-3 absolute right-0 top-full mt-2 z-50 w-[360px] max-w-[calc(100vw-1rem)] max-h-[min(780px,calc(100vh-1rem))] overflow-y-auto rounded-2xl border border-[color:var(--surface-border)]"
        data-testid="notification-center-panel" (keydown.escape)="close(true)">
        <header class="sticky top-0 z-10 flex items-center gap-2 border-b border-[color:var(--surface-border)] surface-3 p-3">
          <h2 #panelHeading id="ptah-notification-center-heading" tabindex="-1" class="flex-1 text-sm font-semibold outline-none">Notifications</h2>
          <button type="button" class="btn btn-ghost btn-square btn-xs min-h-11 min-w-11" [attr.aria-label]="sound.muted() ? 'Unmute notification sounds' : 'Mute notification sounds'" (click)="sound.setMuted(!sound.muted())"><lucide-angular [img]="sound.muted() ? VolumeXIcon : Volume2Icon" class="size-3.5" /></button>
          <button type="button" class="btn btn-ghost btn-xs min-h-11 disabled:opacity-100 disabled:text-base-content-muted" aria-label="Clear all notices" [disabled]="!store.canClearAll()" (click)="store.clearAll()"><lucide-angular [img]="ClearIcon" class="size-3.5" />Clear all notices</button>
        </header>
        @if (store.needsYou().length === 0 && store.recentNotices().length === 0) {
          <div class="px-3 py-11 text-center"><lucide-angular [img]="EmptyIcon" class="mx-auto size-7 text-success" aria-hidden="true" /><h3 class="mt-2 text-sm font-semibold">All clear</h3><p class="mt-1 text-xs text-base-content-muted">Nothing needs your attention.</p></div>
        } @else {
          <div class="space-y-3 p-2">
            <section aria-labelledby="ptah-needs-you-heading">
              <div class="flex items-center justify-between px-1 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-base-content-muted"><h3 id="ptah-needs-you-heading">Needs you</h3><span>{{ store.badgeCount() }}</span></div>
              <div role="list" aria-labelledby="ptah-needs-you-heading" class="space-y-1.5">
                @for (item of store.needsYou(); track item.key) {
                  <div role="listitem" class="notification-row surface-2 relative rounded-xl border border-[color:var(--surface-border)] shadow-[var(--elev-shadow)] p-3 pl-4 hover:bg-[color:var(--surface-highlight)]" [attr.aria-label]="kindLabel(item) + ' for ' + sessionName(item) + ' in ' + workspaceName(item)">
                    <span class="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-state-need" aria-hidden="true"></span>
                    <div class="flex items-start gap-2">
                      <lucide-angular [img]="icon(item)" class="mt-0.5 size-4 shrink-0 text-state-need" aria-hidden="true" />
                      <div class="min-w-0 flex-1"><p class="text-[11px] font-semibold uppercase tracking-[0.06em] text-base-content-muted">{{ kindLabel(item) }}</p><p class="mt-1 truncate text-sm font-semibold text-base-content" [attr.title]="item.title">{{ item.title }}</p><div class="flex min-w-0 items-center gap-1.5 text-xs text-base-content-muted"><span class="truncate" [attr.title]="sessionName(item)">{{ sessionName(item) }}</span>@if (item.provider) { <span class="truncate">{{ item.provider }}</span> }<span class="max-w-[11rem] truncate rounded-md border border-[color:var(--surface-border)] bg-base-200 px-1.5 py-0.5 text-[11px] text-base-content" [attr.title]="workspaceName(item)">{{ workspaceName(item) }}</span></div></div>
                    </div>
                    @if (item.detail || ((item.kind === 'failure' || item.kind === 'warning') && item.context)) { <p class="mt-2 truncate text-xs text-base-content-muted" [attr.title]="item.detail || item.context">{{ item.detail || item.context }}</p> }
                    @if (item.kind === 'permission') {
                      <ptah-attention-permission-actions [item]="item" [busy]="store.isSubmitting(item) || store.isStale(item)" [unavailable]="store.unavailableFor(item)" (selected)="activate(item, $event.actionId, $event.reason)" />
                    } @else { <div class="mt-3 flex flex-wrap items-center gap-1.5">
                      @for (action of item.actions; track action.id) {
                        <button type="button" class="btn btn-sm min-h-11 disabled:opacity-100 disabled:bg-base-200 disabled:text-base-content-muted disabled:border-[color:var(--surface-border)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                          [class.btn-primary]="isPrimary(item, action.id)" [class.btn-ghost]="!isPrimary(item, action.id)"
                          [disabled]="!!store.disabledReason(item, action.id) || store.isSubmitting(item) || store.isStale(item)"
                          [attr.title]="store.disabledReason(item, action.id)"
                          [attr.aria-describedby]="store.disabledReason(item, action.id) ? 'bell-reason-' + item.key + '-' + action.id : store.isSubmitting(item) ? 'bell-pending-' + item.key : null"
                          [attr.aria-label]="action.label + ' ' + kindLabel(item) + ' for ' + sessionName(item) + ' in ' + workspaceName(item)"
                          (click)="activate(item, action.id)">{{ action.label }}</button>
                      }
                    </div> }
                    @for (action of item.actions; track action.id) { @if (store.disabledReason(item, action.id); as reason) { <p [id]="'bell-reason-' + item.key + '-' + action.id" class="text-xs text-base-content-muted">{{ reason }}</p> } }
                    @if (store.isSubmitting(item)) { <p [id]="'bell-pending-' + item.key" class="text-xs text-base-content-muted">Submitting...</p> }
                    @if (store.status(item)) { <p role="status" class="text-xs text-base-content-muted">{{ store.status(item) }}</p> }
                  </div>
                } @empty { <p class="px-2 py-3 text-xs text-base-content-muted">Nothing needs your response</p> }
              </div>
            </section>
            <section aria-labelledby="ptah-recent-heading">
              <div class="flex items-center justify-between px-1 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-base-content-muted"><h3 id="ptah-recent-heading">Recent notices</h3><span>{{ store.recentNotices().length }}</span></div>
              <div role="list" aria-labelledby="ptah-recent-heading" class="space-y-1.5">
                @for (item of store.recentNotices(); track item.key) {
                  <div role="listitem" class="notification-row surface-2 relative rounded-xl border border-[color:var(--surface-border)] shadow-[var(--elev-shadow)] p-3 pl-4 hover:bg-[color:var(--surface-highlight)]">
                    <span class="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-state-err" aria-hidden="true"></span>
                    <div class="flex items-start gap-2"><lucide-angular [img]="icon(item)" class="mt-0.5 size-4 shrink-0 text-state-err" aria-hidden="true" /><div class="min-w-0 flex-1"><p class="text-[11px] font-semibold uppercase tracking-[0.06em] text-base-content-muted">{{ kindLabel(item) }}</p><p class="mt-1 truncate text-sm font-semibold text-base-content" [attr.title]="sessionName(item)">{{ sessionName(item) }}</p><div class="flex min-w-0 items-center gap-1.5 text-xs text-base-content-muted">@if (item.provider) { <span class="truncate">{{ item.provider }}</span> }<span class="max-w-[11rem] truncate rounded-md border border-[color:var(--surface-border)] bg-base-200 px-1.5 py-0.5 text-[11px] text-base-content" [attr.title]="workspaceName(item)">{{ workspaceName(item) }}</span></div></div><button type="button" class="btn btn-ghost btn-square size-8 min-h-11 min-w-11 shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" [attr.aria-label]="'Dismiss ' + kindLabel(item) + ' for ' + sessionName(item) + ' in ' + workspaceName(item)" (click)="store.dismissRecent(item.key)"><lucide-angular [img]="DismissIcon" class="size-4" /></button></div>
                    @if (item.detail || ((item.kind === 'failure' || item.kind === 'warning') && item.context)) { <p class="mt-2 truncate text-xs text-base-content-muted" [attr.title]="item.detail || item.context">{{ item.detail || item.context }}</p> }
                    @if (item.kind === 'permission') {
                       <ptah-attention-permission-actions [item]="item" [busy]="store.isSubmitting(item) || store.isStale(item)" [unavailable]="store.unavailableFor(item)" (selected)="activate(item, $event.actionId, $event.reason)" />
                    } @else if (item.actions.length) { <div class="mt-3 flex flex-wrap items-center gap-1.5">@for (action of item.actions; track action.id) { <button type="button" class="btn btn-ghost btn-sm min-h-11 disabled:opacity-100 disabled:bg-base-200 disabled:text-base-content-muted disabled:border-[color:var(--surface-border)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" [disabled]="!!store.disabledReason(item, action.id) || store.isSubmitting(item) || store.isStale(item)" [attr.title]="store.disabledReason(item, action.id)" [attr.aria-describedby]="store.disabledReason(item, action.id) ? 'bell-reason-' + item.key + '-' + action.id : store.isSubmitting(item) ? 'bell-pending-' + item.key : null" [attr.aria-label]="action.label + ' ' + kindLabel(item) + ' for ' + sessionName(item) + ' in ' + workspaceName(item)" (click)="activate(item, action.id)">{{ action.label }}</button> }</div> }
                    @for (action of item.actions; track action.id) { @if (store.disabledReason(item, action.id); as reason) { <p [id]="'bell-reason-' + item.key + '-' + action.id" class="text-xs text-base-content-muted">{{ reason }}</p> } }
                    @if (store.isSubmitting(item)) { <p [id]="'bell-pending-' + item.key" class="text-xs text-base-content-muted">Submitting...</p> }
                    @if (store.status(item)) { <p role="status" class="text-xs text-base-content-muted">{{ store.status(item) }}</p> }
                  </div>
                } @empty { <p class="px-2 py-3 text-xs text-base-content-muted">No recent notices</p> }
              </div>
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
  protected readonly Volume2Icon = Volume2;
  protected readonly VolumeXIcon = VolumeX;
  protected readonly DismissIcon = X;

  protected kindLabel(item: AttentionItem): string {
    if (item.kind === 'question') return 'Question needs an answer';
    if (item.kind === 'permission') return 'Permission required';
    if (item.kind === 'lane-permission') return 'Lane permission required';
    return item.title;
  }

  protected sessionName(item: AttentionItem): string {
    return item.sessionTitle || 'Session unavailable';
  }

  protected workspaceName(item: AttentionItem): string {
    return item.workspaceName && item.workspaceName !== 'Unknown workspace' ? item.workspaceName : 'Workspace unavailable';
  }

  protected icon(item: AttentionItem): typeof ShieldQuestion {
    if (item.kind === 'question') return MessageCircleQuestion;
    if (item.kind === 'lane-permission' || item.kind === 'failure') return CircleAlert;
    if (item.kind === 'warning') return TriangleAlert;
    return ShieldQuestion;
  }

  protected isPrimary(item: AttentionItem, actionId: string): boolean {
    const preferred = item.kind === 'question' ? 'answer' : 'allow';
    const canUsePreferred = item.actions.some(action => action.id === preferred && !this.store.disabledReason(item, preferred));
    return actionId === (canUsePreferred ? preferred : 'open') && !this.store.disabledReason(item, actionId);
  }

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
        '#ptah-notification-center-panel .notification-row button:not(:disabled)',
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

  protected async activate(item: AttentionItem, actionId: string, reason?: string): Promise<void> {
    const success = await this.store.activate(item, actionId, reason);
    if (success && actionId.toLowerCase() === 'open') this.close(false);
  }
}
