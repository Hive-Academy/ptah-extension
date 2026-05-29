import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppStateManager } from '@ptah-extension/core';
import type { CorpusBuildParams, MemoryTypeWire } from '@ptah-extension/shared';

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
 * CorpusBuildDialogComponent
 *
 * Modal form that captures {@link CorpusBuildParams} for a new corpus.
 * Emits `submit` with the assembled params (parent runs `corpus:build`)
 * or `cancel` when the user dismisses the dialog. Workspace scope is
 * derived from `AppStateManager` and toggled via the "Workspace only"
 * checkbox.
 */
@Component({
  selector: 'ptah-corpus-build-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="corpus-build-title"
      class="modal modal-open"
    >
      <div class="modal-box max-w-xl">
        <h3 id="corpus-build-title" class="text-lg font-semibold">
          Build new corpus
        </h3>

        <div class="mt-3 flex flex-col gap-3">
          <label class="form-control">
            <span class="label-text text-xs uppercase">Name</span>
            <input
              type="text"
              class="input input-sm input-bordered"
              [value]="name()"
              (input)="onNameInput($event)"
              placeholder="auth-system"
              aria-label="Corpus name"
            />
          </label>

          <div
            role="group"
            aria-label="Memory type filter"
            class="flex flex-wrap gap-1"
          >
            @for (chip of typeChips; track chip.id) {
              <button
                type="button"
                class="btn btn-xs"
                [class.btn-primary]="typeFilter().includes(chip.id)"
                [class.btn-ghost]="!typeFilter().includes(chip.id)"
                [attr.aria-pressed]="typeFilter().includes(chip.id)"
                (click)="onTypeToggle(chip.id)"
              >
                {{ chip.label }}
              </button>
            }
          </div>

          <label class="form-control">
            <span class="label-text text-xs uppercase">
              Concepts (comma-separated)
            </span>
            <input
              type="text"
              class="input input-sm input-bordered"
              [value]="concepts()"
              (input)="onConceptsInput($event)"
              aria-label="Comma-separated concepts"
            />
          </label>

          <label class="form-control">
            <span class="label-text text-xs uppercase">
              Files (comma-separated)
            </span>
            <input
              type="text"
              class="input input-sm input-bordered"
              [value]="files()"
              (input)="onFilesInput($event)"
              aria-label="Comma-separated files"
            />
          </label>

          <label class="form-control">
            <span class="label-text text-xs uppercase">Query (optional)</span>
            <input
              type="text"
              class="input input-sm input-bordered"
              [value]="query()"
              (input)="onQueryInput($event)"
              aria-label="Optional search query"
            />
          </label>

          <label class="form-control">
            <span class="label-text text-xs uppercase">Limit</span>
            <input
              type="number"
              min="1"
              max="500"
              class="input input-sm input-bordered"
              [value]="limit()"
              (input)="onLimitInput($event)"
              aria-label="Corpus row limit"
            />
          </label>

          <label class="label cursor-pointer justify-start gap-2">
            <input
              type="checkbox"
              class="checkbox checkbox-sm"
              [checked]="workspaceOnly()"
              (change)="onWorkspaceToggle($event)"
              aria-label="Scope to current workspace"
            />
            <span class="text-sm">Scope to current workspace</span>
          </label>
        </div>

        <div class="modal-action mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            (click)="onCancel()"
            aria-label="Cancel build"
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            [disabled]="!canSubmit()"
            (click)="onSubmit()"
            aria-label="Submit corpus build"
          >
            Build
          </button>
        </div>
      </div>
    </div>
  `,
})
export class CorpusBuildDialogComponent {
  private readonly appState = inject(AppStateManager);
  public readonly submitParams = output<CorpusBuildParams>();
  public readonly cancelDialog = output<void>();

  protected readonly typeChips = TYPE_CHIPS;
  protected readonly name = signal<string>('');
  protected readonly typeFilter = signal<readonly MemoryTypeWire[]>([]);
  protected readonly concepts = signal<string>('');
  protected readonly files = signal<string>('');
  protected readonly query = signal<string>('');
  protected readonly limit = signal<number>(100);
  protected readonly workspaceOnly = signal<boolean>(true);

  protected readonly canSubmit = computed(() => this.name().trim().length > 0);

  protected onNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected onTypeToggle(id: MemoryTypeWire): void {
    const current = this.typeFilter();
    this.typeFilter.set(
      current.includes(id) ? current.filter((t) => t !== id) : [...current, id],
    );
  }

  protected onConceptsInput(event: Event): void {
    this.concepts.set((event.target as HTMLInputElement).value);
  }

  protected onFilesInput(event: Event): void {
    this.files.set((event.target as HTMLInputElement).value);
  }

  protected onQueryInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected onLimitInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value) && value > 0) {
      this.limit.set(value);
    }
  }

  protected onWorkspaceToggle(event: Event): void {
    this.workspaceOnly.set((event.target as HTMLInputElement).checked);
  }

  protected onCancel(): void {
    this.cancelDialog.emit();
  }

  protected onSubmit(): void {
    if (!this.canSubmit()) return;
    const concepts = splitTokens(this.concepts());
    const files = splitTokens(this.files());
    const query = this.query().trim();
    const type = this.typeFilter();
    const workspaceRoot = this.workspaceOnly()
      ? (this.appState.workspaceInfo()?.path ?? null)
      : null;
    const params: CorpusBuildParams = {
      name: this.name().trim(),
      limit: this.limit(),
      ...(workspaceRoot !== null ? { workspaceRoot } : {}),
      ...(type.length > 0 ? { type } : {}),
      ...(concepts.length > 0 ? { concepts } : {}),
      ...(files.length > 0 ? { files } : {}),
      ...(query.length > 0 ? { query } : {}),
    };
    this.submitParams.emit(params);
  }
}

function splitTokens(raw: string): readonly string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}
