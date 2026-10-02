import { signal } from '@angular/core';
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
import type { VoiceProviderConfigLocalDto } from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';

import { LocalTtsPanelComponent } from './local-tts-panel.component';

function localConfig(
  overrides: Partial<VoiceProviderConfigLocalDto> = {},
): VoiceProviderConfigLocalDto {
  return {
    whisperModel: 'base.en',
    modelSource: 'curated',
    sttDownloaded: false,
    ttsDownloaded: false,
    ttsVoice: 'af_heart',
    ...overrides,
  };
}

const VOICES = () =>
  rpcSuccess({
    ok: true,
    voices: [
      { id: 'af_heart', label: 'Heart', category: 'American English' },
      { id: 'bf_emma', label: 'Emma', category: 'British English' },
    ],
  });

describe('LocalTtsPanelComponent', () => {
  let fixture: ComponentFixture<LocalTtsPanelComponent>;
  let feedback: SettingsSaveFeedbackService;
  let element: HTMLElement;

  function routeRpc(
    rpc: MockRpcService,
    routes: Record<string, () => unknown>,
  ): void {
    (rpc.call as jest.Mock).mockImplementation((method: string) => {
      const handler = routes[method];
      if (handler) return Promise.resolve(handler());
      return Promise.resolve(rpcSuccess({ ok: true }));
    });
  }

  function mount(
    rpc: MockRpcService,
    config: VoiceProviderConfigLocalDto,
  ): LocalTtsPanelComponent {
    TestBed.configureTestingModule({
      imports: [LocalTtsPanelComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: rpc },
        {
          provide: ProvidersSettingsStateService,
          useValue: { commit: signal({ status: 'idle' }) },
        },
        {
          provide: VSCodeService,
          useValue: { isElectron: true, config: signal({}) },
        },
        SettingsSaveFeedbackService,
      ],
    });
    fixture = TestBed.createComponent(LocalTtsPanelComponent);
    feedback = TestBed.inject(SettingsSaveFeedbackService);
    element = fixture.nativeElement as HTMLElement;
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

  function calls(rpc: MockRpcService, method: string): unknown[] {
    return rpc.call.mock.calls.filter(([m]) => m === method).map(([, p]) => p);
  }

  afterEach(() => {
    feedback?.dismiss();
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  it('fetches voices from voice:listVoices {providerId:local} and renders them', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, { 'voice:listVoices': VOICES });
    mount(rpc, localConfig());
    await settle();

    expect(rpc.call).toHaveBeenCalledWith('voice:listVoices', {
      providerId: 'local',
    });
    expect(
      byTestId<HTMLSelectElement>('local-tts-voice-select').options.length,
    ).toBe(2);
    expect(
      byTestId<HTMLSelectElement>('local-tts-voice-select').querySelectorAll(
        'optgroup',
      ).length,
    ).toBe(2);
  });

  it('persists a voice change voice-only and toasts it with Undo, with no Saved chip (V17/V20)', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listVoices': VOICES,
      'voice:setTtsConfig': () => rpcSuccess({ ok: true }),
    });
    const component = mount(rpc, localConfig());
    await settle();
    let emitted = 0;
    component.changed.subscribe(() => (emitted += 1));

    const select = byTestId<HTMLSelectElement>('local-tts-voice-select');
    select.value = 'bf_emma';
    select.dispatchEvent(new Event('change'));
    await settle();

    // Voice-only payload: an unsaved source draft is never persisted as a side effect.
    expect(calls(rpc, 'voice:setTtsConfig')).toEqual([{ voice: 'bf_emma' }]);
    expect(feedback.toast()).toEqual({
      tone: 'status',
      message: 'Saved text-to-speech voice.',
      canUndo: true,
    });
    expect(element.querySelector('[data-testid="local-tts-saved"]')).toBeNull();
    expect(emitted).toBe(1);

    await feedback.undo();
    await settle();

    expect(calls(rpc, 'voice:setTtsConfig')).toEqual([
      { voice: 'bf_emma' },
      { voice: 'af_heart' },
    ]);
    expect(component.selectedVoice()).toBe('af_heart');
    expect(select.value).toBe('af_heart');
  });

  it('reverts the voice select and raises an alert when the write fails (D15)', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listVoices': VOICES,
      'voice:setTtsConfig': () => rpcError('disk full'),
    });
    const component = mount(rpc, localConfig());
    await settle();

    const select = byTestId<HTMLSelectElement>('local-tts-voice-select');
    select.value = 'bf_emma';
    select.dispatchEvent(new Event('change'));
    await settle();

    expect(component.selectedVoice()).toBe('af_heart');
    expect(select.value).toBe('af_heart');
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message: 'Could not save the text-to-speech configuration.',
      canUndo: false,
    });
    const alert = byTestId('local-tts-panel-error');
    expect(alert.textContent).toContain(
      'Could not save the text-to-speech configuration.',
    );
    // F1: the host's raw error text never reaches the panel.
    expect(alert.textContent).not.toContain('disk full');
    expect(element.querySelector('[data-testid="local-tts-saved"]')).toBeNull();
  });

  it('never surfaces a thrown host error in the save alert (F1)', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listVoices': VOICES,
      'voice:setTtsConfig': () =>
        Promise.reject(new Error('secret host detail')),
    });
    const component = mount(rpc, localConfig());
    await settle();

    const select = byTestId<HTMLSelectElement>('local-tts-voice-select');
    select.value = 'bf_emma';
    select.dispatchEvent(new Event('change'));
    await settle();

    expect(component.selectedVoice()).toBe('af_heart');
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message: 'Could not save the text-to-speech configuration.',
      canUndo: false,
    });
    expect(byTestId('local-tts-panel-error').textContent?.trim()).toBe(
      'Could not save the text-to-speech configuration.',
    );
    expect(element.textContent).not.toContain('secret host detail');
  });

  it('never surfaces a { ok:false } host error in the save alert (F1)', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listVoices': VOICES,
      'voice:setTtsConfig': () =>
        rpcSuccess({ ok: false, error: 'host detail' }),
    });
    const component = mount(rpc, localConfig());
    await settle();

    const select = byTestId<HTMLSelectElement>('local-tts-voice-select');
    select.value = 'bf_emma';
    select.dispatchEvent(new Event('change'));
    await settle();

    expect(component.selectedVoice()).toBe('af_heart');
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message: 'Could not save the text-to-speech configuration.',
      canUndo: false,
    });
    expect(byTestId('local-tts-panel-error').textContent?.trim()).toBe(
      'Could not save the text-to-speech configuration.',
    );
    expect(element.textContent).not.toContain('host detail');
  });

  /** The three host-failure shapes a panel action can see (F1). */
  const HOST_FAILURES: readonly [string, () => unknown][] = [
    ['an RPC error', () => rpcError('host detail')],
    ['a thrown Error', () => Promise.reject(new Error('secret host detail'))],
    ['an { ok:false } result', () => rpcSuccess({ ok: false, error: 'host detail' })],
  ];

  function expectFixedAlert(sentence: string): void {
    const alert = byTestId('local-tts-panel-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent?.trim()).toBe(sentence);
    expect(element.textContent).not.toContain('host detail');
  }

  it.each(HOST_FAILURES)(
    'shows a fixed sentence, never host text, when the voice list fails with %s (F1)',
    async (_shape, failure) => {
      const rpc = createMockRpcService();
      routeRpc(rpc, { 'voice:listVoices': failure });
      const component = mount(rpc, localConfig());
      await settle();

      expect(component.errorMessage()).toBe('Could not load the voices.');
      expectFixedAlert('Could not load the voices.');
    },
  );

  it.each(HOST_FAILURES)(
    'shows a fixed sentence, never host text, when the download fails with %s (F1)',
    async (_shape, failure) => {
      const rpc = createMockRpcService();
      routeRpc(rpc, {
        'voice:listVoices': () => rpcSuccess({ ok: true, voices: [] }),
        'voice:downloadTtsModel': failure,
      });
      const component = mount(rpc, localConfig());
      await settle();

      byTestId<HTMLButtonElement>('local-tts-download-btn').click();
      await settle();

      expect(component.errorMessage()).toBe(
        'Could not download the text-to-speech model.',
      );
      expectFixedAlert('Could not download the text-to-speech model.');
    },
  );

  it.each(HOST_FAILURES)(
    'shows a fixed sentence, never host text, when the preview fails with %s (F1)',
    async (_shape, failure) => {
      const rpc = createMockRpcService();
      routeRpc(rpc, {
        'voice:listVoices': VOICES,
        'voice:synthesize': failure,
      });
      const component = mount(rpc, localConfig());
      await settle();

      byTestId<HTMLButtonElement>('local-tts-preview-btn').click();
      await settle();

      expect(component.isPreviewing()).toBe(false);
      expect(component.errorMessage()).toBe('Could not play the preview.');
      expectFixedAlert('Could not play the preview.');
    },
  );

  it('reads back the model source + custom id from voice:getTtsConfig on init', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listVoices': () => rpcSuccess({ ok: true, voices: [] }),
      'voice:getTtsConfig': () =>
        rpcSuccess({
          ok: true,
          config: {
            voice: 'af_heart',
            downloaded: false,
            modelSource: 'hf',
            customModel: 'owner/kokoro-custom',
          },
        }),
    });
    const component = mount(rpc, localConfig());
    await settle();

    expect(rpc.call).toHaveBeenCalledWith('voice:getTtsConfig', {});
    expect(component.source()).toBe('hf');
    expect(component.customModel()).toBe('owner/kokoro-custom');

    // The custom input is rendered (not the curated-only layout).
    expect(byTestId<HTMLInputElement>('local-tts-custom-input').value).toBe(
      'owner/kokoro-custom',
    );
  });

  it('shows the custom input for the HF source and validates repo id shape (V13/V15)', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listVoices': () => rpcSuccess({ ok: true, voices: [] }),
      'voice:setTtsConfig': () => rpcSuccess({ ok: true }),
    });
    const component = mount(rpc, localConfig());
    await settle();

    byTestId<HTMLButtonElement>('local-tts-source-hf').click();
    fixture.detectChanges();
    expect(calls(rpc, 'voice:setTtsConfig')).toEqual([]);

    const input = byTestId<HTMLInputElement>('local-tts-custom-input');

    // Invalid (no slash) → validation fails and Save stays disabled.
    input.value = 'not-a-repo';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(component.customModelValid()).toBe(false);
    expect(byTestId<HTMLButtonElement>('local-tts-custom-save').disabled).toBe(
      true,
    );

    // Valid owner/name → save enabled and persisted.
    input.value = 'owner/kokoro-model';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(component.customModelValid()).toBe(true);

    byTestId<HTMLButtonElement>('local-tts-custom-save').click();
    await settle();

    expect(calls(rpc, 'voice:setTtsConfig')).toEqual([
      { voice: 'af_heart', modelSource: 'hf', customModel: 'owner/kokoro-model' },
    ]);
    expect(feedback.toast()).toEqual({
      tone: 'status',
      message: 'Saved text-to-speech model source.',
      canUndo: false,
    });
  });

  it('keeps the custom draft and alerts when the custom save fails (D15, S-explicit)', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listVoices': () => rpcSuccess({ ok: true, voices: [] }),
      'voice:setTtsConfig': () => rpcError('disk full'),
    });
    const component = mount(rpc, localConfig());
    await settle();

    byTestId<HTMLButtonElement>('local-tts-source-hf').click();
    fixture.detectChanges();
    const input = byTestId<HTMLInputElement>('local-tts-custom-input');
    input.value = 'owner/kokoro-model';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    byTestId<HTMLButtonElement>('local-tts-custom-save').click();
    await settle();

    expect(component.customModel()).toBe('owner/kokoro-model');
    expect(component.source()).toBe('hf');
    expect(input.value).toBe('owner/kokoro-model');
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message: 'Could not save the text-to-speech configuration.',
      canUndo: false,
    });
    const alert = byTestId('local-tts-panel-error');
    expect(alert.textContent).toContain(
      'Could not save the text-to-speech configuration.',
    );
    expect(alert.textContent).not.toContain('disk full');
  });

  it('returns to Curated immediately and Undo restores the previous source (V13, S-sel)', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listVoices': () => rpcSuccess({ ok: true, voices: [] }),
      'voice:getTtsConfig': () =>
        rpcSuccess({
          ok: true,
          config: {
            voice: 'af_heart',
            downloaded: false,
            modelSource: 'dir',
            customModel: '/models/kokoro',
          },
        }),
      'voice:setTtsConfig': () => rpcSuccess({ ok: true }),
    });
    const component = mount(rpc, localConfig());
    await settle();

    byTestId<HTMLButtonElement>('local-tts-source-curated').click();
    await settle();

    expect(calls(rpc, 'voice:setTtsConfig')).toEqual([
      { voice: 'af_heart', modelSource: 'curated' },
    ]);
    expect(component.source()).toBe('curated');
    expect(feedback.toast()).toEqual({
      tone: 'status',
      message: 'Saved text-to-speech model source.',
      canUndo: true,
    });
    // Custom input disappears once curated is active.
    expect(element.querySelector('[data-testid="local-tts-custom-input"]')).toBeNull();

    await feedback.undo();
    await settle();

    expect(calls(rpc, 'voice:setTtsConfig')).toEqual([
      { voice: 'af_heart', modelSource: 'curated' },
      { voice: 'af_heart', modelSource: 'dir', customModel: '/models/kokoro' },
    ]);
    expect(component.source()).toBe('dir');
    expect(component.customModel()).toBe('/models/kokoro');
  });

  it('reverts the source toggle when the return to Curated fails (D15)', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listVoices': () => rpcSuccess({ ok: true, voices: [] }),
      'voice:getTtsConfig': () =>
        rpcSuccess({
          ok: true,
          config: {
            voice: 'af_heart',
            downloaded: false,
            modelSource: 'dir',
            customModel: '/models/kokoro',
          },
        }),
      'voice:setTtsConfig': () => rpcError('disk full'),
    });
    const component = mount(rpc, localConfig());
    await settle();

    byTestId<HTMLButtonElement>('local-tts-source-curated').click();
    await settle();

    expect(component.source()).toBe('dir');
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message: 'Could not save the text-to-speech configuration.',
      canUndo: false,
    });
    expect(element.textContent).not.toContain('disk full');
  });

  it('abandons an unsaved custom draft without a write when Curated is already saved (V13)', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, { 'voice:listVoices': () => rpcSuccess({ ok: true, voices: [] }) });
    const component = mount(rpc, localConfig());
    await settle();

    byTestId<HTMLButtonElement>('local-tts-source-hf').click();
    fixture.detectChanges();
    byTestId<HTMLButtonElement>('local-tts-source-curated').click();
    await settle();

    expect(calls(rpc, 'voice:setTtsConfig')).toEqual([]);
    expect(component.source()).toBe('curated');
    expect(feedback.toast()).toBeNull();
  });

  it('downloads the TTS model with the tts progress sentinel preserved (V19)', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listVoices': () => rpcSuccess({ ok: true, voices: [] }),
      'voice:downloadTtsModel': () =>
        rpcSuccess({ ok: true, alreadyPresent: false }),
    });
    mount(rpc, localConfig());
    await settle();

    byTestId<HTMLButtonElement>('local-tts-download-btn').click();
    await settle();

    expect(rpc.call).toHaveBeenCalledWith(
      'voice:downloadTtsModel',
      {},
      { timeout: expect.any(Number) },
    );
  });

  it('disables the download button for non-curated sources', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listVoices': () => rpcSuccess({ ok: true, voices: [] }),
      'voice:getTtsConfig': () =>
        rpcSuccess({
          ok: true,
          config: {
            voice: 'af_heart',
            downloaded: false,
            modelSource: 'hf',
            customModel: 'owner/kokoro-model',
          },
        }),
    });
    const component = mount(rpc, localConfig());
    await settle();

    expect(byTestId<HTMLButtonElement>('local-tts-download-btn').disabled).toBe(true);
    expect(component.canDownload()).toBe(false);
  });

  it('disables save triggers while a write is in flight (D3)', async () => {
    const rpc = createMockRpcService();
    let resolveWrite!: (result: RpcResult<{ ok: boolean }>) => void;
    (rpc.call as jest.Mock).mockImplementation((method: string) => {
      if (method === 'voice:listVoices') return Promise.resolve(VOICES());
      if (method !== 'voice:setTtsConfig') {
        return Promise.resolve(rpcSuccess({ ok: true }));
      }
      return new Promise<RpcResult<{ ok: boolean }>>((resolve) => {
        resolveWrite = resolve;
      });
    });
    mount(rpc, localConfig());
    await settle();

    const select = byTestId<HTMLSelectElement>('local-tts-voice-select');
    select.value = 'bf_emma';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(select.disabled).toBe(true);
    expect(byTestId<HTMLButtonElement>('local-tts-preview-btn').disabled).toBe(true);
    expect(byTestId<HTMLButtonElement>('local-tts-download-btn').disabled).toBe(true);

    resolveWrite(rpcSuccess({ ok: true }));
    await settle();

    expect(select.disabled).toBe(false);
    expect(calls(rpc, 'voice:setTtsConfig')).toEqual([{ voice: 'bf_emma' }]);
  });
});