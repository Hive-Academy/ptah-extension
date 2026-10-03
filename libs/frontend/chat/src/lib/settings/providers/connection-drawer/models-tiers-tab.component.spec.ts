import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ProvidersSettingsStateService, type ProvidersConnection, type ProvidersSettingsCommit, type ProvidersSettingsSection,
} from '@ptah-extension/core';
import { PROVIDER_MODELS_LOADER, ProviderModelPickerComponent } from '@ptah-extension/ui';
import { SettingsSaveFeedbackService } from '../../feedback/settings-save-feedback.service';
import { ModelsTiersTabComponent, tiersApply } from './models-tiers-tab.component';
import { isDisabledControl } from '../../feedback/busy-disabled.testing';

type Tiers = { sonnet: string | null; opus: string | null; haiku: string | null };
const idle: ProvidersSettingsCommit = { status: 'idle', saved: [], unsaved: [], unconfirmed: [], refreshFailed: false, message: null };
const ready = <T>(data: T): ProvidersSettingsSection<T> => ({ status: 'ready', data, error: null });
const connection = (overrides: Partial<ProvidersConnection> = {}): ProvidersConnection => ({
  id: 'moonshot', name: 'Moonshot (Kimi)', authMode: 'apiKey', hasKey: true, configured: true, custom: false,
  defaultsResolvable: true, accountLabel: null, tokenStale: false, ...overrides,
});
const CONTEXT = { scopeKey: 'workspace', activePath: '/workspace' };

class StateStub {
  readonly tiers = signal<ProvidersSettingsSection<Tiers>>({ status: 'unloaded', data: null, error: null });
  readonly commit = signal<ProvidersSettingsCommit>(idle);
  readonly context = signal<typeof CONTEXT | null>(CONTEXT);
  readonly reviewContext = jest.fn(() => this.context());
  readonly refreshTiers = jest.fn(async (_params: unknown) => undefined);
  /** Each write saves and reads back the tier the way the real commit service reports it. */
  readonly setMainAgentTier = jest.fn(async (_id: string, tier: keyof Tiers, model: string, _context: unknown) => {
    this.commit.set({ ...idle, status: 'saved', saved: [`Main agent ${tier} model`] });
    this.tiers.update((section) => ready({ ...(section.data as Tiers), [tier]: model || null }));
    return true;
  });
}

describe('tiersApply', () => {
  it('excludes native Claude auth, whose SDK keeps its own model defaults', () => {
    expect(tiersApply({ id: 'moonshot', authMode: 'apiKey' })).toBe(true);
    expect(tiersApply({ id: 'anthropic', authMode: 'apiKey' })).toBe(false);
    expect(tiersApply({ id: 'claude-cli', authMode: 'cli' })).toBe(false);
  });
});

describe('ModelsTiersTabComponent', () => {
  let fixture: ComponentFixture<ModelsTiersTabComponent>;
  let element: HTMLElement;
  let state: StateStub;

  beforeEach(() => {
    state = new StateStub();
    TestBed.configureTestingModule({
      imports: [ModelsTiersTabComponent],
      providers: [
        { provide: ProvidersSettingsStateService, useValue: state },
        SettingsSaveFeedbackService,
        { provide: PROVIDER_MODELS_LOADER, useValue: { listModels: jest.fn().mockResolvedValue({ totalCount: 2, models: [
          { id: 'kimi-k2.5', name: 'Kimi K2.5', supportsToolUse: true }, { id: 'kimi-fast', name: 'Kimi Fast', supportsToolUse: false },
        ] }) } },
      ],
    });
    fixture = TestBed.createComponent(ModelsTiersTabComponent);
    element = fixture.nativeElement as HTMLElement;
  });
  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); jest.useRealTimers(); });

  const query = <T extends HTMLElement = HTMLElement>(id: string) => element.querySelector<T>(`[data-testid="${id}"]`);
  function render(value: ProvidersConnection = connection()) {
    fixture.componentRef.setInput('connection', value);
    fixture.detectChanges();
  }
  function picker(tier: string): ProviderModelPickerComponent {
    return fixture.debugElement.query(By.css(`[data-tier="${tier}"] ptah-provider-model-picker`)).componentInstance as ProviderModelPickerComponent;
  }
  /** Microtasks only: `whenStable` would wait out the toast's 8 s auto-dismiss timer. */
  async function flush() { for (let i = 0; i < 10; i += 1) await Promise.resolve(); fixture.detectChanges(); }

  it('reads this connection\'s main-agent tiers, with a busy skeleton until they load', () => {
    render();
    expect(state.refreshTiers).toHaveBeenCalledWith({ providerId: 'moonshot', scope: 'mainAgent' });
    expect(query('models-skeleton')?.getAttribute('aria-busy')).toBe('true');
    state.tiers.set(ready({ sonnet: 'kimi-k2.5', opus: null, haiku: null }));
    fixture.detectChanges();
    expect(query('models-skeleton')).toBeNull();
    expect(query('models-current-sonnet')?.textContent).toContain('kimi-k2.5');
    expect(query('models-current-opus')?.textContent).toContain('Provider default');
  });

  it('a failed read offers Retry instead of an empty mapping', () => {
    render();
    state.tiers.set({ status: 'error', data: null, error: 'Could not load this section. Retry.' });
    fixture.detectChanges();
    expect(query('models-error')?.getAttribute('role')).toBe('alert');
    query('models-error')?.querySelector('button')?.click();
    expect(state.refreshTiers).toHaveBeenCalledTimes(2);
  });

  it('renders one searchable picker per tier, pinned to this connection (#34, #35, #38)', () => {
    render();
    state.tiers.set(ready({ sonnet: 'kimi-k2.5', opus: null, haiku: null }));
    fixture.detectChanges();
    for (const tier of ['sonnet', 'opus', 'haiku']) {
      expect(picker(tier).searchable()).toBe(true);
      expect(picker(tier).fixedProvider()).toBe('moonshot');
      expect(picker(tier).defaultTier()).toBe(tier);
    }
    expect(picker('sonnet').model()).toBe('kimi-k2.5');
  });

  it('native Claude auth shows a note and reads no tiers', () => {
    render(connection({ id: 'claude-cli', name: 'Claude (Subscription)', authMode: 'cli', hasKey: false }));
    expect(query('models-native-note')).not.toBeNull();
    expect(element.querySelector('ptah-provider-model-picker')).toBeNull();
    expect(state.refreshTiers).not.toHaveBeenCalled();
  });

  describe('save on selection with Undo (D2)', () => {
    beforeEach(() => {
      render();
      state.tiers.set(ready({ sonnet: null, opus: 'kimi-k2.5', haiku: null }));
      fixture.detectChanges();
    });

    it('a selection saves through setMainAgentTier; Undo is a second real write of the previous value', async () => {
      picker('opus').selectionChange.emit({ provider: 'moonshot', model: 'kimi-fast' });
      await flush();
      expect(state.setMainAgentTier).toHaveBeenCalledWith('moonshot', 'opus', 'kimi-fast', CONTEXT);
      expect(query('settings-toast-inline')?.getAttribute('role')).toBe('status');
      expect(query('settings-toast-inline')?.textContent).toContain('Saved Moonshot (Kimi) opus tier model to All Ptah apps.');
      query('settings-toast-inline-undo')?.click();
      await flush();
      expect(state.setMainAgentTier).toHaveBeenLastCalledWith('moonshot', 'opus', 'kimi-k2.5', CONTEXT);
      expect(state.setMainAgentTier).toHaveBeenCalledTimes(2);
      expect(query('settings-toast-inline-undo')).toBeNull();
    });

    it('Default clears the tier (an empty model) and Undo restores it', async () => {
      query('models-default-opus')?.click();
      await flush();
      expect(state.setMainAgentTier).toHaveBeenCalledWith('moonshot', 'opus', '', CONTEXT);
      expect(query('models-current-opus')?.textContent).toContain('Provider default');
      query('settings-toast-inline-undo')?.click();
      await flush();
      expect(state.setMainAgentTier).toHaveBeenLastCalledWith('moonshot', 'opus', 'kimi-k2.5', CONTEXT);
    });

    it('re-selecting the stored model writes nothing', async () => {
      picker('opus').selectionChange.emit({ provider: 'moonshot', model: 'kimi-k2.5' });
      await flush();
      expect(state.setMainAgentTier).not.toHaveBeenCalled();
    });

    it('a failed write is never reported as saved and offers no Undo (D15)', async () => {
      state.setMainAgentTier.mockImplementationOnce(async () => {
        state.commit.set({ ...idle, status: 'failed', unsaved: ['Main agent opus model'], message: 'Main agent opus model was not saved.' });
        return true;
      });
      picker('opus').selectionChange.emit({ provider: 'moonshot', model: 'kimi-fast' });
      await flush();
      expect(query('settings-toast-inline')?.getAttribute('role')).toBe('alert');
      expect(query('settings-toast-inline')?.textContent).toContain('Could not save');
      expect(query('settings-toast-inline')?.textContent).not.toContain('Saved');
      expect(query('settings-toast-inline-undo')).toBeNull();
    });

    it('pickers and Default are disabled while a save runs or the edit context is not loaded (D3)', () => {
      state.commit.set({ ...idle, status: 'saving' });
      fixture.detectChanges();
      expect(picker('opus').disabled()).toBe(true);
      expect(isDisabledControl(query<HTMLButtonElement>('models-default-opus'))).toBe(true);
      state.commit.set(idle);
      state.context.set(null);
      fixture.detectChanges();
      expect(picker('opus').disabled()).toBe(true);
    });
  });
});
