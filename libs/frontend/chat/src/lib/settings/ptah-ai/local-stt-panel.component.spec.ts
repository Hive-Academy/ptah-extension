import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  createMockRpcService,
  rpcError,
  rpcSuccess,
  type MockRpcService,
} from '@ptah-extension/core/testing';
import type { VoiceProviderConfigLocalDto } from '@ptah-extension/shared';

import { LocalSttPanelComponent } from './local-stt-panel.component';
import { VoiceDownloadProgressService } from '../../services/voice-download-progress.service';

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

function mount(
  rpc: MockRpcService,
  config: VoiceProviderConfigLocalDto,
): ComponentFixture<LocalSttPanelComponent> {
  TestBed.configureTestingModule({
    imports: [LocalSttPanelComponent],
    providers: [{ provide: ClaudeRpcService, useValue: rpc }],
  });
  const fixture = TestBed.createComponent(LocalSttPanelComponent);
  fixture.componentRef.setInput('config', config);
  fixture.detectChanges();
  return fixture;
}

async function settle(
  fixture: ComponentFixture<LocalSttPanelComponent>,
): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

describe('LocalSttPanelComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders the curated model select seeded from the config input', () => {
    const rpc = createMockRpcService();
    const fixture = mount(rpc, localConfig({ whisperModel: 'small.en' }));

    const select = fixture.nativeElement.querySelector(
      '[data-testid="local-stt-model-select"]',
    ) as HTMLSelectElement;
    expect(select.value).toBe('small.en');
  });

  it('persists a curated model change via voice:setConfig', async () => {
    const rpc = createMockRpcService();
    rpc.call.mockResolvedValue(rpcSuccess({ ok: true }));
    const fixture = mount(rpc, localConfig());

    const select = fixture.nativeElement.querySelector(
      '[data-testid="local-stt-model-select"]',
    ) as HTMLSelectElement;
    select.value = 'medium';
    select.dispatchEvent(new Event('change'));
    await settle(fixture);

    expect(rpc.call).toHaveBeenCalledWith('voice:setConfig', {
      whisperModel: 'medium',
      modelSource: 'curated',
    });
  });

  it('shows the custom input for the HF source and validates repo id shape', async () => {
    const rpc = createMockRpcService();
    rpc.call.mockResolvedValue(rpcSuccess({ ok: true }));
    const fixture = mount(rpc, localConfig());
    const component = fixture.componentInstance;

    // Switch to HF source.
    (
      fixture.nativeElement.querySelector(
        '[data-testid="local-stt-source-hf"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector(
      '[data-testid="local-stt-custom-input"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();

    // Invalid (no slash) → save disabled.
    input.value = 'not-a-repo';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(component.customModelValid()).toBe(false);

    // Valid owner/name → save enabled and persisted with modelSource + customModel.
    input.value = 'openai/whisper-base';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(component.customModelValid()).toBe(true);

    (
      fixture.nativeElement.querySelector(
        '[data-testid="local-stt-custom-save"]',
      ) as HTMLButtonElement
    ).click();
    await settle(fixture);

    expect(rpc.call).toHaveBeenCalledWith('voice:setConfig', {
      whisperModel: 'base.en',
      modelSource: 'hf',
      customModel: 'openai/whisper-base',
    });
  });

  it('downloads keyed by the curated model name and maps progress', async () => {
    const rpc = createMockRpcService();
    rpc.call.mockResolvedValue(rpcSuccess({ ok: true, alreadyPresent: false }));
    const fixture = mount(rpc, localConfig({ whisperModel: 'small.en' }));
    const component = fixture.componentInstance;

    const progress = TestBed.inject(VoiceDownloadProgressService);
    progress.handleMessage({
      type: 'voice:modelDownloadProgress',
      payload: { model: 'small.en', percent: 42 },
    });
    expect(component.downloadPercent()).toBe(42);

    (
      fixture.nativeElement.querySelector(
        '[data-testid="local-stt-download-btn"]',
      ) as HTMLButtonElement
    ).click();
    await settle(fixture);

    expect(rpc.call).toHaveBeenCalledWith(
      'voice:downloadModel',
      { model: 'small.en' },
      { timeout: expect.any(Number) },
    );
  });

  it('surfaces an error when saving fails', async () => {
    const rpc = createMockRpcService();
    rpc.call.mockResolvedValue(rpcError('disk full'));
    const fixture = mount(rpc, localConfig());
    const component = fixture.componentInstance;

    const select = fixture.nativeElement.querySelector(
      '[data-testid="local-stt-model-select"]',
    ) as HTMLSelectElement;
    select.value = 'medium';
    select.dispatchEvent(new Event('change'));
    await settle(fixture);

    expect(component.errorMessage()).toBe('disk full');
  });
});
