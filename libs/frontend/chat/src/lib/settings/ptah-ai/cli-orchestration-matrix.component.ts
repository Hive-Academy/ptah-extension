import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal } from '@angular/core';
import { ChevronDown, Info, LucideAngularModule, Plus, ShieldAlert, Terminal, X } from 'lucide-angular';
import { ProvidersSettingsStateService } from '@ptah-extension/core';
import { NativePopoverComponent } from '@ptah-extension/ui';
import type { SystemCliType } from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import {
  cliMatrixRows, type CliMatrixRow, type CliMatrixStatus, type CliKeyStatus, type InstanceCliMatrixRow, type SystemCliMatrixRow,
} from './cli-matrix-rows';
import type { CliPermissionTone } from './cli-permission-notes';
import { CliModelEffortPopoverComponent, type CliMatrixCellField } from './cli-model-effort-popover.component';
import { CopilotAutoApproveToggleComponent } from './copilot-auto-approve-toggle.component';
import { CursorCredentialPopoverComponent } from './cursor-credential-popover.component';
import { AddCliInstanceModalComponent, type CliInstanceEditTarget } from '../providers/add-cli-instance-modal.component';
import { CliTierMappingModalComponent, type CliTierMappingTarget } from '../providers/cli-tier-mapping-modal.component';

/** Which popover of which row is open; one at a time. */
type OpenCell = { readonly rowId: string; readonly kind: CliMatrixCellField | 'permission' | 'install' | 'credentials' };
interface MatrixGroup { readonly id: 'installed' | 'uninstalled'; readonly rows: readonly CliMatrixRow[] }

/**
 * #77: install copy per system CLI. Codex and Copilot keep the old "No CLI agents found" commands; the other four are
 * NEW copy (Batch 30, for user review at Gate V 36), from each adapter's own package or binary name.
 */
export const CLI_INSTALL_GUIDES: Readonly<Record<SystemCliType, { readonly command: string | null; readonly note: string }>> = {
  codex: { command: 'npm install -g @openai/codex', note: 'Install the Codex CLI, sign in with codex login, then Re-detect.' },
  copilot: { command: 'npm install -g @github/copilot', note: 'Install the Copilot CLI, sign in to GitHub Copilot, then Re-detect.' },
  cursor: {
    command: null,
    note: 'Cursor needs no install: Ptah runs it through the bundled Cursor SDK. It is detected once a Cursor API key is set '
      + '(the CURSOR_API_KEY environment variable, or the stored Cursor key), then Re-detect.',
  },
  antigravity: { command: null, note: 'Install Google\'s Antigravity CLI so the agy command is on your PATH, then Re-detect.' },
  opencode: { command: 'npm install -g opencode-ai', note: 'Install opencode so the opencode command is on your PATH, then Re-detect.' },
  pi: {
    command: 'npm install -g @earendil-works/pi-coding-agent',
    note: 'Install the Pi Coding Agent so the pi command is on your PATH, then Re-detect.',
  },
};

/** Tone → colour slot. Colour sits on dots, badge borders and backgrounds; text stays `text-base-content` (deviation 6). */
const DOT: Readonly<Record<CliMatrixStatus['tone'], string>> = {
  success: 'bg-success', neutral: 'bg-base-content-muted', warning: 'bg-warning', error: 'bg-error', info: 'bg-info',
};
const BADGE: Readonly<Record<CliPermissionTone | 'success', string>> = {
  success: 'border-success/40 bg-success/10', warning: 'border-warning/40 bg-warning/10', info: 'border-info/40 bg-info/10',
  error: 'border-error/40 bg-error/10', neutral: 'border-base-content-muted/40 bg-base-300',
};
const KEY_TONE: Readonly<Record<CliKeyStatus['kind'], CliPermissionTone | 'success'>> = {
  'key-set': 'success', keyless: 'neutral', missing: 'warning',
};
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
const CELL = `link link-hover inline-flex max-w-[13rem] items-center gap-1 rounded px-1 text-left font-mono text-xs text-base-content no-underline hover:bg-base-200 disabled:cursor-not-allowed ${FOCUS}`;
const ACTION = `btn btn-ghost btn-xs h-6 min-h-6 px-1.5 text-[11px] font-medium text-base-content underline underline-offset-2 ${FOCUS}`;
const SAVE_SCOPE = 'global';

/**
 * CLI Agents & Custom Instances matrix (plan :710-742, design-spec §3.5, prototype `orchestration.html` section 2).
 * One `table-xs` row per installed system CLI and Ptah CLI instance (ranked by the preferred order), then an
 * "Uninstalled" group with install guides (#71, #77). Rows come from `cliMatrixRows` (Batch 29).
 * - On/off: system → `disabledClis`; instance → `ptahCli:update.enabled`. Model and Effort cells open
 *   `CliModelEffortPopoverComponent`. Every write is `state.saveSettings` through `SettingsSaveFeedbackService`
 *   (Undo except Delete; Batch 17 constraint).
 * - Status shows only what detection reports for system CLIs (D11); instances show their status, key status,
 *   tier badges and the last Test with its latency or failure reason (#43, #44, #54, #52, RUX-11).
 * - Permissions & Safety: badge + ℹ popover (#70). A disabled or not-installed row renders its cells as plain text.
 * Since Batch 31: Cursor's Credentials popover (#64, 551) on both its rows, and Copilot's auto-approve toggle inside its
 * permission popover. Since Batch 32: "Add Ptah CLI Instance" (header, and the no-instance row) and each instance's
 * Tiers and Edit open their centered modals (`AddCliInstanceModalComponent`, `CliTierMappingModalComponent`).
 */
@Component({
  selector: 'ptah-cli-orchestration-matrix',
  standalone: true,
  imports: [
    LucideAngularModule, NativePopoverComponent, CliModelEffortPopoverComponent, CopilotAutoApproveToggleComponent,
    CursorCredentialPopoverComponent, AddCliInstanceModalComponent, CliTierMappingModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rounded-xl border border-base-300 bg-base-200 p-3" aria-labelledby="cli-matrix-heading" data-testid="cli-matrix-section">
      <div class="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 id="cli-matrix-heading" class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-base-content">
          <lucide-angular [img]="TerminalIcon" class="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          CLI Agents &amp; Custom Instances Matrix
        </h2>
        <span class="text-[10px] text-base-content-muted">Click model or effort cells to reassign in place</span>
        <!-- Batch 32: opens the add-instance modal (#46-#49); focus returns here when it closes. -->
        <button type="button" [class]="'btn btn-primary btn-xs ml-auto h-6 min-h-6 gap-1 text-[11px] ' + focusRing"
          [disabled]="busy() || !canWrite()" (click)="openAdd()" data-testid="cli-matrix-add">
          <lucide-angular [img]="PlusIcon" class="h-3 w-3" aria-hidden="true" />
          Add Ptah CLI Instance
        </button>
      </div>

      <div class="overflow-x-auto rounded-lg border border-base-300 bg-base-100">
        <!-- table-xs density: the §1.2 fold budget is the pass line, not the prototype's 56 px rows (plan :1049-1052).
             tabindex -1: the cli-agents deep link focuses the table (Batch 34); it is not a Tab stop. -->
        <table class="table table-xs w-full scroll-mt-4 [&_td]:px-1 [&_th]:px-1" aria-labelledby="cli-matrix-heading" data-testid="cli-matrix"
          tabindex="-1" [attr.aria-busy]="loading()">
          <thead>
            <tr class="text-[11px] uppercase tracking-wide text-base-content-muted">
              <th class="w-10">On</th><th>Agent / Instance</th><th class="cli-col-narrow-hidden">Status</th><th class="cli-col-narrow-hidden">Provider</th><th>Model</th><th>Effort</th>
              <th>Permissions &amp; Safety</th><th class="text-right">Actions</th>
            </tr>
          </thead>
          @for (group of groups(); track group.id) {
          <tbody [attr.data-testid]="group.id === 'uninstalled' ? 'cli-matrix-uninstalled' : null">
            @if (group.id === 'uninstalled') {
              <tr class="bg-base-300">
                <th colspan="8" scope="colgroup" class="py-1 text-[10px] font-bold uppercase tracking-wider text-base-content-muted">
                  Uninstalled CLI agents (kept visible with install guides)
                </th>
              </tr>
            }
            @for (row of group.rows; track row.id) {
      <tr [attr.data-testid]="'cli-matrix-row-' + row.id" [attr.data-kind]="row.kind"
        [class.bg-primary/5]="row.kind === 'instance' && row.interactive" [class.bg-base-300/50]="!row.interactive"
        [attr.data-dimmed]="row.interactive ? null : 'true'">
        <td class="align-middle">
          <input type="checkbox" [class]="'checkbox checkbox-xs checkbox-primary ' + focusRing"
            [checked]="row.enabled && (row.kind === 'instance' || row.installed)"
            [disabled]="busy() || !canWrite() || (row.kind === 'system' && !row.installed)"
            [attr.aria-label]="row.name + ' enabled'" (change)="toggle(row, $event)" [attr.data-testid]="'cli-matrix-toggle-' + row.id" />
        </td>
        <td>
          <div class="flex flex-wrap items-center gap-1.5 font-bold" [class.text-base-content-muted]="!row.interactive">
            {{ row.name }}
            @if (row.kind === 'system' && row.version) {
              <span class="text-[10px] font-normal text-base-content-muted">v{{ row.version }}</span>
            }
            @if (row.kind === 'instance') {
              <span [class]="'badge badge-outline badge-xs whitespace-nowrap font-medium text-base-content border-primary/40 bg-primary/10'">Ptah CLI</span>
            }
          </div>
          <!-- Narrow containers (Electron beside the shell sidebar) show the provider and status here instead of their columns. -->
          <div class="cli-narrow-inline mt-0.5 flex-wrap items-center gap-1" data-testid="cli-matrix-narrow-inline">
            <span class="badge badge-outline badge-xs h-auto gap-1 whitespace-nowrap py-0.5 font-medium text-base-content border-base-300"
              data-testid="cli-matrix-status-inline">
              <span [class]="'h-1.5 w-1.5 shrink-0 rounded-full ' + dot[row.status.tone]" aria-hidden="true"></span>
              {{ statusLabel(row) }}
            </span>
            <span class="text-[10px] text-base-content-muted">{{ providerLabel(row) }}</span>
          </div>
          @if (row.kind === 'instance') {
            <div class="mt-0.5 flex flex-wrap items-center gap-1" data-testid="cli-matrix-instance-subline">
              <span [class]="'badge badge-outline badge-xs whitespace-nowrap text-[9px] text-base-content ' + badge[keyTone[row.keyStatus.kind]]"
                data-testid="cli-matrix-key-status">{{ row.keyStatus.label }}</span>
              @for (tier of row.tiers ?? []; track tier.tier) {
                <span class="badge badge-xs whitespace-nowrap border-base-300 bg-base-300 text-[9px] text-base-content"
                  [attr.data-tier]="tier.tier">{{ tier.label }}: {{ tier.model }}</span>
              }
            </div>
          }
        </td>
        <td class="cli-col-narrow-hidden">
          <span class="badge badge-outline badge-xs h-auto gap-1 whitespace-nowrap py-0.5 font-medium text-base-content border-base-300"
            data-testid="cli-matrix-status">
            <span [class]="'h-1.5 w-1.5 shrink-0 rounded-full ' + dot[row.status.tone]" aria-hidden="true"></span>
            {{ statusLabel(row) }}
          </span>
        </td>
        <td class="cli-col-narrow-hidden min-w-[5rem] text-xs" [class.text-base-content-muted]="!row.interactive">{{ providerLabel(row) }}</td>
        <!-- The model column keeps a readable width; long ids wrap at word breaks (prototype: 2 lines at most). -->
        <td class="min-w-[8rem]">
          @if (row.kind === 'system' && !row.installed) {
            <span class="font-mono text-xs text-base-content-muted">—</span>
          } @else if (modelValue(row); as value) {
            @if (row.interactive) {
              <ptah-native-popover [isOpen]="isOpen(row.id, 'model')" placement="bottom-start" [hasBackdrop]="true"
                backdropClass="transparent" (closed)="close()" (opened)="focusOpened()">
                <button trigger type="button" [class]="cell" [disabled]="busy()" (click)="openCell(row.id, 'model')"
                  [attr.aria-label]="row.name + ' model: ' + value + '. Change'" [attr.aria-expanded]="isOpen(row.id, 'model')"
                  [attr.data-testid]="'cli-matrix-model-' + row.id">
                  <span class="break-words">{{ value }}</span>
                  <lucide-angular [img]="ChevronIcon" class="h-2.5 w-2.5 shrink-0 text-base-content-muted" aria-hidden="true" />
                </button>
                @if (isOpen(row.id, 'model')) {
                  <ptah-cli-model-effort-popover content [row]="row" field="model" (closed)="close()" />
                }
              </ptah-native-popover>
            } @else {
              <span class="break-words font-mono text-xs text-base-content-muted">{{ value }}</span>
            }
          }
        </td>
        <td class="whitespace-nowrap">
          @if (row.kind === 'system' && !row.installed) {
            <span class="font-mono text-xs text-base-content-muted">—</span>
          } @else if (row.kind === 'instance') {
            <span class="font-mono text-xs text-base-content-muted" title="Effort follows the instance's tier mappings">mapped</span>
          } @else if (row.effort) {
            @if (row.interactive) {
              <ptah-native-popover [isOpen]="isOpen(row.id, 'effort')" placement="bottom-start" [hasBackdrop]="true"
                backdropClass="transparent" (closed)="close()" (opened)="focusOpened()">
                <button trigger type="button" [class]="cell" [disabled]="busy()" (click)="openCell(row.id, 'effort')"
                  [attr.aria-label]="row.name + ' reasoning effort: ' + (row.effort.value || 'default') + '. Change'"
                  [attr.aria-expanded]="isOpen(row.id, 'effort')" [attr.data-testid]="'cli-matrix-effort-' + row.id">
                  {{ row.effort.value || 'default' }}
                  <lucide-angular [img]="ChevronIcon" class="h-2.5 w-2.5 shrink-0 text-base-content-muted" aria-hidden="true" />
                </button>
                @if (isOpen(row.id, 'effort')) {
                  <ptah-cli-model-effort-popover content [row]="row" field="effort" (closed)="close()" />
                }
              </ptah-native-popover>
            } @else {
              <span class="font-mono text-xs text-base-content-muted">{{ row.effort.value || 'default' }}</span>
            }
          } @else {
            <span class="font-mono text-xs text-base-content-muted">n/a</span>
          }
        </td>
        <td class="whitespace-nowrap">
          <div class="inline-flex items-center gap-1">
            <span [class]="'badge badge-outline badge-xs h-auto whitespace-nowrap py-0.5 font-medium text-base-content ' + badge[row.permission.tone]"
              data-testid="cli-matrix-permission">{{ row.permission.badge }}</span>
            <ptah-native-popover [isOpen]="isOpen(row.id, 'permission')" placement="bottom-end" [hasBackdrop]="true"
              backdropClass="transparent" (closed)="close()">
              <button trigger type="button" [class]="'btn btn-ghost btn-xs btn-square h-5 min-h-5 w-5 ' + focusRing"
                [attr.aria-label]="row.name + ' permission details'" [attr.aria-expanded]="isOpen(row.id, 'permission')"
                (click)="openCell(row.id, 'permission')" [attr.data-testid]="'cli-matrix-permission-info-' + row.id">
                <lucide-angular [img]="InfoIcon" class="h-3.5 w-3.5 text-info" aria-hidden="true" />
              </button>
              @if (isOpen(row.id, 'permission')) {
                <div content role="dialog" [attr.aria-labelledby]="'cli-permission-title-' + row.id"
                  class="w-[17rem] max-w-[calc(100vw-2rem)] space-y-2 whitespace-normal p-3 text-left" data-testid="cli-permission-popover">
                  <div class="flex items-center justify-between gap-2 border-b border-base-300 pb-1.5">
                    <h3 [id]="'cli-permission-title-' + row.id" class="flex items-center gap-1.5 text-xs font-bold text-base-content">
                      <lucide-angular [img]="ShieldIcon" class="h-3.5 w-3.5 text-warning" aria-hidden="true" />
                      {{ row.name }} permissions
                    </h3>
                    <button type="button" [class]="'btn btn-ghost btn-xs btn-square min-h-6 ' + focusRing" aria-label="Close" (click)="close()">
                      <lucide-angular [img]="CloseIcon" class="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  <p class="text-[11px] leading-relaxed text-base-content">{{ row.permission.detail }}</p>
                  <!-- Batch 31: Copilot's auto-approve lives in its permission popover (moved from the old policy section). -->
                  @if (row.kind === 'system' && row.cli === 'copilot') {
                    <ptah-copilot-auto-approve-toggle />
                  }
                </div>
              }
            </ptah-native-popover>
          </div>
        </td>
        <td class="text-right">
          @if (row.kind === 'instance') {
            @if (confirmDelete() === row.id) {
              <div class="inline-flex flex-wrap items-center justify-end gap-1" role="group" [attr.aria-label]="'Delete ' + row.name">
                <span class="text-[11px] text-base-content">Delete {{ row.name }}?</span>
                <button type="button" [class]="ACTION" [disabled]="busy() || !canWrite()" (click)="remove(row)"
                  [attr.aria-label]="'Confirm delete ' + row.name">Delete</button>
                <button type="button" [class]="ACTION" (click)="confirmDelete.set(null)">Cancel</button>
              </div>
            } @else {
              <!-- Two by two, so four actions never widen the column past the VS Code box. -->
              <div class="ml-auto inline-flex max-w-[7.5rem] flex-wrap items-center justify-end gap-1">
                <button type="button" [class]="ACTION" [disabled]="busy() || !canWrite()" (click)="openTiers(row)"
                  [attr.aria-label]="'Tiers for ' + row.name" [attr.data-testid]="'cli-matrix-tiers-' + row.id">Tiers</button>
                <button type="button" [class]="ACTION" [disabled]="busy() || !canWrite()" (click)="openEdit(row)"
                  [attr.aria-label]="'Edit ' + row.name + ' name or key'" [attr.data-testid]="'cli-matrix-edit-' + row.id">Edit</button>
                <button type="button" [class]="ACTION" [disabled]="testing()" (click)="test(row)"
                  [attr.aria-label]="'Test ' + row.name" [attr.data-testid]="'cli-matrix-test-' + row.id">
                  {{ testingId() === row.id ? 'Testing…' : 'Test' }}
                </button>
                <button type="button" [class]="ACTION" [disabled]="busy() || !canWrite()" (click)="confirmDelete.set(row.id)"
                  [attr.aria-label]="'Delete ' + row.name" [attr.data-testid]="'cli-matrix-delete-' + row.id">Delete</button>
              </div>
            }
            @if (testResult(row); as result) {
              <p [attr.role]="result.ok ? 'status' : 'alert'" class="mt-0.5 text-[10px] text-base-content" data-testid="cli-matrix-test-result">
                {{ result.text }}
              </p>
            }
          } @else {
            <div class="inline-flex flex-wrap items-center justify-end gap-1">
            <!-- Batch 31: Cursor's Credentials, on its installed and its Uninstalled row alike (it installs once a key resolves). -->
            @if (row.credentialAction) {
              <ptah-native-popover [isOpen]="isOpen(row.id, 'credentials')" placement="bottom-end" [hasBackdrop]="true"
                backdropClass="transparent" (closed)="close()" (opened)="focusCredentialKey()">
                <button trigger type="button" [class]="ACTION" (click)="openCell(row.id, 'credentials')"
                  [attr.aria-label]="'Credentials for ' + row.name" [attr.aria-expanded]="isOpen(row.id, 'credentials')"
                  [attr.data-testid]="'cli-matrix-credentials-' + row.id">Credentials</button>
                @if (isOpen(row.id, 'credentials')) {
                  <ptah-cursor-credential-popover content (closed)="close()" />
                }
              </ptah-native-popover>
            }
            @if (!row.installed) {
            <ptah-native-popover [isOpen]="isOpen(row.id, 'install')" placement="bottom-end" [hasBackdrop]="true"
              backdropClass="transparent" (closed)="close()">
              <button trigger type="button" [class]="ACTION" (click)="openCell(row.id, 'install')"
                [attr.aria-label]="'Install guide for ' + row.name" [attr.aria-expanded]="isOpen(row.id, 'install')"
                [attr.data-testid]="'cli-matrix-install-' + row.id">Install guide</button>
              @if (isOpen(row.id, 'install')) {
                <div content role="dialog" [attr.aria-labelledby]="'cli-install-title-' + row.id"
                  class="w-[18rem] max-w-[calc(100vw-2rem)] space-y-2 whitespace-normal p-3 text-left" data-testid="cli-install-popover">
                  <div class="flex items-center justify-between gap-2 border-b border-base-300 pb-1.5">
                    <h3 [id]="'cli-install-title-' + row.id" class="text-xs font-bold text-base-content">Install {{ row.name }}</h3>
                    <button type="button" [class]="'btn btn-ghost btn-xs btn-square min-h-6 ' + focusRing" aria-label="Close" (click)="close()">
                      <lucide-angular [img]="CloseIcon" class="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  @if (installGuide(row).command; as command) {
                    <code class="block select-all break-all rounded bg-base-300 px-2 py-1 font-mono text-[11px] text-base-content">{{ command }}</code>
                  }
                  <p class="text-[11px] leading-relaxed text-base-content">{{ installGuide(row).note }}</p>
                </div>
              }
            </ptah-native-popover>
            }
            </div>
          }
        </td>
      </tr>
            } @empty {
              <tr>
                <td colspan="8" class="text-base-content-muted" data-testid="cli-matrix-empty">
                  {{ loading() ? 'Loading CLI agents…' : 'No CLI agent is installed. Install one from the list below, then Re-detect.' }}
                </td>
              </tr>
            }
            <!-- Plan §5 empty state: no Ptah CLI instances yet. -->
            @if (group.id === 'installed' && noInstances()) {
              <tr data-testid="cli-matrix-no-instances">
                <td colspan="8" class="text-base-content-muted">
                  No Ptah CLI instance yet.
                  <button type="button" [class]="ACTION" [disabled]="busy() || !canWrite()" (click)="openAdd()">Add Ptah CLI Instance</button>
                </td>
              </tr>
            }
          </tbody>
          }
        </table>
      </div>
    </section>

    <!-- Batch 32: centered modals on the shared native <dialog> (design-spec §6), in this lazy chunk. -->
    <ptah-add-cli-instance-modal [open]="addOpen()" [editing]="editTarget()" (closed)="closeAdd()" />
    <ptah-cli-tier-mapping-modal [open]="tierTarget() !== null" [target]="tierTarget()" (closed)="tierTarget.set(null)" />
  `,
  // Container-width layout (the routing map's Q-extra-1 rule): every column in a wide box (VS Code at 1024 px, as in the
  // prototype); in a narrow one (Electron's page beside the shell sidebar) status and provider move under the agent
  // name, so no column is cut off and nothing scrolls sideways.
  styles: `
    :host { display: block; container-type: inline-size; }
    .cli-narrow-inline { display: none; }
    @container (max-width: 47.99rem) {
      .cli-col-narrow-hidden { display: none; }
      .cli-narrow-inline { display: flex; }
    }
  `,
})
export class CliOrchestrationMatrixComponent {
  protected readonly TerminalIcon = Terminal;
  protected readonly ChevronIcon = ChevronDown;
  protected readonly InfoIcon = Info;
  protected readonly ShieldIcon = ShieldAlert;
  protected readonly CloseIcon = X;
  protected readonly PlusIcon = Plus;
  protected readonly focusRing = FOCUS;
  protected readonly cell = CELL;
  protected readonly ACTION = ACTION;
  protected readonly dot = DOT;
  protected readonly badge = BADGE;
  protected readonly keyTone = KEY_TONE;

  protected readonly state = inject(ProvidersSettingsStateService);
  private readonly feedback = inject(SettingsSaveFeedbackService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly rows = computed(() => cliMatrixRows({
    orchestration: this.state.orchestration().data,
    cliAgents: this.state.cliAgents().data,
    cliModels: this.state.cliModels().data,
    cliTest: this.state.cliTest().data,
  }));
  /** The installed group (always, for its empty state), then the Uninstalled group when it has rows (#71). */
  protected readonly groups = computed((): readonly MatrixGroup[] => {
    const { installed, uninstalled } = this.rows();
    const groups: MatrixGroup[] = [{ id: 'installed', rows: installed }];
    if (uninstalled.length) groups.push({ id: 'uninstalled', rows: uninstalled });
    return groups;
  });
  /** Neither source has data yet (the container shows each section's own loading or error line). */
  protected readonly loading = computed(() => !this.state.orchestration().data && !this.state.cliAgents().data);
  /** Save triggers wait while any save runs (D3). */
  protected readonly busy = this.feedback.saving;
  protected readonly canWrite = computed(() => this.state.scopes().status === 'ready' && this.state.reviewContext() !== null);

  private readonly openState = signal<OpenCell | null>(null);
  protected readonly confirmDelete = signal<string | null>(null);
  protected readonly testingId = signal<string | null>(null);
  /** Batch 32 modals: the add/edit form (with the instance it edits, or `null` to create) and the tier mapping. */
  protected readonly addOpen = signal(false);
  protected readonly editTarget = signal<CliInstanceEditTarget | null>(null);
  protected readonly tierTarget = signal<CliTierMappingTarget | null>(null);
  protected readonly noInstances = computed(() => this.state.cliAgents().status === 'ready' && !this.state.cliAgents().data?.length);

  protected openAdd(): void {
    this.close();
    this.editTarget.set(null);
    this.addOpen.set(true);
  }

  protected openEdit(row: InstanceCliMatrixRow): void {
    this.close();
    const agent = this.state.cliAgents().data?.find((entry) => entry.id === row.id);
    this.editTarget.set({ id: row.id, name: row.name, providerId: row.providerId, providerName: row.provider, hasStoredKey: agent?.hasStoredKey ?? false });
    this.addOpen.set(true);
  }

  protected closeAdd(): void {
    this.addOpen.set(false);
    this.editTarget.set(null);
  }

  protected openTiers(row: InstanceCliMatrixRow): void {
    this.close();
    this.tierTarget.set({ id: row.id, name: row.name, providerId: row.providerId, providerName: row.provider });
  }
  /** The instance whose Test ran last, for a test that failed before it produced a result. */
  private readonly lastTestedId = signal<string | null>(null);
  protected readonly testing = computed(() => this.testingId() !== null || this.state.cliTest().status === 'loading');

  protected isOpen(rowId: string, kind: OpenCell['kind']): boolean {
    const open = this.openState();
    return open?.rowId === rowId && open.kind === kind;
  }

  protected openCell(rowId: string, kind: OpenCell['kind']): void {
    this.openState.set(this.isOpen(rowId, kind) ? null : { rowId, kind });
  }

  protected close(): void { this.openState.set(null); }

  /** The panel takes focus when positioned; then its first control does (the model search opens its list). */
  protected focusOpened(): void {
    this.element.nativeElement.querySelector<HTMLElement>(
      '[data-testid="cli-matrix-popover"] input:not([disabled]), [data-testid="cli-matrix-popover"] button[aria-pressed="true"]',
    )?.focus();
  }

  /** The Credentials popover's key field takes focus once the panel is positioned. */
  protected focusCredentialKey(): void {
    this.element.nativeElement.querySelector<HTMLElement>('[data-testid="cursor-credential-key"]:not([disabled])')?.focus();
  }

  protected statusLabel(row: CliMatrixRow): string {
    if (row.kind === 'instance' && row.status.kind === 'ready' && row.lastTest?.success && row.lastTest.latencyMs !== null) {
      return `${row.status.label} (${row.lastTest.latencyMs}ms)`;
    }
    return row.status.label;
  }

  protected providerLabel(row: CliMatrixRow): string {
    if (row.kind === 'instance') return row.provider;
    if (!row.installed) return 'None';
    return row.provider ?? 'Set by the model';
  }

  /** The Model cell's text; null when the instance's saved model has not loaded. */
  protected modelValue(row: CliMatrixRow): string | null {
    if (row.kind === 'system') return row.model.value || 'provider default';
    return row.selectedModel === null ? null : row.selectedModel || 'provider default';
  }

  protected installGuide(row: SystemCliMatrixRow): (typeof CLI_INSTALL_GUIDES)[SystemCliType] {
    return CLI_INSTALL_GUIDES[row.cli];
  }

  /** RUX-11: the last Test of this instance, inline, with its latency or the host's sanitized reason. */
  protected testResult(row: InstanceCliMatrixRow): { readonly ok: boolean; readonly text: string } | null {
    if (row.lastTest) {
      if (row.lastTest.success) {
        return { ok: true, text: row.lastTest.latencyMs === null ? 'Test passed.' : `Test passed in ${row.lastTest.latencyMs}ms.` };
      }
      return { ok: false, text: `Test failed: ${row.lastTest.reason ?? 'the host gave no reason.'}` };
    }
    if (this.lastTestedId() === row.id && this.testingId() === null && this.state.cliTest().status === 'error') {
      return { ok: false, text: 'The test could not run. Try again.' };
    }
    return null;
  }

  protected async test(row: InstanceCliMatrixRow): Promise<void> {
    if (this.testing()) return;
    this.testingId.set(row.id);
    this.lastTestedId.set(row.id);
    try {
      await this.state.testCliConnection(row.id);
    } finally {
      this.testingId.set(null);
    }
  }

  /**
   * On/off. The checkbox keeps showing the saved value; the read-back after the write moves it. System rows write
   * `disabledClis`, instances `ptahCli:update.enabled`; Undo writes the previous value back the same way.
   */
  protected async toggle(row: CliMatrixRow, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const enabled = input.checked;
    input.checked = row.enabled;
    const context = this.state.reviewContext();
    if (!context || this.busy()) return;
    const label = `${row.name} ${enabled ? 'on' : 'off'}`;
    if (row.kind === 'system') {
      const previous = [...(this.state.orchestration().data?.disabledClis ?? [])];
      const next = enabled ? previous.filter((cli) => cli !== row.cli) : [...previous.filter((cli) => cli !== row.cli), row.cli];
      await this.feedback.save({
        label, scope: SAVE_SCOPE,
        write: () => this.state.saveSettings({ orchestration: { disabledClis: next } }, context),
        undo: () => this.state.saveSettings({ orchestration: { disabledClis: previous } }, context),
      });
      return;
    }
    const write = (value: boolean) => () =>
      this.state.saveSettings({ cli: [{ action: 'update', params: { id: row.id, enabled: value } }] }, context);
    await this.feedback.save({ label, scope: SAVE_SCOPE, write: write(enabled), undo: write(row.enabled) });
  }

  /** Delete after the inline confirm (#55). No Undo: a deleted instance's stored key cannot be written back. */
  protected async remove(row: InstanceCliMatrixRow): Promise<void> {
    const context = this.state.reviewContext();
    if (!context || this.busy()) return;
    await this.feedback.save({
      label: `removal of ${row.name}`, scope: SAVE_SCOPE,
      write: () => this.state.saveSettings({ cli: [{ action: 'delete', params: { id: row.id } }] }, context),
      undo: null,
    });
    if (this.state.commit().status === 'saved') this.confirmDelete.set(null);
  }
}
