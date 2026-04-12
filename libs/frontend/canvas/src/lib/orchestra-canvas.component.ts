import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  OnDestroy,
  inject,
  signal,
  ElementRef,
  HostListener,
} from '@angular/core';
import { GridStackOptions } from 'gridstack';
import {
  GridstackComponent,
  GridstackItemComponent,
  nodesCB,
} from 'gridstack/dist/angular';
import { LucideAngularModule, ArrowLeft, History } from 'lucide-angular';
import { AppStateManager } from '@ptah-extension/core';
import { ChatStore } from '@ptah-extension/chat';
import type { ChatSessionSummary } from '@ptah-extension/shared';
import { CanvasStore } from './canvas.store';
import { CanvasTileComponent } from './canvas-tile.component';

/**
 * OrchestraCanvasComponent — top-level panel for the Orchestra Canvas view.
 *
 * Each instance owns its own CanvasStore (via providers array), ensuring full
 * isolation between multiple canvas panels opened simultaneously.
 *
 * Layout: Gridstack.js drag-and-resize grid with one CanvasTileComponent per tile.
 * Fallback: If Gridstack encounters issues, the CSS Grid fallback (below) can be
 * restored; the architectural tile + store wiring remains identical.
 *
 * Gridstack API (v12.5.0):
 * - Component selector: <gridstack>
 * - Item selector: <gridstack-item [options]="{ x, y, w, h, id }">
 * - Change event: (changeCB) — fires after drag/resize; nodes carry updated positions
 * - Imports: GridstackComponent + GridstackItemComponent from 'gridstack/dist/angular'
 *
 * Risk 1 Mitigation: Each <ptah-canvas-tile> emits (focusRequested) which this
 * component routes to canvasStore.focusTile(). focusTile() calls
 * tabManager.switchTab(), updating global activeTabId BEFORE any message send.
 *
 * TASK_2025_265 Batch 3
 */
@Component({
  selector: 'ptah-orchestra-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CanvasStore],
  imports: [
    GridstackComponent,
    GridstackItemComponent,
    CanvasTileComponent,
    LucideAngularModule,
  ],
  template: `
    <div class="flex flex-col h-full bg-base-100">
      <!-- Toolbar -->
      <div
        class="flex items-center gap-2 px-3 py-2 border-b border-base-300 bg-base-200 shrink-0"
      >
        <button
          class="btn btn-ghost btn-xs gap-1.5"
          (click)="backToChat()"
          aria-label="Back to Chat"
        >
          <lucide-angular [img]="ArrowLeftIcon" class="w-3.5 h-3.5" />
          <span class="text-xs">Back</span>
        </button>
        <div class="w-px h-4 bg-base-content/10"></div>
        <span class="font-semibold text-sm text-base-content"
          >Orchestra Canvas</span
        >
        <span class="badge badge-sm badge-primary">{{
          canvasStore.tileCount()
        }}</span>
        <div class="ml-auto flex items-center gap-1">
          <button
            class="btn btn-xs btn-ghost gap-1"
            (click)="addSession()"
            aria-label="Add new session tile"
          >
            + Add Session
          </button>
          <div class="relative">
            <button
              class="btn btn-xs btn-ghost gap-1"
              (click)="toggleSessionPicker($event)"
              aria-label="Load previous session"
              aria-haspopup="listbox"
              [attr.aria-expanded]="showSessionPicker()"
            >
              <lucide-angular [img]="HistoryIcon" class="w-3.5 h-3.5" />
              <span class="text-xs">Load Session</span>
            </button>
            @if (showSessionPicker()) {
              <div
                class="absolute right-0 top-full mt-1 w-72 bg-base-100 border border-base-300 rounded-lg shadow-xl z-50 overflow-hidden"
                role="listbox"
                aria-label="Previous sessions"
              >
                @if (chatStore.sessions().length === 0) {
                  <div class="p-4 text-center text-sm text-base-content/50">
                    No previous sessions
                  </div>
                } @else {
                  <ul class="max-h-64 overflow-y-auto py-1">
                    @for (session of chatStore.sessions(); track session.id) {
                      <li>
                        <button
                          type="button"
                          class="flex flex-col items-start gap-0.5 w-full px-3 py-2 text-left hover:bg-base-200 transition-colors"
                          (click)="loadSession(session)"
                          role="option"
                          aria-selected="false"
                        >
                          <span
                            class="text-sm font-medium truncate w-full leading-snug"
                          >
                            {{ getSessionDisplayName(session) }}
                          </span>
                          <span
                            class="text-xs text-base-content/50 flex items-center gap-2"
                          >
                            <span>{{
                              formatRelativeDate(session.lastActivityAt)
                            }}</span>
                            @if (session.messageCount > 0) {
                              <span class="text-base-content/40"
                                >{{ session.messageCount }} msgs</span
                              >
                            }
                          </span>
                        </button>
                      </li>
                    }
                  </ul>
                  @if (chatStore.hasMoreSessions()) {
                    <div class="border-t border-base-300 p-1">
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs w-full"
                        [class.loading]="chatStore.isLoadingMoreSessions()"
                        (click)="loadMoreSessions($event)"
                      >
                        Load More
                      </button>
                    </div>
                  }
                }
              </div>
            }
          </div>
        </div>
      </div>

      <!-- Gridstack drag-and-resize grid -->
      <div class="flex-1 overflow-auto">
        <gridstack [options]="gsOptions" (changeCB)="onGridChange($event)">
          @for (tile of canvasStore.tiles(); track tile.tabId) {
            <gridstack-item
              [options]="{
                x: tile.position.x,
                y: tile.position.y,
                w: tile.position.w,
                h: tile.position.h,
                id: tile.tabId,
              }"
            >
              <ptah-canvas-tile
                [tabId]="tile.tabId"
                [focused]="canvasStore.focusedTabId() === tile.tabId"
                (focusRequested)="canvasStore.focusTile($event)"
                (closeRequested)="canvasStore.removeTile($event)"
              />
            </gridstack-item>
          }
        </gridstack>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      gridstack {
        min-height: 200px;
      }
    `,
  ],
})
export class OrchestraCanvasComponent implements OnInit, OnDestroy {
  readonly canvasStore = inject(CanvasStore);
  readonly chatStore = inject(ChatStore);
  private readonly appState = inject(AppStateManager);
  private readonly elRef = inject(ElementRef);

  readonly ArrowLeftIcon = ArrowLeft;
  readonly HistoryIcon = History;

  readonly showSessionPicker = signal(false);

  private static readonly UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /**
   * Gridstack grid configuration.
   * - column: 12-column grid (standard dashboard grid)
   * - cellHeight: 80px per row unit
   * - float: true allows free placement without auto-compaction
   * - margin: gap between tiles
   */
  readonly gsOptions: GridStackOptions = {
    column: 12,
    cellHeight: 80,
    float: true,
    margin: 8,
    resizable: { handles: 'e, se, s, sw, w' },
    animate: true,
  };

  ngOnInit(): void {
    // Seed one tile when the canvas opens empty so the user sees something immediately.
    if (this.canvasStore.tileCount() === 0) {
      this.canvasStore.addTile();
    }
  }

  /**
   * FIX 5: Close all tiles on destroy to prevent orphaned tabs in the root TabManagerService.
   * CanvasStore is scoped per component instance, so its tabs must be cleaned up here.
   */
  ngOnDestroy(): void {
    const tiles = this.canvasStore.tiles();
    tiles.forEach((tile) => this.canvasStore.removeTile(tile.tabId));
  }

  backToChat(): void {
    this.appState.setCurrentView('chat');
  }

  addSession(): void {
    this.canvasStore.addTile();
  }

  toggleSessionPicker(event: Event): void {
    event.stopPropagation();
    this.showSessionPicker.update((v) => !v);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (
      this.showSessionPicker() &&
      !this.elRef.nativeElement.contains(event.target)
    ) {
      this.showSessionPicker.set(false);
    }
  }

  loadSession(session: ChatSessionSummary): void {
    this.showSessionPicker.set(false);
    const tabId = this.canvasStore.addTileFromSession(session.id, session.name);
    if (tabId) {
      this.chatStore.switchSession(session.id);
    }
  }

  loadMoreSessions(event: Event): void {
    event.stopPropagation();
    this.chatStore.loadMoreSessions();
  }

  getSessionDisplayName(session: ChatSessionSummary): string {
    if (OrchestraCanvasComponent.UUID_PATTERN.test(session.name)) {
      return `Session ${session.name.substring(0, 8)}...`;
    }
    return session.name;
  }

  formatRelativeDate(date: Date | string | number): string {
    if (!date || (typeof date === 'number' && date <= 0)) return '';
    const now = new Date();
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    const diffMs = now.getTime() - d.getTime();
    if (diffMs < 0) return 'Just now';
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays < 7) {
      return d.toLocaleDateString('en-US', { weekday: 'short' });
    }
    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  /**
   * Called by Gridstack whenever tiles are moved or resized.
   * Persists the new position into CanvasStore so positions survive re-renders.
   *
   * GridStackNode.id is set to tile.tabId in the item options above, so we can
   * correlate each changed node back to the correct CanvasTile.
   */
  onGridChange(data: nodesCB): void {
    for (const node of data.nodes) {
      if (node.id == null) continue;
      this.canvasStore.updateTilePosition(node.id, {
        x: node.x ?? 0,
        y: node.y ?? 0,
        w: node.w ?? 4,
        h: node.h ?? 6,
      });
    }
  }
}
