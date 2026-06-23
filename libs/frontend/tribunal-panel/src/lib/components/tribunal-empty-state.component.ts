import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import {
  LucideAngularModule,
  Scale,
  Users,
  GitBranch,
  Trophy,
} from 'lucide-angular';

@Component({
  selector: 'ptah-tribunal-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <div
      class="flex h-full flex-col items-center justify-center p-8 text-center"
    >
      <div
        class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"
      >
        <lucide-angular [img]="ScaleIcon" class="h-8 w-8" />
      </div>
      <h2 class="mb-2 text-lg font-semibold text-base-content/80">
        Convene a Tribunal
      </h2>
      <p class="mb-6 max-w-md text-sm text-base-content/55">
        Put your AI vendors on one panel. Run a Council for a cited verdict, a
        Forge for competing implementations, or a Race scored against a rubric.
      </p>

      <div class="mb-7 grid w-full max-w-md grid-cols-3 gap-3">
        <div
          class="flex flex-col items-center gap-2 rounded-lg border border-base-300 bg-base-100 px-3 py-4"
        >
          <lucide-angular
            [img]="UsersIcon"
            class="h-5 w-5 text-base-content/70"
          />
          <span class="text-xs font-medium text-base-content/70">Council</span>
        </div>
        <div
          class="flex flex-col items-center gap-2 rounded-lg border border-base-300 bg-base-100 px-3 py-4"
        >
          <lucide-angular
            [img]="ForgeIcon"
            class="h-5 w-5 text-base-content/70"
          />
          <span class="text-xs font-medium text-base-content/70">Forge</span>
        </div>
        <div
          class="flex flex-col items-center gap-2 rounded-lg border border-base-300 bg-base-100 px-3 py-4"
        >
          <lucide-angular
            [img]="RaceIcon"
            class="h-5 w-5 text-base-content/70"
          />
          <span class="text-xs font-medium text-base-content/70">Race</span>
        </div>
      </div>

      <button
        type="button"
        class="btn btn-primary gap-2"
        aria-label="Convene a Tribunal"
        (click)="convene.emit()"
      >
        <lucide-angular [img]="ScaleIcon" class="h-4 w-4" />
        Convene a Tribunal
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
    `,
  ],
})
export class TribunalEmptyStateComponent {
  readonly convene = output<void>();

  protected readonly ScaleIcon = Scale;
  protected readonly UsersIcon = Users;
  protected readonly ForgeIcon = GitBranch;
  protected readonly RaceIcon = Trophy;
}
