import {
  Component,
  OnInit,
  inject,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, Puzzle, XCircle } from 'lucide-angular';
import { PluginCatalogService } from '@ptah-extension/core';

/**
 * PluginStatusWidgetComponent - Plugin configuration status widget
 *
 * Patterns: Signal-based state, ClaudeRpcService, DaisyUI styling
 *
 * Features:
 * - Fetches plugin config and available plugins on init via RPC
 * - Displays enabled plugin count vs total available
 * - Shows "Configure" button that emits event to parent
 * - Handles loading, error, and success states
 *
 * SOLID Principles:
 * - Single Responsibility: Display plugin status and emit configure action
 * - Open/Closed: Extensible via output event, closed for modification
 * - Dependency Inversion: Depends on ClaudeRpcService abstraction
 */
@Component({
  selector: 'ptah-plugin-status-widget',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="border border-base-300 rounded-md bg-base-200/50 p-2.5">
      @if (isLoading()) {
        <!-- Compact loading skeleton -->
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 flex-1">
            <div class="skeleton w-6 h-6 rounded-full shrink-0"></div>
            <div class="flex-1">
              <div class="skeleton h-3 w-16 mb-1"></div>
              <div class="skeleton h-2 w-24"></div>
            </div>
          </div>
          <div class="skeleton h-6 w-16"></div>
        </div>
      } @else if (error()) {
        <!-- Compact error state -->
        <div class="flex items-center gap-2 text-error">
          <lucide-angular
            [img]="XCircleIcon"
            class="shrink-0 w-4 h-4"
            aria-hidden="true"
          />
          <span class="text-xs flex-1 truncate">{{ error() }}</span>
          <button
            class="btn btn-xs btn-ghost"
            (click)="fetchPluginStatus()"
            type="button"
            aria-label="Retry loading plugin status"
          >
            Retry
          </button>
        </div>
      } @else {
        <!-- Compact plugin status -->
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <div
              class="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0"
            >
              <lucide-angular
                [img]="PuzzleIcon"
                class="w-3.5 h-3.5 text-primary"
                aria-hidden="true"
              />
            </div>
            <div>
              <h4 class="text-xs font-medium leading-tight">Plugins</h4>
              @if (pluginCount() > 0) {
                <p class="text-[10px] text-base-content-muted leading-tight">
                  {{ pluginCount() }}/{{ totalAvailable() }} enabled
                </p>
              } @else {
                <p class="text-[10px] text-base-content-muted leading-tight">
                  Not configured
                </p>
              }
            </div>
          </div>
          <button
            class="btn btn-xs btn-ghost btn-secondary"
            (click)="configureClicked.emit()"
            type="button"
            aria-label="Configure plugins"
          >
            Configure
          </button>
        </div>
      }
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
export class PluginStatusWidgetComponent implements OnInit {
  /**
   * The shared catalog, not a private fetch (TASK_2026_345).
   *
   * This widget is mounted PER TRANSCRIPT inside the chat empty state and again
   * on the Marketplace plugins surface, and the plugin browser modal sits
   * beside it in both. Every instance used to issue its own
   * `plugins:get-config` + `plugins:list-available` pair on `ngOnInit`, which is
   * where the repeated pairs in `tmp/logs/log.log:978-993` came from. The store
   * dedupes them into one round trip; nothing else about this component
   * changed.
   */
  private readonly catalog = inject(PluginCatalogService);

  /** Lucide icon references */
  protected readonly PuzzleIcon = Puzzle;
  protected readonly XCircleIcon = XCircle;

  /** Number of currently enabled plugins */
  readonly pluginCount = this.catalog.enabledCount;

  /** Total number of available plugins */
  readonly totalAvailable = this.catalog.pluginTotal;

  /** Whether data is being loaded */
  readonly isLoading = this.catalog.isLoading;

  /** Error message if the catalog read failed */
  readonly error = this.catalog.error;

  /** Emitted when user clicks the Configure button */
  readonly configureClicked = output<void>();

  ngOnInit(): void {
    void this.catalog.ensureLoaded();
  }

  /**
   * Re-read the catalog from the backend.
   *
   * Public because the template's Retry button and every parent that just saved
   * a plugin change call it. Unlike `ensureLoaded` this always goes to the host
   * — it exists precisely for the cases where the cached answer is known to be
   * stale.
   */
  async fetchPluginStatus(): Promise<void> {
    await this.catalog.refresh();
  }
}
