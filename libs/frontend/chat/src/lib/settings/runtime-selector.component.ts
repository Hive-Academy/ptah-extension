/**
 * RuntimeSelectorComponent - Agent runtime switcher (Auto / Claude SDK / Deep Agent)
 *
 * Lets the user switch between Claude Agent SDK and LangChain DeepAgents at runtime.
 * Reads current value from agent:getConfig, saves via agent:setConfig.
 * When the backend reports reloadRequired, surfaces an alert with a Reload Window
 * button (VS Code: command:execute 'workbench.action.reloadWindow'; Electron:
 * window.location.reload() as a safe renderer-side fallback).
 */

import {
  Component,
  inject,
  ChangeDetectionStrategy,
  signal,
  OnInit,
} from '@angular/core';
import { LucideAngularModule, Cpu, RefreshCw } from 'lucide-angular';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';

type Runtime = 'auto' | 'claude-sdk' | 'deep-agent';

interface RuntimeOption {
  readonly id: Runtime;
  readonly label: string;
}

@Component({
  selector: 'ptah-runtime-selector',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="border border-secondary/30 rounded-md bg-secondary/5">
      <div class="p-3">
        <div class="flex items-center gap-1.5 mb-2">
          <lucide-angular [img]="CpuIcon" class="w-4 h-4 text-secondary" />
          <h2 class="text-xs font-medium uppercase tracking-wide">
            Agent Runtime
          </h2>
        </div>
        <p class="text-xs text-base-content/70 mb-3">
          Choose which engine powers Ptah's agent loop.
        </p>

        <!-- Segmented toggle -->
        <div class="tabs tabs-boxed bg-base-200/50 p-1 gap-1 flex-wrap mb-3">
          @for (option of options; track option.id) {
            <button
              type="button"
              class="tab tab-sm flex-1"
              [class.tab-active]="runtime() === option.id"
              [disabled]="isSaving()"
              (click)="selectRuntime(option.id)"
              [attr.aria-pressed]="runtime() === option.id"
              [attr.aria-label]="'Select ' + option.label + ' runtime'"
            >
              @if (isSaving() && pendingRuntime() === option.id) {
                <span class="loading loading-spinner loading-xs"></span>
              }
              <span class="text-xs">{{ option.label }}</span>
            </button>
          }
        </div>

        <!-- Reload required alert -->
        @if (reloadRequired()) {
          <div
            class="alert alert-warning py-2 px-3 text-xs gap-2 mb-3"
            role="alert"
          >
            <lucide-angular [img]="RefreshIcon" class="w-4 h-4 shrink-0" />
            <div class="flex-1">
              <div class="font-medium">
                Runtime changed. Reload the window to apply.
              </div>
            </div>
            <button
              type="button"
              class="btn btn-xs btn-warning"
              (click)="reloadWindow()"
            >
              Reload Window
            </button>
          </div>
        }

        <!-- Error message -->
        @if (errorMessage()) {
          <div class="text-[10px] text-error mb-2">{{ errorMessage() }}</div>
        }

        <!-- Descriptions -->
        <dl class="space-y-1.5 text-[11px] text-base-content/60 leading-snug">
          <div>
            <dt class="inline font-medium text-base-content/80">Auto:</dt>
            <dd class="inline">
              picks based on your auth (Claude-native → Claude SDK, others →
              Deep Agent)
            </dd>
          </div>
          <div>
            <dt class="inline font-medium text-base-content/80">Claude SDK:</dt>
            <dd class="inline">
              always uses Anthropic's Claude Agent SDK (requires Claude CLI or
              Anthropic API)
            </dd>
          </div>
          <div>
            <dt class="inline font-medium text-base-content/80">Deep Agent:</dt>
            <dd class="inline">
              uses LangChain DeepAgents — works with Ollama, Copilot, Codex,
              OpenRouter, and other OpenAI-compatible providers
            </dd>
          </div>
        </dl>
      </div>
    </div>
  `,
})
export class RuntimeSelectorComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);

  readonly CpuIcon = Cpu;
  readonly RefreshIcon = RefreshCw;

  readonly options: readonly RuntimeOption[] = [
    { id: 'auto', label: 'Auto' },
    { id: 'claude-sdk', label: 'Claude SDK' },
    { id: 'deep-agent', label: 'Deep Agent' },
  ] as const;

  readonly runtime = signal<Runtime>('auto');
  readonly pendingRuntime = signal<Runtime | null>(null);
  readonly isSaving = signal(false);
  readonly reloadRequired = signal(false);
  readonly errorMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.loadCurrentRuntime();
  }

  private async loadCurrentRuntime(): Promise<void> {
    try {
      const result = await this.rpcService.call('agent:getConfig', undefined);
      if (result.isSuccess() && result.data?.runtime) {
        this.runtime.set(result.data.runtime);
      }
    } catch {
      // Keep default 'auto' if load fails
    }
  }

  async selectRuntime(choice: Runtime): Promise<void> {
    if (this.isSaving()) return;
    if (choice === this.runtime()) return;

    const previous = this.runtime();
    this.pendingRuntime.set(choice);
    this.isSaving.set(true);
    this.errorMessage.set(null);

    // Optimistically reflect in UI
    this.runtime.set(choice);

    try {
      const result = await this.rpcService.call('agent:setConfig', {
        runtime: choice,
      });

      if (result.isSuccess() && result.data?.success !== false) {
        if (result.data?.reloadRequired) {
          this.reloadRequired.set(true);
        }
      } else {
        this.runtime.set(previous);
        this.errorMessage.set(
          result.data?.error ?? result.error ?? 'Failed to update runtime',
        );
      }
    } catch {
      this.runtime.set(previous);
      this.errorMessage.set('Failed to update runtime');
    } finally {
      this.isSaving.set(false);
      this.pendingRuntime.set(null);
    }
  }

  async reloadWindow(): Promise<void> {
    if (this.vscodeService.isElectron) {
      // Electron: renderer-side reload is reliable and doesn't require a new
      // RPC method. The extension host RPC bridge lives in the same process
      // and will be re-initialised when the renderer reloads.
      window.location.reload();
      return;
    }

    // VS Code: ask the extension host to execute the built-in reload command.
    await this.rpcService.call('command:execute', {
      command: 'workbench.action.reloadWindow',
    });
  }
}
