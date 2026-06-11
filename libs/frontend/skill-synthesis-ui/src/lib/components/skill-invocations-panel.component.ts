import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type {
  SkillSynthesisCandidateSummary,
  SkillSynthesisInvocationEntry,
} from '@ptah-extension/shared';

@Component({
  selector: 'ptah-skill-invocations-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (candidate(); as sc) {
      <section
        class="overflow-hidden rounded-xl border border-base-300 bg-base-200/40"
        aria-label="Invocation history"
      >
        <div
          class="flex items-center justify-between border-b border-base-300 px-4 py-3"
        >
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
          <div class="px-4 py-8 text-center text-xs text-base-content/60">
            No invocations recorded for this candidate yet.
          </div>
        } @else {
          <table class="table table-sm">
            <thead>
              <tr class="text-xs text-base-content/50">
                <th scope="col" class="font-normal">When</th>
                <th scope="col" class="font-normal">Session</th>
                <th scope="col" class="font-normal">Outcome</th>
                <th scope="col" class="font-normal">Notes</th>
              </tr>
            </thead>
            <tbody>
              @for (inv of invocations(); track inv.id) {
                <tr class="hover:bg-base-300/20">
                  <td class="font-mono text-xs">
                    {{ formatTime(inv.invokedAt) }}
                  </td>
                  <td class="font-mono text-xs">{{ inv.sessionId }}</td>
                  <td>
                    <span class="inline-flex items-center gap-1.5">
                      <span
                        class="inline-block size-1.5 rounded-full"
                        [class.bg-success]="inv.succeeded"
                        [class.bg-error]="!inv.succeeded"
                        aria-hidden="true"
                      ></span>
                      <span class="text-xs text-base-content/70">
                        {{ inv.succeeded ? 'success' : 'failure' }}
                      </span>
                    </span>
                  </td>
                  <td class="text-xs">{{ inv.notes ?? '—' }}</td>
                </tr>
              }
            </tbody>
          </table>
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
    if (!Number.isFinite(epochMs)) return '—';
    return new Date(epochMs).toLocaleString();
  }
}
