import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  createMockRpcService,
  rpcError,
  rpcSuccess,
  type MockRpcService,
} from '@ptah-extension/core/testing';
import type {
  VoiceProviderCapabilityDto,
  VoiceProviderConfigDto,
} from '@ptah-extension/shared';

import { VoiceConfigComponent } from './voice-config.component';

function providers(): VoiceProviderCapabilityDto[] {
  return [
    {
      id: 'local',
      label: 'Local (Whisper / Kokoro)',
      kind: 'local',
      requiresDownload: true,
      requiresApiKey: false,
      supports: { tts: true, stt: true },
      available: true,
    },
    {
      id: 'elevenlabs',
      label: 'ElevenLabs',
      kind: 'cloud',
      requiresDownload: false,
      requiresApiKey: true,
      supports: { tts: true, stt: true },
      available: false,
      unavailableReason: 'API key not configured',
    },
  ];
}

function config(
  overrides: Partial<VoiceProviderConfigDto> = {},
): VoiceProviderConfigDto {
  return {
    ttsProvider: 'local',
    sttProvider: 'local',
    local: {
      whisperModel: 'base.en',
      modelSource: 'curated',
      sttDownloaded: false,
      ttsDownloaded: false,
      ttsVoice: 'af_heart',
    },
    elevenlabs: {
      apiKeyConfigured: false,
      ttsModelId: 'eleven_multilingual_v2',
      outputFormat: 'mp3_44100_128',
      sttModelId: 'scribe_v1',
    },
    ...overrides,
  };
}

/** Route mock RPC responses by method name (order-independent). */
function routeRpc(
  rpc: MockRpcService,
  routes: Record<string, () => unknown>,
): void {
  rpc.call.mockImplementation((method: string) => {
    const handler = routes[method];
    if (handler) return Promise.resolve(handler());
    // Benign default for child-panel init calls (e.g. voice:listVoices).
    return Promise.resolve(rpcSuccess({ ok: true, voices: [] }));
  });
}

function mount(rpc: MockRpcService): {
  fixture: ComponentFixture<VoiceConfigComponent>;
  component: VoiceConfigComponent;
} {
  TestBed.configureTestingModule({
    imports: [VoiceConfigComponent],
    providers: [{ provide: ClaudeRpcService, useValue: rpc }],
  });
  const fixture = TestBed.createComponent(VoiceConfigComponent);
  return { fixture, component: fixture.componentInstance };
}

async function settle(
  fixture: ComponentFixture<VoiceConfigComponent>,
): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

function sttSelect(
  fixture: ComponentFixture<VoiceConfigComponent>,
): HTMLSelectElement {
  const el = fixture.nativeElement.querySelector(
    '[data-testid="voice-stt-provider-select"]',
  ) as HTMLSelectElement | null;
  if (!el) throw new Error('stt provider select not found');
  return el;
}

describe('VoiceConfigComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('loads providers + config and renders both provider selects', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listProviders': () =>
        rpcSuccess({
          ok: true,
          providers: providers(),
          active: { tts: 'local', stt: 'local' },
        }),
      'voice:getProviderConfig': () =>
        rpcSuccess({ ok: true, config: config() }),
    });

    const { fixture, component } = mount(rpc);
    fixture.detectChanges();
    await settle(fixture);

    expect(rpc.call).toHaveBeenCalledWith('voice:listProviders', {});
    expect(rpc.call).toHaveBeenCalledWith('voice:getProviderConfig', {});
    expect(component.sttProviderId()).toBe('local');
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="voice-tts-provider-select"]',
      ),
    ).not.toBeNull();
  });

  it('disables the option for an unavailable provider (FR-6.2)', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listProviders': () =>
        rpcSuccess({
          ok: true,
          providers: providers(),
          active: { tts: 'local', stt: 'local' },
        }),
      'voice:getProviderConfig': () =>
        rpcSuccess({ ok: true, config: config() }),
    });

    const { fixture } = mount(rpc);
    fixture.detectChanges();
    await settle(fixture);

    const option = sttSelect(fixture).querySelector(
      'option[value="elevenlabs"]',
    ) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect(option.title).toBe('API key not configured');
  });

  it('renders the local STT panel by default via @switch', async () => {
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listProviders': () =>
        rpcSuccess({
          ok: true,
          providers: providers(),
          active: { tts: 'local', stt: 'local' },
        }),
      'voice:getProviderConfig': () =>
        rpcSuccess({ ok: true, config: config() }),
    });

    const { fixture } = mount(rpc);
    fixture.detectChanges();
    await settle(fixture);

    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="local-stt-model-select"]',
      ),
    ).not.toBeNull();
    // No ElevenLabs panel while local is the active STT provider.
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="elevenlabs-stt-model-select"]',
      ),
    ).toBeNull();
  });

  it('switches provider via voice:setProviderConfig and re-reads config', async () => {
    const available = providers().map((p) =>
      p.id === 'elevenlabs' ? { ...p, available: true } : p,
    );
    const rpc = createMockRpcService();
    let currentConfig = config();
    routeRpc(rpc, {
      'voice:listProviders': () =>
        rpcSuccess({
          ok: true,
          providers: available,
          active: { tts: 'local', stt: 'local' },
        }),
      'voice:getProviderConfig': () =>
        rpcSuccess({ ok: true, config: currentConfig }),
      'voice:setProviderConfig': () => {
        currentConfig = config({ sttProvider: 'elevenlabs' });
        return rpcSuccess({ ok: true });
      },
    });

    const { fixture, component } = mount(rpc);
    fixture.detectChanges();
    await settle(fixture);

    const el = sttSelect(fixture);
    el.value = 'elevenlabs';
    el.dispatchEvent(new Event('change'));
    await settle(fixture);

    expect(rpc.call).toHaveBeenCalledWith('voice:setProviderConfig', {
      sttProvider: 'elevenlabs',
    });
    expect(component.sttProviderId()).toBe('elevenlabs');
    // The ElevenLabs STT panel is now rendered.
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="elevenlabs-stt-model-select"]',
      ),
    ).not.toBeNull();
  });

  it('reverts the optimistic provider change when the save fails', async () => {
    const available = providers().map((p) =>
      p.id === 'elevenlabs' ? { ...p, available: true } : p,
    );
    const rpc = createMockRpcService();
    routeRpc(rpc, {
      'voice:listProviders': () =>
        rpcSuccess({
          ok: true,
          providers: available,
          active: { tts: 'local', stt: 'local' },
        }),
      'voice:getProviderConfig': () =>
        rpcSuccess({ ok: true, config: config() }),
      'voice:setProviderConfig': () => rpcError('backend refused'),
    });

    const { fixture, component } = mount(rpc);
    fixture.detectChanges();
    await settle(fixture);

    const el = sttSelect(fixture);
    el.value = 'elevenlabs';
    el.dispatchEvent(new Event('change'));
    await settle(fixture);

    expect(component.sttProviderId()).toBe('local');
    expect(component.errorMessage()).toBe('backend refused');
  });
});
