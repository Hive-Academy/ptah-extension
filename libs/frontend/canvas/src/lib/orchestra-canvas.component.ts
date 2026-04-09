import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
} from '@angular/core';
import { CanvasStore } from './canvas.store';

/**
 * OrchestraCanvasComponent — the top-level panel for the Orchestra Canvas view.
 *
 * Each instance of this component owns its own CanvasStore (via providers array),
 * so opening multiple canvas panels yields fully isolated tile sets.
 *
 * This is the initial CSS-Grid-based version (Batch 2 scaffold).
 * Gridstack integration and CanvasTileComponent will be wired in Batch 3.
 *
 * TASK_2025_265 Batch 2
 */
@Component({
  selector: 'ptah-orchestra-canvas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CanvasStore],
  imports: [],
  template: `
    <div class="flex flex-col h-full bg-base-100">
      <!-- Toolbar -->
      <div
        class="flex items-center gap-2 px-3 py-2 border-b border-base-300 bg-base-200"
      >
        <span class="font-semibold text-sm">Orchestra Canvas</span>
        <span class="badge badge-sm badge-primary">{{
          canvasStore.tileCount()
        }}</span>
        <button
          class="btn btn-xs btn-ghost ml-auto gap-1"
          (click)="addSession()"
          aria-label="Add session tile"
        >
          + Add Session
        </button>
      </div>

      <!-- CSS Grid fallback layout (replaced by Gridstack in Batch 3) -->
      <div
        class="flex-1 overflow-auto p-3 grid gap-3"
        style="grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); grid-auto-rows: 480px;"
      >
        @for (tile of canvasStore.tiles(); track tile.tabId) {
          <!--
            Placeholder tile — CanvasTileComponent (ptah-canvas-tile) will replace this
            div in Batch 3 (Task 3.1). The data-tab-id attribute allows Batch 3 to
            verify tile identity during the migration.
          -->
          <div
            class="border border-base-300 rounded-lg overflow-hidden flex items-center justify-center text-base-content/40 text-sm"
            [attr.data-tab-id]="tile.tabId"
          >
            Tab: {{ tile.tabId }}
          </div>
        }
      </div>
    </div>
  `,
})
export class OrchestraCanvasComponent implements OnInit {
  readonly canvasStore = inject(CanvasStore);

  ngOnInit(): void {
    // Seed one tile when the canvas opens empty so the user sees something immediately.
    if (this.canvasStore.tileCount() === 0) {
      this.canvasStore.addTile();
    }
  }

  addSession(): void {
    this.canvasStore.addTile();
  }
}
