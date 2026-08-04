/**
 * SkillInvocationsPanelComponent — invocation history for one candidate.
 *
 * A run log is read outcome-first, not column-first: the old four-column table
 * put `When` and `Session` ahead of the only field anyone scans for, and padded
 * every note-less run with an em dash. Each run is now a compact
 * {@link NativeCardComponent} whose tone and spine ARE the outcome (success /
 * error), with the note rendered only when there is one.
 *
 * There is intentionally NO filtering here. The list is already scoped to a
 * single candidate and is short; a filter row would be chrome over nothing.
 *
 * Pure presentational: `input()` signals in, one `closed` output. OnPush.
 */
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { NativeCardComponent } from '@ptah-extension/ui';
import type {
  SkillSynthesisCandidateSummary,
  SkillSynthesisInvocationEntry,
} from '@ptah-extension/shared';

@Component({
  selector: 'ptah-skill-invocations-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NativeCardComponent],
  template: `
    @if (candidate(); as sc) {
      <section class="flex flex-col gap-2" aria-label="Invocation history">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-sm font-medium">
            Invocations
            <span class="ml-1 text-base-content/60">{{ sc.name }}</span>
          </h2>
          <button
            type="button"
            class="btn btn-ghost btn-xs transition-colors duration-150"
            (click)="closed.emit()"
          >
            Close
          </button>
        </div>

        @if (invocations().length === 0) {
          <p
            class="px-4 py-8 text-center text-xs text-base-content/60"
            data-testid="skills-invocations-empty"
          >
            No invocations recorded for this candidate yet.
          </p>
        } @else {
          <ul class="flex list-none flex-col gap-1.5 p-0" role="list">
            @for (inv of invocations(); track inv.id) {
              <li>
                <ptah-native-card
                  [tone]="inv.succeeded ? 'success' : 'error'"
                  [spine]="true"
                  density="compact"
                  data-testid="skills-invocation-card"
                >
                  <div
                    card-header
                    class="flex items-center justify-between gap-3"
                  >
                    <span class="inline-flex items-center gap-1.5">
                      <span
                        class="inline-block size-1.5 rounded-full"
                        [class.bg-success]="inv.succeeded"
                        [class.bg-error]="!inv.succeeded"
                        aria-hidden="true"
                      ></span>
                      <span
                        class="text-xs text-base-content/70"
                        data-testid="skills-invocation-outcome"
                        >{{ inv.succeeded ? 'success' : 'failure' }}</span
                      >
                    </span>
                    <span
                      class="shrink-0 font-mono text-[11px] text-base-content/50"
                    >
                      {{ formatTime(inv.invokedAt) }}
                    </span>
                  </div>

                  <p
                    class="truncate font-mono text-[11px] text-base-content/45"
                    [title]="inv.sessionId"
                  >
                    {{ inv.sessionId }}
                  </p>

                  @if (inv.notes; as notes) {
                    <p
                      class="text-xs text-base-content/70"
                      data-testid="skills-invocation-notes"
                    >
                      {{ notes }}
                    </p>
                  }
                </ptah-native-card>
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
})
export class SkillInvocationsPanelComponent {
  public readonly candidate =
    input.required<SkillSynthesisCandidateSummary | null>();
  public readonly invocations =
    input.required<readonly SkillSynthesisInvocationEntry[]>();

  public readonly closed = output<void>();

  protected formatTime(epochMs: number): string {
    if (!Number.isFinite(epochMs)) return 'unknown time';
    return new Date(epochMs).toLocaleString();
  }
}
