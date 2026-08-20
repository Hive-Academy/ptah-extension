/**
 * NativeCardComponent - Generic card shell with an optional status spine.
 *
 * A domain-free presentational container: it owns the card chrome (surface,
 * border, radius, padding, hover/selected/focus affordances and the coloured
 * status spine) and projects everything else. It deliberately knows nothing
 * about what it displays — the same primitive backs skills, agents, memory
 * blocks, cron schedules and gateway channels.
 *
 * Three projection slots, all optional and all wrapper-free (an unused slot
 * emits no DOM at all, so the inner flex `gap` never produces phantom
 * spacing):
 *
 * - `[card-header]` — title row
 * - default        — body
 * - `[card-footer]` — actions / metadata row
 *
 * INTERACTION. `clickable` turns the card into a `role="button"` activation
 * target (mouse + Enter/Space). Clicks that originate inside a nested
 * interactive element (`button`, `a`, `input`, …) or inside anything marked
 * `data-card-ignore` do NOT activate the card — that is what lets a card carry
 * its own action buttons without every action doubling as "open the card".
 *
 * `selectable` layers a two-state affordance on top (`aria-pressed` + a
 * selection ring) for cards that toggle rather than navigate.
 *
 * @example
 * ```html
 * <ptah-native-card
 *   tone="warning"
 *   [spine]="true"
 *   [clickable]="true"
 *   ariaLabel="Open details for deep-research"
 *   (activated)="openDetail()"
 * >
 *   <div card-header class="flex items-center justify-between">…</div>
 *   <p>Body content</p>
 *   <div card-footer><button (click)="enhance()">Enhance</button></div>
 * </ptah-native-card>
 * ```
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

/**
 * Semantic colour of a card's status spine / selection accent.
 *
 * Values map onto daisyUI semantic colours so a card inherits the active
 * theme rather than hard-coding palette values.
 */
export type NativeCardTone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'accent'
  | 'secondary'
  | 'primary';

/** Vertical padding scale for the card shell. */
export type NativeCardDensity = 'compact' | 'comfortable';

const SPINE_CLASS: Record<NativeCardTone, string> = {
  neutral: 'bg-base-content/30',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  accent: 'bg-accent',
  secondary: 'bg-secondary',
  primary: 'bg-primary',
};

const SELECTED_RING_CLASS: Record<NativeCardTone, string> = {
  neutral: 'ring-base-content/40',
  info: 'ring-info',
  success: 'ring-success',
  warning: 'ring-warning',
  error: 'ring-error',
  accent: 'ring-accent',
  secondary: 'ring-secondary',
  primary: 'ring-primary',
};

const DENSITY_CLASS: Record<NativeCardDensity, string> = {
  compact: 'p-3 gap-2',
  comfortable: 'p-4 gap-3',
};

/**
 * Selector list for descendants that own their own click semantics. A click
 * landing on (or inside) one of these never activates the card.
 */
const NESTED_INTERACTIVE_SELECTOR =
  'button, a[href], input, select, textarea, label, summary, [data-card-ignore]';

@Component({
  selector: 'ptah-native-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="relative flex flex-col overflow-hidden rounded-xl border transition-colors duration-150"
      [class]="rootClasses()"
      [attr.role]="interactive() ? 'button' : null"
      [attr.tabindex]="interactive() && !disabled() ? 0 : null"
      [attr.aria-pressed]="selectable() ? selected() : null"
      [attr.aria-disabled]="disabled() ? 'true' : null"
      [attr.aria-label]="ariaLabel()"
      [attr.data-tone]="tone()"
      (click)="onClick($event)"
      (keydown)="onKeydown($event)"
    >
      @if (spine()) {
        <span
          class="absolute inset-y-0 left-0 w-1"
          [class]="spineClass()"
          data-testid="native-card-spine"
          aria-hidden="true"
        ></span>
      }

      <div
        class="flex min-w-0 flex-col"
        [class]="innerClasses()"
        data-testid="native-card-inner"
      >
        <ng-content select="[card-header]" />
        <ng-content />
        <ng-content select="[card-footer]" />
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class NativeCardComponent {
  /** Semantic colour used by the status spine and the selection ring. */
  readonly tone = input<NativeCardTone>('neutral');

  /** Render the coloured left-edge status spine. */
  readonly spine = input<boolean>(false);

  /** Card responds to click / Enter / Space by emitting {@link activated}. */
  readonly clickable = input<boolean>(false);

  /** Card is a two-state toggle: adds `aria-pressed` and a selection ring. */
  readonly selectable = input<boolean>(false);

  /** Current selection state; only meaningful when `selectable` is true. */
  readonly selected = input<boolean>(false);

  /** Suppresses activation and dims the card. */
  readonly disabled = input<boolean>(false);

  /** Padding scale. @default 'comfortable' */
  readonly density = input<NativeCardDensity>('comfortable');

  /** Accessible name for the activation target. Required when `clickable`. */
  readonly ariaLabel = input<string | null>(null);

  /**
   * Emitted on a genuine card activation — a click on the card surface, or
   * Enter/Space while the card itself has focus. Never emitted for clicks
   * that land on a nested control.
   */
  readonly activated = output<void>();

  /** True when the card is an activation target at all. */
  protected readonly interactive = computed(
    () => this.clickable() || this.selectable(),
  );

  protected readonly spineClass = computed(() => SPINE_CLASS[this.tone()]);

  protected readonly innerClasses = computed(
    () => `${DENSITY_CLASS[this.density()]}${this.spine() ? ' pl-5' : ''}`,
  );

  protected readonly rootClasses = computed(() => {
    const parts = ['bg-base-200/40', 'border-base-300'];

    if (this.disabled()) {
      parts.push('opacity-60');
    } else if (this.interactive()) {
      parts.push(
        'cursor-pointer',
        'hover:bg-base-200/70',
        'hover:border-base-content/20',
        'focus-visible:outline-none',
        'focus-visible:ring-2',
        'focus-visible:ring-primary/60',
      );
    }

    if (this.selectable() && this.selected()) {
      parts.push('ring-2', SELECTED_RING_CLASS[this.tone()]);
    }

    return parts.join(' ');
  });

  protected onClick(event: MouseEvent): void {
    if (!this.interactive() || this.disabled()) return;
    if (this.isNestedInteractive(event)) return;
    this.activated.emit();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!this.interactive() || this.disabled()) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // Only the card surface itself activates — a keypress inside a nested
    // control (a button, a text field) belongs to that control.
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    this.activated.emit();
  }

  /**
   * True when the event originated on a descendant that owns its own click
   * semantics. `closest` is bounded by the card root so the root's own
   * `role="button"` never matches.
   */
  private isNestedInteractive(event: MouseEvent): boolean {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    if (target === event.currentTarget) return false;
    const match = target.closest(NESTED_INTERACTIVE_SELECTOR);
    if (match === null) return false;
    return (
      event.currentTarget instanceof Node && event.currentTarget.contains(match)
    );
  }
}
