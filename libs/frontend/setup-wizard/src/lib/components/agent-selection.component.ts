import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';

/**
 * AgentSelectionComponent - Agent selection table with checkboxes
 *
 * Purpose:
 * - Display available agents with relevance scores
 * - Allow users to select which agents to generate
 * - Provide bulk selection controls
 * - Show selection summary and validation
 *
 * Features:
 * - DaisyUI table layout with zebra stripes
 * - Relevance score badges (color-coded by score)
 * - Select All / Deselect All buttons
 * - Total selected count display
 * - Disabled state when no agents selected
 * - Signal-based reactive UI
 *
 * Usage:
 * ```html
 * <ptah-agent-selection />
 * ```
 */
@Component({
  selector: 'ptah-agent-selection',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container mx-auto px-4 py-8">
      <div class="max-w-5xl mx-auto">
        <div class="mb-6">
          <h2 class="text-3xl font-bold mb-2">Select Agents to Generate</h2>
          <p class="text-base-content/70">
            We've analyzed your project and recommended these agents. Select
            which ones you'd like to generate.
          </p>
        </div>

        <div class="card bg-base-100 shadow-xl">
          <div class="card-body">
            <!-- Selection controls and count -->
            <div class="flex justify-between items-center mb-4">
              <div class="flex gap-2">
                <button
                  class="btn btn-ghost btn-sm"
                  (click)="onSelectAll()"
                  [disabled]="allSelected()"
                >
                  Select All
                </button>
                <button
                  class="btn btn-ghost btn-sm"
                  (click)="onDeselectAll()"
                  [disabled]="noneSelected()"
                >
                  Deselect All
                </button>
              </div>
              <div class="badge badge-outline badge-lg">
                {{ selectedCount() }} / {{ totalCount() }} selected
              </div>
            </div>

            <!-- Agent selection table -->
            <div class="overflow-x-auto">
              <table class="table table-zebra table-pin-rows">
                <thead>
                  <tr>
                    <th class="w-12"></th>
                    <th>Agent Name</th>
                    <th>Relevance Score</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  @if (agents().length === 0) {
                  <tr>
                    <td colspan="4" class="text-center text-base-content/60 py-8">
                      No agents available. Please restart the wizard.
                    </td>
                  </tr>
                  } @for (agent of agents(); track agent.id) {
                  <tr>
                    <td>
                      <input
                        type="checkbox"
                        class="checkbox checkbox-primary"
                        [checked]="agent.selected"
                        (change)="onToggleAgent(agent.id)"
                      />
                    </td>
                    <td>
                      <span class="font-semibold">{{ agent.name }}</span>
                      @if (agent.autoInclude) {
                      <span class="badge badge-sm badge-accent ml-2">
                        Auto-included
                      </span>
                      }
                    </td>
                    <td>
                      <span
                        class="badge"
                        [class.badge-success]="agent.score >= 80"
                        [class.badge-warning]="
                          agent.score >= 60 && agent.score < 80
                        "
                        [class.badge-error]="agent.score < 60"
                      >
                        {{ agent.score }}%
                      </span>
                    </td>
                    <td>
                      <span class="text-sm text-base-content/70">{{
                        agent.reason
                      }}</span>
                    </td>
                  </tr>
                  }
                </tbody>
              </table>
            </div>

            <!-- Action buttons -->
            <div class="card-actions justify-end mt-6">
              <button
                class="btn btn-primary"
                [class.btn-disabled]="!canProceed()"
                [disabled]="!canProceed()"
                (click)="onGenerateAgents()"
              >
                Generate {{ selectedCount() }} Agent{{
                  selectedCount() === 1 ? '' : 's'
                }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class AgentSelectionComponent {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly wizardRpc = inject(WizardRpcService);

  // Reactive state from wizard state service
  protected readonly agents = this.wizardState.availableAgents;
  protected readonly selectedCount = this.wizardState.selectedCount;
  protected readonly canProceed = this.wizardState.canProceed;

  // Computed signals for UI state
  protected readonly totalCount = computed(() => this.agents().length);
  protected readonly allSelected = computed(
    () => this.selectedCount() === this.totalCount() && this.totalCount() > 0
  );
  protected readonly noneSelected = computed(() => this.selectedCount() === 0);

  /**
   * Toggle individual agent selection
   */
  protected onToggleAgent(agentId: string): void {
    this.wizardState.toggleAgentSelection(agentId);
  }

  /**
   * Select all agents
   */
  protected onSelectAll(): void {
    const agents = this.agents();
    const updatedAgents = agents.map((agent) => ({
      ...agent,
      selected: true,
    }));
    this.wizardState.setAvailableAgents(updatedAgents);
  }

  /**
   * Deselect all agents
   */
  protected onDeselectAll(): void {
    const agents = this.agents();
    const updatedAgents = agents.map((agent) => ({
      ...agent,
      selected: false,
    }));
    this.wizardState.setAvailableAgents(updatedAgents);
  }

  /**
   * Submit selected agents and transition to generation step
   */
  protected async onGenerateAgents(): Promise<void> {
    if (!this.canProceed()) {
      return;
    }

    const selectedAgents = this.agents().filter((a) => a.selected);

    try {
      // Submit selection to backend via RPC
      await this.wizardRpc.submitAgentSelection(selectedAgents);

      // Transition to generation step
      this.wizardState.setCurrentStep('generation');
    } catch (error) {
      console.error('Failed to submit agent selection:', error);
    }
  }
}
