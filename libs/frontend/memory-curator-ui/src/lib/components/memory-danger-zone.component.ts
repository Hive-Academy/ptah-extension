import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

export type MemoryPurgeMode = 'substring' | 'like';

export interface MemoryPurgeRequest {
  readonly pattern: string;
  readonly mode: MemoryPurgeMode;
}

@Component({
  selector: 'ptah-memory-danger-zone',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <details
      class="collapse collapse-arrow rounded-lg border border-error/40 bg-base-100"
    >
      <summary
        class="collapse-title min-h-0 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-error"
      >
        Danger zone
      </summary>
      <div class="collapse-content">
        <section
          class="flex flex-col gap-2 pt-2 md:flex-row md:items-end"
          aria-label="Purge memory entries by subject pattern"
        >
          <div class="flex flex-1 flex-col gap-1">
            <label
              for="memory-purge-pattern"
              class="text-xs uppercase text-base-content/60"
            >
              Purge by subject pattern
            </label>
            <input
              id="memory-purge-pattern"
              type="text"
              class="input input-sm input-bordered w-full"
              placeholder="e.g. preferences  (substring)  or  alice@%  (like)"
              [value]="pattern()"
              (input)="onPatternInput($event)"
              [disabled]="purging()"
              aria-label="Pattern to match against memory subject"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label
              for="memory-purge-mode"
              class="text-xs uppercase text-base-content/60"
            >
              Mode
            </label>
            <select
              id="memory-purge-mode"
              class="select select-sm select-bordered"
              [value]="mode()"
              (change)="onModeChange($event)"
              [disabled]="purging()"
              aria-label="Pattern match mode"
            >
              <option value="substring">substring</option>
              <option value="like">like</option>
            </select>
          </div>
          <button
            type="button"
            class="btn btn-sm btn-error md:self-end"
            [disabled]="purgeDisabled()"
            [attr.title]="
              !hasWorkspace() ? 'Open a workspace to purge memory.' : null
            "
            (click)="onPurge()"
          >
            @if (purging()) {
              <span class="loading loading-spinner loading-xs"></span>
            }
            Purge
          </button>
        </section>

        @if (!hasWorkspace()) {
          <p class="mt-2 text-xs text-base-content/60">
            Open a workspace to purge memory.
          </p>
        }
        @if (scopeIsAll()) {
          <p class="mt-1 text-xs text-warning">
            Switch to 'This workspace' to purge.
            <button
              type="button"
              class="btn btn-xs btn-link p-0"
              (click)="switchScope.emit()"
            >
              Switch
            </button>
          </p>
        }

        @if (error()) {
          <div role="alert" class="alert alert-error mt-2">
            <span class="text-sm">{{ error() }}</span>
          </div>
        }
        @if (info()) {
          <div role="status" class="alert alert-success mt-2">
            <span class="text-sm">{{ info() }}</span>
          </div>
        }
      </div>
    </details>
  `,
})
export class MemoryDangerZoneComponent {
  public readonly purging = input<boolean>(false);
  public readonly error = input<string | null>(null);
  public readonly info = input<string | null>(null);
  public readonly hasWorkspace = input<boolean>(false);
  public readonly scopeIsAll = input<boolean>(false);

  public readonly purge = output<MemoryPurgeRequest>();
  public readonly inputChanged = output<void>();
  public readonly switchScope = output<void>();

  protected readonly pattern = signal<string>('');
  protected readonly mode = signal<MemoryPurgeMode>('substring');

  protected readonly purgeDisabled = computed(
    () =>
      !this.pattern().trim() ||
      this.purging() ||
      !this.hasWorkspace() ||
      this.scopeIsAll(),
  );

  public clearPattern(): void {
    this.pattern.set('');
  }

  protected onPatternInput(event: Event): void {
    this.pattern.set((event.target as HTMLInputElement).value);
    this.inputChanged.emit();
  }

  protected onModeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'substring' || value === 'like') {
      this.mode.set(value);
    }
    this.inputChanged.emit();
  }

  protected onPurge(): void {
    const pattern = this.pattern().trim();
    if (pattern === '') return;
    this.purge.emit({ pattern, mode: this.mode() });
  }
}
