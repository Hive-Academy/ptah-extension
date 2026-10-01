import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { LucideAngularModule, ArrowLeftRight, Download, Upload } from 'lucide-angular';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { LicenseStatusCardComponent } from './license/license-status-card.component';
import { EnhancedPromptsConfigComponent } from './pro-features/enhanced-prompts-config.component';
import { VscodeLmConfigComponent } from './pro-features/vscode-lm-config.component';
import { McpPortConfigComponent } from './pro-features/mcp-port-config.component';
import { WorkflowsConfigComponent } from './pro-features/workflows-config.component';
import { OutputStyleConfigComponent } from './output-style/output-style-config.component';

/**
 * Advanced tab shell (TASK_2026_555 Advanced / Search & Voice, Batch 39).
 *
 * Hosts the existing child components unchanged and owns the Data Portability
 * (Export/Import) actions moved here from `SettingsComponent`. The rest of the
 * Advanced tab cards are built in later batches.
 */
@Component({
  selector: 'ptah-advanced-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LucideAngularModule,
    LicenseStatusCardComponent,
    EnhancedPromptsConfigComponent,
    OutputStyleConfigComponent,
    WorkflowsConfigComponent,
    McpPortConfigComponent,
    VscodeLmConfigComponent,
  ],
  template: `
    <div class="space-y-4">
      <ptah-license-status-card />

      <!-- Data Portability: moved from SettingsComponent, restyled into Membership & data in Batch 40. -->
      <div class="border border-secondary/30 rounded-md bg-secondary/5">
        <div class="p-3">
          <div class="flex items-center gap-1.5 mb-2">
            <lucide-angular [img]="ArrowLeftRightIcon" class="w-3.5 h-3.5 text-secondary" />
            <h2 class="text-xs font-medium uppercase tracking-wide text-base-content">Data Portability</h2>
          </div>
          <p class="text-xs text-base-content-muted mb-3">
            Export or import your settings, API keys, and preferences.
          </p>
          <div class="flex gap-2">
            <button
              type="button"
              class="btn btn-outline btn-xs gap-1 flex-1 text-base-content"
              [disabled]="isExporting()"
              (click)="exportSettings()"
              aria-label="Export settings"
            >
              @if (isExporting()) {
                <span class="loading loading-spinner loading-xs"></span>
              } @else {
                <lucide-angular [img]="UploadIcon" class="w-3 h-3" />
              }
              <span>Export</span>
            </button>
            <button
              type="button"
              class="btn btn-outline btn-xs gap-1 flex-1 text-base-content"
              [disabled]="isImporting()"
              (click)="importSettings()"
              aria-label="Import settings"
            >
              @if (isImporting()) {
                <span class="loading loading-spinner loading-xs"></span>
              } @else {
                <lucide-angular [img]="DownloadIcon" class="w-3 h-3" />
              }
              <span>Import</span>
            </button>
          </div>
        </div>
      </div>

      <ptah-enhanced-prompts-config />
      <ptah-output-style-config />
      <ptah-workflows-config />
      <ptah-mcp-port-config />
      <ptah-vscode-lm-config (modelChanged)="modelChanged.emit()" />
    </div>
  `,
})
export class AdvancedSettingsComponent {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);

  /** VS Code LM model changes can change which CLIs are usable (#84). */
  readonly modelChanged = output<void>();

  readonly ArrowLeftRightIcon = ArrowLeftRight;
  readonly DownloadIcon = Download;
  readonly UploadIcon = Upload;
  readonly isExporting = signal(false);
  readonly isImporting = signal(false);

  /**
   * Export settings to a JSON file.
   * Uses platform-aware RPC: command:execute for VS Code, settings:export for Electron.
   */
  async exportSettings(): Promise<void> {
    if (this.isExporting()) return;
    this.isExporting.set(true);
    try {
      if (this.vscodeService.isElectron) {
        await this.rpcService.call('settings:export' as never, {} as never);
      } else {
        await this.rpcService.call('command:execute', {
          command: 'ptah.exportSettings',
        });
      }
    } finally {
      this.isExporting.set(false);
    }
  }

  /**
   * Import settings from a JSON file.
   * Uses platform-aware RPC: command:execute for VS Code, settings:import for Electron.
   */
  async importSettings(): Promise<void> {
    if (this.isImporting()) return;
    this.isImporting.set(true);
    try {
      if (this.vscodeService.isElectron) {
        await this.rpcService.call('settings:import' as never, {} as never);
      } else {
        await this.rpcService.call('command:execute', {
          command: 'ptah.importSettings',
        });
      }
    } finally {
      this.isImporting.set(false);
    }
  }
}
