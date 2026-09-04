/**
 * UpdateDialogComponent
 *
 * Modal dialog that surfaces a newer desktop release to the user. Reads state
 * from `UpdateDialogService` (signal-driven) and exposes:
 *   - "Download" → opens the platform installer (or release page) in the browser
 *     via an external anchor, mirroring the landing-page download route, and
 *     records the version so no later check prompts for it again.
 *   - "Later"    → closes the dialog. The next check re-opens it, so the prompt
 *     repeats until the user downloads the release.
 *
 * Only the `available` state opens the dialog. A failed update *check* is not
 * user-actionable — being offline, behind a proxy, or over the GitHub rate
 * limit all produce it — so `UpdateManager` logs that failure in the main
 * process and this component renders nothing for it.
 *
 * Electron-only: the entire template is wrapped in
 * `@if (isElectron() && dialogOpen())` so the component renders zero DOM
 * inside the VS Code webview surface.
 *
 * Release notes are routed through `<ptah-markdown-block>` so the
 * `libs/frontend/markdown` DOMPurify chokepoint sanitizes the GitHub
 * release body. `[innerHTML]` is FORBIDDEN.
 *
 * The daisyUI `modal-open` class drives visibility rather than
 * `HTMLDialogElement.showModal()`, matching `ptah-confirmation-dialog`. That
 * keeps the dialog out of the browser top layer, where it would compete with
 * the native file-ops dialogs the Electron e2e specs guard.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import { UpdateDialogService } from './update-dialog.service';

@Component({
  selector: 'ptah-update-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MarkdownBlockComponent],
  template: `
    @if (isElectron() && dialogOpen()) {
      <dialog class="modal modal-open" data-testid="update-dialog">
        <div class="modal-box max-w-lg">
          <h3 class="font-bold text-lg">Update available</h3>
          <p class="pt-1 text-sm text-base-content-muted">
            <span class="font-mono">{{ versionDelta() }}</span>
          </p>

          @if (releaseNotesMarkdown(); as notes) {
            <div class="mt-4 max-h-64 overflow-auto text-sm">
              <ptah-markdown-block [content]="notes" />
            </div>
          } @else if (newVersion(); as v) {
            <a
              class="link link-primary text-sm mt-4 inline-block"
              [href]="releaseNotesUrl(v)"
              target="_blank"
              rel="noopener"
              >View release notes</a
            >
          }

          <div class="modal-action">
            <button
              type="button"
              class="btn btn-ghost"
              (click)="dialogService.dismiss()"
            >
              Later
            </button>
            <a
              data-testid="update-download"
              class="btn btn-primary"
              [href]="downloadHref()"
              target="_blank"
              rel="noopener"
              (click)="onDownload()"
            >
              Download
            </a>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button type="button" (click)="dialogService.dismiss()">close</button>
        </form>
      </dialog>
    }
  `,
})
export class UpdateDialogComponent {
  protected readonly dialogService = inject(UpdateDialogService);
  private readonly vscodeService = inject(VSCodeService);

  /** Electron-only gate — VS Code webview renders zero DOM. */
  readonly isElectron = computed(() => this.vscodeService.isElectron);

  readonly state = computed(() => this.dialogService.state());

  readonly dialogOpen = computed(() => this.state().state === 'available');

  readonly versionDelta = computed(() => {
    const s = this.state();
    return s.state === 'available'
      ? `${s.currentVersion} → ${s.newVersion}`
      : '';
  });

  readonly newVersion = computed(() => {
    const s = this.state();
    return s.state === 'available' ? s.newVersion : null;
  });

  readonly releaseNotesMarkdown = computed(() => {
    const s = this.state();
    if (s.state === 'available') {
      const notes = s.releaseNotesMarkdown;
      return notes && notes.trim().length > 0 ? notes : null;
    }
    return null;
  });

  readonly downloadHref = computed(() => {
    const s = this.state();
    return s.state === 'available' ? (s.downloadUrl ?? s.releaseUrl) : '';
  });

  /**
   * Record the download, then let the anchor navigate. No `preventDefault` —
   * the browser still opens the installer URL.
   */
  protected onDownload(): void {
    const version = this.newVersion();
    if (version) {
      void this.dialogService.markDownloaded(version);
    }
  }

  releaseNotesUrl(version: string): string {
    return `https://github.com/Hive-Academy/ptah-extension/releases/tag/electron-v${version}`;
  }
}
