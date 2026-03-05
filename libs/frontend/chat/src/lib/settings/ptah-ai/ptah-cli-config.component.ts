import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  signal,
  output,
  OnInit,
  OnDestroy,
  ElementRef,
  viewChild,
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
  Layers,
} from 'lucide-angular';
import { ClaudeRpcService, PtahCliStateService } from '@ptah-extension/core';
import { ConfirmationDialogService } from '../../services/confirmation-dialog.service';
import { ProviderModelSelectorComponent } from '../auth/provider-model-selector.component';
import type { PtahCliSummary } from '@ptah-extension/shared';

/**
 * Known provider definitions for the Ptah CLI agent creation form.
 * These are Anthropic-compatible providers supported by the Ptah CLI adapter.
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
    name: 'Z.AI (Zhipu AI)',
    description: 'Z.AI GLM models via Zhipu AI',
  },
] as const;

/**
 * PtahCliConfigComponent - CRUD management for Ptah CLI agent instances
 *
 * TASK_2025_170: Renamed from CustomAgentConfigComponent
 *
 * Complexity Level: 2 (Medium - form with CRUD operations and service delegation)
 * Patterns: Signal-based state, composition, DaisyUI styling
 *
 * Responsibilities:
 * - List configured Ptah CLI agents with status, provider, enable toggle
 * - Add new agent via inline form (name, provider, API key)
 * - Edit agent configuration (name, API key)
 * - Delete agent with confirmation dialog
 * - Test connection with latency display
 * - Enable/disable toggle per agent
 *
 * RPC Methods Used:
 * - ptahCli:list    -> List all agents
 * - ptahCli:create  -> Create new agent
 * - ptahCli:update  -> Update agent config
 * - ptahCli:delete  -> Delete agent
 * - ptahCli:testConnection -> Test API connection
 */
@Component({
  selector: 'ptah-cli-config',
  standalone: true,
  imports: [FormsModule, LucideAngularModule, ProviderModelSelectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mt-3">
      <!-- Ptah CLI Agents sub-header -->
      <div class="flex items-center justify-between mb-2">
        <div class="text-xs font-medium text-base-content/70">
          Ptah CLI Agents
        </div>
        <button
          class="btn btn-ghost btn-xs gap-1"
          (click)="toggleAddForm()"
          [disabled]="isLoading()"
          aria-label="Add Ptah CLI agent"
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
        <span>Loading Ptah CLI agents...</span>
      </div>
      }

      <!-- Add Agent Form (inline, collapsible) -->
      @if (showAddForm()) {
      <div
        class="border border-primary/20 rounded p-3 mb-3 bg-base-100 space-y-2"
      >
        <div class="text-xs font-medium text-base-content/70 mb-1">
          New Ptah CLI Agent
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
              <span class="text-xs font-medium truncate">{{ agent.name }}</span>
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
                [disabled]="isUpdating()"
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

              <!-- Model Mapping -->
              <button
                class="btn btn-ghost btn-xs gap-0.5"
                (click)="openModelMapping(agent)"
                [attr.aria-label]="'Model mapping for ' + agent.name"
              >
                <lucide-angular [img]="LayersIcon" class="w-3 h-3" />
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

          <!-- Model Mapping Badges -->
          @if (getAgentMappings(agent); as mappings) { @if (mappings.sonnet ||
          mappings.opus || mappings.haiku) {
          <div
            class="flex items-center gap-1 mt-1.5 pt-1.5 border-t border-base-300/50 flex-wrap"
          >
            @if (mappings.sonnet) {
            <span
              class="badge badge-xs badge-primary font-mono text-[9px]"
              title="Sonnet mapping"
              >{{ mappings.sonnet }}</span
            >
            } @if (mappings.opus) {
            <span
              class="badge badge-xs badge-secondary font-mono text-[9px]"
              title="Opus mapping"
              >{{ mappings.opus }}</span
            >
            } @if (mappings.haiku) {
            <span
              class="badge badge-xs badge-accent font-mono text-[9px]"
              title="Haiku mapping"
              >{{ mappings.haiku }}</span
            >
            }
          </div>
          } }
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
        <p>No Ptah CLI agents configured.</p>
        <p class="mt-1">
          Click
          <button class="link link-primary" (click)="toggleAddForm()">
            Add
          </button>
          to connect an external AI provider.
        </p>
      </div>
      }

      <!-- Model Mapping Modal -->
      <dialog #modelMappingDialog class="modal">
        <div class="modal-box bg-base-100 max-w-lg">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-medium">
              Model Mapping — {{ modelMappingAgent()?.name }}
            </h3>
            <button
              class="btn btn-ghost btn-xs btn-square"
              (click)="closeModelMapping()"
              aria-label="Close"
            >
              <lucide-angular [img]="XIcon" class="w-3.5 h-3.5" />
            </button>
          </div>
          @if (modelMappingAgent()) {
          <ptah-provider-model-selector
            [providerId]="modelMappingAgent()!.providerId"
            [hasKey]="modelMappingAgent()!.hasApiKey"
          />
          }
        </div>
        <form method="dialog" class="modal-backdrop">
          <button (click)="closeModelMapping()">close</button>
        </form>
      </dialog>
    </div>
  `,
})
export class PtahCliConfigComponent implements OnInit, OnDestroy {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly confirmDialog = inject(ConfirmationDialogService);
  private readonly ptahCliState = inject(PtahCliStateService);

  /** Emitted after successful create/update/delete so siblings can refresh */
  readonly ptahCliChanged = output<void>();

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
  readonly LayersIcon = Layers;

  // Provider options
  readonly providers = AVAILABLE_PROVIDERS;

  // ============================================================================
  // STATE SIGNALS
  // ============================================================================

  // Agent list
  readonly agents = signal<PtahCliSummary[]>([]);
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

  // Toggle concurrency guard
  readonly isUpdating = signal(false);

  // Model mapping state
  readonly providerTierMappings = signal<
    Record<
      string,
      { sonnet: string | null; opus: string | null; haiku: string | null }
    >
  >({});
  readonly modelMappingAgent = signal<PtahCliSummary | null>(null);
  private readonly modelMappingDialog =
    viewChild<ElementRef<HTMLDialogElement>>('modelMappingDialog');

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
    await this.loadTierMappings();
  }

  ngOnDestroy(): void {
    if (this.successTimer) {
      clearTimeout(this.successTimer);
      this.successTimer = null;
    }
  }

  // ============================================================================
  // AGENT LIST
  // ============================================================================

  async loadAgents(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const result = await this.rpcService.call(
        'ptahCli:list',
        {} as Record<string, never>
      );
      if (result.isSuccess()) {
        this.agents.set(result.data.agents);
        // TASK_2025_170: Refresh PtahCliStateService so agent selector
        // dropdown stays in sync with settings changes
        this.ptahCliState.refresh().catch(() => {
          // Non-critical: agent selector will refresh on next open
        });
      } else {
        this.error.set(result.error ?? 'Failed to load Ptah CLI agents');
      }
    } catch (err) {
      console.error('[PtahCliConfig]', err);
      this.error.set(
        `Failed to load Ptah CLI agents: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`
      );
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
      const result = await this.rpcService.call('ptahCli:create', {
        name: this.newAgentName().trim(),
        providerId: this.newAgentProvider(),
        apiKey: this.newAgentApiKey().trim(),
      });

      if (result.isSuccess() && result.data.success) {
        this.showSuccess(`Agent "${this.newAgentName().trim()}" created`);
        this.resetAddForm();
        this.showAddForm.set(false);
        await this.loadAgents();
        await this.loadTierMappings();
        this.ptahCliChanged.emit();
      } else {
        this.error.set(
          result.data?.error ?? result.error ?? 'Failed to create agent'
        );
      }
    } catch (err) {
      console.error('[PtahCliConfig]', err);
      this.error.set(
        `Failed to create agent: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`
      );
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

  startEdit(agent: PtahCliSummary): void {
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
      const result = await this.rpcService.call('ptahCli:update', {
        id: agentId,
        name,
      });

      if (result.isSuccess() && result.data.success) {
        this.showSuccess('Agent updated');
        this.cancelEdit();
        await this.loadAgents();
        await this.loadTierMappings();
        this.ptahCliChanged.emit();
      } else {
        this.error.set(
          result.data?.error ?? result.error ?? 'Failed to update agent'
        );
      }
    } catch (err) {
      console.error('[PtahCliConfig]', err);
      this.error.set(
        `Failed to update agent: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`
      );
    }
  }

  // ============================================================================
  // TOGGLE ENABLED
  // ============================================================================

  async toggleEnabled(agent: PtahCliSummary): Promise<void> {
    if (this.isUpdating()) return;
    this.isUpdating.set(true);
    this.error.set(null);
    try {
      const result = await this.rpcService.call('ptahCli:update', {
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
        // Refresh state service for agent selector sync
        this.ptahCliState.refresh().catch(() => {
          // Non-critical: agent selector will refresh on next open
        });
        this.ptahCliChanged.emit();
      } else {
        this.error.set(
          result.data?.error ?? result.error ?? 'Failed to toggle agent'
        );
      }
    } catch (err) {
      console.error('[PtahCliConfig]', err);
      this.error.set(
        `Failed to toggle agent: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`
      );
    } finally {
      this.isUpdating.set(false);
    }
  }

  // ============================================================================
  // DELETE AGENT
  // ============================================================================

  async deleteAgent(agent: PtahCliSummary): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Ptah CLI Agent',
      message: `Are you sure you want to delete "${agent.name}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      confirmStyle: 'error',
    });

    if (!confirmed) return;

    this.error.set(null);
    try {
      const result = await this.rpcService.call('ptahCli:delete', {
        id: agent.id,
      });

      if (result.isSuccess() && result.data.success) {
        this.showSuccess(`Agent "${agent.name}" deleted`);
        await this.loadAgents();
        await this.loadTierMappings();
        this.ptahCliChanged.emit();
      } else {
        this.error.set(
          result.data?.error ?? result.error ?? 'Failed to delete agent'
        );
      }
    } catch (err) {
      console.error('[PtahCliConfig]', err);
      this.error.set(
        `Failed to delete agent: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`
      );
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
      const result = await this.rpcService.call('ptahCli:testConnection', {
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
    } catch (err) {
      console.error('[PtahCliConfig]', err);
      this.testResultAgentId.set(agentId);
      this.testResult.set({
        success: false,
        error: `Connection test failed: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`,
      });
    } finally {
      this.testingAgentId.set(null);
    }
  }

  // ============================================================================
  // MODEL MAPPING
  // ============================================================================

  async loadTierMappings(): Promise<void> {
    const agents = this.agents();
    const uniqueProviderIds = [
      ...new Set(agents.filter((a) => a.hasApiKey).map((a) => a.providerId)),
    ];

    const mappings: Record<
      string,
      { sonnet: string | null; opus: string | null; haiku: string | null }
    > = {};

    await Promise.all(
      uniqueProviderIds.map(async (providerId) => {
        try {
          const result = await this.rpcService.call('provider:getModelTiers', {
            providerId,
          });
          if (result.isSuccess() && result.data) {
            const data = result.data as unknown as {
              sonnet?: string | null;
              opus?: string | null;
              haiku?: string | null;
            };
            mappings[providerId] = {
              sonnet: data.sonnet ?? null,
              opus: data.opus ?? null,
              haiku: data.haiku ?? null,
            };
          }
        } catch {
          // Non-fatal
        }
      })
    );

    this.providerTierMappings.set(mappings);
  }

  getAgentMappings(agent: PtahCliSummary): {
    sonnet: string | null;
    opus: string | null;
    haiku: string | null;
  } | null {
    return this.providerTierMappings()[agent.providerId] ?? null;
  }

  openModelMapping(agent: PtahCliSummary): void {
    this.modelMappingAgent.set(agent);
    this.modelMappingDialog()?.nativeElement.showModal();
  }

  async closeModelMapping(): Promise<void> {
    this.modelMappingDialog()?.nativeElement.close();
    this.modelMappingAgent.set(null);
    await this.loadTierMappings();
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
