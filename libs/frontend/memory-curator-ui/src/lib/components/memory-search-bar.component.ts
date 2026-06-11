import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import type {
  MemoryScopeFilter,
  MemoryTierFilter,
} from '../services/memory-state.service';

interface TierChip {
  readonly id: MemoryTierFilter;
  readonly label: string;
}

@Component({
  selector: 'ptah-memory-search-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      <input
        type="search"
        data-testid="memory-search-input"
        class="input input-sm input-bordered w-full md:max-w-xs"
        placeholder="Search memory (BM25 + vector hybrid)..."
        [value]="searchValue()"
        (input)="onSearchInput($event)"
        aria-label="Search memory entries"
      />
      <div
        role="tablist"
        aria-label="Memory tier filter"
        class="flex flex-wrap gap-1"
      >
        @for (chip of tierChips; track chip.id) {
          <button
            type="button"
            role="tab"
            class="btn btn-xs"
            [class.btn-primary]="tier() === chip.id"
            [class.btn-ghost]="tier() !== chip.id"
            [attr.aria-selected]="tier() === chip.id"
            (click)="tierChange.emit(chip.id)"
          >
            {{ chip.label }}
          </button>
        }
      </div>
      <div
        class="join md:ml-auto"
        role="tablist"
        aria-label="Memory workspace scope"
      >
        <button
          type="button"
          role="tab"
          class="join-item btn btn-sm"
          [class.btn-primary]="scope() === 'workspace'"
          [attr.aria-selected]="scope() === 'workspace'"
          (click)="scopeChange.emit('workspace')"
        >
          This workspace
        </button>
        <button
          type="button"
          role="tab"
          class="join-item btn btn-sm"
          [class.btn-primary]="scope() === 'all'"
          [attr.aria-selected]="scope() === 'all'"
          (click)="scopeChange.emit('all')"
        >
          All workspaces
        </button>
      </div>
    </div>
  `,
})
export class MemorySearchBarComponent {
  public readonly searchValue = input<string>('');
  public readonly tier = input.required<MemoryTierFilter>();
  public readonly scope = input.required<MemoryScopeFilter>();

  public readonly searchInput = output<string>();
  public readonly tierChange = output<MemoryTierFilter>();
  public readonly scopeChange = output<MemoryScopeFilter>();

  protected readonly tierChips: readonly TierChip[] = [
    { id: 'all', label: 'All' },
    { id: 'core', label: 'Core' },
    { id: 'recall', label: 'Recall' },
    { id: 'archival', label: 'Archival' },
  ];

  protected onSearchInput(event: Event): void {
    this.searchInput.emit((event.target as HTMLInputElement).value);
  }
}
