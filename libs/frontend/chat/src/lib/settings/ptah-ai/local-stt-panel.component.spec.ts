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
import { VoiceDownloadProgressService } from '../../services/voice-download-progress.service';

import { LocalSttPanelComponent } from './local-stt-panel.component';

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

describe('LocalSttPanelComponent', () => {
  let fixture: ComponentFixture<LocalSttPanelComponent>;
  let feedback: SettingsSaveFeedbackService;
  let element: HTMLElement;
  const rpc: MockRpcService = createMockRpcService();

  function mount(config: VoiceProviderConfigLocalDto): LocalSttPanelComponent {
    TestBed.configureTestingModule({
      imports: [LocalSttPanelComponent],
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
    fixture = TestBed.createComponent(LocalSttPanelComponent);
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

  function calls(method: string): unknown[] {
    return rpc.call.mock.calls.filter(([m]) => m === method).map(([, p]) => p);
  }

  afterEach(() => {
    feedback?.dismiss();
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  beforeEach(() => rpc.call.mockReset());

  it('renders the curated model select seeded from the config input', () => {
    rpc.call.mockResolvedValue(rpcSuccess({ ok: true }));
    mount(localConfig({ whisperModel: 'small.en' }));

    expect(byTestId<HTMLSelectElement>('local-stt-model-select').value).toBe('small.en');
    expect(element.querySelector('table.table.table-xs')).not.toBeNull();
  });

  it('persists a curated model change and toasts it with Undo, with no Saved chip (V14/V20)', async () => {
    rpc.call.mockResolvedValue(rpcSuccess({ ok: true }));
    const component = mount(localConfig());
    let emitted = 0;
    component.changed.subscribe(() => (emitted += 1));

    const select = byTestId<HTMLSelectElement>('local-stt-model-select');
    select.value = 'medium';
    select.dispatchEvent(new Event('change'));
    await settle();

    expect(calls('voice:setConfig')).toEqual([
      { whisperModel: 'medium', modelSource: 'curated' },
    ]);
    expect(feedback.toast()).toEqual({
      tone: 'status',
      message: 'Saved speech-to-text model.',
      canUndo: true,
    });
    expect(element.querySelector('[data-testid="local-stt-saved"]')).toBeNull();
    expect(emitted).toBe(1);
  });

  it('writes the previous model back when Undo is used (V14, S-sel)', async () => {
    rpc.call.mockResolvedValue(rpcSuccess({ ok: true }));
    const component = mount(localConfig());

    const select = byTestId<HTMLSelectElement>('local-stt-model-select');
    select.value = 'medium';
    select.dispatchEvent(new Event('change'));
    await settle();

    await feedback.undo();
    await settle();

    expect(calls('voice:setConfig')).toEqual([
      { whisperModel: 'medium', modelSource: 'curated' },
      { whisperModel: 'base.en', modelSource: 'curated' },
    ]);
    expect(component.selectedModel()).toBe('base.en');
    expect(select.value).toBe('base.en');
  });

  it('reverts the select and raises an alert when the model write fails (D15)', async () => {
    rpc.call.mockResolvedValue(rpcError('disk full'));
    const component = mount(localConfig());

    const select = byTestId<HTMLSelectElement>('local-stt-model-select');
    select.value = 'medium';
    select.dispatchEvent(new Event('change'));
    await settle();

    expect(component.selectedModel()).toBe('base.en');
    expect(select.value).toBe('base.en');
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message: 'Could not save the voice configuration.',
      canUndo: false,
    });
    expect(component.errorMessage()).toBe('Could not save the voice configuration.');
    const alert = byTestId('local-stt-panel-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.classList).toContain('text-base-content');
    // F1: the host's raw error text never reaches the panel.
    expect(alert.textContent).not.toContain('disk full');
    expect(element.querySelector('[data-testid="local-stt-saved"]')).toBeNull();
  });

  it('never surfaces a thrown host error in the save alert (F1)', async () => {
    rpc.call.mockRejectedValue(new Error('secret host detail'));
    const component = mount(localConfig());

    const select = byTestId<HTMLSelectElement>('local-stt-model-select');
    select.value = 'medium';
    select.dispatchEvent(new Event('change'));
    await settle();

    expect(component.selectedModel()).toBe('base.en');
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message: 'Could not save the voice configuration.',
      canUndo: false,
    });
    expect(byTestId('local-stt-panel-error').textContent?.trim()).toBe(
      'Could not save the voice configuration.',
    );
    expect(element.textContent).not.toContain('secret host detail');
  });

  it('never surfaces a { ok:false } host error in the save alert (F1)', async () => {
    rpc.call.mockResolvedValue(
      rpcSuccess({ ok: false, error: 'host detail' }),
    );
    const component = mount(localConfig());

    const select = byTestId<HTMLSelectElement>('local-stt-model-select');
    select.value = 'medium';
    select.dispatchEvent(new Event('change'));
    await settle();

    expect(component.selectedModel()).toBe('base.en');
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message: 'Could not save the voice configuration.',
      canUndo: false,
    });
    expect(byTestId('local-stt-panel-error').textContent?.trim()).toBe(
      'Could not save the voice configuration.',
    );
    expect(element.textContent).not.toContain('host detail');
  });

  it('shows the custom input for the HF source and validates repo id shape (V13/V15)', async () => {
    rpc.call.mockResolvedValue(rpcSuccess({ ok: true }));
    const component = mount(localConfig());

    byTestId<HTMLButtonElement>('local-stt-source-hf').click();
    fixture.detectChanges();
    expect(calls('voice:setConfig')).toEqual([]);

    const input = byTestId<HTMLInputElement>('local-stt-custom-input');

    // Invalid (no slash) → save disabled.
    input.value = 'not-a-repo';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(component.customModelValid()).toBe(false);
    expect(
      byTestId<HTMLButtonElement>('local-stt-custom-save').disabled,
    ).toBe(true);

    // Valid owner/name → save enabled and persisted with modelSource + customModel.
    input.value = 'openai/whisper-base';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(component.customModelValid()).toBe(true);

    byTestId<HTMLButtonElement>('local-stt-custom-save').click();
    await settle();

    expect(calls('voice:setConfig')).toEqual([
      { whisperModel: 'base.en', modelSource: 'hf', customModel: 'openai/whisper-base' },
    ]);
    expect(feedback.toast()).toEqual({
      tone: 'status',
      message: 'Saved speech-to-text model source.',
      canUndo: false,
    });
  });

  it('keeps the custom draft and alerts when the custom save fails (D15, S-explicit)', async () => {
    rpc.call.mockResolvedValue(rpcError('disk full'));
    const component = mount(localConfig());

    byTestId<HTMLButtonElement>('local-stt-source-hf').click();
    fixture.detectChanges();

    const input = byTestId<HTMLInputElement>('local-stt-custom-input');
    input.value = 'openai/whisper-base';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    byTestId<HTMLButtonElement>('local-stt-custom-save').click();
    await settle();

    expect(component.customModel()).toBe('openai/whisper-base');
    expect(component.source()).toBe('hf');
    expect(byTestId<HTMLInputElement>('local-stt-custom-input').value).toBe(
      'openai/whisper-base',
    );
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message: 'Could not save the voice configuration.',
      canUndo: false,
    });
    const alert = byTestId('local-stt-panel-error');
    expect(alert.textContent).toContain('Could not save the voice configuration.');
    expect(alert.textContent).not.toContain('disk full');
  });

  it('returns to Curated immediately and Undo restores the previous source (V13, S-sel)', async () => {
    rpc.call.mockResolvedValue(rpcSuccess({ ok: true }));
    const component = mount(
      localConfig({ modelSource: 'hf', customModel: 'openai/whisper-base' }),
    );

    byTestId<HTMLButtonElement>('local-stt-source-curated').click();
    await settle();

    expect(calls('voice:setConfig')).toEqual([
      { whisperModel: 'base.en', modelSource: 'curated' },
    ]);
    expect(component.source()).toBe('curated');
    expect(feedback.toast()).toEqual({
      tone: 'status',
      message: 'Saved speech-to-text model source.',
      canUndo: true,
    });

    await feedback.undo();
    await settle();

    expect(calls('voice:setConfig')).toEqual([
      { whisperModel: 'base.en', modelSource: 'curated' },
      {
        whisperModel: 'base.en',
        modelSource: 'hf',
        customModel: 'openai/whisper-base',
      },
    ]);
    expect(component.source()).toBe('hf');
    expect(component.customModel()).toBe('openai/whisper-base');
  });

  it('reverts the source toggle when the return to Curated fails (D15)', async () => {
    rpc.call.mockResolvedValue(rpcError('disk full'));
    const component = mount(localConfig({ modelSource: 'hf' }));

    byTestId<HTMLButtonElement>('local-stt-source-curated').click();
    await settle();

    expect(component.source()).toBe('hf');
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message: 'Could not save the voice configuration.',
      canUndo: false,
    });
    expect(element.textContent).not.toContain('disk full');
  });

  it('abandons an unsaved custom draft without a write when Curated is already saved (V13)', async () => {
    rpc.call.mockResolvedValue(rpcSuccess({ ok: true }));
    const component = mount(localConfig());

    byTestId<HTMLButtonElement>('local-stt-source-hf').click();
    fixture.detectChanges();
    byTestId<HTMLButtonElement>('local-stt-source-curated').click();
    await settle();

    expect(calls('voice:setConfig')).toEqual([]);
    expect(component.source()).toBe('curated');
    expect(feedback.toast()).toBeNull();
  });

  it('downloads keyed by the curated model name and maps progress (V16)', async () => {
    rpc.call.mockResolvedValue(rpcSuccess({ ok: true, alreadyPresent: false }));
    const component = mount(localConfig({ whisperModel: 'small.en' }));

    const progress = TestBed.inject(VoiceDownloadProgressService);
    progress.handleMessage({
      type: 'voice:modelDownloadProgress',
      payload: { model: 'small.en', percent: 42 },
    });
    expect(component.downloadPercent()).toBe(42);

    byTestId<HTMLButtonElement>('local-stt-download-btn').click();
    await settle();

    expect(rpc.call).toHaveBeenCalledWith(
      'voice:downloadModel',
      { model: 'small.en' },
      { timeout: expect.any(Number) },
    );
  });

  it.each([
    ['an RPC error', () => Promise.resolve(rpcError('host detail'))],
    ['a thrown Error', () => Promise.reject(new Error('secret host detail'))],
    [
      'an { ok:false } result',
      () => Promise.resolve(rpcSuccess({ ok: false, error: 'host detail' })),
    ],
  ])(
    'shows a fixed sentence, never host text, when the download fails with %s (F1)',
    async (_shape, failure) => {
      (rpc.call as jest.Mock).mockImplementation(failure);
      const component = mount(localConfig({ whisperModel: 'small.en' }));

      byTestId<HTMLButtonElement>('local-stt-download-btn').click();
      await settle();

      expect(component.errorMessage()).toBe('Could not download the voice model.');
      const alert = byTestId('local-stt-panel-error');
      expect(alert.textContent?.trim()).toBe('Could not download the voice model.');
      expect(element.textContent).not.toContain('host detail');
    },
  );

  it('disables save triggers while a write is in flight (D3)', async () => {
    let resolveWrite!: (result: RpcResult<{ ok: boolean }>) => void;
    rpc.call.mockImplementation(
      () =>
        new Promise<RpcResult<{ ok: boolean }>>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    mount(localConfig());

    const select = byTestId<HTMLSelectElement>('local-stt-model-select');
    select.value = 'medium';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(select.disabled).toBe(true);
    expect(byTestId<HTMLButtonElement>('local-stt-source-hf').disabled).toBe(true);
    expect(byTestId<HTMLButtonElement>('local-stt-download-btn').disabled).toBe(true);

    resolveWrite(rpcSuccess({ ok: true }));
    await settle();

    expect(select.disabled).toBe(false);
    expect(calls('voice:setConfig')).toEqual([
      { whisperModel: 'medium', modelSource: 'curated' },
    ]);
  });
});