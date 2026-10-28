import { Component, signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ClaudeAmbientStatusService, ProviderAccountsStateService, ProvidersSettingsStateService, VSCodeService, type ClaudeAmbientStatusView,
  type ProviderAccountActionOutcome, type ProviderAccountChoice, type ProviderAccountsView, type ProvidersEffectiveRoute,
  type ProvidersSettingsCommit, type ProvidersSettingsSection,
} from '@ptah-extension/core';
import { By } from '@angular/platform-browser';
import { NativePopoverComponent, PROVIDER_MODELS_LOADER, ProviderModelSearchFieldComponent } from '@ptah-extension/ui';
import type {
  ProviderAccountSelection, ProviderAccountsSnapshot, ProviderAccountSummary, ProviderListModelsResult, SettingScope,
} from '@ptah-extension/shared';
import { MainAgentReassignPopoverComponent, type MainAgentFocus } from './main-agent-reassign-popover.component';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { isDisabledControl } from '../feedback/busy-disabled.testing';
import { ACCOUNT_COPY, selectionFeedback } from './accounts/account-presentation';

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
  readonly refreshMainSources = jest.fn(async () => undefined);
}

@Component({
  standalone: true,
  imports: [MainAgentReassignPopoverComponent],
  template: `<ptah-main-agent-reassign-popover [open]="open()" [initialFocus]="focus()" (closed)="closed = closed + 1" />`,
})
class Host {
  readonly open = signal(true);
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
  async function flush() {
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();
  }
  /** The compact searchable model control (Batch 28b) and its combobox input. */
  const modelField = () => fixture.debugElement.query(By.directive(ProviderModelSearchFieldComponent)).componentInstance as ProviderModelSearchFieldComponent;
  const modelInput = () => query<HTMLInputElement>('main-agent-model')?.querySelector<HTMLInputElement>('input') ?? null;
  /** A select's change; for the model control, the field's `modelSelected` (what a pick in its list emits). */
  function choose(id: string, value: string) {
    if (id === 'main-agent-model') { modelField().modelSelected.emit(value); fixture.detectChanges(); return; }
    const select = query<HTMLSelectElement>(id);
    if (!select) throw new Error(`No select ${id}`);
    select.value = value; select.dispatchEvent(new Event('change')); fixture.detectChanges();
  }
  function key(input: HTMLInputElement, name: string) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })); fixture.detectChanges();
  }
  const options = (id: string) => Array.from(query<HTMLSelectElement>(id)?.options ?? []);
  const effortButton = (value: string) => query('main-agent-effort')?.querySelector<HTMLButtonElement>(`[data-effort="${value}"]`);
  const saveButton = () => query<HTMLButtonElement>('main-agent-save');
  async function save() { saveButton()?.click(); await flush(); await flush(); }
  const nothingWritten = () => {
    expect(state.saveSettings).not.toHaveBeenCalled();
    expect(state.activateConnection).not.toHaveBeenCalled();
  };

  beforeEach(async () => {
    // jsdom has no scrollIntoView; the model list scrolls its active row into view (as in the ui field spec).
    Object.defineProperty(Element.prototype, 'scrollIntoView', { writable: true, configurable: true, value: jest.fn() });
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

  it('is one column: every label above its control, a 3 x 2 effort grid, a Save / Cancel footer', () => {
    expect(query('main-agent-popover')?.getAttribute('role')).toBe('dialog');
    // The dialog's own overflow-y-auto is only the short-window fallback; the body is the scroll area at normal sizes.
    expect(query('main-agent-popover-body')?.className).toContain('overflow-y-auto');
    expect(query('main-agent-popover-body')?.className).toContain('grid-cols-1');
    expect(document.getElementById('main-agent-popover-title')?.textContent?.trim()).toBe('Reassign main agent');
    expect(query('main-agent-provider')?.tagName).toBe('SELECT');
    // Batch 28b: the one-row searchable model control from the ui barrel, never the whole picker card.
    expect(query('main-agent-model')?.tagName).toBe('PTAH-PROVIDER-MODEL-SEARCH-FIELD');
    expect(modelInput()?.getAttribute('role')).toBe('combobox');
    expect(modelInput()?.id).toBe('main-agent-model');
    expect(document.querySelector('ptah-provider-model-picker')).toBeNull();
    for (const [id, text] of [['main-agent-provider', 'Provider connection'], ['main-agent-model', 'Model selection'], ['main-agent-save-to', 'Save to']]) {
      const label = document.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
      expect(label?.textContent?.trim()).toBe(text);
      // Above the control: the label is a block of its own in the field's one-column grid.
      expect(label?.className).toContain('block');
      expect(label?.parentElement?.className).toContain('grid');
    }
    expect(document.getElementById('main-agent-effort-label')?.textContent?.trim()).toBe('Reasoning effort');
    expect(query('main-agent-effort')?.className).toContain('grid-cols-3');
    expect(query('main-agent-effort')?.className).toContain('gap-1.5');
    expect(query('main-agent-effort')?.className).toContain('w-full');
    expect(query('main-agent-effort')?.querySelectorAll('button')).toHaveLength(6);
    expect(query('main-agent-save')?.textContent?.trim()).toBe('Save');
    expect(query('main-agent-cancel')?.textContent?.trim()).toBe('Cancel');
    expect(document.querySelector('[data-testid="main-agent-popover"] input[type="radio"]')).toBeNull();
  });

  it('caps its height at the larger free side of the trigger, so a flipped panel cannot run off the top', () => {
    // Trigger at y 406 in a 768 px viewport: 362 px below, 406 px above. The cap is taken from the trigger (406 less
    // the 8 px offset and 8 px margin; jsdom lays out no panel padding), not from the panel's own top edge, which
    // Floating UI moves above the trigger when the panel flips.
    const trigger = document.querySelector<HTMLElement>('ptah-main-agent-reassign-popover .popover-trigger');
    expect(trigger).not.toBeNull();
    jest.spyOn(trigger as HTMLElement, 'getBoundingClientRect').mockReturnValue({ top: 406, bottom: 406 } as DOMRect);
    const height = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    try {
      window.dispatchEvent(new Event('resize'));
      fixture.detectChanges();
      expect(query('main-agent-popover')?.style.maxHeight).toBe('390px');
    } finally {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
    }
  });

  it('never caps above the free side in a short window; the body keeps 4rem and the panel scrolls whole', () => {
    // Trigger at y 160 in a 320 px viewport: 160 px each side less 16 px reserve. The old 160 px floor overflowed.
    const trigger = document.querySelector<HTMLElement>('ptah-main-agent-reassign-popover .popover-trigger');
    expect(trigger).not.toBeNull();
    jest.spyOn(trigger as HTMLElement, 'getBoundingClientRect').mockReturnValue({ top: 160, bottom: 160 } as DOMRect);
    const height = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 320 });
    try {
      window.dispatchEvent(new Event('resize'));
      fixture.detectChanges();
      expect(query('main-agent-popover')?.style.maxHeight).toBe('144px');
      expect(query('main-agent-popover')?.className).toContain('overflow-y-auto');
      expect(query('main-agent-popover-body')?.className).toContain('min-h-16');
      // Opted into vertical shift, so a floored panel is pulled back inside the viewport.
      const popover = fixture.debugElement.query(By.directive(NativePopoverComponent));
      expect((popover.componentInstance as NativePopoverComponent).keepInViewport()).toBe(true);
    } finally {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
    }
  });

  it.each([
    // Tall trigger, 16 px each side: room 0 (each side less the 16 px reserve).
    ['zero room', 16, 284, 300, '120px'],
    ['negative room', 10, 290, 300, '120px'],
    ['non-finite geometry', NaN, NaN, 768, '120px'],
    ['a non-finite viewport', 406, 406, Infinity, '120px'],
    // The whole panel must fit inside 8 px edges: 32 - 16 = 16 (jsdom lays out no panel padding).
    ['a 32 px viewport', 16, 16, 32, '16px'],
    ['a 10 px viewport', 5, 5, 10, '1px'],
  ])('keeps a usable floor clamped to the viewport for %s, never 0 or NaN', (_case, top, bottom, viewport, cap) => {
    const trigger = document.querySelector<HTMLElement>('ptah-main-agent-reassign-popover .popover-trigger');
    expect(trigger).not.toBeNull();
    jest.spyOn(trigger as HTMLElement, 'getBoundingClientRect').mockReturnValue({ top, bottom } as DOMRect);
    const height = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewport });
    try {
      window.dispatchEvent(new Event('resize'));
      fixture.detectChanges();
      expect(query('main-agent-popover')?.style.maxHeight).toBe(cap);
    } finally {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
    }
  });

  describe('explicit save: the choices are a draft', () => {
    it('(a) provider, model, effort and Save-to choices write nothing before Save', async () => {
      choose('main-agent-provider', 'second');
      buttonNamed('Use for main agent')?.click(); fixture.detectChanges();
      choose('main-agent-model', 'model-b');
      effortButton('high')?.click(); fixture.detectChanges();
      choose('main-agent-save-to', 'global');
      await flush();
      nothingWritten();
      expect(feedback.toast()).toBeNull();
      expect(effortButton('high')?.getAttribute('aria-pressed')).toBe('true');
      expect(modelInput()?.value).toBe('Model B [Tool: No]');
    });

    it('(b) Save writes the drafted model and effort to the chosen scope in one write, with Undo, and closes', async () => {
      choose('main-agent-save-to', 'global');
      choose('main-agent-model', 'model-b');
      effortButton('high')?.click(); fixture.detectChanges();
      await save();
      expect(state.saveSettings).toHaveBeenCalledTimes(1);
      expect(state.saveSettings).toHaveBeenCalledWith({
        model: { model: 'model-b', applyTo: 'global' }, effort: { effort: 'high', applyTo: 'global' },
      }, CONTEXT);
      expect(state.activateConnection).not.toHaveBeenCalled();
      expect(feedback.toast()).toEqual({ tone: 'status', message: 'Saved main agent model and reasoning effort to All Ptah apps.', canUndo: true });
      expect(fixture.componentInstance.closed).toBe(1);
      await feedback.undo(); await flush();
      expect(state.saveSettings).toHaveBeenLastCalledWith({
        model: { model: 'model-a', applyTo: 'global' }, effort: { effort: 'medium', applyTo: 'global' },
      }, CONTEXT);
    });

    it('(c) Cancel writes nothing, emits closed, and the next open starts from the stored values', async () => {
      choose('main-agent-model', 'model-b');
      effortButton('low')?.click(); fixture.detectChanges();
      query<HTMLButtonElement>('main-agent-cancel')?.click(); await flush();
      nothingWritten();
      expect(fixture.componentInstance.closed).toBe(1);
      fixture.componentInstance.open.set(false); fixture.detectChanges();
      fixture.componentInstance.open.set(true); fixture.detectChanges(); await flush();
      expect(effortButton('medium')?.getAttribute('aria-pressed')).toBe('true');
      expect(modelInput()?.value).toBe('Model A [Tool: Yes]');
      expect(isDisabledControl(saveButton())).toBe(true);
    });

    it('× and Esc discard the draft the same way', async () => {
      effortButton('low')?.click(); fixture.detectChanges();
      document.querySelector<HTMLButtonElement>('[data-testid="main-agent-popover"] button[aria-label="Close"]')?.click(); await flush();
      expect(fixture.componentInstance.closed).toBe(1);
      nothingWritten();
    });

    it('(d) Save is disabled while the draft equals the stored values, and again once a choice goes back to them', () => {
      expect(isDisabledControl(saveButton())).toBe(true);
      choose('main-agent-save-to', 'global');
      expect(isDisabledControl(saveButton())).toBe(true);
      effortButton('high')?.click(); fixture.detectChanges();
      expect(isDisabledControl(saveButton())).toBe(false);
      effortButton('medium')?.click(); fixture.detectChanges();
      expect(isDisabledControl(saveButton())).toBe(true);
      choose('main-agent-model', 'model-b');
      expect(isDisabledControl(saveButton())).toBe(false);
      choose('main-agent-model', 'model-a');
      expect(isDisabledControl(saveButton())).toBe(true);
    });

    it('(f) Save to lists the targets both keys allow, defaulting to this workspace when one is open', () => {
      expect(options('main-agent-save-to').map((option) => option.value)).toEqual(['global', 'workspace']);
      expect(query<HTMLSelectElement>('main-agent-save-to')?.value).toBe('workspace');
    });

    it('with no workspace open, Save to defaults to the model\'s current scope and a provider change ends sessions everywhere', () => {
      state.writeScopes.mockImplementation((key: string): SettingScope[] => (key === EFFORT_KEY ? ['global'] : ['global', 'app']));
      // `writeScopes` is not a signal here; a fresh sources value makes the targets recompute.
      state.mainSources.set({ ...state.mainSources() }); fixture.detectChanges();
      expect(options('main-agent-save-to').map((option) => option.value)).toEqual(['global']);
      expect(query<HTMLSelectElement>('main-agent-save-to')?.value).toBe('global');
      choose('main-agent-provider', 'second');
      expect(query('main-agent-provider-copy')?.textContent?.trim())
        .toBe('New main-agent requests use Second. Changing the provider ends running chat sessions in every workspace.');
    });

    it('every trigger, Save included, is disabled while a save runs (D3)', () => {
      effortButton('high')?.click(); fixture.detectChanges();
      state.commit.set({ ...idle, status: 'saving' }); fixture.detectChanges();
      expect(isDisabledControl(query<HTMLSelectElement>('main-agent-provider'))).toBe(true);
      expect(isDisabledControl(modelInput())).toBe(true);
      for (const button of Array.from(query('main-agent-effort')?.querySelectorAll('button') ?? [])) expect(isDisabledControl((button as HTMLButtonElement))).toBe(true);
      expect(isDisabledControl(query<HTMLSelectElement>('main-agent-save-to'))).toBe(true);
      expect(isDisabledControl(saveButton())).toBe(true);
    });

    it('a workspace switch mid-edit: the blocked Save is reported, the popover stays open with the draft, the next Save uses the new context', async () => {
      const next = { scopeKey: 'other', activePath: '/other' };
      state.saveSettings.mockImplementationOnce(async () => {
        state.commit.set({ ...idle, status: 'blocked', message: 'The workspace changed. Review the values and retry.' });
        return true;
      });
      state.contextNow.set(next);
      choose('main-agent-model', 'model-b');
      await save();
      expect(feedback.toast()?.message).toContain('The workspace changed.');
      expect(fixture.componentInstance.closed).toBe(0);
      expect(modelInput()?.value).toBe('Model B [Tool: No]');
      state.commit.set(idle); fixture.detectChanges();
      await save();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ model: { model: 'model-b', applyTo: 'workspace' } }, next);
      expect(fixture.componentInstance.closed).toBe(1);
    });
  });

  describe('provider (D6: confirm, "ends running chat sessions", no Undo)', () => {
    it('lists activatable connections plus the driver; a failing connection is not offered', () => {
      expect(options('main-agent-provider').map((option) => option.value)).toEqual(['first', 'second', 'local']);
      expect(query<HTMLSelectElement>('main-agent-provider')?.value).toBe('first');
    });

    it('(e) a provider change needs its confirm before Save; Save then activates it to the "Save to" scope', async () => {
      expect(query('main-agent-provider-confirm')).toBeNull();
      choose('main-agent-provider', 'second');
      expect(query('main-agent-provider-copy')?.textContent?.trim())
        .toBe('New main-agent requests use Second. Changing the provider ends running chat sessions in this workspace.');
      expect(query('main-agent-provider-confirm')?.textContent).toContain('Saved to: This workspace.');
      // Not confirmed yet: Save is disabled and says why; a click that reaches it writes nothing.
      expect(isDisabledControl(saveButton())).toBe(true);
      expect(query('main-agent-save-hint')?.textContent).toContain('Confirm or cancel the provider change to save.');
      expect(saveButton()?.getAttribute('aria-describedby')).toBe('main-agent-save-hint');
      await save();
      nothingWritten();
      // Accepting the confirm only joins the draft; focus moves to Save.
      buttonNamed('Use for main agent')?.click(); await flush();
      nothingWritten();
      expect(query('main-agent-provider-confirmed')?.textContent).toContain('Applied when you press Save.');
      expect(query('main-agent-save-hint')).toBeNull();
      expect(document.activeElement).toBe(saveButton());
      await save();
      expect(state.activateConnection).toHaveBeenCalledWith('second', 'workspace', CONTEXT);
      expect(state.saveSettings).not.toHaveBeenCalled();
      // The outcome is the page toast now, never inline; a provider change offers no Undo.
      expect(query('main-agent-provider-outcome')).toBeNull();
      expect(feedback.toast()).toEqual({ tone: 'status', message: 'Main agent provider saved.', canUndo: false });
      expect(fixture.componentInstance.closed).toBe(1);
    });

    it('changing "Save to" after the confirm asks again (the copy names the new scope)', () => {
      choose('main-agent-provider', 'second');
      buttonNamed('Use for main agent')?.click(); fixture.detectChanges();
      choose('main-agent-save-to', 'global');
      expect(query('main-agent-provider-copy')?.textContent).toContain('in every workspace.');
      expect(buttonNamed('Use for main agent')).toBeDefined();
      expect(isDisabledControl(saveButton())).toBe(true);
    });

    it('a provider and a model in one Save: the provider is written first, then the model', async () => {
      const order: string[] = [];
      state.activateConnection.mockImplementationOnce(async () => { order.push('provider'); state.commit.set({ ...idle, status: 'saved' }); return true; });
      state.saveSettings.mockImplementationOnce(async () => { order.push('model'); state.commit.set({ ...idle, status: 'saved' }); return true; });
      choose('main-agent-provider', 'second');
      await flush();
      expect(loader.listModels).toHaveBeenLastCalledWith('second');
      choose('main-agent-model', 'model-b');
      buttonNamed('Use for main agent')?.click(); fixture.detectChanges();
      await save();
      expect(order).toEqual(['provider', 'model']);
      expect(state.saveSettings).toHaveBeenCalledWith({ model: { model: 'model-b', applyTo: 'workspace' } }, CONTEXT);
      // One toast names both writes: the provider's own outcome rides on the model save.
      expect(feedback.toast()?.message).toBe('Main agent provider saved. Saved main agent model to This workspace.');
      expect(fixture.componentInstance.closed).toBe(1);
    });

    it('Save to another scope offers "Save provider to {scope}…", which re-saves the current provider through the confirm (RUX-5)', async () => {
      // The provider is stored globally and "Save to" defaults to this workspace, so the offer shows at once.
      expect(query('main-agent-provider-rescope')?.textContent?.trim()).toBe('Save provider to This workspace…');
      choose('main-agent-save-to', 'global');
      expect(query('main-agent-provider-rescope')).toBeNull();
      choose('main-agent-save-to', 'workspace');
      expect(query('main-agent-provider-rescope')?.textContent?.trim()).toBe('Save provider to This workspace…');
      expect(query('main-agent-provider-confirm')).toBeNull();
      query<HTMLButtonElement>('main-agent-provider-rescope')?.click(); fixture.detectChanges();
      expect(query('main-agent-provider-copy')?.textContent)
        .toContain('keep using First. Saving the provider ends running chat sessions in this workspace.');
      buttonNamed('Use for main agent')?.click(); fixture.detectChanges();
      expect(state.activateConnection).not.toHaveBeenCalled();
      await save();
      expect(state.activateConnection).toHaveBeenCalledWith('first', 'workspace', CONTEXT);
    });

    it('an uncheckable connection keeps its note; Cancel provider change drops it, writes nothing, and keeps focus inside', () => {
      choose('main-agent-provider', 'local');
      expect(query('activation-unchecked-note')?.textContent).toContain('Ptah cannot check this connection before use.');
      const cancel = buttonNamed('Cancel provider change');
      cancel?.focus(); cancel?.click(); fixture.detectChanges();
      expect(query('main-agent-provider-confirm')).toBeNull();
      nothingWritten();
      expect(document.activeElement).toBe(query('main-agent-provider'));
      expect(isDisabledControl(saveButton())).toBe(true);
    });

    it('a refused or failed activation is never reported as saved (D15); the popover stays open and the model is not written', async () => {
      state.activateConnection.mockImplementationOnce(async () => false);
      choose('main-agent-provider', 'second');
      choose('main-agent-model', 'model-b');
      buttonNamed('Use for main agent')?.click(); fixture.detectChanges();
      await save();
      expect(feedback.toast()?.message).toContain('Not saved. Another save is in progress.');
      state.activateConnection.mockImplementationOnce(async () => { state.commit.set({ ...idle, status: 'failed', message: 'Could not save.' }); return true; });
      await save();
      expect(feedback.toast()).toMatchObject({ tone: 'alert', message: 'Not saved. Could not save.' });
      expect(query('main-agent-provider-outcome')).toBeNull();
      expect(state.saveSettings).not.toHaveBeenCalled();
      expect(fixture.componentInstance.closed).toBe(0);
    });
  });

  describe('model (compact search, drafted on selection)', () => {
    it('lists the driver\'s catalogue with the tool-use marker, "Enter a model ID…" last, loaded through the page loader', () => {
      expect(loader.listModels).toHaveBeenCalledWith('first');
      expect(modelField().options().map((option) => option.name)).toEqual(['Model A [Tool: Yes]', 'Model B [Tool: No]']);
      expect(modelField().pinnedOption()?.name).toBe('Enter a model ID…');
      expect(modelField().includeDefault()).toBe(false);
      expect(modelInput()?.value).toBe('Model A [Tool: Yes]');
    });

    it('filters as the user types; arrows and Enter pick a model into the draft (keyboard, ARIA combobox)', async () => {
      const input = modelInput();
      if (!input) throw new Error('No model input');
      input.click(); fixture.detectChanges();
      expect(input.getAttribute('aria-expanded')).toBe('true');
      input.value = 'model b'; input.dispatchEvent(new Event('input')); fixture.detectChanges();
      const listbox = document.getElementById(input.getAttribute('aria-controls') ?? '');
      expect(Array.from(listbox?.querySelectorAll('[role="option"]') ?? []).map((row) => row.textContent?.trim()))
        .toEqual(['Model B [Tool: No]', 'Enter a model ID…']);
      key(input, 'Home');
      const active = document.getElementById(input.getAttribute('aria-activedescendant') ?? '');
      expect(active?.textContent?.trim()).toBe('Model B [Tool: No]');
      key(input, 'ArrowDown');
      expect(document.getElementById(input.getAttribute('aria-activedescendant') ?? '')?.textContent?.trim()).toBe('Enter a model ID…');
      key(input, 'ArrowUp');
      key(input, 'Enter'); await flush();
      nothingWritten();
      await save();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ model: { model: 'model-b', applyTo: 'workspace' } }, CONTEXT);
    });

    it('Esc closes the open model list first, and only the next Esc closes the popover', () => {
      const input = modelInput();
      if (!input) throw new Error('No model input');
      input.click(); fixture.detectChanges();
      key(input, 'Escape');
      expect(input.getAttribute('aria-expanded')).toBe('false');
      expect(fixture.componentInstance.closed).toBe(0);
      key(input, 'Escape');
      expect(fixture.componentInstance.closed).toBe(1);
    });

    it('a stored model the catalogue lacks stays listed and selected', async () => {
      state.model.set(ready({ model: 'custom/x' })); fixture.detectChanges();
      expect(modelField().options()[0].name).toBe('custom/x · not in current catalog');
      expect(modelInput()?.value).toBe('custom/x · not in current catalog');
    });

    it('a model alone saves with the "main agent model" toast; Undo is a second real write of the previous model', async () => {
      choose('main-agent-model', 'model-b');
      await save();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ model: { model: 'model-b', applyTo: 'workspace' } }, CONTEXT);
      expect(feedback.toast()).toEqual({ tone: 'status', message: 'Saved main agent model to This workspace.', canUndo: true });
      await feedback.undo(); await flush();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ model: { model: 'model-a', applyTo: 'workspace' } }, CONTEXT);
      expect(state.saveSettings).toHaveBeenCalledTimes(2);
    });

    it('"Enter a model ID…" swaps in a field (the footer waits); Use drafts the typed id and Save writes it (#35)', async () => {
      choose('main-agent-model', '__manual__'); await flush();
      const input = query<HTMLInputElement>('main-agent-model-manual');
      expect(input).not.toBeNull();
      // The select left the DOM: focus moves to the field, so it (and Esc) stay inside the popover.
      expect(document.activeElement).toBe(input);
      expect(query('main-agent-footer')).toBeNull();
      if (!input) return;
      input.value = 'vendor/unlisted'; input.dispatchEvent(new Event('input')); fixture.detectChanges();
      buttonNamed('Use')?.click(); await flush();
      nothingWritten();
      expect(query('main-agent-model')?.tagName).toBe('PTAH-PROVIDER-MODEL-SEARCH-FIELD');
      expect(document.activeElement).toBe(modelInput());
      // Refocus opens a fresh search; closing the list reveals the drafted selection.
      expect(modelInput()?.getAttribute('aria-expanded')).toBe('true');
      expect(modelInput()?.value).toBe('');
      modelInput()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flush();
      expect(modelInput()?.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(modelInput());
      expect(fixture.componentInstance.closed).toBe(0);
      expect(modelInput()?.value).toBe('vendor/unlisted · not in current catalog');
      await save();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ model: { model: 'vendor/unlisted', applyTo: 'workspace' } }, CONTEXT);
    });

    it('a Save whose write throws stays open with the draft and never shows the host error', async () => {
      state.commit.set({ ...idle, status: 'saved' });
      state.saveSettings.mockImplementationOnce(async () => { throw new Error('host broke'); });
      choose('main-agent-model', 'model-b');
      await save();
      expect(feedback.toast()).toEqual({ tone: 'alert', canUndo: false, message: 'Could not confirm whether main agent model was saved.' });
      expect(fixture.componentInstance.closed).toBe(0);
      expect(isDisabledControl(saveButton())).toBe(false);
      expect(document.body.textContent).not.toContain('host broke');
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
      choose('main-agent-model', 'model-b');
      await save();
      expect(feedback.toast()?.tone).toBe('alert');
      expect(feedback.toast()?.canUndo).toBe(false);
      expect(fixture.componentInstance.closed).toBe(0);
    });
  });

  describe('effort (segmented 3 x 2 grid)', () => {
    it('the drafted level is pressed (primary); default clears on Save; Undo restores', async () => {
      expect(effortButton('medium')?.getAttribute('aria-pressed')).toBe('true');
      expect(effortButton('medium')?.className).toContain('btn-primary');
      effortButton('default')?.click(); fixture.detectChanges();
      expect(effortButton('default')?.getAttribute('aria-pressed')).toBe('true');
      expect(effortButton('medium')?.getAttribute('aria-pressed')).toBe('false');
      await save();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ effort: { effort: undefined, applyTo: 'workspace' } }, CONTEXT);
      expect(feedback.toast()?.message).toBe('Saved reasoning effort to This workspace.');
      await feedback.undo(); await flush();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ effort: { effort: 'medium', applyTo: 'workspace' } }, CONTEXT);
    });
  });

  it('Check connection re-reads the route and is disabled while it runs', () => {
    query<HTMLButtonElement>('main-agent-check')?.click();
    expect(state.checkConnection).toHaveBeenCalledTimes(1);
    state.route.set({ status: 'loading', data: ROUTE, error: null }); fixture.detectChanges();
    expect(isDisabledControl(query<HTMLButtonElement>('main-agent-check'))).toBe(true);
    expect(query('main-agent-check')?.textContent?.trim()).toBe('Checking…');
  });

  // M1 (providers-21-28-code-logic-review.md): with no "Save to" target offered, nothing may be written, and never to
  // a scope `writeScopes` did not offer (the old fallback was 'global').
  describe('while the model and effort sources are not loaded (M1)', () => {
    it('loading: model, effort, Save to and Save are disabled, the reason is shown, and no write can start', async () => {
      state.mainSources.set({ status: 'loading', data: null, error: null } as never); fixture.detectChanges(); await flush();
      expect(isDisabledControl(modelInput())).toBe(true);
      expect(isDisabledControl(query<HTMLSelectElement>('main-agent-save-to'))).toBe(true);
      expect(isDisabledControl(effortButton('high'))).toBe(true);
      expect(query('main-agent-sources-loading')?.textContent).toContain('Loading where the model and effort are saved');
      // Even an event that reaches a handler writes nothing.
      effortButton('high')?.click(); choose('main-agent-model', 'model-b'); await flush();
      expect(isDisabledControl(saveButton())).toBe(true);
      await save();
      nothingWritten();
    });

    it('error: the region says so with "Retry model and effort sources", and a provider change cannot be confirmed or saved', async () => {
      state.mainSources.set({ status: 'error', data: null, error: 'Could not load this section. Retry.' } as never);
      fixture.detectChanges(); await flush();
      expect(query('main-agent-sources-error')?.textContent).toContain('could not be loaded');
      buttonNamed('Retry model and effort sources')?.click();
      expect(state.refreshMainSources).toHaveBeenCalledTimes(1);
      choose('main-agent-provider', 'second');
      expect(query('main-agent-provider-confirm')?.textContent).toContain('Where to save is not loaded yet.');
      expect(isDisabledControl(buttonNamed('Use for main agent'))).toBe(true);
      expect(isDisabledControl(saveButton())).toBe(true);
      await save();
      nothingWritten();
    });
  });

  // Batch 27b: the App target is the running host's own layer (`app.vscode.*` in VS Code,
  // `app.electron.*` in the desktop app), so it stays offered in both hosts and is named after the host.
  describe.each([
    { host: 'VS Code', isElectron: false, label: 'VS Code', other: 'Desktop app' },
    { host: 'Electron', isElectron: true, label: 'Desktop app', other: 'VS Code' },
  ])('Save to in the $host host', ({ isElectron, label, other }) => {
    beforeEach(async () => {
      feedback.dismiss();
      TestBed.resetTestingModule();
      state = new StateStub();
      state.writeScopes.mockImplementation((): SettingScope[] => ['global', 'app', 'workspace']);
      TestBed.configureTestingModule({
        imports: [Host],
        providers: [{ provide: ProvidersSettingsStateService, useValue: state }, { provide: PROVIDER_MODELS_LOADER, useValue: loader },
          SettingsSaveFeedbackService, { provide: VSCodeService, useValue: { isElectron } }],
      });
      fixture = TestBed.createComponent(Host);
      feedback = TestBed.inject(SettingsSaveFeedbackService);
      fixture.detectChanges();
      await flush();
    });

    it(`lists "Global · all apps", "${label}", "This workspace"; never "${other}"`, () => {
      expect(options('main-agent-save-to').map((option) => [option.value, option.textContent?.trim()])).toEqual([
        ['global', 'Global · all apps'], ['app', label], ['workspace', 'This workspace'],
      ]);
      expect(query('main-agent-popover')?.textContent).not.toContain(other);
    });

    it(`the App target re-saves the provider "to ${label}" and saves the model there, with a "${label}" toast`, async () => {
      choose('main-agent-save-to', 'app');
      expect(query('main-agent-provider-rescope')?.textContent?.trim()).toBe(`Save provider to ${label}…`);
      query<HTMLButtonElement>('main-agent-provider-rescope')?.click(); fixture.detectChanges();
      expect(query('main-agent-provider-confirm')?.textContent).toContain(`Saved to: ${label}.`);
      buttonNamed('Cancel provider change')?.click(); fixture.detectChanges();
      expect(query('main-agent-provider-confirm')).toBeNull();
      choose('main-agent-model', 'model-b');
      await save();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ model: { model: 'model-b', applyTo: 'app' } }, CONTEXT);
      expect(feedback.toast()?.message).toBe(`Saved main agent model to ${label}.`);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// P6 MP: the Account field (Claude CLI main chat account), its save step, the P6-A12 race guard and the P6-A13 lock.
// ---------------------------------------------------------------------------------------------------------------------

const account = (profileId: string, label: string, state = 'signed-in', revision = 1) =>
  ({ profileId, label, provider: 'claude', state, owner: { kind: 'ptah' }, revision, activeRunCount: 0 }) as unknown as ProviderAccountSummary;
const WORK = account('p-work', 'Work'), HOME = account('p-home', 'Home');
function snapshot(main: ProviderAccountSelection = { kind: 'ambient' }, mainRevision = 1,
  accounts: readonly ProviderAccountSummary[] = [WORK, HOME]): ProviderAccountsSnapshot {
  return {
    revision: 1, accounts,
    selections: {
      main: { scope: 'main', selection: main, revision: mainRevision },
      lane: { scope: 'lane', selection: { kind: 'omitted' }, revision: 1 },
    },
  } as unknown as ProviderAccountsSnapshot;
}
const readyView = (snap: ProviderAccountsSnapshot | null): ProviderAccountsView =>
  ({ status: snap ? 'ready' : 'loading', snapshot: snap, stale: false, error: null });
const AMBIENT_CONNECTED: ClaudeAmbientStatusView = { status: 'ready', result: { state: 'connected', checkedAt: null }, localFailure: false };
const REFUSED = { status: 'failed', result: { code: 'conflict', summary: 'x' } } as ProviderAccountActionOutcome;

/** The service's own `saved` reply: the host commits the choice and bumps the scope revision. */
function savedReply(view: WritableSignal<ProviderAccountsView>) {
  return async (choice: ProviderAccountChoice): Promise<ProviderAccountActionOutcome> => {
    const current = view().snapshot ?? snapshot();
    const next = snapshot(choice, current.selections.main.revision + 1, current.accounts);
    view.set(readyView(next));
    return { status: 'saved', snapshot: next };
  };
}

class AccountsFake {
  readonly view = signal<ProviderAccountsView>(readyView(snapshot()));
  readonly state = jest.fn((_provider: 'claude') => this.view.asReadonly());
  readonly open = jest.fn(async (_provider: 'claude') => undefined);
  /** The snapshot the service held when `setSelection` was called (its call-time read). */
  readonly seen: (ProviderAccountsSnapshot | null)[] = [];
  reply: (choice: ProviderAccountChoice) => Promise<ProviderAccountActionOutcome> = savedReply(this.view);
  readonly setSelection = jest.fn((_provider: 'claude', _scope: 'main' | 'lane', choice: ProviderAccountChoice) => {
    this.seen.push(this.view().snapshot);
    return this.reply(choice);
  });
}
class AmbientFake {
  readonly view = signal<ClaudeAmbientStatusView>(AMBIENT_CONNECTED);
  readonly read = jest.fn(async (_refresh: boolean) => undefined);
}

@Component({
  standalone: true,
  imports: [MainAgentReassignPopoverComponent],
  template: `<ptah-main-agent-reassign-popover [open]="open()" (closed)="closed = closed + 1" (accountSignInRequested)="signIn = signIn + 1" />`,
})
class AccountHost {
  readonly open = signal(true);
  closed = 0;
  signIn = 0;
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve: (value: T) => resolve(value) };
}

describe('MainAgentReassignPopoverComponent: Account (P6 MP)', () => {
  let fixture: ComponentFixture<AccountHost>;
  let state: StateStub;
  let accounts: AccountsFake;
  let ambient: AmbientFake;
  let feedback: SettingsSaveFeedbackService;
  let announce: jest.SpyInstance;
  let feedbackSave: jest.SpyInstance;
  const query = <T extends HTMLElement = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
  const field = () => query<HTMLSelectElement>('main-agent-account');
  const saveButton = () => query<HTMLButtonElement>('main-agent-save');
  const optionRows = () => Array.from(field()?.options ?? []).map((option) => [option.value, option.textContent?.trim(), option.disabled]);
  async function flush() {
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();
  }
  function choose(id: string, value: string) {
    const select = query<HTMLSelectElement>(id);
    if (!select) throw new Error(`No select ${id}`);
    select.value = value; select.dispatchEvent(new Event('change')); fixture.detectChanges();
  }
  function effort(value: string) {
    query('main-agent-effort')?.querySelector<HTMLButtonElement>(`[data-effort="${value}"]`)?.click();
    fixture.detectChanges();
  }
  /** The route after a provider save names the new driver (the page re-reads it). */
  function routeWithDriver(driver: string) {
    state.route.set(ready({
      ...ROUTE, driverProviderId: driver,
      providers: [...ROUTE.providers, { id: 'claude', type: 'cli', status: 'connected' }],
    } as unknown as ProvidersEffectiveRoute));
  }
  /** Drafts the Claude CLI as the new provider and accepts its D6 confirm. */
  function draftClaudeProvider() {
    choose('main-agent-provider', 'claude');
    Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="main-agent-popover"] button'))
      .find((node) => node.textContent?.trim() === 'Use for main agent')?.click();
    fixture.detectChanges();
  }
  async function clickSave() { saveButton()?.focus(); saveButton()?.click(); await flush(); await flush(); }
  const announced = () => announce.mock.calls.map(([message, tone]) => `${tone}: ${message}`);

  async function setup(options: { electron?: boolean; driver?: string; view?: ProviderAccountsView } = {}) {
    Object.defineProperty(Element.prototype, 'scrollIntoView', { writable: true, configurable: true, value: jest.fn() });
    state = new StateStub();
    state.connections.set(ready([connection('first', 'First'), connection('claude', 'Claude (Subscription)', 'cli'), connection('second', 'Second')]));
    routeWithDriver(options.driver ?? 'claude');
    // A saved provider becomes the route's driver, as the page's re-read does.
    state.activateConnection.mockImplementation(async (id: string) => {
      routeWithDriver(id);
      state.commit.set({ ...idle, status: 'saved' });
      return true;
    });
    accounts = new AccountsFake();
    if (options.view) accounts.view.set(options.view);
    ambient = new AmbientFake();
    TestBed.configureTestingModule({
      imports: [AccountHost],
      providers: [
        { provide: ProvidersSettingsStateService, useValue: state },
        { provide: PROVIDER_MODELS_LOADER, useValue: { listModels: jest.fn(async (): Promise<ProviderListModelsResult> => CATALOGUE) } },
        { provide: VSCodeService, useValue: { isElectron: options.electron ?? true } },
        { provide: ProviderAccountsStateService, useValue: accounts },
        { provide: ClaudeAmbientStatusService, useValue: ambient },
        SettingsSaveFeedbackService,
      ],
    });
    fixture = TestBed.createComponent(AccountHost);
    feedback = TestBed.inject(SettingsSaveFeedbackService);
    announce = jest.spyOn(feedback, 'announce');
    feedbackSave = jest.spyOn(feedback, 'save');
    fixture.detectChanges();
    await flush();
  }
  afterEach(() => { feedback?.dismiss(); TestBed.resetTestingModule(); });

  describe('when it shows (M1-M4)', () => {
    it('is absent outside Electron, and no account service is read', async () => {
      await setup({ electron: false });
      expect(field()).toBeNull();
      expect(accounts.state).not.toHaveBeenCalled();
      expect(accounts.open).not.toHaveBeenCalled();
      expect(ambient.read).not.toHaveBeenCalled();
    });

    it('is absent before the first list read, for another provider, and with no signed-in account and ambient stored', async () => {
      await setup({ view: readyView(null) });
      expect(field()).toBeNull();
      accounts.view.set(readyView(snapshot()));
      fixture.detectChanges();
      expect(field()).not.toBeNull();
      choose('main-agent-provider', 'first');
      expect(field()).toBeNull();
      choose('main-agent-provider', 'claude');
      expect(field()).not.toBeNull();
      accounts.view.set(readyView(snapshot({ kind: 'ambient' }, 1, [account('p-work', 'Work', 'signed-out')])));
      fixture.detectChanges();
      expect(field()).toBeNull();
    });

    it('reads the list once and the cached ambient status on open; options, order and label follow the presentation rules', async () => {
      await setup();
      expect(accounts.open).toHaveBeenCalledTimes(1);
      expect(accounts.open).toHaveBeenCalledWith('claude');
      expect(ambient.read).toHaveBeenCalledTimes(1);
      expect(ambient.read).toHaveBeenCalledWith(false);
      expect(document.querySelector('label[for="main-agent-account"]')?.textContent?.trim()).toBe('Account');
      expect(optionRows()).toEqual([
        ['ambient', 'Existing Claude login', false], ['named:p-work', 'Work', false], ['named:p-home', 'Home', false],
      ]);
      expect(field()?.value).toBe('ambient');
      expect(field()?.title).toBe('Existing Claude login');
      expect(field()?.getAttribute('aria-invalid')).toBeNull();
      // Provider before Account, Account before Model.
      const [provider, accountField, model] = ['main-agent-provider', 'main-agent-account', 'main-agent-model'].map((id) => query(id));
      expect((provider?.compareDocumentPosition(accountField as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect((accountField?.compareDocumentPosition(model as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('a signed-out stored account is selected and disabled, with a "Sign in" button that asks the page to route (M4a)', async () => {
      await setup({ view: readyView(snapshot({ kind: 'named', profileId: 'p-work' }, 1, [account('p-work', 'Work', 'signed-out'), HOME])) });
      expect(optionRows()[0]).toEqual(['stored', 'Work (not signed in)', true]);
      expect(field()?.value).toBe('stored');
      const signIn = query<HTMLButtonElement>('main-agent-account-sign-in');
      expect(signIn?.textContent?.trim()).toBe('Sign in');
      expect(signIn?.getAttribute('aria-label')).toBe('Sign in to the saved account');
      expect(signIn?.parentElement?.className).toContain('justify-between');
      signIn?.click();
      expect(fixture.componentInstance.signIn).toBe(1);
      expect(field()?.getAttribute('aria-invalid')).toBeNull();
      expect(saveButton()?.disabled).toBe(true);
    });

    it('a removed stored account is said, marked invalid and described; nothing is reassigned (M4b, B-1)', async () => {
      await setup({ view: readyView(snapshot({ kind: 'named', profileId: 'p-gone' })) });
      expect(optionRows()[0]).toEqual(['stored', ACCOUNT_COPY.removedOption, true]);
      expect(field()?.value).toBe('stored');
      expect(field()?.getAttribute('aria-invalid')).toBe('true');
      const describedBy = field()?.getAttribute('aria-describedby') ?? '';
      expect(document.getElementById(describedBy)?.textContent?.trim()).toBe(ACCOUNT_COPY.removedAccount);
      expect(document.getElementById(describedBy)?.className).toContain('sr-only');
      expect(query('main-agent-account-sign-in')).toBeNull();
      expect(saveButton()?.disabled).toBe(true);
      expect(accounts.setSelection).not.toHaveBeenCalled();
    });

    it('a disabled pick is never kept: the select re-asserts the shown value and Save stays disabled', async () => {
      await setup({ view: readyView(snapshot({ kind: 'ambient' }, 1, [WORK, account('p-off', 'Off', 'signed-out')])) });
      expect(optionRows()).toContainEqual(['named:p-off', 'Off (sign in first)', true]);
      choose('main-agent-account', 'named:p-off');
      await flush();
      expect(field()?.value).toBe('ambient');
      expect(saveButton()?.disabled).toBe(true);
    });
  });

  describe('Save', () => {
    it('an account-only draft needs no other change: Save writes the main scope, says "Chat uses {name}" and closes', async () => {
      await setup();
      expect(saveButton()?.disabled).toBe(true);
      choose('main-agent-account', 'named:p-home');
      expect(saveButton()?.disabled).toBe(false);
      await clickSave();
      expect(accounts.setSelection).toHaveBeenCalledTimes(1);
      expect(accounts.setSelection).toHaveBeenCalledWith('claude', 'main', { kind: 'named', profileId: 'p-home' });
      expect(announced()).toEqual(['status: Chat uses Home']);
      expect(state.activateConnection).not.toHaveBeenCalled();
      expect(state.saveSettings).not.toHaveBeenCalled();
      expect(fixture.componentInstance.closed).toBe(1);
    });

    it('writes the ambient choice as is', async () => {
      await setup({ view: readyView(snapshot({ kind: 'named', profileId: 'p-work' })) });
      expect(field()?.value).toBe('named:p-work');
      choose('main-agent-account', 'ambient');
      await clickSave();
      expect(accounts.setSelection).toHaveBeenCalledWith('claude', 'main', { kind: 'ambient' });
      expect(announced()).toEqual(['status: Chat uses Existing Claude login']);
    });

    it('control case: with no push during the provider write, the account is written once against the click-time snapshot', async () => {
      await setup({ driver: 'first' });
      draftClaudeProvider();
      choose('main-agent-account', 'named:p-home');
      const clickTime = accounts.view().snapshot;
      await clickSave();
      expect(state.activateConnection).toHaveBeenCalledTimes(1);
      expect(accounts.setSelection).toHaveBeenCalledTimes(1);
      expect(accounts.setSelection).toHaveBeenCalledWith('claude', 'main', { kind: 'named', profileId: 'p-home' });
      expect(accounts.seen[0]).toBe(clickTime);
      expect(state.activateConnection.mock.invocationCallOrder[0]).toBeLessThan(accounts.setSelection.mock.invocationCallOrder[0]);
      // One toast for both writes.
      expect(announced()).toEqual(['status: Main agent provider saved. Chat uses Home']);
      expect(fixture.componentInstance.closed).toBe(1);
    });

    it.each([
      ['the main selection revision moved', () => snapshot({ kind: 'ambient' }, 2)],
      ['the named account revision moved', () => snapshot({ kind: 'ambient' }, 1, [WORK, account('p-home', 'Home', 'signed-in', 2)])],
      ['the account was removed', () => snapshot({ kind: 'ambient' }, 1, [WORK])],
    ])('race (P6-A12): %s during the provider write -> no account write, one alert, draft cleared, Save locked', async (_name, pushed) => {
      await setup({ driver: 'first' });
      draftClaudeProvider();
      choose('main-agent-account', 'named:p-home');
      const provider = deferred<boolean>();
      state.activateConnection.mockImplementationOnce(async (id: string) => {
        const saved = await provider.promise;
        routeWithDriver(id);
        state.commit.set({ ...idle, status: 'saved' });
        return saved;
      });
      saveButton()?.click();
      await flush();
      accounts.view.set(readyView(pushed()));
      provider.resolve(true);
      await flush(); await flush();
      expect(accounts.setSelection).not.toHaveBeenCalled();
      expect(announced()).toEqual([`alert: ${ACCOUNT_COPY.providerSavedAccountNot}`]);
      expect(field()?.value).toBe('ambient');
      expect(saveButton()?.disabled).toBe(true);
      expect(fixture.componentInstance.closed).toBe(0);
    });

    it('lock (P6-A13): provider + account + effort; a refused account stops effort and locks Save until another account', async () => {
      await setup({ driver: 'first' });
      draftClaudeProvider();
      choose('main-agent-account', 'named:p-home');
      effort('high');
      accounts.reply = async () => REFUSED;
      await clickSave();
      expect(state.activateConnection).toHaveBeenCalledTimes(1);
      expect(accounts.setSelection).toHaveBeenCalledTimes(1);
      expect(announced()).toEqual([`alert: ${ACCOUNT_COPY.providerSavedAccountNot}`]);
      expect(feedbackSave).not.toHaveBeenCalled();
      expect(state.saveSettings).not.toHaveBeenCalled();
      expect(query('main-agent-effort')?.querySelector('[data-effort="high"]')?.getAttribute('aria-pressed')).toBe('true');
      expect(field()?.value).toBe('ambient');
      expect(saveButton()?.disabled).toBe(true);
      // A second click does nothing.
      await clickSave();
      expect(accounts.setSelection).toHaveBeenCalledTimes(1);
      // Another enabled account lifts the lock; the next Save writes the account, then the effort.
      accounts.reply = savedReply(accounts.view);
      choose('main-agent-account', 'named:p-work');
      expect(saveButton()?.disabled).toBe(false);
      await clickSave();
      expect(accounts.setSelection).toHaveBeenCalledTimes(2);
      expect(accounts.setSelection).toHaveBeenLastCalledWith('claude', 'main', { kind: 'named', profileId: 'p-work' });
      expect(state.saveSettings).toHaveBeenCalledTimes(1);
      expect(accounts.setSelection.mock.invocationCallOrder[1]).toBeLessThan(state.saveSettings.mock.invocationCallOrder[0]);
      expect(fixture.componentInstance.closed).toBe(1);
    });

    it('reopening the popover clears the lock', async () => {
      await setup();
      choose('main-agent-account', 'named:p-home');
      accounts.reply = async () => ({ status: 'unavailable' });
      await clickSave();
      expect(announced()).toEqual([`alert: ${ACCOUNT_COPY.saveFailed}`]);
      effort('high');
      expect(saveButton()?.disabled).toBe(true);
      fixture.componentInstance.open.set(false); await flush();
      fixture.componentInstance.open.set(true); await flush();
      effort('high');
      expect(saveButton()?.disabled).toBe(false);
    });

    describe('B-2 focus at a refusal (P6-A3)', () => {
      it('focus still on Save -> focus lands on the Account select', async () => {
        await setup();
        choose('main-agent-account', 'named:p-home');
        effort('high');
        accounts.reply = async () => REFUSED;
        await clickSave();
        expect(document.activeElement?.id).toBe('main-agent-account');
        expect(saveButton()?.disabled).toBe(true);
      });

      it('focus moved elsewhere during the await -> no focus move', async () => {
        await setup();
        choose('main-agent-account', 'named:p-home');
        effort('high');
        const reply = deferred<ProviderAccountActionOutcome>();
        accounts.reply = () => reply.promise;
        saveButton()?.focus(); saveButton()?.click();
        await flush();
        const other = query<HTMLButtonElement>('main-agent-cancel');
        other?.focus();
        reply.resolve(REFUSED);
        await flush(); await flush();
        expect(document.activeElement).toBe(other);
        expect(saveButton()?.disabled).toBe(true);
      });

      it('popover closed mid-write -> no focus move, the alert still announces', async () => {
        await setup();
        choose('main-agent-account', 'named:p-home');
        const reply = deferred<ProviderAccountActionOutcome>();
        accounts.reply = () => reply.promise;
        saveButton()?.focus(); saveButton()?.click();
        await flush();
        fixture.componentInstance.open.set(false); await flush();
        const before = document.activeElement;
        reply.resolve(REFUSED);
        await flush(); await flush();
        expect(document.activeElement).toBe(before);
        expect(document.activeElement?.id).not.toBe('main-agent-account');
        // An account-only refusal says the host's safe summary (here "x").
        expect(announced()).toEqual([`alert: ${selectionFeedback(REFUSED, 'main', { providerSaved: false })?.message}`]);
        expect(announced()).toEqual(['alert: x']);
      });
    });

    it('unconfirmed with an effort draft: only the uncertainty alert, no lock, no focus move, Save still enabled', async () => {
      await setup();
      choose('main-agent-account', 'named:p-home');
      effort('high');
      accounts.reply = async () => ({ status: 'unconfirmed' });
      await clickSave();
      expect(announced()).toEqual([`alert: ${ACCOUNT_COPY.unconfirmed}`]);
      expect(announced().join(' ')).not.toContain('not saved');
      expect(document.activeElement?.id).not.toBe('main-agent-account');
      expect(field()?.value).toBe('ambient');
      expect(state.saveSettings).not.toHaveBeenCalled();
      expect(saveButton()?.disabled).toBe(false);
      expect(fixture.componentInstance.closed).toBe(0);
    });

    it('account saved + effort failed: account draft cleared, stays open, only the effort failure toast', async () => {
      await setup();
      choose('main-agent-account', 'named:p-home');
      effort('high');
      state.saveSettings.mockImplementationOnce(async () => { state.commit.set({ ...idle, status: 'failed', unsaved: ['effort'] }); return true; });
      await clickSave();
      expect(accounts.setSelection).toHaveBeenCalledTimes(1);
      expect(announce).not.toHaveBeenCalled();
      expect(feedback.toast()?.tone).toBe('alert');
      expect(feedback.toast()?.message).not.toContain('Chat uses');
      // The draft is gone; the select follows the stored (now saved) account.
      expect(field()?.value).toBe('named:p-home');
      expect(accounts.view().snapshot?.selections.main.selection).toEqual({ kind: 'named', profileId: 'p-home' });
      expect(fixture.componentInstance.closed).toBe(0);
    });

    it('account saved + effort saved: one toast carrying "Chat uses {name}", whose Undo restores only the effort', async () => {
      await setup();
      choose('main-agent-account', 'named:p-home');
      effort('high');
      await clickSave();
      expect(announce).not.toHaveBeenCalled();
      expect(feedback.toast()?.tone).toBe('status');
      expect(feedback.toast()?.message).toMatch(/^Saved reasoning effort to .+\. Chat uses Home\.$/);
      expect(feedback.toast()?.canUndo).toBe(true);
      expect(fixture.componentInstance.closed).toBe(1);
      await feedback.undo(); await flush();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ effort: { effort: 'medium', applyTo: 'workspace' } }, CONTEXT);
      expect(accounts.setSelection).toHaveBeenCalledTimes(1);
    });
  });

  it('a stored account pushed during a draft keeps the draft and says "Account changed elsewhere" once', async () => {
    await setup();
    choose('main-agent-account', 'named:p-home');
    accounts.view.set(readyView(snapshot({ kind: 'named', profileId: 'p-work' }, 2)));
    await flush();
    expect(announced()).toEqual([`status: ${ACCOUNT_COPY.accountChangedElsewhere}`]);
    expect(field()?.value).toBe('named:p-home');
    accounts.view.set(readyView(snapshot({ kind: 'ambient' }, 3)));
    await flush();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(saveButton()?.disabled).toBe(false);
  });
});
