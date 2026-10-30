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
import {
  LucideAngularModule,
  ChevronRight,
  Download,
  Upload,
} from 'lucide-angular';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { AdvancedSettingsGroupComponent } from './advanced/advanced-settings-group.component';
import { LicenseStatusCardComponent } from './license/license-status-card.component';
import { VscodeLmConfigComponent } from './pro-features/vscode-lm-config.component';
import { McpPortConfigComponent } from './pro-features/mcp-port-config.component';
import { ClaudeBuiltinsConfigComponent } from './pro-features/claude-builtins-config.component';
import { AgentBehaviourSectionComponent } from './pro-features/agent-behaviour-section.component';
import { OutputStyleConfigComponent } from './output-style/output-style-config.component';
import { SettingsSaveFeedbackService } from './feedback/settings-save-feedback.service';

/**
 * A per-key import failure is reported as `<key>: <reason>`, the key being a `ptah.*` secret
 * (`settings-import.service.ts` importSecret) or a `config:*` value (`settings-rpc.handlers.ts` registerImport).
 * A file the host rejects as a whole (empty, malformed JSON, not an export) carries no key. Only the prefix is
 * read; the host text itself is never shown (D15).
 */
const KEYED_IMPORT_ERROR = /^(ptah\.|config:)/;

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

/**
 * Advanced tab shell (TASK_2026_555 Advanced / Search & Voice, Batches 39-42).
 *
 * Hosts the existing child components unchanged and owns the Data Portability
 * (Export/Import) actions (rows A8/A9): their buttons and results are projected
 * into the "Membership & data" card (`LicenseStatusCardComponent`) through the
 * `[membership-actions]` / `[membership-notices]` slots, so the whole
 * capability sits in one section card while the writes stay here.
 *
 * The closed-by-default "Fine-tuning" disclosure at the end holds the advanced
 * upkeep groups (TASK_2026_658), deferred into their own chunk.
 *
 * Import is S-confirm: an inline confirm (P8) precedes the write, and the
 * outcome is surfaced only from the write's own result (D15). On Electron the
 * RPC reports the import summary, so success and errors are shown in the page toast; on
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
    ClaudeBuiltinsConfigComponent,
    VscodeLmConfigComponent,
    AdvancedSettingsGroupComponent,
  ],
  template: `
    <div class="space-y-8 py-3">
      <ptah-license-status-card>
        <!--
          M5: the import confirm takes the place of Export / Import inside the header's action row, so the
          membership badges under the header do not move and the card height stays the same.
        -->
        <div membership-actions class="flex flex-wrap items-center gap-1.5">
          @if (confirmingImport()) {
            <div
              role="group"
              aria-label="Confirm import settings"
              aria-describedby="import-confirm-detail"
              class="flex items-center gap-1.5 rounded border border-base-300 px-2 py-0.5"
              data-testid="import-confirm"
              (keydown.escape)="cancelImport($event)"
            >
              <span class="text-xs text-base-content whitespace-nowrap"
                >Replace your settings from a file?</span
              >
              <span id="import-confirm-detail" class="sr-only">
                Import replaces your current settings, API keys and preferences
                with the contents of a settings export file you choose next.
              </span>
              <button
                type="button"
                class="btn btn-outline btn-sm border-error text-base-content"
                [disabled]="isImporting()"
                (click)="importSettings()"
                data-testid="import-confirm-button"
              >
                Import settings
              </button>
              <button
                #importCancel
                type="button"
                class="btn btn-ghost btn-sm text-base-content"
                [disabled]="isImporting()"
                (click)="cancelImport()"
              >
                Cancel
              </button>
            </div>
          } @else {
            <button
              type="button"
              class="btn btn-outline btn-sm gap-1 text-base-content"
              [disabled]="isExporting()"
              (click)="exportSettings()"
              aria-label="Export settings"
            >
              @if (isExporting()) {
                <span
                  class="loading loading-spinner loading-xs"
                  aria-hidden="true"
                ></span>
              } @else {
                <lucide-angular
                  [img]="UploadIcon"
                  class="w-3 h-3"
                  aria-hidden="true"
                />
              }
              <span>Export</span>
            </button>
            <button
              #importButton
              type="button"
              class="btn btn-outline btn-sm gap-1 text-base-content"
              [disabled]="isImporting()"
              (click)="requestImport()"
              aria-label="Import settings"
            >
              @if (isImporting()) {
                <span
                  class="loading loading-spinner loading-xs"
                  aria-hidden="true"
                ></span>
              } @else {
                <lucide-angular
                  [img]="DownloadIcon"
                  class="w-3 h-3"
                  aria-hidden="true"
                />
              }
              <span>Import</span>
            </button>
          }
        </div>
      </ptah-license-status-card>

      <ptah-agent-behaviour-section />
      <ptah-output-style-config />
      <ptah-mcp-port-config />
      <ptah-claude-builtins-config />
      <ptah-vscode-lm-config (modelChanged)="modelChanged.emit()" />

      <!-- Fine-tuning (TASK_2026_658): closed by default; its groups load in their own chunk once opened and in view. -->
      <section class="border-t border-base-content/10 pt-6">
        <details class="group" data-testid="fine-tuning-details">
          <summary
            [class]="
              'flex cursor-pointer list-none items-start gap-2 rounded-lg py-0 select-none [&::-webkit-details-marker]:hidden ' +
              focusRing
            "
            data-testid="fine-tuning-summary"
          >
            <!-- Points right closed, down open; the turn sits on the wrapper (lucide copies host classes to the svg). -->
            <span
              class="mt-0.5 inline-flex shrink-0 transition-transform group-open:rotate-90"
              aria-hidden="true"
            >
              <lucide-angular
                [img]="ChevronIcon"
                class="block h-3.5 w-3.5 text-info"
                aria-hidden="true"
              />
            </span>
            <span class="flex min-w-0 flex-col gap-0.5">
              <span
                class="text-xs font-bold uppercase tracking-wider text-base-content"
                >Fine-tuning</span
              >
              <span class="text-xs text-base-content-muted"
                >Upkeep and timing values for memory, scheduled jobs and
                the workspace harness. The defaults suit most people.</span
              >
            </span>
          </summary>
          <div
            class="mt-3 flex flex-col gap-4 border-t border-base-content/10 pt-3"
          >
            @defer (on viewport) {
              <ptah-advanced-settings-group groupId="memory-upkeep" />
              <ptah-advanced-settings-group groupId="scheduled-jobs" />
              <ptah-advanced-settings-group groupId="workspace-harness" />
            } @placeholder {
              <div
                class="min-h-[2.75rem] border-b border-base-content/10"
                data-testid="fine-tuning-placeholder"
              ></div>
            }
          </div>
        </details>
      </section>
    </div>
  `,
})
export class AdvancedSettingsComponent {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly injector = inject(Injector);
  /** The page toast: the import's own result is said there (D15). */
  private readonly feedback = inject(SettingsSaveFeedbackService);
  private readonly importButton =
    viewChild<ElementRef<HTMLButtonElement>>('importButton');
  private readonly importCancel =
    viewChild<ElementRef<HTMLButtonElement>>('importCancel');

  /** VS Code LM model changes can change which CLIs are usable (#84). */
  readonly modelChanged = output<void>();

  readonly DownloadIcon = Download;
  readonly UploadIcon = Upload;
  protected readonly ChevronIcon = ChevronRight;
  protected readonly focusRing = FOCUS;
  readonly isExporting = signal(false);
  readonly isImporting = signal(false);
  /** The inline import confirm is open (S-confirm, P8). */
  readonly confirmingImport = signal(false);

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
    afterNextRender(() => this.importButton()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  /**
   * Import settings from a JSON file, after the inline confirm.
   * Uses platform-aware RPC: command:execute for VS Code, settings:import for
   * Electron. The outcome is the page toast, only from this write's own result (D15).
   */
  async importSettings(): Promise<void> {
    if (this.isImporting()) return;
    this.confirmingImport.set(false);
    this.isImporting.set(true);
    try {
      if (this.vscodeService.isElectron) {
        const result = await this.rpcService.call('settings:import', {});
        if (result.isSuccess()) {
          // A closed file dialog changed nothing; there is nothing to report.
          if (result.data.cancelled) return;
          const errors = result.data.result?.errors ?? [];
          const imported = result.data.result?.imported ?? [];
          if (
            errors.length > 0 &&
            imported.length === 0 &&
            !errors.some((entry) => KEYED_IMPORT_ERROR.test(entry))
          ) {
            // N4: only a file the host rejected as a whole (empty, malformed, not an export) blames the file.
            this.feedback.announce('The file is not a Ptah settings export.', 'alert');
          } else if (errors.length > 0) {
            this.feedback.announce('Some settings could not be imported.', 'alert');
          } else {
            this.feedback.announce('Settings imported.', 'status');
          }
        } else {
          this.feedback.announce('Could not import the settings.', 'alert');
        }
      } else {
        // The host command runs its own dialogs and result notifications; a
        // user cancel returns the same success as a completed import, so only
        // an execution failure is ours to report.
        const result = await this.rpcService.call('command:execute', {
          command: 'ptah.importSettings',
        });
        if (!result.isSuccess()) {
          this.feedback.announce('Could not import the settings.', 'alert');
        }
      }
    } catch {
      this.feedback.announce('Could not import the settings.', 'alert');
    } finally {
      this.isImporting.set(false);
      // The confirm that held focus is gone: focus returns to Import.
      afterNextRender(() => this.importButton()?.nativeElement.focus(), {
        injector: this.injector,
      });
    }
  }
}
