import type { CompactionMeasurement } from '@ptah-extension/shared';
import { SURFACE_ACTIVE } from '@ptah-extension/core';
import {
  inject,
  Component,
  computed,
  input,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, Archive, X } from 'lucide-angular';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';

@Component({
  selector: 'ptah-compaction-marker',
  standalone: true,
  imports: [LucideAngularModule, MarkdownBlockComponent],
  template: `
    <!-- Compact inline chip -->
    <div
      class="inline-flex items-center gap-1.5 my-2 px-2 py-0.5 rounded-full border border-base-300 bg-base-200/40 text-xs text-base-content-muted max-w-full"
    >
      <lucide-angular [img]="ArchiveIcon" class="w-3 h-3 flex-shrink-0" />
      <span class="font-medium text-base-content-muted">Context compacted</span>
      @if (tokenLine(); as line) {
        <span class="opacity-60 truncate">· {{ line }}</span>
      }
      @if (summary()) {
        <button
          type="button"
          class="btn btn-ghost btn-xs h-4 min-h-4 px-1 text-primary"
          (click)="open()"
        >
          View
        </button>
      }
    </div>

    <!-- Detail modal -->
    @if (summary(); as text) {
      <dialog class="modal" [class.modal-open]="isOpen()">
        <div class="modal-box max-w-2xl flex flex-col max-h-[80vh]">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <lucide-angular
                [img]="ArchiveIcon"
                class="w-4 h-4 text-primary"
                aria-hidden="true"
              />
              <span class="font-bold text-base">Context compacted</span>
            </div>
            <button
              class="btn btn-sm btn-circle btn-ghost"
              type="button"
              aria-label="Close compaction summary"
              (click)="close()"
            >
              <lucide-angular
                [img]="XIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
            </button>
          </div>

          @if (tokenLine(); as line) {
            <p class="text-xs text-base-content-muted mb-3">{{ line }}</p>
          }

          <div class="flex-1 overflow-y-auto text-sm pr-1">
            @if (isOpen()) {
              <ptah-markdown-block
                [active]="surfaceActive()"
                [content]="text"
              />
            }
          </div>
        </div>
        <div class="modal-backdrop" (click)="close()"></div>
      </dialog>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactionMarkerComponent {
  protected readonly surfaceActive = inject(SURFACE_ACTIVE);

  readonly summary = input<string | null>(null);
  readonly boundaryId = input<string | undefined>();
  readonly measurement = input<CompactionMeasurement | undefined>();
  readonly durationMs = input<number | null>(null);

  protected readonly ArchiveIcon = Archive;
  protected readonly XIcon = X;
  private readonly _isOpen = signal(false);
  protected readonly isOpen = this._isOpen.asReadonly();

  protected readonly tokenLine = computed<string | null>(() => {
    const pair = this.measurement();
    if (
      !pair ||
      pair.source !== 'sdk-compact-metadata' ||
      !pair.boundaryId ||
      pair.boundaryId !== this.boundaryId() ||
      !Number.isFinite(pair.preTokens) ||
      pair.preTokens < 0 ||
      !Number.isFinite(pair.postTokens) ||
      pair.postTokens < 0 ||
      pair.preTokens <= pair.postTokens
    )
      return null;
    const base = `shrank ${this.format(pair.preTokens)} \u2192 ${this.format(pair.postTokens)} tokens`;
    const ms = this.durationMs();
    if (ms === null) return base;
    return `${base} in ${this.formatDuration(ms)}`;
  });

  protected open(): void {
    this._isOpen.set(true);
  }

  protected close(): void {
    this._isOpen.set(false);
  }

  private format(value: number): string {
    return value.toLocaleString();
  }

  private formatDuration(ms: number): string {
    const seconds = ms / 1000;
    return `${Math.round(seconds * 10) / 10}s`;
  }
}
