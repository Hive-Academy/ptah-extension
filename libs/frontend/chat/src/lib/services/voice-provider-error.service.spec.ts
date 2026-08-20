import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { VoiceProviderErrorPayload } from '@ptah-extension/shared';

import { VoiceProviderErrorService } from './voice-provider-error.service';

function payload(
  overrides: Partial<VoiceProviderErrorPayload> = {},
): VoiceProviderErrorPayload {
  return {
    direction: 'tts',
    providerId: 'elevenlabs',
    category: 'auth',
    message: 'invalid key',
    ...overrides,
  };
}

describe('VoiceProviderErrorService', () => {
  let service: VoiceProviderErrorService;

  beforeEach(() => {
    service = new VoiceProviderErrorService();
  });

  it('declares the VOICE_PROVIDER_ERROR message type', () => {
    expect(service.handledMessageTypes).toEqual([
      MESSAGE_TYPES.VOICE_PROVIDER_ERROR,
    ]);
  });

  it('captures the latest error payload from a matching message', () => {
    service.handleMessage({
      type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR,
      payload: payload({ category: 'quota', message: 'quota exceeded' }),
    });
    expect(service.latestError()?.category).toBe('quota');
    expect(service.latestError()?.message).toBe('quota exceeded');
  });

  it('ignores unrelated message types and missing payloads', () => {
    service.handleMessage({ type: 'something:else', payload: payload() });
    expect(service.latestError()).toBeNull();

    service.handleMessage({ type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR });
    expect(service.latestError()).toBeNull();
  });

  it('clears the error on dismiss', () => {
    service.handleMessage({
      type: MESSAGE_TYPES.VOICE_PROVIDER_ERROR,
      payload: payload(),
    });
    expect(service.latestError()).not.toBeNull();

    service.dismiss();
    expect(service.latestError()).toBeNull();
  });
});
