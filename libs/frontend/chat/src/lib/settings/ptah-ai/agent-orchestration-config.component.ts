import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  signal,
  OnInit,
} from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { LucideAngularModule, Terminal, RefreshCw } from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  AgentOrchestrationConfig,
  CliModelOption,
  CliType,
} from '@ptah-extension/shared';

/**
 * AgentOrchestrationConfigComponent - CLI detection, model selectors,
 * concurrency/timeout configuration for agent orchestration.
 *
 * Extracted from SettingsComponent to reduce its complexity.
 * Self-contained: injects its own dependencies (ClaudeRpcService).
 *
 * Cross-component communication:
 * Parent uses viewChild(AgentOrchestrationConfigComponent) to call redetectClis()
 * when LlmProvidersConfigComponent emits (modelChanged).
 */
@Component({
  selector: 'ptah-agent-orchestration-config',
  standalone: true,
  imports: [LucideAngularModule, TitleCasePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="border border-primary/30 rounded-md bg-primary/5">
      <div class="p-3">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-1.5">
            <lucide-angular [img]="TerminalIcon" class="w-4 h-4 text-primary" />
            <h2 class="text-xs font-medium uppercase tracking-wide">
              Agent Orchestration
            </h2>
          </div>
          <button
            class="btn btn-ghost btn-xs gap-1"
            (click)="redetectClis()"
            [disabled]="isDetectingClis()"
            aria-label="Re-detect CLI agents"
          >
            @if (isDetectingClis()) {
            <span class="loading loading-spinner loading-xs"></span>
            } @else {
            <lucide-angular [img]="RefreshCwIcon" class="w-3 h-3" />
            }
            <span>Re-detect</span>
          </button>
        </div>

        <p class="text-xs text-base-content/70 mb-3">
          Headless agents (Gemini CLI, Codex CLI, Copilot) for parallel task
          execution.
        </p>

        <!-- Error display -->
        @if (agentConfigError()) {
        <div class="text-xs text-error mb-2">{{ agentConfigError() }}</div>
        }

        <!-- Loading state -->
        @if (agentConfigLoading()) {
        <div class="flex items-center gap-2 text-xs text-base-content/50 py-2">
          <span class="loading loading-spinner loading-xs"></span>
          <span>Loading agent config...</span>
        </div>
        }

        <!-- CLI Detection Results -->
        @if (agentConfig()) {
        <div class="space-y-2 mb-3">
          <div class="text-xs font-medium text-base-content/70">
            Detected CLIs
          </div>
          @for (cli of agentConfig()!.detectedClis; track cli.ptahCliId ??
          cli.cli) {
          <div class="p-2 border border-base-300 rounded bg-base-200/30">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <lucide-angular [img]="TerminalIcon" class="w-3.5 h-3.5" />
                <span class="text-xs font-medium capitalize">{{
                  cli.ptahCliName ?? cli.cli
                }}</span>
                @if (cli.providerName) {
                <span class="badge badge-primary badge-xs">{{
                  cli.providerName
                }}</span>
                }
              </div>
              <div class="flex items-center gap-1.5">
                @if (cli.installed) {
                <span class="badge badge-success badge-xs gap-1">
                  Installed @if (cli.version) {
                  <span class="opacity-70">v{{ cli.version }}</span>
                  }
                </span>
                } @else {
                <span class="badge badge-ghost badge-xs">Not Found</span>
                }
              </div>
            </div>

            <!-- Inline model selector for Gemini -->
            @if (cli.cli === 'gemini' && cli.installed) {
            <div class="mt-2 pt-2 border-t border-base-300/50">
              <label
                for="agent-gemini-model"
                class="text-[10px] text-base-content/50 mb-0.5 block"
              >
                Model
              </label>
              <select
                id="agent-gemini-model"
                class="select select-bordered select-xs w-full"
                (change)="setAgentModel('gemini', $any($event.target).value)"
              >
                <option value="" [selected]="!agentConfig()!.geminiModel">
                  Default
                </option>
                @for (model of geminiModels(); track model.id) {
                <option
                  [value]="model.id"
                  [selected]="model.id === agentConfig()!.geminiModel"
                >
                  {{ model.name }}
                </option>
                }
              </select>
            </div>
            }

            <!-- Inline model selector for Copilot -->
            @if (cli.cli === 'copilot' && cli.installed) {
            <div class="mt-2 pt-2 border-t border-base-300/50">
              <label
                for="agent-copilot-model"
                class="text-[10px] text-base-content/50 mb-0.5 block"
              >
                Model
              </label>
              <select
                id="agent-copilot-model"
                class="select select-bordered select-xs w-full"
                (change)="setAgentModel('copilot', $any($event.target).value)"
              >
                <option value="" [selected]="!agentConfig()!.copilotModel">
                  Default
                </option>
                @for (model of copilotModels(); track model.id) {
                <option
                  [value]="model.id"
                  [selected]="model.id === agentConfig()!.copilotModel"
                >
                  {{ model.name }}
                </option>
                }
              </select>
            </div>
            }
          </div>
          }
        </div>

        <!-- No CLIs found help -->
        @if (!hasInstalledCli()) {
        <div class="border border-warning/30 rounded p-2.5 mb-3 bg-warning/5">
          <p class="text-xs text-base-content/60 mb-1.5">
            No CLI agents found. Install one to enable agent orchestration:
          </p>
          <div class="flex flex-col gap-1 text-xs">
            <span class="text-base-content/50">
              Gemini CLI: <code>npm install -g &#64;google/gemini-cli</code>
            </span>
            <span class="text-base-content/50">
              Codex CLI: <code>npm install -g &#64;openai/codex</code>
            </span>
            <span class="text-base-content/50">
              Copilot: <code>npm install -g &#64;github/copilot-cli</code>
            </span>
          </div>
        </div>
        }

        <!-- Default CLI -->
        <div class="mb-3">
          <label
            for="agent-default-cli"
            class="text-xs font-medium text-base-content/70 mb-1 block"
          >
            Default CLI
          </label>
          <select
            id="agent-default-cli"
            class="select select-bordered select-xs w-full"
            [value]="agentConfig()!.defaultCli ?? 'auto'"
            (change)="setAgentDefaultCli($any($event.target).value)"
          >
            <option value="auto">Auto-detect</option>
            @for (cli of agentConfig()!.detectedClis; track cli.ptahCliId ??
            cli.cli) { @if (cli.installed) {
            <option [value]="cli.ptahCliId ?? cli.cli">
              {{ cli.ptahCliName ?? (cli.cli | titlecase) }}
            </option>
            } }
          </select>
        </div>

        <!-- Max Concurrent Agents -->
        <!-- TODO: Wire it properly or remove if not used -->
        <div class="mb-3">
          <div class="flex items-center justify-between mb-1">
            <label
              for="agent-max-concurrent"
              class="text-xs font-medium text-base-content/70"
            >
              Max Concurrent Agents
            </label>
            <span class="text-xs text-base-content/50">
              {{ agentConfig()!.maxConcurrentAgents }}
            </span>
          </div>
          <input
            id="agent-max-concurrent"
            type="range"
            min="1"
            max="10"
            [value]="agentConfig()!.maxConcurrentAgents"
            (change)="setAgentMaxConcurrent($any($event.target).valueAsNumber)"
            class="range range-xs range-primary"
          />
          <div
            class="flex justify-between text-[10px] text-base-content/40 px-0.5"
          >
            <span>1</span>
            <span>5</span>
            <span>10</span>
          </div>
        </div>

        <!-- Why would we implement timeouts for sessions that is totally agentic ? -->
        <!-- Default Timeout -->
        <div>
          <label
            for="agent-default-timeout"
            class="text-xs font-medium text-base-content/70 mb-1 block"
          >
            Default Timeout
          </label>
          <select
            id="agent-default-timeout"
            class="select select-bordered select-xs w-full"
            [value]="agentConfig()!.defaultTimeout"
            (change)="setAgentTimeout(+$any($event.target).value)"
          >
            <option [value]="5">5 minutes</option>
            <option [value]="10">10 minutes</option>
            <option [value]="15">15 minutes</option>
            <option [value]="30">30 minutes</option>
          </select>
        </div>
        }
      </div>
    </div>
  `,
})
export class AgentOrchestrationConfigComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);

  // Lucide icons
  readonly TerminalIcon = Terminal;
  readonly RefreshCwIcon = RefreshCw;

  // State signals
  readonly agentConfig = signal<AgentOrchestrationConfig | null>(null);
  readonly agentConfigLoading = signal(false);
  readonly agentConfigError = signal<string | null>(null);
  readonly isDetectingClis = signal(false);

  // CLI model lists
  readonly geminiModels = signal<CliModelOption[]>([]);
  readonly copilotModels = signal<CliModelOption[]>([]);

  readonly hasInstalledCli = computed(() => {
    const config = this.agentConfig();
    return config ? config.detectedClis.some((c) => c.installed) : false;
  });

  async ngOnInit(): Promise<void> {
    await this.loadAgentConfig();
  }

  async loadAgentConfig(): Promise<void> {
    this.agentConfigLoading.set(true);
    this.agentConfigError.set(null);
    try {
      const result = await this.rpcService.call('agent:getConfig', undefined);
      if (result.isSuccess()) {
        this.agentConfig.set(result.data);
        this.loadCliModels();
      } else {
        this.agentConfigError.set(result.error ?? 'Failed to load config');
      }
    } catch {
      this.agentConfigError.set('Failed to load agent orchestration config');
    } finally {
      this.agentConfigLoading.set(false);
    }
  }

  async loadCliModels(): Promise<void> {
    try {
      const result = await this.rpcService.call(
        'agent:listCliModels',
        undefined
      );
      if (result.isSuccess()) {
        this.geminiModels.set(result.data.gemini);
        this.copilotModels.set(result.data.copilot);
      }
    } catch {
      // Non-fatal: dropdowns will just be empty
    }
  }

  async setAgentDefaultCli(cli: string): Promise<void> {
    const value = cli === 'auto' ? null : (cli as CliType);
    const result = await this.rpcService.call('agent:setConfig', {
      defaultCli: value,
    });
    if (result.isSuccess()) {
      this.agentConfig.update((c) => (c ? { ...c, defaultCli: value } : c));
    }
  }

  async setAgentMaxConcurrent(value: number): Promise<void> {
    const result = await this.rpcService.call('agent:setConfig', {
      maxConcurrentAgents: value,
    });
    if (result.isSuccess()) {
      this.agentConfig.update((c) =>
        c ? { ...c, maxConcurrentAgents: value } : c
      );
    }
  }

  async setAgentTimeout(minutes: number): Promise<void> {
    const result = await this.rpcService.call('agent:setConfig', {
      defaultTimeout: minutes,
    });
    if (result.isSuccess()) {
      this.agentConfig.update((c) =>
        c ? { ...c, defaultTimeout: minutes } : c
      );
    }
  }

  isCliInstalled(cli: string): boolean {
    return (
      this.agentConfig()?.detectedClis.some(
        (c) => c.cli === cli && c.installed
      ) ?? false
    );
  }

  async setAgentModel(cli: 'gemini' | 'copilot', model: string): Promise<void> {
    const key = cli === 'gemini' ? 'geminiModel' : 'copilotModel';
    const result = await this.rpcService.call('agent:setConfig', {
      [key]: model,
    });
    if (result.isSuccess()) {
      this.agentConfig.update((c) => (c ? { ...c, [key]: model } : c));
    }
  }

  async redetectClis(): Promise<void> {
    this.isDetectingClis.set(true);
    this.agentConfigError.set(null);
    try {
      const result = await this.rpcService.call('agent:detectClis', undefined);
      if (result.isSuccess()) {
        this.agentConfig.update((c) =>
          c ? { ...c, detectedClis: result.data.clis } : c
        );
      } else {
        this.agentConfigError.set(result.error ?? 'Detection failed');
      }
    } catch {
      this.agentConfigError.set('Failed to detect CLI agents');
    } finally {
      this.isDetectingClis.set(false);
    }
  }
}
