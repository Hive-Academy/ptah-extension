import {
  VoiceAssetsUnavailableError,
  VOICE_ASSETS_UNAVAILABLE,
  VOICE_ASSETS_REMEDIATION,
  isModuleNotFound,
  isVoiceAssetsUnavailable,
} from './voice-assets-error';

describe('VoiceAssetsUnavailableError', () => {
  it('carries the structured code and remediation hint', () => {
    const err = new VoiceAssetsUnavailableError('ffmpeg-static');
    expect(err.code).toBe(VOICE_ASSETS_UNAVAILABLE);
    expect(err.remediation).toBe(VOICE_ASSETS_REMEDIATION);
    expect(err.message).toContain('ffmpeg-static');
    expect(err.message).toContain(VOICE_ASSETS_REMEDIATION);
    expect(err).toBeInstanceOf(Error);
  });

  it('preserves the underlying cause when provided', () => {
    const cause = new Error('boom');
    const err = new VoiceAssetsUnavailableError('nodejs-whisper', cause);
    expect((err as { cause?: unknown }).cause).toBe(cause);
  });

  it('isVoiceAssetsUnavailable recognises the typed error', () => {
    expect(
      isVoiceAssetsUnavailable(
        new VoiceAssetsUnavailableError('ffmpeg-static'),
      ),
    ).toBe(true);
    expect(isVoiceAssetsUnavailable(new Error('other'))).toBe(false);
    expect(isVoiceAssetsUnavailable(null)).toBe(false);
  });

  it('isVoiceAssetsUnavailable recognises a duck-typed code', () => {
    expect(isVoiceAssetsUnavailable({ code: VOICE_ASSETS_UNAVAILABLE })).toBe(
      true,
    );
  });

  it('isModuleNotFound detects both CJS and ESM module-not-found codes', () => {
    expect(isModuleNotFound({ code: 'MODULE_NOT_FOUND' })).toBe(true);
    expect(isModuleNotFound({ code: 'ERR_MODULE_NOT_FOUND' })).toBe(true);
    expect(isModuleNotFound({ code: 'OTHER' })).toBe(false);
    expect(isModuleNotFound(undefined)).toBe(false);
  });
});
