import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  ChevronDown,
  ChevronRight,
  Info,
  LucideAngularModule,
  RefreshCw,
  ShieldAlert,
  Terminal,
  X,
} from 'lucide-angular';
import { ProvidersSettingsStateService } from '@ptah-extension/core';
import {
  NativePopoverComponent,
  ProviderMarkComponent,
} from '@ptah-extension/ui';
import type { SystemCliType } from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import {
  CLI_TEST_NOT_RUN,
  CLI_TEST_NOT_STARTED,
  cliMatrixRows,
  cliModelDisplay,
  cliTestFailedText,
  isCliProcessDump,
  type CliMatrixCellField,
  type CliMatrixRow,
  type InstanceCliMatrixRow,
  type SystemCliMatrixRow,
} from './cli-matrix-rows';
import {
  CLI_MATRIX_ACTION,
  CLI_MATRIX_CELL_BASE,
  CLI_MATRIX_DOT,
  CLI_MATRIX_FOCUS,
} from './cli-matrix-styles';
import type { CliPermissionTone } from './cli-permission-notes';
import { CliModelEffortPopoverComponent } from './cli-model-effort-popover.component';
import { CopilotAutoApproveToggleComponent } from './copilot-auto-approve-toggle.component';
import { CursorCredentialPopoverComponent } from './cursor-credential-popover.component';
import {
  AddCliInstanceModalComponent,
  type CliInstanceEditTarget,
} from '../providers/add-cli-instance-modal.component';
import {
  CliTierMappingModalComponent,
  type CliTierMappingTarget,
} from '../providers/cli-tier-mapping-modal.component';
import { SettingsBusyDisabledDirective } from '../feedback/busy-disabled.directive';
import { AgentOrchestrationConfigComponent } from './agent-orchestration-config.component';
import { ClaudeLaneAccountCellComponent } from './claude-lane-account-cell.component';
import { PtahCliInstancesComponent } from './ptah-cli-instances.component';

/** Which popover of which row is open; one at a time. */
type OpenCell = {
  readonly rowId: string;
  readonly kind:
    CliMatrixCellField | 'permission' | 'install' | 'credentials' | 'more';
};
interface MatrixGroup {
  readonly id: 'installed' | 'uninstalled';
  readonly rows: readonly SystemCliMatrixRow[];
}

/**
 * #77: install copy per system CLI. Codex and Copilot keep the old "No CLI agents found" commands; the other four are
 * NEW copy (Batch 30, for user review at Gate V 36), from each adapter's own package or binary name. Grok's is NEW copy
 * (TASK_2026_617) with no install command: the binary name and `grok login` are the only facts Ptah relies on.
 */
export const CLI_INSTALL_GUIDES: Readonly<
  Record<
    SystemCliType,
    { readonly command: string | null; readonly note: string }
  >
> = {
  codex: {
    command: 'npm install -g @openai/codex',
    note: 'Install the Codex CLI, sign in with codex login, then Re-detect.',
  },
  copilot: {
    command: 'npm install -g @github/copilot',
    note: 'Install the Copilot CLI, sign in to GitHub Copilot, then Re-detect.',
  },
  cursor: {
    command: null,
    note:
      'Cursor needs no install: Ptah runs it through the bundled Cursor SDK. It is detected once a Cursor API key is set ' +
      '(the CURSOR_API_KEY environment variable, or the stored Cursor key), then Re-detect.',
  },
  antigravity: {
    command: null,
    note: "Install Google's Antigravity CLI so the agy command is on your PATH, then Re-detect.",
  },
  opencode: {
    command: 'npm install -g opencode-ai',
    note: 'Install opencode so the opencode command is on your PATH, then Re-detect.',
  },
  pi: {
    command: 'npm install -g @earendil-works/pi-coding-agent',
    note: 'Install the Pi Coding Agent so the pi command is on your PATH, then Re-detect.',
  },
  grok: {
    command: null,
    note: 'Put the Grok CLI on your PATH as grok, sign in with grok login, then Re-detect.',
  },
  // NEW copy (TASK_2026_712 Batch 26d): `ClaudeCliAdapter.detect()` installs nothing of its own; it reports the
  // lane once the Claude Agent SDK that Ptah chat uses can be loaded, so there is no install command.
  claude: {
    command: null,
    note:
      'Claude needs no separate install: Ptah runs it through the Claude Agent SDK that Ptah chat uses, ' +
      'with your existing Claude sign-in. Once that SDK is available, Re-detect.',
  },
};

/** Permission tone → badge fill; text stays `text-base-content` (deviation 6). */
const BADGE: Readonly<Record<CliPermissionTone | 'success', string>> = {
  success: 'border-success/40 bg-success/10',
  warning: 'border-warning/40 bg-warning/10',
  info: 'border-info/40 bg-info/10',
  error: 'border-error/40 bg-error/10',
  neutral: 'border-base-content-muted/40 bg-base-300',
};
/** A table cell keeps its column narrow (13rem); the instance cards' cells take their full width instead. */
const CELL = `${CLI_MATRIX_CELL_BASE} max-w-[13rem]`;
const SAVE_SCOPE = 'global';

/**
 * CLI Agents & Custom Instances matrix (plan :710-742, design-spec §3.5, prototype `orchestration.html` section 2).
 * One `table-sm` row per installed system CLI (ranked by the preferred order), then an "Uninstalled" group with
 * install guides (#71, #77), collapsed by default behind a disclosure row (Gate V 36 decision 1, the Electron fold).
 * Under a hairline, the Ptah CLI instances in their own sub-section (`PtahCliInstancesComponent`: one card each, with
 * the Add). Rows come from `cliMatrixRows` (Batch 29); this component owns every write, modal and focus return.
 * - On/off: system → `disabledClis`; instance → `ptahCli:update.enabled`. Model and Effort cells open
 *   `CliModelEffortPopoverComponent`. Every write is `state.saveSettings` through `SettingsSaveFeedbackService`
 *   (Undo except Delete; Batch 17 constraint), and each caller acts on that save's own result (M2).
 * - Status shows only what detection reports for system CLIs (D11); instance cards show their status, key status,
 *   tier models and their last Test: latency, or a fixed failure sentence (#43, #44, #54, #52, RUX-11; S1, M1).
 * - Permissions & Safety: badge + ℹ popover (#70). A disabled or not-installed row renders its cells as plain text.
 * - Instance actions (V36-7): Tiers and Test inline, Edit and Delete in a "More actions" popover.
 * Since Batch 31: Cursor's Credentials popover (#64, 551) on both its rows, and Copilot's auto-approve toggle inside its
 * permission popover. Since Batch 32: "Add Ptah CLI Instance" (instances sub-section, or its empty state) and each instance's
 * Tiers and Edit open their centered modals; a create runs the new instance's Test (M4).
 */
@Component({
  selector: 'ptah-cli-orchestration-matrix',
  standalone: true,
  imports: [
    SettingsBusyDisabledDirective,
    AgentOrchestrationConfigComponent,
    LucideAngularModule,
    NativePopoverComponent,
    ProviderMarkComponent,
    CliModelEffortPopoverComponent,
    CopilotAutoApproveToggleComponent,
    CursorCredentialPopoverComponent,
    AddCliInstanceModalComponent,
    CliTierMappingModalComponent,
    ClaudeLaneAccountCellComponent,
    PtahCliInstancesComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="flex flex-col gap-4"
      aria-labelledby="cli-matrix-heading"
      data-testid="settings-cli-matrix"
    >
      <div section-header class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2
          id="cli-matrix-heading"
          class="flex items-center gap-1.5 text-sm font-semibold normal-case text-base-content"
        >
          <lucide-angular
            [img]="TerminalIcon"
            class="h-4 w-4 text-primary"
            aria-hidden="true"
          />
          CLI Agents &amp; Custom Instances Matrix
        </h2>
        <!-- Wide only: the narrow (Electron) box keeps the header to one line. -->
        <span class="cli-wide-only text-xs text-base-content-muted"
          >Click model or effort cells to reassign in place</span
        >
      </div>

      <ptah-agent-orchestration-config />

      <!-- A glass tile in glass themes, a base-100 plate with a hairline in solid themes. The table fits its width
           (headers and permission badges wrap); overflow-x-auto is only a safety net. -->
      <div
        class="overflow-x-auto rounded-lg border border-base-content/10"
        data-glass-surface="tile"
      >
        <!-- table-sm density; cell padding is set in the styles below (wide and narrow).
             tabindex -1: the cli-agents deep link focuses the table (Batch 34); it is not a Tab stop. -->
        <table
          class="cli-table table table-sm w-full scroll-mt-4"
          aria-labelledby="cli-matrix-heading"
          data-testid="cli-matrix"
          tabindex="-1"
          [attr.aria-busy]="loading()"
        >
          <thead>
            <tr
              class="cli-head whitespace-normal border-b border-base-content/10 text-xs font-semibold uppercase tracking-wide text-base-content-muted"
            >
              <th>On</th>
              <th>Agent / Instance</th>
              <th class="cli-col-narrow-hidden">Status</th>
              <th class="cli-col-narrow-hidden">Provider</th>
              <th>Model</th>
              <th>Effort</th>
              <th>Permissions &amp; Safety</th>
              <th class="text-right">Actions</th>
            </tr>
          </thead>
          @for (group of groups(); track group.id) {
            <tbody
              [attr.data-testid]="
                group.id === 'uninstalled' ? 'cli-matrix-uninstalled' : null
              "
            >
              @if (group.id === 'uninstalled') {
                <!-- Decision 1 (Gate V 36): collapsed by default; the disclosure expands the rows in place. -->
                <tr class="border-b border-base-content/10">
                  <th colspan="8" scope="colgroup" class="py-1">
                    <button
                      type="button"
                      [class]="
                        'btn btn-ghost btn-sm gap-1.5 px-2 text-xs font-semibold text-base-content ' +
                        focusRing
                      "
                      [attr.aria-expanded]="uninstalledShown()"
                      (click)="toggleUninstalled()"
                      data-testid="cli-matrix-uninstalled-toggle"
                    >
                      <lucide-angular
                        [img]="
                          uninstalledShown() ? ChevronIcon : ChevronRightIcon
                        "
                        class="h-4 w-4"
                        aria-hidden="true"
                      />
                      Uninstalled CLI agents ({{ group.rows.length }})
                    </button>
                  </th>
                </tr>
              }
              @for (
                row of group.id === 'uninstalled' && !uninstalledShown()
                  ? []
                  : group.rows;
                track row.id
              ) {
                <tr
                  class="cli-row"
                  [attr.data-testid]="'cli-matrix-row-' + row.id"
                  [attr.data-kind]="row.kind"
                  [class.border-primary]="rowOpen(row.id)"
                  [attr.data-dimmed]="row.interactive ? null : 'true'"
                >
                  <td class="align-middle">
                    <input
                      type="checkbox"
                      [class]="
                        'cli-check checkbox checkbox-primary checkbox-sm ' + focusRing
                      "
                      [checked]="row.enabled && row.installed"
                      [disabled]="!row.installed"
                      [ptahBusyDisabled]="busy() || !canWrite()"
                      [attr.aria-label]="row.name + ' enabled'"
                      (change)="toggle(row, $event)"
                      [attr.data-testid]="'cli-matrix-toggle-' + row.id"
                    />
                  </td>
                  <td>
                    <!-- One line next to the name (prototype): the version is the normalised token (Batch 52.1); a line with none
               truncates, with the CLI's own line in the title. -->
                    <div
                      class="cli-name-line flex min-w-0 flex-nowrap items-baseline gap-1.5 text-sm font-semibold"
                      [class.text-base-content-muted]="!row.interactive"
                    >
                      <span class="shrink-0 whitespace-nowrap">{{
                        row.name
                      }}</span>
                      @if (row.versionLabel) {
                        <span
                          class="min-w-0 max-w-[8rem] truncate whitespace-nowrap text-xs font-normal text-base-content-muted"
                          [title]="versionTitle(row)"
                          data-testid="cli-matrix-version"
                          >{{ row.versionLabel }}</span
                        >
                      }
                    </div>
                    <!-- P6: the Claude lane's account, under its name (wraps there, so long names never push the model/effort cells). -->
                    @if (
                      row.cli === 'claude' &&
                      row.installed
                    ) {
                      <ptah-claude-lane-account-cell />
                    }
                    <!-- Narrow containers (Electron beside the shell sidebar) show the provider and status here instead of their columns. -->
                    <!-- One line in the narrow layout (Electron fold): the badge keeps its size; the provider truncates, full in its title. -->
                    <div
                      class="cli-narrow-inline mt-0.5 min-w-0 flex-nowrap items-center gap-1"
                      data-testid="cli-matrix-narrow-inline"
                    >
                      <span
                        class="badge badge-outline badge-sm shrink-0 gap-1 whitespace-nowrap text-xs font-medium text-base-content border-base-300"
                        data-testid="cli-matrix-status-inline"
                      >
                        <span
                          [class]="
                            'h-1.5 w-1.5 shrink-0 rounded-full ' +
                            dot[row.status.tone]
                          "
                          aria-hidden="true"
                        ></span>
                        {{ row.status.label }}
                      </span>
                      <span
                        class="flex shrink-0 items-center gap-1 text-xs text-base-content-muted"
                        [title]="providerLabel(row)"
                      >
                        <ptah-provider-mark
                          [providerId]="providerMarkId(row)"
                          fallback="Terminal"
                          size="sm"
                        />
                        <span class="sr-only"
                          >Provider: {{ providerLabel(row) }}</span
                        >
                      </span>
                    </div>
                  </td>
                  <td class="cli-col-narrow-hidden">
                    <span
                      class="badge badge-outline badge-sm gap-1 whitespace-nowrap text-xs font-medium text-base-content border-base-300"
                      data-testid="cli-matrix-status"
                    >
                      <span
                        [class]="
                          'h-1.5 w-1.5 shrink-0 rounded-full ' +
                          dot[row.status.tone]
                        "
                        aria-hidden="true"
                      ></span>
                      {{ row.status.label }}
                    </span>
                  </td>
                  <td
                    class="cli-col-narrow-hidden min-w-[5rem] text-xs"
                    [class.text-base-content-muted]="!row.interactive"
                  >
                    <span class="inline-flex min-w-0 items-center gap-1.5">
                      <ptah-provider-mark
                        [providerId]="providerMarkId(row)"
                        fallback="Terminal"
                      />
                      <span class="min-w-0 truncate">{{
                        providerLabel(row)
                      }}</span>
                    </span>
                  </td>
                  <!-- The model column keeps a readable width; long ids wrap at word breaks (prototype: 2 lines at most). -->
                  <td>
                    @if (!row.installed) {
                      <span class="font-mono text-xs text-base-content-muted"
                        >—</span
                      >
                    } @else if (modelValue(row); as value) {
                      @if (row.interactive) {
                        <ptah-native-popover
                          [isOpen]="isOpen(row.id, 'model')"
                          placement="bottom-start"
                          [hasBackdrop]="true"
                          backdropClass="transparent"
                          (closed)="close()"
                          (opened)="focusOpened()"
                        >
                          <button
                            trigger
                            type="button"
                            [class]="cell"
                            [ptahBusyDisabled]="busy()"
                            (click)="toggleCell(row.id, 'model')"
                            [attr.aria-label]="
                              row.name + ' model: ' + value + '. Change'
                            "
                            [attr.aria-expanded]="isOpen(row.id, 'model')"
                            [title]="modelTitle(row)"
                            [attr.data-testid]="'cli-matrix-model-' + row.id"
                          >
                            <span class="line-clamp-2 break-words">{{
                              value
                            }}</span>
                            <lucide-angular
                              [img]="ChevronIcon"
                              class="h-2.5 w-2.5 shrink-0 text-base-content-muted"
                              aria-hidden="true"
                            />
                          </button>
                          @if (isOpen(row.id, 'model')) {
                            <ptah-cli-model-effort-popover
                              content
                              [row]="row"
                              field="model"
                              (closed)="close()"
                            />
                          }
                        </ptah-native-popover>
                      } @else {
                        <span
                          class="line-clamp-2 break-words font-mono text-xs text-base-content-muted"
                          [title]="modelTitle(row)"
                          >{{ value }}</span
                        >
                      }
                    }
                  </td>
                  <td class="whitespace-nowrap">
                    @if (!row.installed) {
                      <span class="font-mono text-xs text-base-content-muted"
                        >—</span
                      >
                    } @else if (row.effort) {
                      @if (row.interactive) {
                        <ptah-native-popover
                          [isOpen]="isOpen(row.id, 'effort')"
                          placement="bottom-start"
                          [hasBackdrop]="true"
                          backdropClass="transparent"
                          (closed)="close()"
                          (opened)="focusOpened()"
                        >
                          <button
                            trigger
                            type="button"
                            [class]="cell"
                            [ptahBusyDisabled]="busy()"
                            (click)="toggleCell(row.id, 'effort')"
                            [attr.aria-label]="
                              row.name +
                              ' reasoning effort: ' +
                              (row.effort.value || 'default') +
                              '. Change'
                            "
                            [attr.aria-expanded]="isOpen(row.id, 'effort')"
                            [attr.data-testid]="'cli-matrix-effort-' + row.id"
                          >
                            {{ row.effort.value || 'default' }}
                            <lucide-angular
                              [img]="ChevronIcon"
                              class="h-2.5 w-2.5 shrink-0 text-base-content-muted"
                              aria-hidden="true"
                            />
                          </button>
                          @if (isOpen(row.id, 'effort')) {
                            <ptah-cli-model-effort-popover
                              content
                              [row]="row"
                              field="effort"
                              (closed)="close()"
                            />
                          }
                        </ptah-native-popover>
                      } @else {
                        <span
                          class="font-mono text-xs text-base-content-muted"
                          >{{ row.effort.value || 'default' }}</span
                        >
                      }
                    } @else {
                      <span class="font-mono text-xs text-base-content-muted"
                        >n/a</span
                      >
                    }
                  </td>
                  <td>
                    <div class="inline-flex items-center gap-1">
                      <span
                        [class]="
                          'badge badge-outline badge-sm h-auto min-h-5 whitespace-normal py-0.5 text-left text-xs font-medium leading-snug text-base-content ' +
                          badge[row.permission.tone]
                        "
                        data-testid="cli-matrix-permission"
                        >{{ row.permission.badge }}</span
                      >
                      <ptah-native-popover
                        [isOpen]="isOpen(row.id, 'permission')"
                        placement="bottom-end"
                        [hasBackdrop]="true"
                        backdropClass="transparent"
                        (closed)="close()"
                      >
                        <button
                          trigger
                          type="button"
                          [class]="
                            'btn btn-ghost btn-sm btn-square ' +
                            focusRing
                          "
                          [attr.aria-label]="row.name + ' permission details'"
                          [attr.aria-expanded]="isOpen(row.id, 'permission')"
                          (click)="toggleCell(row.id, 'permission')"
                          [attr.data-testid]="
                            'cli-matrix-permission-info-' + row.id
                          "
                        >
                          <lucide-angular
                            [img]="InfoIcon"
                            class="h-4 w-4 text-info"
                            aria-hidden="true"
                          />
                        </button>
                        @if (isOpen(row.id, 'permission')) {
                          <div
                            content
                            role="dialog"
                            [attr.aria-labelledby]="
                              'cli-permission-title-' + row.id
                            "
                            class="w-[17rem] max-w-[calc(100vw-2rem)] space-y-2 whitespace-normal p-3 text-left"
                            data-testid="cli-permission-popover"
                          >
                            <div
                              class="flex items-center justify-between gap-2 border-b border-base-300 pb-1.5"
                            >
                              <h3
                                [id]="'cli-permission-title-' + row.id"
                                class="flex items-center gap-1.5 text-xs font-bold text-base-content"
                              >
                                <lucide-angular
                                  [img]="ShieldIcon"
                                  class="h-3.5 w-3.5 text-warning"
                                  aria-hidden="true"
                                />
                                {{ row.name }} permissions
                              </h3>
                              <button
                                type="button"
                                [class]="
                                  'btn btn-ghost btn-sm btn-square ' +
                                  focusRing
                                "
                                aria-label="Close"
                                (click)="close()"
                              >
                                <lucide-angular
                                  [img]="CloseIcon"
                                  class="h-4 w-4"
                                  aria-hidden="true"
                                />
                              </button>
                            </div>
                            <p
                              class="text-xs leading-relaxed text-base-content"
                            >
                              {{ row.permission.detail }}
                            </p>
                            <!-- Batch 31: Copilot's auto-approve lives in its permission popover (moved from the old policy section). -->
                            @if (
                              row.cli === 'copilot'
                            ) {
                              <ptah-copilot-auto-approve-toggle />
                            }
                          </div>
                        }
                      </ptah-native-popover>
                    </div>
                  </td>
                  <td class="text-right">
                      <div
                        class="inline-flex flex-wrap items-center justify-end gap-1"
                      >
                        <!-- Batch 31: Cursor's Credentials, on its installed and its Uninstalled row alike (it installs once a key resolves). -->
                        @if (row.credentialAction) {
                          <ptah-native-popover
                            [isOpen]="isOpen(row.id, 'credentials')"
                            placement="bottom-end"
                            [hasBackdrop]="true"
                            backdropClass="transparent"
                            (closed)="closeCredentials(row.id)"
                            (opened)="focusCredentialKey()"
                          >
                            <button
                              trigger
                              type="button"
                              [class]="ACTION"
                              (click)="toggleCell(row.id, 'credentials')"
                              [attr.aria-label]="'Credentials for ' + row.name"
                              [attr.aria-expanded]="
                                isOpen(row.id, 'credentials')
                              "
                              [attr.data-testid]="
                                'cli-matrix-credentials-' + row.id
                              "
                            >
                              Credentials
                            </button>
                            @if (isOpen(row.id, 'credentials')) {
                              <ptah-cursor-credential-popover
                                content
                                (closed)="closeCredentials(row.id)"
                              />
                            }
                          </ptah-native-popover>
                        }
                        @if (!row.installed) {
                          <ptah-native-popover
                            [isOpen]="isOpen(row.id, 'install')"
                            placement="bottom-end"
                            [hasBackdrop]="true"
                            backdropClass="transparent"
                            (closed)="close()"
                          >
                            <button
                              trigger
                              type="button"
                              [class]="ACTION"
                              (click)="toggleCell(row.id, 'install')"
                              [attr.aria-label]="
                                'Install guide for ' + row.name
                              "
                              [attr.aria-expanded]="isOpen(row.id, 'install')"
                              [attr.data-testid]="
                                'cli-matrix-install-' + row.id
                              "
                            >
                              Install guide
                            </button>
                            @if (isOpen(row.id, 'install')) {
                              <div
                                content
                                role="dialog"
                                [attr.aria-labelledby]="
                                  'cli-install-title-' + row.id
                                "
                                class="w-[18rem] max-w-[calc(100vw-2rem)] space-y-2 whitespace-normal p-3 text-left"
                                data-testid="cli-install-popover"
                              >
                                <div
                                  class="flex items-center justify-between gap-2 border-b border-base-300 pb-1.5"
                                >
                                  <h3
                                    [id]="'cli-install-title-' + row.id"
                                    class="text-xs font-bold text-base-content"
                                  >
                                    Install {{ row.name }}
                                  </h3>
                                  <button
                                    type="button"
                                    [class]="
                                      'btn btn-ghost btn-sm btn-square ' +
                                      focusRing
                                    "
                                    aria-label="Close"
                                    (click)="close()"
                                  >
                                    <lucide-angular
                                      [img]="CloseIcon"
                                      class="h-4 w-4"
                                      aria-hidden="true"
                                    />
                                  </button>
                                </div>
                                @if (installGuide(row).command; as command) {
                                  <code
                                    class="block select-all break-all rounded bg-base-300 px-2 py-1 font-mono text-xs text-base-content"
                                    >{{ command }}</code
                                  >
                                }
                                <p
                                  class="text-xs leading-relaxed text-base-content"
                                >
                                  {{ installGuide(row).note }}
                                </p>
                                <div
                                  class="flex items-center gap-2 border-t border-base-300 pt-2"
                                >
                                  <button
                                    type="button"
                                    [class]="
                                      'btn btn-outline btn-sm shrink-0 gap-1.5 text-xs ' +
                                      focusRing
                                    "
                                    [ptahBusyDisabled]="guideDetecting()"
                                    (click)="redetectFromGuide(row.id)"
                                    [attr.data-testid]="
                                      'cli-install-redetect-' + row.id
                                    "
                                  >
                                    @if (guideDetecting()) {
                                      <span
                                        class="loading loading-spinner loading-xs"
                                        aria-hidden="true"
                                      ></span>
                                      Detecting…
                                    } @else {
                                      <lucide-angular
                                        [img]="RefreshIcon"
                                        class="h-3 w-3"
                                        aria-hidden="true"
                                      />
                                      Re-detect
                                    }
                                  </button>
                                </div>
                              </div>
                            }
                          </ptah-native-popover>
                        }
                      </div>
                  </td>
                </tr>
              } @empty {
                @if (group.id === 'installed') {
                  <tr>
                    <td
                      colspan="8"
                      class="text-base-content-muted"
                      data-testid="cli-matrix-empty"
                    >
                      {{
                        loading()
                          ? 'Loading CLI agents…'
                          : 'No CLI agent is installed. Install one from the list below, then Re-detect.'
                      }}
                    </td>
                  </tr>
                }
              }
            </tbody>
          }
        </table>
      </div>

      <!-- The Ptah CLI instances: their own sub-section under a hairline, with Add and one card per instance. -->
      <ptah-cli-instances
        [rows]="instances()"
        [empty]="noInstances()"
        [busy]="busy()"
        [canWrite]="canWrite()"
        [testing]="testing()"
        [testingId]="testingId()"
        [confirmDeleteId]="confirmDelete()"
        [openCell]="openCell()"
        (addRequested)="openAdd($event)"
        (toggled)="toggle($event.row, $event.event)"
        (cellToggled)="toggleCell($event.rowId, $event.kind)"
        (cellOpened)="focusOpened()"
        (moreOpened)="focusFirstIn('cli-matrix-more-menu')"
        (closed)="close()"
        (tiersRequested)="openTiers($event)"
        (testRequested)="test($event)"
        (editRequested)="openEdit($event)"
        (deleteAsked)="askDelete($event)"
        (deleteCancelled)="cancelDelete($event)"
        (deleteConfirmed)="remove($event)"
      />
    </section>

    <!-- Batch 32: centered modals on the shared native <dialog> (design-spec §6), in this lazy chunk. -->
    <ptah-add-cli-instance-modal
      [open]="addOpen()"
      [editing]="editTarget()"
      (created)="onCreated($event)"
      (closed)="closeAdd()"
    />
    <ptah-cli-tier-mapping-modal
      [open]="tierTarget() !== null"
      [target]="tierTarget()"
      (closed)="closeTiers()"
    />
  `,
  // Container-width layout (the Q-extra-1 rule): every column in a wide box (VS Code at 1024 px, as in the
  // prototype); in a narrow one (Electron's page beside the shell sidebar) status and provider move under the agent
  // name, and headers and permission badges wrap so the table fits its box.
  styles: `
    :host {
      display: block;
      container-type: inline-size;
    }
    /* Cells: 10 px block and 8 px inline padding (8 px both in the narrow box, below), so every column of the wide
       VS Code box fits beside the others; rows read as rows, not lines. The On box is daisyUI's
       checkbox-sm (20 px), whose tick is drawn centred at that native size. */
    .cli-head > th {
      padding-block: 0.625rem;
      padding-inline: 0.5rem;
    }
    .cli-row > td {
      padding-block: 0.625rem;
      padding-inline: 0.5rem;
      vertical-align: middle;
    }
    .cli-row {
      border-bottom: 1px solid oklch(var(--bc) / 0.1);
    }
    .cli-row:hover {
      background: oklch(var(--bc) / 0.05);
    }
    /* Rows stay transparent in glass as well; the open row uses its border. */
    :host-context(:root[data-glass='on']) .cli-row {
      background: transparent;
      box-shadow: none;
    }
    .cli-narrow-inline {
      display: none;
    }
    @container (max-width: 47.99rem) {
      .cli-col-narrow-hidden,
      .cli-wide-only {
        display: none;
      }
      .cli-narrow-inline {
        display: flex;
      }
      /* Narrow (Electron beside the shell sidebar): 8 px cells. The header, the name line and the permission badge
         wrap, so every column fits the box; the wrapper's overflow-x-auto is only a safety net. */
      .cli-head > th,
      .cli-row > td {
        padding-block: 0.5rem;
        padding-inline: 0.5rem;
      }
    }
    /* The tightest box, below 40rem: Electron's glass shell pads its root and gutters its panes by 8 px, which takes
       40 px from the page (a 625 px card at 1024 px with the Workspaces panel open). 4 px inline cells keep the six
       narrow columns inside it (at 8 px the table needed 613 px in a 591 px wrapper). */
    @container (max-width: 39.99rem) {
      .cli-head > th,
      .cli-row > td {
        padding-inline: 0.25rem;
      }
    }
    /* The status and provider beside the name only where the narrow box is wide enough (Electron's page beside the
       sidebar); below 36rem they wrap under it. */
    @container (min-width: 36rem) and (max-width: 47.99rem) {
      .cli-name-line {
        display: inline-flex;
      }
      .cli-narrow-inline {
        display: inline-flex;
        margin-left: 0.25rem;
      }
    }
  `,
})
export class CliOrchestrationMatrixComponent {
  protected readonly TerminalIcon = Terminal;
  protected readonly ChevronIcon = ChevronDown;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly InfoIcon = Info;
  protected readonly ShieldIcon = ShieldAlert;
  protected readonly CloseIcon = X;
  protected readonly focusRing = CLI_MATRIX_FOCUS;
  protected readonly cell = CELL;
  protected readonly ACTION = CLI_MATRIX_ACTION;
  protected readonly dot = CLI_MATRIX_DOT;
  protected readonly badge = BADGE;

  protected readonly RefreshIcon = RefreshCw;
  protected readonly guideDetecting = computed(
    () => this.state.cliDetection().status === 'loading',
  );

  protected readonly state = inject(ProvidersSettingsStateService);
  private readonly feedback = inject(SettingsSaveFeedbackService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly rows = computed(() =>
    cliMatrixRows({
      orchestration: this.state.orchestration().data,
      cliAgents: this.state.cliAgents().data,
      cliModels: this.state.cliModels().data,
      cliTest: this.state.cliTest().data,
    }),
  );
  /** The Ptah CLI instances, in the preferred order, for their own sub-section. */
  protected readonly instances = computed(() =>
    this.rows().installed.filter(
      (row): row is InstanceCliMatrixRow => row.kind === 'instance',
    ),
  );
  /** The installed system CLIs (always, for its empty state), then the Uninstalled group when it has rows (#71). */
  protected readonly groups = computed((): readonly MatrixGroup[] => {
    const { installed, uninstalled } = this.rows();
    const system = installed.filter(
      (row): row is SystemCliMatrixRow => row.kind === 'system',
    );
    const groups: MatrixGroup[] = [{ id: 'installed', rows: system }];
    if (uninstalled.length)
      groups.push({ id: 'uninstalled', rows: uninstalled });
    return groups;
  });
  /** Neither source has data yet (the container shows each section's own loading or error line). */
  protected readonly loading = computed(
    () => !this.state.orchestration().data && !this.state.cliAgents().data,
  );
  /** Save triggers wait while any save runs (D3). */
  protected readonly busy = this.feedback.saving;
  protected readonly canWrite = computed(
    () =>
      this.state.scopes().status === 'ready' &&
      this.state.reviewContext() !== null,
  );

  private readonly openState = signal<OpenCell | null>(null);
  /** The open popover, for the instance cards. */
  protected readonly openCell = this.openState.asReadonly();
  /** Decision 1: the Uninstalled group starts collapsed. */
  private readonly uninstalledOpen = signal(false);
  /** Expanded by the user, or holding the open popover (a Cursor key removal moves its row into this group). */
  protected readonly uninstalledShown = computed(() => {
    const open = this.openState();
    return (
      this.uninstalledOpen() ||
      (!!open && this.rows().uninstalled.some((row) => row.id === open.rowId))
    );
  });
  protected readonly confirmDelete = signal<string | null>(null);
  protected readonly testingId = signal<string | null>(null);
  /** Batch 32 modals: the add/edit form (with the instance it edits, or `null` to create) and the tier mapping. */
  protected readonly addOpen = signal(false);
  protected readonly editTarget = signal<CliInstanceEditTarget | null>(null);
  protected readonly tierTarget = signal<CliTierMappingTarget | null>(null);
  protected readonly noInstances = computed(
    () =>
      this.state.cliAgents().status === 'ready' &&
      !this.state.cliAgents().data?.length,
  );
  /** Which Add button opened the form: the empty-state one disappears once an instance exists (Minor 2). */
  private addOrigin: 'header' | 'empty' = 'header';

  protected toggleUninstalled(): void {
    this.uninstalledOpen.set(!this.uninstalledShown());
  }

  protected openAdd(origin: 'header' | 'empty'): void {
    this.close();
    this.addOrigin = origin;
    this.editTarget.set(null);
    this.addOpen.set(true);
  }

  protected openEdit(row: InstanceCliMatrixRow): void {
    this.close();
    this.editTarget.set({
      id: row.id,
      name: row.name,
      providerId: row.providerId,
      providerName: row.provider,
    });
    this.addOpen.set(true);
  }

  protected closeAdd(): void {
    this.addOpen.set(false);
    this.editTarget.set(null);
  }

  /**
   * M4: a created instance's key is stored, not verified, so its Test runs at once and its result is announced. Minor 2: from the
   * empty-state button, focus moves to the new row's first action (that button is gone). When the refreshed list does
   * not hold the new instance yet, no Test runs and a fixed toast says so (re-check N-1).
   */
  protected onCreated(name: string): void {
    const created = this.state
      .cliAgents()
      .data?.find(
        (agent) => agent.name.trim().toLowerCase() === name.toLowerCase(),
      );
    if (!created) {
      this.feedback.announce(
        `Created ${name}. ${CLI_TEST_NOT_STARTED}`,
        'alert',
      );
      return;
    }
    if (this.addOrigin === 'empty')
      this.focusAfterRender(
        `[data-testid="cli-matrix-tiers-${created.id}"]`,
        `[data-testid="cli-matrix-more-${created.id}"]`,
      );
    void this.test(created.id);
  }

  protected openTiers(row: InstanceCliMatrixRow): void {
    this.close();
    this.tierTarget.set({
      id: row.id,
      name: row.name,
      providerId: row.providerId,
      providerName: row.provider,
    });
  }

  /** Focus returns to the row's Tiers button, or to More when the narrow layout moved Tiers into it. */
  protected closeTiers(): void {
    const id = this.tierTarget()?.id;
    this.tierTarget.set(null);
    if (id)
      this.focusAfterRender(
        `[data-testid="cli-matrix-tiers-${id}"]`,
        `[data-testid="cli-matrix-more-${id}"]`,
      );
  }
  /** The instance whose Test ran last, for a test that failed before it produced a result. */
  private readonly lastTestedId = signal<string | null>(null);
  protected readonly testing = computed(
    () =>
      this.testingId() !== null || this.state.cliTest().status === 'loading',
  );

  protected isOpen(rowId: string, kind: OpenCell['kind']): boolean {
    const open = this.openState();
    return open?.rowId === rowId && open.kind === kind;
  }

  /** A row carrying an active editor rises above the otherwise uniform matrix rows. */
  protected rowOpen(rowId: string): boolean {
    return this.openState()?.rowId === rowId;
  }

  protected toggleCell(rowId: string, kind: OpenCell['kind']): void {
    this.openState.set(this.isOpen(rowId, kind) ? null : { rowId, kind });
  }

  protected close(): void {
    this.openState.set(null);
  }

  /**
   * The install guide's Re-detect: the same re-read as the policy bar's Re-detect CLIs. A CLI that is found
   * leaves the Uninstalled group, so the guide closes and focus follows the row; otherwise the page toast says why.
   */
  protected async redetectFromGuide(rowId: string): Promise<void> {
    if (this.guideDetecting()) return;
    if (!(await this.state.redetectClis())) {
      this.feedback.announce('Detection failed. Try again.', 'alert');
      return;
    }
    if (this.rows().uninstalled.some((row) => row.id === rowId)) {
      this.feedback.announce(
        'Still not found. Check the step above, then try again.',
        'status',
      );
      return;
    }
    this.close();
    this.focusAfterRender(`[data-testid="cli-matrix-toggle-${rowId}"]`);
  }

  /**
   * M3: a saved or removed Cursor key moves its row between groups, which re-creates the popover with focus on `body`;
   * closing returns focus to the row's Credentials trigger wherever the row now is. A removed key moves the row into
   * the Uninstalled group, which collapses again on close unless the user expanded it: focus then goes to that group's
   * disclosure button, never `body` (re-check N-2).
   */
  protected closeCredentials(rowId: string): void {
    this.close();
    this.focusAfterRender(
      `[data-testid="cli-matrix-credentials-${rowId}"]`,
      '[data-testid="cli-matrix-uninstalled-toggle"]',
    );
  }

  /** The "More actions" Delete: the inline confirm replaces the actions, so focus moves to its Cancel. */
  protected askDelete(rowId: string): void {
    this.close();
    this.confirmDelete.set(rowId);
    this.focusAfterRender(
      `[data-testid="cli-matrix-delete-confirm-${rowId}"] [data-cancel-delete]`,
    );
  }

  protected cancelDelete(rowId: string): void {
    this.confirmDelete.set(null);
    this.focusAfterRender(`[data-testid="cli-matrix-more-${rowId}"]`);
  }

  /** The panel takes focus when positioned; then its first control does (the model search opens its list). */
  protected focusOpened(): void {
    this.element.nativeElement
      .querySelector<HTMLElement>(
        '[data-testid="cli-matrix-popover"] input:not([disabled]), [data-testid="cli-matrix-popover"] button[aria-pressed="true"]',
      )
      ?.focus();
  }

  protected focusFirstIn(testid: string): void {
    const buttons = this.element.nativeElement.querySelectorAll<HTMLElement>(
      `[data-testid="${testid}"] button:not([disabled])`,
    );
    for (const button of buttons) {
      if (getComputedStyle(button).display !== 'none') {
        button.focus();
        return;
      }
    }
  }

  /** The Credentials popover's key field takes focus once the panel is positioned. */
  protected focusCredentialKey(): void {
    this.element.nativeElement
      .querySelector<HTMLElement>(
        '[data-testid="cursor-credential-key"]:not([disabled])',
      )
      ?.focus();
  }

  protected providerLabel(row: SystemCliMatrixRow): string {
    if (!row.installed) return 'None';
    return row.provider ?? 'Set by the model';
  }

  /** Registry or CLI id for `ptah-provider-mark`. Unknown ids use its Terminal fallback. */
  protected providerMarkId(row: SystemCliMatrixRow): string {
    return row.cli;
  }

  /** The version tooltip. A multi-line probe stays off the page; the token label is enough. */
  protected versionTitle(row: SystemCliMatrixRow): string | null {
    if (!row.version) return null;
    return isCliProcessDump(row.version) ? row.versionLabel : row.version;
  }

  /** The Model cell's text: one value, the model id (Batch 52.2); null when the instance's saved model has not loaded. */
  protected modelValue(row: SystemCliMatrixRow): string {
    return cliModelDisplay(row.model.value).label || 'provider default';
  }

  /** The Model cell's title: the full saved value, with a display name when the value carries one. */
  protected modelTitle(row: SystemCliMatrixRow): string | null {
    return row.model.value ? cliModelDisplay(row.model.value).title : null;
  }

  protected installGuide(
    row: SystemCliMatrixRow,
  ): (typeof CLI_INSTALL_GUIDES)[SystemCliType] {
    return CLI_INSTALL_GUIDES[row.cli];
  }

  /**
   * RUX-11: this instance's last Test, announced through the page toast with the instance name when the run ends (the
   * row's status badge keeps the latency of a passed test). Only this run's result counts (S1: the state drops the
   * previous one when a run starts and on any failure), and a failure is a fixed sentence (M1) followed by the state's
   * own fixed reason when it has one.
   */
  private testResult(
    row: InstanceCliMatrixRow,
  ): { readonly ok: boolean; readonly text: string } | null {
    if (row.lastTest) {
      if (row.lastTest.success) {
        return {
          ok: true,
          text:
            row.lastTest.latencyMs === null
              ? 'Test passed.'
              : `Test passed in ${row.lastTest.latencyMs}ms.`,
        };
      }
      return {
        ok: false,
        text: cliTestFailedText(row.lastTest.reason),
      };
    }
    if (
      this.lastTestedId() === row.id &&
      this.state.cliTest().status === 'error'
    )
      return { ok: false, text: CLI_TEST_NOT_RUN };
    return null;
  }

  protected async test(id: string): Promise<void> {
    if (this.testing()) return;
    this.testingId.set(id);
    this.lastTestedId.set(id);
    try {
      await this.state.testCliConnection(id);
    } finally {
      this.testingId.set(null);
    }
    const { installed, uninstalled } = this.rows();
    const row = [...installed, ...uninstalled].find(
      (candidate): candidate is InstanceCliMatrixRow =>
        candidate.kind === 'instance' && candidate.id === id,
    );
    const result = row ? this.testResult(row) : null;
    // Named: a later Test of another instance replaces this toast, so each one says whose result it is.
    if (row && result) this.feedback.announce(`${row.name}: ${result.text}`, result.ok ? 'status' : 'alert');
  }

  /**
   * On/off. The checkbox keeps showing the saved value; the read-back after the write moves it. System rows write
   * `disabledClis`, instances `ptahCli:update.enabled`. Undo restores only this CLI's entry, against the list as it is
   * when Undo runs (Minor 4), so it never overwrites another CLI's change made in between.
   */
  protected async toggle(row: CliMatrixRow, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const enabled = input.checked;
    input.checked = row.enabled;
    const context = this.state.reviewContext();
    if (!context || this.busy()) return;
    const label = `${row.name} ${enabled ? 'on' : 'off'}`;
    if (row.kind === 'system') {
      const set = (on: boolean) => () => {
        const others = (
          this.state.orchestration().data?.disabledClis ?? []
        ).filter((cli) => cli !== row.cli);
        return this.state.saveSettings(
          {
            orchestration: { disabledClis: on ? others : [...others, row.cli] },
          },
          context,
        );
      };
      await this.feedback.save({
        label,
        scope: SAVE_SCOPE,
        write: set(enabled),
        undo: set(row.enabled),
      });
      return;
    }
    const write = (value: boolean) => () =>
      this.state.saveSettings(
        { cli: [{ action: 'update', params: { id: row.id, enabled: value } }] },
        context,
      );
    await this.feedback.save({
      label,
      scope: SAVE_SCOPE,
      write: write(enabled),
      undo: write(row.enabled),
    });
  }

  /** Delete after the inline confirm (#55). No Undo: a deleted instance's stored key cannot be written back. */
  protected async remove(row: InstanceCliMatrixRow): Promise<void> {
    const context = this.state.reviewContext();
    if (!context || this.busy()) return;
    const result = await this.feedback.save({
      label: `removal of ${row.name}`,
      scope: SAVE_SCOPE,
      write: () =>
        this.state.saveSettings(
          { cli: [{ action: 'delete', params: { id: row.id } }] },
          context,
        ),
      undo: null,
    });
    // M2: this save's own result, never an earlier commit.
    if (result === 'saved') this.confirmDelete.set(null);
  }

  /** Focuses the first selector present and shown after the next render; later ones are fallbacks. */
  private focusAfterRender(...selectors: readonly string[]): void {
    afterNextRender(
      () => {
        const root = this.element.nativeElement;
        for (const selector of selectors) {
          const target = root.querySelector<HTMLElement>(selector);
          // The narrow layout hides inline Tiers and Test (they move into More).
          if (target && getComputedStyle(target).display !== 'none') {
            target.focus();
            return;
          }
        }
      },
      { injector: this.injector },
    );
  }
}
