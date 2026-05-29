import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { MemoryTypeWire } from '@ptah-extension/shared';

import { TimelineStateService } from '../services/timeline-state.service';

interface TypeChip {
  readonly id: MemoryTypeWire;
  readonly label: string;
}

const TYPE_CHIPS: readonly TypeChip[] = [
  { id: 'bugfix', label: 'Bugfix' },
  { id: 'feature', label: 'Feature' },
  { id: 'decision', label: 'Decision' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'refactor', label: 'Refactor' },
  { id: 'change', label: 'Change' },
];

/**
 * TimelineFiltersComponent
 *
 * Presentational filter strip for the Timeline view. Reads from and writes
 * to {@link TimelineStateService}; takes no inputs. All filter changes are
 * pushed back through the state service, which the parent observes via
 * the `rows`/`error`/`loading` readonly signals.
 */
@Component({
  selector: 'ptah-timeline-filters',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <input
          type="search"
          class="input input-sm input-bordered w-full md:max-w-md"
          placeholder="Filter timeline (BM25 + filters)..."
          [value]="state.query()"
          (input)="onQueryInput($event)"
          aria-label="Timeline search query"
        />
        <button
          type="button"
          class="btn btn-sm btn-primary"
          [disabled]="state.loading()"
          (click)="onApply()"
          aria-label="Apply timeline filters"
        >
          @if (state.loading()) {
            <span class="loading loading-spinner loading-xs"></span>
          }
          Apply
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          (click)="onReset()"
          [disabled]="state.loading()"
          aria-label="Reset timeline filters"
        >
          Reset
        </button>
      </div>

      <div
        role="group"
        aria-label="Memory type filter"
        class="flex flex-wrap gap-1"
      >
        @for (chip of typeChips; track chip.id) {
          <button
            type="button"
            class="btn btn-xs"
            [class.btn-primary]="state.typeFilter().includes(chip.id)"
            [class.btn-ghost]="!state.typeFilter().includes(chip.id)"
            [attr.aria-pressed]="state.typeFilter().includes(chip.id)"
            (click)="onTypeToggle(chip.id)"
          >
            {{ chip.label }}
          </button>
        }
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <input
          type="text"
          class="input input-xs input-bordered w-full md:max-w-xs"
          placeholder="Concepts (comma-separated)"
          [value]="conceptInput()"
          (change)="onConceptCommit($event)"
          aria-label="Comma-separated concept filter"
        />
        <input
          type="text"
          class="input input-xs input-bordered w-full md:max-w-xs"
          placeholder="Files (comma-separated)"
          [value]="fileInput()"
          (change)="onFileCommit($event)"
          aria-label="Comma-separated file filter"
        />
      </div>

      <div class="flex flex-wrap items-center gap-2 text-xs">
        <label class="flex items-center gap-1">
          <span class="text-base-content/60">From</span>
          <input
            type="date"
            class="input input-xs input-bordered"
            [value]="fromInput()"
            (change)="onFromChange($event)"
            aria-label="Date range from"
          />
        </label>
        <label class="flex items-center gap-1">
          <span class="text-base-content/60">To</span>
          <input
            type="date"
            class="input input-xs input-bordered"
            [value]="toInput()"
            (change)="onToChange($event)"
            aria-label="Date range to"
          />
        </label>
        @if (state.bm25Only()) {
          <span
            class="badge badge-warning badge-sm"
            data-testid="timeline-bm25-only-badge"
            title="Vec embeddings unavailable for this run; results are BM25-only."
          >
            BM25 only
          </span>
        }
      </div>
    </div>
  `,
})
export class TimelineFiltersComponent {
  protected readonly state = inject(TimelineStateService);
  protected readonly typeChips = TYPE_CHIPS;

  protected readonly conceptInput = signal<string>('');
  protected readonly fileInput = signal<string>('');
  protected readonly fromInput = signal<string>('');
  protected readonly toInput = signal<string>('');

  protected onQueryInput(event: Event): void {
    this.state.setQuery((event.target as HTMLInputElement).value);
  }

  protected onTypeToggle(id: MemoryTypeWire): void {
    this.state.toggleType(id);
  }

  protected onConceptCommit(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.conceptInput.set(raw);
    this.state.setConceptFilter(splitTokens(raw));
  }

  protected onFileCommit(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.fileInput.set(raw);
    this.state.setFileFilter(splitTokens(raw));
  }

  protected onFromChange(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.fromInput.set(raw);
    this.commitDateRange();
  }

  protected onToChange(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.toInput.set(raw);
    this.commitDateRange();
  }

  protected onApply(): void {
    void this.state.search();
  }

  protected onReset(): void {
    this.state.reset();
    this.conceptInput.set('');
    this.fileInput.set('');
    this.fromInput.set('');
    this.toInput.set('');
  }

  private commitDateRange(): void {
    const fromMs = parseDateMs(this.fromInput());
    const toMs = parseDateMs(this.toInput());
    if (fromMs === null && toMs === null) {
      this.state.setDateRange(null);
      return;
    }
    this.state.setDateRange({
      ...(fromMs !== null ? { fromMs } : {}),
      ...(toMs !== null ? { toMs } : {}),
    });
  }
}

function splitTokens(raw: string): readonly string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function parseDateMs(raw: string): number | null {
  if (raw.trim().length === 0) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}
