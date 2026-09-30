import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ProvidersSettingsStateService, type ProvidersEffectiveRoute, type ProvidersSettingsCommit, type ProvidersSettingsSection,
} from '@ptah-extension/core';
import { PROVIDER_MODELS_LOADER } from '@ptah-extension/ui';
import type { ProviderListModelsResult, SettingScope } from '@ptah-extension/shared';
import { MainAgentReassignPopoverComponent, type MainAgentFocus } from './main-agent-reassign-popover.component';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';

function ready<T>(data: T): ProvidersSettingsSection<T> { return { status: 'ready', data, error: null }; }
const idle: ProvidersSettingsCommit = { status: 'idle', saved: [], unsaved: [], unconfirmed: [], refreshFailed: false, message: null };
const CONTEXT = { scopeKey: 'workspace', activePath: '/ws' };
const MODEL_KEY = 'provider.first.selectedModel', EFFORT_KEY = 'provider.first.reasoningEffort';

const ROUTE = {
  route: 'api-key', ready: true, blockers: [], driverProviderId: 'first', resolvedAuthModality: 'api-key',
  resolvedModel: { kind: 'model', id: 'model-a' }, storedAuthMethodScope: 'global',
  providers: [
    { id: 'first', type: 'apiKey', status: 'connected' }, { id: 'second', type: 'apiKey', status: 'connected' },
    { id: 'local', type: 'local-native', status: 'skipped' }, { id: 'broken', type: 'apiKey', status: 'unauthenticated' },
  ],
  lastSuccessfulProbeAt: null, lastFailedProbeAt: null, probedAt: null, fromCache: false,
} as unknown as ProvidersEffectiveRoute;
const connection = (id: string, name: string, authMode = 'apiKey') => ({ id, name, authMode, configured: true, hasKey: true, custom: false,
  defaultsResolvable: true, accountLabel: null, tokenStale: false });
const CATALOGUE: ProviderListModelsResult = {
  models: [
    { id: 'model-a', name: 'Model A', description: '', contextLength: 1, supportsToolUse: true },
    { id: 'model-b', name: 'Model B', description: '', contextLength: 1, supportsToolUse: false },
  ],
  totalCount: 2,
};

class StateStub {
  readonly route = signal(ready(ROUTE));
  readonly connections = signal(ready([connection('first', 'First'), connection('second', 'Second'), connection('local', 'Local', 'local-native'),
    connection('broken', 'Broken')]));
  readonly model = signal(ready({ model: 'model-a' }));
  readonly effort = signal(ready<{ effort?: string }>({ effort: 'medium' }));
  readonly mainSources = signal(ready({ model: { key: MODEL_KEY, scope: 'global' }, effort: { key: EFFORT_KEY, scope: 'global' } }));
  readonly commit = signal<ProvidersSettingsCommit>(idle);
  readonly contextNow = signal<typeof CONTEXT | { scopeKey: string; activePath: string } | null>(CONTEXT);
  readonly reviewContext = jest.fn(() => this.contextNow());
  readonly scopeEntry = jest.fn((key: string) => (key === 'authMethod' ? { scope: 'global' } : null));
  readonly writeScopes = jest.fn((key: string): SettingScope[] =>
    key === EFFORT_KEY ? ['global', 'workspace'] : ['global', 'app', 'workspace']);
  private readonly saved = async () => { this.commit.set({ ...idle, status: 'saved' }); return true; };
  readonly saveSettings = jest.fn(async (_patch: unknown, _context: unknown) => this.saved());
  readonly activateConnection = jest.fn(async (_id: string, _scope: SettingScope, _context: unknown) => this.saved());
  readonly checkConnection = jest.fn(async () => undefined);
}

@Component({
  standalone: true,
  imports: [MainAgentReassignPopoverComponent],
  template: `<ptah-main-agent-reassign-popover [open]="open()" [requestedProvider]="provider()" [initialFocus]="focus()" (closed)="closed = closed + 1" />`,
})
class Host {
  readonly open = signal(true);
  readonly provider = signal<string | null>(null);
  readonly focus = signal<MainAgentFocus | null>(null);
  closed = 0;
}

describe('MainAgentReassignPopoverComponent', () => {
  let fixture: ComponentFixture<Host>;
  let state: StateStub;
  let loader: { listModels: jest.Mock };
  let feedback: SettingsSaveFeedbackService;
  const query = <T extends HTMLElement = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
  const buttonNamed = (label: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="main-agent-popover"] button')).find((node) => node.textContent?.trim() === label);
  async function flush() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); fixture.detectChanges(); }
  function choose(id: string, value: string) {
    const select = query<HTMLSelectElement>(id);
    if (!select) throw new Error(`No select ${id}`);
    select.value = value; select.dispatchEvent(new Event('change')); fixture.detectChanges();
  }
  const options = (id: string) => Array.from(query<HTMLSelectElement>(id)?.options ?? []);

  beforeEach(async () => {
    state = new StateStub();
    loader = { listModels: jest.fn(async (): Promise<ProviderListModelsResult> => CATALOGUE) };
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [{ provide: ProvidersSettingsStateService, useValue: state }, { provide: PROVIDER_MODELS_LOADER, useValue: loader },
        SettingsSaveFeedbackService],
    });
    fixture = TestBed.createComponent(Host);
    feedback = TestBed.inject(SettingsSaveFeedbackService);
    fixture.detectChanges();
    await flush();
  });
  afterEach(() => { feedback.dismiss(); TestBed.resetTestingModule(); });

  it('is compact like the prototype: header, provider, one model select, segmented effort, a one-row Save to; no Apply', () => {
    expect(query('main-agent-popover')?.getAttribute('role')).toBe('dialog');
    expect(query('main-agent-popover')?.className).not.toContain('overflow-y-auto');
    expect(document.getElementById('main-agent-popover-title')?.textContent?.trim()).toBe('Reassign main agent');
    expect(query('main-agent-provider')?.tagName).toBe('SELECT');
    expect(query('main-agent-model')?.tagName).toBe('SELECT');
    expect(document.querySelector('ptah-provider-model-picker')).toBeNull();
    expect(query('main-agent-effort')?.className).toContain('join');
    expect(query('main-agent-save-to')?.tagName).toBe('SELECT');
    expect(document.querySelector('[data-testid="main-agent-popover"] input[type="radio"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Apply');
  });

  describe('provider (D6: confirm, "ends running chat sessions", no Undo)', () => {
    it('lists activatable connections plus the driver; a failing connection is not offered', () => {
      expect(options('main-agent-provider').map((option) => option.value)).toEqual(['first', 'second', 'local']);
      expect(query<HTMLSelectElement>('main-agent-provider')?.value).toBe('first');
    });

    it('choosing another provider asks first, with the D6 copy and the scope; nothing is written until "Use for main agent"', async () => {
      expect(query('main-agent-provider-confirm')).toBeNull();
      choose('main-agent-provider', 'second');
      expect(query('main-agent-provider-copy')?.textContent?.trim())
        .toBe('New main-agent requests use Second. Changing the provider ends running chat sessions.');
      expect(query('main-agent-provider-confirm')?.textContent).toContain('Saved to: Global · all apps.');
      expect(state.activateConnection).not.toHaveBeenCalled();
      buttonNamed('Use for main agent')?.click(); await flush();
      expect(state.activateConnection).toHaveBeenCalledWith('second', 'global', CONTEXT);
      expect(query('main-agent-provider-outcome')?.textContent?.trim()).toBe('Main agent provider saved.');
      expect(document.body.textContent).not.toContain('Undo');
      expect(feedback.toast()).toBeNull();
    });

    it('Save to another scope offers "Save provider to {scope}…", which re-saves the current provider through the confirm (RUX-5)', async () => {
      expect(query('main-agent-provider-rescope')).toBeNull();
      choose('main-agent-save-to', 'workspace');
      expect(query('main-agent-provider-rescope')?.textContent?.trim()).toBe('Save provider to This workspace…');
      expect(query('main-agent-provider-confirm')).toBeNull();
      query<HTMLButtonElement>('main-agent-provider-rescope')?.click(); fixture.detectChanges();
      expect(query('main-agent-provider-copy')?.textContent).toContain('keep using First. Saving the provider ends running chat sessions.');
      buttonNamed('Use for main agent')?.click(); await flush();
      expect(state.activateConnection).toHaveBeenCalledWith('first', 'workspace', CONTEXT);
    });

    it('an uncheckable connection keeps its note; Cancel drops the change, writes nothing, and keeps focus inside', () => {
      choose('main-agent-provider', 'local');
      expect(query('activation-unchecked-note')?.textContent).toContain('Ptah cannot check this connection before use.');
      const cancel = buttonNamed('Cancel provider change');
      cancel?.focus(); cancel?.click(); fixture.detectChanges();
      expect(query('main-agent-provider-confirm')).toBeNull();
      expect(state.activateConnection).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(query('main-agent-provider'));
    });

    it('a card\'s requested provider opens straight into the confirm', () => {
      fixture.componentInstance.provider.set('second'); fixture.detectChanges();
      expect(query('main-agent-provider-copy')?.textContent).toContain('New main-agent requests use Second.');
    });

    it('a refused or failed activation is never reported as saved (D15)', async () => {
      state.activateConnection.mockImplementationOnce(async () => false);
      choose('main-agent-provider', 'second');
      buttonNamed('Use for main agent')?.click(); await flush();
      expect(query('main-agent-provider-outcome')?.textContent).toContain('Not saved. Another save is in progress.');
      state.activateConnection.mockImplementationOnce(async () => { state.commit.set({ ...idle, status: 'failed', message: 'Could not save.' }); return true; });
      buttonNamed('Use for main agent')?.click(); await flush();
      expect(query('main-agent-provider-outcome')?.textContent).toContain('Not saved. Could not save.');
      expect(query('main-agent-provider-outcome')?.getAttribute('role')).toBe('alert');
    });
  });

  describe('model (one select, saved on selection with Undo)', () => {
    it('lists the driver\'s catalogue with the tool-use marker, loaded through the page loader', () => {
      expect(loader.listModels).toHaveBeenCalledWith('first');
      expect(options('main-agent-model').map((option) => option.textContent?.trim()))
        .toEqual(['Model A [Tool: Yes]', 'Model B [Tool: No]', 'Enter a model ID…']);
      expect(query<HTMLSelectElement>('main-agent-model')?.value).toBe('model-a');
    });

    it('a stored model the catalogue lacks stays listed and selected', async () => {
      state.model.set(ready({ model: 'custom/x' })); fixture.detectChanges();
      expect(options('main-agent-model')[0].textContent?.trim()).toBe('custom/x · not in current catalog');
      expect(query<HTMLSelectElement>('main-agent-model')?.value).toBe('custom/x');
    });

    it('a selection saves at once to "Save to"; Undo is a second real write of the previous model', async () => {
      choose('main-agent-model', 'model-b'); await flush();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ model: { model: 'model-b', applyTo: 'global' } }, CONTEXT);
      expect(feedback.toast()).toEqual({ tone: 'status', message: 'Saved main agent model to All Ptah apps.', canUndo: true });
      await feedback.undo(); await flush();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ model: { model: 'model-a', applyTo: 'global' } }, CONTEXT);
      expect(state.saveSettings).toHaveBeenCalledTimes(2);
    });

    it('"Enter a model ID…" swaps in a field on the same row; Use saves the typed id (#35)', async () => {
      choose('main-agent-model', '__manual__'); await flush();
      const input = query<HTMLInputElement>('main-agent-model-manual');
      expect(input).not.toBeNull();
      // The select left the DOM: focus moves to the field, so it (and Esc) stay inside the popover.
      expect(document.activeElement).toBe(input);
      if (!input) return;
      input.value = 'vendor/unlisted'; input.dispatchEvent(new Event('input')); fixture.detectChanges();
      buttonNamed('Use')?.click(); await flush();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ model: { model: 'vendor/unlisted', applyTo: 'global' } }, CONTEXT);
      await flush();
      expect(query('main-agent-model')?.tagName).toBe('SELECT');
      expect(document.activeElement).toBe(query('main-agent-model'));
    });

    it('a failed catalogue read says so and retries', async () => {
      loader.listModels.mockImplementationOnce(async () => { throw new Error('rpc'); });
      fixture.componentInstance.open.set(false); fixture.detectChanges();
      fixture.componentInstance.open.set(true); fixture.detectChanges(); await flush();
      expect(query('main-agent-model-error')?.textContent).toContain('Could not load the model list.');
      buttonNamed('Retry')?.click(); await flush();
      expect(query('main-agent-model-error')).toBeNull();
    });

    it('a failed write is never reported as saved and offers no Undo (D15)', async () => {
      state.saveSettings.mockImplementationOnce(async () => { state.commit.set({ ...idle, status: 'failed', unsaved: ['model'] }); return true; });
      choose('main-agent-model', 'model-b'); await flush();
      expect(feedback.toast()?.tone).toBe('alert');
      expect(feedback.toast()?.canUndo).toBe(false);
    });
  });

  describe('effort (segmented, saved on selection with Undo) and Save to', () => {
    it('Save to lists the targets both keys allow, defaulting to the model\'s current scope', () => {
      expect(options('main-agent-save-to').map((option) => option.value)).toEqual(['global', 'workspace']);
      expect(query<HTMLSelectElement>('main-agent-save-to')?.value).toBe('global');
    });

    it('the current level is pressed (primary); a choice saves to the chosen scope; default clears; Undo restores', async () => {
      const effort = (value: string) => query('main-agent-effort')?.querySelector<HTMLButtonElement>(`[data-effort="${value}"]`);
      expect(effort('medium')?.getAttribute('aria-pressed')).toBe('true');
      expect(effort('medium')?.className).toContain('btn-primary');
      expect(effort('medium')?.className).toContain('join-item');
      choose('main-agent-save-to', 'workspace');
      effort('high')?.click(); await flush();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ effort: { effort: 'high', applyTo: 'workspace' } }, CONTEXT);
      await feedback.undo(); await flush();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ effort: { effort: 'medium', applyTo: 'workspace' } }, CONTEXT);
      effort('default')?.click(); await flush();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ effort: { effort: undefined, applyTo: 'workspace' } }, CONTEXT);
    });

    it('every trigger is disabled while a save runs (D3)', () => {
      state.commit.set({ ...idle, status: 'saving' }); fixture.detectChanges();
      expect(query<HTMLSelectElement>('main-agent-provider')?.disabled).toBe(true);
      expect(query<HTMLSelectElement>('main-agent-model')?.disabled).toBe(true);
      for (const button of Array.from(query('main-agent-effort')?.querySelectorAll('button') ?? [])) expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(query<HTMLSelectElement>('main-agent-save-to')?.disabled).toBe(true);
    });
  });

  it('a workspace switch mid-edit: the blocked write is reported, the popover stays open, the next write uses the new context', async () => {
    const next = { scopeKey: 'other', activePath: '/other' };
    state.saveSettings.mockImplementationOnce(async () => {
      state.commit.set({ ...idle, status: 'blocked', message: 'The workspace changed. Review the values and retry.' });
      return true;
    });
    state.contextNow.set(next);
    choose('main-agent-model', 'model-b'); await flush();
    expect(feedback.toast()?.message).toContain('The workspace changed.');
    expect(query('main-agent-popover')).not.toBeNull();
    state.commit.set(idle); fixture.detectChanges();
    choose('main-agent-model', 'model-b'); await flush();
    expect(state.saveSettings).toHaveBeenLastCalledWith({ model: { model: 'model-b', applyTo: 'global' } }, next);
  });

  it('Check connection re-reads the route and is disabled while it runs', () => {
    query<HTMLButtonElement>('main-agent-check')?.click();
    expect(state.checkConnection).toHaveBeenCalledTimes(1);
    state.route.set({ status: 'loading', data: ROUTE, error: null }); fixture.detectChanges();
    expect(query<HTMLButtonElement>('main-agent-check')?.disabled).toBe(true);
    expect(query('main-agent-check')?.textContent?.trim()).toBe('Checking…');
  });

  it('Close emits closed', () => {
    document.querySelector<HTMLButtonElement>('[data-testid="main-agent-popover"] button[aria-label="Close"]')?.click();
    expect(fixture.componentInstance.closed).toBe(1);
  });
});
