import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  signal,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Bot,
  Plus,
  Pencil,
  Trash2,
  Plug,
  Check,
  X,
  Loader2,
  Eye,
  EyeOff,
} from 'lucide-angular';
import {
  ClaudeRpcService,
  CustomAgentStateService,
} from '@ptah-extension/core';
import { ConfirmationDialogService } from '../../services/confirmation-dialog.service';
import type { CustomAgentSummary } from '@ptah-extension/shared';

/**
 * Known provider definitions for the custom agent creation form.
 * These are Anthropic-compatible providers supported by the custom agent adapter.
 */
interface ProviderOption {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

const AVAILABLE_PROVIDERS: readonly ProviderOption[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Access 200+ models via unified API',
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    description: 'Moonshot AI / Kimi models',
  },
  {
    id: 'z-ai',
    name: 'Z.AI (xAI)',
    description: 'xAI Grok models via Z.AI',
  },
] as const;

/**
 * CustomAgentConfigComponent - CRUD management for custom agent instances
 *
 * Complexity Level: 2 (Medium - form with CRUD operations and service delegation)
 * Patterns: Signal-based state, composition, DaisyUI styling
 *
 * Responsibilities:
 * - List configured custom agents with status, provider, enable toggle
 * - Add new agent via inline form (name, provider, API key)
 * - Edit agent configuration (name, API key)
 * - Delete agent with confirmation dialog
 * - Test connection with latency display
 * - Enable/disable toggle per agent
 *
 * RPC Methods Used:
 * - customAgent:list    -> List all agents
 * - customAgent:create  -> Create new agent
 * - customAgent:update  -> Update agent config
 * - customAgent:delete  -> Delete agent
 * - customAgent:testConnection -> Test API connection
 */
@Component({
  selector: 'ptah-custom-agent-config',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="border border-primary/30 rounded-md bg-primary/5">
      <div class="p-3">
        <!-- Header -->
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-1.5">
            <lucide-angular [img]="BotIcon" class="w-4 h-4 text-primary" />
            <h2 class="text-xs font-medium uppercase tracking-wide">
              Custom Agents
            </h2>
          </div>
          <button
            class="btn btn-ghost btn-xs gap-1"
            (click)="toggleAddForm()"
            [disabled]="isLoading()"
            aria-label="Add custom agent"
          >
            @if (showAddForm()) {
            <lucide-angular [img]="XIcon" class="w-3 h-3" />
            <span>Cancel</span>
            } @else {
            <lucide-angular [img]="PlusIcon" class="w-3 h-3" />
            <span>Add</span>
            }
          </button>
        </div>

        <p class="text-xs text-base-content/70 mb-3">
          Connect external AI providers (OpenRouter, Moonshot, Z.AI) as custom
          agents for chat.
        </p>

        <!-- Error display -->
        @if (error()) {
        <div class="alert alert-error text-xs py-2 px-3 mb-2">
          <span>{{ error() }}</span>
        </div>
        }

        <!-- Success display -->
        @if (successMessage()) {
        <div class="alert alert-success text-xs py-2 px-3 mb-2">
          <lucide-angular [img]="CheckIcon" class="w-3 h-3" />
          <span>{{ successMessage() }}</span>
        </div>
        }

        <!-- Loading state -->
        @if (isLoading() && agents().length === 0) {
        <div class="flex items-center gap-2 text-xs text-base-content/50 py-2">
          <span class="loading loading-spinner loading-xs"></span>
          <span>Loading custom agents...</span>
        </div>
        }

        <!-- Add Agent Form (inline, collapsible) -->
        @if (showAddForm()) {
        <div
          class="border border-primary/20 rounded p-3 mb-3 bg-base-100 space-y-2"
        >
          <div class="text-xs font-medium text-base-content/70 mb-1">
            New Custom Agent
          </div>

          <!-- Name -->
          <div class="form-control">
            <label for="new-agent-name" class="label py-0.5">
              <span class="label-text text-xs">Name</span>
            </label>
            <input
              id="new-agent-name"
              type="text"
              class="input input-bordered input-xs w-full"
              placeholder="e.g., My OpenRouter Agent"
              [ngModel]="newAgentName()"
              (ngModelChange)="newAgentName.set($event)"
            />
          </div>

          <!-- Provider -->
          <div class="form-control">
            <label for="new-agent-provider" class="label py-0.5">
              <span class="label-text text-xs">Provider</span>
            </label>
            <select
              id="new-agent-provider"
              class="select select-bordered select-xs w-full"
              [ngModel]="newAgentProvider()"
              (ngModelChange)="newAgentProvider.set($event)"
            >
              <option value="">Select provider...</option>
              @for (provider of providers; track provider.id) {
              <option [value]="provider.id">
                {{ provider.name }} - {{ provider.description }}
              </option>
              }
            </select>
          </div>

          <!-- API Key -->
          <div class="form-control">
            <label for="new-agent-apikey" class="label py-0.5">
              <span class="label-text text-xs">API Key</span>
            </label>
            <div class="relative">
              <input
                id="new-agent-apikey"
                [type]="showNewApiKey() ? 'text' : 'password'"
                class="input input-bordered input-xs w-full pr-8"
                placeholder="sk-..."
                [ngModel]="newAgentApiKey()"
                (ngModelChange)="newAgentApiKey.set($event)"
              />
              <button
                type="button"
                class="absolute right-1 top-1/2 -translate-y-1/2 btn btn-ghost btn-xs btn-square"
                (click)="showNewApiKey.set(!showNewApiKey())"
                [attr.aria-label]="
                  showNewApiKey() ? 'Hide API key' : 'Show API key'
                "
              >
                @if (showNewApiKey()) {
                <lucide-angular [img]="EyeOffIcon" class="w-3 h-3" />
                } @else {
                <lucide-angular [img]="EyeIcon" class="w-3 h-3" />
                }
              </button>
            </div>
          </div>

          <!-- Create Button -->
          <div class="flex justify-end pt-1">
            <button
              class="btn btn-primary btn-xs gap-1"
              [disabled]="!canCreate() || isCreating()"
              (click)="createAgent()"
            >
              @if (isCreating()) {
              <span class="loading loading-spinner loading-xs"></span>
              } @else {
              <lucide-angular [img]="PlusIcon" class="w-3 h-3" />
              }
              <span>Create Agent</span>
            </button>
          </div>
        </div>
        }

        <!-- Agent List -->
        @if (agents().length > 0) {
        <div class="space-y-2">
          @for (agent of agents(); track agent.id) {
          <div
            class="p-2 border border-base-300 rounded bg-base-200/30"
            [class.opacity-50]="!agent.enabled"
          >
            <!-- Agent Header Row -->
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0 flex-1">
                <lucide-angular
                  [img]="BotIcon"
                  class="w-3.5 h-3.5 shrink-0"
                  [class.text-success]="agent.status === 'available'"
                  [class.text-error]="agent.status === 'error'"
                  [class.text-warning]="agent.status === 'initializing'"
                  [class.opacity-40]="agent.status === 'unconfigured'"
                />
                <!-- Agent Name (editable inline) -->
                @if (editingAgentId() === agent.id) {
                <input
                  type="text"
                  class="input input-bordered input-xs flex-1 min-w-0"
                  [ngModel]="editName()"
                  (ngModelChange)="editName.set($event)"
                  (keydown.enter)="saveEdit(agent.id)"
                  (keydown.escape)="cancelEdit()"
                />
                } @else {
                <span class="text-xs font-medium truncate">{{
                  agent.name
                }}</span>
                }
                <span class="badge badge-ghost badge-xs shrink-0">{{
                  agent.providerName
                }}</span>
              </div>

              <div class="flex items-center gap-1 shrink-0">
                <!-- Status badge -->
                @if (agent.status === 'available') {
                <span class="badge badge-success badge-xs">Ready</span>
                } @else if (agent.status === 'error') {
                <span class="badge badge-error badge-xs">Error</span>
                } @else if (agent.status === 'initializing') {
                <span class="badge badge-warning badge-xs">Init</span>
                } @else {
                <span class="badge badge-ghost badge-xs">No Key</span>
                }

                <!-- Enable/Disable toggle -->
                <input
                  type="checkbox"
                  class="toggle toggle-xs toggle-primary"
                  [checked]="agent.enabled"
                  (change)="toggleEnabled(agent)"
                  [attr.aria-label]="
                    (agent.enabled ? 'Disable' : 'Enable') + ' ' + agent.name
                  "
                />
              </div>
            </div>

            <!-- Agent Actions Row -->
            <div
              class="flex items-center justify-between mt-1.5 pt-1.5 border-t border-base-300/50"
            >
              <div class="flex items-center gap-1">
                <!-- API Key status -->
                @if (agent.hasApiKey) {
                <span
                  class="text-[10px] text-success/70 flex items-center gap-0.5"
                >
                  <lucide-angular [img]="CheckIcon" class="w-2.5 h-2.5" />
                  Key set
                </span>
                } @else {
                <span class="text-[10px] text-warning/70">No API key</span>
                }

                <!-- Model count -->
                @if (agent.modelCount > 0) {
                <span class="text-[10px] text-base-content/50">
                  {{ agent.modelCount }} models
                </span>
                }
              </div>

              <div class="flex items-center gap-0.5">
                <!-- Test Connection -->
                <button
                  class="btn btn-ghost btn-xs gap-0.5"
                  (click)="testConnection(agent.id)"
                  [disabled]="testingAgentId() === agent.id || !agent.hasApiKey"
                  [attr.aria-label]="'Test connection for ' + agent.name"
                >
                  @if (testingAgentId() === agent.id) {
                  <span class="loading loading-spinner loading-xs"></span>
                  } @else {
                  <lucide-angular [img]="PlugIcon" class="w-3 h-3" />
                  }
                  <span class="text-[10px]">Test</span>
                </button>

                <!-- Edit -->
                @if (editingAgentId() === agent.id) {
                <button
                  class="btn btn-ghost btn-xs gap-0.5"
                  (click)="saveEdit(agent.id)"
                  aria-label="Save changes"
                >
                  <lucide-angular
                    [img]="CheckIcon"
                    class="w-3 h-3 text-success"
                  />
                </button>
                <button
                  class="btn btn-ghost btn-xs gap-0.5"
                  (click)="cancelEdit()"
                  aria-label="Cancel editing"
                >
                  <lucide-angular [img]="XIcon" class="w-3 h-3" />
                </button>
                } @else {
                <button
                  class="btn btn-ghost btn-xs gap-0.5"
                  (click)="startEdit(agent)"
                  [attr.aria-label]="'Edit ' + agent.name"
                >
                  <lucide-angular [img]="PencilIcon" class="w-3 h-3" />
                </button>
                }

                <!-- Delete -->
                <button
                  class="btn btn-ghost btn-xs gap-0.5 text-error/70 hover:text-error"
                  (click)="deleteAgent(agent)"
                  [attr.aria-label]="'Delete ' + agent.name"
                >
                  <lucide-angular [img]="Trash2Icon" class="w-3 h-3" />
                </button>
              </div>
            </div>

            <!-- Test Connection Result (inline) -->
            @if (testResultAgentId() === agent.id && testResult()) {
            <div
              class="mt-1.5 pt-1.5 border-t border-base-300/50 text-[10px]"
              [class.text-success]="testResult()!.success"
              [class.text-error]="!testResult()!.success"
            >
              @if (testResult()!.success) {
              <span class="flex items-center gap-1">
                <lucide-angular [img]="CheckIcon" class="w-2.5 h-2.5" />
                Connected ({{ testResult()!.latencyMs }}ms)
              </span>
              } @else {
              <span class="flex items-center gap-1">
                <lucide-angular [img]="XIcon" class="w-2.5 h-2.5" />
                {{ testResult()!.error }}
              </span>
              }
            </div>
            }
          </div>
          }
        </div>
        }

        <!-- Empty state -->
        @if (!isLoading() && agents().length === 0 && !showAddForm()) {
        <div
          class="text-center py-4 text-xs text-base-content/50 border border-dashed border-base-300 rounded"
        >
          <lucide-angular
            [img]="BotIcon"
            class="w-6 h-6 mx-auto mb-2 opacity-30"
          />
          <p>No custom agents configured.</p>
          <p class="mt-1">
            Click
            <button class="link link-primary" (click)="toggleAddForm()">
              Add
            </button>
            to connect an external AI provider.
          </p>
        </div>
        }
      </div>
    </div>
  `,
})
export class CustomAgentConfigComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly confirmDialog = inject(ConfirmationDialogService);
  private readonly customAgentState = inject(CustomAgentStateService);

  // Lucide icons
  readonly BotIcon = Bot;
  readonly PlusIcon = Plus;
  readonly PencilIcon = Pencil;
  readonly Trash2Icon = Trash2;
  readonly PlugIcon = Plug;
  readonly CheckIcon = Check;
  readonly XIcon = X;
  readonly Loader2Icon = Loader2;
  readonly EyeIcon = Eye;
  readonly EyeOffIcon = EyeOff;

  // Provider options
  readonly providers = AVAILABLE_PROVIDERS;

  // ============================================================================
  // STATE SIGNALS
  // ============================================================================

  // Agent list
  readonly agents = signal<CustomAgentSummary[]>([]);
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  // Add form state
  readonly showAddForm = signal(false);
  readonly newAgentName = signal('');
  readonly newAgentProvider = signal('');
  readonly newAgentApiKey = signal('');
  readonly showNewApiKey = signal(false);
  readonly isCreating = signal(false);

  // Edit state
  readonly editingAgentId = signal<string | null>(null);
  readonly editName = signal('');

  // Test connection state
  readonly testingAgentId = signal<string | null>(null);
  readonly testResultAgentId = signal<string | null>(null);
  readonly testResult = signal<{
    success: boolean;
    latencyMs?: number;
    error?: string;
  } | null>(null);

  // Auto-clear timers
  private successTimer: ReturnType<typeof setTimeout> | null = null;

  // ============================================================================
  // COMPUTED SIGNALS
  // ============================================================================

  readonly canCreate = computed(() => {
    return (
      this.newAgentName().trim().length > 0 &&
      this.newAgentProvider().length > 0 &&
      this.newAgentApiKey().trim().length > 0
    );
  });

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  async ngOnInit(): Promise<void> {
    await this.loadAgents();
  }

  // ============================================================================
  // AGENT LIST
  // ============================================================================

  async loadAgents(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const result = await this.rpcService.call(
        'customAgent:list',
        {} as Record<string, never>
      );
      if (result.isSuccess()) {
        this.agents.set(result.data.agents);
        // TASK_2025_167: Refresh CustomAgentStateService so agent selector
        // dropdown stays in sync with settings changes
        this.customAgentState.refresh().catch(() => {
          // Non-critical: agent selector will refresh on next open
        });
      } else {
        this.error.set(result.error ?? 'Failed to load custom agents');
      }
    } catch {
      this.error.set('Failed to load custom agents');
    } finally {
      this.isLoading.set(false);
    }
  }

  // ============================================================================
  // CREATE AGENT
  // ============================================================================

  toggleAddForm(): void {
    this.showAddForm.update((v) => !v);
    if (!this.showAddForm()) {
      this.resetAddForm();
    }
  }

  async createAgent(): Promise<void> {
    if (!this.canCreate()) return;

    this.isCreating.set(true);
    this.error.set(null);
    try {
      const result = await this.rpcService.call('customAgent:create', {
        name: this.newAgentName().trim(),
        providerId: this.newAgentProvider(),
        apiKey: this.newAgentApiKey().trim(),
      });

      if (result.isSuccess() && result.data.success) {
        this.showSuccess(`Agent "${this.newAgentName().trim()}" created`);
        this.resetAddForm();
        this.showAddForm.set(false);
        await this.loadAgents();
      } else {
        this.error.set(
          result.data?.error ?? result.error ?? 'Failed to create agent'
        );
      }
    } catch {
      this.error.set('Failed to create agent');
    } finally {
      this.isCreating.set(false);
    }
  }

  private resetAddForm(): void {
    this.newAgentName.set('');
    this.newAgentProvider.set('');
    this.newAgentApiKey.set('');
    this.showNewApiKey.set(false);
  }

  // ============================================================================
  // EDIT AGENT
  // ============================================================================

  startEdit(agent: CustomAgentSummary): void {
    this.editingAgentId.set(agent.id);
    this.editName.set(agent.name);
  }

  cancelEdit(): void {
    this.editingAgentId.set(null);
    this.editName.set('');
  }

  async saveEdit(agentId: string): Promise<void> {
    const name = this.editName().trim();
    if (!name) return;

    this.error.set(null);
    try {
      const result = await this.rpcService.call('customAgent:update', {
        id: agentId,
        name,
      });

      if (result.isSuccess() && result.data.success) {
        this.showSuccess('Agent updated');
        this.cancelEdit();
        await this.loadAgents();
      } else {
        this.error.set(
          result.data?.error ?? result.error ?? 'Failed to update agent'
        );
      }
    } catch {
      this.error.set('Failed to update agent');
    }
  }

  // ============================================================================
  // TOGGLE ENABLED
  // ============================================================================

  async toggleEnabled(agent: CustomAgentSummary): Promise<void> {
    this.error.set(null);
    try {
      const result = await this.rpcService.call('customAgent:update', {
        id: agent.id,
        enabled: !agent.enabled,
      });

      if (result.isSuccess() && result.data.success) {
        // Optimistic update
        this.agents.update((agents) =>
          agents.map((a) =>
            a.id === agent.id ? { ...a, enabled: !a.enabled } : a
          )
        );
        // TASK_2025_167: Refresh state service for agent selector sync
        this.customAgentState.refresh().catch(() => {
          // Non-critical: agent selector will refresh on next open
        });
      } else {
        this.error.set(
          result.data?.error ?? result.error ?? 'Failed to toggle agent'
        );
      }
    } catch {
      this.error.set('Failed to toggle agent');
    }
  }

  // ============================================================================
  // DELETE AGENT
  // ============================================================================

  async deleteAgent(agent: CustomAgentSummary): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Custom Agent',
      message: `Are you sure you want to delete "${agent.name}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      confirmStyle: 'error',
    });

    if (!confirmed) return;

    this.error.set(null);
    try {
      const result = await this.rpcService.call('customAgent:delete', {
        id: agent.id,
      });

      if (result.isSuccess() && result.data.success) {
        this.showSuccess(`Agent "${agent.name}" deleted`);
        await this.loadAgents();
      } else {
        this.error.set(
          result.data?.error ?? result.error ?? 'Failed to delete agent'
        );
      }
    } catch {
      this.error.set('Failed to delete agent');
    }
  }

  // ============================================================================
  // TEST CONNECTION
  // ============================================================================

  async testConnection(agentId: string): Promise<void> {
    this.testingAgentId.set(agentId);
    this.testResultAgentId.set(null);
    this.testResult.set(null);
    this.error.set(null);

    try {
      const result = await this.rpcService.call('customAgent:testConnection', {
        id: agentId,
      });

      if (result.isSuccess()) {
        this.testResultAgentId.set(agentId);
        this.testResult.set({
          success: result.data.success,
          latencyMs: result.data.latencyMs,
          error: result.data.error,
        });
      } else {
        this.testResultAgentId.set(agentId);
        this.testResult.set({
          success: false,
          error: result.error ?? 'Connection test failed',
        });
      }
    } catch {
      this.testResultAgentId.set(agentId);
      this.testResult.set({
        success: false,
        error: 'Connection test failed',
      });
    } finally {
      this.testingAgentId.set(null);
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private showSuccess(message: string): void {
    this.successMessage.set(message);
    if (this.successTimer) {
      clearTimeout(this.successTimer);
    }
    this.successTimer = setTimeout(() => {
      this.successMessage.set(null);
      this.successTimer = null;
    }, 3000);
  }
}
