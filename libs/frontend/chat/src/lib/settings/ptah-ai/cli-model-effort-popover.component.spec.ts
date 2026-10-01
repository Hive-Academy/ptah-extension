import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ProvidersSettingsStateService, type ProvidersSettingsCommit, type ProvidersSettingsSection } from '@ptah-extension/core';
import { PROVIDER_MODELS_LOADER, ProviderModelPickerComponent, ProviderModelSearchFieldComponent } from '@ptah-extension/ui';
import type { AgentListCliModelsResult } from '@ptah-extension/shared';
import { SAVE_REFUSED_MESSAGE, SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { CliModelEffortPopoverComponent, type CliMatrixCellField } from './cli-model-effort-popover.component';
import type { CliMatrixRow, InstanceCliMatrixRow, SystemCliMatrixRow } from './cli-matrix-rows';
import { cliPermissionNote } from './cli-permission-notes';

const ready = <T,>(data: T): ProvidersSettingsSection<T> => ({ status: 'ready', data, error: null });
const unloaded = <T,>(): ProvidersSettingsSection<T> => ({ status: 'unloaded', data: null, error: null });
const idle: ProvidersSettingsCommit = { status: 'idle', saved: [], unsaved: [], unconfirmed: [], refreshFailed: false, message: null };
const CONTEXT = { scopeKey: 'workspace', activePath: '/ws' };

const CATALOGUE: AgentListCliModelsResult = {
  codex: [{ id: 'gpt-5.5-codex', name: 'GPT 5.5 Codex' }, { id: 'gpt-5.4', name: '' }],
  copilot: [], cursor: [], antigravity: [], opencode: [{ id: 'opencode/nemotron', name: 'nemotron' }], pi: [],
};

const system = (overrides: Partial<SystemCliMatrixRow> = {}): SystemCliMatrixRow => ({
  kind: 'system', id: 'codex', cli: 'codex', name: 'Codex', installed: true, version: '1.4', provider: 'OpenAI Codex',
  status: { kind: 'ready', label: 'Ready', tone: 'success' }, enabled: true, interactive: true,
  model: { key: 'codexModel', value: 'gpt-5.5-codex' }, effort: { key: 'codexReasoningEffort', value: 'medium' },
  permission: cliPermissionNote('codex'), credentialAction: false, ...overrides,
});
const instance = (overrides: Partial<InstanceCliMatrixRow> = {}): InstanceCliMatrixRow => ({
  kind: 'instance', id: 'glm-1', name: 'Glm', providerId: 'ollama-cloud', provider: 'Ollama Cloud',
  status: { kind: 'ready', label: 'Ready', tone: 'success' }, enabled: true, interactive: true,
  keyStatus: { kind: 'key-set', label: 'Key set' }, tiers: [], selectedModel: 'glm-5.3:cloud', lastTest: null,
  permission: cliPermissionNote('ptah-cli'), ...overrides,
});

class StateStub {
  readonly commit = signal<ProvidersSettingsCommit>(idle);
  readonly delegatedModelOptions = signal<ProvidersSettingsSection<AgentListCliModelsResult>>(ready(CATALOGUE));
  readonly contextNow = signal<typeof CONTEXT | null>(CONTEXT);
  readonly reviewContext = jest.fn(() => this.contextNow());
  /** What the next write leaves in `commit()`; `refused` resolves `false` (another save in flight). */
  outcome: ProvidersSettingsCommit['status'] | 'refused' = 'saved';
  readonly saveSettings = jest.fn(async (_patch: unknown, _context: unknown) => {
    if (this.outcome === 'refused') return false;
    this.commit.set({ ...idle, status: this.outcome, unsaved: this.outcome === 'failed' ? ['agentOrchestration.codexModel'] : [] });
    return true;
  });
  readonly refreshDelegatedModelOptions = jest.fn(async () => undefined);
}

@Component({
  standalone: true,
  imports: [CliModelEffortPopoverComponent],
  template: `<ptah-cli-model-effort-popover [row]="row()" [field]="field()" (closed)="closed = closed + 1" />`,
})
class Host {
  readonly row = signal<CliMatrixRow>(system());
  readonly field = signal<CliMatrixCellField>('model');
  closed = 0;
}

describe('CliModelEffortPopoverComponent', () => {
  let fixture: ComponentFixture<Host>;
  let state: StateStub;
  let feedback: SettingsSaveFeedbackService;
  const query = <T extends HTMLElement = HTMLElement>(id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as T | null;
  const effortButtons = () => Array.from(fixture.nativeElement.querySelectorAll('[data-effort]')) as HTMLButtonElement[];
  async function flush() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); fixture.detectChanges(); }

  function create(row: CliMatrixRow, field: CliMatrixCellField): void {
    fixture = TestBed.createComponent(Host);
    fixture.componentInstance.row.set(row);
    fixture.componentInstance.field.set(field);
    fixture.detectChanges();
  }
  const searchField = () => fixture.debugElement.query(By.directive(ProviderModelSearchFieldComponent)).componentInstance as ProviderModelSearchFieldComponent;

  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', { writable: true, configurable: true, value: jest.fn() });
    state = new StateStub();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        { provide: ProvidersSettingsStateService, useValue: state },
        { provide: PROVIDER_MODELS_LOADER, useValue: { listModels: jest.fn(async () => ({ models: [], totalCount: 0 })) } },
        SettingsSaveFeedbackService,
      ],
    });
    feedback = TestBed.inject(SettingsSaveFeedbackService);
  });
  afterEach(() => { feedback.dismiss(); TestBed.resetTestingModule(); });

  describe('system CLI model', () => {
    it('is a titled dialog with the compact search over that CLI\'s catalogue', () => {
      create(system(), 'model');
      const panel = query('cli-matrix-popover');
      expect(panel?.getAttribute('role')).toBe('dialog');
      expect(panel?.textContent).toContain('Model for Codex');
      const field = searchField();
      expect(field.options().map((option) => option.id)).toEqual(['gpt-5.5-codex', 'gpt-5.4']);
      // A nameless catalogue entry shows its id.
      expect(field.options()[1].name).toBe('gpt-5.4');
      expect(field.selectedId()).toBe('gpt-5.5-codex');
      expect(field.includeDefault()).toBe(true);
      expect(field.defaultLabel()).toBe('Provider default');
      // Visual round 1 (V30-1/-2): compact id rows, opened empty with a search placeholder.
      expect(field.compact()).toBe(true);
      expect(field.placeholder()).toBe('Search models (e.g. gpt-5, sonnet)...');
      expect((fixture.nativeElement.querySelector('input[role="combobox"]') as HTMLInputElement).placeholder)
        .toBe('Search models (e.g. gpt-5, sonnet)...');
      expect(state.refreshDelegatedModelOptions).not.toHaveBeenCalled();
    });

    it('keeps a saved id the catalogue lacks, so opening never changes it', () => {
      create(system({ model: { key: 'codexModel', value: 'gpt-old' } }), 'model');
      expect(searchField().options()[0]).toEqual({ id: 'gpt-old', name: 'saved, not in the current list', supportsToolUse: null });
    });

    it('loads the catalogue on demand and shows its loading and error states', () => {
      state.delegatedModelOptions.set(unloaded());
      create(system(), 'model');
      expect(state.refreshDelegatedModelOptions).toHaveBeenCalledTimes(1);
      state.delegatedModelOptions.set({ status: 'loading', data: null, error: null });
      fixture.detectChanges();
      expect(searchField().disabled()).toBe(true);
      expect(searchField().defaultLabel()).toBe('Loading models…');
      state.delegatedModelOptions.set({ status: 'error', data: null, error: 'Could not load this section. Retry.' });
      fixture.detectChanges();
      const retry = query('cli-matrix-models-error')?.querySelector('button');
      retry?.click();
      expect(state.refreshDelegatedModelOptions).toHaveBeenCalledTimes(2);
    });

    it('focuses the search once the catalogue has loaded, unless the user moved focus elsewhere', () => {
      state.delegatedModelOptions.set({ status: 'loading', data: null, error: null });
      create(system(), 'model');
      const input = () => fixture.nativeElement.querySelector('input[role="combobox"]') as HTMLInputElement;
      expect(input().disabled).toBe(true);
      expect(document.activeElement).not.toBe(input());
      state.delegatedModelOptions.set(ready(CATALOGUE));
      fixture.detectChanges();
      expect(document.activeElement).toBe(input());
      fixture.destroy();

      const elsewhere = document.createElement('button');
      document.body.appendChild(elsewhere);
      state.delegatedModelOptions.set({ status: 'loading', data: null, error: null });
      create(system(), 'model');
      elsewhere.focus();
      state.delegatedModelOptions.set(ready(CATALOGUE));
      fixture.detectChanges();
      expect(document.activeElement).toBe(elsewhere);
      elsewhere.remove();
    });

    it('shows the provider/model hint for opencode and Pi only (#67)', () => {
      create(system({ id: 'opencode', cli: 'opencode', name: 'OpenCode', model: { key: 'opencodeModel', value: '' }, effort: null }), 'model');
      expect(query('cli-matrix-model-format')?.textContent).toContain('anthropic/claude-sonnet-4-5');
      fixture.destroy();
      create(system(), 'model');
      expect(query('cli-matrix-model-format')).toBeNull();
    });

    it('saves a pick through saveSettings with Undo, then closes (RUX-8)', async () => {
      create(system(), 'model');
      searchField().modelSelected.emit('gpt-5.4');
      await flush();
      expect(state.saveSettings).toHaveBeenCalledWith({ orchestration: { codexModel: 'gpt-5.4' } }, CONTEXT);
      expect(feedback.toast()).toEqual({ tone: 'status', message: 'Saved Codex model to All Ptah apps.', canUndo: true });
      expect(fixture.componentInstance.closed).toBe(1);
      await feedback.undo();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ orchestration: { codexModel: 'gpt-5.5-codex' } }, CONTEXT);
    });

    it('saves Provider default as an empty value, and never re-saves the current one', async () => {
      create(system(), 'model');
      searchField().modelSelected.emit('gpt-5.5-codex');
      await flush();
      expect(state.saveSettings).not.toHaveBeenCalled();
      searchField().modelSelected.emit('');
      await flush();
      expect(state.saveSettings).toHaveBeenCalledWith({ orchestration: { codexModel: '' } }, CONTEXT);
    });
  });

  describe('system CLI effort', () => {
    it('offers the Codex/Copilot allowlist with the saved value pressed', () => {
      create(system(), 'effort');
      expect(query('cli-matrix-popover')?.textContent).toContain('Reasoning effort for Codex');
      expect(effortButtons().map((button) => button.dataset['effort'])).toEqual(['default', 'minimal', 'low', 'medium', 'high', 'xhigh']);
      expect(effortButtons().filter((button) => button.getAttribute('aria-pressed') === 'true').map((b) => b.textContent?.trim())).toEqual(['Medium']);
    });

    it('offers Pi its own scale (off..max)', () => {
      create(system({ id: 'pi', cli: 'pi', name: 'Pi', model: { key: 'piModel', value: '' }, effort: { key: 'piReasoningEffort', value: '' } }), 'effort');
      expect(effortButtons().map((button) => button.dataset['effort']))
        .toEqual(['default', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    });

    it('saves one click through saveSettings with Undo (2 clicks from the matrix, RUX-8)', async () => {
      create(system(), 'effort');
      effortButtons().find((button) => button.dataset['effort'] === 'high')?.click();
      await flush();
      expect(state.saveSettings).toHaveBeenCalledWith({ orchestration: { codexReasoningEffort: 'high' } }, CONTEXT);
      expect(feedback.toast()?.message).toBe('Saved Codex reasoning effort to All Ptah apps.');
      await feedback.undo();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ orchestration: { codexReasoningEffort: 'medium' } }, CONTEXT);
    });

    it('names an unsupported saved effort and never offers it', () => {
      create(system({ effort: { key: 'codexReasoningEffort', value: 'turbo' } }), 'effort');
      expect(query('cli-matrix-invalid-effort')?.textContent).toContain('"turbo" is not supported');
      expect(effortButtons().some((button) => button.getAttribute('aria-pressed') === 'true')).toBe(false);
      expect(effortButtons().some((button) => button.dataset['effort'] === 'turbo')).toBe(false);
    });
  });

  describe('Ptah instance model', () => {
    it('uses the searchable picker fixed to the instance provider', () => {
      create(instance(), 'model');
      const picker = fixture.debugElement.query(By.directive(ProviderModelPickerComponent)).componentInstance as ProviderModelPickerComponent;
      expect(picker.fixedProvider()).toBe('ollama-cloud');
      expect(picker.searchable()).toBe(true);
      expect(picker.model()).toBe('glm-5.3:cloud');
    });

    it('saves the pick as ptahCli:update.selectedModel with Undo', async () => {
      create(instance(), 'model');
      const picker = fixture.debugElement.query(By.directive(ProviderModelPickerComponent)).componentInstance as ProviderModelPickerComponent;
      picker.selectionChange.emit({ provider: 'ollama-cloud', model: 'glm-4.7' });
      await flush();
      expect(state.saveSettings).toHaveBeenCalledWith({ cli: [{ action: 'update', params: { id: 'glm-1', selectedModel: 'glm-4.7' } }] }, CONTEXT);
      expect(feedback.toast()?.message).toBe('Saved Glm model to All Ptah apps.');
      await feedback.undo();
      expect(state.saveSettings).toHaveBeenLastCalledWith(
        { cli: [{ action: 'update', params: { id: 'glm-1', selectedModel: 'glm-5.3:cloud' } }] }, CONTEXT);
    });
  });

  describe('failures (D15) and loading', () => {
    it('never reports "Saved" after a failed write and stays open', async () => {
      state.outcome = 'failed';
      create(system(), 'effort');
      effortButtons().find((button) => button.dataset['effort'] === 'low')?.click();
      await flush();
      expect(feedback.toast()?.tone).toBe('alert');
      expect(feedback.toast()?.message).toContain('Could not save Codex reasoning effort.');
      expect(feedback.toast()?.message).not.toContain('Saved');
      expect(fixture.componentInstance.closed).toBe(0);
    });

    it('reports a refused write (another save in flight) and stays open', async () => {
      state.outcome = 'refused';
      create(system(), 'effort');
      effortButtons().find((button) => button.dataset['effort'] === 'low')?.click();
      await flush();
      expect(feedback.toast()).toEqual({ tone: 'alert', message: SAVE_REFUSED_MESSAGE, canUndo: false });
      expect(fixture.componentInstance.closed).toBe(0);
    });

    it('takes a fresh edit context after a write the host blocked', async () => {
      state.outcome = 'blocked';
      create(system(), 'effort');
      const next = { scopeKey: 'other', activePath: '/other' };
      state.contextNow.set(next);
      effortButtons().find((button) => button.dataset['effort'] === 'low')?.click();
      await flush();
      state.outcome = 'saved';
      effortButtons().find((button) => button.dataset['effort'] === 'high')?.click();
      await flush();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ orchestration: { codexReasoningEffort: 'high' } }, next);
    });

    it('writes nothing while the settings scopes are not loaded', async () => {
      state.contextNow.set(null);
      create(system(), 'effort');
      expect(query('cli-matrix-popover-loading')).not.toBeNull();
      expect(effortButtons().every((button) => button.disabled)).toBe(true);
      effortButtons()[2].click();
      await flush();
      expect(state.saveSettings).not.toHaveBeenCalled();
    });

    it('closes from its Close button', () => {
      create(system(), 'model');
      (fixture.nativeElement.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click();
      expect(fixture.componentInstance.closed).toBe(1);
    });
  });
});
