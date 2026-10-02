import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ClaudeRpcService,
  ProvidersSettingsStateService,
  RpcResult,
  VSCodeService,
} from '@ptah-extension/core';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { WebSearchConfigComponent } from './web-search-config.component';

/** Renders the trigger always and the content only while open, like the real popover. */
@Component({
  selector: 'ptah-native-popover',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content select="[trigger]" />
    @if (isOpen()) {
      <ng-content select="[content]" />
    }`,
})
class NativePopoverStub {
  readonly isOpen = input.required<boolean>();
  readonly closed = output<void>();
}

type Responder = () => RpcResult<unknown> | Promise<RpcResult<unknown>>;

const ok = <T>(data: T) => new RpcResult<T>(true, data);
const fail = (message: string) => new RpcResult<unknown>(false, undefined, message);

/** TASK_2026_555 Batch 45 — Web search matrix (pattern map V1-V8). */
describe('WebSearchConfigComponent', () => {
  let fixture: ComponentFixture<WebSearchConfigComponent>;
  let component: WebSearchConfigComponent;
  let feedback: SettingsSaveFeedbackService;
  let element: HTMLElement;
  let responses: Record<string, Responder>;
  const call = jest.fn();

  beforeEach(() => {
    responses = {
      'webSearch:getConfig': () => ok({ providers: ['tavily'], maxResults: 5 }),
      'webSearch:getApiKeyStatus': () => ok({ configured: false }),
      'webSearch:setConfig': () => ok({ success: true }),
      'webSearch:setApiKey': () => ok({ success: true }),
      'webSearch:deleteApiKey': () => ok({ success: true }),
      'webSearch:test': () => ok({ success: true, results: [] }),
    };
    call.mockReset();
    call.mockImplementation(async (method: string) => {
      const respond = responses[method];
      if (!respond) throw new Error(`unexpected RPC ${method}`);
      return respond();
    });
  });

  afterEach(() => {
    feedback?.dismiss();
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  /** Flushes pending RPC promises. Not `whenStable()`: the toast's 8 s timer would hold it open. */
  async function settle(): Promise<void> {
    for (let pass = 0; pass < 3; pass += 1) {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
      fixture.detectChanges();
    }
  }

  async function render(): Promise<void> {
    TestBed.configureTestingModule({
      imports: [WebSearchConfigComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: ProvidersSettingsStateService, useValue: { commit: signal({ status: 'idle' }) } },
        { provide: VSCodeService, useValue: { isElectron: false, config: signal({}) } },
        SettingsSaveFeedbackService,
      ],
    }).overrideComponent(WebSearchConfigComponent, {
      remove: { imports: [NativePopoverComponent] },
      add: { imports: [NativePopoverStub] },
    });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(WebSearchConfigComponent);
    component = fixture.componentInstance;
    element = fixture.nativeElement as HTMLElement;
    feedback = TestBed.inject(SettingsSaveFeedbackService);
    fixture.detectChanges();
    await fixture.whenStable();
    await settle();
  }

  const byTestId = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const el = element.querySelector<T>(`[data-testid="${id}"]`);
    if (!el) throw new Error(`missing [data-testid="${id}"]`);
    return el;
  };
  const queryTestId = (id: string) => element.querySelector(`[data-testid="${id}"]`);
  const checkbox = (id: string) => byTestId<HTMLInputElement>(`settings-toggle-web-search-provider-${id}`);
  const calls = (method: string) => call.mock.calls.filter(([m]) => m === method).map(([, params]) => params);

  async function typeKey(provider: string, value: string): Promise<void> {
    byTestId<HTMLButtonElement>(`settings-web-search-key-btn-${provider}`).click();
    await settle();
    const field = byTestId<HTMLInputElement>('settings-web-search-key-input');
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  async function moveSlider(value: number): Promise<HTMLInputElement> {
    const slider = byTestId<HTMLInputElement>('settings-web-search-max-results');
    slider.value = String(value);
    slider.dispatchEvent(new Event('change'));
    await settle();
    return slider;
  }

  it('loads config and every key status, and keeps the harness selectors', async () => {
    responses['webSearch:getApiKeyStatus'] = () => ok({ configured: true });
    await render();

    expect(calls('webSearch:getApiKeyStatus')).toEqual([
      { provider: 'tavily' }, { provider: 'serper' }, { provider: 'exa' },
    ]);
    expect(element.querySelector('table.table.table-xs')).not.toBeNull();
    for (const id of ['tavily', 'serper', 'exa']) {
      expect(checkbox(id).type).toBe('checkbox');
      expect(byTestId(`settings-web-search-key-status-${id}`).textContent).toContain('Key set');
    }
    expect(checkbox('tavily').checked).toBe(true);
    expect(checkbox('serper').checked).toBe(false);
    expect(component.maxResults()).toBe(5);
  });

  it('shows a load failure as an inline alert with base-content text (V8)', async () => {
    responses['webSearch:getConfig'] = () => fail('Could not read config');
    await render();

    const alert = byTestId('settings-web-search-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent?.trim()).toBe('Could not load the web search settings.');
    expect(alert.classList).toContain('text-base-content');
  });

  it('keeps the free-tier copy and signup links (V3)', async () => {
    await render();
    expect(element.textContent).toContain('Free tier: 2,500 searches/month.');
    expect(byTestId<HTMLAnchorElement>('settings-web-search-signup-exa').href).toBe('https://exa.ai/');
  });

  it('keeps each provider row to one name line and one free-tier line (map §3.2 density, Batch 50)', async () => {
    responses['webSearch:getApiKeyStatus'] = () => ok({ configured: true });
    await render();
    const providerCell = byTestId('settings-web-search-signup-serper').closest('td') as HTMLElement;
    expect(providerCell.getAttribute('title')).toBe('Google Search API. Fast, reliable results. Free tier: 2,500 searches/month.');
    expect(providerCell.querySelector('.sr-only')?.textContent).toContain('Google Search API. Fast, reliable results.');
    const line = byTestId('settings-web-search-signup-serper').parentElement as HTMLElement;
    expect(line.classList).toContain('whitespace-nowrap');
    expect(line.textContent?.replace(/\s+/g, ' ').trim()).toBe('Free tier: 2,500 searches/month. Get API key');
    // D3: the free-tier line is 12 px (text-xs, 16 px line) so the row stays at about 42 px, within 48.
    expect(line.classList).toContain('text-xs');
    expect(line.classList).not.toContain('text-[10px]');
    // Update key and Clear share one non-wrapping row; the confirm opens below it.
    const actions = byTestId('settings-web-search-clear-btn-serper').parentElement as HTMLElement;
    expect(actions.classList).toContain('flex-nowrap');
    expect(actions.contains(byTestId('settings-web-search-key-btn-serper'))).toBe(true);
  });

  it('underlines the Get API key links persistently, not only on hover (D3, WCAG 1.4.1)', async () => {
    await render();
    for (const id of ['tavily', 'serper', 'exa']) {
      const link = byTestId<HTMLAnchorElement>(`settings-web-search-signup-${id}`);
      expect(link.classList).toContain('underline');
      expect(link.classList).toContain('text-base-content');
      expect(link.classList).not.toContain('link-hover');
    }
  });

  it('sets the selection note and the "per search" label at 12 px like the free-tier line (Gate V 50)', async () => {
    await render();
    const note = Array.from(element.querySelectorAll('p')).find(
      (p) => p.textContent?.trim() === 'At least one provider must stay selected.',
    );
    const perSearch = Array.from(element.querySelectorAll('span')).find((span) => span.textContent?.trim() === 'per search');
    expect(note?.classList).toContain('text-xs');
    expect(perSearch?.classList).toContain('text-xs');
    expect(note?.classList).not.toContain('text-[10px]');
    expect(perSearch?.classList).not.toContain('text-[10px]');
  });

  it('gives the Max results slider the shared focus-visible outline (M2, WCAG 2.4.7)', async () => {
    await render();
    const slider = byTestId<HTMLInputElement>('settings-web-search-max-results');
    for (const cls of ['focus-visible:outline', 'focus-visible:outline-2', 'focus-visible:outline-offset-2', 'focus-visible:outline-base-content']) {
      expect(slider.classList).toContain(cls);
    }
  });

  describe('provider selection (V1)', () => {
    it('saves on selection, toasts only after the write, and Undo writes the previous list', async () => {
      await render();
      checkbox('serper').click();
      await settle();

      expect(calls('webSearch:setConfig')).toEqual([{ providers: ['tavily', 'serper'] }]);
      expect(checkbox('serper').checked).toBe(true);
      expect(feedback.toast()).toEqual({ tone: 'status', message: 'Saved web search providers.', canUndo: true });

      await feedback.undo();
      await settle();
      expect(calls('webSearch:setConfig')).toEqual([{ providers: ['tavily', 'serper'] }, { providers: ['tavily'] }]);
      expect(checkbox('serper').checked).toBe(false);
    });

    it('reverts the checkbox and raises an alert toast when the write fails (D15)', async () => {
      responses['webSearch:setConfig'] = () => fail('Server rejected providers');
      await render();
      checkbox('serper').click();
      await settle();

      expect(checkbox('serper').checked).toBe(false);
      expect(component.isSelected('serper')).toBe(false);
      expect(feedback.toast()).toEqual({ tone: 'alert', message: 'Could not save the web search providers.', canUndo: false });
      expect(byTestId('settings-web-search-error').textContent?.trim()).toBe('Could not save the web search providers.');
    });

    it('treats success:false from the host as a failed write', async () => {
      responses['webSearch:setConfig'] = () => ok({ success: false });
      await render();
      checkbox('exa').click();
      await settle();

      expect(checkbox('exa').checked).toBe(false);
      expect(feedback.toast()?.tone).toBe('alert');
    });

    it('refuses to deselect the last provider and leaves the checkbox ticked', async () => {
      await render();
      checkbox('tavily').click();
      await settle();

      expect(calls('webSearch:setConfig')).toEqual([]);
      expect(checkbox('tavily').checked).toBe(true);
      expect(component.errorMessage()).toBe('At least one provider must stay selected.');
    });

    it('disables the provider checkboxes while a save is in flight (D3)', async () => {
      let finish: () => void = () => undefined;
      responses['webSearch:setConfig'] = () => new Promise((resolve) => { finish = () => resolve(ok({ success: true })); });
      await render();
      checkbox('serper').click();
      fixture.detectChanges();

      expect(checkbox('exa').disabled).toBe(true);
      finish();
      await settle();
      expect(checkbox('exa').disabled).toBe(false);
    });
  });

  describe('API key popover (V4, G11)', () => {
    it('saves on explicit Save, closes, marks the key set and clears the test result', async () => {
      await render();
      component.testResult.set({ success: true, results: [{ provider: 'serper', success: true }] });
      await typeKey('serper', 'secret-key');
      byTestId<HTMLButtonElement>('settings-web-search-key-save').click();
      await settle();

      expect(calls('webSearch:setApiKey')).toEqual([{ provider: 'serper', apiKey: 'secret-key' }]);
      expect(calls('webSearch:test')).toEqual([]);
      expect(component.activeKeyProvider()).toBeNull();
      expect(component.apiKeyInput()).toBe('');
      expect(component.testResult()).toBeNull();
      expect(byTestId('settings-web-search-key-status-serper').textContent).toContain('Key set');
      expect(feedback.toast()).toEqual({ tone: 'status', message: 'Saved Serper API key.', canUndo: false });
    });

    it('never renders the key as text and toggles its visibility on request', async () => {
      await render();
      await typeKey('tavily', 'secret-key');

      const field = byTestId<HTMLInputElement>('settings-web-search-key-input');
      expect(field.type).toBe('password');
      expect(element.textContent).not.toContain('secret-key');
      byTestId<HTMLButtonElement>('settings-web-search-key-visibility').click();
      fixture.detectChanges();
      expect(field.type).toBe('text');
    });

    it('drops the typed key when the popover is dismissed', async () => {
      await render();
      await typeKey('serper', 'secret-key');
      byTestId<HTMLButtonElement>('settings-web-search-key-cancel').click();
      await settle();

      expect(component.activeKeyProvider()).toBeNull();
      expect(component.apiKeyInput()).toBe('');
      expect(queryTestId('settings-web-search-key-input')).toBeNull();
    });

    it('keeps the popover open with the reason and an alert toast when saving fails (D15)', async () => {
      responses['webSearch:setApiKey'] = () => fail('Invalid key');
      await render();
      await typeKey('serper', 'bad-key');
      byTestId<HTMLButtonElement>('settings-web-search-key-save').click();
      await settle();

      expect(component.activeKeyProvider()).toBe('serper');
      expect(byTestId('settings-web-search-key-error').textContent?.trim()).toBe('Could not save the Serper API key.');
      expect(byTestId('settings-web-search-key-status-serper').textContent).toContain('No key');
      expect(feedback.toast()).toEqual({ tone: 'alert', message: 'Could not save the Serper API key.', canUndo: false });
    });
  });

  describe('Clear key (V5)', () => {
    beforeEach(() => {
      responses['webSearch:getApiKeyStatus'] = () => ok({ configured: true });
    });

    it('asks first, focuses Cancel, and Cancel writes nothing', async () => {
      await render();
      const clear = byTestId<HTMLButtonElement>('settings-web-search-clear-btn-tavily');
      // Gate V 50 decision: the resting Clear is neutral; red only on the confirm button (P8).
      expect(clear.classList).not.toContain('border-error');
      expect(clear.classList).toContain('btn-outline');
      expect(clear.classList).toContain('btn-xs');
      expect(clear.classList).toContain('text-base-content');
      expect(clear.getAttribute('aria-label')).toBe('Clear API key for Tavily');
      clear.click();
      await settle();

      expect(byTestId('settings-web-search-clear-group-tavily').getAttribute('role')).toBe('group');
      expect(byTestId('settings-web-search-clear-confirm-tavily').classList).toContain('border-error');
      expect(document.activeElement).toBe(byTestId('settings-web-search-clear-cancel-tavily'));
      byTestId<HTMLButtonElement>('settings-web-search-clear-cancel-tavily').click();
      await settle();

      expect(queryTestId('settings-web-search-clear-group-tavily')).toBeNull();
      expect(calls('webSearch:deleteApiKey')).toEqual([]);
      expect(document.activeElement).toBe(clear);
    });

    it('Esc closes the confirm and returns focus to Clear (P8)', async () => {
      await render();
      const clear = byTestId<HTMLButtonElement>('settings-web-search-clear-btn-tavily');
      clear.click();
      await settle();
      byTestId('settings-web-search-clear-group-tavily').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await settle();

      expect(queryTestId('settings-web-search-clear-group-tavily')).toBeNull();
      expect(document.activeElement).toBe(clear);
      expect(calls('webSearch:deleteApiKey')).toEqual([]);
    });

    it('clears on confirm with no Undo', async () => {
      await render();
      byTestId<HTMLButtonElement>('settings-web-search-clear-btn-tavily').click();
      await settle();
      byTestId<HTMLButtonElement>('settings-web-search-clear-confirm-tavily').click();
      await settle();

      expect(calls('webSearch:deleteApiKey')).toEqual([{ provider: 'tavily' }]);
      expect(byTestId('settings-web-search-key-status-tavily').textContent).toContain('No key');
      expect(feedback.toast()).toEqual({
        tone: 'status', message: 'Saved removal of the Tavily API key.', canUndo: false,
      });
    });

    it('reports a failed clear instead of skipping it silently (D15)', async () => {
      responses['webSearch:deleteApiKey'] = () => fail('Could not delete key');
      await render();
      byTestId<HTMLButtonElement>('settings-web-search-clear-btn-tavily').click();
      await settle();
      byTestId<HTMLButtonElement>('settings-web-search-clear-confirm-tavily').click();
      await settle();

      expect(byTestId('settings-web-search-key-status-tavily').textContent).toContain('Key set');
      expect(byTestId('settings-web-search-clear-error-tavily').textContent?.trim()).toBe('Could not clear the Tavily API key.');
      expect(feedback.toast()).toEqual({ tone: 'alert', message: 'Could not clear the Tavily API key.', canUndo: false });
    });

    it('shows a failed clear inside the open confirm group as an alert, and a retry or Cancel drops it (FM-5)', async () => {
      responses['webSearch:deleteApiKey'] = () => fail('Could not delete key');
      await render();
      byTestId<HTMLButtonElement>('settings-web-search-clear-btn-tavily').click();
      await settle();
      byTestId<HTMLButtonElement>('settings-web-search-clear-confirm-tavily').click();
      await settle();

      const group = byTestId('settings-web-search-clear-group-tavily');
      const error = byTestId('settings-web-search-clear-error-tavily');
      expect(group.contains(error)).toBe(true);
      expect(error.getAttribute('role')).toBe('alert');
      expect(error.classList).toContain('text-base-content');
      expect(queryTestId('settings-web-search-error')).toBeNull();

      byTestId<HTMLButtonElement>('settings-web-search-clear-cancel-tavily').click();
      await settle();
      byTestId<HTMLButtonElement>('settings-web-search-clear-btn-tavily').click();
      await settle();
      expect(queryTestId('settings-web-search-clear-error-tavily')).toBeNull();
    });

    it('stops the Esc keydown at the confirm, so an enclosing overlay does not also close', async () => {
      await render();
      const outer = jest.fn();
      document.body.addEventListener('keydown', outer);
      try {
        byTestId<HTMLButtonElement>('settings-web-search-clear-btn-tavily').click();
        await settle();
        byTestId('settings-web-search-clear-group-tavily').dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await settle();
        expect(queryTestId('settings-web-search-clear-group-tavily')).toBeNull();
        expect(outer).not.toHaveBeenCalled();
      } finally {
        document.body.removeEventListener('keydown', outer);
      }
    });
  });

  describe('Test connection (V6)', () => {
    it('shows each provider result in its Status cell with colour only on the icon', async () => {
      responses['webSearch:test'] = () => ok({
        success: false,
        results: [
          { provider: 'tavily', success: true },
          { provider: 'serper', success: false, error: 'Unauthorized' },
        ],
      });
      await render();
      byTestId<HTMLButtonElement>('settings-web-search-test').click();
      await settle();

      const tavily = byTestId('settings-web-search-status-tavily');
      const serper = byTestId('settings-web-search-status-serper');
      expect(tavily.textContent).toContain('Works');
      expect(serper.textContent).toContain('The connection check failed.');
      expect(serper.textContent).not.toContain('Unauthorized');
      expect(byTestId('settings-web-search-status-exa').textContent).toContain('Not tested');
      for (const cell of [tavily, serper]) {
        expect(cell.querySelector('.badge')?.classList).toContain('text-base-content');
        expect(cell.innerHTML).not.toMatch(/badge[^"]*text-(success|error)/);
      }
    });
  });

  describe('Max results (V7)', () => {
    it('saves on release and Undo writes the previous value', async () => {
      await render();
      await moveSlider(10);

      expect(calls('webSearch:setConfig')).toEqual([{ maxResults: 10 }]);
      expect(feedback.toast()).toEqual({ tone: 'status', message: 'Saved web search max results.', canUndo: true });

      await feedback.undo();
      await settle();
      expect(calls('webSearch:setConfig')).toEqual([{ maxResults: 10 }, { maxResults: 5 }]);
      expect(component.maxResults()).toBe(5);
    });

    it('puts the slider back and raises an alert toast when the write fails (D15)', async () => {
      responses['webSearch:setConfig'] = () => fail('Could not save max results');
      await render();
      const slider = await moveSlider(10);

      expect(component.maxResults()).toBe(5);
      expect(slider.value).toBe('5');
      expect(feedback.toast()).toEqual({ tone: 'alert', message: 'Could not save the web search max results.', canUndo: false });
    });
  });
  /** Host-text guard (F1): an RPC failure, `{ success:false, error }` and a thrown Error never reach the UI. */
  describe('fixed failure sentences (F1)', () => {
    const HOST_FAILURES: ReadonlyArray<[string, Responder]> = [
      ['an RPC failure', () => fail('host detail')],
      ['a { success:false, error } answer', () => ok({ success: false, error: 'host detail' })],
      ['a thrown Error', () => { throw new Error('host detail'); }],
    ];
    const visibleText = () => `${element.textContent ?? ''} ${feedback.toast()?.message ?? ''}`;

    it.each(HOST_FAILURES)('config load fails with %s', async (_case, respond) => {
      responses['webSearch:getConfig'] = respond;
      await render();
      expect(byTestId('settings-web-search-error').textContent?.trim()).toBe('Could not load the web search settings.');
      expect(visibleText()).not.toContain('host detail');
    });

    it.each(HOST_FAILURES)('provider save fails with %s', async (_case, respond) => {
      responses['webSearch:setConfig'] = respond;
      await render();
      checkbox('serper').click();
      await settle();
      expect(byTestId('settings-web-search-error').textContent?.trim()).toBe('Could not save the web search providers.');
      expect(feedback.toast()?.message).toBe('Could not save the web search providers.');
      expect(visibleText()).not.toContain('host detail');
    });

    it.each(HOST_FAILURES)('max results save fails with %s', async (_case, respond) => {
      responses['webSearch:setConfig'] = respond;
      await render();
      await moveSlider(10);
      expect(byTestId('settings-web-search-error').textContent?.trim()).toBe('Could not save the web search max results.');
      expect(feedback.toast()?.message).toBe('Could not save the web search max results.');
      expect(visibleText()).not.toContain('host detail');
    });

    it.each(HOST_FAILURES)('key save fails with %s', async (_case, respond) => {
      responses['webSearch:setApiKey'] = respond;
      await render();
      await typeKey('exa', 'some-key');
      byTestId<HTMLButtonElement>('settings-web-search-key-save').click();
      await settle();
      expect(byTestId('settings-web-search-key-error').textContent?.trim()).toBe('Could not save the Exa API key.');
      expect(feedback.toast()?.message).toBe('Could not save the Exa API key.');
      expect(visibleText()).not.toContain('host detail');
    });

    it.each(HOST_FAILURES)('key clear fails with %s', async (_case, respond) => {
      responses['webSearch:getApiKeyStatus'] = () => ok({ configured: true });
      responses['webSearch:deleteApiKey'] = respond;
      await render();
      byTestId<HTMLButtonElement>('settings-web-search-clear-btn-tavily').click();
      await settle();
      byTestId<HTMLButtonElement>('settings-web-search-clear-confirm-tavily').click();
      await settle();
      expect(byTestId('settings-web-search-clear-error-tavily').textContent?.trim()).toBe('Could not clear the Tavily API key.');
      expect(feedback.toast()?.message).toBe('Could not clear the Tavily API key.');
      expect(visibleText()).not.toContain('host detail');
    });

    it.each([
      ['an RPC failure', () => fail('host detail')],
      ['a thrown Error', () => { throw new Error('host detail'); }],
    ] as ReadonlyArray<[string, Responder]>)('connection check fails with %s', async (_case, respond) => {
      responses['webSearch:test'] = respond;
      await render();
      byTestId<HTMLButtonElement>('settings-web-search-test').click();
      await settle();
      expect(byTestId('settings-web-search-error').textContent?.trim()).toBe('The connection check failed.');
      expect(visibleText()).not.toContain('host detail');
    });

    it('a failed provider row shows the fixed sentence, not the backend error', async () => {
      responses['webSearch:test'] = () => ok({
        success: false, results: [{ provider: 'tavily', success: false, error: 'host detail' }],
      });
      await render();
      byTestId<HTMLButtonElement>('settings-web-search-test').click();
      await settle();
      expect(byTestId('settings-web-search-status-tavily').textContent?.trim()).toBe('The connection check failed.');
      expect(visibleText()).not.toContain('host detail');
    });
  });

  it('uses no text size below 12 px anywhere in the component source (Batch 50b)', () => {
    const source = readFileSync(join(__dirname, 'web-search-config.component.ts'), 'utf8');
    expect(source.match(/text-\[(?:\d|1[01])(?:\.\d+)?px\]/g)).toBeNull();
  });
});
