import { signal } from '@angular/core';
import {
  DeferBlockBehavior,
  DeferBlockState,
  TestBed,
  type ComponentFixture,
} from '@angular/core/testing';
import {
  ClaudeRpcService,
  ProvidersSettingsStateService,
  RpcResult,
  VSCodeService,
} from '@ptah-extension/core';
import type {
  VoiceProviderCapabilityDto,
  VoiceProviderConfigDto,
} from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { VoiceConfigComponent } from './voice-config.component';

function providers(elevenlabsAvailable = false): VoiceProviderCapabilityDto[] {
  return [
    {
      id: 'local', label: 'Local (Whisper / Kokoro)', kind: 'local', requiresDownload: true,
      requiresApiKey: false, supports: { tts: true, stt: true }, available: true,
    },
    {
      id: 'elevenlabs', label: 'ElevenLabs', kind: 'cloud', requiresDownload: false, requiresApiKey: true,
      supports: { tts: true, stt: true }, available: elevenlabsAvailable,
      ...(elevenlabsAvailable ? {} : { unavailableReason: 'API key not configured' }),
    },
  ];
}

function config(overrides: Partial<VoiceProviderConfigDto> = {}): VoiceProviderConfigDto {
  return {
    ttsProvider: 'local',
    sttProvider: 'local',
    local: {
      whisperModel: 'base.en', modelSource: 'curated', sttDownloaded: true, ttsDownloaded: false, ttsVoice: 'af_heart',
    },
    elevenlabs: {
      apiKeyConfigured: false, ttsModelId: 'eleven_multilingual_v2', outputFormat: 'mp3_44100_128', sttModelId: 'scribe_v1',
    },
    ...overrides,
  };
}

type Responder = () => RpcResult<unknown> | Promise<RpcResult<unknown>>;
const ok = <T>(data: T) => new RpcResult<T>(true, data);
const fail = (message: string) => new RpcResult<unknown>(false, undefined, message);

/** TASK_2026_555 Batch 46 — Voice engines matrix (pattern map V9-V12). */
describe('VoiceConfigComponent', () => {
  let fixture: ComponentFixture<VoiceConfigComponent>;
  let component: VoiceConfigComponent;
  let feedback: SettingsSaveFeedbackService;
  let element: HTMLElement;
  let responses: Record<string, Responder>;
  let currentConfig: VoiceProviderConfigDto;
  const call = jest.fn();

  beforeEach(() => {
    currentConfig = config();
    responses = {
      'voice:listProviders': () => ok({ ok: true, providers: providers(true), active: { tts: 'local', stt: 'local' } }),
      'voice:getProviderConfig': () => ok({ ok: true, config: currentConfig }),
      'voice:setProviderConfig': () => ok({ ok: true }),
    };
    call.mockReset();
    call.mockImplementation(async (method: string) => {
      const respond = responses[method];
      // Benign default for the panels' own init calls (e.g. voice:listVoices).
      return respond ? respond() : ok({ ok: true, voices: [] });
    });
  });

  afterEach(() => {
    feedback?.dismiss();
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  /** Flushes pending RPC promises (not `whenStable()`: the toast's 8 s timer would hold it open). */
  async function settle(): Promise<void> {
    for (let pass = 0; pass < 3; pass += 1) {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
      fixture.detectChanges();
    }
  }

  async function render(): Promise<void> {
    TestBed.configureTestingModule({
      imports: [VoiceConfigComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: ProvidersSettingsStateService, useValue: { commit: signal({ status: 'idle' }) } },
        { provide: VSCodeService, useValue: { isElectron: true, config: signal({}) } },
        SettingsSaveFeedbackService,
      ],
      deferBlockBehavior: DeferBlockBehavior.Manual,
    });
    fixture = TestBed.createComponent(VoiceConfigComponent);
    component = fixture.componentInstance;
    element = fixture.nativeElement as HTMLElement;
    feedback = TestBed.inject(SettingsSaveFeedbackService);
    fixture.detectChanges();
    await settle();
  }

  const byTestId = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const el = element.querySelector<T>(`[data-testid="${id}"]`);
    if (!el) throw new Error(`missing [data-testid="${id}"]`);
    return el;
  };
  const queryTestId = (id: string) => element.querySelector(`[data-testid="${id}"]`);
  const calls = (method: string) => call.mock.calls.filter(([m]) => m === method).map(([, params]) => params);

  async function choose(direction: 'stt' | 'tts', id: string): Promise<void> {
    byTestId<HTMLButtonElement>(`voice-provider-btn-${direction}`).click();
    fixture.detectChanges();
    byTestId<HTMLButtonElement>(`voice-provider-option-${direction}-${id}`).click();
    await settle();
  }

  it('shows loading, then one matrix row per direction with the V9 copy', async () => {
    let finish: () => void = () => undefined;
    responses['voice:getProviderConfig'] = () =>
      new Promise((resolve) => { finish = () => resolve(ok({ ok: true, config: currentConfig })); });
    await render();
    expect(byTestId('voice-config-loading').textContent).toContain('Loading voice providers');

    finish();
    await settle();
    expect(queryTestId('voice-config-loading')).toBeNull();
    expect(element.textContent).toContain('Local engines run offline;');
    expect(element.querySelector('table.table.table-xs')).not.toBeNull();
    expect(byTestId('voice-provider-btn-stt').textContent).toContain('Local (Whisper / Kokoro)');
    expect(byTestId('voice-engine-model-stt').textContent).toContain('base.en');
    expect(byTestId('voice-engine-model-tts').textContent).toContain('af_heart');
  });

  it('summarises readiness per direction with colour only on the dot (V12)', async () => {
    currentConfig = config({ ttsProvider: 'elevenlabs' });
    await render();

    const stt = byTestId('voice-engine-status-stt');
    const tts = byTestId('voice-engine-status-tts');
    expect(stt.textContent).toContain('Ready');
    expect(tts.textContent).toContain('No key');
    expect(stt.classList).toContain('text-base-content');
    expect(tts.querySelector('.bg-warning')).not.toBeNull();
    expect(byTestId('voice-engine-model-tts').textContent).toContain('No voice chosen');
  });

  describe('ElevenLabs voice name in the Model / Voice cell (V7)', () => {
    const elevenlabsTts = () =>
      config({
        ttsProvider: 'elevenlabs',
        elevenlabs: { ...config().elevenlabs, apiKeyConfigured: true, voiceId: 'EXAVITQu4vr4xnSDxMaL' },
      });

    it('shows the voice name from one voice:listVoices read', async () => {
      currentConfig = elevenlabsTts();
      responses['voice:listVoices'] = () =>
        ok({ ok: true, voices: [{ id: 'other', label: 'Adam' }, { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah' }] });
      await render();

      const cell = byTestId('voice-engine-model-tts');
      expect(cell.textContent?.trim()).toBe('Sarah');
      expect(cell.getAttribute('title')).toBeNull();
      expect(calls('voice:listVoices')).toEqual([{ providerId: 'elevenlabs' }]);

      // A config re-read (e.g. after a drawer change) does not read the list again.
      await component.reloadConfig();
      await settle();
      expect(calls('voice:listVoices').length).toBe(1);
    });

    it.each([
      ['the list fails', () => ok({ ok: false, error: 'boom' })],
      ['the transport fails', () => fail('down')],
      ['the id is not in the list', () => ok({ ok: true, voices: [{ id: 'other', label: 'Adam' }] })],
    ])('shows "Custom voice" with the id as a tooltip when %s', async (_case, respond) => {
      currentConfig = elevenlabsTts();
      responses['voice:listVoices'] = respond;
      await render();

      const cell = byTestId('voice-engine-model-tts');
      expect(cell.textContent?.trim()).toBe('Custom voice');
      expect(cell.getAttribute('title')).toBe('EXAVITQu4vr4xnSDxMaL');
      expect(element.textContent).not.toContain('boom');
    });

    it('does not read the voice list for Local TTS and keeps the local values', async () => {
      await render();
      expect(calls('voice:listVoices')).toEqual([]);
      expect(byTestId('voice-engine-model-tts').textContent?.trim()).toBe('af_heart');
      expect(byTestId('voice-engine-model-stt').textContent?.trim()).toBe('base.en');
      expect(byTestId('voice-engine-model-tts').getAttribute('title')).toBeNull();
    });
  });

  it('reports a not-downloaded local engine and a custom STT source', async () => {
    currentConfig = config({
      local: { ...config().local, modelSource: 'hf', customModel: 'org/whisper-x', sttDownloaded: false },
    });
    await render();
    expect(byTestId('voice-engine-status-stt').textContent).toContain('Not downloaded');
    expect(byTestId('voice-engine-model-stt').textContent).toContain('org/whisper-x');
  });

  it('keeps an unavailable provider disabled with its reason as visible text (V10)', async () => {
    responses['voice:listProviders'] = () => ok({ ok: true, providers: providers(false), active: { tts: 'local', stt: 'local' } });
    await render();
    byTestId<HTMLButtonElement>('voice-provider-btn-stt').click();
    fixture.detectChanges();

    const option = byTestId<HTMLButtonElement>('voice-provider-option-stt-elevenlabs');
    expect(option.disabled).toBe(true);
    expect(option.getAttribute('role')).toBe('radio');
    expect(byTestId('voice-provider-reason-stt-elevenlabs').textContent).toContain('API key not configured');
    expect(byTestId('voice-provider-option-stt-local').getAttribute('aria-checked')).toBe('true');
  });

  it('saves a provider on selection, re-reads config, and Undo writes the previous provider (V10/V11)', async () => {
    responses['voice:setProviderConfig'] = () => {
      currentConfig = config({ sttProvider: currentConfig.sttProvider === 'local' ? 'elevenlabs' : 'local' });
      return ok({ ok: true });
    };
    await render();
    await choose('stt', 'elevenlabs');

    expect(calls('voice:setProviderConfig')).toEqual([{ sttProvider: 'elevenlabs' }]);
    expect(calls('voice:getProviderConfig').length).toBe(2);
    expect(component.sttProviderId()).toBe('elevenlabs');
    expect(byTestId('voice-provider-btn-stt').textContent).toContain('ElevenLabs');
    expect(feedback.toast()).toEqual({ tone: 'status', message: 'Saved speech-to-text provider.', canUndo: true });

    await feedback.undo();
    await settle();
    expect(calls('voice:setProviderConfig')).toEqual([{ sttProvider: 'elevenlabs' }, { sttProvider: 'local' }]);
    expect(component.sttProviderId()).toBe('local');
  });

  /** Every way a host can fail: an RPC failure, an `{ ok:false, error }` answer, a thrown Error. */
  const HOST_FAILURES: ReadonlyArray<[string, Responder]> = [
    ['an RPC failure', () => fail('host detail')],
    ['an { ok:false, error } answer', () => ok({ ok: false, error: 'host detail' })],
    ['a thrown Error', () => { throw new Error('host detail'); }],
  ];

  it('reverts the row and raises an alert toast when the write fails (D15)', async () => {
    responses['voice:setProviderConfig'] = () => fail('backend refused');
    await render();
    await choose('tts', 'elevenlabs');

    expect(component.ttsProviderId()).toBe('local');
    expect(byTestId('voice-provider-btn-tts').textContent).toContain('Local');
    expect(feedback.toast()).toEqual({
      tone: 'alert', message: 'Could not save the text-to-speech engine.', canUndo: false,
    });
    const alert = byTestId('voice-config-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.classList).toContain('text-base-content');
  });

  it.each(HOST_FAILURES)('shows only a fixed sentence when a provider write fails with %s (F1)', async (_case, respond) => {
    responses['voice:setProviderConfig'] = respond;
    await render();
    await choose('stt', 'elevenlabs');

    expect(component.sttProviderId()).toBe('local');
    expect(byTestId('voice-config-error').textContent?.trim()).toBe('Could not save the speech-to-text engine.');
    expect(feedback.toast()).toEqual({
      tone: 'alert', message: 'Could not save the speech-to-text engine.', canUndo: false,
    });
    expect(element.textContent).not.toContain('host detail');
  });

  it.each(HOST_FAILURES)('shows only a fixed sentence when the config read fails with %s (F1)', async (_case, respond) => {
    responses['voice:getProviderConfig'] = respond;
    await render();
    expect(byTestId('voice-config-error').textContent?.trim()).toBe('Could not load the voice settings.');
    expect(element.textContent).not.toContain('host detail');
    expect(queryTestId('voice-engines-matrix')).toBeNull();
  });

  it.each(HOST_FAILURES)('shows only a fixed sentence when the provider list fails with %s (F1)', async (_case, respond) => {
    responses['voice:listProviders'] = respond;
    await render();
    expect(byTestId('voice-config-error').textContent?.trim()).toBe('Could not load the voice engines.');
    expect(element.textContent).not.toContain('host detail');
  });

  it('loads the drawer only when Details is used, on that direction\'s tab', async () => {
    await render();
    const [block] = await fixture.getDeferBlocks();
    expect(queryTestId('voice-details-drawer')).toBeNull();

    byTestId<HTMLButtonElement>('voice-engine-details-tts').click();
    expect(component.drawerDirection()).toBe('tts');
    await block.render(DeferBlockState.Complete);
    await settle();

    expect(document.querySelector('[data-testid="voice-details-drawer"]')).not.toBeNull();
    expect(document.querySelector('ptah-local-tts-panel')).not.toBeNull();
    expect(document.querySelector('ptah-local-stt-panel')).toBeNull();

    (document.querySelector('[data-testid="voice-details-close"]') as HTMLButtonElement).click();
    await settle();
    expect(component.drawerDirection()).toBeNull();
    expect(document.querySelector('[data-testid="voice-details-drawer"]')).toBeNull();
  });
});
