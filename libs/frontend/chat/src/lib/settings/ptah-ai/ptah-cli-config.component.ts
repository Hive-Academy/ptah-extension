import { ChangeDetectionStrategy, Component, computed, inject, signal, OnDestroy } from '@angular/core';
import { ProvidersSettingsStateService, type ProvidersEditContext, type ProvidersSettingsPatch } from '@ptah-extension/core';
import { NativeCardComponent, ProviderModelPickerComponent } from '@ptah-extension/ui';
import {
  CLI_REASONING_EFFORT_VALUES,
  PI_REASONING_EFFORT_VALUES,
  type AgentListCliModelsResult,
} from '@ptah-extension/shared';
import { SettingScopeRowComponent } from '../providers/setting-scope-row.component';
type DelegatedModelKey = 'codexModel' | 'copilotModel' | 'cursorModel' | 'antigravityModel' | 'opencodeModel' | 'piModel'
  | 'codexReasoningEffort' | 'copilotReasoningEffort' | 'piReasoningEffort';
interface DelegatedOption { readonly value: string; readonly label: string; readonly disabled?: boolean }
const EFFORT_LABELS: Readonly<Record<string, string>> = {
  '': 'Provider default', off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max',
};
const effortOptions = (values: readonly string[]): readonly DelegatedOption[] =>
  values.map((value) => ({ value, label: EFFORT_LABELS[value] ?? value }));
/** Codex/Copilot: the host allowlist (agent:setConfig), = AgentSpawnEnvironment.mapEffortToCli (minimal..xhigh). */
const CLI_EFFORT_OPTIONS = effortOptions(CLI_REASONING_EFFORT_VALUES);
/** Pi: passed raw to `pi --thinking`, which takes off..max; the host rejects anything else. */
const PI_EFFORT_OPTIONS = effortOptions(PI_REASONING_EFFORT_VALUES);
/** Select value shown while a saved effort is unsupported; never saved. */
const UNSUPPORTED_EFFORT = '__unsupported__';
/** Delegated CLI name per setting; the key into agent:listCliModels. */
const DELEGATED_CLI: Readonly<Record<DelegatedModelKey, keyof AgentListCliModelsResult>> = {
  codexModel: 'codex', copilotModel: 'copilot', cursorModel: 'cursor', antigravityModel: 'antigravity', opencodeModel: 'opencode', piModel: 'pi',
  codexReasoningEffort: 'codex', copilotReasoningEffort: 'copilot', piReasoningEffort: 'pi',
};
const CONTROL = 'btn btn-outline btn-sm min-h-9 min-w-6 border-base-content-muted bg-base-100 text-base-content hover:bg-base-100 hover:text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
const FIELD = 'input input-bordered input-sm min-h-9 w-full border-base-content-muted bg-base-100 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';


function effortValues(key: DelegatedModelKey): readonly string[] {
  return key === 'piReasoningEffort' ? PI_REASONING_EFFORT_VALUES : CLI_REASONING_EFFORT_VALUES;
}

/** The CLI instance manager, mounted only inside Providers. */
@Component({ selector: 'ptah-cli-config', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NativeCardComponent, ProviderModelPickerComponent, SettingScopeRowComponent],
  template: `        <section aria-labelledby="providers-cli-heading" class="space-y-3">
          <h2 id="providers-cli-heading" data-focus="cli-agents" tabindex="-1" class="text-sm font-semibold scroll-mt-4">CLI agents</h2>
          <button type="button" [class]="control" (click)="beginCliCreate()" [disabled]="!canStartSetup()">Add CLI agent</button>
          @if (cliCreateOpen()) {
            <div class="rounded-md border border-base-content-muted p-3 space-y-2">
              <label for="providers-cli-name">Agent name</label>
              <input id="providers-cli-name" [class]="field" [value]="cliName()" (input)="cliName.set(inputValue($event))" />
              <label for="providers-cli-provider">Provider connection</label>
              <select id="providers-cli-provider" [class]="field" [value]="cliProvider()" (change)="cliProvider.set(inputValue($event))">
                <option value="">Choose a provider</option>
                @for (provider of state.connections().data ?? []; track provider.id) {
                  @if (provider.id !== 'anthropic' && provider.id !== 'openai-codex') { <option [value]="provider.id">{{ provider.name }}</option> }
                }
              </select>
              <label for="providers-cli-key">API key for this CLI instance</label>
              <input id="providers-cli-key" type="password" autocomplete="new-password" [class]="field" [value]="cliKey()" (input)="cliKey.set(inputValue($event))" aria-describedby="providers-cli-key-help" />
              <p id="providers-cli-key-help">Stored provider keys are not copied. Enter this instance's key for API-key providers; local or subscription connections can leave it empty. Saved globally. Codex uses the delegated CLI settings below.</p>
              <button type="button" [class]="control" (click)="createCli()" [disabled]="!canCreateCli()">Create CLI agent</button>
              <button type="button" [class]="control" (click)="cancelCliCreate()" [disabled]="saving()">Cancel CLI setup</button>
            </div>
          }
          @if (state.cliAgents().status === 'ready' && !state.cliAgents().data?.length) { <p>No CLI agents configured.</p> }
          @for (agent of state.cliAgents().data ?? []; track agent.id) {
            <ptah-native-card density="compact" [clickable]="false">
              <div class="space-y-3 min-w-0">
                <h3 class="font-semibold break-words">{{ agent.name }} · {{ agent.providerName }}</h3>
                <p>{{ agent.modelCount }} available models · {{ agent.enabled ? 'Enabled' : 'Disabled' }}</p>
                @if (state.cliModels().status === 'ready') {
                  @if (state.cliModels().data?.[agent.id]; as models) {
                    <p class="break-all">Model: {{ models.selectedModel || 'Use provider tier mappings' }}</p>
                    @if (cliModelDraft()?.id === agent.id) {
                      <ptah-provider-model-picker [fixedProvider]="agent.providerId" [model]="cliModelDraft()?.model ?? ''" [label]="agent.name + ' model'"
                        [disabled]="saving()" (selectionChange)="cliModelDraft.set({ id: agent.id, model: $event.model })" />
                      <p>Saved globally for this CLI instance. The provider connection is unchanged.</p>
                      <button type="button" [class]="control" (click)="saveCliModel()" [disabled]="saving()">Save {{ agent.name }} model</button>
                      <button type="button" [class]="control" (click)="cliModelDraft.set(null)" [disabled]="saving()">Cancel {{ agent.name }} model edit</button>
                    } @else {
                      <button type="button" [class]="control" (click)="editCliModel(agent.id, models.selectedModel ?? '')" [disabled]="saving()">Edit {{ agent.name }} model</button>
                    }
                  } @else { <p>Saved model details are unavailable for this instance. Refresh settings to check again.</p> }
                }
                <label class="flex min-h-9 items-center gap-2">
                  <input type="checkbox" class="toggle toggle-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                    [checked]="agent.enabled" [disabled]="saving() || state.cliAgents().status !== 'ready'"
                    [attr.aria-label]="'Enable ' + agent.name + ' for delegated work'" (change)="toggleCli(agent.id, $event)" />
                  Enable {{ agent.name }} for delegated work
                </label>
                <button type="button" [class]="control" (click)="beginEdit(agent.id, agent.name)">Edit name or key</button>
                <button type="button" [class]="control" (click)="state.testCliConnection(agent.id)" [disabled]="state.cliTest().status === 'loading'">Test connection</button>
                @if (state.cliTest().data?.id === agent.id) { <p role="status">{{ state.cliTest().status === 'ready' ? state.cliTest().data?.success ? 'Connection checked.' : 'Connection check failed.' : 'Connection check unavailable.' }}</p> }
                @if (editId() === agent.id) {
                  <label [for]="'cli-edit-name-' + agent.id">Agent name</label><input [id]="'cli-edit-name-' + agent.id" [class]="field" [value]="editName()" (input)="editName.set(inputValue($event))" />
                  <label [for]="'cli-edit-key-' + agent.id">Replacement API key (leave empty to keep)</label><input type="password" [id]="'cli-edit-key-' + agent.id" [class]="field" [value]="editKey()" (input)="editKey.set(inputValue($event))" />
                  <button type="button" [class]="control" [disabled]="saving() || !editName().trim()" (click)="saveEdit()">Save instance</button>
                  <button type="button" [class]="control" (click)="cancelEdit()">Cancel instance edit</button>
                }
                <button type="button" [class]="control" (click)="removeCliId.set(agent.id)" [disabled]="saving()">Remove {{ agent.name }}</button>
                @if (removeCliId() === agent.id) {
                  <p>Remove this CLI instance? Its provider connection will remain available.</p>
                  <button type="button" [class]="control" (click)="removeCli(agent.id)" [disabled]="saving()">Confirm removal of {{ agent.name }}</button>
                  <button type="button" [class]="control" (click)="removeCliId.set(null)">Cancel removal</button>
                }
              </div>
            </ptah-native-card>
          }
          <div class="space-y-2">
            <label for="providers-cursor-key">Cursor API key</label>
            <input id="providers-cursor-key" type="password" autocomplete="new-password" [class]="field" [value]="cursorKey()" (input)="cursorKey.set(inputValue($event))" />
            <button type="button" [class]="control" [disabled]="saving() || !cursorKey().trim()" (click)="saveCursorKey()">Save Cursor credential</button>
          </div>
          @if (state.orchestration().status === 'ready') {
            <h3 class="font-semibold">Delegated CLI models and reasoning effort</h3>
            @for (choice of delegatedModels; track choice.key) {
              <div class="rounded-md border border-base-300 p-3 space-y-2">
                <p>{{ choice.name }}: {{ state.orchestration().data?.[choice.key] || 'Provider default' }}</p>
                <ptah-setting-scope-row [fieldName]="choice.name" [scope]="state.scopeEntry('agentOrchestration.' + choice.key)?.scope ?? null" [disabled]="true" />
                @if (delegatedDraft()?.key === choice.key) {
                  <label [for]="'providers-' + choice.key">{{ choice.name }}</label>
                  <select [id]="'providers-' + choice.key" [class]="field" [value]="delegatedDraft()?.value ?? ''" (change)="setDelegatedModel(choice.key, $event)"
                    [disabled]="saving()">
                    @for (option of delegatedOptions(choice.key); track option.value) {
                      <option [value]="option.value" [disabled]="option.disabled ?? false" [selected]="option.value === (delegatedDraft()?.value ?? '')">{{ option.label }}</option>
                    }
                  </select>
                  @if (delegatedDraft()?.value === unsupportedEffort) {
                    <p role="alert" [attr.data-testid]="'invalid-effort-' + choice.key">
                      The saved value "{{ state.orchestration().data?.[choice.key] }}" is not supported. Choose a supported value, or Provider default to reset it.
                    </p>
                  }
                  @if (choice.key.endsWith('Model')) {
                    @if (state.delegatedModelOptions().status === 'loading') { <p role="status">Loading {{ choice.name }} list…</p> }
                    @if (state.delegatedModelOptions().status === 'error') {
                      <p role="alert">The model list could not be loaded. Retry, or keep the provider default.</p>
                      <button type="button" [class]="control" (click)="state.refreshDelegatedModelOptions()">Retry {{ choice.name }} list</button>
                    }
                  }
                  <p>Leave empty to use the provider default. Saved globally for delegated work.</p>
                  <button type="button" [class]="control" (click)="saveDelegatedModel()" [disabled]="saving() || delegatedDraft()?.value === unsupportedEffort">Save {{ choice.name }}</button>
                  <button type="button" [class]="control" (click)="delegatedDraft.set(null)" [disabled]="saving()">Cancel {{ choice.name }} edit</button>
                } @else {
                  <button type="button" [class]="control" (click)="editDelegatedModel(choice.key)" [disabled]="saving()">Edit {{ choice.name }}</button>
                }
              </div>
            }
          }
        </section>

`,
})
export class PtahCliConfigComponent implements OnDestroy {
  protected readonly state = inject(ProvidersSettingsStateService);
  protected readonly control = CONTROL;
  protected readonly field = FIELD;
  protected readonly saving = computed(() => this.state.commit().status === 'saving');
  protected readonly canStartSetup = computed(() => this.state.connections().status === 'ready' && this.state.scopes().status === 'ready' && !this.saving());
  private delegatedContext: ProvidersEditContext | null = null;
  private cliCreateContext: ProvidersEditContext | null = null;
  private cliModelContext: ProvidersEditContext | null = null;
  protected readonly delegatedDraft = signal<{ key: DelegatedModelKey; value: string } | null>(null);
  protected readonly delegatedModels: readonly { key: DelegatedModelKey; name: string }[] = [
    { key: 'codexModel', name: 'Codex model' }, { key: 'copilotModel', name: 'Copilot model' }, { key: 'cursorModel', name: 'Cursor model' },
    { key: 'antigravityModel', name: 'Antigravity model' }, { key: 'opencodeModel', name: 'OpenCode model' }, { key: 'piModel', name: 'Pi model' },
    { key: 'codexReasoningEffort', name: 'Codex reasoning effort' }, { key: 'copilotReasoningEffort', name: 'Copilot reasoning effort' },
    { key: 'piReasoningEffort', name: 'Pi reasoning effort' },
  ];
  protected readonly removeCliId = signal<string | null>(null);
  protected readonly cliCreateOpen = signal(false);
  protected readonly cliName = signal('');
  protected readonly cliProvider = signal('');
  protected readonly cliKey = signal('');
  protected readonly cliModelDraft = signal<{ id: string; model: string } | null>(null);
  protected readonly canCreateCli = computed(() => {
    const provider = this.state.connections().data?.find((entry) => entry.id === this.cliProvider());
    return !!this.cliName().trim() && !!provider && provider.id !== 'anthropic' && provider.id !== 'openai-codex' &&
      (provider.authMode !== 'apiKey' || !!this.cliKey().trim()) && !this.saving();
  });

  ngOnDestroy(): void { this.cliKey.set(''); this.editKey.set(''); this.cursorKey.set(''); }
  protected readonly editId = signal<string | null>(null);
  protected readonly editName = signal('');
  protected readonly editKey = signal('');
  protected readonly cursorKey = signal('');
  private editContext: ProvidersEditContext | null = null;
  protected beginEdit(id: string, name: string): void { this.editContext = this.state.reviewContext(); this.editId.set(id); this.editName.set(name); this.editKey.set(''); }
  protected cancelEdit(): void { this.editId.set(null); this.editKey.set(''); }
  protected async saveEdit(): Promise<void> {
    const id = this.editId(); if (!id || !this.editContext) return;
    await this.state.saveSettings({ cli: [{ action: 'update', params: { id, name: this.editName().trim(), ...(this.editKey().trim() ? { apiKey: this.editKey() } : {}) } }] }, this.editContext);
    if (this.state.commit().status === 'saved') this.cancelEdit();
  }
  protected async saveCursorKey(): Promise<void> {
    const context = this.state.reviewContext(); if (!context) return;
    await this.state.saveCursorCredential(this.cursorKey(), context);
    if (this.state.commit().status === 'saved') this.cursorKey.set('');
  }
  protected inputValue(event: Event): string { return (event.target as HTMLInputElement).value; }
  protected async toggleCli(id: string, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const enabled = input.checked; input.checked = !enabled;
    await this.commitCli({ cli: [{ action: 'update', params: { id, enabled } }] });
  }
  protected async removeCli(id: string): Promise<void> {
    await this.commitCli({ cli: [{ action: 'delete', params: { id } }] });
    if (this.state.commit().status === 'saved') this.removeCliId.set(null);
  }
  protected beginCliCreate(): void {
    this.cliCreateContext = this.state.reviewContext(); this.cliCreateOpen.set(true);
  }
  protected cancelCliCreate(): void { this.cliCreateOpen.set(false); this.cliKey.set(''); this.cliName.set(''); }
  protected async createCli(): Promise<void> {
    if (!this.canCreateCli() || !this.cliCreateContext) return;
    await this.state.saveSettings({ cli: [{ action: 'create', params: {
      name: this.cliName().trim(), providerId: this.cliProvider(), apiKey: this.cliKey(),
    } }] }, this.cliCreateContext);
    if (this.state.commit().status === 'saved' && this.state.cliAgents().status === 'ready') this.cancelCliCreate();
  }
  protected editCliModel(id: string, model: string): void {
    this.cliModelContext = this.state.reviewContext(); this.cliModelDraft.set({ id, model });
  }
  protected async saveCliModel(): Promise<void> {
    const draft = this.cliModelDraft(); if (!draft || !this.cliModelContext) return;
    await this.state.saveSettings({ cli: [{ action: 'update', params: { id: draft.id, selectedModel: draft.model } }] }, this.cliModelContext);
    if (this.state.commit().status === 'saved' && this.state.cliModels().status === 'ready') this.cliModelDraft.set(null);
  }
  protected readonly unsupportedEffort = UNSUPPORTED_EFFORT;
  protected editDelegatedModel(key: DelegatedModelKey): void {
    this.delegatedContext = this.state.reviewContext();
    const saved = this.state.orchestration().data?.[key] ?? '';
    // An unsupported saved effort (e.g. from the old free-text field) is never offered as a choice.
    const invalidEffort = key.endsWith('ReasoningEffort') && !effortValues(key).includes(saved);
    this.delegatedDraft.set({ key, value: invalidEffort ? UNSUPPORTED_EFFORT : saved });
    if (key.endsWith('Model') && this.state.delegatedModelOptions().status !== 'ready') void this.state.refreshDelegatedModelOptions();
  }
  /**
   * Models: a saved id missing from the catalogue stays selectable, so opening the editor never changes it.
   * Effort: only supported values; an unsupported saved value shows a disabled placeholder and a message.
   */
  protected delegatedOptions(key: DelegatedModelKey): readonly DelegatedOption[] {
    if (key.endsWith('ReasoningEffort')) {
      const options = key === 'piReasoningEffort' ? PI_EFFORT_OPTIONS : CLI_EFFORT_OPTIONS;
      return this.delegatedDraft()?.value === UNSUPPORTED_EFFORT
        ? [{ value: UNSUPPORTED_EFFORT, label: 'Unsupported saved value', disabled: true }, ...options]
        : options;
    }
    const saved = this.state.orchestration().data?.[key] ?? '';
    const options: readonly DelegatedOption[] = [{ value: '', label: 'Provider default' },
      ...(this.state.delegatedModelOptions().data?.[DELEGATED_CLI[key]] ?? []).map((model) => ({ value: model.id, label: model.name || model.id }))];
    return !saved || options.some((option) => option.value === saved) ? options : [...options, { value: saved, label: `${saved} (saved)` }];
  }
  protected setDelegatedModel(key: DelegatedModelKey, event: Event): void { this.delegatedDraft.set({ key, value: this.inputValue(event) }); }
  protected async saveDelegatedModel(): Promise<void> {
    const draft = this.delegatedDraft(); if (!draft || !this.delegatedContext || draft.value === UNSUPPORTED_EFFORT) return;
    await this.state.saveSettings({ orchestration: { [draft.key]: draft.value.trim() } }, this.delegatedContext);
    if (this.state.commit().status === 'saved') this.delegatedDraft.set(null);
  }
  private async commitCli(patch: ProvidersSettingsPatch): Promise<void> {
    const context = this.state.reviewContext(); if (context) await this.state.saveSettings(patch, context);
  }
}
