/**
 * McpPortConfigComponent - MCP Server Port & Browser automation configuration
 *
 * Card on the Advanced tab (pattern map rows A30-A32, P2/P3/P4).
 * Combines MCP server port configuration (P3 policy bar), MCP tool namespaces (P4 matrix),
 * and browser "Allow localhost" access (folded from retired browser-settings, A32).
 *
 * All writes route through {@link SettingsSaveFeedbackService.saveGeneric}:
 * - Port save (A30): S-explicit with Undo restoring the previous port and persistent restart note.
 * - Tool namespaces (A31): S-sel with Undo restoring the previous disabled array.
 * - Allow localhost (A32): Enabling requires inline confirmation (S-confirm, P8); disabling is immediate with Undo (S-sel).
 * - Host error text is never surfaced to visible text or toasts (D15).
 */

import {
  Component,
  inject,
  ChangeDetectionStrategy,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Plug,
  AlertCircle,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';

export const COULD_NOT_SAVE_PORT = 'Could not save the MCP port.';
export const COULD_NOT_UPDATE_NAMESPACES = 'Could not update MCP tool namespaces.';
export const COULD_NOT_UPDATE_LOCALHOST = 'Could not update browser localhost setting.';

@Component({
  selector: 'ptah-mcp-port-config',
  standalone: true,
  imports: [LucideAngularModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="card bg-base-200 border border-base-300 p-3" aria-labelledby="mcp-browser-heading">
      <div class="flex items-center gap-1.5 mb-2">
        <lucide-angular [img]="PlugIcon" class="w-4 h-4 text-secondary shrink-0" aria-hidden="true" />
        <h2 id="mcp-browser-heading" class="text-xs font-bold uppercase tracking-wider text-base-content">
          MCP & Browser
        </h2>
      </div>
      <p class="text-xs text-base-content-muted mb-3">
        Configure Ptah's local MCP server port and tool namespaces for AI agents.
      </p>

      <!-- Port policy bar (P3, row A30) -->
      <div class="flex flex-wrap items-center gap-2 rounded border border-base-300 py-2 px-3 text-xs mb-3">
        <label for="mcp-port-input" class="font-bold text-base-content whitespace-nowrap">
          MCP port
        </label>
        <input
          id="mcp-port-input"
          type="number"
          class="input input-bordered input-xs w-28 text-base-content"
          [ngModel]="portValue()"
          (ngModelChange)="onPortInput($event)"
          [min]="1024"
          [max]="65535"
          placeholder="51820"
          [disabled]="saving()"
          aria-label="MCP server port"
          data-testid="mcp-port-input"
        />
        <button
          type="button"
          class="btn btn-primary btn-xs gap-1"
          (click)="savePort()"
          [disabled]="saving() || !isDirty() || validationError() !== null"
          aria-label="Save MCP port"
          data-testid="mcp-port-save-btn"
        >
          Save
        </button>
        <span class="text-[10px] text-base-content-muted whitespace-nowrap">
          Default 51820 · Range 1024–65535 · Changes apply after the MCP server restarts.
        </span>
      </div>

      <!-- Validation error (panel-level validation or fixed error sentence) -->
      @if (validationError(); as err) {
        <div
          role="alert"
          class="flex items-center gap-1 mb-3 text-xs text-base-content"
          data-testid="mcp-port-validation-error"
        >
          <lucide-angular [img]="AlertCircleIcon" class="w-3.5 h-3.5 text-error shrink-0" aria-hidden="true" />
          <span>{{ err }}</span>
        </div>
      }

      <!-- Namespaces & browser matrix (P4, rows A31-A32) -->
      <div class="overflow-x-auto">
        <table class="table table-xs">
          <thead>
            <tr>
              <th class="w-10" scope="col">On</th>
              <th scope="col">Namespace</th>
              <th scope="col">Tools</th>
              <th scope="col">Description</th>
            </tr>
          </thead>
          <tbody>
            @for (ns of namespaceOptions; track ns.id) {
              <tr>
                <td class="align-top">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-xs checkbox-primary"
                    [checked]="isNamespaceEnabled(ns.id)"
                    (change)="toggleNamespace(ns.id)"
                    [disabled]="saving()"
                    [attr.aria-label]="'Toggle ' + ns.label + ' namespace'"
                    [attr.data-testid]="'settings-toggle-mcp-namespace-' + ns.id"
                  />
                </td>
                <td class="align-top font-medium text-xs text-base-content whitespace-nowrap">
                  {{ ns.label }}
                </td>
                <td class="align-top">
                  <span class="badge badge-outline badge-xs text-base-content">
                    {{ ns.toolCount }}
                  </span>
                </td>
                <td class="align-top text-xs text-base-content-muted">
                  {{ ns.description }}
                </td>
              </tr>
            }

            <!-- Allow localhost row (A32, folded from browser-settings) -->
            <tr>
              <td class="align-top">
                <input
                  type="checkbox"
                  class="checkbox checkbox-xs checkbox-primary"
                  [checked]="browserAllowLocalhost()"
                  (change)="onAllowLocalhostToggle($event)"
                  [disabled]="saving() || confirmingAllowLocalhost()"
                  aria-label="Allow localhost access for browser tools"
                  data-testid="settings-toggle-browser-allow-localhost"
                />
              </td>
              <td class="align-top font-medium text-xs text-base-content whitespace-nowrap">
                Allow localhost
              </td>
              <td class="align-top text-xs text-base-content-muted">
                —
              </td>
              <td class="align-top text-xs text-base-content">
                <p class="text-base-content-muted">
                  Allow browser tools to navigate to localhost URLs (dev servers, local APIs). Enables AI agents to access local network services.
                </p>
                @if (confirmingAllowLocalhost()) {
                  <div
                    role="group"
                    aria-label="Confirm allow localhost access"
                    class="mt-2 space-y-2 rounded border border-base-300 p-2 text-left"
                    data-testid="allow-localhost-confirm"
                  >
                    <p class="text-xs text-base-content">
                      Enabling localhost access lets AI agents reach local network services, development servers, and local APIs on this machine.
                    </p>
                    <div class="flex gap-2">
                      <button
                        type="button"
                        class="btn btn-outline btn-xs border-warning text-base-content"
                        [disabled]="saving()"
                        (click)="confirmEnableLocalhost()"
                        data-testid="allow-localhost-confirm-btn"
                      >
                        Allow localhost
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs text-base-content"
                        [disabled]="saving()"
                        (click)="cancelEnableLocalhost()"
                        data-testid="allow-localhost-cancel-btn"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                }
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class McpPortConfigComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly feedback = inject(SettingsSaveFeedbackService);

  readonly PlugIcon = Plug;
  readonly AlertCircleIcon = AlertCircle;

  /** Save triggers disabled while any save is in flight (D3). */
  readonly saving = this.feedback.saving;

  readonly portValue = signal<number>(51820);
  readonly savedPort = signal<number>(51820);
  readonly isDirty = computed(() => this.portValue() !== this.savedPort());
  readonly validationError = signal<string | null>(null);

  /** Namespace toggle state */
  readonly disabledNamespaces = signal<string[]>([]);
  readonly savedDisabledNamespaces = signal<string[]>([]);

  /** Browser allow localhost state (A32) */
  readonly browserAllowLocalhost = signal<boolean>(false);
  readonly savedBrowserAllowLocalhost = signal<boolean>(false);
  readonly confirmingAllowLocalhost = signal<boolean>(false);

  readonly namespaceOptions = [
    {
      id: 'browser',
      label: 'Browser Automation',
      description: 'Navigate, screenshot, click, type, evaluate',
      toolCount: 12,
    },
    {
      id: 'agent',
      label: 'CLI Agents',
      description: 'Spawn, monitor, and control CLI agents',
      toolCount: 6,
    },
    {
      id: 'git',
      label: 'Git Worktree',
      description: 'Create and manage git worktrees',
      toolCount: 3,
    },
    {
      id: 'ide',
      label: 'IDE / LSP',
      description: 'Symbol references, definitions, dirty files',
      toolCount: 3,
    },
    {
      id: 'json',
      label: 'JSON Validation',
      description: 'Validate and repair JSON files',
      toolCount: 1,
    },
  ] as const;

  async ngOnInit(): Promise<void> {
    await this.loadConfig();
  }

  private async loadConfig(): Promise<void> {
    try {
      const result = await this.rpcService.call('agent:getConfig', undefined);
      if (result.isSuccess() && result.data) {
        if (result.data.mcpPort) {
          this.portValue.set(result.data.mcpPort);
          this.savedPort.set(result.data.mcpPort);
        }
        if (result.data.disabledMcpNamespaces) {
          this.disabledNamespaces.set(result.data.disabledMcpNamespaces);
          this.savedDisabledNamespaces.set(result.data.disabledMcpNamespaces);
        }
        const allowLocalhost = result.data.browserAllowLocalhost ?? false;
        this.browserAllowLocalhost.set(allowLocalhost);
        this.savedBrowserAllowLocalhost.set(allowLocalhost);
      }
    } catch {
      // Configuration read failures leave defaults intact
    }
  }

  onPortInput(value: number): void {
    this.portValue.set(value);

    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      this.validationError.set('Port must be a valid integer');
    } else if (value < 1024 || value > 65535) {
      this.validationError.set('Port must be between 1024 and 65535');
    } else {
      this.validationError.set(null);
    }
  }

  async savePort(): Promise<void> {
    const port = this.portValue();
    if (!Number.isFinite(port) || !Number.isInteger(port)) {
      this.validationError.set('Port must be a valid integer');
      return;
    }
    if (port < 1024 || port > 65535) {
      this.validationError.set('Port must be between 1024 and 65535');
      return;
    }

    this.validationError.set(null);
    const previousPort = this.savedPort();

    await this.feedback.saveGeneric({
      label: 'MCP port',
      write: async () => {
        try {
          const result = await this.rpcService.call('agent:setConfig', {
            mcpPort: port,
          });
          if (result.isSuccess() && result.data?.success === true) {
            this.savedPort.set(port);
            return { ok: true };
          }
          this.validationError.set(COULD_NOT_SAVE_PORT);
          return { ok: false, message: COULD_NOT_SAVE_PORT };
        } catch {
          this.validationError.set(COULD_NOT_SAVE_PORT);
          return { ok: false, message: COULD_NOT_SAVE_PORT };
        }
      },
      undo: async () => {
        try {
          const result = await this.rpcService.call('agent:setConfig', {
            mcpPort: previousPort,
          });
          if (result.isSuccess() && result.data?.success === true) {
            this.portValue.set(previousPort);
            this.savedPort.set(previousPort);
            return { ok: true };
          }
          return { ok: false, message: COULD_NOT_SAVE_PORT };
        } catch {
          return { ok: false, message: COULD_NOT_SAVE_PORT };
        }
      },
    });
  }

  isNamespaceEnabled(id: string): boolean {
    return !this.disabledNamespaces().includes(id);
  }

  async toggleNamespace(id: string): Promise<void> {
    if (this.saving()) return;
    const previous = [...this.disabledNamespaces()];
    const updated = previous.includes(id)
      ? previous.filter((n) => n !== id)
      : [...previous, id];

    const option = this.namespaceOptions.find((n) => n.id === id);
    const label = option ? `${option.label} namespace` : 'tool namespace';

    this.disabledNamespaces.set(updated);

    await this.feedback.saveGeneric({
      label,
      write: async () => {
        try {
          const result = await this.rpcService.call('agent:setConfig', {
            disabledMcpNamespaces: updated,
          });
          if (result.isSuccess() && result.data?.success === true) {
            this.savedDisabledNamespaces.set(updated);
            return { ok: true };
          }
          this.disabledNamespaces.set(previous);
          return { ok: false, message: COULD_NOT_UPDATE_NAMESPACES };
        } catch {
          this.disabledNamespaces.set(previous);
          return { ok: false, message: COULD_NOT_UPDATE_NAMESPACES };
        }
      },
      undo: async () => {
        try {
          const result = await this.rpcService.call('agent:setConfig', {
            disabledMcpNamespaces: previous,
          });
          if (result.isSuccess() && result.data?.success === true) {
            this.disabledNamespaces.set(previous);
            this.savedDisabledNamespaces.set(previous);
            return { ok: true };
          }
          return { ok: false, message: COULD_NOT_UPDATE_NAMESPACES };
        } catch {
          return { ok: false, message: COULD_NOT_UPDATE_NAMESPACES };
        }
      },
    });
  }

  onAllowLocalhostToggle(event?: Event): void {
    if (this.saving()) {
      if (event?.target) {
        (event.target as HTMLInputElement).checked = this.browserAllowLocalhost();
      }
      return;
    }
    if (!this.browserAllowLocalhost()) {
      // Revert native DOM checkbox so it stays unticked while confirm is open
      if (event?.target) {
        (event.target as HTMLInputElement).checked = false;
      }
      this.confirmingAllowLocalhost.set(true);
    } else {
      // Disabling is immediate with Undo (S-sel)
      void this.disableLocalhost();
    }
  }

  cancelEnableLocalhost(): void {
    this.confirmingAllowLocalhost.set(false);
  }

  async confirmEnableLocalhost(): Promise<void> {
    this.confirmingAllowLocalhost.set(false);

    await this.feedback.saveGeneric({
      label: 'Allow localhost',
      write: async () => {
        try {
          const result = await this.rpcService.call('agent:setConfig', {
            browserAllowLocalhost: true,
          });
          if (result.isSuccess() && result.data?.success === true) {
            this.browserAllowLocalhost.set(true);
            this.savedBrowserAllowLocalhost.set(true);
            return { ok: true };
          }
          this.browserAllowLocalhost.set(false);
          return { ok: false, message: COULD_NOT_UPDATE_LOCALHOST };
        } catch {
          this.browserAllowLocalhost.set(false);
          return { ok: false, message: COULD_NOT_UPDATE_LOCALHOST };
        }
      },
      undo: null, // S-confirm: no Undo when enabling
    });
  }

  private async disableLocalhost(): Promise<void> {
    const previous = this.browserAllowLocalhost();
    this.browserAllowLocalhost.set(false);

    await this.feedback.saveGeneric({
      label: 'Allow localhost',
      write: async () => {
        try {
          const result = await this.rpcService.call('agent:setConfig', {
            browserAllowLocalhost: false,
          });
          if (result.isSuccess() && result.data?.success === true) {
            this.savedBrowserAllowLocalhost.set(false);
            return { ok: true };
          }
          this.browserAllowLocalhost.set(previous);
          return { ok: false, message: COULD_NOT_UPDATE_LOCALHOST };
        } catch {
          this.browserAllowLocalhost.set(previous);
          return { ok: false, message: COULD_NOT_UPDATE_LOCALHOST };
        }
      },
      undo: async () => {
        try {
          const result = await this.rpcService.call('agent:setConfig', {
            browserAllowLocalhost: true,
          });
          if (result.isSuccess() && result.data?.success === true) {
            this.browserAllowLocalhost.set(true);
            this.savedBrowserAllowLocalhost.set(true);
            return { ok: true };
          }
          return { ok: false, message: COULD_NOT_UPDATE_LOCALHOST };
        } catch {
          return { ok: false, message: COULD_NOT_UPDATE_LOCALHOST };
        }
      },
    });
  }
}
