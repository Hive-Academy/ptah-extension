import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type {
  CompactSemanticMark,
  CompactSemanticMarkKind,
  CompactSessionSummary,
  CompactSummaryStatusTone,
} from './compact-session-summary';
import { CompactSessionStatsComponent } from './compact-session-stats.component';

/**
 * Height tier the card is rendered at. Owned here (not `canvas`'s
 * `TileHeightTier`) because this presentational lib must not depend on
 * canvas — the smart wrapper in `@ptah-extension/chat` derives this from the
 * tab's `TabViewMode` and passes it down.
 */
export type CompactActivityTier = 'compact' | 'compact-tall';

/** Feed row budget per tier (batches-2.md: ~5 at compact, ~10 at compact-tall). */
const ROW_BUDGET: Record<CompactActivityTier, number> = {
  compact: 5,
  'compact-tall': 10,
};

const KIND_LABEL: Record<CompactSemanticMarkKind, string> = {
  tool: 'TOOL',
  agent: 'AGENT',
  prose: 'PROSE',
  prompt: 'ASK',
  compaction: 'COMP',
  terminal: 'TERM',
};

/**
 * Tone is dual-coded: every badge pairs this glyph with a colour class so
 * tone reads correctly without colour vision (batches-2.md constraint).
 */
const TONE_GLYPH: Record<CompactSummaryStatusTone, string> = {
  idle: '○',
  live: '▶',
  success: '✓',
  warning: '▲',
  error: '✖',
};

/**
 * Bounded, summary-only compact session body: a fixed-width assistant recap
 * pane on the left, a chronological teletype activity feed on the right.
 * Below ~720px (measured on the pane track, via container query — not the
 * viewport) the panes stack instead of crushing.
 */
@Component({
  selector: 'ptah-compact-session-activity',
  standalone: true,
  imports: [CompactSessionStatsComponent],
  host: {
    class: 'block h-full min-h-0 overflow-hidden',
  },
  styles: [
    `
      .cs-body-host {
        container-type: inline-size;
      }
      .cs-body {
        display: grid;
        grid-template-columns: 320px 1fr;
        min-height: 0;
      }
      .cs-recap-pane {
        border-right: 1px solid oklch(var(--bc) / 0.1);
      }
      @container (max-width: 720px) {
        .cs-body {
          grid-template-columns: 1fr;
          grid-template-rows: auto minmax(0, 1fr);
          overflow-y: auto;
        }
        .cs-recap-pane {
          border-right: 0;
          border-bottom: 1px solid oklch(var(--bc) / 0.1);
        }
      }
    `,
  ],
  template: `
    <section
      class="grid h-full min-h-0 grid-rows-[auto_1fr_auto] overflow-hidden"
      aria-label="Compact session status"
      data-testid="compact-session-summary"
    >
      <div
        class="flex min-w-0 items-center gap-2 border-b border-base-content/10 px-3 py-2"
        data-zone="status"
      >
        <span
          class="h-2.5 w-2.5 shrink-0 rounded-full"
          [style.background-color]="summary().status.sessionColor"
          aria-hidden="true"
        ></span>
        <span class="shrink-0" aria-hidden="true">{{
          summary().status.icon
        }}</span>
        <span class="truncate text-xs font-semibold">{{
          summary().status.text
        }}</span>
        <span class="ml-auto truncate text-[10px] text-base-content-muted">
          {{ summary().status.workspaceLabel }}
        </span>
      </div>

      <div class="cs-body-host min-h-0 overflow-hidden">
        <div class="cs-body h-full min-h-0">
          <div
            class="cs-recap-pane flex min-h-0 min-w-0 flex-col justify-between gap-2 overflow-hidden bg-base-200/20 p-3"
            data-zone="recap"
          >
            <div class="min-h-0 overflow-hidden">
              <div
                class="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wide text-base-content-muted"
              >
                <span>Assistant recap</span>
                <span
                  class="shrink-0 rounded border px-1 py-px text-[9px] font-bold uppercase"
                  [class.border-primary/30]="summary().status.tone === 'live'"
                  [class.text-primary]="summary().status.tone === 'live'"
                  [class.border-success/30]="
                    summary().status.tone === 'success'
                  "
                  [class.text-success]="summary().status.tone === 'success'"
                  [class.border-warning/30]="
                    summary().status.tone === 'warning'
                  "
                  [class.text-warning]="summary().status.tone === 'warning'"
                  [class.border-error/30]="summary().status.tone === 'error'"
                  [class.text-error]="summary().status.tone === 'error'"
                  [class.border-base-content/20]="
                    summary().status.tone === 'idle'
                  "
                  [class.text-base-content-muted]="
                    summary().status.tone === 'idle'
                  "
                >
                  {{ summary().status.text }}
                </span>
              </div>
              <p
                class="mt-2 whitespace-pre-line text-xs leading-relaxed"
                [class.line-clamp-2]="tier() === 'compact'"
                [class.line-clamp-5]="tier() === 'compact-tall'"
                [class.text-error]="summary().content.kind === 'error'"
                [class.text-base-content]="summary().content.kind !== 'error'"
              >
                {{ summary().content.text }}
                @if (summary().content.additionalPromptCount > 0) {
                  <span class="font-semibold text-warning">
                    +{{ summary().content.additionalPromptCount }} more
                  </span>
                }
              </p>
            </div>

            <div class="flex shrink-0 flex-col gap-2">
              @if (latestAgentMark(); as agent) {
                <div
                  class="truncate rounded border border-base-content/10 bg-base-300/10 px-2 py-1 font-mono text-[10px] text-base-content-muted"
                  [title]="agent.label"
                >
                  {{ agent.label }}
                </div>
              }
              @if (summary().content.actionable) {
                <button
                  type="button"
                  class="btn btn-primary btn-xs w-full"
                  (click)="openFullView.emit()"
                >
                  Open full view
                </button>
              }
            </div>
          </div>

          <div
            class="flex min-h-0 min-w-0 flex-col overflow-hidden"
            data-zone="feed"
          >
            <div
              class="flex shrink-0 items-center justify-between border-b border-base-content/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-base-content-muted"
            >
              <span>Teletype wire stream</span>
              <span
                >{{ feedRows().length }} of
                {{ summary().marks.length }}</span
              >
            </div>
            <ul
              class="min-h-0 flex-1 overflow-y-auto"
              role="list"
              aria-label="Session activity feed"
            >
              @for (mark of feedRows(); track mark.id) {
                <li
                  class="flex flex-col gap-0.5 border-l-2 border-transparent px-2 py-1"
                  [class.border-error]="mark.tone === 'error'"
                  [class.bg-error/5]="mark.tone === 'error'"
                  role="listitem"
                >
                  <div
                    class="flex items-center gap-2 font-mono text-[11px] leading-snug"
                  >
                    <span
                      class="shrink-0 text-[10px] tabular-nums text-base-content-muted"
                    >
                      {{ formatWireTime(mark.timestamp) }}
                    </span>
                    <span
                      class="inline-flex shrink-0 items-center gap-1 rounded border px-1 text-[9px] font-bold"
                      [class.border-primary/30]="mark.tone === 'live'"
                      [class.text-primary]="mark.tone === 'live'"
                      [class.border-success/30]="mark.tone === 'success'"
                      [class.text-success]="mark.tone === 'success'"
                      [class.border-warning/30]="mark.tone === 'warning'"
                      [class.text-warning]="mark.tone === 'warning'"
                      [class.border-error/30]="mark.tone === 'error'"
                      [class.text-error]="mark.tone === 'error'"
                      [class.border-base-content/20]="mark.tone === 'idle'"
                      [class.text-base-content-muted]="mark.tone === 'idle'"
                    >
                      <span aria-hidden="true">{{
                        toneGlyph(mark.tone)
                      }}</span>
                      {{ kindLabel(mark.kind) }}
                    </span>
                    <span class="min-w-0 flex-1 truncate">{{
                      mark.label
                    }}</span>
                  </div>
                  @if (mark.text; as text) {
                    <span
                      class="truncate pl-12 text-[10px] text-base-content-muted"
                      [title]="text"
                    >
                      {{ singleLine(text) }}
                    </span>
                  }
                </li>
              }
            </ul>
          </div>
        </div>
      </div>

      <ptah-compact-session-stats
        data-zone="metrics"
        [metrics]="summary().metrics"
      />
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactSessionActivityComponent {
  readonly summary = input.required<CompactSessionSummary>();
  /**
   * Drives both the feed row budget and the recap line clamp, and the clamp is
   * load-bearing rather than cosmetic. At the compact tier the recap pane has
   * roughly 148px of content box once the status and metrics rows are
   * subtracted; a 4-line clamp plus the agent chip plus the action button
   * overruns it. The actions block is `shrink-0`, so the overrun does not hide
   * the button — it truncates the recap mid-line with no ellipsis, which reads
   * as a rendering fault rather than as elision. Clamping to the height the
   * tier actually has keeps the ellipsis honest.
   */
  readonly tier = input.required<CompactActivityTier>();
  readonly openFullView = output<void>();

  /**
   * The visible feed slice, bounded by the tier's row budget. `marks` is
   * already chronological (oldest first), so slicing from the end keeps the
   * newest entries and preserves order — newest row last, per the mock.
   */
  readonly feedRows = computed<readonly CompactSemanticMark[]>(() => {
    const rowBudget = ROW_BUDGET[this.tier()];
    return this.summary().marks.slice(-rowBudget);
  });

  /** Newest agent-kind mark, read from the full mark set (not the row-budget slice). */
  readonly latestAgentMark = computed<CompactSemanticMark | null>(() => {
    const marks = this.summary().marks;
    for (let index = marks.length - 1; index >= 0; index -= 1) {
      if (marks[index].kind === 'agent') return marks[index];
    }
    return null;
  });

  protected kindLabel(kind: CompactSemanticMarkKind): string {
    return KIND_LABEL[kind];
  }

  protected toneGlyph(tone: CompactSummaryStatusTone): string {
    return TONE_GLYPH[tone];
  }

  protected formatWireTime(timestamp: number): string {
    const date = new Date(timestamp);
    const pad = (value: number) => value.toString().padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  /** Collapses whitespace/newlines; the `truncate` class does the single-line clamp. */
  protected singleLine(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }
}
