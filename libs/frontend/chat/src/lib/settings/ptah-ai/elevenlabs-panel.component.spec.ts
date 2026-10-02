import { signal } from '@angular/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ClaudeRpcService,
  ProvidersSettingsStateService,
  RpcResult,
  VSCodeService,
} from '@ptah-extension/core';
import {
  createMockRpcService,
  rpcError,
  rpcSuccess,
  type MockRpcService,
} from '@ptah-extension/core/testing';
import type { VoiceProviderConfigElevenLabsDto } from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';

import { ElevenLabsPanelComponent } from './elevenlabs-panel.component';
import type { ElevenLabsSelectKey } from './elevenlabs-select-rows';

function elConfig(
  overrides: Partial<VoiceProviderConfigElevenLabsDto> = {},
): VoiceProviderConfigElevenLabsDto {
  return {
    apiKeyConfigured: false,
    ttsModelId: 'eleven_multilingual_v2',
    outputFormat: 'mp3_44100_128',
    sttModelId: 'scribe_v1',
    ...overrides,
  };
}

const VOICES = () =>
  rpcSuccess({
    ok: true,
    voices: [
      { id: 'v1', label: 'Rachel' },
      { id: 'v2', label: 'Adam' },
    ],
  });

/** The three host-failure shapes an action can see (F1). */
const HOST_FAILURES: readonly [string, () => unknown][] = [
  ['an RPC error', () => rpcError('host detail')],
  ['a thrown Error', () => Promise.reject(new Error('secret host detail'))],
  ['an { ok:false } result', () => rpcSuccess({ ok: false, error: 'host detail' })],
];

describe('ElevenLabsPanelComponent', () => {
  let fixture: ComponentFixture<ElevenLabsPanelComponent>;
  let feedback: SettingsSaveFeedbackService;
  let element: HTMLElement;
  let rpc: MockRpcService;

  function routeRpc(routes: Record<string, () => unknown>): void {
    rpc.call.mockImplementation((method: string) => {
      const handler = routes[method];
      if (handler) return Promise.resolve(handler());
      return Promise.resolve(rpcSuccess({ ok: true, voices: [] }));
    });
  }

  function mount(
    direction: 'stt' | 'tts',
    config: VoiceProviderConfigElevenLabsDto,
  ): ElevenLabsPanelComponent {
    TestBed.configureTestingModule({
      imports: [ElevenLabsPanelComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: rpc },
        {
          provide: ProvidersSettingsStateService,
          useValue: { commit: signal({ status: 'idle' }) },
        },
        { provide: VSCodeService, useValue: { isElectron: true, config: signal({}) } },
        SettingsSaveFeedbackService,
      ],
    });
    fixture = TestBed.createComponent(ElevenLabsPanelComponent);
    feedback = TestBed.inject(SettingsSaveFeedbackService);
    element = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('direction', direction);
    fixture.componentRef.setInput('config', config);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  /** Flushes pending RPC promises (not `whenStable()`: the toast's 8 s timer holds it open). */
  async function settle(): Promise<void> {
    for (let pass = 0; pass < 3; pass += 1) {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
      fixture.detectChanges();
    }
  }

  function byTestId<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = element.querySelector<T>(`[data-testid="${id}"]`);
    if (!el) throw new Error(`missing [data-testid="${id}"]`);
    return el;
  }

  function calls(method: string): unknown[] {
    return rpc.call.mock.calls.filter(([m]) => m === method).map(([, p]) => p);
  }

  function typeKey(value: string): void {
    const input = byTestId<HTMLInputElement>('elevenlabs-key-input');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function choose(testId: string, value: string): void {
    const select = byTestId<HTMLSelectElement>(testId);
    select.value = value;
    select.dispatchEvent(new Event('change'));
  }

  function expectFixedAlert(sentence: string): void {
    const alert = byTestId('elevenlabs-panel-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent?.trim()).toBe(sentence);
    expect(element.textContent).not.toContain('host detail');
  }

  beforeEach(() => {
    rpc = createMockRpcService();
  });

  afterEach(() => {
    feedback?.dismiss();
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  it('never renders a key value — the input is masked and empty even when configured', async () => {
    routeRpc({ 'voice:listVoices': VOICES });
    mount('tts', elConfig({ apiKeyConfigured: true }));
    await settle();

    const input = byTestId<HTMLInputElement>('elevenlabs-key-input');
    expect(input.type).toBe('password');
    expect(input.value).toBe('');
    const badge = byTestId('elevenlabs-key-configured');
    expect(badge.textContent).toContain('Configured');
    expect(badge.classList).toContain('badge-outline');
    expect(badge.classList).toContain('text-base-content');
    expect(element.textContent).not.toMatch(/sk_[a-zA-Z0-9]/);
    expect(element.querySelector('table.table.table-xs')).not.toBeNull();
  });

  describe('verify-then-save (V21, G13)', () => {
    it('keeps Save disabled until the draft key passes the probe, then saves exactly that key', async () => {
      routeRpc({
        'voice:testConnection': () => rpcSuccess({ ok: true }),
        'voice:setApiKey': () => rpcSuccess({ ok: true }),
      });
      const component = mount('tts', elConfig());
      let emitted = 0;
      component.changed.subscribe(() => (emitted += 1));

      typeKey('  sk_draft_value  ');
      const save = byTestId<HTMLButtonElement>('elevenlabs-key-save');
      expect(save.disabled).toBe(true);
      expect(byTestId('elevenlabs-key-hint').textContent).toContain('Test the key first');

      byTestId<HTMLButtonElement>('elevenlabs-test-btn').click();
      await settle();

      expect(calls('voice:testConnection')).toEqual([
        { providerId: 'elevenlabs', apiKey: 'sk_draft_value' },
      ]);
      expect(byTestId('elevenlabs-test-result').textContent).toContain('Connection works.');
      expect(save.disabled).toBe(false);

      save.click();
      await settle();

      expect(calls('voice:setApiKey')).toEqual([
        { providerId: 'elevenlabs', apiKey: 'sk_draft_value' },
      ]);
      expect(feedback.toast()).toEqual({
        tone: 'status',
        message: 'Saved ElevenLabs API key.',
        canUndo: false,
      });
      expect(component.keyDraft()).toBe('');
      expect(byTestId<HTMLInputElement>('elevenlabs-key-input').value).toBe('');
      expect(emitted).toBe(1);
    });

    it('never saves the key on a failed probe and shows the category sentence, not host text', async () => {
      routeRpc({
        'voice:testConnection': () =>
          rpcSuccess({ ok: false, error: 'host detail', category: 'auth' }),
      });
      const component = mount('tts', elConfig());

      typeKey('sk_bad');
      byTestId<HTMLButtonElement>('elevenlabs-test-btn').click();
      await settle();

      const result = byTestId('elevenlabs-test-result');
      expect(result.textContent?.trim()).toBe('Authentication: ElevenLabs rejected the key.');
      expect(result.classList).toContain('text-base-content');
      expect(element.textContent).not.toContain('host detail');
      expect(byTestId<HTMLButtonElement>('elevenlabs-key-save').disabled).toBe(true);

      // Even a direct call cannot bypass the probe.
      await component.saveKey();
      expect(calls('voice:setApiKey')).toEqual([]);
    });

    it.each([
      ['quota', 'Quota: the ElevenLabs account is out of credits or rate-limited.'],
      ['network', 'Network: could not reach ElevenLabs.'],
      ['provider-error', 'Provider error: ElevenLabs could not complete the test.'],
    ])('maps the %s category to a fixed sentence (V22)', async (category, sentence) => {
      routeRpc({
        'voice:testConnection': () =>
          rpcSuccess({ ok: false, error: 'host detail', category }),
      });
      mount('tts', elConfig());

      typeKey('sk_x');
      byTestId<HTMLButtonElement>('elevenlabs-test-btn').click();
      await settle();

      expect(byTestId('elevenlabs-test-result').textContent?.trim()).toBe(sentence);
      expect(element.textContent).not.toContain('host detail');
    });

    it.each(HOST_FAILURES)(
      'shows a fixed sentence when the probe fails with %s, and Save stays off (F1)',
      async (_shape, failure) => {
        routeRpc({ 'voice:testConnection': failure });
        mount('tts', elConfig());

        typeKey('sk_x');
        byTestId<HTMLButtonElement>('elevenlabs-test-btn').click();
        await settle();

        expect(byTestId('elevenlabs-test-result').textContent?.trim()).toBe(
          'The connection test failed.',
        );
        expect(element.textContent).not.toContain('host detail');
        expect(byTestId<HTMLButtonElement>('elevenlabs-key-save').disabled).toBe(true);
      },
    );

    it('re-locks Save when the draft changes after a passing probe', async () => {
      routeRpc({ 'voice:testConnection': () => rpcSuccess({ ok: true }) });
      mount('tts', elConfig());

      typeKey('sk_one');
      byTestId<HTMLButtonElement>('elevenlabs-test-btn').click();
      await settle();
      expect(byTestId<HTMLButtonElement>('elevenlabs-key-save').disabled).toBe(false);

      typeKey('sk_two');
      expect(byTestId<HTMLButtonElement>('elevenlabs-key-save').disabled).toBe(true);
      expect(element.querySelector('[data-testid="elevenlabs-test-result"]')).toBeNull();
    });

    it('drops a probe result that arrives after the draft changed', async () => {
      let resolveProbe!: (result: RpcResult<{ ok: boolean }>) => void;
      rpc.call.mockImplementation((method: string) =>
        method === 'voice:testConnection'
          ? new Promise<RpcResult<{ ok: boolean }>>((resolve) => (resolveProbe = resolve))
          : Promise.resolve(rpcSuccess({ ok: true, voices: [] })),
      );
      mount('tts', elConfig());

      typeKey('sk_one');
      byTestId<HTMLButtonElement>('elevenlabs-test-btn').click();
      typeKey('sk_two');
      resolveProbe(rpcSuccess({ ok: true }));
      await settle();

      expect(element.querySelector('[data-testid="elevenlabs-test-result"]')).toBeNull();
      expect(byTestId<HTMLButtonElement>('elevenlabs-key-save').disabled).toBe(true);
    });

    it('tests the stored key when no draft is typed, without enabling Save', async () => {
      routeRpc({
        'voice:listVoices': VOICES,
        'voice:testConnection': () => rpcSuccess({ ok: true }),
      });
      mount('tts', elConfig({ apiKeyConfigured: true }));
      await settle();

      byTestId<HTMLButtonElement>('elevenlabs-test-btn').click();
      await settle();

      expect(calls('voice:testConnection')).toEqual([{ providerId: 'elevenlabs' }]);
      expect(byTestId('elevenlabs-test-result').textContent).toContain('Connection works.');
      expect(byTestId<HTMLButtonElement>('elevenlabs-key-save').disabled).toBe(true);
    });

    it.each(HOST_FAILURES)(
      'shows a fixed sentence and keeps the draft when the key save fails with %s (F1)',
      async (_shape, failure) => {
        routeRpc({
          'voice:testConnection': () => rpcSuccess({ ok: true }),
          'voice:setApiKey': failure,
        });
        const component = mount('tts', elConfig());

        typeKey('sk_retry');
        byTestId<HTMLButtonElement>('elevenlabs-test-btn').click();
        await settle();
        byTestId<HTMLButtonElement>('elevenlabs-key-save').click();
        await settle();

        expect(feedback.toast()).toEqual({
          tone: 'alert',
          message: 'Could not save the ElevenLabs API key.',
          canUndo: false,
        });
        expectFixedAlert('Could not save the ElevenLabs API key.');
        expect(component.keyDraft()).toBe('sk_retry');
        expect(byTestId<HTMLButtonElement>('elevenlabs-key-save').disabled).toBe(false);
      },
    );

    it('toggles key visibility without exposing the stored key', () => {
      routeRpc({});
      mount('stt', elConfig());

      const toggle = byTestId<HTMLButtonElement>('elevenlabs-key-visibility');
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      toggle.click();
      fixture.detectChanges();

      expect(byTestId<HTMLInputElement>('elevenlabs-key-input').type).toBe('text');
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
    });

    it('gives the show/hide button a 24x24 px minimum target (D4, WCAG 2.5.8)', () => {
      routeRpc({});
      mount('stt', elConfig());

      const toggle = byTestId<HTMLButtonElement>('elevenlabs-key-visibility');
      expect(toggle.classList).toContain('btn-square');
      expect(toggle.classList).toContain('min-w-6');
      expect(toggle.classList).toContain('min-h-6');
    });

    it.each([
      [true, 'New API key'],
      [false, 'Paste API key'],
    ])('uses a short placeholder that fits beside the actions (M3; key stored: %s)', async (configured, placeholder) => {
      routeRpc({ 'voice:listVoices': VOICES });
      mount('tts', elConfig({ apiKeyConfigured: configured }));
      await settle();

      expect(byTestId<HTMLInputElement>('elevenlabs-key-input').placeholder).toBe(placeholder);
    });
  });

  describe('clear key (V21, S-confirm)', () => {
    it('asks for an inline confirm first, focuses Cancel, and Cancel returns focus to Clear', async () => {
      routeRpc({ 'voice:listVoices': VOICES });
      mount('tts', elConfig({ apiKeyConfigured: true }));
      await settle();

      const clear = byTestId<HTMLButtonElement>('elevenlabs-key-clear');
      // Gate V 50 decision: the resting Clear is neutral; red only on the confirm button (P8).
      expect(clear.classList).not.toContain('border-error');
      expect(clear.classList).toContain('btn-outline');
      expect(clear.classList).toContain('btn-xs');
      expect(clear.classList).toContain('text-base-content');
      clear.click();
      fixture.detectChanges();
      expect(byTestId('elevenlabs-clear-confirm').classList).toContain('border-error');

      const group = byTestId('elevenlabs-clear-group');
      expect(group.getAttribute('role')).toBe('group');
      expect(calls('voice:setApiKey')).toEqual([]);
      expect(document.activeElement).toBe(byTestId('elevenlabs-clear-cancel'));

      byTestId<HTMLButtonElement>('elevenlabs-clear-cancel').click();
      fixture.detectChanges();

      expect(element.querySelector('[data-testid="elevenlabs-clear-group"]')).toBeNull();
      expect(document.activeElement).toBe(clear);
      expect(calls('voice:setApiKey')).toEqual([]);
    });

    it('Esc closes the confirm without a write', async () => {
      routeRpc({ 'voice:listVoices': VOICES });
      mount('tts', elConfig({ apiKeyConfigured: true }));
      await settle();

      byTestId<HTMLButtonElement>('elevenlabs-key-clear').click();
      fixture.detectChanges();
      // Esc must not also reach an enclosing drawer, which closes on Escape (Batch 49b).
      const outer = jest.fn();
      element.addEventListener('keydown', outer);
      byTestId('elevenlabs-clear-group').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      fixture.detectChanges();

      expect(element.querySelector('[data-testid="elevenlabs-clear-group"]')).toBeNull();
      expect(calls('voice:setApiKey')).toEqual([]);
      expect(outer).not.toHaveBeenCalled();
    });

    it('clears after confirm with no Undo', async () => {
      routeRpc({
        'voice:listVoices': VOICES,
        'voice:setApiKey': () => rpcSuccess({ ok: true }),
      });
      const component = mount('tts', elConfig({ apiKeyConfigured: true }));
      await settle();
      let emitted = 0;
      component.changed.subscribe(() => (emitted += 1));

      byTestId<HTMLButtonElement>('elevenlabs-key-clear').click();
      fixture.detectChanges();
      byTestId<HTMLButtonElement>('elevenlabs-clear-confirm').click();
      await settle();

      expect(calls('voice:setApiKey')).toEqual([{ providerId: 'elevenlabs', apiKey: '' }]);
      expect(feedback.toast()).toEqual({
        tone: 'status',
        message: 'Saved removal of the ElevenLabs API key.',
        canUndo: false,
      });
      expect(component.confirmingClear()).toBe(false);
      expect(component.voices()).toEqual([]);
      expect(emitted).toBe(1);
    });

    it.each(HOST_FAILURES)(
      'shows a fixed sentence and keeps the confirm open when clearing fails with %s (F1)',
      async (_shape, failure) => {
        routeRpc({ 'voice:listVoices': VOICES, 'voice:setApiKey': failure });
        mount('tts', elConfig({ apiKeyConfigured: true }));
        await settle();

        byTestId<HTMLButtonElement>('elevenlabs-key-clear').click();
        fixture.detectChanges();
        byTestId<HTMLButtonElement>('elevenlabs-clear-confirm').click();
        await settle();

        expect(feedback.toast()).toEqual({
          tone: 'alert',
          message: 'Could not clear the ElevenLabs API key.',
          canUndo: false,
        });
        expectFixedAlert('Could not clear the ElevenLabs API key.');
        expect(element.querySelector('[data-testid="elevenlabs-clear-group"]')).not.toBeNull();
      },
    );
  });

  describe('voices (V23)', () => {
    it('loads voices from voice:listVoices {providerId:elevenlabs} when a key is configured', async () => {
      routeRpc({ 'voice:listVoices': VOICES });
      mount('tts', elConfig({ apiKeyConfigured: true }));
      await settle();

      expect(rpc.call).toHaveBeenCalledWith('voice:listVoices', { providerId: 'elevenlabs' });
      expect(
        byTestId<HTMLSelectElement>('elevenlabs-voice-select').querySelectorAll('option').length,
      ).toBe(2);
    });

    it('loads voices once the container passes a config with a first saved key', async () => {
      routeRpc({ 'voice:listVoices': VOICES });
      mount('tts', elConfig());
      await settle();
      expect(byTestId('elevenlabs-voices-locked')).toBeTruthy();
      expect(calls('voice:listVoices')).toEqual([]);

      fixture.componentRef.setInput('config', elConfig({ apiKeyConfigured: true }));
      await settle();

      expect(calls('voice:listVoices')).toEqual([{ providerId: 'elevenlabs' }]);
      expect(element.querySelector('[data-testid="elevenlabs-voice-select"]')).not.toBeNull();
    });

    it.each(HOST_FAILURES)(
      'shows a fixed sentence with Retry when the voice list fails with %s (F1)',
      async (_shape, failure) => {
        let attempt = 0;
        routeRpc({
          'voice:listVoices': () => (attempt++ === 0 ? failure() : VOICES()),
        });
        mount('tts', elConfig({ apiKeyConfigured: true }));
        await settle();

        expect(byTestId('elevenlabs-voices-error').textContent?.trim()).toBe(
          'Could not load your ElevenLabs voices.',
        );
        expect(element.textContent).not.toContain('host detail');

        byTestId<HTMLButtonElement>('elevenlabs-voices-retry').click();
        await settle();

        expect(element.querySelector('[data-testid="elevenlabs-voices-error"]')).toBeNull();
        expect(element.querySelector('[data-testid="elevenlabs-voice-select"]')).not.toBeNull();
      },
    );

    it('saves a voice on selection with Undo writing the previous voice', async () => {
      routeRpc({
        'voice:listVoices': VOICES,
        'voice:setProviderConfig': () => rpcSuccess({ ok: true }),
      });
      const component = mount('tts', elConfig({ apiKeyConfigured: true, voiceId: 'v1' }));
      await settle();

      choose('elevenlabs-voice-select', 'v2');
      await settle();

      expect(calls('voice:setProviderConfig')).toEqual([{ elevenlabs: { voiceId: 'v2' } }]);
      expect(feedback.toast()).toEqual({
        tone: 'status',
        message: 'Saved ElevenLabs voice.',
        canUndo: true,
      });

      await feedback.undo();
      await settle();

      expect(calls('voice:setProviderConfig')).toEqual([
        { elevenlabs: { voiceId: 'v2' } },
        { elevenlabs: { voiceId: 'v1' } },
      ]);
      expect(component.voiceId()).toBe('v1');
    });

    it('offers no Undo when no voice was chosen before (the host rejects an empty id)', async () => {
      routeRpc({
        'voice:listVoices': VOICES,
        'voice:setProviderConfig': () => rpcSuccess({ ok: true }),
      });
      mount('tts', elConfig({ apiKeyConfigured: true }));
      await settle();

      choose('elevenlabs-voice-select', 'v2');
      await settle();

      expect(feedback.toast()).toEqual({
        tone: 'status',
        message: 'Saved ElevenLabs voice.',
        canUndo: false,
      });
    });
  });

  describe('selections (V23-V25, D15)', () => {
    const SELECTS: readonly [string, 'stt' | 'tts', string, string, string][] = [
      ['voice', 'tts', 'elevenlabs-voice-select', 'v2', 'voiceId'],
      ['TTS model', 'tts', 'elevenlabs-tts-model-select', 'eleven_turbo_v2_5', 'ttsModelId'],
      ['output format', 'tts', 'elevenlabs-output-format-select', 'pcm_16000', 'outputFormat'],
      ['STT model', 'stt', 'elevenlabs-stt-model-select', 'scribe_v1', 'sttModelId'],
    ];

    it.each(SELECTS)(
      'saves the %s through voice:setProviderConfig with only that field',
      async (_name, direction, testId, value, key) => {
        routeRpc({
          'voice:listVoices': VOICES,
          'voice:setProviderConfig': () => rpcSuccess({ ok: true }),
        });
        // STT has a single option, so start it elsewhere to make the choice a change.
        mount(direction, elConfig({ apiKeyConfigured: true, voiceId: 'v1', sttModelId: 'old' }));
        await settle();

        choose(testId, value);
        await settle();

        expect(calls('voice:setProviderConfig')).toEqual([{ elevenlabs: { [key]: value } }]);
        expect(feedback.toast()?.tone).toBe('status');
      },
    );

    for (const [name, direction, testId, value, key] of SELECTS) {
      it.each(HOST_FAILURES)(
        `reverts the ${name} and shows a fixed sentence when the write fails with %s (D15, F1)`,
        async (_shape, failure) => {
          routeRpc({ 'voice:listVoices': VOICES, 'voice:setProviderConfig': failure });
          const component = mount(
            direction,
            elConfig({ apiKeyConfigured: true, voiceId: 'v1', sttModelId: 'old' }),
          );
          await settle();
          const field =
            key === 'voiceId'
              ? component.voiceId
              : component.selection[key as ElevenLabsSelectKey];
          const before = field();

          choose(testId, value);
          await settle();

          expect(field()).toBe(before);
          expect(feedback.toast()).toEqual({
            tone: 'alert',
            message: 'Could not save the ElevenLabs settings.',
            canUndo: false,
          });
          expectFixedAlert('Could not save the ElevenLabs settings.');
        },
      );
    }
  });

  it('disables save triggers while a write is in flight (D3)', async () => {
    let resolveWrite!: (result: RpcResult<{ ok: boolean }>) => void;
    rpc.call.mockImplementation((method: string) => {
      if (method === 'voice:listVoices') return Promise.resolve(VOICES());
      return new Promise<RpcResult<{ ok: boolean }>>((resolve) => (resolveWrite = resolve));
    });
    mount('tts', elConfig({ apiKeyConfigured: true, voiceId: 'v1' }));
    await settle();

    choose('elevenlabs-tts-model-select', 'eleven_turbo_v2_5');
    fixture.detectChanges();

    expect(byTestId<HTMLSelectElement>('elevenlabs-voice-select').disabled).toBe(true);
    expect(byTestId<HTMLSelectElement>('elevenlabs-output-format-select').disabled).toBe(true);
    expect(byTestId<HTMLButtonElement>('elevenlabs-key-clear').disabled).toBe(true);
    expect(byTestId<HTMLInputElement>('elevenlabs-key-input').disabled).toBe(true);

    resolveWrite(rpcSuccess({ ok: true }));
    await settle();

    expect(byTestId<HTMLSelectElement>('elevenlabs-voice-select').disabled).toBe(false);
  });

  it('renders the STT model select and no voice picker or download UI for the stt direction', async () => {
    routeRpc({});
    mount('stt', elConfig({ apiKeyConfigured: true }));
    await settle();

    expect(element.querySelector('[data-testid="elevenlabs-stt-model-select"]')).not.toBeNull();
    expect(element.querySelector('[data-testid="elevenlabs-voice-select"]')).toBeNull();
    expect(element.textContent).not.toContain('Download');
    expect(calls('voice:listVoices')).toEqual([]);
  });

  it('uses no text size below 12 px anywhere in the component source (Batch 50b)', () => {
    const source = readFileSync(join(__dirname, 'elevenlabs-panel.component.ts'), 'utf8');
    expect(source.match(/text-\[(?:\d|1[01])(?:\.\d+)?px\]/g)).toBeNull();
  });
});
