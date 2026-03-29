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
import { LucideAngularModule, Plug, Check, AlertCircle } from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';

@Component({
  selector: 'ptah-mcp-port-config',
  standalone: true,
  imports: [LucideAngularModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="border border-primary/30 rounded-md bg-primary/5">
      <div class="p-3">
        <div class="flex items-center gap-1.5 mb-2">
          <lucide-angular [img]="PlugIcon" class="w-4 h-4 text-primary" />
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
  `,
})
export class McpPortConfigComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);

  readonly PlugIcon = Plug;
  readonly CheckIcon = Check;
  readonly AlertCircleIcon = AlertCircle;

  readonly portValue = signal<number>(51820);
  readonly savedPort = signal<number>(51820);
  readonly isSaving = signal(false);
  readonly isDirty = computed(() => this.portValue() !== this.savedPort());
  readonly validationError = signal<string | null>(null);
  readonly saveSuccess = signal(false);

  async ngOnInit(): Promise<void> {
    await this.loadCurrentPort();
  }

  private async loadCurrentPort(): Promise<void> {
    try {
      const result = await this.rpcService.call('agent:getConfig', undefined);
      if (result.isSuccess() && result.data.mcpPort) {
        this.portValue.set(result.data.mcpPort);
        this.savedPort.set(result.data.mcpPort);
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
      if (result.isSuccess()) {
        this.savedPort.set(port);
        this.saveSuccess.set(true);
      } else {
        this.validationError.set(result.error ?? 'Failed to save port');
      }
    } catch {
      this.validationError.set('Failed to save port');
    } finally {
      this.isSaving.set(false);
    }
  }
}
