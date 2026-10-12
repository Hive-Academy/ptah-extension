import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { ProviderMarkComponent } from '@ptah-extension/ui';
import { NEAR_LIMIT_PERCENT } from '@ptah-extension/shared';
import { providerAccent } from './provider-accent';
import type { OwnerSectionView, Tone } from './provider-account-card.component';

/**
 * One row of the provider list (TASK_2026_631): pure presentation of one
 * `OwnerSectionView` built by `ProviderAccountCardComponent`, which owns the
 * data flow. The row lays itself out by the width it itself has — the hosting
 * `li` is an inline-size container named `row` (the card's styles define it):
 * wide rows place identity | windows | local usage | refresh on one line;
 * medium and narrow rows drop the windows and the local-usage stat below the
 * identity, so the owner name is never squeezed beside them. A row without
 * windows is a compact one-line reason; a warning or error notice keeps the
 * bordered box it had before the redesign.
 *
 * Every datum, `data-testid` and accessibility semantic is the card's: the
 * progressbar aria attributes, the state chip's glyph + word (colour is never
 * the only signal), source chips, the sr-only value text, the focusable
 * refresh control. The decorative per-provider accent (left border + mark
 * tint) never carries identity — the provider name always stays in text.
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
      /* Stacked default (narrow): header, windows/reason, local, footnotes. */
      .owner-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas:
          "identity actions"
          "mid mid"
          "local local"
          "below below";
        /* Row whitespace comes from margins on the children, not row-gap,
           so an absent area (no local usage, no footnotes) adds nothing. */
        gap: 0 0.75rem;
        align-items: start;
        padding: 0.75rem 0.75rem 0.75rem 0.875rem;
        border: 1px solid oklch(var(--bc) / 0.1);
        border-left: 4px solid var(--accent);
        border-radius: 0.5rem;
      }
      .owner-row--compact {
        padding-block: 0.5rem;
      }
      .identity {
        grid-area: identity;
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
      }
      .identity h5 {
        overflow-wrap: anywhere;
      }
      .mark-box {
        flex: none;
        display: grid;
        place-items: center;
        /* 36px box: the mark's own box is a fixed 32px, so a 2rem box with a
           1px border clipped it by ~1px per side (revise-1). */
        width: 2.25rem;
        height: 2.25rem;
        border-radius: 0.5rem;
        background: color-mix(in oklab, var(--accent) 22%, transparent);
        border: 1px solid color-mix(in oklab, var(--accent) 55%, transparent);
      }
      .mid {
        grid-area: mid;
        min-width: 0;
        margin-top: 0.5rem;
      }
      .local {
        grid-area: local;
        min-width: 0;
        text-align: left;
        margin-top: 0.5rem;
      }
      .actions {
        grid-area: actions;
        display: flex;
        align-items: center;
        justify-content: flex-end;
      }
      .below {
        grid-area: below;
        min-width: 0;
        display: flex;
        flex-direction: column;
        margin-top: 0.5rem;
      }
      .wins {
        display: flex;
        flex-wrap: wrap;
        flex-direction: column;
        gap: 0.625rem;
      }
      .win {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .win-top {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: baseline;
        gap: 0.25rem 0.5rem;
      }
      .bar {
        position: relative;
        margin: 0.375rem 0 0.25rem;
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
      /* Medium rows (641-1100px): windows flow horizontally, local usage
         moves to its own line, right-aligned under the refresh control. */
      @container row (min-width: 641px) {
        .wins {
          flex-direction: row;
          gap: 0.625rem 1rem;
        }
        .win {
          flex: 1 1 11.5rem;
          min-width: 10.5rem;
          max-width: 22rem;
        }
        .local {
          text-align: right;
        }
      }
      /* Wide rows (>1100px): identity | windows | local usage | refresh on
         one line, so the stacked-row margins come off mid and local. */
      @container row (min-width: 1101px) {
        .owner-row {
          grid-template-columns: minmax(14rem, 19rem) minmax(0, 1fr) max-content max-content;
          grid-template-areas:
            "identity mid local actions"
            "below below below below";
          align-items: center;
        }
        .mid,
        .local {
          margin-top: 0;
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
      <div class="identity min-w-0" data-testid="section-header">
        <span class="mark-box" aria-hidden="true">
          <ptah-provider-mark [providerId]="section().providerId" />
        </span>
        <div class="min-w-0">
          <h5 class="font-semibold text-sm break-words">
            {{ section().label }}
          </h5>
          <div class="mt-0.5 flex min-w-0 flex-wrap items-center gap-1">
            <span
              class="text-[10px] text-base-content-muted break-words"
              [title]="section().subtitle"
              >{{ section().subtitle }}</span
            >
            @if (section().commonSources.length > 0) {
              <span class="flex flex-wrap gap-1" aria-label="Usage source">
                @for (source of section().commonSources; track source.text) {
                  <span
                    class="text-[10px] px-1 rounded border border-base-content/20 text-base-content-muted"
                    [class.border-dashed]="source.unofficial"
                    [class.italic]="source.unofficial"
                    data-testid="source-chip"
                    >{{ source.text }}</span
                  >
                }
              </span>
            }
            @if (section().statusChip; as status) {
              <span
                class="badge badge-sm whitespace-normal h-auto text-left"
                [class]="statusChipClass(status.tone)"
                [attr.title]="section().statusNotice?.text ?? status.text"
                data-testid="status-chip"
                >{{ status.text }}</span
              >
            }
          </div>
        </div>
      </div>
      @if (section().windows.length > 0) {
        <div class="mid">
          <div class="wins">
            @for (row of section().windows; track row.key) {
              <div
                role="group"
                [attr.aria-label]="row.name"
                class="win"
                data-testid="window-row"
              >
                <div class="win-top">
                  <span class="min-w-0">
                    <span class="text-[13px] font-semibold">{{
                      row.name
                    }}</span>
                    @if (row.chip; as chip) {
                      <span
                        class="text-[11px] px-1.5 rounded border whitespace-nowrap"
                        [class]="chipClass(chip.tone)"
                        data-testid="state-chip"
                        ><span aria-hidden="true">{{ chip.glyph }} </span
                        >{{ chip.text }}</span
                      >
                    }
                  </span>
                  <span class="sr-only">{{ row.valueText }}</span>
                  <span
                    class="text-xs font-semibold tabular-nums break-words"
                    [class.whitespace-nowrap]="row.isPercent"
                    data-testid="window-value"
                    >{{
                      row.isPercent && row.percent !== null
                        ? roundPercent(row.percent) + '%'
                        : row.valueText
                    }}</span
                  >
                </div>
                @if (row.percent !== null) {
                  <div
                    class="bar h-1.5 w-full overflow-hidden rounded bg-base-content/10"
                    role="progressbar"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    [attr.aria-valuenow]="roundPercent(row.percent)"
                    [attr.aria-valuetext]="row.valueText"
                    [attr.aria-label]="row.name + ' plan usage'"
                    [attr.title]="
                      row.valueText + '. ' + row.resetLines.join(' ')
                    "
                    data-testid="window-progress"
                  >
                    <div
                      class="h-full rounded"
                      [class.bg-error]="row.barTone === 'error'"
                      [class.bg-warning]="row.barTone === 'warning'"
                      [class.bg-success]="row.barTone === 'success'"
                      [class.bg-base-content]="row.barTone === 'neutral'"
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
                  class="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[11px] text-base-content-muted break-words"
                >
                  @if (row.limitLine) {
                    <strong class="text-base-content">{{
                      row.limitLine
                    }}</strong>
                  }
                  @for (line of row.resetLines; track $index) {
                    <span
                      [class.font-semibold]="line.startsWith('Resets in')"
                      >{{ line }}</span
                    >
                  }
                  @if (row.note) {
                    <span>{{ row.note }}</span>
                  }
                  @if (section().commonSources.length === 0) {
                    @for (source of row.sources; track source.text) {
                      <span
                        class="text-[10px] px-1 rounded border border-base-content/20 text-base-content-muted"
                        [class.border-dashed]="source.unofficial"
                        [class.italic]="source.unofficial"
                        [attr.title]="
                          'Source for ' + row.name + ': ' + source.text
                        "
                        data-testid="source-chip"
                        >{{ source.text }}</span
                      >
                    }
                  }
                </div>
                @if (row.estimateNote) {
                  <p
                    class="text-[11px] text-base-content-muted mt-1"
                    data-testid="estimate-note"
                  >
                    {{ row.estimateNote }}
                  </p>
                }
              </div>
            }
          </div>
        </div>
      } @else {
        @if (section().statusNotice; as notice) {
          <p
            role="status"
            class="mid text-xs"
            [class]="compactReasonClass(notice.tone)"
            data-testid="compact-reason"
          >
            {{ notice.text }}
          </p>
        }
      }
      @if (section().localUsage; as usage) {
        <div class="local" data-testid="local-usage-stat">
          <p
            class="text-[10px] uppercase tracking-wider text-base-content-muted"
          >
            {{ usage.label }}
          </p>
          <p class="text-sm font-semibold tabular-nums">
            {{ usage.value }}
          </p>
          @if (usage.range) {
            <p class="text-[11px] text-base-content-muted">
              Range: {{ usage.range }}
            </p>
          }
          <p class="text-[11px] text-base-content-muted">
            Local CLI accounting · not a plan percentage or reset
          </p>
        </div>
      }
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
        section().noUsageSource ||
        section().evidence.length > 0 ||
        section().cooldown ||
        section().activity ||
        (section().windows.length > 0 && section().statusNotice)
      ) {
        <div class="below">
          @if (section().noUsageSource) {
            <p class="sr-only">
              <strong>No usage source</strong>
              <span class="text-base-content-muted">
                · This provider does not report plan usage, so nothing is shown
                as a percentage.</span
              >
            </p>
          }
          @if (section().windows.length > 0) {
            @if (section().statusNotice; as notice) {
              <p
                role="status"
                class="rounded border px-2 py-1 text-xs"
                [class]="noticeBorder(notice.tone)"
              >
                {{ notice.text }}
              </p>
            }
          }
          @for (notice of section().evidence; track $index) {
            <p
              role="status"
              class="text-xs mt-2.5 border-l-2 pl-2 flex flex-wrap items-center gap-x-1.5"
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
              class="text-xs mt-2.5 border-l-2 border-info pl-2 flex flex-wrap items-center gap-x-1.5"
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

  protected statusChipClass(tone: Tone): string {
    return tone === 'error'
      ? 'badge-error'
      : tone === 'warning'
        ? 'badge-warning'
        : 'badge-ghost';
  }

  /** Semantic colour only as border and tint, never as text (design §8). */
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
   * Compact rows keep the one-line muted reason for neutral notices, but a
   * warning or error notice keeps the bordered box it had before the
   * redesign — a stale owner must still read as a warning (revise-1 M2).
   */
  protected compactReasonClass(tone: Tone): string {
    return tone === 'warning' || tone === 'error'
      ? `rounded border px-2 py-1 ${this.noticeBorder(tone)}`
      : 'text-base-content-muted';
  }
}
