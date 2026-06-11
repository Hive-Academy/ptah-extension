import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { SkillSynthesisCandidateSummary } from '@ptah-extension/shared';

export interface SkillCandidateAction {
  readonly candidate: SkillSynthesisCandidateSummary;
  readonly event: Event;
}

@Component({
  selector: 'ptah-skill-candidates-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="overflow-x-auto rounded-lg border border-base-300 bg-base-100"
      aria-label="Skill candidates"
    >
      <table class="table table-sm">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Status</th>
            <th scope="col">Pinned</th>
            <th scope="col" class="text-right">Successes</th>
            <th scope="col" class="text-right">Failures</th>
            <th scope="col" class="w-1">Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (c of candidates(); track c.id) {
            <tr
              data-testid="skills-candidate-row"
              class="hover cursor-pointer"
              [class.bg-base-300]="selectedCandidateId() === c.id"
              (click)="selectRow.emit(c.id)"
            >
              <td>
                <div class="flex flex-col">
                  <span class="font-medium">{{ c.name }}</span>
                  <span class="text-xs text-base-content/60">
                    {{ c.description }}
                  </span>
                </div>
              </td>
              <td>
                <span
                  class="badge badge-sm"
                  data-testid="skills-candidate-status"
                  [class]="statusClass(c)"
                >
                  {{ c.status }}
                </span>
              </td>
              <td>
                @if (c.pinned) {
                  <span class="badge badge-warning badge-xs">Pinned</span>
                }
              </td>
              <td class="text-right tabular-nums">{{ c.successCount }}</td>
              <td class="text-right tabular-nums">{{ c.failureCount }}</td>
              <td>
                <div class="flex justify-end gap-1">
                  <button
                    type="button"
                    data-testid="skills-promote-btn"
                    class="btn btn-xs btn-success"
                    [disabled]="c.status === 'promoted' || loading()"
                    (click)="promote.emit({ candidate: c, event: $event })"
                  >
                    Promote
                  </button>
                  <button
                    type="button"
                    data-testid="skills-reject-btn"
                    class="btn btn-xs btn-error btn-outline"
                    [disabled]="c.status === 'rejected' || loading()"
                    (click)="reject.emit({ candidate: c, event: $event })"
                  >
                    Reject
                  </button>
                  @if (c.status === 'promoted') {
                    <button
                      type="button"
                      class="btn btn-xs btn-outline"
                      [disabled]="loading()"
                      (click)="togglePin.emit({ candidate: c, event: $event })"
                    >
                      {{ c.pinned ? 'Unpin' : 'Pin' }}
                    </button>
                  }
                </div>
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="6" class="text-sm text-base-content/60">
                @if (loading()) {
                  <span class="block text-center"
                    >Loading candidates&hellip;</span
                  >
                } @else {
                  <div
                    class="flex flex-col gap-1 px-2 py-4 text-left"
                    data-testid="skills-empty-state"
                  >
                    <span class="font-medium text-base-content">
                      No candidates for this filter.
                    </span>
                    <span>
                      Sessions become candidates when a workflow of at least 5
                      turns ends with a success marker (turn complete, subagent
                      stop, idle, or boot scan triggers).
                    </span>
                    <span>
                      Candidates are promoted to active skills only after
                      repeated successful runs.
                    </span>
                  </div>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
})
export class SkillCandidatesTableComponent {
  public readonly candidates =
    input.required<readonly SkillSynthesisCandidateSummary[]>();
  public readonly selectedCandidateId = input<string | null>(null);
  public readonly loading = input<boolean>(false);

  public readonly selectRow = output<string>();
  public readonly promote = output<SkillCandidateAction>();
  public readonly reject = output<SkillCandidateAction>();
  public readonly togglePin = output<SkillCandidateAction>();

  protected statusClass(c: SkillSynthesisCandidateSummary): string {
    switch (c.status) {
      case 'promoted':
        return 'badge-success';
      case 'rejected':
        return 'badge-error';
      default:
        return 'badge-ghost';
    }
  }
}
