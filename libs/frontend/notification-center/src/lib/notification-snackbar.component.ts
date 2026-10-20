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
          <section
            class="snackbar-card surface-3 rounded-xl border-l-4 p-3 text-base-content"
            [class.border-primary]="isRequest(item)"
            [class.border-error]="item.kind === 'failure'"
            [class.border-warning]="item.kind === 'warning'"
            [attr.aria-label]="item.title"
            (mouseenter)="hover(item.key, true)"
            (mouseleave)="hover(item.key, false)"
            (focusin)="focus(item.key, true)"
            (focusout)="focusOut(item.key, $event)"
          >
            <div class="flex items-start gap-2">
              <lucide-angular [img]="icon(item)" class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold">{{ item.title }}</p>
                @if (item.context || item.workspaceName) {
                  <p class="text-xs text-base-content-muted">{{ item.context ? item.context + ' · ' + item.workspaceName : item.workspaceName }}</p>
                }
              </div>
              <button type="button" class="btn btn-ghost btn-square min-h-11 min-w-11 shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                [attr.aria-label]="'Dismiss ' + item.title"
                (click)="dismiss(item.key)">
                <lucide-angular [img]="XIcon" class="h-6 w-6" aria-hidden="true" />
              </button>
            </div>
            @if (item.actions.length) {
              <div class="mt-2 flex flex-wrap gap-2">
                @for (action of item.actions; track action.id) {
                  <button type="button" class="btn btn-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    [class.btn-primary]="$first" [class.btn-ghost]="!$first"
                    [disabled]="!!action.disabledReason || !!unavailable().get(item.key + ':' + item.generation + ':' + action.id) || pending().has(item.key)"
                    [attr.title]="action.disabledReason || unavailable().get(item.key + ':' + item.generation + ':' + action.id) || null"
                    [attr.aria-label]="action.disabledReason ? action.label + ': ' + action.disabledReason : action.label"
                    (click)="dispatch(item, action.id)">{{ action.label }}</button>
                }
              </div>
            }
            @if (statuses().get(item.key + ':' + item.generation); as status) {
              <p role="status" class="text-xs text-base-content-muted">{{ status }}</p>
            }
          </section>
        }
        @if (overflow() > 0) {
          <button type="button" class="snackbar-more btn btn-ghost btn-sm self-end focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
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
      const resize = (): void => this.limit.set(window.innerWidth <= 900 || window.innerHeight <= 620 ? 1 : 3);
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

  protected icon(item: AttentionItem): typeof ShieldQuestion {
    if (item.kind === 'question') return MessageCircleQuestion;
    if (item.kind === 'failure') return CircleAlert;
    if (item.kind === 'warning') return TriangleAlert;
    return ShieldQuestion;
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
