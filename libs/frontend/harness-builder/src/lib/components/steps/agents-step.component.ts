/**
 * AgentsStepComponent
 *
 * Step 2: Agent configuration. Lists available CLI agents as toggleable cards
 * with enable/disable, model tier dropdown, and auto-approve checkbox.
 * Pre-populates from AI suggestions if available from the persona step.
 */

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  computed,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Bot } from 'lucide-angular';
import type { AgentOverride } from '@ptah-extension/shared';
import { HarnessBuilderStateService } from '../../services/harness-builder-state.service';
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
          Select which AI agents to enable and customize their settings.
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

      <!-- Agent list -->
      <div class="space-y-3">
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

      <!-- Summary -->
      <div class="text-xs text-base-content/50 text-right">
        {{ enabledCount() }} of {{ agents().length }} agents enabled
      </div>
    </div>
  `,
})
export class AgentsStepComponent implements OnInit {
  private readonly state = inject(HarnessBuilderStateService);

  protected readonly BotIcon = Bot;

  public readonly agents = computed(() => this.state.availableAgents());

  public readonly enabledAgents = computed(
    () => this.state.config().agents?.enabledAgents ?? {},
  );

  public readonly enabledCount = computed(
    () => Object.values(this.enabledAgents()).filter((a) => a.enabled).length,
  );

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
    this.state.updateAgents({ enabledAgents: current });
  }

  public updateAgentTier(
    agentId: string,
    tier: 'opus' | 'sonnet' | 'haiku',
  ): void {
    const current = { ...this.enabledAgents() };
    if (current[agentId]) {
      current[agentId] = { ...current[agentId], modelTier: tier };
      this.state.updateAgents({ enabledAgents: current });
    }
  }

  public toggleAutoApprove(agentId: string): void {
    const current = { ...this.enabledAgents() };
    if (current[agentId]) {
      current[agentId] = {
        ...current[agentId],
        autoApprove: !current[agentId].autoApprove,
      };
      this.state.updateAgents({ enabledAgents: current });
    }
  }
}
