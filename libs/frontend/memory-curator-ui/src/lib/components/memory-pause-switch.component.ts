import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  DOCUMENT,
  OnInit,
  computed,
  effect,
  inject,
  output,
  untracked,
} from '@angular/core';

import { MemoryDiagnosticsStateService } from '../services/memory-diagnostics-state.service';

/**
 * The Memory master switch (`memory.enabled`) at the top of the Thoth Memory
 * tab (TASK_2026_620 B-P, plan 3.7).
 *
 * Applies on change, with no Save button: optimistic, rolled back on failure
 * (see {@link MemoryDiagnosticsStateService.setMemoryEnabled}). The host value
 * is re-read when the tab is shown, when the window regains focus and when the
 * page becomes visible again, so a pause made from the tray or by editing the
 * settings file shows up without a reload.
 *
 * `pausedChange` fires only when the committed host value flips, never for the
 * first read and never for the optimistic position; the Thoth shell refreshes
 * its sidebar badge on it.
 */
@Component({
  selector: 'ptah-memory-pause-switch',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3"
      [class.border-base-300]="!paused()"
      [class.bg-base-200/40]="!paused()"
      [class.border-warning/60]="paused()"
      [class.bg-warning/10]="paused()"
      aria-labelledby="memory-pause-label"
      data-testid="memory-pause-switch"
    >
      <div class="min-w-0 space-y-0.5">
        <!-- min-h-5 keeps the row one height whether it shows the dot
             label or the Paused badge, so nothing below moves on toggle. -->
        <div class="flex min-h-5 items-center gap-2">
          <label
            id="memory-pause-label"
            for="memory-enabled-toggle"
            class="text-sm font-semibold text-base-content"
          >
            Memory
          </label>
          @if (paused() && !saving()) {
            <span
              class="badge badge-warning badge-sm text-xs font-medium"
              data-testid="memory-pause-state"
              >Paused</span
            >
          } @else {
            <span
              class="inline-flex items-center gap-1 text-xs text-base-content"
              data-testid="memory-pause-state"
            >
              <span
                class="inline-block size-1.5 rounded-full"
                [class.bg-success]="enabled() === true && !saving()"
                [class.bg-info]="saving()"
                [class.bg-base-content-muted]="enabled() === null && !saving()"
                aria-hidden="true"
              ></span>
              {{ stateLabel() }}
            </span>
          }
        </div>
        <!-- The same text in both states (no layout shift on toggle); it
             names the manual actions a pause disables, which may sit below
             the fold. -->
        <p id="memory-pause-help" class="text-xs text-base-content-muted">
          Pausing stops capture, background processing and manual runs (Run
          curator now). Saved memories are still used in chats.
        </p>
      </div>

      <!-- 24×24 px hit area around the switch (WCAG 2.5.8). -->
      <label
        class="inline-flex min-h-6 min-w-6 items-center justify-center"
        [class.cursor-pointer]="!disabled()"
        data-testid="memory-enabled-toggle-target"
      >
        <input
          id="memory-enabled-toggle"
          type="checkbox"
          role="switch"
          class="toggle toggle-sm toggle-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          [checked]="checked()"
          [attr.aria-checked]="checked()"
          [disabled]="disabled()"
          aria-describedby="memory-pause-help memory-pause-status"
          (change)="onToggle($event)"
          data-testid="memory-enabled-toggle"
        />
      </label>

      <div id="memory-pause-status" aria-live="polite" class="basis-full">
        @if (error(); as message) {
          <p
            class="rounded border border-error/40 px-2 py-1 text-xs text-base-content"
            role="alert"
            data-testid="memory-pause-error"
          >
            {{ message }}
          </p>
        }
      </div>
    </section>
  `,
})
export class MemoryPauseSwitchComponent implements OnInit {
  private readonly state = inject(MemoryDiagnosticsStateService);

  /** `true` when Memory became paused, `false` when it resumed. */
  public readonly pausedChange = output<boolean>();

  protected readonly enabled = this.state.memoryEnabled;
  protected readonly paused = this.state.memoryPaused;
  protected readonly saving = this.state.memorySwitchSaving;
  protected readonly error = this.state.memorySwitchError;

  protected readonly checked = computed(() => this.enabled() === true);
  protected readonly disabled = computed(
    () => this.saving() || this.enabled() === null,
  );
  protected readonly stateLabel = computed(() => {
    if (this.saving()) return 'Saving…';
    const enabled = this.enabled();
    if (enabled === null) return 'Checking…';
    return enabled ? 'On' : 'Paused';
  });

  /** The committed value last seen; `null` until the first known value. */
  private lastCommitted: boolean | null = null;

  public constructor() {
    effect(() => {
      const committed = this.state.memoryEnabledCommitted();
      if (committed === null) return;
      const previous = this.lastCommitted;
      this.lastCommitted = committed;
      if (previous !== null && previous !== committed) {
        untracked(() => this.pausedChange.emit(!committed));
      }
    });

    const doc = inject(DOCUMENT);
    const view = doc.defaultView;
    const reread = (): void => void this.state.loadMemoryEnabled();
    const onVisibility = (): void => {
      if (doc.visibilityState === 'visible') reread();
    };
    view?.addEventListener('focus', reread);
    doc.addEventListener('visibilitychange', onVisibility);
    inject(DestroyRef).onDestroy(() => {
      view?.removeEventListener('focus', reread);
      doc.removeEventListener('visibilitychange', onVisibility);
    });
  }

  public ngOnInit(): void {
    void this.state.loadMemoryEnabled();
  }

  protected onToggle(event: Event): void {
    const input = event.target as HTMLInputElement;
    const wanted = input.checked;
    // The DOM checkbox flipped itself; put it back to the bound value so a
    // refused or failed write never leaves it out of step with the state.
    input.checked = this.checked();
    void this.state.setMemoryEnabled(wanted);
  }
}
