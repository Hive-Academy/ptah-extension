import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  createMockRpcService,
  rpcSuccess,
  type MockRpcService,
} from '@ptah-extension/core/testing';
import type { VoiceProviderConfigElevenLabsDto } from '@ptah-extension/shared';

import { ElevenLabsPanelComponent } from './elevenlabs-panel.component';

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

function routeRpc(
  rpc: MockRpcService,
  routes: Record<string, () => unknown>,
): void {
  rpc.call.mockImplementation((method: string) => {
    const handler = routes[method];
    if (handler) return Promise.resolve(handler());
    return Promise.resolve(rpcSuccess({ ok: true, voices: [] }));
  });
}

function mount(
  rpc: MockRpcService,
  direction: 'stt' | 'tts',
  config: VoiceProviderConfigElevenLabsDto,
): ComponentFixture<ElevenLabsPanelComponent> {
  TestBed.configureTestingModule({
    imports: [ElevenLabsPanelComponent],
    providers: [{ provide: ClaudeRpcService, useValue: rpc }],
  });
  const fixture = TestBed.createComponent(ElevenLabsPanelComponent);
  fixture.componentRef.setInput('direction', direction);
  fixture.componentRef.setInput('config', config);
  fixture.detectChanges();
  return fixture;
}

async function settle(
  fixture: ComponentFixture<ElevenLabsPanelComponent>,
): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

describe('ElevenLabsPanelComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('never renders a key value — the input is masked and empty even when configured', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listVoices': () => rpcSuccess({ ok: true, voices: [] }),
    });
    const fixture = mount(rpc, 'tts', elConfig({ apiKeyConfigured: true }));
    await settle(fixture);

    const input = fixture.nativeElement.querySelector(
      '[data-testid="elevenlabs-key-input"]',
    ) as HTMLInputElement;
    // SECURITY: masked and never seeded with the stored key.
    expect(input.type).toBe('password');
    expect(input.value).toBe('');

    // The configured state is a derived indicator, never the key itself.
    const badge = fixture.nativeElement.querySelector(
      '[data-testid="elevenlabs-key-configured"]',
    ) as HTMLElement;
    expect(badge.textContent).toContain('Configured');
    expect(badge.textContent).not.toContain('sk_');

    // No RPC we call ever returns key material; assert getProviderConfig-style
    // shape was never asked to surface a key here.
    expect(fixture.nativeElement.textContent).not.toMatch(/sk_[a-zA-Z0-9]/);
  });

  it('saves the draft key via voice:setApiKey and clears the input', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:setApiKey': () => rpcSuccess({ ok: true }),
      'voice:listVoices': () => rpcSuccess({ ok: true, voices: [] }),
    });
    const fixture = mount(rpc, 'tts', elConfig());
    const component = fixture.componentInstance;

    const input = fixture.nativeElement.querySelector(
      '[data-testid="elevenlabs-key-input"]',
    ) as HTMLInputElement;
    input.value = 'sk_secret_value';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector(
        '[data-testid="elevenlabs-key-save"]',
      ) as HTMLButtonElement
    ).click();
    await settle(fixture);

    expect(rpc.call).toHaveBeenCalledWith('voice:setApiKey', {
      providerId: 'elevenlabs',
      apiKey: 'sk_secret_value',
    });
    // Draft cleared after save so the key isn't retained in the DOM.
    expect(component.keyDraft()).toBe('');
    expect(input.value).toBe('');
  });

  it('tests the connection and renders a categorized failure', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:testConnection': () =>
        rpcSuccess({ ok: false, error: 'invalid key', category: 'auth' }),
      'voice:listVoices': () => rpcSuccess({ ok: true, voices: [] }),
    });
    const fixture = mount(rpc, 'tts', elConfig({ apiKeyConfigured: true }));
    await settle(fixture);

    (
      fixture.nativeElement.querySelector(
        '[data-testid="elevenlabs-test-btn"]',
      ) as HTMLButtonElement
    ).click();
    await settle(fixture);

    expect(rpc.call).toHaveBeenCalledWith('voice:testConnection', {
      providerId: 'elevenlabs',
    });
    const result = fixture.nativeElement.querySelector(
      '[data-testid="elevenlabs-test-result"]',
    ) as HTMLElement;
    expect(result.textContent).toContain('Authentication');
    expect(result.textContent).toContain('invalid key');
  });

  it('loads voices from voice:listVoices {providerId:elevenlabs} when a key is configured (tts)', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listVoices': () =>
        rpcSuccess({
          ok: true,
          voices: [{ id: 'v1', label: 'Rachel' }],
        }),
    });
    const fixture = mount(rpc, 'tts', elConfig({ apiKeyConfigured: true }));
    await settle(fixture);

    expect(rpc.call).toHaveBeenCalledWith('voice:listVoices', {
      providerId: 'elevenlabs',
    });
    const select = fixture.nativeElement.querySelector(
      '[data-testid="elevenlabs-voice-select"]',
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.querySelectorAll('option').length).toBe(1);
  });

  it('renders the STT model select (scribe_v1) and no download UI for the stt direction', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {});
    const fixture = mount(rpc, 'stt', elConfig({ apiKeyConfigured: true }));
    await settle(fixture);

    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="elevenlabs-stt-model-select"]',
      ),
    ).not.toBeNull();
    // No voice dropdown for the STT direction, and no download button anywhere.
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="elevenlabs-voice-select"]',
      ),
    ).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Download');
  });
});
