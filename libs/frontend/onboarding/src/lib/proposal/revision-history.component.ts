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
    class="rounded-[14px] border border-base-300 p-4"
    data-glass-surface="tile"
  >
    <summary class="cursor-pointer font-medium">
      Revision history · {{ revisions().length }}
    </summary>
    <ol class="mt-3 space-y-2">
      @for (revision of revisions(); track revision.id) {
        <li
          class="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-base-300 p-2"
        >
          <span
            >Revision {{ revision.ordinal }} ·
            {{ revision.isConfigComplete ? 'Complete' : 'In progress' }}</span
          >
          @if (revision.id !== currentRevisionId()) {
            <button
              type="button"
              class="btn btn-sm"
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
