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
  Globe,
  Key,
  CheckCircle,
  XCircle,
  FlaskConical,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';

/**
 * Provider metadata for the UI
 */
interface ProviderOption {
  value: 'tavily' | 'serper' | 'exa';
  label: string;
  description: string;
  signupUrl: string;
}

const PROVIDER_OPTIONS: readonly ProviderOption[] = [
  {
    value: 'tavily',
    label: 'Tavily',
    description:
      'AI-optimized search API with built-in answer generation. Free tier: 1,000 searches/month.',
    signupUrl: 'https://tavily.com',
  },
  {
    value: 'serper',
    label: 'Serper',
    description:
      'Google Search API. Fast, reliable results. Free tier: 2,500 searches/month.',
    signupUrl: 'https://serper.dev',
  },
  {
    value: 'exa',
    label: 'Exa',
    description:
      'AI-powered semantic search engine. Free tier: 1,000 searches/month.',
    signupUrl: 'https://exa.ai',
  },
] as const;

/**
 * WebSearchConfigComponent - Web search provider configuration panel.
 *
 * Allows users to select a search provider (Tavily, Serper, Exa),
 * manage API keys via SecretStorage, test the connection, and
 * configure max results.
 *
 * Cross-platform: works identically on VS Code and Electron.
 * API keys are never displayed in the UI.
 *
 * TASK_2025_235 Batch 3
 */
@Component({
  selector: 'ptah-web-search-config',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mt-4 block' },
  template: `
    <div class="border border-secondary/30 rounded-md bg-secondary/5">
      <div class="p-3">
        <div class="flex items-center gap-1.5 mb-2">
          <lucide-angular [img]="GlobeIcon" class="w-4 h-4 text-secondary" />
          <h2 class="text-xs font-medium uppercase tracking-wide">
            Web Search
          </h2>
        </div>

        <p class="text-xs text-base-content/70 mb-3">
          Enable web search for AI agents via the
          <code class="text-[10px] bg-base-300 px-1 rounded"
            >ptah_web_search</code
          >
          MCP tool.
        </p>

        <!-- Error display -->
        @if (errorMessage()) {
          <div class="text-xs text-error mb-2">{{ errorMessage() }}</div>
        }

        <!-- Provider selection -->
        <div class="mb-3">
          <label
            for="web-search-provider"
            class="text-xs font-medium text-base-content/70 mb-1 block"
          >
            Search Provider
          </label>
          <select
            id="web-search-provider"
            class="select select-bordered select-xs w-full"
            [value]="selectedProvider()"
            (change)="onProviderChange($event)"
          >
            @for (opt of providerOptions; track opt.value) {
              <option
                [value]="opt.value"
                [selected]="opt.value === selectedProvider()"
              >
                {{ opt.label }}
              </option>
            }
          </select>
          @if (activeProviderInfo()) {
            <p class="text-[10px] text-base-content/50 mt-1">
              {{ activeProviderInfo()!.description }}
              <a
                [href]="activeProviderInfo()!.signupUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="link link-hover link-secondary"
              >
                Get API key
              </a>
            </p>
          }
        </div>

        <!-- API Key Management -->
        <div class="mb-3">
          <div class="flex items-center justify-between mb-1">
            <label
              for="web-search-api-key"
              class="text-xs font-medium text-base-content/70 flex items-center gap-1"
            >
              <lucide-angular [img]="KeyIcon" class="w-3 h-3" />
              API Key
            </label>
            <!-- Status badge -->
            @if (apiKeyConfigured()) {
              <span class="badge badge-success badge-xs gap-1">
                <lucide-angular [img]="CheckCircleIcon" class="w-2.5 h-2.5" />
                Configured
              </span>
            } @else {
              <span class="badge badge-ghost badge-xs gap-1">
                <lucide-angular [img]="XCircleIcon" class="w-2.5 h-2.5" />
                Not configured
              </span>
            }
          </div>
          <div class="flex gap-1.5">
            <input
              id="web-search-api-key"
              type="password"
              class="input input-bordered input-xs flex-1"
              placeholder="Enter API key..."
              [value]="apiKeyInput()"
              (input)="onApiKeyInput($event)"
              autocomplete="off"
            />
            <button
              class="btn btn-primary btn-xs"
              [disabled]="!apiKeyInput() || isSavingKey()"
              (click)="saveApiKey()"
              aria-label="Save API key"
            >
              @if (isSavingKey()) {
                <span class="loading loading-spinner loading-xs"></span>
              } @else {
                Save
              }
            </button>
            @if (apiKeyConfigured()) {
              <button
                class="btn btn-ghost btn-xs text-error"
                (click)="deleteApiKey()"
                aria-label="Delete API key"
              >
                Clear
              </button>
            }
          </div>
        </div>

        <!-- Test Connection -->
        <div class="mb-3">
          <div class="flex items-center gap-2">
            <button
              class="btn btn-outline btn-xs gap-1"
              [disabled]="isTesting() || !apiKeyConfigured()"
              (click)="testSearch()"
              aria-label="Test web search connection"
            >
              @if (isTesting()) {
                <span class="loading loading-spinner loading-xs"></span>
              } @else {
                <lucide-angular [img]="FlaskConicalIcon" class="w-3 h-3" />
              }
              <span>Test Connection</span>
            </button>
            @if (testResult()) {
              @if (testResult()!.success) {
                <span class="text-xs text-success flex items-center gap-1">
                  <lucide-angular [img]="CheckCircleIcon" class="w-3 h-3" />
                  Search works!
                </span>
              } @else {
                <span class="text-xs text-error">
                  {{ testResult()!.error }}
                </span>
              }
            }
          </div>
        </div>

        <!-- Max Results -->
        <div>
          <div class="flex items-center justify-between mb-1">
            <label
              for="web-search-max-results"
              class="text-xs font-medium text-base-content/70"
            >
              Max Results
            </label>
            <span class="text-xs text-base-content/50">
              {{ maxResults() }}
            </span>
          </div>
          <input
            id="web-search-max-results"
            type="range"
            min="1"
            max="20"
            [value]="maxResults()"
            (change)="onMaxResultsChange($event)"
            class="range range-xs range-secondary"
          />
          <div
            class="flex justify-between text-[10px] text-base-content/40 px-0.5"
          >
            <span>1</span>
            <span>5</span>
            <span>10</span>
            <span>15</span>
            <span>20</span>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class WebSearchConfigComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);

  // Lucide icons
  readonly GlobeIcon = Globe;
  readonly KeyIcon = Key;
  readonly CheckCircleIcon = CheckCircle;
  readonly XCircleIcon = XCircle;
  readonly FlaskConicalIcon = FlaskConical;

  // Provider options for the dropdown
  readonly providerOptions = PROVIDER_OPTIONS;

  // State signals
  readonly selectedProvider = signal<'tavily' | 'serper' | 'exa'>('tavily');
  readonly apiKeyConfigured = signal(false);
  readonly apiKeyInput = signal('');
  readonly maxResults = signal(5);
  readonly isTesting = signal(false);
  readonly isSavingKey = signal(false);
  readonly testResult = signal<{
    success: boolean;
    error?: string;
  } | null>(null);
  readonly errorMessage = signal<string | null>(null);

  /**
   * Computed provider info for the selected provider
   */
  readonly activeProviderInfo = computed(
    () =>
      PROVIDER_OPTIONS.find((p) => p.value === this.selectedProvider()) ?? null,
  );

  async ngOnInit(): Promise<void> {
    await this.loadConfig();
  }

  /**
   * Load current configuration and API key status from backend
   */
  async loadConfig(): Promise<void> {
    this.errorMessage.set(null);

    try {
      const configResult = await this.rpcService.call(
        'webSearch:getConfig',
        {} as Record<string, never>,
      );
      if (configResult.isSuccess()) {
        const provider = configResult.data.provider as
          | 'tavily'
          | 'serper'
          | 'exa';
        this.selectedProvider.set(provider);
        this.maxResults.set(configResult.data.maxResults);
      }
    } catch {
      this.errorMessage.set('Failed to load web search configuration');
    }

    await this.loadApiKeyStatus();
  }

  /**
   * Check if the current provider has an API key configured
   */
  async loadApiKeyStatus(): Promise<void> {
    try {
      const result = await this.rpcService.call('webSearch:getApiKeyStatus', {
        provider: this.selectedProvider(),
      });
      if (result.isSuccess()) {
        this.apiKeyConfigured.set(result.data.configured);
      }
    } catch {
      // Non-fatal: status badge will show "Not configured"
    }
  }

  /**
   * Handle provider selection change
   */
  async onProviderChange(event: Event): Promise<void> {
    const value = (event.target as HTMLSelectElement).value as
      | 'tavily'
      | 'serper'
      | 'exa';
    this.selectedProvider.set(value);
    this.testResult.set(null);
    this.apiKeyInput.set('');

    // Save provider config
    await this.saveConfig({ provider: value });

    // Reload API key status for the new provider
    await this.loadApiKeyStatus();
  }

  /**
   * Handle API key input
   */
  onApiKeyInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.apiKeyInput.set(value);
  }

  /**
   * Save the API key to SecretStorage
   */
  async saveApiKey(): Promise<void> {
    const apiKey = this.apiKeyInput();
    if (!apiKey) return;

    this.isSavingKey.set(true);
    this.errorMessage.set(null);

    try {
      const result = await this.rpcService.call('webSearch:setApiKey', {
        provider: this.selectedProvider(),
        apiKey,
      });

      if (result.isSuccess()) {
        this.apiKeyConfigured.set(true);
        this.apiKeyInput.set('');
        this.testResult.set(null);
      } else {
        this.errorMessage.set(result.error ?? 'Failed to save API key');
      }
    } catch {
      this.errorMessage.set('Failed to save API key');
    } finally {
      this.isSavingKey.set(false);
    }
  }

  /**
   * Delete the API key from SecretStorage
   */
  async deleteApiKey(): Promise<void> {
    this.errorMessage.set(null);

    try {
      const result = await this.rpcService.call('webSearch:deleteApiKey', {
        provider: this.selectedProvider(),
      });

      if (result.isSuccess()) {
        this.apiKeyConfigured.set(false);
        this.testResult.set(null);
      }
    } catch {
      this.errorMessage.set('Failed to delete API key');
    }
  }

  /**
   * Test the current provider with a simple search query
   */
  async testSearch(): Promise<void> {
    this.isTesting.set(true);
    this.testResult.set(null);
    this.errorMessage.set(null);

    try {
      const result = await this.rpcService.call(
        'webSearch:test',
        {} as Record<string, never>,
      );

      if (result.isSuccess()) {
        this.testResult.set({
          success: result.data.success,
          error: result.data.error,
        });
      } else {
        this.testResult.set({
          success: false,
          error: result.error ?? 'Test failed',
        });
      }
    } catch {
      this.testResult.set({ success: false, error: 'Test request failed' });
    } finally {
      this.isTesting.set(false);
    }
  }

  /**
   * Handle max results slider change
   */
  async onMaxResultsChange(event: Event): Promise<void> {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    this.maxResults.set(value);
    await this.saveConfig({ maxResults: value });
  }

  /**
   * Save configuration via RPC.
   *
   * The backend handler uses a runtime duck-type check: both VscodeWorkspaceProvider
   * and ElectronWorkspaceProvider expose setConfiguration(), so this works on
   * both platforms via a single code path.
   */
  private async saveConfig(params: {
    provider?: string;
    maxResults?: number;
  }): Promise<void> {
    this.errorMessage.set(null);

    try {
      await this.rpcService.call('webSearch:setConfig', params);
    } catch {
      this.errorMessage.set(
        'Could not save setting. You can also change it in VS Code Settings (Ctrl+,).',
      );
    }
  }
}
