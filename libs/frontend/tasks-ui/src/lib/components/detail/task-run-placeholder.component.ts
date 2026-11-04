import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** The task that will own the Ptah multi-stage runner (Phase 2). */
export const TASK_RUN_PHASE_2_TASK_ID = 'TASK_2026_358';

/**
 * Inactive seam for the Phase 2 run panel (TASK_2026_358).
 *
 * Phase 1 ships only the place and the input contract: the selected task and
 * the workspace root enter here, and a later validated host-neutral RPC will
 * supply run and stage data. There is deliberately no button, progress bar or
 * simulated state: Start stays the separate chat-prefill action.
 */
@Component({
  selector: 'ptah-task-run-placeholder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="bg-surface-1 border border-dashed border-surface-border rounded-box p-4 text-sm"
      aria-labelledby="task-run-placeholder-heading"
      data-testid="task-run-placeholder"
      [attr.data-task-id]="selectedTaskId()"
    >
      <h3
        id="task-run-placeholder-heading"
        class="flex flex-wrap items-center gap-2 text-sm font-semibold text-base-content"
      >
        Run
        <span class="badge badge-ghost badge-sm font-normal"
          >Planned for Phase 2 · {{ phase2TaskId }}</span
        >
      </h3>
      <p class="mt-2 text-xs leading-relaxed text-base-content-muted">
        Launch, watch and resume a Ptah-owned multi-stage run here.
      </p>
    </section>
  `,
})
export class TaskRunPlaceholderComponent {
  /** Folder id of the task the future run panel will show; `null` when none. */
  public readonly selectedTaskId = input<string | null>(null);
  /** Active workspace root the future run RPC is scoped to; `null` when none. */
  public readonly workspaceRoot = input<string | null>(null);

  protected readonly phase2TaskId = TASK_RUN_PHASE_2_TASK_ID;
}
