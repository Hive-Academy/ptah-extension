/**
 * UpdateBannerComponent — TASK_2026_117
 *
 * Sticky top-bar that surfaces the Electron auto-update lifecycle to the
 * user. Reads state from `UpdateBannerService` (signal-driven) and exposes
 * two actions:
 *   - "Restart Now" → fires `update:install-now` RPC (with active-agent
 *     warn-and-confirm flow via `ConfirmationDialogService`).
 *   - "Later"        → dismisses the banner until the next actionable state.
 *
 * Electron-only: the entire template is wrapped in
 * `@if (isElectron() && bannerVisible())` so the component renders zero DOM
 * inside the VS Code webview surface.
 *
 * Release notes are routed through `<ptah-markdown-block>` so the
 * `libs/frontend/markdown` DOMPurify chokepoint sanitizes the GitHub
 * release body. `[innerHTML]` is FORBIDDEN.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  ConfirmationDialogService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import { UpdateBannerService } from './update-banner.service';

const ACTIONABLE_STATES = new Set([
  'available',
  'downloading',
  'downloaded',
  'error',
]);

@Component({
  selector: 'ptah-update-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MarkdownBlockComponent],
  template: `
    @if (isElectron() && bannerVisible()) {
      <div
        data-testid="update-banner"
        class="sticky top-0 z-50 w-full bg-base-200 border-b border-base-300 shadow-sm"
        role="status"
        aria-live="polite"
      >
        <div class="flex items-start gap-3 px-4 py-2 max-w-full">
          <div class="flex-1 min-w-0">
            @switch (state().state) {
              @case ('available') {
                <div class="text-sm font-medium">
                  Update available:
                  <span class="font-mono">{{ versionDelta() }}</span>
                </div>
                @if (releaseNotesMarkdown(); as notes) {
                  <div class="mt-1 text-xs opacity-80 max-h-32 overflow-auto">
                    <ptah-markdown-block [content]="notes" />
                  </div>
                } @else if (newVersion(); as v) {
                  <a
                    class="link link-primary text-xs"
                    [href]="releaseNotesUrl(v)"
                    target="_blank"
                    rel="noopener"
                    >View release notes</a
                  >
                }
              }
              @case ('downloading') {
                <div class="text-sm font-medium">
                  Downloading update:
                  <span class="font-mono">{{ versionDelta() }}</span>
                  <span class="ml-2 opacity-70">{{ downloadPercent() }}%</span>
                </div>
                <progress
                  class="progress progress-primary w-full mt-1 h-1.5"
                  [value]="downloadPercent()"
                  max="100"
                ></progress>
              }
              @case ('downloaded') {
                <div class="text-sm font-medium">
                  Update downloaded:
                  <span class="font-mono">{{ versionDelta() }}</span>
                  <span class="ml-2 opacity-70">Restart to apply.</span>
                </div>
                @if (releaseNotesMarkdown(); as notes) {
                  <div class="mt-1 text-xs opacity-80 max-h-32 overflow-auto">
                    <ptah-markdown-block [content]="notes" />
                  </div>
                } @else if (newVersion(); as v) {
                  <a
                    class="link link-primary text-xs"
                    [href]="releaseNotesUrl(v)"
                    target="_blank"
                    rel="noopener"
                    >View release notes</a
                  >
                }
              }
              @case ('error') {
                <div class="text-sm font-medium text-error">Update failed</div>
                <div class="text-xs opacity-80">{{ errorMessage() }}</div>
              }
            }
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              class="btn btn-primary btn-xs"
              [disabled]="!restartEnabled()"
              (click)="handleRestartNow()"
            >
              Restart Now
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              (click)="bannerService.dismiss()"
            >
              Later
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class UpdateBannerComponent {
  protected readonly bannerService = inject(UpdateBannerService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly tabManager = inject(TabManagerService);
  private readonly confirmationDialog = inject(ConfirmationDialogService);

  /** Electron-only gate — VS Code webview renders zero DOM. */
  readonly isElectron = computed(() => this.vscodeService.isElectron);

  readonly state = computed(() => this.bannerService.state());

  readonly bannerVisible = computed(() =>
    ACTIONABLE_STATES.has(this.state().state),
  );

  /**
   * In-flight guard for the `update:install-now` RPC. Prevents a rapid
   * double-click from issuing two concurrent `quitAndInstall()` calls — see
   * code-logic-review.md Failure Mode 4 / Serious Issue #3.
   */
  private readonly _installInFlight = signal(false);

  readonly restartEnabled = computed(
    () => this.state().state === 'downloaded' && !this._installInFlight(),
  );

  readonly hasActiveAgent = computed(
    () => this.tabManager.streamingTabIds().size > 0,
  );

  readonly versionDelta = computed(() => {
    const s = this.state();
    if (
      s.state === 'available' ||
      s.state === 'downloading' ||
      s.state === 'downloaded'
    ) {
      return `${s.currentVersion} → ${s.newVersion}`;
    }
    return '';
  });

  readonly newVersion = computed(() => {
    const s = this.state();
    if (
      s.state === 'available' ||
      s.state === 'downloading' ||
      s.state === 'downloaded'
    ) {
      return s.newVersion;
    }
    return null;
  });

  readonly releaseNotesMarkdown = computed(() => {
    const s = this.state();
    if (s.state === 'available' || s.state === 'downloaded') {
      const notes = s.releaseNotesMarkdown;
      return notes && notes.trim().length > 0 ? notes : null;
    }
    return null;
  });

  readonly downloadPercent = computed(() => {
    const s = this.state();
    return s.state === 'downloading' ? Math.round(s.percent) : 0;
  });

  readonly errorMessage = computed(() => {
    const s = this.state();
    return s.state === 'error' ? s.message : '';
  });

  releaseNotesUrl(version: string): string {
    return `https://github.com/hive-academy/ptah-extension/releases/tag/v${version}`;
  }

  async handleRestartNow(): Promise<void> {
    if (this.hasActiveAgent()) {
      const confirmed = await this.confirmationDialog.confirm({
        title: 'Restart with active agent?',
        message:
          'An agent is currently running. Quitting now will interrupt it. Are you sure you want to restart?',
        confirmLabel: 'Restart',
        cancelLabel: 'Cancel',
        confirmStyle: 'warning',
      });
      if (!confirmed) {
        // Cancel path — do NOT set the in-flight flag; the RPC is skipped.
        return;
      }
    }

    // Set the in-flight guard AFTER any confirmation has been accepted (or
    // skipped because no active agent). The button's `restartEnabled`
    // computed factors this in, so a rapid second click finds the button
    // disabled and is dropped by Angular.
    this._installInFlight.set(true);
    try {
      await this.rpcService.call('update:install-now', {});
    } catch (err) {
      // Non-fatal — main process will log; keep banner visible so the user
      // can retry. Avoid surfacing raw error.message in production UI.
      console.error('[UpdateBanner] update:install-now failed', err);
    } finally {
      // Re-enable the button. In the happy path the app is quitting and the
      // UI is about to be torn down; this matters when the RPC rejects (e.g.
      // Windows elevation failure) and the app stays alive.
      this._installInFlight.set(false);
    }
  }
}
