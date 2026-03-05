/**
 * LlmProvidersConfigComponent - LLM Provider Configuration UI
 * TASK_2025_155 Batch 5, Task 5.2
 *
 * Displays configured LLM providers as cards with model selection
 * and default provider selection. Delegates all state management to
 * LlmProviderStateService.
 *
 * Complexity Level: 2 (Medium - form state + service delegation, no inheritance)
 *
 * Responsibilities:
 * - Display provider cards (excluding VS Code LM, which is in Tab 2)
 * - Manage local state (model selection, visibility toggles)
 * - Delegate save/remove/default-change operations to LlmProviderStateService
 * - Show loading and error states from service
 *
 * SOLID Principles:
 * - Single Responsibility: Provider configuration display only
 * - Dependency Inversion: Depends on LlmProviderStateService abstraction
 * - Open/Closed: Extensible via new providers added to service, no component edits needed
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
import {
  LucideAngularModule,
  Key,
  Check,
  X,
  Eye,
  EyeOff,
  Star,
  Shield,
  Cpu,
  Save,
} from 'lucide-angular';
import { LlmProviderStateService } from '@ptah-extension/core';
import type { LlmProviderName } from '@ptah-extension/shared';

/**
 * LlmProvidersConfigComponent - Standalone component for managing LLM provider config
 *
 * Displays provider cards for all LLM providers except vscode-lm. Each card shows:
 * - Provider name, configuration status badge, and default provider badge
 * - Default model and capability badges
 * - "Set as Default" button when provider is configured but not the current default
 *
 * Local state (per-component signals):
 * - apiKeyInputs: tracks typed key values per provider (not persisted until saved)
 * - showApiKey: tracks visibility toggle per provider
 * - savingProvider: guards against concurrent saves
 */
@Component({
  selector: 'ptah-llm-providers-config',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  templateUrl: './llm-providers-config.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LlmProvidersConfigComponent implements OnInit {
  /** LLM provider state service - single source of truth for all provider state (PUBLIC for template access) */
  readonly llmState = inject(LlmProviderStateService);

  /**
   * All providers excluding vscode-lm (now handled by VscodeLmConfigComponent in Tab 2).
   */
  readonly filteredProviders = computed(() =>
    this.llmState.providers().filter((p) => p.provider !== 'vscode-lm')
  );

  // --- Lucide icons ---
  readonly KeyIcon = Key;
  readonly CheckIcon = Check;
  readonly XIcon = X;
  readonly EyeIcon = Eye;
  readonly EyeOffIcon = EyeOff;
  readonly StarIcon = Star;
  readonly ShieldIcon = Shield;
  readonly CpuIcon = Cpu;
  readonly SaveIcon = Save;

  // --- Local form signals ---

  /**
   * Tracks API key input values per provider.
   * Map key: provider name (e.g., 'vscode-lm').
   * Value: the text currently typed in the input (not yet saved).
   */
  readonly apiKeyInputs = signal<Map<string, string>>(new Map());

  /**
   * Tracks whether the API key input is shown in plaintext per provider.
   * Map key: provider name. Value: true = show, false = masked.
   */
  readonly showApiKey = signal<Map<string, boolean>>(new Map());

  /**
   * Tracks which provider is currently being saved (for loading state on button).
   * null when no save is in progress.
   */
  readonly savingProvider = signal<string | null>(null);

  /**
   * Tracks which provider is currently having its key removed (for loading state).
   * null when no removal is in progress.
   */
  readonly removingProvider = signal<string | null>(null);

  /**
   * Tracks default model input values per provider.
   * Map key: provider name. Value: the model text currently typed in the input.
   */
  readonly modelInputs = signal<Map<string, string>>(new Map());

  /**
   * Tracks which provider is currently having its model saved (for loading state).
   * null when no save is in progress.
   */
  readonly savingModel = signal<string | null>(null);

  /**
   * Load provider status on component initialization.
   * Delegates to LlmProviderStateService which fetches from backend via RPC.
   * After provider status loads, loads models for all configured providers.
   */
  async ngOnInit(): Promise<void> {
    try {
      await this.llmState.loadProviderStatus();

      // Load models for all configured providers (vscode-lm handled by VscodeLmConfigComponent)
      const providers = this.llmState.providers();
      const modelLoadPromises: Promise<void>[] = [];

      for (const p of providers) {
        if (p.provider !== 'vscode-lm' && p.isConfigured) {
          modelLoadPromises.push(this.llmState.loadProviderModels(p.provider));
        }
      }

      await Promise.all(modelLoadPromises);
    } catch (error) {
      console.error(
        '[LlmProvidersConfigComponent] Failed to initialize provider status:',
        error
      );
    }
  }

  /**
   * Save the API key for the given provider.
   *
   * Flow:
   * 1. Guard against concurrent saves
   * 2. Get key value from apiKeyInputs map
   * 3. Delegate to llmState.setApiKey()
   * 4. On success: clear the input for that provider
   *
   * @param provider - The LLM provider to save the key for
   */
  async onSaveApiKey(provider: LlmProviderName): Promise<void> {
    if (this.savingProvider() === provider) {
      return;
    }

    const keyValue = this.apiKeyInputs().get(provider)?.trim();
    if (!keyValue) {
      return;
    }

    this.savingProvider.set(provider);

    try {
      const success = await this.llmState.setApiKey(provider, keyValue);

      if (success) {
        // Clear the input for this provider on successful save
        const updated = new Map(this.apiKeyInputs());
        updated.delete(provider);
        this.apiKeyInputs.set(updated);
        // Model load is already triggered by setApiKey → loadProviderModels
      }
    } finally {
      this.savingProvider.set(null);
    }
  }

  /**
   * Remove the API key for the given provider.
   * Guarded against concurrent removals via removingProvider signal.
   * Delegates to llmState.removeApiKey() which refreshes provider status on success.
   *
   * @param provider - The LLM provider whose key should be removed
   */
  async onRemoveApiKey(provider: LlmProviderName): Promise<void> {
    if (this.removingProvider() === provider) {
      return;
    }

    this.removingProvider.set(provider);

    try {
      await this.llmState.removeApiKey(provider);
    } finally {
      this.removingProvider.set(null);
    }
  }

  /**
   * Set the default LLM provider.
   * Delegates to llmState.setDefaultProvider() which updates signal on success.
   *
   * @param provider - The LLM provider to set as default
   */
  async onDefaultProviderChange(provider: LlmProviderName): Promise<void> {
    await this.llmState.setDefaultProvider(provider);
  }

  /**
   * Toggle the visibility of the API key input for the given provider.
   * Flips the current value in the showApiKey map.
   *
   * @param provider - The provider whose key visibility should be toggled
   */
  toggleApiKeyVisibility(provider: string): void {
    const updated = new Map(this.showApiKey());
    updated.set(provider, !updated.get(provider));
    this.showApiKey.set(updated);
  }

  /**
   * Update the API key input value for the given provider.
   * Called on every keystroke in the key input field.
   *
   * @param provider - The provider whose key input is being updated
   * @param value - The current input value
   */
  updateApiKeyInput(provider: string, value: string): void {
    const updated = new Map(this.apiKeyInputs());
    updated.set(provider, value);
    this.apiKeyInputs.set(updated);
  }

  /**
   * Update the model input value for the given provider.
   *
   * @param provider - The provider whose model input is being updated
   * @param value - The current input value
   */
  public updateModelInputEvent(provider: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.updateModelInput(provider, value);
  }

  updateModelInput(provider: string, value: string): void {
    const updated = new Map(this.modelInputs());
    updated.set(provider, value);
    this.modelInputs.set(updated);
  }

  /**
   * Save the default model for the given provider.
   * Delegates to llmState.setDefaultModel() which persists to VS Code settings.
   *
   * @param provider - The LLM provider to save the model for
   */
  async onSaveDefaultModel(provider: LlmProviderName): Promise<void> {
    if (this.savingModel() === provider) {
      return;
    }

    const modelValue = this.modelInputs().get(provider)?.trim();
    if (!modelValue) {
      return;
    }

    this.savingModel.set(provider);

    try {
      await this.llmState.setDefaultModel(provider, modelValue);
      // Clear the local input override so it falls back to the refreshed value
      const updated = new Map(this.modelInputs());
      updated.delete(provider);
      this.modelInputs.set(updated);
    } finally {
      this.savingModel.set(null);
    }
  }

  /**
   * Handle model selection from a provider dropdown.
   * Saves the selected model as the default for the given provider.
   *
   * @param provider - The LLM provider
   * @param modelId - The selected model ID
   */
  public onProviderModelSelectEvent(provider: LlmProviderName, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.onProviderModelSelect(provider, value);
  }

  async onProviderModelSelect(
    provider: LlmProviderName,
    modelId: string
  ): Promise<void> {
    if (!modelId || this.savingModel() === provider) {
      return;
    }

    this.savingModel.set(provider);

    try {
      await this.llmState.setDefaultModel(provider, modelId);
    } finally {
      this.savingModel.set(null);
    }
  }

  /**
   * Format a capability string for display.
   * Converts kebab-case to Title Case (e.g., 'text-chat' -> 'Text Chat').
   *
   * @param cap - The capability string to format
   * @returns Formatted display string
   */
  formatCapability(cap: string): string {
    return cap
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
}
