import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import type {
  CrucibleDefect,
  CrucibleRound,
  CrucibleTermination,
  CrucibleVerdict,
  TribunalProgress,
} from '../types/tribunal-ui.types';

/**
 * What the verdict chip says. Four states, and `'awaiting'` is a real one.
 *
 * `'unparsed'` and "no report yet" both land on `'awaiting'`: from the reader's
 * side they are the same fact — the judge has not given us a verdict we can
 * read. What matters is that NEITHER can land on `'pass'` (AC-5.2). There is no
 * optimistic arm in this file.
 */
export type VerdictChip = 'pass' | 'revise' | 'reject' | 'awaiting';

const VERDICT_LABEL: Record<VerdictChip, string> = {
  pass: 'PASS',
  revise: 'REVISE',
  reject: 'REJECT',
  awaiting: 'Awaiting verdict',
};

/** Literal class strings per chip so Tailwind's scanner keeps all four. */
const VERDICT_CLASS: Record<VerdictChip, string> = {
  pass: 'border-success/40 bg-success/10 text-success',
  revise: 'border-warning/40 bg-warning/10 text-warning',
  reject: 'border-error/40 bg-error/10 text-error',
  awaiting: 'border-base-300 bg-base-300/40 text-base-content-muted',
};

/**
 * Severity styling, exhaustive over the parser's four words INCLUDING
 * `'unknown'`.
 *
 * `'unknown'` gets its own row rather than borrowing `major`'s. B2 kept an
 * evidenced defect whose severity word was off-contract instead of dropping it,
 * and explicitly refused to remap it onto `major` because that misreports the
 * judge. Remapping it HERE would reintroduce exactly that bug one level up.
 */
const SEVERITY_CLASS: Record<CrucibleDefect['severity'], string> = {
  blocking: 'border-error/40 text-error',
  major: 'border-warning/40 text-warning',
  minor: 'border-base-300 text-base-content-muted',
  unknown: 'border-info/40 text-info',
};

/** The honest terminal statements (AC-5.6), one per stopping condition. */
const TERMINATION_COPY: Record<
  Exclude<CrucibleTermination, 'in-progress'>,
  { readonly headline: string; readonly detail: string }
> = {
  pass: {
    headline: 'PASS — the judge’s opinion',
    detail:
      'The judge’s PASS is an opinion; the build is the fact. The conductor still verifies against the build before this is called done.',
  },
  'cap-reached-with-defects': {
    headline: 'Round cap reached with defects still open',
    detail:
      'The loop stopped at its cap while the judge was still asking for revisions. The defects below were never fixed — they are the honest state of the work, not a to-do list the loop will get to.',
  },
  reject: {
    headline: 'REJECT — the loop stopped',
    detail:
      'The judge rejected the approach rather than asking for revisions. This is not a revisable round: nothing is being patched, and the work needs a different approach before it is worth another lane.',
  },
  'regression-stop': {
    headline: 'Stopped on a regression',
    detail:
      'The defect count did not go down and the severity mix did not improve versus the previous round, so continuing would have spent another round going backwards.',
  },
};

/**
 * Crucible's round / verdict / defect readout (AC-5.1 – AC-5.7).
 *
 * ## The one rule this component exists to keep
 *
 * A verdict we could not read and a verdict that was never written both render
 * as "awaiting verdict". Neither may EVER render as PASS, and PASS itself is
 * labelled as the judge's opinion rather than as a finished build
 * (`crucible.md:151`).
 *
 * ## Untrusted text (AC-5.7 / NFR-4 / R8)
 *
 * The judge report is vendor output. The mentor note is prose meant to read as
 * prose, so it goes through {@link MarkdownBlockComponent} — the single
 * DOMPurify chokepoint in the product, already provided app-wide. Defect
 * `what` / `expected` / `location` go through Angular INTERPOLATION, which
 * escapes unconditionally: DOMPurify would strip a markdown-link payload
 * anyway, but interpolation is both cheaper and a stronger guarantee where
 * markdown buys nothing. No `[innerHTML]` anywhere in this lib.
 */
@Component({
  selector: 'ptah-crucible-verdict-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MarkdownBlockComponent],
  template: `
    @if (crucible(); as run) {
      <div class="flex flex-col gap-2" data-testid="tribunal-verdict-panel">
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="text-xs font-semibold text-base-content"
            data-testid="tribunal-round-counter"
          >
            Round {{ run.currentRound }} of {{ run.roundCap }}
          </span>
          @if (run.currentRound > run.roundCap) {
            <span
              class="text-[10px] uppercase tracking-wide text-warning"
              data-testid="tribunal-round-over-cap"
            >
              user-authorised
            </span>
          }
          <span
            class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide {{
              chipClass()
            }}"
            data-testid="tribunal-verdict-chip"
            [attr.data-verdict]="chip()"
          >
            {{ chipLabel() }}
          </span>
        </div>

        @if (terminal(); as terminal) {
          <div
            class="flex flex-col gap-0.5 rounded-lg border border-base-300 bg-base-200/40 px-3 py-2"
            data-testid="tribunal-termination"
            [attr.data-termination]="terminal.kind"
            role="status"
          >
            <span class="text-xs font-semibold text-base-content">
              {{ terminal.headline }}
            </span>
            <span class="text-[11px] text-base-content-muted">
              {{ terminal.detail }}
            </span>
          </div>
        }

        @if (nextRoundNote(); as note) {
          <p
            class="text-[11px] text-base-content-muted"
            data-testid="tribunal-revise-note"
          >
            {{ note }}
          </p>
        }

        @if (run.rounds.length === 0) {
          <p
            class="text-[11px] text-base-content-muted"
            data-testid="tribunal-no-rounds"
          >
            No judge report has been written yet. Nothing has been scored — this
            is not a pass.
          </p>
        }

        @for (round of run.rounds; track round.round) {
          <section
            class="flex flex-col gap-1 rounded-lg border border-base-300 px-3 py-2"
            data-testid="tribunal-round"
            [attr.data-round]="round.round"
          >
            <header class="flex items-center gap-2">
              <span class="text-[11px] font-semibold text-base-content">
                Round {{ round.round }}
              </span>
              <span
                class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide {{
                  verdictClass(round.verdict)
                }}"
                data-testid="tribunal-round-verdict"
                [attr.data-verdict]="chipFor(round.verdict)"
              >
                {{ verdictLabel(round.verdict) }}
              </span>
            </header>

            @if (round.defects.length > 0) {
              <ul class="flex flex-col gap-1" data-testid="tribunal-defects">
                @for (defect of round.defects; track defect.id) {
                  <li
                    class="flex flex-col gap-0.5 border-l-2 border-base-300 pl-2"
                    data-testid="tribunal-defect"
                  >
                    <span class="flex flex-wrap items-center gap-1.5">
                      <span class="text-[10px] font-semibold text-base-content">
                        {{ defect.id }}
                      </span>
                      <span
                        class="rounded border px-1 text-[10px] uppercase tracking-wide {{
                          severityClass(defect.severity)
                        }}"
                        data-testid="tribunal-defect-severity"
                      >
                        {{ defect.severity }}
                      </span>
                      <span
                        class="truncate font-mono text-[10px] text-base-content-muted"
                        data-testid="tribunal-defect-location"
                      >
                        {{ defect.location }}
                      </span>
                    </span>
                    <span
                      class="text-[11px] text-base-content"
                      data-testid="tribunal-defect-what"
                    >
                      {{ defect.what }}
                    </span>
                    @if (defect.expected) {
                      <span
                        class="text-[11px] text-base-content-muted"
                        data-testid="tribunal-defect-expected"
                      >
                        Expected: {{ defect.expected }}
                      </span>
                    }
                  </li>
                }
              </ul>
            }

            @if (round.mentorNote; as note) {
              <div
                class="rounded border border-base-300 bg-base-200/40 px-2 py-1"
                data-testid="tribunal-mentor-note"
              >
                <span
                  class="text-[10px] uppercase tracking-wide text-base-content-muted"
                >
                  Mentor note · round {{ round.round }}
                </span>
                <ptah-markdown-block [content]="note" />
              </div>
            }
          </section>
        }
      </div>
    } @else if (unavailableReason(); as reason) {
      <p
        class="flex flex-col gap-0.5 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-base-content-muted"
        data-testid="tribunal-verdict-unavailable"
        role="status"
      >
        <span class="font-semibold text-base-content"
          >Round progress unavailable</span
        >
        <span>{{ reason }}</span>
        <span>
          No verdict is being claimed either way — the panelist tiles are
          unaffected.
        </span>
      </p>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class CrucibleVerdictPanelComponent {
  readonly progress = input.required<TribunalProgress>();

  protected readonly crucible = computed(() => {
    const progress = this.progress();
    return progress.kind === 'crucible' ? progress : null;
  });

  protected readonly unavailableReason = computed<string | null>(() => {
    const progress = this.progress();
    return progress.kind === 'unavailable' ? progress.reason : null;
  });

  /** The latest judged round, or `null` when nothing has been judged. */
  private readonly lastRound = computed<CrucibleRound | null>(() => {
    const rounds = this.crucible()?.rounds ?? [];
    return rounds.length > 0 ? rounds[rounds.length - 1] : null;
  });

  /** The headline chip. No round at all is `awaiting`, never `pass`. */
  protected readonly chip = computed<VerdictChip>(() => {
    const last = this.lastRound();
    return last ? this.chipFor(last.verdict) : 'awaiting';
  });

  protected readonly chipLabel = computed(() => VERDICT_LABEL[this.chip()]);
  protected readonly chipClass = computed(() => VERDICT_CLASS[this.chip()]);

  /**
   * The terminal banner, or `null` while the loop is open.
   *
   * Exhaustive over {@link CrucibleTermination} by construction: `in-progress`
   * is excluded from {@link TERMINATION_COPY}'s key type, so a sixth
   * termination cannot be silently rendered as "still running".
   */
  protected readonly terminal = computed<{
    kind: CrucibleTermination;
    headline: string;
    detail: string;
  } | null>(() => {
    const termination = this.crucible()?.termination;
    if (!termination || termination === 'in-progress') return null;
    return { kind: termination, ...TERMINATION_COPY[termination] };
  });

  /**
   * The one revise affordance, and the four cases that must NOT get it.
   *
   * Shown only while the loop is genuinely open on a REVISE. A `reject` is not
   * a revisable round (AC-5.5); a cap-reached or regression stop has no next
   * round to promise; a `pass` has nothing to revise. Each of those is a
   * terminal statement, and pairing one with "the next round will fix this"
   * would be the panel contradicting the judge.
   */
  protected readonly nextRoundNote = computed<string | null>(() => {
    const run = this.crucible();
    const last = this.lastRound();
    if (!run || !last) return null;
    if (run.termination !== 'in-progress' || last.verdict !== 'revise') {
      return null;
    }
    return `The executor revises against round ${last.round}’s defects in round ${
      last.round + 1
    }.`;
  });

  protected chipFor(verdict: CrucibleVerdict): VerdictChip {
    return verdict === 'unparsed' ? 'awaiting' : verdict;
  }

  protected verdictLabel(verdict: CrucibleVerdict): string {
    return VERDICT_LABEL[this.chipFor(verdict)];
  }

  protected verdictClass(verdict: CrucibleVerdict): string {
    return VERDICT_CLASS[this.chipFor(verdict)];
  }

  protected severityClass(severity: CrucibleDefect['severity']): string {
    return SEVERITY_CLASS[severity];
  }
}
