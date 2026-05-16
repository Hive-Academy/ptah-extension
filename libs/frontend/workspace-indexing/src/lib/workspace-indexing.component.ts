/**
 * WorkspaceIndexingComponent — Settings panel for the workspace-indexing
 * feature.
 *
 * Renders all 6 backend states (`never-indexed`, `indexing`, `paused`,
 * `indexed`, `stale`, `error`) plus two pseudo-states (`loading`,
 * `no-workspace`) and the always-visible per-pipeline toggle row.
 *
 * Architecture:
 *  - `OnPush` change detection (signals do the work).
 *  - State sourced from `WorkspaceIndexingService.uiState` (computed signal).
 *  - Workspace root sourced from `AppStateManager.workspaceInfo()`.
 *  - No backend imports — all wire types come from `@ptah-extension/shared`.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
} from '@angular/core';
import {
  LucideAngularModule,
  Play,
  Pause,
  X,
  RefreshCw,
  BellOff,
  Clipboard,
  Code,
  Brain,
} from 'lucide-angular';
import { AppStateManager } from '@ptah-extension/core';
import type { IndexingPipeline } from '@ptah-extension/shared';
import { WorkspaceIndexingService } from './workspace-indexing.service';

@Component({
  selector: 'ptah-workspace-indexing',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workspace-indexing.component.html',
  styleUrl: './workspace-indexing.component.scss',
})
export class WorkspaceIndexingComponent {
  private readonly service = inject(WorkspaceIndexingService);
  private readonly appState = inject(AppStateManager);

  // --- Signals exposed to template ----------------------------------------

  readonly uiState = this.service.uiState;
  readonly status = this.service.status;
  readonly progress = this.service.progress;

  /** Workspace root from global app state (null = no workspace open). */
  readonly workspaceRoot = computed<string | null>(
    () => this.appState.workspaceInfo()?.path ?? null,
  );

  /** Whether the current pipeline toggles are enabled. */
  readonly symbolsEnabled = computed(
    () => this.status()?.symbolsEnabled ?? true,
  );
  readonly memoryEnabled = computed(() => this.status()?.memoryEnabled ?? true);

  /**
   * Whether to show the privacy disclosure callout. Per the UX spec the
   * callout is shown on first run AND remains accessible via the permanent
   * "About indexing" link — which is rendered unconditionally below the
   * primary state. Returns true when the user has never acknowledged.
   */
  readonly showFirstRunDisclosure = computed(
    () => this.status()?.disclosureAcknowledgedAt === null,
  );

  // --- Lucide icon handles (per UX Spec) -----------------------------------

  readonly PlayIcon = Play;
  readonly PauseIcon = Pause;
  readonly XIcon = X;
  readonly RefreshCwIcon = RefreshCw;
  readonly BellOffIcon = BellOff;
  readonly ClipboardIcon = Clipboard;
  readonly CodeIcon = Code;
  readonly BrainIcon = Brain;

  constructor() {
    // React to workspace changes — refresh status whenever the workspace path
    // changes after the component is alive. ngOnInit handles the very first
    // load; this effect handles workspace switches while the panel is open.
    effect(() => {
      const root = this.workspaceRoot();
      if (root) {
        this.service.setWorkspaceAvailability(true);
        // Fire-and-forget; failure surfaces via the service's null status.
        void this.service.loadStatus(root);
      } else {
        this.service.setWorkspaceAvailability(false);
      }
    });
  }

  // --- Action handlers -----------------------------------------------------

  async onStart(force = false): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) return;
    await this.service.start(root, force);
  }

  async onPause(): Promise<void> {
    const root = this.workspaceRoot();
    await this.service.pause(root ?? undefined);
  }

  async onResume(): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) return;
    await this.service.resume(root);
  }

  async onCancel(): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) return;
    await this.service.cancel(root);
  }

  async onTogglePipeline(
    pipeline: IndexingPipeline,
    next: boolean,
  ): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) return;
    await this.service.setPipelineEnabled(pipeline, next, root);
  }

  async onDismissStale(): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) return;
    await this.service.dismissStale(root);
  }

  async onAcknowledgeDisclosure(): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) return;
    await this.service.acknowledgeDisclosure(root);
  }

  // --- Error-detail copy helper -------------------------------------------

  async onCopyErrorDetails(message: string): Promise<void> {
    if (!message) return;
    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(message);
      } catch {
        // Clipboard write can fail in restricted webview contexts — silently
        // ignore; the error string remains on screen for manual copy.
      }
    }
  }

  // --- Display helpers used by the template ------------------------------

  /** Compact relative time formatter — e.g. "2 minutes ago". */
  formatRelativeTime(epochMs: number | null): string {
    if (!epochMs) return 'just now';
    const deltaMs = Date.now() - epochMs;
    if (deltaMs < 60_000) return 'just now';
    const minutes = Math.floor(deltaMs / 60_000);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  /** Truncates a 40-char SHA to the first 7 chars for display. */
  shortSha(sha: string | null): string {
    if (!sha) return '—';
    return sha.slice(0, 7);
  }
}
