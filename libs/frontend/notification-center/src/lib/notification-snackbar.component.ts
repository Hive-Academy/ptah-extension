import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject,
  input, output, signal,
} from '@angular/core';
import {
  ATTENTION_ACTION_DISPATCHER, NOTIFICATION_FOCUS_ROUTER, NotificationService, type AttentionItem,
} from '@ptah-extension/core';
import {
  CircleAlert, MessageCircleQuestion, ShieldQuestion, TriangleAlert,
  X, LucideAngularModule,
} from 'lucide-angular';

@Component({
  selector: 'ptah-notification-snackbar',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ptah-snackbar-host' },
  styles: [`
    :host { position: fixed; z-index: 60; top: var(--ptah-snackbar-top, 4rem); right: 1rem; width: min(348px, calc(100vw - 2rem)); pointer-events: none; }
    .snackbar-card, .snackbar-more { pointer-events: auto; }
    .snackbar-card { animation: snackbar-enter 120ms ease-out; }
    @keyframes snackbar-enter { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    @media (prefers-reduced-motion: reduce) { .snackbar-card { animation: none; } }
    @media (max-width: 900px) { :host { right: .5rem; width: min(348px, calc(100vw - 1rem)); } }
  `],
  template: `
    @if (!panelOpen()) {
      <div class="flex flex-col gap-2" data-testid="notification-snackbars">
        @for (item of visible(); track item.key) {
          <section class="snackbar-card surface-3 relative rounded-2xl border border-[color:var(--surface-border)] shadow-[var(--elev-shadow-raised)] p-3 pl-4 text-base-content hover:bg-[color:var(--surface-highlight)]"
            [attr.aria-label]="kindLabel(item) + ' for ' + sessionName(item) + ' in ' + workspaceName(item)"
            (mouseenter)="hover(item.key, true)" (mouseleave)="hover(item.key, false)"
            (focusin)="focus(item.key, true)" (focusout)="focusOut(item.key, $event)">
            <span class="absolute inset-y-3 left-0 w-[3px] rounded-r-full" [class.bg-state-need]="isRequest(item)" [class.bg-state-err]="!isRequest(item)" aria-hidden="true"></span>
            <div class="flex items-start gap-2">
              <lucide-angular [img]="icon(item)" class="mt-0.5 size-4 shrink-0" [class.text-state-need]="isRequest(item)" [class.text-state-err]="!isRequest(item)" aria-hidden="true" />
              <div class="min-w-0 flex-1">
                <p class="text-[11px] font-semibold uppercase tracking-[0.06em] text-base-content-muted">{{ kindLabel(item) }}</p>
                <p class="mt-1 truncate text-sm font-semibold text-base-content" [attr.title]="sessionName(item)">{{ sessionName(item) }}</p>
                <div class="flex min-w-0 items-center gap-1.5 text-xs text-base-content-muted">
                  @if (item.provider) { <span class="truncate">{{ item.provider }}</span> }
                  <span class="max-w-[11rem] truncate rounded-md border border-[color:var(--surface-border)] bg-base-200 px-1.5 py-0.5 text-[11px] text-base-content" [attr.title]="workspaceName(item)">{{ workspaceName(item) }}</span>
                </div>
              </div>
              <button type="button" class="btn btn-ghost btn-square size-8 min-h-11 min-w-11 shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                [attr.aria-label]="'Dismiss ' + kindLabel(item) + ' presentation for ' + sessionName(item) + ' in ' + workspaceName(item)" (click)="dismiss(item.key)">
                <lucide-angular [img]="XIcon" class="size-4" aria-hidden="true" />
              </button>
            </div>
            @if (item.detail || (!isRequest(item) && item.context)) { <p class="mt-2 truncate text-xs text-base-content-muted" [attr.title]="item.detail || item.context">{{ item.detail || item.context }}</p> }
            @if (item.actions.length) {
              <div class="mt-3 flex flex-wrap items-center gap-1.5">
                @for (action of item.actions; track action.id) {
                  <button type="button" class="btn btn-sm min-h-11 disabled:opacity-100 disabled:bg-base-200 disabled:text-base-content-muted disabled:border-[color:var(--surface-border)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    [class.btn-primary]="isPrimary(item, action.id)" [class.btn-ghost]="!isPrimary(item, action.id)"
                    [disabled]="!!actionReason(item, action.id) || pending().has(item.key)"
                    [attr.title]="actionReason(item, action.id)"
                    [attr.aria-describedby]="actionReason(item, action.id) ? 'snackbar-reason-' + item.key + '-' + action.id : pending().has(item.key) ? 'snackbar-pending-' + item.key : null"
                    [attr.aria-label]="action.label + ' ' + kindLabel(item) + ' for ' + sessionName(item) + ' in ' + workspaceName(item)"
                    (click)="dispatch(item, action.id)">{{ action.label }}</button>
                }
              </div>
            }
            @for (action of item.actions; track action.id) {
              @if (actionReason(item, action.id); as reason) { <p [id]="'snackbar-reason-' + item.key + '-' + action.id" class="text-xs text-base-content-muted">{{ reason }}</p> }
            }
            @if (pending().has(item.key)) { <p [id]="'snackbar-pending-' + item.key" class="text-xs text-base-content-muted">Submitting...</p> }
            @if (statuses().get(item.key + ':' + item.generation); as status) {
              <p role="status" class="text-xs text-base-content-muted">{{ status }}</p>
            }
          </section>
        }
        @if (overflow() > 0) {
          <button type="button" class="snackbar-more btn btn-ghost btn-sm self-end focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            [attr.aria-label]="'Show ' + overflow() + ' more notifications'"
            (click)="$event.stopPropagation(); openNotifications.emit()">+{{ overflow() }} more</button>
        }
      </div>
    }
  `,
})
export class NotificationSnackbarComponent {
  private readonly notifications = inject(NotificationService);
  private readonly dispatcher = inject(ATTENTION_ACTION_DISPATCHER, { optional: true });
  private readonly focusRouter = inject(NOTIFICATION_FOCUS_ROUTER, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private readonly hovered = new Set<string>();
  private readonly focused = new Set<string>();
  private readonly paused = new Set<string>();
  readonly panelOpen = input(false);
  readonly openNotifications = output<void>();
  protected readonly pending = signal<ReadonlySet<string>>(new Set());
  protected readonly statuses = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly unavailable = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly limit = signal(3);
  protected readonly visible = computed(() => this.notifications.snackbars().slice(0, this.limit()));
  protected readonly overflow = computed(() => Math.max(0, this.notifications.snackbars().length - this.limit()));
  protected readonly XIcon = X;

  constructor() {
    if (typeof window !== 'undefined') {
      const resize = (): void => this.limit.set(window.innerWidth <= 900 ? 1 : 3);
      resize();
      window.addEventListener('resize', resize);
      this.destroyRef.onDestroy(() => window.removeEventListener('resize', resize));
    }
    effect(() => {
      if (this.panelOpen()) this.notifications.pauseAll();
      else this.notifications.resumeAll();
    });
    effect(() => {
      const visibleKeys = new Set(this.visible().map(item => item.key));
      const live = new Set(this.notifications.snackbars().map(item => `${item.key}:${item.generation}`));
      this.statuses.update(current => new Map([...current].filter(([key]) => live.has(key))));
      this.unavailable.update(current => new Map([...current].filter(([key]) => [...live].some(id => key.startsWith(`${id}:`)))));
      for (const key of this.paused) {
        if (visibleKeys.has(key) && !this.panelOpen()) continue;
        this.paused.delete(key);
        this.hovered.delete(key);
        this.focused.delete(key);
        this.notifications.resumeSnackbar(key);
      }
    });
    this.destroyRef.onDestroy(() => {
      for (const key of this.paused) this.notifications.resumeSnackbar(key);
      if (this.panelOpen()) this.notifications.resumeAll();
    });
  }

  protected isRequest(item: AttentionItem): boolean {
    return item.kind === 'permission' || item.kind === 'question' || item.kind === 'lane-permission';
  }

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

  protected actionReason(item: AttentionItem, actionId: string): string | undefined {
    return item.actions.find(action => action.id === actionId)?.disabledReason ||
      this.unavailable().get(`${item.key}:${item.generation}:${actionId}`);
  }

  protected isPrimary(item: AttentionItem, actionId: string): boolean {
    const preferred = item.kind === 'question' ? 'answer' : 'allow';
    const canUsePreferred = item.actions.some(action => action.id === preferred && !this.actionReason(item, preferred));
    return actionId === (canUsePreferred ? preferred : 'open') && !this.actionReason(item, actionId);
  }

  protected icon(item: AttentionItem): typeof ShieldQuestion {
    if (item.kind === 'question') return MessageCircleQuestion;
    if (item.kind === 'failure') return CircleAlert;
    if (item.kind === 'warning') return TriangleAlert;
    return item.kind === 'lane-permission' ? CircleAlert : ShieldQuestion;
  }

  protected hover(key: string, active: boolean): void {
    if (active) this.hovered.add(key);
    else this.hovered.delete(key);
    this.updatePause(key);
  }

  protected focus(key: string, active: boolean): void {
    if (active) this.focused.add(key);
    else this.focused.delete(key);
    this.updatePause(key);
  }

  protected focusOut(key: string, event: FocusEvent): void {
    const current = event.currentTarget;
    if (current instanceof HTMLElement && event.relatedTarget instanceof Node && current.contains(event.relatedTarget)) return;
    this.focus(key, false);
  }

  private updatePause(key: string): void {
    const active = this.hovered.has(key) || this.focused.has(key);
    if (active && !this.paused.has(key)) {
      this.paused.add(key);
      this.notifications.pauseSnackbar(key);
    } else if (!active && this.paused.delete(key)) {
      this.notifications.resumeSnackbar(key);
    }
  }

  protected dismiss(key: string): void {
    this.hovered.delete(key);
    this.focused.delete(key);
    if (this.paused.delete(key)) this.notifications.resumeSnackbar(key);
    this.notifications.dismissPresentation(key);
  }

  protected async dispatch(item: AttentionItem, actionId: string): Promise<void> {
    if (this.pending().has(item.key)) return;
    this.pending.update(keys => new Set([...keys, item.key]));
    try {
      const request = `${item.key}:${item.generation}`;
      if (item.kind === 'failure' && actionId.toLowerCase() === 'open') {
        const result = item.sessionId && this.focusRouter
          ? await this.focusRouter.focus({ workspacePath: item.workspacePath, sessionId: item.sessionId, tabId: item.tabId })
          : { success: false };
        if (!result.success) this.statuses.update(current => new Map(current).set(request, 'Session unavailable'));
      } else if (this.dispatcher?.dispatchOutcome) {
        const outcome = await this.dispatcher.dispatchOutcome(item.key, item.generation, actionId);
        if (outcome.kind === 'stale') this.statuses.update(current => new Map(current).set(request, 'Already answered'));
        if (outcome.kind === 'unavailable') {
          this.statuses.update(current => new Map(current).set(request, outcome.reason));
          this.unavailable.update(current => new Map(current).set(`${request}:${actionId}`, outcome.reason));
        }
      } else if (this.dispatcher) {
        await this.dispatcher.dispatch(item.key, item.generation, actionId);
      }
    } catch {
      this.statuses.update(current => new Map(current).set(`${item.key}:${item.generation}`, 'Action unavailable'));
    } finally {
      this.pending.update(keys => new Set([...keys].filter(key => key !== item.key)));
    }
  }
}
