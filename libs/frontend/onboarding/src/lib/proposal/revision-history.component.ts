import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { HarnessProposalHydrationService } from '@ptah-extension/harness-builder';

type Revision = ReturnType<
  HarnessProposalHydrationService['revisions']
>[number];
@Component({
  selector: 'ptah-revision-history',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<details
    class="group rounded-[12px] border border-base-300 bg-base-100"
    data-glass-surface="content"
  >
    <summary class="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
      <span class="mr-auto">Revision history</span>
      <span class="text-xs font-normal text-base-content-muted">{{ revisions().length }} {{ revisions().length === 1 ? 'revision' : 'revisions' }}</span>
      <svg class="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </summary>
    <ol class="space-y-2 border-t border-base-300 px-4 py-3">
      @for (revision of revisions(); track revision.id) {
        <li
          class="flex min-h-9 flex-wrap items-center gap-2"
        >
          <span class="badge badge-outline badge-sm text-base-content">Rev {{ revision.ordinal }}</span>
          <span class="mr-auto text-xs text-base-content-muted">{{ revision.isConfigComplete ? 'Config complete' : 'Config incomplete' }}{{ revision.id === currentRevisionId() ? ' · current' : '' }}</span>
          @if (revision.id !== currentRevisionId()) {
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              (click)="restore.emit(revision.id)"
            >
              Restore
            </button>
          }
        </li>
      }
    </ol>
  </details>`,
})
export class RevisionHistoryComponent {
  readonly revisions = input.required<readonly Revision[]>();
  readonly currentRevisionId = input.required<string | null>();
  readonly restore = output<string>();
}
