/**
 * McpPortConfigComponent - Editable MCP server port configuration
 *
 * Allows users to view and update the MCP server port directly from the UI.
 * Reads current value from agent:getConfig, saves via agent:setConfig.
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
  Check,
  AlertCircle,
  Wrench,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import { BrowserSettingsComponent } from './browser-settings.component';

@Component({
  selector: 'ptah-mcp-port-config',
  standalone: true,
  imports: [LucideAngularModule, FormsModule, BrowserSettingsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mt-4 block' },
  template: `
    <div class="border border-secondary/30 rounded-md bg-secondary/5">
      <div class="p-3">
        <div class="flex items-center gap-1.5 mb-2">
          <lucide-angular [img]="PlugIcon" class="w-4 h-4 text-secondary" />
          <h2 class="text-xs font-medium uppercase tracking-wide">
            MCP Server Port
          </h2>
        </div>
        <p class="text-xs text-base-content/70 mb-3">
          Configure the port for Ptah's MCP server (code execution tools).
        </p>

        <!-- Port input -->
        <div class="flex items-center gap-2">
          <input
            type="number"
            class="input input-bordered input-xs w-28"
            [ngModel]="portValue()"
            (ngModelChange)="onPortInput($event)"
            [min]="1024"
            [max]="65535"
            placeholder="51820"
          />
          <button
            class="btn btn-primary btn-xs gap-1"
            (click)="savePort()"
            [disabled]="isSaving() || !isDirty()"
          >
            @if (isSaving()) {
              <span class="loading loading-spinner loading-xs"></span>
            } @else {
              <lucide-angular [img]="CheckIcon" class="w-3 h-3" />
            }
            <span>Save</span>
          </button>
        </div>

        <!-- Validation / status messages -->
        @if (validationError()) {
          <div class="flex items-center gap-1 mt-1.5 text-error">
            <lucide-angular [img]="AlertCircleIcon" class="w-3 h-3" />
            <span class="text-[10px]">{{ validationError() }}</span>
          </div>
        }
        @if (saveSuccess()) {
          <div class="text-[10px] text-success mt-1.5">
            Port updated. Restart MCP server for changes to take effect.
          </div>
        }

        <div class="text-[10px] text-base-content/40 mt-1.5">
          Default: 51820 · Range: 1024–65535
        </div>
      </div>
    </div>

    <!-- Tool Namespace Toggles -->
    <div class="border border-secondary/30 rounded-md bg-secondary/5 mt-3">
      <div class="p-3">
        <div class="flex items-center gap-1.5 mb-2">
          <lucide-angular [img]="WrenchIcon" class="w-4 h-4 text-secondary" />
          <h2 class="text-xs font-medium uppercase tracking-wide">
            MCP Tool Namespaces
          </h2>
        </div>
        <p class="text-xs text-base-content/70 mb-3">
          Enable or disable tool groups exposed to AI agents. Disabling unused
          namespaces reduces context window usage.
        </p>

        <div class="space-y-2">
          @for (ns of namespaceOptions; track ns.id) {
            <div
              class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-base-200/50 transition-colors"
            >
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="text-xs font-medium">{{ ns.label }}</span>
                  <span class="text-[10px] text-base-content/40"
                    >({{ ns.toolCount }} tools)</span
                  >
                </div>
                <p class="text-[10px] text-base-content/50 truncate">
                  {{ ns.description }}
                </p>
              </div>
              <input
                type="checkbox"
                class="toggle toggle-xs toggle-primary"
                [checked]="isNamespaceEnabled(ns.id)"
                (change)="toggleNamespace(ns.id)"
                [disabled]="namespaceSaving()"
                [attr.aria-label]="'Toggle ' + ns.label + ' namespace'"
              />
            </div>
          }
        </div>

        @if (namespaceSaveSuccess()) {
          <div class="text-[10px] text-success mt-2">
            Tool namespaces updated. Changes take effect on next MCP connection.
          </div>
        }
      </div>
    </div>

    <ptah-browser-settings />
  `,
})
export class McpPortConfigComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);

  readonly PlugIcon = Plug;
  readonly CheckIcon = Check;
  readonly AlertCircleIcon = AlertCircle;
  readonly WrenchIcon = Wrench;

  readonly portValue = signal<number>(51820);
  readonly savedPort = signal<number>(51820);
  readonly isSaving = signal(false);
  readonly isDirty = computed(() => this.portValue() !== this.savedPort());
  readonly validationError = signal<string | null>(null);
  readonly saveSuccess = signal(false);

  /** Namespace toggle state */
  readonly disabledNamespaces = signal<string[]>([]);
  readonly savedDisabledNamespaces = signal<string[]>([]);
  readonly namespaceSaving = signal(false);
  readonly namespaceSaveSuccess = signal(false);

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
    await this.loadCurrentPort();
  }

  private async loadCurrentPort(): Promise<void> {
    try {
      const result = await this.rpcService.call('agent:getConfig', undefined);
      if (result.isSuccess()) {
        if (result.data.mcpPort) {
          this.portValue.set(result.data.mcpPort);
          this.savedPort.set(result.data.mcpPort);
        }
        if (result.data.disabledMcpNamespaces) {
          this.disabledNamespaces.set(result.data.disabledMcpNamespaces);
          this.savedDisabledNamespaces.set(result.data.disabledMcpNamespaces);
        }
      }
    } catch {
      // Use default if load fails
    }
  }

  onPortInput(value: number): void {
    this.portValue.set(value);
    this.saveSuccess.set(false);

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

    this.isSaving.set(true);
    this.saveSuccess.set(false);
    this.validationError.set(null);

    try {
      const result = await this.rpcService.call('agent:setConfig', {
        mcpPort: port,
      });
      if (result.isSuccess() && result.data?.success !== false) {
        this.savedPort.set(port);
        this.saveSuccess.set(true);
      } else {
        this.validationError.set(
          result.data?.error ?? result.error ?? 'Failed to save port',
        );
      }
    } catch {
      this.validationError.set('Failed to save port');
    } finally {
      this.isSaving.set(false);
    }
  }

  isNamespaceEnabled(id: string): boolean {
    return !this.disabledNamespaces().includes(id);
  }

  async toggleNamespace(id: string): Promise<void> {
    const current = this.disabledNamespaces();
    const updated = current.includes(id)
      ? current.filter((n) => n !== id)
      : [...current, id];

    this.disabledNamespaces.set(updated);
    this.namespaceSaving.set(true);
    this.namespaceSaveSuccess.set(false);

    try {
      const result = await this.rpcService.call('agent:setConfig', {
        disabledMcpNamespaces: updated,
      });
      if (result.isSuccess() && result.data?.success !== false) {
        this.savedDisabledNamespaces.set(updated);
        this.namespaceSaveSuccess.set(true);
        setTimeout(() => this.namespaceSaveSuccess.set(false), 2000);
      } else {
        this.disabledNamespaces.set(this.savedDisabledNamespaces());
      }
    } catch {
      this.disabledNamespaces.set(this.savedDisabledNamespaces());
    } finally {
      this.namespaceSaving.set(false);
    }
  }
}
