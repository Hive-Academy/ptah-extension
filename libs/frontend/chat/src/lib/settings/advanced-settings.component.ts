import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, Download, Upload } from 'lucide-angular';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { LicenseStatusCardComponent } from './license/license-status-card.component';
import { VscodeLmConfigComponent } from './pro-features/vscode-lm-config.component';
import { McpPortConfigComponent } from './pro-features/mcp-port-config.component';
import { AgentBehaviourSectionComponent } from './pro-features/agent-behaviour-section.component';
import { OutputStyleConfigComponent } from './output-style/output-style-config.component';

/** The import outcome, shown inline in the Membership & data card (A9, D15). */
interface ImportOutcome {
  /** `status` renders `role="status"` (polite); `alert` renders `role="alert"`. */
  readonly tone: 'status' | 'alert';
  readonly message: string;
}

/**
 * Advanced tab shell (TASK_2026_555 Advanced / Search & Voice, Batches 39-42).
 *
 * Hosts the existing child components unchanged and owns the Data Portability
 * (Export/Import) actions (rows A8/A9): their buttons and results are projected
 * into the "Membership & data" card (`LicenseStatusCardComponent`) through the
 * `[membership-actions]` / `[membership-notices]` slots, so the whole
 * capability sits in one section card while the writes stay here.
 *
 * Import is S-confirm: an inline confirm (P8) precedes the write, and the
 * outcome is surfaced only from the write's own result (D15). On Electron the
 * RPC reports the import summary, so success and errors are shown inline; on
 * VS Code the host command shows its own dialogs and a cancel is
 * indistinguishable from success at the RPC layer, so only an execution
 * failure is reported here.
 */
@Component({
  selector: 'ptah-advanced-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LucideAngularModule,
    LicenseStatusCardComponent,
    AgentBehaviourSectionComponent,
    OutputStyleConfigComponent,
    McpPortConfigComponent,
    VscodeLmConfigComponent,
  ],
  template: `
    <div class="space-y-4">
      <ptah-license-status-card>
        <div
          membership-actions
          class="flex flex-wrap items-center gap-1.5"
        >
          <button
            type="button"
            class="btn btn-outline btn-xs gap-1 text-base-content"
            [disabled]="isExporting()"
            (click)="exportSettings()"
            aria-label="Export settings"
          >
            @if (isExporting()) {
              <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
            } @else {
              <lucide-angular [img]="UploadIcon" class="w-3 h-3" aria-hidden="true" />
            }
            <span>Export</span>
          </button>
          <button
            #importButton
            type="button"
            class="btn btn-outline btn-xs gap-1 text-base-content"
            [disabled]="isImporting() || confirmingImport()"
            (click)="requestImport()"
            aria-label="Import settings"
          >
            @if (isImporting()) {
              <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
            } @else {
              <lucide-angular [img]="DownloadIcon" class="w-3 h-3" aria-hidden="true" />
            }
            <span>Import</span>
          </button>
        </div>
        @if (confirmingImport() || importOutcome()) {
          <div membership-notices class="mt-1 space-y-2">
            @if (confirmingImport()) {
              <div
                role="group"
                aria-label="Confirm import settings"
                class="rounded border border-base-300 p-2"
                data-testid="import-confirm"
                (keydown.escape)="cancelImport($event)"
              >
                <p class="text-xs text-base-content mb-2">
                  Import replaces your current settings, API keys and
                  preferences with the contents of a settings export file you
                  choose next.
                </p>
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="btn btn-outline btn-xs border-error text-base-content"
                    [disabled]="isImporting()"
                    (click)="importSettings()"
                    data-testid="import-confirm-button"
                  >
                    @if (isImporting()) {
                      <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
                    }
                    <span>Import settings</span>
                  </button>
                  <button
                    #importCancel
                    type="button"
                    class="btn btn-ghost btn-xs text-base-content"
                    [disabled]="isImporting()"
                    (click)="cancelImport()"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            }
            @if (importOutcome(); as outcome) {
              <p
                [attr.role]="outcome.tone"
                class="flex items-center gap-1.5 text-xs text-base-content"
                data-testid="import-outcome"
              >
                <span
                  class="h-2 w-2 shrink-0 rounded-full"
                  [class.bg-error]="outcome.tone === 'alert'"
                  [class.bg-success]="outcome.tone === 'status'"
                  aria-hidden="true"
                ></span>
                {{ outcome.message }}
              </p>
            }
          </div>
        }
      </ptah-license-status-card>

      <ptah-agent-behaviour-section />
      <ptah-output-style-config />
      <ptah-mcp-port-config />
      <ptah-vscode-lm-config (modelChanged)="modelChanged.emit()" />
    </div>
  `,
})
export class AdvancedSettingsComponent {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly injector = inject(Injector);
  private readonly importButton = viewChild<ElementRef<HTMLButtonElement>>('importButton');
  private readonly importCancel = viewChild<ElementRef<HTMLButtonElement>>('importCancel');

  /** VS Code LM model changes can change which CLIs are usable (#84). */
  readonly modelChanged = output<void>();

  readonly DownloadIcon = Download;
  readonly UploadIcon = Upload;
  readonly isExporting = signal(false);
  readonly isImporting = signal(false);
  /** The inline import confirm is open (S-confirm, P8). */
  readonly confirmingImport = signal(false);
  /** The last import's own result; `null` until a write reports one (D15). */
  readonly importOutcome = signal<ImportOutcome | null>(null);

  constructor() {
    // P8: the opened import confirm takes focus on Cancel, so Esc reaches it.
    effect(() => this.importCancel()?.nativeElement.focus());
  }

  /**
   * Export settings to a JSON file.
   * Uses platform-aware RPC: command:execute for VS Code, settings:export for Electron.
   */
  async exportSettings(): Promise<void> {
    if (this.isExporting()) return;
    this.isExporting.set(true);
    try {
      if (this.vscodeService.isElectron) {
        await this.rpcService.call('settings:export', {});
      } else {
        await this.rpcService.call('command:execute', {
          command: 'ptah.exportSettings',
        });
      }
    } finally {
      this.isExporting.set(false);
    }
  }

  /** Opens the inline import confirm (A9, S-confirm). */
  requestImport(): void {
    this.confirmingImport.set(true);
  }

  /**
   * Cancel and Esc close the confirm and return focus to Import, once it is enabled again (P8). Esc stops
   * here, so an enclosing overlay does not also close.
   */
  cancelImport(event?: Event): void {
    if (!this.confirmingImport()) return;
    event?.stopPropagation();
    this.confirmingImport.set(false);
    afterNextRender(() => this.importButton()?.nativeElement.focus(), { injector: this.injector });
  }

  /**
   * Import settings from a JSON file, after the inline confirm.
   * Uses platform-aware RPC: command:execute for VS Code, settings:import for
   * Electron. The outcome is shown only from this write's own result (D15).
   */
  async importSettings(): Promise<void> {
    if (this.isImporting()) return;
    this.confirmingImport.set(false);
    this.isImporting.set(true);
    this.importOutcome.set(null);
    try {
      if (this.vscodeService.isElectron) {
        const result = await this.rpcService.call('settings:import', {});
        if (result.isSuccess()) {
          // A closed file dialog changed nothing; there is nothing to report.
          if (result.data.cancelled) return;
          const errors = result.data.result?.errors ?? [];
          if (errors.length > 0) {
            this.importOutcome.set({
              tone: 'alert',
              message: 'Some settings could not be imported.',
            });
          } else {
            this.importOutcome.set({
              tone: 'status',
              message: 'Settings imported.',
            });
          }
        } else {
          this.importOutcome.set({
            tone: 'alert',
            message: 'Could not import the settings.',
          });
        }
      } else {
        // The host command runs its own dialogs and result notifications; a
        // user cancel returns the same success as a completed import, so only
        // an execution failure is ours to report.
        const result = await this.rpcService.call('command:execute', {
          command: 'ptah.importSettings',
        });
        if (!result.isSuccess()) {
          this.importOutcome.set({
            tone: 'alert',
            message: 'Could not import the settings.',
          });
        }
      }
    } catch {
      this.importOutcome.set({
        tone: 'alert',
        message: 'Could not import the settings.',
      });
    } finally {
      this.isImporting.set(false);
    }
  }
}