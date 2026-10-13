import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { ProviderMarkComponent } from '@ptah-extension/ui';
import { NEAR_LIMIT_PERCENT } from '@ptah-extension/shared';
import { providerAccent } from './provider-accent';
import type {
  OwnerSectionView,
  RowActionView,
  Tone,
} from './provider-account-card.component';

/**
 * One row of the provider list: pure presentation of one `OwnerSectionView`
 * built by `ProviderAccountCardComponent`, which owns the data flow.
 *
 * Every provider uses ONE row grid, so rows line up down the list whatever
 * state each owner is in (plan-limits-live-fix):
 *
 *   identity (fixed 15rem) | body (windows area, 1fr) | actions (2rem)
 *
 * The body is itself a grid with the same column template for every row
 * (1 / 2 / 3 equal columns by the row's own width — the hosting `li` is an
 * inline-size container named `row`, defined in the card's styles). Each
 * plan window is one cell: label | value (tabular, right-aligned) on top,
 * the meter below, then reset lines + source chips. Local token/cost
 * accounting is a cell of the same shape. A state without windows (local
 * usage only, unavailable, sign in, key problem) is one status line spanning
 * the body — glyph chip, reason, optional inline action — never pushed to
 * the far edge and never inside the identity subtitle. Narrow rows stack
 * the body under the identity.
 *
 * Accessibility: progressbar aria attributes, glyph + word on every chip
 * (colour is never the only signal), sr-only value text, the full owner name
 * and subtitle as tooltips on their truncated lines, a focusable refresh
 * control and inline action whose visible label is its accessible name. The
 * decorative per-provider accent (left border + mark tint) never carries
 * identity — the provider name always stays in text.
 */
@Component({
  selector: 'ptah-provider-account-row',
  standalone: true,
  imports: [ProviderMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    // Row-local layout; the container itself (`li.row`) lives in the card's
    // styles. Unknown values draw a hatched neutral track, never a 0% bar.
    `
      :host {
        display: block;
      }
      /* Narrow (stacked): identity + refresh, then the body, then notices.
         Whitespace between areas comes from margins, not row-gap, so an
         absent area (no notices) adds nothing. */
      .owner-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 2rem;
        grid-template-areas:
          'identity actions'
          'body body'
          'below below';
        gap: 0 1rem;
        align-items: start;
        padding: 0.75rem 0.75rem 0.75rem 0.875rem;
        border: 1px solid oklch(var(--bc) / 0.1);
        border-left: 4px solid var(--accent);
        border-radius: 0.5rem;
      }
      .identity {
        grid-area: identity;
        display: flex;
        align-items: center;
        gap: 0.625rem;
        min-width: 0;
      }
      .mark-box {
        flex: none;
        display: grid;
        place-items: center;
        /* The mark's own box is a fixed 32px; a 2.25rem box with a 1px
           border holds it without clipping. */
        width: 2.25rem;
        height: 2.25rem;
        border-radius: 0.5rem;
        background: color-mix(in oklab, var(--accent) 22%, transparent);
        border: 1px solid color-mix(in oklab, var(--accent) 55%, transparent);
      }
      .actions {
        grid-area: actions;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        min-height: 2.25rem;
      }
      /* The windows area: one column template shared by every row. */
      .body {
        grid-area: body;
        min-width: 0;
        margin-top: 0.625rem;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 0.75rem 1.25rem;
        align-items: start;
      }
      .below {
        grid-area: below;
        min-width: 0;
        display: flex;
        flex-direction: column;
        margin-top: 0.5rem;
      }
      /* A non-window state: one aligned line across the whole body. Its
         min-height matches the mark box so a compact row's reason sits on
         the identity's centre line. */
      .status-line {
        grid-column: 1 / -1;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.25rem 0.5rem;
        min-width: 0;
        min-height: 2.25rem;
      }
      /* One window (or the local-usage stat): label | value, then the meter,
         then reset lines + sources. */
      .win {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, max-content);
        grid-template-areas:
          'name value'
          'bar bar'
          'meta meta';
        column-gap: 0.5rem;
        align-items: baseline;
        min-width: 0;
      }
      .win-name {
        grid-area: name;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .win-value {
        grid-area: value;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: right;
      }
      .win-meta {
        grid-area: meta;
        min-width: 0;
      }
      .win-extra {
        grid-column: 1 / -1;
      }
      .bar {
        grid-area: bar;
        position: relative;
        margin: 0.375rem 0 0.25rem;
      }
      .local-value {
        grid-area: bar;
        margin: 0.125rem 0;
      }
      /* Near-limit threshold tick; its left offset is bound in the template
         to NEAR_LIMIT_PERCENT (90). Decorative. */
      .bar-tick {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 1px;
        background: oklch(var(--bc));
        opacity: 0.35;
      }
      /* Unknown usage is a hatched neutral track, never an empty 0% bar. */
      .bar-unknown {
        background: repeating-linear-gradient(
          90deg,
          oklch(var(--bc) / 0.12) 0 6px,
          transparent 6px 10px
        );
      }
      /* Light themes render DaisyUI's success/warning (and retro's error)
         too pale against the row background, so on the light-mode marker
         every fill is re-tinted darker. Dark themes already measure >= 3.5:1
         and keep the plain semantic fill. */
      :host-context([data-theme-mode='light']) .bar-fill.bg-success {
        background-color: color-mix(in oklab, oklch(var(--su)) 60%, black);
      }
      :host-context([data-theme-mode='light']) .bar-fill.bg-warning {
        background-color: color-mix(in oklab, oklch(var(--wa)) 60%, black);
      }
      :host-context([data-theme-mode='light']) .bar-fill.bg-error {
        background-color: color-mix(in oklab, oklch(var(--er)) 75%, black);
      }
      @container row (min-width: 520px) {
        .body {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      /* Wide: identity | body | refresh on one line; notices sit under the
         body column so their left edge lines up with the windows. */
      @container row (min-width: 720px) {
        .owner-row {
          grid-template-columns: 15rem minmax(0, 1fr) 2rem;
          grid-template-areas:
            'identity body actions'
            '. below .';
        }
        .body {
          margin-top: 0;
        }
      }
      @container row (min-width: 900px) {
        .body {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }
    `,
  ],
  template: `
    <section
      class="surface-2 owner-row"
      [class.owner-row--compact]="section().windows.length === 0"
      [style.--accent]="accentFor(section().providerId)"
      [attr.aria-label]="section().label + ' usage'"
      data-testid="provider-account-section"
    >
      <div class="identity" data-testid="section-header">
        <span class="mark-box" aria-hidden="true">
          <ptah-provider-mark [providerId]="section().providerId" />
        </span>
        <div class="min-w-0 flex-1">
          <h5
            class="truncate text-sm font-semibold"
            [title]="section().label"
            data-testid="section-title"
          >
            {{ section().label }}
          </h5>
          <p
            class="mt-0.5 truncate text-[11px] text-base-content-muted"
            [title]="section().subtitle"
            data-testid="section-subtitle"
          >
            {{ section().subtitle }}
          </p>
        </div>
      </div>

      <div class="body" data-testid="section-body">
        @if (section().statusChip || section().statusNotice) {
          <div
            role="status"
            class="status-line text-xs"
            [class]="statusLineClass(statusTone())"
            data-testid="status-line"
          >
            @if (section().statusChip; as status) {
              <span
                class="badge badge-sm h-auto shrink-0 gap-1 whitespace-nowrap py-0.5"
                [class]="statusChipClass(status.tone)"
                [attr.title]="section().statusNotice?.text ?? status.text"
                data-testid="status-chip"
                ><span aria-hidden="true">{{ status.glyph }} </span
                ><span>{{ status.text }} </span></span
              >
            }
            @if (section().statusNotice; as notice) {
              <span class="min-w-0" data-testid="compact-reason">{{
                notice.text
              }}</span>
            }
            @if (section().action; as action) {
              <button
                type="button"
                class="btn btn-ghost btn-xs min-h-6"
                [attr.aria-label]="action.label + ' for ' + section().label"
                (click)="actionClick.emit(action)"
                data-testid="compact-action"
              >
                {{ action.label }}
              </button>
            }
            @if (section().noUsageSource) {
              <span class="sr-only">
                This provider does not report plan usage, so nothing is shown as
                a percentage.
              </span>
            }
          </div>
        }

        @for (row of section().windows; track row.key) {
          <div
            role="group"
            [attr.aria-label]="row.name"
            class="win"
            data-testid="window-row"
          >
            <span
              class="win-name text-[13px] font-semibold"
              [title]="row.name"
              >{{ row.name }}</span
            >
            <span class="sr-only">{{ row.valueText }}</span>
            <span
              class="win-value text-xs font-semibold tabular-nums"
              [title]="row.valueText"
              data-testid="window-value"
              >{{
                row.isPercent && row.percent !== null
                  ? roundPercent(row.percent) + '%'
                  : row.valueText
              }}</span
            >
            @if (row.percent !== null) {
              <div
                class="bar h-1.5 w-full overflow-hidden rounded bg-base-content/10"
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax="100"
                [attr.aria-valuenow]="roundPercent(row.percent)"
                [attr.aria-valuetext]="row.valueText"
                [attr.aria-label]="row.name + ' plan usage'"
                [attr.title]="row.valueText + '. ' + row.resetLines.join(' ')"
                data-testid="window-progress"
              >
                <div
                  class="bar-fill h-full rounded"
                  [class]="barFillClass(row.barTone)"
                  [style.width.%]="clampPercent(row.percent)"
                ></div>
                <span
                  class="bar-tick"
                  aria-hidden="true"
                  [style.left.%]="nearLimitPercent"
                ></span>
              </div>
            } @else {
              <div
                class="bar bar-unknown h-1.5 w-full rounded"
                aria-hidden="true"
                data-testid="window-unknown-bar"
              ></div>
            }
            <div
              class="win-meta flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-base-content-muted break-words"
            >
              @if (row.chip; as chip) {
                <span
                  class="inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5"
                  [class]="chipClass(chip.tone)"
                  data-testid="state-chip"
                  ><span aria-hidden="true">{{ chip.glyph }} </span
                  ><span>{{ chip.text }}</span></span
                >
              }
              @if (row.limitLine) {
                <strong class="text-base-content">{{ row.limitLine }}</strong>
              }
              @for (line of row.resetLines; track $index) {
                <span [class.font-semibold]="line.startsWith('Resets in')">{{
                  line
                }}</span>
              }
              @if (row.note) {
                <span>{{ row.note }}</span>
              }
              @for (source of row.sources; track source.text) {
                <span
                  class="whitespace-nowrap rounded border border-base-content/20 px-1 text-[10px] text-base-content-muted"
                  [class.border-dashed]="source.unofficial"
                  [class.italic]="source.unofficial"
                  [attr.title]="'Source for ' + row.name + ': ' + source.text"
                  data-testid="source-chip"
                  >{{ source.text }}</span
                >
              }
            </div>
            @if (row.estimateNote) {
              <p
                class="win-extra mt-1 text-[11px] text-base-content-muted"
                data-testid="estimate-note"
              >
                {{ row.estimateNote }}
              </p>
            }
          </div>
        }

        @if (section().localUsage; as usage) {
          <div
            role="group"
            [attr.aria-label]="usage.label"
            class="win"
            data-testid="local-usage-stat"
          >
            <span
              class="win-name text-[13px] font-semibold"
              [title]="usage.label"
              >{{ usage.label }}</span
            >
            <span
              class="local-value text-sm font-semibold tabular-nums"
              data-testid="local-usage-value"
              >{{ usage.value }}</span
            >
            <div
              class="win-meta flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-base-content-muted"
            >
              @if (usage.range; as range) {
                <span [attr.title]="range" data-testid="local-usage-range"
                  >Range: {{ usage.rangeLabel ?? range }}</span
                >
              }
              <span data-testid="local-usage-note">{{ usage.note }}</span>
            </div>
          </div>
        }
      </div>

      <div class="actions">
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square"
          [disabled]="refreshing()"
          [attr.aria-label]="'Refresh ' + section().label + ' usage'"
          (click)="refresh.emit()"
          title="Refresh usage"
        >
          <span aria-hidden="true">↻</span>
        </button>
      </div>

      @if (
        section().evidence.length > 0 ||
        section().cooldown ||
        section().activity
      ) {
        <div class="below">
          @for (notice of section().evidence; track $index) {
            <p
              role="status"
              class="text-xs mt-2 border-l-2 pl-2 flex flex-wrap items-center gap-x-1.5"
              [class]="noticeBorder(notice.tone)"
              data-testid="owner-evidence"
            >
              <span>{{ notice.text }}</span>
              @for (source of notice.sources; track source.text) {
                <span
                  class="text-[10px] px-1 rounded border border-base-content/20 text-base-content-muted"
                  [class.border-dashed]="source.unofficial"
                  [class.italic]="source.unofficial"
                  >{{ source.text }}</span
                >
              }
            </p>
          }
          @if (section().cooldown; as cooldown) {
            <p
              role="status"
              class="text-xs mt-2 border-l-2 border-info pl-2 flex flex-wrap items-center gap-x-1.5"
              data-testid="cooldown"
            >
              <span
                class="text-[11px] px-1.5 rounded border border-info bg-info/15"
                >Cooldown</span
              >
              <span>{{ cooldown }}</span>
            </p>
          }
          @if (section().activity; as activity) {
            <div class="mt-2" aria-label="Account activity">
              <p class="text-xs font-medium">Activity</p>
              <p class="text-xs">
                Lifetime tokens: {{ activity.lifetimeTokens ?? 'Unavailable' }}
              </p>
              <p class="text-[10px] text-base-content-muted">
                Activity is not remaining messages, credits, or billing.
              </p>
            </div>
          }
        </div>
      }
    </section>
  `,
})
export class ProviderAccountRowComponent {
  /** The owner section this row presents. */
  readonly section = input.required<OwnerSectionView>();
  /** True while a refresh is in flight; disables the row's refresh button. */
  readonly refreshing = input(false);
  /** Emits when the row's refresh button is pressed. */
  readonly refresh = output<void>();
  /** Emits when a status-line inline action is pressed. */
  readonly actionClick = output<RowActionView>();

  /** Where the near-limit tick sits on every bar (NEAR_LIMIT_PERCENT). */
  protected readonly nearLimitPercent = NEAR_LIMIT_PERCENT;

  protected roundPercent(percent: number): number {
    return Math.round(percent);
  }

  protected clampPercent(percent: number): number {
    return Math.max(0, Math.min(100, percent));
  }

  /** Decorative accent (left border + mark tint) for a provider id. */
  protected accentFor(providerId: string): string {
    return providerAccent(providerId);
  }

  /** The status line's tone: the notice's when there is one, else the chip's. */
  protected statusTone(): Tone {
    const section = this.section();
    return section.statusNotice?.tone ?? section.statusChip?.tone ?? 'neutral';
  }

  /**
   * Every status badge keeps a visible outline: a ghost badge with no border
   * read as plain bold text in the dark theme.
   */
  protected statusChipClass(tone: Tone): string {
    if (tone === 'error') return 'badge-error badge-outline';
    if (tone === 'warning') return 'badge-warning badge-outline';
    return 'badge-ghost badge-outline';
  }

  /**
   * The window bar's fill class. Neutral (aged / estimate-only /
   * not-confirmed) is the muted 45% tier, which still holds >= 3:1 against
   * every row background.
   */
  protected barFillClass(tone: Tone): string {
    switch (tone) {
      case 'error':
        return 'bg-error';
      case 'warning':
        return 'bg-warning';
      case 'success':
        return 'bg-success';
      default:
        return 'bg-base-content/45';
    }
  }

  /** Semantic colour only as border and tint, never as text. */
  protected chipClass(tone: Tone): string {
    switch (tone) {
      case 'error':
        return 'border-error bg-error/15 font-semibold';
      case 'warning':
        return 'border-warning bg-warning/15 font-semibold';
      case 'info':
        return 'border-info bg-info/15';
      default:
        return 'border-dashed border-base-content/20';
    }
  }

  protected noticeBorder(tone: Tone): string {
    switch (tone) {
      case 'error':
        return 'border-error';
      case 'warning':
        return 'border-warning';
      case 'info':
        return 'border-info';
      default:
        return 'border-base-content/40';
    }
  }

  /**
   * A neutral status line is muted text; a warning or error one keeps a
   * bordered box, so a stale owner still reads as a warning.
   */
  protected statusLineClass(tone: Tone): string {
    return tone === 'warning' || tone === 'error'
      ? `rounded border px-2 py-1 ${this.noticeBorder(tone)}`
      : 'text-base-content-muted';
  }
}
