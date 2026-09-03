import {
  Component,
  inject,
  ChangeDetectionStrategy,
  signal,
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

type ProviderId = 'tavily' | 'serper' | 'exa';

/**
 * Provider metadata for the UI
 */
interface ProviderOption {
  value: ProviderId;
  label: string;
  description: string;
  signupUrl: string;
}

interface ProviderTestResult {
  provider: string;
  success: boolean;
  error?: string;
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
 * Lets the user select one or more search providers (Tavily, Serper, Exa)
 * to run in parallel, manage API keys per provider via SecretStorage, test
 * every configured provider, and configure max results.
 *
 * Cross-platform: works identically on VS Code and Electron.
 * API keys are never displayed in the UI.
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

        <p class="text-xs text-base-content-muted mb-3">
          Enable web search for AI agents via the
          <code class="text-[10px] bg-base-300 px-1 rounded"
            >ptah_web_search</code
          >
          MCP tool. Select one or more providers to run in parallel.
        </p>

        <!-- Error display -->
        @if (errorMessage()) {
          <div class="text-xs text-error mb-2">{{ errorMessage() }}</div>
        }

        <!-- Provider selection -->
        <div class="mb-3">
          <span class="text-xs font-medium text-base-content-muted mb-1 block">
            Search Providers
          </span>
          <div class="flex flex-col gap-2">
            @for (opt of providerOptions; track opt.value) {
              <div class="border border-secondary/20 rounded p-2">
                <div class="flex items-center justify-between">
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-xs checkbox-secondary"
                      [checked]="isSelected(opt.value)"
                      (change)="toggleProvider(opt.value)"
                      [attr.data-testid]="
                        'settings-toggle-web-search-provider-' + opt.value
                      "
                    />
                    <span class="text-xs font-medium">{{ opt.label }}</span>
                  </label>
                  @if (apiKeyConfigured()[opt.value]) {
                    <span class="badge badge-success badge-xs gap-1">
                      <lucide-angular
                        [img]="CheckCircleIcon"
                        class="w-2.5 h-2.5"
                      />
                      Key set
                    </span>
                  } @else {
                    <span class="badge badge-ghost badge-xs gap-1">
                      <lucide-angular [img]="XCircleIcon" class="w-2.5 h-2.5" />
                      No key
                    </span>
                  }
                </div>

                <p class="text-[10px] text-base-content-muted mt-1">
                  {{ opt.description }}
                  <a
                    [href]="opt.signupUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="link link-hover link-secondary"
                  >
                    Get API key
                  </a>
                </p>

                <div class="mt-1.5">
                  @if (activeKeyProvider() === opt.value) {
                    <div class="flex gap-1.5">
                      <input
                        [id]="'web-search-api-key-' + opt.value"
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
                        [attr.aria-label]="'Save API key for ' + opt.label"
                      >
                        @if (isSavingKey()) {
                          <span
                            class="loading loading-spinner loading-xs"
                          ></span>
                        } @else {
                          Save
                        }
                      </button>
                      <button
                        class="btn btn-ghost btn-xs"
                        (click)="closeKeyEditor()"
                        aria-label="Cancel"
                      >
                        Cancel
                      </button>
                    </div>
                  } @else {
                    <div class="flex gap-1.5">
                      <button
                        class="btn btn-outline btn-xs gap-1"
                        (click)="openKeyEditor(opt.value)"
                        [attr.aria-label]="'Manage API key for ' + opt.label"
                      >
                        <lucide-angular [img]="KeyIcon" class="w-3 h-3" />
                        {{
                          apiKeyConfigured()[opt.value]
                            ? 'Update key'
                            : 'Set key'
                        }}
                      </button>
                      @if (apiKeyConfigured()[opt.value]) {
                        <button
                          class="btn btn-ghost btn-xs text-error"
                          (click)="deleteApiKey(opt.value)"
                          [attr.aria-label]="'Delete API key for ' + opt.label"
                        >
                          Clear
                        </button>
                      }
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        </div>

        <!-- Test Connection -->
        <div class="mb-3">
          <div class="flex items-center gap-2 mb-1">
            <button
              class="btn btn-outline btn-xs gap-1"
              [disabled]="isTesting()"
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
          </div>
          @if (testResult()) {
            <div class="flex flex-col gap-0.5">
              @for (r of testResult()!.results; track r.provider) {
                <span
                  class="text-xs flex items-center gap-1"
                  [class.text-success]="r.success"
                  [class.text-error]="!r.success"
                >
                  <lucide-angular
                    [img]="r.success ? CheckCircleIcon : XCircleIcon"
                    class="w-3 h-3"
                  />
                  {{ r.provider }}: {{ r.success ? 'works' : r.error }}
                </span>
              }
            </div>
          }
        </div>

        <!-- Max Results -->
        <div>
          <div class="flex items-center justify-between mb-1">
            <label
              for="web-search-max-results"
              class="text-xs font-medium text-base-content-muted"
            >
              Max Results
            </label>
            <span class="text-xs text-base-content-muted">
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
            class="flex justify-between text-[10px] text-base-content-muted px-0.5"
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
  readonly GlobeIcon = Globe;
  readonly KeyIcon = Key;
  readonly CheckCircleIcon = CheckCircle;
  readonly XCircleIcon = XCircle;
  readonly FlaskConicalIcon = FlaskConical;
  readonly providerOptions = PROVIDER_OPTIONS;

  readonly selectedProviders = signal<ReadonlySet<ProviderId>>(new Set());
  readonly apiKeyConfigured = signal<Record<ProviderId, boolean>>({
    tavily: false,
    serper: false,
    exa: false,
  });
  readonly activeKeyProvider = signal<ProviderId | null>(null);
  readonly apiKeyInput = signal('');
  readonly maxResults = signal(5);
  readonly isTesting = signal(false);
  readonly isSavingKey = signal(false);
  readonly testResult = signal<{
    success: boolean;
    results: ProviderTestResult[];
  } | null>(null);
  readonly errorMessage = signal<string | null>(null);

  isSelected(provider: ProviderId): boolean {
    return this.selectedProviders().has(provider);
  }

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
        const providers = configResult.data.providers as ProviderId[];
        this.selectedProviders.set(new Set(providers));
        this.maxResults.set(configResult.data.maxResults);
      }
    } catch {
      this.errorMessage.set('Failed to load web search configuration');
    }

    await this.loadApiKeyStatuses();
  }

  /**
   * Check API key status for every provider
   */
  async loadApiKeyStatuses(): Promise<void> {
    const entries = await Promise.all(
      this.providerOptions.map(async (opt) => {
        const result = await this.rpcService.call('webSearch:getApiKeyStatus', {
          provider: opt.value,
        });
        return [
          opt.value,
          result.isSuccess() && result.data.configured,
        ] as const;
      }),
    );
    this.apiKeyConfigured.set(
      Object.fromEntries(entries) as Record<ProviderId, boolean>,
    );
  }

  /**
   * Toggle a provider's selection. Refuses to leave zero providers selected.
   */
  async toggleProvider(provider: ProviderId): Promise<void> {
    const current = new Set(this.selectedProviders());

    if (current.has(provider)) {
      if (current.size === 1) {
        this.errorMessage.set('At least one provider must stay selected.');
        return;
      }
      current.delete(provider);
    } else {
      current.add(provider);
    }

    this.errorMessage.set(null);
    this.selectedProviders.set(current);
    this.testResult.set(null);
    await this.saveConfig({ providers: Array.from(current) });
  }

  openKeyEditor(provider: ProviderId): void {
    this.activeKeyProvider.set(provider);
    this.apiKeyInput.set('');
    this.errorMessage.set(null);
  }

  closeKeyEditor(): void {
    this.activeKeyProvider.set(null);
    this.apiKeyInput.set('');
  }

  onApiKeyInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.apiKeyInput.set(value);
  }

  /**
   * Save the API key for the currently active provider row
   */
  async saveApiKey(): Promise<void> {
    const provider = this.activeKeyProvider();
    const apiKey = this.apiKeyInput();
    if (!provider || !apiKey) return;

    this.isSavingKey.set(true);
    this.errorMessage.set(null);

    try {
      const result = await this.rpcService.call('webSearch:setApiKey', {
        provider,
        apiKey,
      });

      if (result.isSuccess()) {
        this.apiKeyConfigured.update((prev) => ({
          ...prev,
          [provider]: true,
        }));
        this.closeKeyEditor();
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
   * Delete the API key for a provider
   */
  async deleteApiKey(provider: ProviderId): Promise<void> {
    this.errorMessage.set(null);

    try {
      const result = await this.rpcService.call('webSearch:deleteApiKey', {
        provider,
      });

      if (result.isSuccess()) {
        this.apiKeyConfigured.update((prev) => ({
          ...prev,
          [provider]: false,
        }));
        this.testResult.set(null);
      }
    } catch {
      this.errorMessage.set('Failed to delete API key');
    }
  }

  /**
   * Test every configured provider and show a per-provider pass/fail line
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
          results: result.data.results,
        });
      } else {
        this.errorMessage.set(result.error ?? 'Test failed');
      }
    } catch {
      this.errorMessage.set('Test request failed');
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
    providers?: string[];
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
