import {
  Component,
  OnInit,
  signal,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  TabManagerService,
  isActiveWorkspaceTabSet,
} from '@ptah-extension/chat-state';

import {
  SetupGenerationWorkflow,
  SetupStatusGetResponse,
} from '@ptah-extension/shared';
import { LucideAngularModule, XCircle, FolderOpen } from 'lucide-angular';

import { SkeletonBlockComponent } from '../../atoms/skeleton-block.component';
import { GenerationWorkflowLauncherService } from '../../services/generation-workflow-launcher.service';

/**
 * SetupStatus type - Agent configuration status information
 * Uses the RPC response type directly for type safety
 */
export type SetupStatus = SetupStatusGetResponse;

/**
 * SetupStatusWidgetComponent - Agent configuration status widget
 *
 * Complexity Level: 2 (Medium - RPC communication + state management)
 * Patterns: Signal-based state, ClaudeRpcService, DaisyUI styling
 *
 * Features:
 * - Fetches agent setup status on component init via RPC
 * - Displays agent count and last modified timestamp
 * - Shows "Configure" or "Update" button based on configuration status
 * - Launches setup wizard via RPC method
 * - Handles loading, error, and success states
 *
 * SOLID Principles:
 * - Single Responsibility: Display agent setup status and launch wizard
 * - Open/Closed: Extensible via signals, closed for modification
 * - Dependency Inversion: Depends on ClaudeRpcService abstraction
 */
@Component({
  selector: 'ptah-setup-status-widget',
  standalone: true,
  imports: [LucideAngularModule, SkeletonBlockComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="border border-base-300 rounded-md bg-base-200/50 p-2.5">
      @if (isLoading()) {
        <!-- Compact loading skeleton -->
        <ptah-skeleton-block
          titleWidthClass="w-20"
          subtitleWidthClass="w-28"
          [showAction]="true"
        />
      } @else if (workspaceNotOpen()) {
        <!-- No workspace open — friendly prompt, no error styling -->
        <div class="flex items-center gap-2 text-base-content-muted">
          <lucide-angular [img]="FolderOpenIcon" class="shrink-0 w-4 h-4" />
          <span class="text-xs flex-1">Open a folder to configure agents</span>
          <button
            class="btn btn-xs btn-outline"
            (click)="openFolder()"
            type="button"
            aria-label="Open folder"
          >
            Open Folder
          </button>
        </div>
      } @else if (error()) {
        <!-- Compact error state -->
        <div class="flex items-center gap-2 text-error" role="alert">
          <lucide-angular [img]="XCircleIcon" class="shrink-0 w-4 h-4" />
          <span class="text-xs flex-1 truncate">{{ error() }}</span>
          <button
            class="btn btn-xs btn-ghost"
            (click)="fetchStatus()"
            type="button"
            aria-label="Retry"
          >
            Retry
          </button>
        </div>
      } @else if (status()) {
        <!-- Compact agent status -->
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <div
              class="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0"
            >
              <span class="text-xs">🤖</span>
            </div>
            <div>
              <h4 class="text-xs font-medium leading-tight">Claude Agents</h4>
              @if (status()!.isConfigured) {
                <p class="text-[10px] text-base-content-muted leading-tight">
                  {{ status()!.agentCount }} agent{{
                    status()!.agentCount !== 1 ? 's' : ''
                  }}
                  @if (status()!.lastUpdated) {
                    •
                    {{ formatRelativeTime(status()!.lastUpdated!) }}
                  }
                </p>
              } @else {
                <p class="text-[10px] text-base-content-muted leading-tight">
                  Not configured
                </p>
              }
            </div>
          </div>
          <button
            class="btn btn-primary btn-xs"
            [disabled]="launching()"
            (click)="launchWizard()"
            type="button"
          >
            @if (launching()) {
              <span class="loading loading-spinner loading-xs"></span>
            } @else {
              <span>{{ status()!.isConfigured ? 'Update' : 'Configure' }}</span>
            }
          </button>
        </div>
        <div class="mt-2 flex flex-wrap gap-1">
          <button
            class="btn btn-xs btn-outline"
            [disabled]="launching()"
            (click)="launchGeneration('setup-agent-generation')"
            type="button"
          >
            Generate agents
          </button>
          <button
            class="btn btn-xs btn-outline"
            [disabled]="launching()"
            (click)="launchGeneration('setup-project-prompt')"
            type="button"
          >
            Project guidance
          </button>
        </div>
        @if (launchError()) {
          <p class="mt-2 text-xs text-error" role="alert">
            {{ launchError() }}
          </p>
        }
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
export class SetupStatusWidgetComponent implements OnInit {
  private readonly vscode = inject(VSCodeService);
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly tabs = inject(TabManagerService);
  private readonly generationLauncher = inject(
    GenerationWorkflowLauncherService,
  );
  protected readonly XCircleIcon = XCircle;
  protected readonly FolderOpenIcon = FolderOpen;
  readonly status = signal<SetupStatus | null>(null);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly launchError = signal<string | null>(null);
  readonly launching = signal<boolean>(false);
  /** True when the backend reports no workspace folder is open. */
  readonly workspaceNotOpen = signal<boolean>(false);

  ngOnInit(): void {
    this.fetchStatus();
  }

  /**
   * Fetch agent setup status from backend via RPC
   * Public to allow template retry button access
   */
  async fetchStatus(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    this.workspaceNotOpen.set(false);

    try {
      const result = await this.rpcService.call(
        'setup-status:get-status',
        {},
        { timeout: 10000 },
      );

      if (result.isSuccess() && result.data) {
        this.status.set(result.data);
        this.error.set(null);
      } else if (result.errorCode === 'WORKSPACE_NOT_OPEN') {
        this.workspaceNotOpen.set(true);
      } else {
        this.error.set(result.error || 'Failed to fetch status');
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to fetch status';
      this.error.set(errorMessage);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Invoke the VS Code "Open Folder" dialog via the command:execute RPC so
   * users can open a workspace folder without leaving the extension.
   */
  async openFolder(): Promise<void> {
    await this.rpcService.call('command:execute', {
      command: 'workbench.action.files.openFolder',
    });
  }

  /**
   * Launch setup wizard via RPC
   */
  async launchWizard(): Promise<void> {
    this.launching.set(true);
    this.error.set(null); // Clear any previous errors

    try {
      const result = await this.rpcService.call(
        'setup-wizard:launch',
        {},
        { timeout: 5000 },
      );

      if (!result.isSuccess()) {
        this.error.set(
          result.error || 'Failed to launch wizard. Please try again.',
        );
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to launch wizard';
      this.error.set(errorMessage);
    } finally {
      this.launching.set(false);
    }
  }

  async launchGeneration(workflow: SetupGenerationWorkflow): Promise<void> {
    if (this.launching()) return;
    this.launching.set(true);
    this.launchError.set(null);

    try {
      const workspacePath =
        this.tabs.activeWorkspacePath ?? this.vscode.config().workspaceRoot;
      const result = isActiveWorkspaceTabSet(
        workspacePath,
        this.tabs.activeWorkspacePath,
        this.vscode.config().workspaceRoot,
        this.vscode.config().isVSCode,
      )
        ? await this.generationLauncher.open({
            workspacePath,
            workflow,
            origin: 'independent-start',
          })
        : { outcome: 'failed' as const };
      if (result.outcome === 'failed') {
        this.launchError.set('Could not open generation. Please try again.');
      }
    } catch {
      this.launchError.set('Could not open generation. Please try again.');
    } finally {
      this.launching.set(false);
    }
  }

  /**
   * Format ISO timestamp as relative time
   * Examples: "just now", "5 minutes ago", "2 hours ago", "3 days ago"
   */
  formatRelativeTime(isoString: string): string {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
      return 'unknown'; // Graceful fallback for invalid dates
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) {
      return 'just now';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else if (diffDays < 30) {
      return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString();
    }
  }
}
