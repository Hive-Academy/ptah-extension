import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  NgZone,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { ClaudeAmbientStatusView } from '@ptah-extension/core';
import { ambientRowModel, type AmbientTone } from './account-presentation';

/** The age line is refreshed this often while the row is mounted (P5-D9: one timer, not one per row). */
const AGE_REFRESH_MS = 30_000;

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

const DOT: Readonly<Record<AmbientTone, string>> = {
  done: 'bg-state-done',
  need: 'bg-state-need',
  idle: 'bg-state-idle',
  run: 'bg-state-run',
};

/**
 * "Existing Claude login" row (design §3.2, plan §8). It only shows the host's ambient status and offers
 * "Check again": no identity, path, sign-in, rename or removal. Status is dot + text, never colour alone.
 *
 * Focus (busy rule §3.7 c, binding rule B-2): when a check starts while "Check again" holds focus, focus moves to
 * the status line (`tabindex=-1`, polite live region) before the button is disabled. When the check ends, focus
 * returns to the button only if it is still on the status line; otherwise the live status announces the result.
 */
@Component({
  selector: 'ptah-ambient-account-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-base-300 bg-base-200 p-3"
      role="group"
      aria-label="Existing Claude login"
      data-testid="ambient-account-row"
    >
      <span
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-300 text-xs font-bold text-base-content"
        aria-hidden="true"
        >E</span
      >
      <div class="min-w-[150px] flex-1 break-words text-base-content">
        <p class="text-sm font-bold">Existing Claude login</p>
        <p class="text-xs text-base-content-muted">
          The Claude login already on this computer. Ptah only reads its status here.
        </p>
        <p
          #status
          class="mt-1 flex items-center text-xs outline-none focus:!outline-none focus:!shadow-none"
          role="status"
          aria-live="polite"
          tabindex="-1"
          data-testid="ambient-status"
        >
          @if (model().checking) {
            <span
              class="mr-1.5 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-base-content-muted border-t-base-content motion-reduce:animate-none"
              aria-hidden="true"
              data-testid="ambient-spinner"
            ></span>
          } @else {
            <span
              [class]="'mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full ' + dot()"
              aria-hidden="true"
              data-testid="ambient-dot"
            ></span>
          }
          <span>{{ model().statusText }}</span>
        </p>
        @if (model().extraText; as extra) {
          <p class="mt-1 text-xs" data-testid="ambient-extra">{{ extra }}</p>
        }
        @if (model().ageText; as age) {
          <p class="mt-1 text-xs text-base-content-muted" data-testid="ambient-age">{{ age }}</p>
        }
        @if (chips().length > 0) {
          <div class="mt-1 flex flex-wrap gap-1" data-testid="ambient-chips">
            @for (chip of chips(); track chip) {
              <span class="badge badge-outline badge-sm text-base-content">{{ chip }}</span>
            }
          </div>
        }
      </div>
      <button
        #check
        type="button"
        [class]="'btn btn-sm min-h-[30px] ' + focusRing"
        aria-label="Check the existing Claude login again"
        [disabled]="model().checking"
        (click)="requestCheck()"
        data-testid="ambient-check-again"
      >
        Check again
      </button>
    </div>
  `,
})
export class AmbientAccountRowComponent {
  private readonly document = inject(DOCUMENT);

  /** The webview's ambient view, unchanged (`ClaudeAmbientStatusService.view`). */
  readonly ambient = input.required<ClaudeAmbientStatusView>();
  /** "Used for" chips of this row, from the host snapshot only. */
  readonly chips = input<readonly string[]>([]);
  /** The user asked for a fresh read. The parent owns the read. */
  readonly checkRequested = output<void>();

  protected readonly focusRing = FOCUS;
  private readonly now = signal(Date.now());
  protected readonly model = computed(() => ambientRowModel(this.ambient(), this.now()));
  protected readonly dot = computed(() => DOT[this.model().tone]);

  private readonly statusEl = viewChild.required<ElementRef<HTMLElement>>('status');
  private readonly checkEl = viewChild.required<ElementRef<HTMLButtonElement>>('check');
  /** Focus was moved to the status line for the requested check (B-2 waiting target). */
  private readonly waiting = signal(false);

  constructor() {
    // One timer while mounted, outside the zone; the signal write still schedules the render.
    const timer = inject(NgZone).runOutsideAngular(() =>
      setInterval(() => this.now.set(Date.now()), AGE_REFRESH_MS),
    );
    inject(DestroyRef).onDestroy(() => clearInterval(timer));

    // After render, so the button is already enabled when focus returns to it.
    afterRenderEffect(() => {
      const checking = this.model().checking;
      const waiting = this.waiting();
      const status = this.statusEl().nativeElement;
      const button = this.checkEl().nativeElement;
      const active = this.document.activeElement;
      if (checking) {
        // A check started elsewhere (for example on tab open) while the button held focus.
        if (active === button) {
          status.focus();
          this.waiting.set(true);
        }
        return;
      }
      if (!waiting) return;
      this.waiting.set(false);
      if (active === status && status.isConnected) button.focus();
    });
  }

  /** Focus leaves the button before the parent's read disables it (busy rule §3.7 c). */
  protected requestCheck(): void {
    if (this.model().checking) return;
    this.statusEl().nativeElement.focus();
    this.waiting.set(true);
    this.checkRequested.emit();
  }
}
