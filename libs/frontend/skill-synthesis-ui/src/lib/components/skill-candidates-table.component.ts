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
      class="overflow-hidden rounded-xl border border-base-300 bg-base-200/40"
      aria-label="Skill candidates"
    >
      <table class="table table-sm">
        <thead>
          <tr class="text-xs text-base-content/50">
            <th scope="col" class="font-normal">Name</th>
            <th scope="col" class="font-normal">Status</th>
            <th scope="col" class="text-right font-normal">Successes</th>
            <th scope="col" class="text-right font-normal">Failures</th>
            <th scope="col" class="w-1 font-normal">Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (c of candidates(); track c.id) {
            <tr
              data-testid="skills-candidate-row"
              class="cursor-pointer transition-colors duration-150 hover:bg-base-300/20"
              [class.bg-base-300/40]="selectedCandidateId() === c.id"
              (click)="selectRow.emit(c.id)"
            >
              <td>
                <div class="flex flex-col gap-0.5">
                  <span class="flex items-center gap-1.5 font-medium">
                    {{ c.name }}
                    @if (c.pinned) {
                      <span
                        class="text-xs font-normal text-base-content/50"
                        title="Pinned"
                        >pinned</span
                      >
                    }
                  </span>
                  <span class="text-xs text-base-content/60">
                    {{ c.description }}
                  </span>
                </div>
              </td>
              <td>
                <span class="inline-flex items-center gap-1.5">
                  <span
                    class="inline-block size-1.5 rounded-full"
                    [class]="statusDotClass(c)"
                    aria-hidden="true"
                  ></span>
                  <span
                    class="text-xs text-base-content/70"
                    data-testid="skills-candidate-status"
                    >{{ c.status }}</span
                  >
                </span>
              </td>
              <td class="text-right tabular-nums">{{ c.successCount }}</td>
              <td class="text-right tabular-nums">{{ c.failureCount }}</td>
              <td>
                <div class="flex justify-end gap-1">
                  <button
                    type="button"
                    data-testid="skills-promote-btn"
                    class="btn btn-ghost btn-xs transition-colors duration-150"
                    [disabled]="c.status === 'promoted' || loading()"
                    (click)="promote.emit({ candidate: c, event: $event })"
                  >
                    Promote
                  </button>
                  <button
                    type="button"
                    data-testid="skills-reject-btn"
                    class="btn btn-ghost btn-xs transition-colors duration-150"
                    [disabled]="c.status === 'rejected' || loading()"
                    (click)="reject.emit({ candidate: c, event: $event })"
                  >
                    Reject
                  </button>
                  @if (c.status === 'promoted') {
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs transition-colors duration-150"
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
              <td colspan="5">
                @if (loading()) {
                  <div class="flex flex-col gap-2 px-2 py-4">
                    <div class="h-3 w-1/3 rounded bg-base-300/50"></div>
                    <div class="h-3 w-1/2 rounded bg-base-300/40"></div>
                    <div class="h-3 w-2/5 rounded bg-base-300/30"></div>
                  </div>
                } @else {
                  <div
                    class="flex flex-col items-center gap-1.5 px-4 py-12 text-center"
                    data-testid="skills-empty-state"
                  >
                    <span class="text-sm font-medium text-base-content">
                      No candidates for this filter.
                    </span>
                    <span class="max-w-md text-xs text-base-content/60">
                      Sessions become candidates when a workflow of at least 5
                      turns ends with a success marker (turn complete, subagent
                      stop, idle, or boot scan triggers). Candidates are
                      promoted to active skills only after repeated successful
                      runs.
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

  protected statusDotClass(c: SkillSynthesisCandidateSummary): string {
    switch (c.status) {
      case 'promoted':
        return 'bg-success';
      case 'rejected':
        return 'bg-error';
      default:
        return 'bg-base-content/40';
    }
  }
}
