import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type MemoryTag = 'Decision' | 'Bugfix' | 'Discovery';

export interface MemoryRow {
  readonly tag: MemoryTag;
  readonly text: string;
}

/**
 * MemoryTimelineMockComponent — coded two-pane memory mock (design spec §4 S4).
 *
 * Left pane: a vertical list of tagged memory rows (Decision=amber, Bugfix=rose,
 * Discovery=emerald), each with one real, legible line of text. Right pane: a
 * `ptah search` input bar with two skeleton result rows. All text is real — no
 * AI-generated garble. Illustrative → `role="img"` + `aria-label`.
 */
@Component({
  selector: 'ptah-memory-timeline-mock',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="h-full w-full grid grid-cols-1 md:grid-cols-5 gap-3 p-4 sm:p-5"
      role="img"
      [attr.aria-label]="ariaLabel()"
    >
      <!-- Left pane: memory timeline -->
      <div class="md:col-span-3 flex flex-col gap-2 overflow-hidden">
        @for (row of rows(); track $index) {
          <div
            class="flex items-center gap-2.5 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2"
          >
            @switch (row.tag) {
              @case ('Decision') {
                <span
                  class="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 shrink-0"
                  >Decision</span
                >
              }
              @case ('Bugfix') {
                <span
                  class="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-400/10 text-rose-400 border border-rose-400/20 shrink-0"
                  >Bugfix</span
                >
              }
              @case ('Discovery') {
                <span
                  class="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-400/10 text-emerald-400 border border-emerald-400/20 shrink-0"
                  >Discovery</span
                >
              }
            }
            <span class="text-xs sm:text-sm text-ink-300 truncate">{{
              row.text
            }}</span>
          </div>
        }
      </div>

      <!-- Right pane: search -->
      <div class="md:col-span-2 flex flex-col gap-2">
        <div
          class="font-mono text-[11px] sm:text-xs text-ink-300 rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 flex items-center gap-2"
        >
          <span class="text-amber-500 shrink-0" aria-hidden="true">⌕</span>
          <span class="truncate">{{ query() }}</span>
        </div>
        @for (r of [0, 1]; track r) {
          <div
            class="rounded-lg border border-ink-700 bg-ink-850 p-2.5 space-y-1.5"
          >
            <div class="h-1.5 rounded-full bg-white/10 w-full"></div>
            <div class="h-1.5 rounded-full bg-white/10 w-3/4"></div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
    `,
  ],
})
export class MemoryTimelineMockComponent {
  public readonly rows = input<readonly MemoryRow[]>([
    { tag: 'Decision', text: 'Memory format changed to JSONB' },
    {
      tag: 'Discovery',
      text: 'Redis is faster than Postgres for raw K/V lookups',
    },
    { tag: 'Bugfix', text: 'Auth token refresh race fixed in interceptor' },
    { tag: 'Decision', text: 'Adopted hybrid BM25 + vector memory search' },
    { tag: 'Discovery', text: 'Tree-sitter indexes 12k symbols in under 2s' },
  ]);

  public readonly query = input<string>(
    'ptah search "where do we validate auth tokens"',
  );

  public readonly ariaLabel = input<string>(
    'Memory panel illustration: a timeline of tagged memories (decisions, bugfixes, discoveries) beside a Ptah search bar querying where auth tokens are validated.',
  );
}
