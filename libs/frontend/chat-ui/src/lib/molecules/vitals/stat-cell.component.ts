import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { LucideAngularModule, type LucideIconData } from 'lucide-angular';

import { StatRowComponent } from './stat-row.component';

export type StatCellState = 'loading' | 'ready' | 'empty' | 'error';

/** Screen-reader word for the "—" placeholder; the caption says why. */
const PLACEHOLDER_WORD: Record<'empty' | 'error', string> = {
  empty: 'none',
  error: 'unavailable',
};

let nextCaptionId = 0;

/**
 * StatCellComponent — one column of a `ptah-stat-row`.
 *
 * In a row it is its own grid of three fixed rows, `16px <value-h> auto`
 * (label, value, caption), so every column of the row lines up without
 * subgrid: the label row holds the icon and the uppercase label, the value
 * row (exactly `--ptah-stat-value-h` tall) holds the projected value — a
 * `ptah-stat-value`, a ring, or a `ptah-stat-value` with a chart — and the
 * caption row holds one muted line.
 *
 * In a `layout='stack'` row it renders the value and then the label as its
 * caption line (no label row, no icon), as the screen-02 numerals do.
 *
 * `loading` shows a shimmer in the value row; `empty` and `error` show "—"
 * plus the caption, sized from the row's `--ptah-stat-num-size`. The cell is
 * a `role="group"` named by `label`, with the caption as its description,
 * and `aria-busy` while loading.
 *
 * Ancestor requirement: place cells inside a `ptah-stat-row`. The row is
 * injected optionally; without one the cell falls back to the row layout
 * with the default 56 px value height.
 */
@Component({
  selector: 'ptah-stat-cell',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'group',
    '[attr.aria-label]': 'label()',
    '[attr.aria-describedby]': 'describedBy()',
    '[attr.data-state]': 'state()',
    '[attr.data-stacked]': "stacked() ? '' : null",
    '[attr.aria-busy]': "state() === 'loading' ? 'true' : null",
  },
  template: `
    @if (!stacked()) {
      <div
        class="ptah-stat-cell__label text-base-content-muted"
        aria-hidden="true"
      >
        @if (icon(); as glyph) {
          <lucide-angular [img]="glyph" [size]="15" class="shrink-0" />
        }
        <span class="truncate">{{ label() }}</span>
      </div>
    }
    <div class="ptah-stat-cell__value">
      <span class="ptah-stat-cell__projected" [hidden]="state() !== 'ready'">
        <ng-content />
      </span>
      @switch (state()) {
        @case ('loading') {
          <span class="ptah-stat-cell__shimmer" aria-hidden="true"></span>
          <span class="sr-only">Loading</span>
        }
        @case ('empty') {
          <span class="ptah-stat-cell__dash" aria-hidden="true">—</span>
          <span class="sr-only">{{ placeholderWord.empty }}</span>
        }
        @case ('error') {
          <span class="ptah-stat-cell__dash" aria-hidden="true">—</span>
          <span class="sr-only">{{ placeholderWord.error }}</span>
        }
      }
    </div>
    @if (captionText(); as text) {
      <div
        class="ptah-stat-cell__caption text-base-content-muted"
        [id]="captionId"
        [attr.aria-hidden]="stacked() ? 'true' : null"
      >
        {{ text }}
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: grid;
        grid-template-rows: 16px var(--ptah-stat-value-h, 56px) auto;
        row-gap: 6px;
        min-width: 0;
        text-align: left;
      }
      /* Stack: one row of the parent's two columns (subgrid), the value
         right-aligned in the first and the label-caption in the second, both
         on one baseline; the row's space-between spaces the cells apart. */
      :host([data-stacked]) {
        grid-column: 1 / -1;
        grid-template-columns: subgrid;
        grid-template-rows: auto;
        align-items: baseline;
        row-gap: 0;
      }
      .ptah-stat-cell__label {
        display: flex;
        align-items: center;
        gap: 7px;
        height: 16px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        white-space: nowrap;
        min-width: 0;
      }
      .ptah-stat-cell__value {
        height: var(--ptah-stat-value-h, 56px);
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }
      :host([data-stacked]) .ptah-stat-cell__value {
        height: auto;
        justify-content: flex-end;
      }
      .ptah-stat-cell__projected {
        display: contents;
      }
      .ptah-stat-cell__projected[hidden] {
        display: none;
      }
      .ptah-stat-cell__caption {
        font-size: 12.5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }
      .ptah-stat-cell__dash {
        font-size: var(--ptah-stat-num-size, 34px);
        line-height: 1;
        font-weight: 600;
        color: oklch(var(--bc) / 0.5);
      }
      .ptah-stat-cell__shimmer {
        display: block;
        width: calc(var(--ptah-stat-num-size, 34px) * 2.8);
        height: calc(var(--ptah-stat-num-size, 34px) * 0.82);
        border-radius: 8px;
        background: oklch(var(--bc) / 0.1);
      }
      @media (max-width: 1000px) {
        .ptah-stat-cell__caption {
          white-space: normal;
          overflow: visible;
          line-height: 1.3;
        }
      }
      @media (prefers-reduced-motion: no-preference) {
        .ptah-stat-cell__shimmer {
          animation: ptah-stat-shimmer 1.6s ease-in-out infinite;
        }
      }
      @keyframes ptah-stat-shimmer {
        50% {
          opacity: 0.45;
        }
      }
    `,
  ],
})
export class StatCellComponent {
  private readonly row = inject(StatRowComponent, { optional: true });

  readonly icon = input<LucideIconData | null>(null);
  readonly label = input.required<string>();
  readonly state = input<StatCellState>('ready');
  readonly caption = input<string | null>(null);

  protected readonly captionId = `ptah-stat-cell-caption-${nextCaptionId++}`;
  protected readonly placeholderWord = PLACEHOLDER_WORD;

  protected readonly stacked = computed(() => this.row?.layout() === 'stack');

  /** Stack: the label is the caption line. Row: the caption input. */
  protected readonly captionText = computed(() =>
    this.stacked() ? this.label() : this.caption(),
  );

  /** Stack: the label already names the group, so no description. */
  protected readonly describedBy = computed(() =>
    !this.stacked() && this.caption() ? this.captionId : null,
  );
}
