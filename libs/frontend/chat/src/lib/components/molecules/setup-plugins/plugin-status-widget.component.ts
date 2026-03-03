import {
  Component,
  OnInit,
  signal,
  inject,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, Puzzle, XCircle } from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { PluginInfo, PluginConfigState } from '@ptah-extension/shared';

/**
 * PluginStatusWidgetComponent - Plugin configuration status widget
 *
 * TASK_2025_153: Phase 6 - Frontend Components
 *
 * Complexity Level: 2 (Medium - RPC communication + signal state)
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
            <p class="text-[10px] text-base-content/60 leading-tight">
              {{ pluginCount() }}/{{ totalAvailable() }} enabled
            </p>
            } @else {
            <p class="text-[10px] text-base-content/60 leading-tight">
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
  private readonly rpcService = inject(ClaudeRpcService);

  /** Lucide icon references */
  protected readonly PuzzleIcon = Puzzle;
  protected readonly XCircleIcon = XCircle;

  /** Number of currently enabled plugins */
  readonly pluginCount = signal(0);

  /** Total number of available plugins */
  readonly totalAvailable = signal(0);

  /** Whether data is being loaded */
  readonly isLoading = signal(true);

  /** Error message if RPC calls fail */
  readonly error = signal<string | null>(null);

  /** Emitted when user clicks the Configure button */
  readonly configureClicked = output<void>();

  ngOnInit(): void {
    this.fetchPluginStatus();
  }

  /**
   * Fetch plugin configuration and available plugins from backend via RPC.
   * Public to allow template retry button access.
   */
  async fetchPluginStatus(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const [configResult, listResult] = await Promise.all([
        this.rpcService.call('plugins:get-config', {}, { timeout: 10000 }),
        this.rpcService.call('plugins:list-available', {}, { timeout: 10000 }),
      ]);

      if (listResult.isSuccess() && listResult.data) {
        this.totalAvailable.set(listResult.data.plugins.length);
      } else {
        this.totalAvailable.set(0);
      }

      if (configResult.isSuccess() && configResult.data) {
        this.pluginCount.set(configResult.data.enabledPluginIds.length);
      } else {
        this.pluginCount.set(0);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to load plugin status';
      this.error.set(errorMessage);
    } finally {
      this.isLoading.set(false);
    }
  }
}
