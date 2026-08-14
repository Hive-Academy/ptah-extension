import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, Scale, Info } from 'lucide-angular';
import { TribunalRunService } from '../services/tribunal-run.service';
import { TribunalStateService } from '../services/tribunal-state.service';
import { estimateTurns } from '../services/tribunal-estimate';
import { rosterIsLaunchable } from '../services/tribunal-roster-rules';
import {
  rolesForMove,
  type TribunalMove,
  type VendorLane,
} from '../types/tribunal-ui.types';

@Component({
  selector: 'ptah-step-run',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <div
      class="flex flex-col items-center gap-4 py-4 text-center"
      data-testid="tribunal-step-run"
    >
      <div
        class="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"
      >
        <lucide-angular [img]="ScaleIcon" class="h-7 w-7" aria-hidden="true" />
      </div>
      <div class="flex flex-col gap-1">
        <h3 class="text-base font-semibold text-base-content">
          Ready to convene
        </h3>
        <p class="max-w-sm text-sm text-base-content-muted">
          {{ lanes().length }} vendor(s) will join the {{ move() }}. The page
          switches to the live grid — type your objective in the conductor chat
          to start the run.
        </p>
        <p class="text-xs text-base-content-muted">
          Roughly {{ estimatedTurns() }} paid turns — an estimate, not a
          guarantee.
        </p>
      </div>

      @if (notice()) {
        <p
          class="flex max-w-sm items-start gap-2 rounded-lg border border-base-300 bg-base-200/40 px-3 py-2 text-left text-xs text-base-content-muted"
          role="note"
          data-testid="tribunal-spec-folder-notice"
        >
          <lucide-angular
            [img]="InfoIcon"
            class="mt-0.5 h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
          />
          <span>{{ notice() }}</span>
        </p>
      }

      @if (error()) {
        <p class="text-xs text-error" role="alert">{{ error() }}</p>
      }

      <button
        type="button"
        class="btn btn-primary gap-2"
        [disabled]="!canRun()"
        aria-label="Open the Tribunal"
        (click)="run()"
      >
        <lucide-angular [img]="ScaleIcon" class="h-4 w-4" aria-hidden="true" />
        {{ launching() ? 'Opening…' : 'Open Tribunal' }}
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class StepRunComponent {
  readonly move = input<TribunalMove>('council');
  readonly lanes = input<readonly VendorLane[]>([]);
  readonly rubric = input<string>('');
  readonly roundCap = input<number>(2);
  readonly launched = output<void>();

  private readonly runService = inject(TribunalRunService);
  private readonly state = inject(TribunalStateService);

  private readonly _error = signal<string | null>(null);
  private readonly _notice = signal<string | null>(null);
  private readonly _launching = signal(false);

  protected readonly error = this._error.asReadonly();
  protected readonly notice = this._notice.asReadonly();
  protected readonly launching = this._launching.asReadonly();

  protected readonly ScaleIcon = Scale;
  protected readonly InfoIcon = Info;

  protected readonly estimatedTurns = computed(() =>
    estimateTurns(
      this.move(),
      Math.max(1, this.lanes().length),
      this.roundCap(),
    ),
  );

  /**
   * R9 — the button is dead for the whole `prepare()` await.
   *
   * `prepare()` allocates a spec folder before it creates the conductor tab, so
   * a double-click on a slow allocation would mint two task folders and leave
   * one orphaned. The disable is the fix; there is no debounce to tune.
   */
  protected readonly canRun = computed(
    () =>
      !this._launching() &&
      this.lanes().length > 0 &&
      rosterIsLaunchable(this.move(), this.lanes()),
  );

  protected async run(): Promise<void> {
    if (!this.canRun()) return;
    this._error.set(null);
    this._notice.set(null);
    this._launching.set(true);
    try {
      const move = this.move();
      const isRoleMove = rolesForMove(move).length > 0;
      const ok = await this.runService.prepare({
        move,
        lanes: this.lanes(),
        ...(move === 'crucible'
          ? { rubric: this.rubric(), roundCap: this.roundCap() }
          : {}),
      });
      if (!ok) {
        this._error.set('Failed to open the Tribunal. Please try again.');
        return;
      }
      // Non-blocking by construction: the run is already prepared at this
      // point. A missing spec folder costs the progress view, never the run.
      if (isRoleMove && this.state.specTaskId() === null) {
        this._notice.set(
          'No task folder could be created for this run, so phase progress will show as unavailable. The conductor will allocate its own spec folder.',
        );
      }
      this.launched.emit();
    } finally {
      this._launching.set(false);
    }
  }
}
