import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { OnboardingWorkspaceStore } from './onboarding-workspace.store';

@Component({
  selector: 'ptah-workspace-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rounded-xl border border-base-300 bg-base-200 p-3 text-sm" aria-label="Workspace folder" data-testid="workspace-header">
      <p class="font-medium">Current folder: {{ store.active()?.name ?? store.activePath() ?? 'No folder open' }}</p>
      @if (store.isElectron) {
        @if (canSwitch()) {
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <label for="onboarding-workspace-select" class="sr-only">Switch open folder</label>
            <select id="onboarding-workspace-select" class="select select-bordered select-sm" [disabled]="!store.canSwitch()" (change)="switchTo($event)">
              @for (folder of store.folders(); track folder.path; let index = $index) {
                <option [value]="index" [selected]="index === store.activeIndex()">{{ folder.name }}</option>
              }
            </select>
            <button type="button" class="btn btn-outline btn-sm" [disabled]="!store.canSwitch()" (click)="store.openFolder()">Open folder…</button>
            <button type="button" class="btn btn-outline btn-sm" [disabled]="!store.canSwitch()" (click)="store.createFolder()">New folder…</button>
          </div>
          @if (store.folderError()) { <p class="mt-2 text-error" role="alert">{{ store.folderError() }}</p> }
        } @else {
          <p class="mt-1 text-base-content-muted">Return to Home to switch folder.</p>
        }
      }
    </section>
  `,
})
export class WorkspaceHeaderComponent {
  readonly canSwitch = input(false);
  protected readonly store = inject(OnboardingWorkspaceStore);
  protected switchTo(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    if (this.canSwitch() && Number.isInteger(value)) this.store.switchTo(value);
  }
}
