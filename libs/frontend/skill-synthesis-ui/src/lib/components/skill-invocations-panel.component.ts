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
        class="rounded-lg border border-base-300 bg-base-100 p-4"
        aria-label="Invocation history"
      >
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold">
            Invocations &mdash;
            <span class="font-mono text-xs">{{ sc.name }}</span>
          </h2>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            (click)="closed.emit()"
          >
            Close
          </button>
        </div>

        @if (invocations().length === 0) {
          <div class="mt-2 text-xs text-base-content/60">
            No invocations recorded for this candidate yet.
          </div>
        } @else {
          <div class="mt-2 overflow-x-auto">
            <table class="table table-xs">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Session</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                @for (inv of invocations(); track inv.id) {
                  <tr>
                    <td class="font-mono text-xs">
                      {{ formatTime(inv.invokedAt) }}
                    </td>
                    <td class="font-mono text-xs">{{ inv.sessionId }}</td>
                    <td>
                      <span
                        class="badge badge-xs"
                        [class.badge-success]="inv.succeeded"
                        [class.badge-error]="!inv.succeeded"
                      >
                        {{ inv.succeeded ? 'success' : 'failure' }}
                      </span>
                    </td>
                    <td class="text-xs">{{ inv.notes ?? '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
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
