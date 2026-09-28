import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { ExternalInstallResult } from '@ptah-extension/shared';

/**
 * ExternalInstallReportComponent — the post-install report of an external
 * plugin: only what the user still needs to know after the install landed
 * (files written, files skipped as non-text, skills shadowed by an existing
 * skill of the same name).
 *
 * PURELY PRESENTATIONAL: the parent owns the result and clears it on
 * `dismissed`. Split out of `ExternalMarketplacesComponent` by the plan C13
 * net-line rule (view-specific markup that is not a catalog card goes into a
 * sibling file, never the over-cap parent).
 */
@Component({
  selector: 'ptah-external-install-report',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="rounded-lg border border-success/40 bg-success/10 p-2.5 space-y-1.5"
    >
      <div class="flex items-start justify-between gap-2">
        <span class="text-xs font-semibold text-base-content">
          Installed {{ report().displayName }}
          {{ report().installedVersion }} ({{ report().filesWritten }} files)
        </span>
        <button
          class="btn btn-ghost btn-xs shrink-0"
          type="button"
          (click)="dismissed.emit()"
        >
          Dismiss
        </button>
      </div>
      @if (report().skippedBinaryFiles.length > 0) {
        <div class="text-[11px] text-base-content-muted">
          Skipped (not valid UTF-8 text):
          @for (file of report().skippedBinaryFiles; track $index) {
            <code class="font-mono break-all">{{ file }}</code>
            <span aria-hidden="true">&nbsp;</span>
          }
        </div>
      }
      @if (report().collisions.length > 0) {
        <ul class="space-y-0.5">
          @for (collision of report().collisions; track $index) {
            <li class="text-[11px] text-base-content-muted break-all">
              skill <code class="font-mono">{{ collision.skillName }}</code
              >&nbsp;is shadowed by
              <code class="font-mono">{{ collision.shadowedBy }}</code> and will
              not take effect
            </li>
          }
        </ul>
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
export class ExternalInstallReportComponent {
  /** The successful install to report. */
  public readonly report = input.required<ExternalInstallResult>();

  /** The user dismissed the report. */
  public readonly dismissed = output<void>();
}
