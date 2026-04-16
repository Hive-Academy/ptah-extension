/**
 * AgentsStepComponent
 *
 * Step 2: Agent configuration. Lists available CLI agents as toggleable cards
 * with enable/disable, model tier dropdown, and auto-approve checkbox.
 * Includes a "Design Agent Fleet" button that uses AI to create custom
 * subagent definitions tailored to the persona's workflow.
 */

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  computed,
  signal,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Bot,
  Sparkles,
  X,
  Zap,
  Clock,
  MousePointerClick,
} from 'lucide-angular';
import type {
  AgentOverride,
  HarnessSubagentDefinition,
} from '@ptah-extension/shared';
import { HarnessBuilderStateService } from '../../services/harness-builder-state.service';
import { HarnessRpcService } from '../../services/harness-rpc.service';
import { HarnessStreamingService } from '../../services/harness-streaming.service';
import { ConfigCardComponent } from '../atoms/config-card.component';

@Component({
  selector: 'ptah-agents-step',
  standalone: true,
  imports: [FormsModule, LucideAngularModule, ConfigCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div>
        <h2 class="text-lg font-bold flex items-center gap-2">
          <lucide-angular
            [img]="BotIcon"
            class="w-5 h-5 text-primary"
            aria-hidden="true"
          />
          Configure Agents
        </h2>
        <p class="text-sm text-base-content/60 mt-1">
          Select CLI agents and design custom subagents for your workflow.
        </p>
      </div>

      @if (agents().length === 0) {
        <div class="alert alert-warning text-sm">
          <span
            >No agents available. Complete the persona step first to get
            suggestions.</span
          >
        </div>
      }

      <!-- CLI Agent list -->
      <div class="space-y-3">
        <h3 class="text-sm font-semibold text-base-content/80">CLI Agents</h3>
        @for (agent of agents(); track agent.id) {
          <div class="space-y-2">
            <ptah-config-card
              [title]="agent.name"
              [description]="agent.description"
              [enabled]="isAgentEnabled(agent.id)"
              [badge]="agent.type"
              (toggled)="toggleAgent(agent.id, $event)"
            />

            <!-- Agent settings (shown when enabled) -->
            @if (isAgentEnabled(agent.id)) {
              <div class="ml-4 p-3 bg-base-200 rounded-lg space-y-3">
                <!-- Model tier -->
                <div class="form-control">
                  <label class="label py-0" [for]="'tier-' + agent.id">
                    <span class="label-text text-xs">Model Tier</span>
                  </label>
                  <select
                    [id]="'tier-' + agent.id"
                    class="select select-bordered select-xs w-full max-w-xs"
                    [ngModel]="getAgentTier(agent.id)"
                    (ngModelChange)="updateAgentTier(agent.id, $event)"
                  >
                    <option value="opus">Opus (Highest quality)</option>
                    <option value="sonnet">Sonnet (Balanced)</option>
                    <option value="haiku">Haiku (Fastest)</option>
                  </select>
                </div>

                <!-- Auto-approve -->
                <div class="form-control">
                  <label class="label cursor-pointer py-0 justify-start gap-2">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-xs checkbox-primary"
                      [checked]="getAgentAutoApprove(agent.id)"
                      (change)="toggleAutoApprove(agent.id)"
                    />
                    <span class="label-text text-xs"
                      >Auto-approve tool calls</span
                    >
                  </label>
                </div>
              </div>
            }
          </div>
        }
      </div>

      <!-- Custom Subagent Fleet -->
      <div class="space-y-3">
        <div class="divider text-xs text-base-content/40">
          Custom Subagent Fleet
        </div>

        <p class="text-xs text-base-content/60">
          Custom subagents are specialized AI workers designed for your specific
          workflow. Each has a distinct role, tools, and execution mode.
        </p>

        <!-- Design Fleet button -->
        <button
          class="btn btn-secondary w-full gap-2"
          (click)="designAgentFleet()"
          [disabled]="isDesigning() || !hasPersona()"
        >
          @if (isDesigning()) {
            <span class="loading loading-spinner loading-sm"></span>
            Designing Fleet...
          } @else {
            <lucide-angular
              [img]="SparklesIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Design Agent Fleet with AI
          }
        </button>

        @if (!hasPersona()) {
          <p class="text-xs text-warning text-center">
            Complete the Persona step first to enable fleet design.
          </p>
        }

        @if (designError()) {
          <div class="alert alert-error text-xs">
            <span>{{ designError() }}</span>
          </div>
        }

        @if (designReasoning()) {
          <div class="alert alert-info text-xs">
            <span>{{ designReasoning() }}</span>
          </div>
        }

        <!-- Harness subagent cards -->
        @if (harnessSubagents().length > 0) {
          <div class="space-y-3">
            @for (sub of harnessSubagents(); track sub.id) {
              <div
                class="card bg-base-200 border border-base-300 p-4 space-y-2"
              >
                <div class="flex items-start justify-between">
                  <div class="flex items-center gap-2">
                    <lucide-angular
                      [img]="getExecutionModeIcon(sub.executionMode)"
                      class="w-4 h-4 text-secondary"
                      aria-hidden="true"
                    />
                    <span class="font-semibold text-sm">{{ sub.name }}</span>
                    <span class="badge badge-xs badge-secondary">
                      {{ sub.executionMode }}
                    </span>
                  </div>
                  <button
                    class="btn btn-ghost btn-xs btn-circle"
                    (click)="removeSubagent(sub.id)"
                    [attr.aria-label]="'Remove ' + sub.name"
                  >
                    <lucide-angular
                      [img]="XIcon"
                      class="w-3 h-3"
                      aria-hidden="true"
                    />
                  </button>
                </div>

                <p class="text-xs text-base-content/70">
                  {{ sub.description }}
                </p>

                <div class="text-xs text-base-content/50">
                  <span class="font-medium">Tools:</span>
                  {{ sub.tools.join(', ') }}
                </div>

                @if (sub.triggers && sub.triggers.length > 0) {
                  <div class="text-xs text-base-content/50">
                    <span class="font-medium">Triggers:</span>
                    {{ sub.triggers.join(', ') }}
                  </div>
                }

                <details class="collapse collapse-arrow bg-base-300 rounded">
                  <summary
                    class="collapse-title text-xs font-medium p-2 min-h-0"
                  >
                    Instructions
                  </summary>
                  <div
                    class="collapse-content text-xs text-base-content/70 p-2 pt-0"
                  >
                    {{ sub.instructions }}
                  </div>
                </details>
              </div>
            }
          </div>
        }
      </div>

      <!-- Summary -->
      <div class="text-xs text-base-content/50 text-right">
        {{ enabledCount() }} CLI agent(s) +
        {{ harnessSubagents().length }} harness subagent(s)
      </div>
    </div>
  `,
})
export class AgentsStepComponent implements OnInit {
  private readonly state = inject(HarnessBuilderStateService);
  private readonly rpc = inject(HarnessRpcService);
  private readonly streaming = inject(HarnessStreamingService);

  protected readonly BotIcon = Bot;
  protected readonly SparklesIcon = Sparkles;
  protected readonly XIcon = X;
  protected readonly ZapIcon = Zap;
  protected readonly ClockIcon = Clock;
  protected readonly MousePointerClickIcon = MousePointerClick;

  // Local state
  public readonly isDesigning = signal(false);
  public readonly designError = signal<string | null>(null);
  public readonly designReasoning = signal<string | null>(null);

  public readonly agents = computed(() => this.state.availableAgents());

  public readonly enabledAgents = computed(
    () => this.state.config().agents?.enabledAgents ?? {},
  );

  public readonly harnessSubagents = computed(
    () => this.state.config().agents?.harnessSubagents ?? [],
  );

  public readonly enabledCount = computed(
    () => Object.values(this.enabledAgents()).filter((a) => a.enabled).length,
  );

  public readonly hasPersona = computed(() => {
    const persona = this.state.config().persona;
    return !!(persona?.description && persona.description.trim().length > 10);
  });

  public ngOnInit(): void {
    // If no agents config exists yet, initialize from available agents
    if (!this.state.config().agents) {
      const initial: Record<string, AgentOverride> = {};
      for (const agent of this.state.availableAgents()) {
        initial[agent.id] = {
          enabled: false,
          modelTier: 'sonnet',
          autoApprove: false,
        };
      }
      this.state.updateAgents({ enabledAgents: initial });
    }
  }

  public isAgentEnabled(agentId: string): boolean {
    return this.enabledAgents()[agentId]?.enabled ?? false;
  }

  public getAgentTier(agentId: string): string {
    return this.enabledAgents()[agentId]?.modelTier ?? 'sonnet';
  }

  public getAgentAutoApprove(agentId: string): boolean {
    return this.enabledAgents()[agentId]?.autoApprove ?? false;
  }

  public toggleAgent(agentId: string, enabled: boolean): void {
    const current = { ...this.enabledAgents() };
    current[agentId] = {
      ...(current[agentId] ?? { modelTier: 'sonnet', autoApprove: false }),
      enabled,
    };
    this.state.updateAgents({
      enabledAgents: current,
      harnessSubagents: this.harnessSubagents(),
    });
  }

  public updateAgentTier(
    agentId: string,
    tier: 'opus' | 'sonnet' | 'haiku',
  ): void {
    const current = { ...this.enabledAgents() };
    if (current[agentId]) {
      current[agentId] = { ...current[agentId], modelTier: tier };
      this.state.updateAgents({
        enabledAgents: current,
        harnessSubagents: this.harnessSubagents(),
      });
    }
  }

  public toggleAutoApprove(agentId: string): void {
    const current = { ...this.enabledAgents() };
    if (current[agentId]) {
      current[agentId] = {
        ...current[agentId],
        autoApprove: !current[agentId].autoApprove,
      };
      this.state.updateAgents({
        enabledAgents: current,
        harnessSubagents: this.harnessSubagents(),
      });
    }
  }

  public removeSubagent(subagentId: string): void {
    this.state.removeHarnessSubagent(subagentId);
  }

  public getExecutionModeIcon(
    mode: HarnessSubagentDefinition['executionMode'],
  ): typeof Zap {
    switch (mode) {
      case 'background':
        return this.ZapIcon;
      case 'scheduled':
        return this.ClockIcon;
      case 'on-demand':
        return this.MousePointerClickIcon;
    }
  }

  public async designAgentFleet(): Promise<void> {
    if (this.isDesigning()) return;

    const persona = this.state.config().persona;
    if (!persona) return;

    this.isDesigning.set(true);
    this.designError.set(null);
    this.designReasoning.set(null);
    this.streaming.reset();

    try {
      const enabledAgentIds = Object.entries(this.enabledAgents())
        .filter(([, v]) => v.enabled)
        .map(([k]) => k);

      const response = await this.rpc.designAgents({
        persona,
        existingAgents: enabledAgentIds,
        workspaceContext: this.state.workspaceContext() ?? undefined,
      });

      // Set the designed subagents
      this.state.setHarnessSubagents(response.subagents);
      this.designReasoning.set(response.reasoning);
    } catch (err) {
      this.designError.set(
        err instanceof Error ? err.message : 'Failed to design agent fleet',
      );
    } finally {
      this.isDesigning.set(false);
    }
  }
}
