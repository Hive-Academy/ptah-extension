import {
  Component,
  ChangeDetectionStrategy,
  input,
  signal,
  inject,
} from '@angular/core';
import { ProjectIntelligence } from '@ptah-extension/shared';
import { QualityDashboardStateService } from '../../services/quality-dashboard-state.service';

/**
 * Export format option definition
 */
interface ExportOption {
  /** Display label */
  label: string;
  /** Export format key */
  format: 'markdown' | 'json' | 'csv';
  /** SVG icon path data */
  iconPath: string;
}

/**
 * Available export format options
 */
const EXPORT_OPTIONS: ExportOption[] = [
  {
    label: 'Markdown Report',
    format: 'markdown',
    iconPath:
      'M3 6.5A3.5 3.5 0 0 1 6.5 3H20a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6.5a1.5 1.5 0 0 1 0-3H19V5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19',
  },
  {
    label: 'JSON Data',
    format: 'json',
    iconPath:
      'M4 7V4a2 2 0 0 1 2-2h8.5L20 7.5V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3',
  },
  {
    label: 'CSV Spreadsheet',
    format: 'csv',
    iconPath:
      'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h2 M8 17h2 M14 13h2 M14 17h2',
  },
];

/**
 * QualityExportButtonComponent
 *
 * A dropdown button that lets users export quality assessment data
 * in multiple formats: Markdown, JSON, or CSV.
 *
 * Uses DaisyUI dropdown component with btn-outline styling.
 * Triggers download via in-memory blob URL creation.
 * Disabled when no intelligence data is available.
 */
@Component({
  selector: 'ptah-quality-export-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dropdown dropdown-end">
      <button
        tabindex="0"
        role="button"
        class="btn btn-sm btn-outline gap-1"
        [disabled]="!intelligence() || exporting()"
        aria-haspopup="menu"
        [attr.aria-label]="
          exporting() ? 'Exporting report...' : 'Export quality report'
        "
      >
        @if (exporting()) {
        <span class="loading loading-spinner loading-xs"></span>
        Exporting... } @else {
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          class="w-4 h-4"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
          />
        </svg>
        Export }
      </button>
      <ul
        tabindex="0"
        class="dropdown-content z-10 menu p-2 shadow bg-base-200 rounded-box w-52"
        role="menu"
        aria-label="Export format options"
      >
        @for (option of exportOptions; track option.format) {
        <li>
          <button
            (click)="handleExport(option.format)"
            [disabled]="exporting()"
            role="menuitem"
            [attr.aria-label]="'Export as ' + option.label"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="1.5"
              stroke="currentColor"
              class="w-4 h-4"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                [attr.d]="option.iconPath"
              />
            </svg>
            {{ option.label }}
          </button>
        </li>
        }
      </ul>
    </div>
  `,
})
export class QualityExportButtonComponent {
  private readonly stateService = inject(QualityDashboardStateService);

  readonly intelligence = input<ProjectIntelligence | null>(null);
  readonly exporting = signal(false);
  readonly exportOptions = EXPORT_OPTIONS;

  /**
   * Handle export for the selected format.
   * Calls the state service to fetch report content from backend,
   * then triggers a file download via a temporary blob URL.
   */
  async handleExport(format: 'markdown' | 'json' | 'csv'): Promise<void> {
    if (!this.intelligence() || this.exporting()) return;

    this.exporting.set(true);

    try {
      const exportResult = await this.stateService.exportReport(format);

      if (exportResult) {
        this.downloadBlob(
          exportResult.content,
          exportResult.filename,
          exportResult.mimeType
        );
      }
    } catch (err) {
      console.error('[QualityExportButton] Export failed:', err);
    } finally {
      this.exporting.set(false);
      // Close dropdown by blurring the active element
      (document.activeElement as HTMLElement)?.blur();
    }
  }

  /**
   * Create a blob from content and trigger a download via a temporary link element.
   * The blob URL is revoked after download to prevent memory leaks.
   */
  private downloadBlob(
    content: string,
    filename: string,
    mimeType: string
  ): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();

    // Clean up
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
