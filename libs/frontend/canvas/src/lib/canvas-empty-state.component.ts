import {
  Component,
  ChangeDetectionStrategy,
  inject,
  output,
} from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { LucideAngularModule, Plus } from 'lucide-angular';
import { VSCodeService } from '@ptah-extension/core';

/**
 * CanvasEmptyStateComponent - Centered empty state for the Orchestra Canvas.
 *
 * Shown when the canvas has no tiles. Displays a Ptah icon, heading,
 * description, and a prominent "New Session" CTA button. Emits
 * `createSession` when the user clicks the button.
 *
 * Complexity Level: 1 (Simple - no state, single responsibility)
 * Patterns: Standalone, OnPush, Lucide icons, signal output
 *
 * TASK_2025_272 Batch 2
 */
@Component({
  selector: 'ptah-canvas-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule, NgOptimizedImage],
  template: `
    <div
      class="flex flex-col items-center justify-center h-full p-8 text-center"
    >
      <img
        [ngSrc]="ptahIconUri"
        alt="Ptah"
        class="w-16 h-16 mb-4 opacity-60"
        width="64"
        height="64"
      />
      <h2 class="text-lg font-semibold text-base-content/70 mb-2">
        Orchestra Canvas
      </h2>
      <p class="text-sm text-base-content/50 mb-6 max-w-sm">
        Open multiple AI sessions side by side. Each tile runs independently
        with its own context.
      </p>
      <button
        class="btn btn-primary gap-2"
        aria-label="Create new session"
        (click)="createSession.emit()"
      >
        <lucide-angular [img]="PlusIcon" class="w-4 h-4" />
        New Session
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
export class CanvasEmptyStateComponent {
  readonly createSession = output<void>();

  protected readonly PlusIcon = Plus;
  protected readonly ptahIconUri = inject(VSCodeService).getPtahIconUri();
}
