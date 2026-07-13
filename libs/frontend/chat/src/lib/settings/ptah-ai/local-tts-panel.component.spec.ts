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

  it('persists a voice change via voice:setTtsConfig', async () => {
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
    });
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
});
