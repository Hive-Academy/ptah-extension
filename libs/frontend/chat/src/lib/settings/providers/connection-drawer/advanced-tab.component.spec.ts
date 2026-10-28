import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ProvidersSettingsStateService, type ProvidersConnection, type ProvidersCustomEntry, type ProvidersSettingsCommit,
} from '@ptah-extension/core';
import type { AuthVerifyDraftConnectionParams, AuthVerifyDraftConnectionResult } from '@ptah-extension/shared';
import { AdvancedTabComponent, PRICING_NOTE, parsePricing } from './advanced-tab.component';
import { isDisabledControl } from '../../feedback/busy-disabled.testing';
import { SettingsSaveFeedbackService } from '../../feedback/settings-save-feedback.service';

const idle: ProvidersSettingsCommit = { status: 'idle', saved: [], unsaved: [], unconfirmed: [], refreshFailed: false, message: null };
const CONTEXT = { scopeKey: 'workspace', activePath: '/workspace' };
const SOVEREIGNEG = (): ProvidersConnection => ({
  id: 'sovereigneg', name: 'sovereigneg', authMode: 'apiKey', hasKey: true, configured: true, custom: true,
  defaultsResolvable: true, accountLabel: null, tokenStale: false,
});
const ENTRY: ProvidersCustomEntry = {
  id: 'sovereigneg', name: 'sovereigneg', baseUrl: 'https://gateway.example/v1', lane: 'openai',
  modelsEndpoint: '/v1/models', helpUrl: 'https://docs.example/ai', pricing: { inputPerMillion: 0.5, outputPerMillion: 1.5 },
};

class StateStub {
  readonly commit = signal<ProvidersSettingsCommit>(idle);
  readonly entry = signal<ProvidersCustomEntry | null>(ENTRY);
  readonly customEntry = jest.fn((_id: string) => this.entry());
  readonly reviewContext = jest.fn(() => CONTEXT);
  private readonly saved = async () => { this.commit.set({ ...idle, status: 'saved' }); return true; };
  readonly updateCustomEntryEndpoint = jest.fn(async (_id: string, _changes: unknown, _probeId: string, _context: unknown) => this.saved());
  readonly updateCustomEntryFields = jest.fn(async (_id: string, _changes: unknown, _context: unknown) => this.saved());
  readonly removeCustomEntry = jest.fn(async (_id: string, _context: unknown) => this.saved());
  readonly refreshConnectionSetup = jest.fn(async (_id: string) => undefined);
}

class ProbeHost {
  readonly calls: AuthVerifyDraftConnectionParams[] = [];
  private pending: ((value: AuthVerifyDraftConnectionResult) => void)[] = [];
  readonly verify = jest.fn((params: AuthVerifyDraftConnectionParams) => {
    this.calls.push(params);
    return new Promise<AuthVerifyDraftConnectionResult>((resolve) => this.pending.push(resolve));
  });
  readonly cancel = jest.fn(async () => ({ cancelled: true }));
  settle(overrides: Partial<AuthVerifyDraftConnectionResult> = {}) {
    const params = this.calls[this.calls.length - 1];
    this.pending.shift()?.({ probeId: params.probeId, outcome: 'verified', reason: null, detail: null, latencyMs: 42,
      modelUsed: null, checkedAt: '2026-09-30T10:00:00Z', ...overrides });
  }
}

describe('parsePricing', () => {
  it.each([
    ['0.5', '1.5', { ok: true, value: { inputPerMillion: 0.5, outputPerMillion: 1.5 } }],
    ['', '', { ok: true, value: null }],
    ['0', '0', { ok: true, value: { inputPerMillion: 0, outputPerMillion: 0 } }],
    ['1', '', { ok: false }],
    ['-1', '2', { ok: false }],
    ['abc', '2', { ok: false }],
  ])('%s / %s', (input, output, expected) => {
    expect(parsePricing(input, output)).toEqual(expected);
  });
});

describe('AdvancedTabComponent', () => {
  let fixture: ComponentFixture<AdvancedTabComponent>;
  let element: HTMLElement;
  let state: StateStub;
  let probe: ProbeHost;
  /** The page toast (`SettingsSaveFeedbackService.announce`): every outcome this tab says lands here. */
  let announce: jest.Mock<void, [string, 'status' | 'alert']>;
  const announced = () => announce.mock.calls.map(([message, tone]) => `${tone}: ${message}`);
  const last = () => announced().at(-1);

  beforeEach(() => {
    state = new StateStub();
    probe = new ProbeHost();
    announce = jest.fn();
    TestBed.configureTestingModule({
      imports: [AdvancedTabComponent],
      providers: [
        { provide: ProvidersSettingsStateService, useValue: state },
        { provide: SettingsSaveFeedbackService, useValue: { announce } },
      ],
    });
    fixture = TestBed.createComponent(AdvancedTabComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('verifyDraftConnection', probe.verify);
    fixture.componentRef.setInput('cancelDraftVerification', probe.cancel);
    fixture.componentRef.setInput('connection', SOVEREIGNEG());
    fixture.detectChanges();
  });
  afterEach(() => TestBed.resetTestingModule());

  const query = <T extends HTMLElement = HTMLElement>(id: string) => element.querySelector<T>(`[data-testid="${id}"]`);
  function type(id: string, value: string) {
    const input = query<HTMLInputElement>(id);
    if (!input) throw new Error(`No input ${id}`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
  async function flush() { for (let i = 0; i < 10; i += 1) await Promise.resolve(); fixture.detectChanges(); }
  /** Natively disabled, or busy-disabled (aria-disabled, still focusable; Batch 54.1). */
  const disabled = (id: string) => isDisabledControl(query<HTMLButtonElement>(id));

  it('shows the stored endpoint, help URL and pricing, with the pricing note verbatim', () => {
    expect(query<HTMLInputElement>('advanced-base-url')?.value).toBe('https://gateway.example/v1');
    expect(query<HTMLInputElement>('advanced-models-endpoint')?.value).toBe('/v1/models');
    expect(query<HTMLInputElement>('advanced-help-url')?.value).toBe('https://docs.example/ai');
    expect(query<HTMLInputElement>('advanced-price-input')?.value).toBe('0.5');
    expect(query('advanced-pricing-note')?.textContent?.trim()).toBe('Stored for your reference; Ptah does not use it for cost estimates yet.');
    expect(PRICING_NOTE).toBe('Stored for your reference; Ptah does not use it for cost estimates yet.');
  });

  it('shows a busy skeleton until the custom entry is loaded', () => {
    state.entry.set(null);
    fixture.componentRef.setInput('connection', SOVEREIGNEG());
    fixture.detectChanges();
    expect(query('advanced-skeleton')?.getAttribute('aria-busy')).toBe('true');
  });

  describe('endpoint (D7)', () => {
    it('a models endpoint alone is checked against the current address with the stored key, then saved', async () => {
      expect(disabled('advanced-check')).toBe(true);
      type('advanced-models-endpoint', '/v2/models');
      expect(disabled('advanced-save-endpoint')).toBe(true);
      query('advanced-check')?.click(); fixture.detectChanges();
      expect(probe.calls[0]).toMatchObject({ providerId: 'sovereigneg', authMode: 'custom', baseUrl: 'https://gateway.example/v1',
        credential: { kind: 'stored' } });
      probe.settle(); await flush();
      expect(last()).toBe('status: Endpoint verified (42ms). Save it to apply.');
      // The result gates Save endpoint, so it also stays inline after the toast clears.
      expect(query('advanced-probe')?.textContent?.trim()).toBe('Endpoint verified (42ms). Save it to apply.');
      query('advanced-save-endpoint')?.click(); await flush();
      expect(state.updateCustomEntryEndpoint).toHaveBeenCalledWith('sovereigneg', { modelsEndpoint: '/v2/models' }, probe.calls[0].probeId, CONTEXT);
      expect(last()).toBe('status: Endpoint saved.');
    });

    it('a changed base URL needs a typed key for its check; the key is for the check only', async () => {
      type('advanced-base-url', 'https://new.example/v1');
      expect(query('advanced-check-key')).not.toBeNull();
      expect(disabled('advanced-check')).toBe(true);
      type('advanced-check-key', 'sk-check');
      query('advanced-check')?.click(); fixture.detectChanges();
      expect(probe.calls[0]).toMatchObject({ baseUrl: 'https://new.example/v1', credential: { kind: 'apiKey', value: 'sk-check' } });
      probe.settle(); await flush();
      query('advanced-save-endpoint')?.click(); await flush();
      expect(state.updateCustomEntryEndpoint).toHaveBeenCalledWith('sovereigneg', { baseUrl: 'https://new.example/v1' }, probe.calls[0].probeId, CONTEXT);
      expect(JSON.stringify(state.updateCustomEntryEndpoint.mock.calls)).not.toContain('sk-check');
      // The Credentials tab's Replace check must use the new address, so the stored setup is re-read.
      expect(state.refreshConnectionSetup).toHaveBeenCalledWith('sovereigneg');
    });

    it('a saved models endpoint alone leaves the stored address read as it is', async () => {
      type('advanced-models-endpoint', '/v2/models');
      query('advanced-check')?.click(); fixture.detectChanges();
      probe.settle(); await flush();
      query('advanced-save-endpoint')?.click(); await flush();
      expect(last()).toBe('status: Endpoint saved.');
      expect(state.refreshConnectionSetup).not.toHaveBeenCalled();
    });

    it('a failed check keeps Save disabled, names the reason and latency, and saves nothing', async () => {
      type('advanced-models-endpoint', '/v2/models');
      query('advanced-check')?.click(); fixture.detectChanges();
      probe.settle({ outcome: 'failed', reason: 'unreachable', latencyMs: 3000, detail: 'raw host detail' });
      await flush();
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce.mock.calls[0][1]).toBe('alert');
      const text = announce.mock.calls[0][0];
      expect(text).toContain('Check failed (3000ms)');
      expect(text).toContain('Nothing was saved.');
      expect(text).not.toContain('raw host detail');
      expect(query('advanced-probe')?.textContent?.trim()).toBe(text);
      expect(disabled('advanced-save-endpoint')).toBe(true);
      expect(state.updateCustomEntryEndpoint).not.toHaveBeenCalled();
    });

    it('an edit after a pass needs a new check; an invalid URL cannot be checked', async () => {
      type('advanced-models-endpoint', '/v2/models');
      query('advanced-check')?.click(); fixture.detectChanges();
      probe.settle(); await flush();
      type('advanced-models-endpoint', '/v3/models');
      expect(disabled('advanced-save-endpoint')).toBe(true);
      type('advanced-base-url', 'ftp://nope');
      type('advanced-check-key', 'sk-check');
      expect(disabled('advanced-check')).toBe(true);
    });
  });

  it('help URL saves directly through updateCustomEntryFields; a non-http value cannot be saved', async () => {
    type('advanced-help-url', 'javascript:alert(1)');
    expect(disabled('advanced-save-help')).toBe(true);
    type('advanced-help-url', 'https://docs.example/new');
    query('advanced-save-help')?.click(); await flush();
    expect(state.updateCustomEntryFields).toHaveBeenCalledWith('sovereigneg', { helpUrl: 'https://docs.example/new' }, CONTEXT);
    expect(last()).toBe('status: Help URL saved.');
  });

  it('pricing saves both prices, clears with both empty, and refuses a half-filled pair', async () => {
    type('advanced-price-input', '2');
    type('advanced-price-output', '');
    expect(disabled('advanced-save-pricing')).toBe(true);
    type('advanced-price-output', '6');
    query('advanced-save-pricing')?.click(); await flush();
    expect(state.updateCustomEntryFields).toHaveBeenLastCalledWith('sovereigneg', { pricing: { inputPerMillion: 2, outputPerMillion: 6 } }, CONTEXT);
    type('advanced-price-input', '');
    type('advanced-price-output', '');
    query('advanced-save-pricing')?.click(); await flush();
    expect(state.updateCustomEntryFields).toHaveBeenLastCalledWith('sovereigneg', { pricing: null }, CONTEXT);
  });

  it('values render by interpolation only: markup in a stored help URL stays text', () => {
    state.entry.set({ ...ENTRY, helpUrl: '<img src=x onerror=alert(1)>' });
    fixture.componentRef.setInput('connection', SOVEREIGNEG());
    fixture.detectChanges();
    expect(element.querySelector('img')).toBeNull();
    expect(query<HTMLInputElement>('advanced-help-url')?.value).toBe('<img src=x onerror=alert(1)>');
  });

  describe('delete connection (#25)', () => {
    it('is blocked for the main agent\'s driver with "Switch the main agent first."', () => {
      fixture.componentRef.setInput('isDriver', true);
      fixture.detectChanges();
      expect(query('advanced-delete-blocked')?.textContent?.trim()).toBe('Switch the main agent first.');
      expect(disabled('advanced-delete')).toBe(true);
    });

    it('asks inline, then removes the entry through removeCustomEntry', async () => {
      query('advanced-delete')?.click(); fixture.detectChanges();
      expect(state.removeCustomEntry).not.toHaveBeenCalled();
      query('advanced-delete-confirm-button')?.click(); await flush();
      expect(state.removeCustomEntry).toHaveBeenCalledWith('sovereigneg', CONTEXT);
    });

    it('a host refusal (CONNECTION_IN_USE, final review M-5) on a connection the route did not mark as driver shows the same block', async () => {
      // The state maps the host code to this fixed block (providers-connection-setup.service); no host text reaches it.
      state.removeCustomEntry.mockImplementationOnce(async () => {
        state.commit.set({ ...idle, status: 'blocked', unsaved: ['Custom connection'], message: 'Switch the main agent first.' });
        return true;
      });
      expect(query('advanced-delete-blocked')).toBeNull();
      query('advanced-delete')?.click(); fixture.detectChanges();
      query('advanced-delete-confirm-button')?.click(); await flush();
      expect(announced()).toEqual(['alert: Not saved. Switch the main agent first.']);
      expect(query('advanced-commit')).toBeNull();
      // The connection is still shown, with its Delete action.
      expect(query('advanced-delete')).not.toBeNull();
    });

    it('a refused or failed write is never reported as done (D15)', async () => {
      state.removeCustomEntry.mockImplementationOnce(async () => {
        state.commit.set({ ...idle, status: 'blocked', unsaved: ['Custom connection'], message: 'Switch the main agent first.' });
        return true;
      });
      query('advanced-delete')?.click(); fixture.detectChanges();
      query('advanced-delete-confirm-button')?.click(); await flush();
      expect(last()).toBe('alert: Not saved. Switch the main agent first.');
      state.updateCustomEntryFields.mockImplementationOnce(async () => false);
      type('advanced-help-url', 'https://docs.example/other');
      query('advanced-save-help')?.click(); await flush();
      expect(last()).toContain('alert: Not saved. Another save is in progress');
    });
  });

  it('a write still running when another connection opens never shows its outcome there', async () => {
    let finish: (value: boolean) => void = () => undefined;
    state.updateCustomEntryFields.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    type('advanced-help-url', 'https://docs.example/new');
    query('advanced-save-help')?.click(); fixture.detectChanges();
    // No inline "Saving…": Save is disabled while it runs.
    expect(query('advanced-commit')).toBeNull();
    fixture.componentRef.setInput('connection', { ...SOVEREIGNEG(), id: 'other-gateway', name: 'other-gateway' });
    fixture.detectChanges();
    state.commit.set({ ...idle, status: 'saved' });
    finish(true); await flush();
    expect(announce).not.toHaveBeenCalled();
  });

  it('the check key is dropped on destroy and a running check is cancelled', () => {
    type('advanced-base-url', 'https://new.example/v1');
    type('advanced-check-key', 'sk-check');
    query('advanced-check')?.click(); fixture.detectChanges();
    const component = fixture.componentInstance as unknown as { keyDraft(): string };
    fixture.destroy();
    expect(component.keyDraft()).toBe('');
    expect(probe.cancel).toHaveBeenCalledWith({ probeId: probe.calls[0].probeId });
  });
});
