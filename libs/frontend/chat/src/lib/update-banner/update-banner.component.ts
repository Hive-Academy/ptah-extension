/**
 * UpdateBannerComponent
 *
 * Sticky top-bar that surfaces a newer desktop release to the user. Reads state
 * from `UpdateBannerService` (signal-driven) and exposes:
 *   - "Download" → opens the platform installer (or release page) in the browser
 *     via an external anchor, mirroring the landing-page download route.
 *   - "Later"    → dismisses the banner until the next actionable state.
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
} from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import { UpdateBannerService } from './update-banner.service';

const ACTIONABLE_STATES = new Set(['available', 'error']);

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
              @case ('error') {
                <div class="text-sm font-medium text-error">
                  Update check failed
                </div>
                <div class="text-xs opacity-80">{{ errorMessage() }}</div>
              }
            }
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            @if (state().state === 'available') {
              <a
                data-testid="update-download"
                class="btn btn-primary btn-xs"
                [href]="downloadHref()"
                target="_blank"
                rel="noopener"
              >
                Download
              </a>
            }
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

  /** Electron-only gate — VS Code webview renders zero DOM. */
  readonly isElectron = computed(() => this.vscodeService.isElectron);

  readonly state = computed(() => this.bannerService.state());

  readonly bannerVisible = computed(() =>
    ACTIONABLE_STATES.has(this.state().state),
  );

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

  readonly errorMessage = computed(() => {
    const s = this.state();
    return s.state === 'error' ? s.message : '';
  });

  releaseNotesUrl(version: string): string {
    return `https://github.com/Hive-Academy/ptah-extension/releases/tag/electron-v${version}`;
  }
}
