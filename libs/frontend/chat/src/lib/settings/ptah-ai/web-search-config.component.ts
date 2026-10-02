import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  AlertCircle,
  CheckCircle,
  Eye,
  EyeOff,
  FlaskConical,
  Globe,
  Key,
  LucideAngularModule,
  XCircle,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';

type ProviderId = 'tavily' | 'serper' | 'exa';
type WriteResult = { ok: true } | { ok: false; message: string };

interface ProviderOption {
  value: ProviderId;
  label: string;
  /** What the provider is; shown in the row's tooltip and to screen readers, not as a visible line. */
  summary: string;
  /** The one visible line under the name (pattern map §3.2: a row stays within ~48 px). */
  freeTier: string;
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
    summary: 'AI-optimized search API with built-in answer generation.',
    freeTier: 'Free tier: 1,000 searches/month.',
    signupUrl: 'https://tavily.com',
  },
  {
    value: 'serper',
    label: 'Serper',
    summary: 'Google Search API. Fast, reliable results.',
    freeTier: 'Free tier: 2,500 searches/month.',
    signupUrl: 'https://serper.dev',
  },
  {
    value: 'exa',
    label: 'Exa',
    summary: 'AI-powered semantic search engine.',
    freeTier: 'Free tier: 1,000 searches/month.',
    signupUrl: 'https://exa.ai',
  },
] as const;

/** One fixed sentence per action (F1): no host or transport text reaches the alert, popover or toast. */
const LOAD_CONFIG_FAILED = 'Could not load the web search settings.';
const SAVE_PROVIDERS_FAILED = 'Could not save the web search providers.';
const SAVE_MAX_RESULTS_FAILED = 'Could not save the web search max results.';
/**
 * Used for the whole probe and for each failed provider row: the backend's per-provider `error` is a
 * raw `Error.message` (`web-search-rpc.handlers.ts:202-207`), not a fixed reason.
 */
const TEST_FAILED = 'The connection check failed.';

function asProviderIds(values: readonly string[]): ProviderId[] {
  return values.filter((value): value is ProviderId =>
    PROVIDER_OPTIONS.some((option) => option.value === value),
  );
}

function providerLabel(provider: ProviderId): string {
  return (
    PROVIDER_OPTIONS.find((option) => option.value === provider)?.label ??
    provider
  );
}

/**
 * Web search card on the Search & Voice tab (pattern map V1-V8).
 *
 * A `table-xs` matrix with one row per provider (Tavily, Serper, Exa): an "On" checkbox, the
 * provider and its free-tier line, the key badge, the last test result and the key actions. Max
 * results sits in a policy bar under the matrix. Every write goes through
 * {@link SettingsSaveFeedbackService.saveGeneric}: "Saved" only after the write's own result, a
 * failed write reverts the control and raises an alert toast (D15). Keys are entered in a popover
 * and never rendered; Clear asks for an inline confirm and has no Undo. Testing probes the stored
 * keys only, so a key is saved first and tested after (G11).
 */
@Component({
  selector: 'ptah-web-search-config',
  standalone: true,
  imports: [LucideAngularModule, NativePopoverComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="card bg-base-200 border border-base-300 p-3" aria-labelledby="web-search-heading">
      <div class="flex items-center justify-between gap-3 mb-2">
        <div class="flex items-center gap-1.5">
          <lucide-angular [img]="GlobeIcon" class="w-4 h-4 text-secondary" aria-hidden="true" />
          <h2 id="web-search-heading" class="text-xs font-bold uppercase tracking-wider text-base-content">
            Web Search
          </h2>
        </div>
        <button type="button" class="btn btn-outline btn-xs gap-1" [disabled]="isTesting()"
          (click)="testSearch()" aria-label="Test web search connection" data-testid="settings-web-search-test">
          @if (isTesting()) {
            <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
          } @else {
            <lucide-angular [img]="FlaskConicalIcon" class="w-3 h-3" aria-hidden="true" />
          }
          Test connection
        </button>
      </div>

      <p class="text-xs text-base-content-muted mb-3">
        Enable web search for AI agents via the
        <code class="text-xs bg-base-300 px-1 rounded text-base-content">ptah_web_search</code>
        MCP tool. Select one or more providers to run in parallel.
      </p>

      @if (errorMessage(); as message) {
        <div role="alert" data-testid="settings-web-search-error"
          class="mb-3 flex items-center gap-1.5 rounded border border-error/40 p-2 text-xs text-base-content">
          <lucide-angular [img]="AlertCircleIcon" class="w-3.5 h-3.5 text-error shrink-0" aria-hidden="true" />
          {{ message }}
        </div>
      }

      <div class="overflow-x-auto">
        <table class="table table-xs">
          <thead>
            <tr>
              <th class="w-10" scope="col">On</th>
              <th scope="col">Provider</th>
              <th scope="col">Key</th>
              <th scope="col">Status</th>
              <th class="text-right" scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (opt of providerOptions; track opt.value) {
              <tr>
                <td class="align-top">
                  <input type="checkbox" class="checkbox checkbox-xs checkbox-primary"
                    [checked]="isSelected(opt.value)" [disabled]="saving()"
                    (change)="onProviderChange(opt.value, $event)"
                    [attr.data-testid]="'settings-toggle-web-search-provider-' + opt.value"
                    [attr.aria-label]="'Use ' + opt.label + ' for web search'" />
                </td>
                <td class="align-top" [attr.title]="opt.summary + ' ' + opt.freeTier">
                  <div class="font-bold text-base-content">
                    {{ opt.label }}<span class="sr-only">: {{ opt.summary }}</span>
                  </div>
                  <p class="whitespace-nowrap text-xs text-base-content-muted">
                    {{ opt.freeTier }}
                    <a [href]="opt.signupUrl" target="_blank" rel="noopener noreferrer"
                      class="link underline text-base-content"
                      [attr.data-testid]="'settings-web-search-signup-' + opt.value">Get API key</a>
                  </p>
                </td>
                <td class="align-top">
                  <span class="badge badge-outline badge-sm gap-1 whitespace-nowrap text-base-content"
                    [attr.data-testid]="'settings-web-search-key-status-' + opt.value">
                    <span aria-hidden="true"
                      [class]="apiKeyConfigured()[opt.value] ? 'w-1.5 h-1.5 rounded-full bg-success' : 'w-1.5 h-1.5 rounded-full bg-base-content/40'"></span>
                    {{ apiKeyConfigured()[opt.value] ? 'Key set' : 'No key' }}
                  </span>
                </td>
                <td class="align-top" [attr.data-testid]="'settings-web-search-status-' + opt.value">
                  @if (resultFor(opt.value); as r) {
                    <span class="badge badge-outline badge-sm h-auto gap-1 text-base-content">
                      <lucide-angular [img]="r.success ? CheckCircleIcon : XCircleIcon" class="w-3 h-3 shrink-0"
                        [class.text-success]="r.success" [class.text-error]="!r.success" aria-hidden="true" />
                      {{ r.success ? 'Works' : TEST_FAILED }}
                    </span>
                  } @else {
                    <span class="text-base-content-muted" aria-hidden="true">—</span>
                    <span class="sr-only">Not tested</span>
                  }
                </td>
                <td class="align-top text-right">
                  <div class="flex flex-nowrap justify-end gap-1.5">
                    <ptah-native-popover [isOpen]="activeKeyProvider() === opt.value" (closed)="closeKeyEditor()">
                      <button type="button" trigger class="btn btn-outline btn-xs gap-1"
                        (click)="openKeyEditor(opt.value)"
                        [attr.aria-label]="(apiKeyConfigured()[opt.value] ? 'Update' : 'Set') + ' API key for ' + opt.label"
                        [attr.data-testid]="'settings-web-search-key-btn-' + opt.value">
                        <lucide-angular [img]="KeyIcon" class="w-3 h-3" aria-hidden="true" />
                        {{ apiKeyConfigured()[opt.value] ? 'Update key' : 'Set key' }}
                      </button>
                      <div content class="p-3 w-72 space-y-2 text-left">
                        <label class="block text-xs font-semibold text-base-content" [for]="'web-search-api-key-' + opt.value">
                          API key for {{ opt.label }}
                        </label>
                        <div class="relative">
                          <input [id]="'web-search-api-key-' + opt.value" [type]="keyVisible() ? 'text' : 'password'"
                            class="input input-bordered input-sm w-full pr-9 font-mono text-xs"
                            placeholder="Paste the API key" autocomplete="off" spellcheck="false"
                            [value]="apiKeyInput()" (input)="onApiKeyInput($event)" (keydown.enter)="saveApiKey()"
                            data-testid="settings-web-search-key-input" />
                          <button type="button" class="btn btn-ghost btn-xs absolute right-1 top-1"
                            (click)="keyVisible.set(!keyVisible())"
                            [attr.aria-label]="keyVisible() ? 'Hide API key' : 'Show API key'"
                            [attr.aria-pressed]="keyVisible()" data-testid="settings-web-search-key-visibility">
                            <lucide-angular [img]="keyVisible() ? EyeOffIcon : EyeIcon" class="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                        <p class="text-xs text-base-content-muted">
                          Stored encrypted on this machine. Use Test connection after saving to check it.
                          <a [href]="opt.signupUrl" target="_blank" rel="noopener noreferrer"
                            class="link underline text-base-content">Get a key</a>
                        </p>
                        @if (keyError(); as message) {
                          <p role="alert" class="flex items-center gap-1.5 text-xs text-base-content"
                            data-testid="settings-web-search-key-error">
                            <lucide-angular [img]="AlertCircleIcon" class="w-3.5 h-3.5 text-error shrink-0" aria-hidden="true" />
                            {{ message }}
                          </p>
                        }
                        <div class="flex gap-2">
                          <button type="button" class="btn btn-primary btn-sm"
                            [disabled]="!apiKeyInput().trim() || saving()" (click)="saveApiKey()"
                            [attr.aria-label]="'Save API key for ' + opt.label"
                            data-testid="settings-web-search-key-save">
                            @if (isSavingKey()) {
                              <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
                            }
                            Save key
                          </button>
                          <button type="button" class="btn btn-ghost btn-sm" (click)="closeKeyEditor()"
                            data-testid="settings-web-search-key-cancel">Cancel</button>
                        </div>
                      </div>
                    </ptah-native-popover>
                    @if (apiKeyConfigured()[opt.value]) {
                      <button type="button" class="btn btn-outline btn-xs text-base-content"
                        [disabled]="saving()" (click)="requestClear(opt.value)"
                        [attr.aria-label]="'Clear API key for ' + opt.label"
                        [attr.aria-expanded]="confirmingClear() === opt.value"
                        [attr.data-testid]="'settings-web-search-clear-btn-' + opt.value">Clear</button>
                    }
                  </div>
                  @if (apiKeyConfigured()[opt.value] && confirmingClear() === opt.value) {
                    <div role="group" [attr.aria-label]="'Confirm clear ' + opt.label + ' API key'"
                      class="mt-1.5 space-y-2 rounded border border-base-300 p-3 text-left"
                      [attr.data-testid]="'settings-web-search-clear-group-' + opt.value"
                      (keydown.escape)="cancelClear(opt.value, $event)">
                      <p class="text-xs text-base-content">
                        Clear the stored {{ opt.label }} key from this machine? Searches through {{ opt.label }} stop until a key is added.
                      </p>
                      @if (clearError(); as message) {
                        <p role="alert" class="flex items-center gap-1.5 text-xs text-base-content"
                          [attr.data-testid]="'settings-web-search-clear-error-' + opt.value">
                          <lucide-angular [img]="AlertCircleIcon" class="w-3.5 h-3.5 text-error shrink-0" aria-hidden="true" />
                          {{ message }}
                        </p>
                      }
                      <div class="flex gap-2">
                        <button type="button" class="btn btn-outline btn-sm border-error text-base-content"
                          [disabled]="saving()" (click)="deleteApiKey(opt.value)"
                          [attr.data-testid]="'settings-web-search-clear-confirm-' + opt.value">Clear key</button>
                        <button #clearCancel type="button" class="btn btn-ghost btn-sm" (click)="cancelClear(opt.value)"
                          [attr.data-testid]="'settings-web-search-clear-cancel-' + opt.value">Cancel</button>
                      </div>
                    </div>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <p class="text-xs text-base-content-muted mt-2">At least one provider must stay selected.</p>

      <div class="mt-2 flex items-center gap-3 rounded border border-base-300 py-2 px-3 text-xs">
        <label for="web-search-max-results" class="font-bold text-base-content whitespace-nowrap">Max results</label>
        <input id="web-search-max-results" type="range" min="1" max="20" [value]="maxResults()"
          [disabled]="saving()" (change)="onMaxResultsChange($event)"
          class="range range-xs range-primary flex-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          data-testid="settings-web-search-max-results" />
        <span class="badge badge-outline badge-sm font-mono text-base-content" aria-hidden="true">{{ maxResults() }}</span>
        <span class="text-xs text-base-content-muted whitespace-nowrap">per search</span>
      </div>
    </section>
  `,
})
export class WebSearchConfigComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly feedback = inject(SettingsSaveFeedbackService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly GlobeIcon = Globe;
  readonly TEST_FAILED = TEST_FAILED;
  readonly KeyIcon = Key;
  readonly CheckCircleIcon = CheckCircle;
  readonly XCircleIcon = XCircle;
  readonly FlaskConicalIcon = FlaskConical;
  readonly AlertCircleIcon = AlertCircle;
  readonly EyeIcon = Eye;
  readonly EyeOffIcon = EyeOff;
  readonly providerOptions = PROVIDER_OPTIONS;

  /** Save triggers are disabled while any settings write is in flight (D3). */
  readonly saving = this.feedback.saving;

  readonly selectedProviders = signal<ReadonlySet<ProviderId>>(new Set());
  readonly apiKeyConfigured = signal<Record<ProviderId, boolean>>({
    tavily: false,
    serper: false,
    exa: false,
  });
  readonly activeKeyProvider = signal<ProviderId | null>(null);
  readonly apiKeyInput = signal('');
  readonly keyVisible = signal(false);
  readonly keyError = signal<string | null>(null);
  readonly confirmingClear = signal<ProviderId | null>(null);
  /** A failed Clear's fixed sentence, shown inside the open inline confirm (F1). */
  readonly clearError = signal<string | null>(null);
  readonly maxResults = signal(5);
  readonly isTesting = signal(false);
  readonly isSavingKey = signal(false);
  readonly testResult = signal<{
    success: boolean;
    results: ProviderTestResult[];
  } | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly configLoaded = signal(false);

  private readonly clearCancelButton =
    viewChild<ElementRef<HTMLButtonElement>>('clearCancel');

  constructor() {
    // P8: the inline confirm takes focus on its Cancel button when it opens.
    effect(() => this.clearCancelButton()?.nativeElement.focus());
  }

  isSelected(provider: ProviderId): boolean {
    return this.selectedProviders().has(provider);
  }

  resultFor(provider: ProviderId): ProviderTestResult | undefined {
    return this.testResult()?.results.find((r) => r.provider === provider);
  }

  async ngOnInit(): Promise<void> {
    await this.loadConfig();
  }

  /** Loads the provider selection, max results and every key status. */
  async loadConfig(): Promise<void> {
    this.errorMessage.set(null);

    try {
      const configResult = await this.rpcService.call(
        'webSearch:getConfig',
        {} as Record<string, never>,
      );
      if (configResult.isSuccess()) {
        this.selectedProviders.set(
          new Set(asProviderIds(configResult.data.providers)),
        );
        this.maxResults.set(configResult.data.maxResults);
        this.configLoaded.set(true);
      } else {
        this.configLoaded.set(false);
        this.errorMessage.set(LOAD_CONFIG_FAILED);
      }
    } catch {
      // A thrown transport error gets the same fixed sentence.
      this.configLoaded.set(false);
      this.errorMessage.set(LOAD_CONFIG_FAILED);
    }

    await this.loadApiKeyStatuses();
  }

  /** Reads the key status of every provider; an unreadable status shows as "No key". */
  async loadApiKeyStatuses(): Promise<void> {
    const entries = await Promise.all(
      this.providerOptions.map(async (opt) => {
        try {
          const result = await this.rpcService.call(
            'webSearch:getApiKeyStatus',
            { provider: opt.value },
          );
          return [opt.value, result.isSuccess() && result.data.configured] as const;
        } catch (error: unknown) {
          console.warn('[WebSearchConfig] key status unavailable', opt.value, error);
          return [opt.value, false] as const;
        }
      }),
    );
    this.apiKeyConfigured.set(
      Object.fromEntries(entries) as Record<ProviderId, boolean>,
    );
  }

  /**
   * Checkbox change handler. The DOM checkbox has already flipped; once the save settles (or is
   * refused) it is set back to the saved selection so the control never shows an unsaved state.
   */
  async onProviderChange(provider: ProviderId, event: Event): Promise<void> {
    const checkbox = event.target as HTMLInputElement;
    await this.toggleProvider(provider);
    checkbox.checked = this.isSelected(provider);
  }

  /** Saves the selection with one provider added or removed. Refuses to leave none selected. */
  async toggleProvider(provider: ProviderId): Promise<void> {
    if (!this.configLoaded()) {
      this.errorMessage.set(
        'Configuration failed to load. Reload the panel before changing providers.',
      );
      return;
    }

    const previous = this.selectedProviders();
    const next = new Set(previous);
    if (next.has(provider)) {
      if (next.size === 1) {
        this.errorMessage.set('At least one provider must stay selected.');
        return;
      }
      next.delete(provider);
    } else {
      next.add(provider);
    }

    this.errorMessage.set(null);
    await this.feedback.saveGeneric({
      label: 'web search providers',
      write: () => this.writeProviders(next, previous),
      undo: () => this.writeProviders(previous, next),
    });
  }

  openKeyEditor(provider: ProviderId): void {
    this.activeKeyProvider.set(provider);
    this.apiKeyInput.set('');
    this.keyVisible.set(false);
    this.keyError.set(null);
    this.confirmingClear.set(null);
  }

  /** Every dismissal route (Cancel, Esc, backdrop, successful save) drops the typed key. */
  closeKeyEditor(): void {
    this.activeKeyProvider.set(null);
    this.apiKeyInput.set('');
    this.keyVisible.set(false);
    this.keyError.set(null);
  }

  onApiKeyInput(event: Event): void {
    this.apiKeyInput.set((event.target as HTMLInputElement).value);
    this.keyError.set(null);
  }

  /** Saves the key typed in the open popover (S-explicit, no Undo). The popover closes only on success. */
  async saveApiKey(): Promise<void> {
    const provider = this.activeKeyProvider();
    const apiKey = this.apiKeyInput().trim();
    if (!provider || !apiKey || this.saving()) return;

    this.isSavingKey.set(true);
    this.keyError.set(null);
    try {
      await this.feedback.saveGeneric({
        label: `${providerLabel(provider)} API key`,
        write: async () => {
          const result = await this.writeKey(provider, apiKey);
          if (result.ok) {
            this.apiKeyConfigured.update((prev) => ({ ...prev, [provider]: true }));
            this.testResult.set(null);
            this.closeKeyEditor();
          } else {
            this.keyError.set(result.message);
          }
          return result;
        },
        undo: null,
      });
    } finally {
      this.isSavingKey.set(false);
    }
  }

  /** Opens the row's inline Clear confirm; a failure from an earlier attempt is dropped. */
  requestClear(provider: ProviderId): void {
    this.clearError.set(null);
    this.confirmingClear.set(provider);
  }

  /**
   * Cancel and Esc close the confirm and return focus to the row's Clear button (P8). Esc stops here
   * only when it closed the confirm, so an enclosing overlay does not also close.
   */
  cancelClear(provider: ProviderId, event?: Event): void {
    if (this.confirmingClear() !== provider) return;
    event?.stopPropagation();
    this.confirmingClear.set(null);
    this.clearError.set(null);
    this.host.nativeElement
      .querySelector<HTMLButtonElement>(`[data-testid="settings-web-search-clear-btn-${provider}"]`)
      ?.focus();
  }

  /** Clears a provider's key after the inline confirm (S-confirm, no Undo). */
  async deleteApiKey(provider: ProviderId): Promise<void> {
    this.errorMessage.set(null);
    this.clearError.set(null);

    await this.feedback.saveGeneric({
      label: `removal of the ${providerLabel(provider)} API key`,
      write: async () => {
        const result = await this.removeKey(provider);
        if (result.ok) {
          this.confirmingClear.set(null);
          this.apiKeyConfigured.update((prev) => ({ ...prev, [provider]: false }));
          this.testResult.set(null);
        } else {
          // FM-5: the confirm stays open, so the failure is shown inside it.
          this.clearError.set(result.message);
        }
        return result;
      },
      undo: null,
    });
  }

  /** Probes every stored key and shows the outcome in each row's Status cell (a probe, not a write). */
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
        this.errorMessage.set(TEST_FAILED);
      }
    } catch {
      // A thrown transport error gets the same fixed sentence.
      this.errorMessage.set(TEST_FAILED);
    } finally {
      this.isTesting.set(false);
    }
  }

  /** Saves max results on release (`change`). The slider is set back to the saved value afterwards. */
  async onMaxResultsChange(event: Event): Promise<void> {
    const slider = event.target as HTMLInputElement;
    const value = slider.valueAsNumber;
    const previous = this.maxResults();
    if (value !== previous) {
      this.errorMessage.set(null);
      await this.feedback.saveGeneric({
        label: 'web search max results',
        write: () => this.writeMaxResults(value, previous),
        undo: () => this.writeMaxResults(previous, value),
      });
    }
    slider.value = String(this.maxResults());
  }

  /** Shows `next` while it saves; puts `fallback` back when the write fails (D15). */
  private async writeProviders(
    next: ReadonlySet<ProviderId>,
    fallback: ReadonlySet<ProviderId>,
  ): Promise<WriteResult> {
    this.selectedProviders.set(next);
    this.testResult.set(null);
    const result = await this.saveConfig({ providers: Array.from(next) }, SAVE_PROVIDERS_FAILED);
    if (!result.ok) this.selectedProviders.set(fallback);
    return result;
  }

  private async writeMaxResults(
    next: number,
    fallback: number,
  ): Promise<WriteResult> {
    this.maxResults.set(next);
    const result = await this.saveConfig({ maxResults: next }, SAVE_MAX_RESULTS_FAILED);
    if (!result.ok) this.maxResults.set(fallback);
    return result;
  }

  private async writeKey(
    provider: ProviderId,
    apiKey: string,
  ): Promise<WriteResult> {
    const failed: WriteResult = {
      ok: false,
      message: `Could not save the ${providerLabel(provider)} API key.`,
    };
    try {
      const result = await this.rpcService.call('webSearch:setApiKey', {
        provider,
        apiKey,
      });
      return result.isSuccess() && result.data.success ? { ok: true } : failed;
    } catch {
      return failed;
    }
  }

  private async removeKey(provider: ProviderId): Promise<WriteResult> {
    const failed: WriteResult = {
      ok: false,
      message: `Could not clear the ${providerLabel(provider)} API key.`,
    };
    try {
      const result = await this.rpcService.call('webSearch:deleteApiKey', {
        provider,
      });
      return result.isSuccess() && result.data.success ? { ok: true } : failed;
    } catch {
      return failed;
    }
  }

  /** `webSearch:setConfig`; a failure shows `failedMessage` in the card's inline alert (V8) and toast. */
  private async saveConfig(
    params: { providers?: string[]; maxResults?: number },
    failedMessage: string,
  ): Promise<WriteResult> {
    this.errorMessage.set(null);
    try {
      const result = await this.rpcService.call('webSearch:setConfig', params);
      if (result.isSuccess() && result.data.success) return { ok: true };
    } catch {
      // A thrown transport error is reported like a refused write.
    }
    this.errorMessage.set(failedMessage);
    return { ok: false, message: failedMessage };
  }
}
