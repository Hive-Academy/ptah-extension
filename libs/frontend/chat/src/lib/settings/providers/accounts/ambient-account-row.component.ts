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
import { SettingsBusyDisabledDirective } from '../../feedback/busy-disabled.directive';
import { ambientStatusModel, type AmbientTone } from './account-presentation';

/** The age in the status hint is refreshed this often while the row is mounted (P5-D9: one timer, not one per row). */
const AGE_REFRESH_MS = 30_000;

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

const DOT: Readonly<Record<AmbientTone, string>> = {
  done: 'bg-state-done',
  need: 'bg-state-need',
  idle: 'bg-state-idle',
  run: 'bg-state-run',
};

/** The word for which the row offers no Check (P6-7). */
const SIGNED_IN_WORD = 'Signed in';

/**
 * "Existing Claude login" row of the Accounts list (design-spec-p6 "Accounts tab", plan P6 component 8). It shows the
 * host's ambient status as dot + word and offers "Check" only when the word is not "Signed in". No identity, path,
 * sign-in, rename or removal. The flagged cues and the age (D54, P6-A4) live in the word's tooltip and an `sr-only`
 * copy right after it; there is no visible helper sentence. The check result is announced by the page toast (AT).
 *
 * Focus (B-2): Check stays focusable while a check runs (`ptahBusyDisabled`). When the check ends signed in, Check
 * disappears; only if it held focus at that moment (focus fell to the body) does focus move to the row name
 * (`tabindex=-1`). Otherwise focus is never moved.
 */
@Component({
  selector: 'ptah-ambient-account-row',
  standalone: true,
  imports: [SettingsBusyDisabledDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-box border border-base-content/15 bg-base-100 px-4 py-3 text-base-content"
      role="group"
      aria-labelledby="ambient-account-name"
      data-testid="ambient-account-row"
    >
      <span
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-300 text-xs font-bold"
        aria-hidden="true"
        >E</span
      >
      <div class="min-w-0 flex-1 basis-40 space-y-0.5 break-words">
        <p
          #name
          id="ambient-account-name"
          class="font-semibold outline-none focus:!outline-none focus:!shadow-none"
          tabindex="-1"
          data-testid="ambient-name"
        >Existing Claude login</p>
        <p class="flex min-w-0 items-center text-xs text-base-content-muted">
          @if (model().checking) {
            <span
              class="mr-1.5 inline-block h-3 w-3 shrink-0 loading loading-spinner text-base-content-muted motion-reduce:animate-none"
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
          <span [attr.title]="model().hint" data-testid="ambient-status">{{ model().word }}</span>
          @if (model().hint; as hint) {
            <span class="sr-only" data-testid="ambient-hint">{{ hint }}</span>
          }
        </p>
        @if (chips().length > 0) {
          <p class="flex min-w-0 flex-wrap items-center gap-1 text-xs" data-testid="ambient-chips">
            <span class="text-base-content-muted">Used by</span>
            @for (chip of chips(); track chip) {
              <span class="badge badge-ghost badge-sm h-auto max-w-full whitespace-normal break-words">{{ chip }}</span>
            }
          </p>
        }
      </div>
      @if (showCheck()) {
        <button
          #check
          type="button"
          [class]="'btn btn-outline btn-sm min-h-8 shrink-0 ' + focusRing"
          aria-label="Check the existing Claude login"
          [ptahBusyDisabled]="model().checking"
          (focus)="checkHadFocus = true"
          (blur)="checkBlurred($event)"
          (click)="requestCheck()"
          data-testid="ambient-check"
        >
          Check
        </button>
      }
    </div>
  `,
})
export class AmbientAccountRowComponent {
  private readonly document = inject(DOCUMENT);

  /** The webview's ambient view, unchanged (`ClaudeAmbientStatusService.view`). */
  readonly ambient = input.required<ClaudeAmbientStatusView>();
  /** "Used by" chips of this row ("Chat", "Lanes"), from the host snapshot only. */
  readonly chips = input<readonly string[]>([]);
  /** The user asked for a fresh read. The parent owns the read and announces its result. */
  readonly checkRequested = output<void>();

  protected readonly focusRing = FOCUS;
  private readonly now = signal(Date.now());
  protected readonly model = computed(() => ambientStatusModel(this.ambient(), this.now()));
  protected readonly dot = computed(() => DOT[this.model().tone]);
  protected readonly showCheck = computed(() => this.model().word !== SIGNED_IN_WORD);

  private readonly nameEl = viewChild.required<ElementRef<HTMLElement>>('name');
  /** Check was the last focused control and focus did not move to another element since. */
  protected checkHadFocus = false;
  /** `showCheck` of the previous render, to see the button disappear. */
  private checkShown = false;

  constructor() {
    // One timer while mounted, outside the zone; the signal write still schedules the render.
    const timer = inject(NgZone).runOutsideAngular(() =>
      setInterval(() => this.now.set(Date.now()), AGE_REFRESH_MS),
    );
    inject(DestroyRef).onDestroy(() => clearInterval(timer));

    // After render, so the button is already gone and focus has fallen to the body.
    afterRenderEffect(() => {
      const shown = this.showCheck();
      const vanished = this.checkShown && !shown;
      this.checkShown = shown;
      if (!vanished) return;
      const hadFocus = this.checkHadFocus;
      this.checkHadFocus = false;
      const active = this.document.activeElement;
      if (hadFocus && (active === null || active === this.document.body)) {
        this.nameEl().nativeElement.focus();
      }
    });
  }

  /** A blur caused by the button's removal (no new target, element detached) keeps the flag for B-2. */
  protected checkBlurred(event: FocusEvent): void {
    const target = event.target as HTMLElement;
    if (event.relatedTarget !== null || target.isConnected) this.checkHadFocus = false;
  }

  protected requestCheck(): void {
    if (this.model().checking) return;
    this.checkRequested.emit();
  }
}
