import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LucideAngularModule, RotateCcw, TriangleAlert } from 'lucide-angular';

export type OnboardingRecoveryReason = 'missing-tab' | 'foreign-tab' | 'workspace-mismatch' | 'stale-run' | 'proposal-unavailable';

const RECOVERY_COPY: Record<OnboardingRecoveryReason, { title: string; detail: string; primary: string }> = {
  'missing-tab': { title: 'This session is no longer available', detail: 'Start over to create a new session.', primary: 'Start over' },
  'foreign-tab': { title: 'This session belongs to another flow', detail: 'Open the correct session or start over.', primary: 'Start over' },
  'workspace-mismatch': { title: 'This session belongs to another workspace', detail: 'Switch to its workspace or start over.', primary: 'Start over' },
  'stale-run': { title: 'This run is no longer current', detail: 'Open the latest run to continue.', primary: 'Open latest' },
  'proposal-unavailable': { title: 'Proposal unavailable', detail: 'The proposal could not be restored from this session.', primary: 'Propose again' },
};

let nextRecoveryTitleId = 0;

@Component({
  selector: 'ptah-recovery-screen',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="rounded-[22px] border border-state-need/70 p-5" data-glass-surface="content" [attr.aria-labelledby]="titleId">
      <div class="flex items-start gap-3">
        <lucide-angular [img]="icons.alert" class="mt-1 size-5 shrink-0 text-state-need" aria-hidden="true" />
        <div><h2 [id]="titleId" class="text-lg font-semibold">{{ copy().title }}</h2>
          <p class="mt-1 text-sm text-base-content-muted">{{ copy().detail }}</p></div>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <button type="button" class="btn btn-primary btn-sm min-h-8" (click)="primary.emit()">
          <lucide-angular [img]="icons.retry" class="size-4" aria-hidden="true" />{{ copy().primary }}
        </button>
        @if (canRestoreDraft()) {<button type="button" class="btn btn-sm min-h-8" (click)="restoreDraft.emit()">Restore from draft</button>}
      </div>
    </section>
  `,
})
export class RecoveryScreenComponent {
  protected readonly titleId = `recovery-title-${++nextRecoveryTitleId}`;
  readonly reason = input.required<OnboardingRecoveryReason>();
  readonly canRestoreDraft = input(false);
  readonly primary = output<void>();
  readonly restoreDraft = output<void>();
  protected readonly copy = computed(() => RECOVERY_COPY[this.reason()]);
  protected readonly icons = { alert: TriangleAlert, retry: RotateCcw } as const;
}
