import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  createMockRpcService,
  rpcSuccess,
  type MockRpcService,
} from '@ptah-extension/core/testing';
import type { VoiceProviderConfigLocalDto } from '@ptah-extension/shared';

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

function routeRpc(
  rpc: MockRpcService,
  routes: Record<string, () => unknown>,
): void {
  rpc.call.mockImplementation((method: string) => {
    const handler = routes[method];
    if (handler) return Promise.resolve(handler());
    return Promise.resolve(rpcSuccess({ ok: true }));
  });
}

function mount(
  rpc: MockRpcService,
  config: VoiceProviderConfigLocalDto,
): ComponentFixture<LocalTtsPanelComponent> {
  TestBed.configureTestingModule({
    imports: [LocalTtsPanelComponent],
    providers: [{ provide: ClaudeRpcService, useValue: rpc }],
  });
  const fixture = TestBed.createComponent(LocalTtsPanelComponent);
  fixture.componentRef.setInput('config', config);
  fixture.detectChanges();
  return fixture;
}

async function settle(
  fixture: ComponentFixture<LocalTtsPanelComponent>,
): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

describe('LocalTtsPanelComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('fetches voices from voice:listVoices {providerId:local} and renders them', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listVoices': () =>
        rpcSuccess({
          ok: true,
          voices: [
            { id: 'af_heart', label: 'Heart', category: 'American English' },
            { id: 'bf_emma', label: 'Emma', category: 'British English' },
          ],
        }),
    });

    const fixture = mount(rpc, localConfig());
    await settle(fixture);

    expect(rpc.call).toHaveBeenCalledWith('voice:listVoices', {
      providerId: 'local',
    });
    const options = fixture.nativeElement.querySelectorAll(
      '[data-testid="local-tts-voice-select"] option',
    );
    expect(options.length).toBe(2);
    const groups = fixture.nativeElement.querySelectorAll(
      '[data-testid="local-tts-voice-select"] optgroup',
    );
    expect(groups.length).toBe(2);
  });

  it('persists a voice change via voice:setTtsConfig with the current model source', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listVoices': () =>
        rpcSuccess({
          ok: true,
          voices: [
            { id: 'af_heart', label: 'Heart' },
            { id: 'bf_emma', label: 'Emma' },
          ],
        }),
      'voice:setTtsConfig': () => rpcSuccess({ ok: true }),
    });

    const fixture = mount(rpc, localConfig());
    await settle(fixture);

    const select = fixture.nativeElement.querySelector(
      '[data-testid="local-tts-voice-select"]',
    ) as HTMLSelectElement;
    select.value = 'bf_emma';
    select.dispatchEvent(new Event('change'));
    await settle(fixture);

    expect(rpc.call).toHaveBeenCalledWith('voice:setTtsConfig', {
      voice: 'bf_emma',
      modelSource: 'curated',
    });
  });

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

    const fixture = mount(rpc, localConfig());
    await settle(fixture);
    const component = fixture.componentInstance;

    expect(rpc.call).toHaveBeenCalledWith('voice:getTtsConfig', {});
    expect(component.source()).toBe('hf');
    expect(component.customModel()).toBe('owner/kokoro-custom');

    // The custom input is rendered (not the curated-only layout).
    const input = fixture.nativeElement.querySelector(
      '[data-testid="local-tts-custom-input"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('owner/kokoro-custom');
  });

  it('shows the custom input for the HF source and validates repo id shape', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listVoices': () => rpcSuccess({ ok: true, voices: [] }),
      'voice:setTtsConfig': () => rpcSuccess({ ok: true }),
    });

    const fixture = mount(rpc, localConfig());
    await settle(fixture);
    const component = fixture.componentInstance;

    // Switch to HF source.
    (
      fixture.nativeElement.querySelector(
        '[data-testid="local-tts-source-hf"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      '[data-testid="local-tts-custom-input"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();

    // Invalid (no slash) → validation fails.
    input.value = 'not-a-repo';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(component.customModelValid()).toBe(false);

    // Valid owner/name → validation passes.
    input.value = 'owner/kokoro-model';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(component.customModelValid()).toBe(true);

    (
      fixture.nativeElement.querySelector(
        '[data-testid="local-tts-custom-save"]',
      ) as HTMLButtonElement
    ).click();
    await settle(fixture);

    expect(rpc.call).toHaveBeenCalledWith('voice:setTtsConfig', {
      voice: 'af_heart',
      modelSource: 'hf',
      customModel: 'owner/kokoro-model',
    });
  });

  it('switching back to curated persists immediately with modelSource:curated', async () => {
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

    const fixture = mount(rpc, localConfig());
    await settle(fixture);

    (
      fixture.nativeElement.querySelector(
        '[data-testid="local-tts-source-curated"]',
      ) as HTMLButtonElement
    ).click();
    await settle(fixture);

    expect(fixture.componentInstance.source()).toBe('curated');
    expect(rpc.call).toHaveBeenCalledWith('voice:setTtsConfig', {
      voice: 'af_heart',
      modelSource: 'curated',
    });
    // Custom input disappears once curated is active.
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="local-tts-custom-input"]',
      ),
    ).toBeNull();
  });

  it('downloads the TTS model with the tts progress sentinel preserved', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listVoices': () => rpcSuccess({ ok: true, voices: [] }),
      'voice:downloadTtsModel': () =>
        rpcSuccess({ ok: true, alreadyPresent: false }),
    });

    const fixture = mount(rpc, localConfig());
    await settle(fixture);

    (
      fixture.nativeElement.querySelector(
        '[data-testid="local-tts-download-btn"]',
      ) as HTMLButtonElement
    ).click();
    await settle(fixture);

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

    const fixture = mount(rpc, localConfig());
    await settle(fixture);

    const btn = fixture.nativeElement.querySelector(
      '[data-testid="local-tts-download-btn"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(fixture.componentInstance.canDownload()).toBe(false);
  });
});
