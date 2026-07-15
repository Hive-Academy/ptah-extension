import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  createMockRpcService,
  rpcError,
  rpcSuccess,
  type MockRpcService,
} from '@ptah-extension/core/testing';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { VoiceProviderErrorPayload } from '@ptah-extension/shared';

import { VoiceProviderErrorToastComponent } from './voice-provider-error-toast.component';
import { VoiceProviderErrorService } from '../../../services/voice-provider-error.service';

function emit(
  service: VoiceProviderErrorService,
  overrides: Partial<VoiceProviderErrorPayload> = {},
): void {
  service.handleMessage({
    type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR,
    payload: {
      direction: 'tts',
      providerId: 'elevenlabs',
      category: 'quota',
      message: 'quota exceeded',
      ...overrides,
    },
  });
}

function mount(rpc: MockRpcService): {
  fixture: ComponentFixture<VoiceProviderErrorToastComponent>;
  service: VoiceProviderErrorService;
} {
  TestBed.configureTestingModule({
    imports: [VoiceProviderErrorToastComponent],
    providers: [{ provide: ClaudeRpcService, useValue: rpc }],
  });
  const fixture = TestBed.createComponent(VoiceProviderErrorToastComponent);
  const service = TestBed.inject(VoiceProviderErrorService);
  return { fixture, service };
}

async function settle(
  fixture: ComponentFixture<VoiceProviderErrorToastComponent>,
): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

describe('VoiceProviderErrorToastComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders nothing until an error arrives', () => {
    const rpc = createMockRpcService();
    const { fixture } = mount(rpc);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="voice-provider-error-toast"]',
      ),
    ).toBeNull();
  });

  it('renders the categorized error message when one is present', () => {
    const rpc = createMockRpcService();
    const { fixture, service } = mount(rpc);
    emit(service, { category: 'quota', message: 'quota exceeded' });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="voice-provider-error-toast"]',
      ),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="voice-provider-error-message"]',
      )?.textContent,
    ).toContain('quota exceeded');
  });

  it('switch-to-local invokes voice:setProviderConfig for the failing direction, re-reads config, and dismisses', async () => {
    const rpc = createMockRpcService();
    rpc.call.mockResolvedValue(rpcSuccess({ ok: true }));
    const { fixture, service } = mount(rpc);
    emit(service, { direction: 'stt' });
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector(
        '[data-testid="voice-provider-switch-local"]',
      ) as HTMLButtonElement
    ).click();
    await settle(fixture);

    expect(rpc.call).toHaveBeenCalledWith('voice:setProviderConfig', {
      sttProvider: 'local',
    });
    expect(rpc.call).toHaveBeenCalledWith('voice:getProviderConfig', {});
    // Dismissed → signal cleared and toast removed.
    expect(service.latestError()).toBeNull();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="voice-provider-error-toast"]',
      ),
    ).toBeNull();
  });

  it('keeps the toast and shows an error when the switch fails', async () => {
    const rpc = createMockRpcService();
    rpc.call.mockResolvedValue(rpcError('backend down'));
    const { fixture, service } = mount(rpc);
    emit(service, { direction: 'tts' });
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector(
        '[data-testid="voice-provider-switch-local"]',
      ) as HTMLButtonElement
    ).click();
    await settle(fixture);

    expect(rpc.call).toHaveBeenCalledWith('voice:setProviderConfig', {
      ttsProvider: 'local',
    });
    expect(service.latestError()).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="voice-provider-switch-error"]',
      )?.textContent,
    ).toContain('backend down');
  });

  it('dismiss clears the error without switching providers', () => {
    const rpc = createMockRpcService();
    const { fixture, service } = mount(rpc);
    emit(service);
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector(
        '[aria-label="Dismiss voice provider error"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(service.latestError()).toBeNull();
    expect(rpc.call).not.toHaveBeenCalledWith(
      'voice:setProviderConfig',
      expect.anything(),
    );
  });
});
