/**
 * WorkflowsConfigComponent — Reasoning effort, dynamic workflows, and Ultracode.
 *
 * Groups the agent's task-planning controls into one Advanced-tab section:
 *   - Reasoning effort: reuses the shared `EffortStateService` (same channel as
 *     the in-chat effort selector) — reads `currentEffort()`, writes via
 *     `setEffort()`. No direct RPC here.
 *   - Dynamic workflows on/off: persists the `workflows.disabled` config key via
 *     `agent:getConfig` / `agent:setConfig`, mirroring McpPortConfigComponent.
 *   - Ultracode: `UltracodeStateService` — pins effort to xhigh and stamps the
 *     `ultracode` keyword onto outgoing human messages.
 *
 * Follows the McpPortConfigComponent read/write plumbing pattern.
 */

import {
  Component,
  inject,
  ChangeDetectionStrategy,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import {
  LucideAngularModule,
  Workflow,
  Zap,
  Brain,
  Info,
} from 'lucide-angular';
import { ClaudeRpcService, EffortStateService } from '@ptah-extension/core';
import type { EffortLevel, AgentSetConfigParams } from '@ptah-extension/shared';
import { UltracodeStateService } from '../../services/ultracode-state.service';

interface EffortChoice {
  readonly value: EffortLevel | '';
  readonly label: string;
}

const EFFORT_CHOICES: readonly EffortChoice[] = [
  { value: '', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'X-High' },
  { value: 'max', label: 'Max' },
] as const;

/**
 * Local widening for the `workflows.disabled` config field. The backend
 * workflows slice adds `workflowsDisabled` to AgentOrchestrationConfig /
 * AgentSetConfigParams in parallel; until that lands the field is typed here so
 * the (stringly-routed) RPC call compiles. Remove once the shared types carry
 * it natively.
 */
type WorkflowsSetParams = AgentSetConfigParams & {
  workflowsDisabled?: boolean;
};

@Component({
  selector: 'ptah-workflows-config',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mt-4 block' },
  template: `
    <!-- Reasoning Effort -->
    <div class="border border-secondary/30 rounded-md bg-secondary/5">
      <div class="p-3">
        <div class="flex items-center gap-1.5 mb-2">
          <lucide-angular [img]="BrainIcon" class="w-4 h-4 text-secondary" />
          <h2 class="text-xs font-medium uppercase tracking-wide">
            Reasoning Effort
          </h2>
        </div>
        <p class="text-xs text-base-content/70 mb-3">
          How much reasoning the agent applies per turn. Higher effort is slower
          but more thorough.
        </p>

        <div class="join flex-wrap" role="group" aria-label="Reasoning effort">
          @for (choice of effortChoices; track choice.value) {
            <button
              type="button"
              class="btn btn-xs join-item"
              [class.btn-primary]="currentEffort() === choice.value"
              [class.btn-ghost]="currentEffort() !== choice.value"
              [attr.aria-pressed]="currentEffort() === choice.value"
              (click)="selectEffort(choice.value)"
            >
              {{ choice.label }}
            </button>
          }
        </div>
      </div>
    </div>

    <!-- Dynamic Workflows -->
    <div class="border border-secondary/30 rounded-md bg-secondary/5 mt-3">
      <div class="p-3">
        <div class="flex items-center gap-1.5 mb-2">
          <lucide-angular [img]="WorkflowIcon" class="w-4 h-4 text-secondary" />
          <h2 class="text-xs font-medium uppercase tracking-wide">
            Dynamic Workflows
          </h2>
        </div>
        <p class="text-xs text-base-content/70 mb-3">
          Let the agent plan and run a multi-step workflow per task instead of a
          single-shot reply.
        </p>

        <div
          class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-base-200/50 transition-colors"
        >
          <div class="flex-1 min-w-0">
            <span class="text-xs font-medium">
              Dynamic workflows: {{ workflowsEnabled() ? 'ON' : 'OFF' }}
            </span>
          </div>
          <input
            type="checkbox"
            class="toggle toggle-xs toggle-primary"
            [checked]="workflowsEnabled()"
            (change)="toggleWorkflows($event)"
            [disabled]="workflowsSaving()"
            aria-label="Toggle dynamic workflows"
          />
        </div>

        <div class="flex items-start gap-1 mt-2 text-base-content/50">
          <lucide-angular [img]="InfoIcon" class="w-3 h-3 mt-0.5 shrink-0" />
          <span class="text-[10px] leading-relaxed">
            Workflows require a paid plan.
          </span>
        </div>

        @if (workflowsSaveSuccess()) {
          <div class="text-[10px] text-success mt-1.5">
            Workflow preference updated.
          </div>
        }
      </div>
    </div>

    <!-- Ultracode -->
    <div class="border border-secondary/30 rounded-md bg-secondary/5 mt-3">
      <div class="p-3">
        <div class="flex items-center gap-1.5 mb-2">
          <lucide-angular [img]="ZapIcon" class="w-4 h-4 text-secondary" />
          <h2 class="text-xs font-medium uppercase tracking-wide">Ultracode</h2>
        </div>
        <p class="text-xs text-base-content/70 mb-3">
          Ultracode (xhigh effort + auto-workflow per task). Turns on maximum
          practical reasoning and tags each message so the agent plans a
          workflow.
        </p>

        <div
          class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-base-200/50 transition-colors"
        >
          <div class="flex-1 min-w-0">
            <span class="text-xs font-medium">
              Ultracode: {{ ultracode.enabled() ? 'ON' : 'OFF' }}
            </span>
          </div>
          <input
            type="checkbox"
            class="toggle toggle-xs toggle-primary"
            [checked]="ultracode.enabled()"
            (change)="toggleUltracode($event)"
            aria-label="Toggle Ultracode mode"
          />
        </div>

        <div class="flex items-start gap-1 mt-2 text-base-content/50">
          <lucide-angular [img]="InfoIcon" class="w-3 h-3 mt-0.5 shrink-0" />
          <span class="text-[10px] leading-relaxed">
            The <code class="text-base-content/70">ultracode</code> keyword only
            takes effect on messages you type yourself. Turning Ultracode off
            restores your previous reasoning effort.
          </span>
        </div>
      </div>
    </div>
  `,
})
export class WorkflowsConfigComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly effortState = inject(EffortStateService);
  readonly ultracode = inject(UltracodeStateService);

  readonly BrainIcon = Brain;
  readonly WorkflowIcon = Workflow;
  readonly ZapIcon = Zap;
  readonly InfoIcon = Info;

  readonly effortChoices = EFFORT_CHOICES;

  /** Current effort as the segmented-control value ('' == SDK default). */
  readonly currentEffort = computed<EffortLevel | ''>(
    () => this.effortState.currentEffort() ?? '',
  );

  /** `workflows.disabled` inverted for display — ON means workflows enabled. */
  private readonly workflowsDisabled = signal(false);
  readonly workflowsEnabled = computed(() => !this.workflowsDisabled());
  readonly workflowsSaving = signal(false);
  readonly workflowsSaveSuccess = signal(false);

  async ngOnInit(): Promise<void> {
    await this.loadWorkflowsConfig();
  }

  private async loadWorkflowsConfig(): Promise<void> {
    const result = await this.rpcService.call('agent:getConfig', undefined);
    if (result.isSuccess()) {
      const disabled =
        (result.data as { workflowsDisabled?: boolean }).workflowsDisabled ??
        false;
      this.workflowsDisabled.set(disabled);
    }
  }

  selectEffort(value: EffortLevel | ''): void {
    this.effortState.setEffort(value === '' ? undefined : value);
  }

  async toggleWorkflows(event: Event): Promise<void> {
    const enabled = (event.target as HTMLInputElement).checked;
    const nextDisabled = !enabled;
    const previousDisabled = this.workflowsDisabled();

    this.workflowsDisabled.set(nextDisabled);
    this.workflowsSaving.set(true);
    this.workflowsSaveSuccess.set(false);

    try {
      const params: WorkflowsSetParams = { workflowsDisabled: nextDisabled };
      const result = await this.rpcService.call('agent:setConfig', params);
      if (result.isSuccess() && result.data?.success !== false) {
        this.workflowsSaveSuccess.set(true);
        setTimeout(() => this.workflowsSaveSuccess.set(false), 2000);
      } else {
        this.workflowsDisabled.set(previousDisabled);
      }
    } catch {
      this.workflowsDisabled.set(previousDisabled);
    } finally {
      this.workflowsSaving.set(false);
    }
  }

  toggleUltracode(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    void this.ultracode.toggle(checked);
  }
}
