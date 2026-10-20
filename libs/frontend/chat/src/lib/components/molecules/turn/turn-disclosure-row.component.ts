import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { ChevronRight, LucideAngularModule } from 'lucide-angular';

/** Separator between the verb and the ticking timer of a live label. */
const LIVE_TIMER_SEPARATOR = ' · ';

/**
 * The turn's disclosure row (design-spec §3.2): the button that opens and
 * closes the work log.
 *
 * Shows the turn label (`Worked for 4m 12s`, `Worked`, `Working · 1m 05s`,
 * `Working`, from `turnElapsedLabel`), a chevron, an optional compact-mode
 * peek of the newest log row and the count meta (`6 tools · 3 files`).
 *
 * Accessible name: the static label plus the count meta
 * (`Worked for 4m 12s, 6 tools, 3 files`). While live, the ticking timer and
 * the peek are `aria-hidden`, so the name stays `Working, …` and nothing is
 * announced each second.
 *
 * Presentational only: the host owns the open flag and the label.
 */
@Component({
  selector: 'ptah-turn-disclosure-row',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  styles: [
    `
      .turn-disclosure-chevron {
        transition: transform 200ms
          var(--ptah-ease-soft, cubic-bezier(0.22, 0.61, 0.36, 1));
      }
      @media (prefers-reduced-motion: reduce) {
        .turn-disclosure-chevron {
          transition: none;
        }
      }
    `,
  ],
  template: `
    <button
      type="button"
      [class]="
        'flex w-full min-w-0 items-center gap-1 rounded-t border-b border-surface-border px-0.5 text-[13px] text-base-content-muted hover:text-base-content ' +
        (viewMode() === 'compact' ? 'h-7' : 'h-[30px]')
      "
      data-test="turn-disclosure-row"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="controlsId()"
      [attr.aria-label]="accessibleName()"
      (click)="toggled.emit(!open())"
    >
      @if (live()) {
        <span
          class="turn-disclosure-dot mr-1 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-state-run motion-reduce:animate-none"
          aria-hidden="true"
          data-test="turn-disclosure-dot"
        ></span>
      }
      <span class="shrink-0">{{ labelParts().head }}</span>
      @if (labelParts().timer; as timer) {
        <span class="shrink-0 tabular-nums" aria-hidden="true">{{
          separator + timer
        }}</span>
      }
      <lucide-angular
        [img]="ChevronRightIcon"
        class="turn-disclosure-chevron h-4 w-4 shrink-0"
        [class.rotate-90]="open()"
        aria-hidden="true"
      />
      @if (peek(); as peekText) {
        <span
          class="min-w-0 flex-1 truncate text-[12px] text-base-content-muted"
          aria-hidden="true"
          data-test="turn-disclosure-peek"
          >{{ peekText }}</span
        >
      }
      @if (metaParts().length > 0) {
        <span
          class="ml-auto shrink-0 pl-2 text-[11px] tabular-nums text-base-content-muted"
          [class.!text-warning]="metaTone() === 'warning'"
          aria-hidden="true"
          data-test="turn-disclosure-meta"
          >{{ metaParts().join(separator) }}</span
        >
      }
    </button>
  `,
})
export class TurnDisclosureRowComponent {
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly separator = LIVE_TIMER_SEPARATOR;

  /** Whether the work log is open (`aria-expanded`, chevron rotation). */
  readonly open = input(false);

  /** The turn label from `turnElapsedLabel(...).text`. */
  readonly label = input.required<string>();

  /** True while the turn is live: pulse dot, `aria-hidden` timer. */
  readonly live = input(false);

  /** Tool calls of the turn; omitted from the meta when 0. */
  readonly toolCount = input(0);

  /** Files changed by the turn; omitted from the meta when 0. */
  readonly filesChanged = input(0);

  /** Additional stable metadata after tool and file counts. */
  readonly extraMeta = input<readonly string[]>([]);

  /** Accent for a guard stop reason. */
  readonly metaTone = input<'muted' | 'warning'>('muted');

  /** Compact-mode peek of the newest log row; `null` hides it. */
  readonly peek = input<string | null>(null);

  /** Id of the work log this row controls (`aria-controls`). */
  readonly controlsId = input.required<string>();

  /** Density: `compact` is 28 px tall (design-spec §3.8). */
  readonly viewMode = input<'full' | 'compact'>('full');

  /** Emits the requested open state when the row is activated. */
  readonly toggled = output<boolean>();

  /** The label split into its static head and, while live, its timer. */
  protected readonly labelParts = computed(() => {
    const text = this.label();
    const at = this.live() ? text.indexOf(LIVE_TIMER_SEPARATOR) : -1;
    if (at < 0) return { head: text, timer: null };
    return {
      head: text.slice(0, at),
      timer: text.slice(at + LIVE_TIMER_SEPARATOR.length) || null,
    };
  });

  protected readonly metaParts = computed(() => {
    const parts: string[] = [];
    const tools = this.toolCount();
    const files = this.filesChanged();
    if (tools > 0) parts.push(`${tools} ${tools === 1 ? 'tool' : 'tools'}`);
    if (files > 0) parts.push(`${files} ${files === 1 ? 'file' : 'files'}`);
    parts.push(...this.extraMeta().filter(Boolean));
    return parts;
  });

  protected readonly accessibleName = computed(() =>
    [this.labelParts().head, ...this.metaParts()].join(', '),
  );
}
