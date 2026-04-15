import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  signal,
  OnInit,
} from '@angular/core';

import {
  LucideAngularModule,
  Terminal,
  RefreshCw,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  GripVertical,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  AgentOrchestrationConfig,
  CliModelOption,
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
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="border border-secondary/30 rounded-md bg-secondary/5">
      <div class="p-3">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-1.5">
            <lucide-angular
              [img]="TerminalIcon"
              class="w-4 h-4 text-secondary"
            />
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
          <div
            class="flex items-center gap-2 text-xs text-base-content/50 py-2"
          >
            <span class="loading loading-spinner loading-xs"></span>
            <span>Loading agent config...</span>
          </div>
        }

        @if (agentConfig()) {
          <!-- ═══ Section 1: Settings (top — most commonly tweaked) ═══ -->
          <div
            class="border border-base-300/30 rounded bg-base-200/20 p-2.5 mb-3"
          >
            <div
              class="text-[10px] font-medium text-base-content/50 uppercase tracking-wide mb-2"
            >
              Settings
            </div>

            <!-- Preferred Agent Order -->
            <div class="mb-2.5">
              <span class="text-[10px] text-base-content/50 mb-1 block">
                Preferred Agent Order
              </span>
              @if (orderedAgents().length > 0) {
                <div class="space-y-1">
                  @for (
                    agent of orderedAgents();
                    track agent.id;
                    let i = $index;
                    let first = $first;
                    let last = $last
                  ) {
                    <div
                      class="flex items-center gap-1.5 px-2 py-1 rounded border border-base-300/40 bg-base-200/30 transition-opacity"
                      [class.opacity-40]="agent.disabled"
                    >
                      <lucide-angular
                        [img]="GripVerticalIcon"
                        class="w-3 h-3 text-base-content/20 shrink-0"
                        aria-hidden="true"
                      />
                      <lucide-angular
                        [img]="TerminalIcon"
                        class="w-3 h-3 text-base-content/50 shrink-0"
                      />
                      <span class="text-[11px] flex-1 truncate">{{
                        agent.name
                      }}</span>
                      @if (agent.disabled) {
                        <span class="badge badge-xs badge-ghost text-[8px]"
                          >Off</span
                        >
                      } @else if (agent.type === 'ptah-cli') {
                        <span class="badge badge-xs badge-ghost text-[8px]"
                          >Custom</span
                        >
                      }
                      <div class="flex gap-0.5 shrink-0">
                        <button
                          class="btn btn-ghost btn-xs p-0.5"
                          [disabled]="first"
                          (click)="moveAgentUp(i)"
                          aria-label="Move up"
                        >
                          <lucide-angular [img]="ArrowUpIcon" class="w-3 h-3" />
                        </button>
                        <button
                          class="btn btn-ghost btn-xs p-0.5"
                          [disabled]="last"
                          (click)="moveAgentDown(i)"
                          aria-label="Move down"
                        >
                          <lucide-angular
                            [img]="ArrowDownIcon"
                            class="w-3 h-3"
                          />
                        </button>
                      </div>
                    </div>
                  }
                </div>
                <p class="text-[9px] text-base-content/30 mt-1">
                  First available agent is used when no CLI is specified.
                </p>
              } @else {
                <p class="text-[10px] text-base-content/40 italic">
                  No agents detected. Install a CLI or add a Ptah CLI agent.
                </p>
              }
            </div>

            <!-- Max Concurrent Agents -->
            <div class="mb-2.5">
              <div class="flex items-center justify-between mb-0.5">
                <label
                  for="agent-max-concurrent"
                  class="text-[10px] text-base-content/50"
                >
                  Max Concurrent Agents
                </label>
                <span class="text-[10px] text-base-content/40">
                  {{ agentConfig()?.maxConcurrentAgents }}
                </span>
              </div>
              <input
                id="agent-max-concurrent"
                type="range"
                min="1"
                max="10"
                [value]="agentConfig()?.maxConcurrentAgents"
                (change)="onMaxConcurrentChange($event)"
                class="range range-xs range-secondary"
              />
              <div
                class="flex justify-between text-[10px] text-base-content/40 px-0.5"
              >
                <span>1</span>
                <span>5</span>
                <span>10</span>
              </div>
            </div>
          </div>

          <!-- ═══ Section 2: System CLIs (collapsible accordion) ═══ -->
          <div
            class="border border-base-300/30 rounded bg-base-200/20 p-2.5 mb-3"
          >
            <div
              class="text-[10px] font-medium text-base-content/50 uppercase tracking-wide mb-2"
            >
              System CLIs
            </div>

            <div class="space-y-1.5">
              @for (cli of systemClis(); track cli.cli) {
                <div
                  class="border border-base-300/40 rounded bg-base-200/30 transition-opacity"
                  [class.opacity-40]="isCliDisabled(cli.cli)"
                >
                  <!-- Collapsed header row — always visible -->
                  <div
                    class="flex items-center justify-between p-2 cursor-pointer select-none"
                    (click)="toggleCliExpand(cli.cli)"
                  >
                    <div class="flex items-center gap-2">
                      <lucide-angular
                        [img]="ChevronRightIcon"
                        class="w-3 h-3 text-base-content/40 transition-transform duration-150"
                        [class.rotate-90]="isCliExpanded(cli.cli)"
                      />
                      <lucide-angular
                        [img]="TerminalIcon"
                        class="w-3.5 h-3.5"
                      />
                      <span class="text-xs font-medium capitalize">{{
                        cli.ptahCliName ?? cli.cli
                      }}</span>
                      @if (cli.providerName) {
                        <span class="badge badge-primary badge-xs">{{
                          cli.providerName
                        }}</span>
                      }
                    </div>
                    <div
                      class="flex items-center gap-2"
                      (click)="$event.stopPropagation()"
                    >
                      @if (cli.installed) {
                        <span class="badge badge-success badge-xs gap-1">
                          Installed
                          @if (cli.version) {
                            <span class="opacity-70">v{{ cli.version }}</span>
                          }
                        </span>
                      } @else {
                        <span class="badge badge-ghost badge-xs"
                          >Not Found</span
                        >
                      }
                      <!-- Enable/Disable toggle -->
                      @if (cli.installed) {
                        <input
                          type="checkbox"
                          class="toggle toggle-xs toggle-success"
                          [checked]="!isCliDisabled(cli.cli)"
                          (change)="toggleCliEnabled(cli.cli)"
                          [attr.aria-label]="'Toggle ' + cli.cli + ' agent'"
                        />
                      }
                    </div>
                  </div>

                  <!-- Expanded detail panel -->
                  @if (isCliExpanded(cli.cli) && cli.installed) {
                    <div class="px-2 pb-2 pt-0 border-t border-base-300/30">
                      <!-- Gemini model selector -->
                      @if (cli.cli === 'gemini') {
                        <div class="mt-2">
                          <label
                            for="agent-gemini-model"
                            class="text-[10px] text-base-content/50 mb-0.5 block"
                          >
                            Model
                          </label>
                          <select
                            id="agent-gemini-model"
                            class="select select-bordered select-xs w-full"
                            (change)="onModelSelect('gemini', $event)"
                          >
                            <option
                              value=""
                              [selected]="!agentConfig()?.geminiModel"
                            >
                              Default
                            </option>
                            @for (model of geminiModels(); track model.id) {
                              <option
                                [value]="model.id"
                                [selected]="
                                  model.id === agentConfig()?.geminiModel
                                "
                              >
                                {{ model.name }}
                              </option>
                            }
                          </select>
                        </div>
                      }

                      <!-- Codex model + reasoning + permissions -->
                      @if (cli.cli === 'codex') {
                        <div class="mt-2">
                          <label
                            for="agent-codex-model"
                            class="text-[10px] text-base-content/50 mb-0.5 block"
                          >
                            Model
                          </label>
                          <select
                            id="agent-codex-model"
                            class="select select-bordered select-xs w-full"
                            (change)="onModelSelect('codex', $event)"
                          >
                            <option
                              value=""
                              [selected]="!agentConfig()?.codexModel"
                            >
                              Default
                            </option>
                            @for (model of codexModels(); track model.id) {
                              <option
                                [value]="model.id"
                                [selected]="
                                  model.id === agentConfig()?.codexModel
                                "
                              >
                                {{ model.name }}
                              </option>
                            }
                          </select>

                          <label
                            for="agent-codex-reasoning"
                            class="text-[10px] text-base-content/50 mt-2 mb-0.5 block"
                          >
                            Reasoning Effort
                          </label>
                          <select
                            id="agent-codex-reasoning"
                            class="select select-bordered select-xs w-full"
                            (change)="onReasoningEffortSelect('codex', $event)"
                          >
                            @for (
                              opt of reasoningEffortOptions;
                              track opt.value
                            ) {
                              <option
                                [value]="opt.value"
                                [selected]="
                                  opt.value ===
                                  agentConfig()?.codexReasoningEffort
                                "
                              >
                                {{ opt.label }}
                              </option>
                            }
                          </select>

                          <div class="flex items-center justify-between mt-2">
                            <div>
                              <span class="text-[10px] text-base-content/50"
                                >Permissions</span
                              >
                              <p class="text-[9px] text-base-content/30">
                                Full auto — Codex runs headless with full access
                              </p>
                            </div>
                          </div>
                        </div>
                      }

                      <!-- Copilot model + reasoning + auto-approve -->
                      @if (cli.cli === 'copilot') {
                        <div class="mt-2">
                          <label
                            for="agent-copilot-model"
                            class="text-[10px] text-base-content/50 mb-0.5 block"
                          >
                            Model
                          </label>
                          <select
                            id="agent-copilot-model"
                            class="select select-bordered select-xs w-full"
                            (change)="onModelSelect('copilot', $event)"
                          >
                            <option
                              value=""
                              [selected]="!agentConfig()?.copilotModel"
                            >
                              Default
                            </option>
                            @for (model of copilotModels(); track model.id) {
                              <option
                                [value]="model.id"
                                [selected]="
                                  model.id === agentConfig()?.copilotModel
                                "
                              >
                                {{ model.name }}
                              </option>
                            }
                          </select>

                          <label
                            for="agent-copilot-reasoning"
                            class="text-[10px] text-base-content/50 mt-2 mb-0.5 block"
                          >
                            Reasoning Effort
                          </label>
                          <select
                            id="agent-copilot-reasoning"
                            class="select select-bordered select-xs w-full"
                            (change)="
                              onReasoningEffortSelect('copilot', $event)
                            "
                          >
                            @for (
                              opt of reasoningEffortOptions;
                              track opt.value
                            ) {
                              <option
                                [value]="opt.value"
                                [selected]="
                                  opt.value ===
                                  agentConfig()?.copilotReasoningEffort
                                "
                              >
                                {{ opt.label }}
                              </option>
                            }
                          </select>

                          <div class="flex items-center justify-between mt-2">
                            <div>
                              <span class="text-[10px] text-base-content/50"
                                >Auto-approve tools</span
                              >
                              <p class="text-[9px] text-base-content/30">
                                Skip permission prompts for all tool calls
                              </p>
                            </div>
                            <input
                              type="checkbox"
                              class="toggle toggle-xs toggle-success"
                              [checked]="agentConfig()!.copilotAutoApprove"
                              (change)="toggleAutoApprove('copilot')"
                              aria-label="Auto-approve Copilot tool calls"
                            />
                          </div>
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            </div>

            <!-- No CLIs found help -->
            @if (!hasInstalledCli()) {
              <div
                class="border border-warning/30 rounded p-2.5 mt-2 bg-warning/5"
              >
                <p class="text-xs text-base-content/60 mb-1.5">
                  No CLI agents found. Install one to enable agent
                  orchestration:
                </p>
                <div class="flex flex-col gap-1 text-xs">
                  <span class="text-base-content/50">
                    Gemini CLI:
                    <code>npm install -g &#64;google/gemini-cli</code>
                  </span>
                  <span class="text-base-content/50">
                    Codex CLI:
                    <code>npm install -g &#64;openai/codex</code>
                  </span>
                  <span class="text-base-content/50">
                    Copilot:
                    <code>npm install -g &#64;github/copilot</code>
                  </span>
                </div>
              </div>
            }
          </div>

          <!-- ═══ Section 3: Ptah CLI Agents (projected content) ═══ -->
          <ng-content />
        }
      </div>
    </div>
  `,
  host: {
    class: 'mt-4 block',
  },
})
export class AgentOrchestrationConfigComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);

  // Lucide icons
  readonly TerminalIcon = Terminal;
  readonly RefreshCwIcon = RefreshCw;
  readonly ChevronRightIcon = ChevronRight;
  readonly ArrowUpIcon = ArrowUp;
  readonly ArrowDownIcon = ArrowDown;
  readonly GripVerticalIcon = GripVertical;

  // Reasoning effort options for Codex/Copilot
  readonly reasoningEffortOptions = [
    { value: '', label: 'Default' },
    { value: 'minimal', label: 'Minimal' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Extra High' },
  ];

  // State signals
  readonly agentConfig = signal<AgentOrchestrationConfig | null>(null);
  readonly agentConfigLoading = signal(false);
  readonly agentConfigError = signal<string | null>(null);
  readonly isDetectingClis = signal(false);

  // Accordion state — all collapsed by default
  readonly expandedClis = signal<Set<string>>(new Set());

  // CLI model lists
  readonly geminiModels = signal<CliModelOption[]>([]);
  readonly codexModels = signal<CliModelOption[]>([]);
  readonly copilotModels = signal<CliModelOption[]>([]);

  /** System CLIs only (excludes ptah-cli entries shown via projected content) */
  readonly systemClis = computed(() => {
    const config = this.agentConfig();
    return config ? config.detectedClis.filter((c) => !c.ptahCliId) : [];
  });

  readonly hasInstalledCli = computed(() => {
    return this.systemClis().some((c) => c.installed);
  });

  /** Ordered list of all installed/enabled agents for the reorderable UI */
  /**
   * Ordered list of all installed agents for the reorderable UI.
   * Disabled agents are included (shown dimmed) to preserve their position
   * in the preferred order when re-enabled.
   */
  readonly orderedAgents = computed(() => {
    const config = this.agentConfig();
    if (!config) return [];

    const disabledClis = new Set(config.disabledClis ?? []);

    // Build list of all installed agents (including disabled ones)
    const agents: {
      id: string;
      name: string;
      type: 'system' | 'ptah-cli';
      disabled: boolean;
    }[] = [];
    for (const cli of config.detectedClis) {
      if (!cli.installed) continue;
      const id = cli.ptahCliId ?? cli.cli;
      const isDisabled = !cli.ptahCliId && disabledClis.has(cli.cli);
      agents.push({
        id,
        name:
          cli.ptahCliName ?? cli.cli.charAt(0).toUpperCase() + cli.cli.slice(1),
        type: cli.ptahCliId ? 'ptah-cli' : 'system',
        disabled: isDisabled,
      });
    }

    // Sort by preferred order
    const preferred = config.preferredAgentOrder ?? [];
    if (preferred.length === 0) return agents;

    return [...agents].sort((a, b) => {
      const ai = preferred.indexOf(a.id);
      const bi = preferred.indexOf(b.id);
      const aRank = ai === -1 ? preferred.length : ai;
      const bRank = bi === -1 ? preferred.length : bi;
      return aRank - bRank;
    });
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
        undefined,
      );
      if (result.isSuccess()) {
        this.geminiModels.set(result.data.gemini);
        this.codexModels.set(result.data.codex);
        this.copilotModels.set(result.data.copilot);
      }
    } catch {
      // Non-fatal: dropdowns will just be empty
    }
  }

  public onModelSelect(
    cli: 'gemini' | 'codex' | 'copilot',
    event: Event,
  ): void {
    const value = (event.target as HTMLSelectElement).value;
    this.setAgentModel(cli, value);
  }

  public onReasoningEffortSelect(cli: 'codex' | 'copilot', event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const key =
      cli === 'codex' ? 'codexReasoningEffort' : 'copilotReasoningEffort';
    this.rpcService.call('agent:setConfig', { [key]: value }).then((result) => {
      if (result.isSuccess()) {
        this.agentConfig.update((c) => (c ? { ...c, [key]: value } : c));
      }
    });
  }

  public onMaxConcurrentChange(event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    this.setAgentMaxConcurrent(value);
  }

  /** Move agent up in preferred order */
  moveAgentUp(index: number): void {
    if (index <= 0) return;
    const agents = this.orderedAgents();
    const ids = agents.map((a) => a.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    this.savePreferredOrder(ids);
  }

  /** Move agent down in preferred order */
  moveAgentDown(index: number): void {
    const agents = this.orderedAgents();
    if (index >= agents.length - 1) return;
    const ids = agents.map((a) => a.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    this.savePreferredOrder(ids);
  }

  /** Persist the preferred agent order */
  private async savePreferredOrder(order: string[]): Promise<void> {
    const result = await this.rpcService.call('agent:setConfig', {
      preferredAgentOrder: order,
    });
    if (result.isSuccess()) {
      this.agentConfig.update((c) =>
        c ? { ...c, preferredAgentOrder: order } : c,
      );
    }
  }

  async setAgentMaxConcurrent(value: number): Promise<void> {
    const result = await this.rpcService.call('agent:setConfig', {
      maxConcurrentAgents: value,
    });
    if (result.isSuccess()) {
      this.agentConfig.update((c) =>
        c ? { ...c, maxConcurrentAgents: value } : c,
      );
    }
  }

  async toggleAutoApprove(cli: 'codex' | 'copilot'): Promise<void> {
    const key = cli === 'codex' ? 'codexAutoApprove' : 'copilotAutoApprove';
    const current = this.agentConfig()?.[key] ?? true;
    const newValue = !current;
    const result = await this.rpcService.call('agent:setConfig', {
      [key]: newValue,
    });
    if (result.isSuccess()) {
      this.agentConfig.update((c) => (c ? { ...c, [key]: newValue } : c));
    }
  }

  async setAgentModel(
    cli: 'gemini' | 'codex' | 'copilot',
    model: string,
  ): Promise<void> {
    const key =
      cli === 'gemini'
        ? 'geminiModel'
        : cli === 'codex'
          ? 'codexModel'
          : 'copilotModel';
    const result = await this.rpcService.call('agent:setConfig', {
      [key]: model,
    });
    if (result.isSuccess()) {
      this.agentConfig.update((c) => (c ? { ...c, [key]: model } : c));
    }
  }

  /** Toggle accordion expand/collapse for a CLI card */
  toggleCliExpand(cliType: string): void {
    this.expandedClis.update((set) => {
      const next = new Set(set);
      if (next.has(cliType)) {
        next.delete(cliType);
      } else {
        next.add(cliType);
      }
      return next;
    });
  }

  /** Check if a CLI card is expanded */
  isCliExpanded(cliType: string): boolean {
    return this.expandedClis().has(cliType);
  }

  /** Check if a CLI is disabled */
  isCliDisabled(cliType: string): boolean {
    return this.agentConfig()?.disabledClis?.includes(cliType) ?? false;
  }

  /** Toggle enable/disable for a system CLI */
  async toggleCliEnabled(cliType: string): Promise<void> {
    const current = this.agentConfig()?.disabledClis ?? [];
    const isDisabled = current.includes(cliType);
    const updated = isDisabled
      ? current.filter((c) => c !== cliType)
      : [...current, cliType];

    const result = await this.rpcService.call('agent:setConfig', {
      disabledClis: updated,
    });
    if (result.isSuccess()) {
      this.agentConfig.update((c) => (c ? { ...c, disabledClis: updated } : c));
    }
  }

  async redetectClis(): Promise<void> {
    this.isDetectingClis.set(true);
    this.agentConfigError.set(null);
    try {
      const result = await this.rpcService.call('agent:detectClis', undefined);
      if (result.isSuccess()) {
        this.agentConfig.update((c) =>
          c ? { ...c, detectedClis: result.data.clis } : c,
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
