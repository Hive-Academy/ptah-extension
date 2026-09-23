import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ClaudeRpcService,
  ProvidersSettingsStateService,
  type ProvidersSettingsSection,
} from '@ptah-extension/core';
import type { AgentListCliModelsResult } from '@ptah-extension/shared';
import { PtahCliConfigComponent } from './ptah-cli-config.component';

const ready = <T,>(data: T): ProvidersSettingsSection<T> => ({ status: 'ready', data, error: null });

class StateStub {
  readonly commit = signal({ status: 'idle', saved: [], unsaved: [], unconfirmed: [], refreshFailed: false, message: null });
  readonly connections = signal(ready([]));
  readonly scopes = signal(ready({ activePath: '/workspace', entries: [] }));
  readonly cliAgents = signal(ready([]));
  readonly cliModels = signal(ready({}));
  readonly cliTest = signal({ status: 'unloaded', data: null, error: null });
  readonly orchestration = signal(ready({
    codexModel: '', copilotModel: '', cursorModel: 'legacy-cursor-model', antigravityModel: '', opencodeModel: '', piModel: '',
    codexReasoningEffort: '', copilotReasoningEffort: '', piReasoningEffort: 'max',
  }));
  readonly delegatedModelOptions = signal<ProvidersSettingsSection<AgentListCliModelsResult>>({ status: 'unloaded', data: null, error: null });
  readonly refreshDelegatedModelOptions = jest.fn(async () => {
    this.delegatedModelOptions.set(ready({
      codex: [], copilot: [], antigravity: [], opencode: [], pi: [],
      cursor: [{ id: 'cursor-fast', name: 'Cursor Fast' }],
    }));
  });
  readonly scopeEntry = jest.fn(() => null);
  readonly reviewContext = jest.fn(() => ({ scopeKey: 'workspace', activePath: '/workspace' }));
  readonly saveSettings = jest.fn(async () => undefined);
  readonly testCliConnection = jest.fn(async () => undefined);
  readonly saveCursorCredential = jest.fn(async () => undefined);
}

/** TASK_2026_534 R3 — delegated CLI models and reasoning effort. */
describe('PtahCliConfigComponent delegated CLI settings', () => {
  let fixture: ComponentFixture<PtahCliConfigComponent>;
  let element: HTMLElement;
  let state: StateStub;
  const call = jest.fn();

  beforeEach(async () => {
    state = new StateStub();
    call.mockReset();
    await TestBed.configureTestingModule({
      imports: [PtahCliConfigComponent],
      providers: [
        { provide: ProvidersSettingsStateService, useValue: state },
        { provide: ClaudeRpcService, useValue: { call } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PtahCliConfigComponent);
    element = fixture.nativeElement as HTMLElement;
    await render();
  });
  afterEach(() => TestBed.resetTestingModule());

  async function render() { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); }
  function click(label: string): void {
    const node = Array.from(element.querySelectorAll('button')).find((button) => button.textContent?.trim() === label);
    if (!node) throw new Error(`Missing button: ${label}`);
    node.click();
  }
  function options(id: string): string[] {
    return Array.from(element.querySelectorAll<HTMLOptionElement>(`#${id} option`)).map((option) => option.value);
  }

  it('R3.11: lists Cursor models from agent:listCliModels and never asks provider:listModels', async () => {
    click('Edit Cursor model'); await render();
    expect(state.refreshDelegatedModelOptions).toHaveBeenCalledTimes(1);
    expect(options('providers-cursorModel')).toEqual(['', 'cursor-fast', 'legacy-cursor-model']);
    expect(element.querySelector<HTMLSelectElement>('#providers-cursorModel')?.value).toBe('legacy-cursor-model');
    expect(element.querySelector('ptah-provider-model-picker')).toBeNull();
    expect(call).not.toHaveBeenCalledWith('provider:listModels', expect.anything(), expect.anything());
  });

  it('R3.11: saves the chosen delegated model through the state owner', async () => {
    click('Edit Cursor model'); await render();
    const select = element.querySelector<HTMLSelectElement>('#providers-cursorModel');
    if (!select) throw new Error('Missing select');
    select.value = 'cursor-fast'; select.dispatchEvent(new Event('change')); await render();
    click('Save Cursor model'); await render();
    expect(state.saveSettings).toHaveBeenCalledWith({ orchestration: { cursorModel: 'cursor-fast' } }, { scopeKey: 'workspace', activePath: '/workspace' });
  });

  it('R3.12: Codex reasoning effort is a select of the mapEffortToCli values', async () => {
    click('Edit Codex reasoning effort'); await render();
    expect(element.querySelector('input#providers-codexReasoningEffort')).toBeNull();
    expect(options('providers-codexReasoningEffort')).toEqual(['', 'minimal', 'low', 'medium', 'high', 'xhigh']);
    expect(state.refreshDelegatedModelOptions).not.toHaveBeenCalled();
  });

  it('review #6: an unsupported saved Pi effort is never offered or re-saved; a supported value or reset is required', async () => {
    const current = state.orchestration().data;
    if (!current) throw new Error('Missing orchestration fixture');
    state.orchestration.set(ready({ ...current, piReasoningEffort: 'banana' }));
    await render();
    click('Edit Pi reasoning effort'); await render();
    const values = options('providers-piReasoningEffort');
    expect(values).not.toContain('banana');
    expect(values).toEqual(['__unsupported__', '', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(element.querySelector('[data-testid="invalid-effort-piReasoningEffort"]')?.textContent).toContain('"banana" is not supported');
    const save = Array.from(element.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Save Pi reasoning effort');
    expect(save?.disabled).toBe(true);
    save?.click(); await render();
    expect(state.saveSettings).not.toHaveBeenCalled();

    const select = element.querySelector<HTMLSelectElement>('#providers-piReasoningEffort');
    if (!select) throw new Error('Missing select');
    select.value = ''; select.dispatchEvent(new Event('change')); await render();
    expect(element.querySelector('[data-testid="invalid-effort-piReasoningEffort"]')).toBeNull();
    click('Save Pi reasoning effort'); await render();
    expect(state.saveSettings).toHaveBeenCalledWith({ orchestration: { piReasoningEffort: '' } }, { scopeKey: 'workspace', activePath: '/workspace' });
  });

  it('R3.12: Pi reasoning effort offers the --thinking scale and keeps the saved value', async () => {
    click('Edit Pi reasoning effort'); await render();
    expect(options('providers-piReasoningEffort')).toEqual(['', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(element.querySelector<HTMLSelectElement>('#providers-piReasoningEffort')?.value).toBe('max');
  });
});
