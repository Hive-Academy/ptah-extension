import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule, RefreshCw, TriangleAlert } from 'lucide-angular';

@Component({
  selector: 'ptah-owner-conflict-banner',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="flex flex-wrap items-center gap-3 rounded-[14px] border border-state-need/70 p-4 text-sm"
             data-glass-surface="chrome" role="status">
      <lucide-angular [img]="icons.alert" class="size-5 shrink-0 text-state-need" aria-hidden="true" />
      <p class="min-w-0 flex-1"><strong>Another run is active.</strong> {{ message() }}</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-sm min-h-8" (click)="openOwner.emit()">Open it</button>
        <button type="button" class="btn btn-sm min-h-8" (click)="retry.emit()">
          <lucide-angular [img]="icons.retry" class="size-4" aria-hidden="true" />Retry
        </button>
      </div>
    </section>
  `,
})
export class OwnerConflictBannerComponent {
  readonly message = input('Open the active run before starting another.');
  readonly openOwner = output<void>();
  readonly retry = output<void>();
  protected readonly icons = { alert: TriangleAlert, retry: RefreshCw } as const;
}
