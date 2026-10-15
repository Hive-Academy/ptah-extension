import { CaptureError, PcmCapture } from './pcm-capture';

describe('PcmCapture', () => {
  it('requests the microphone processing constraints and classifies denial', async () => {
    const getUserMedia = jest
      .fn()
      .mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    const capture = new PcmCapture(jest.fn(), jest.fn(), {
      getUserMedia,
      audioContext: jest.fn(),
    });
    await expect(capture.start()).rejects.toEqual(new CaptureError('denied'));
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  });

  it('does not request a second stream after start is already active', async () => {
    const stream = Object.assign(Object.create(null) as MediaStream, {
      getTracks: () => [],
    });
    const getUserMedia = jest.fn().mockResolvedValue(stream);
    const context = {
      audioWorklet: { addModule: jest.fn().mockResolvedValue(undefined) },
      createMediaStreamSource: () => ({
        connect: jest.fn(),
        disconnect: jest.fn(),
      }),
      destination: {},
      sampleRate: 48000,
      close: jest.fn().mockResolvedValue(undefined),
    };
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const revoke = jest.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: () => 'blob:test',
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revoke,
    });
    const original = globalThis.AudioWorkletNode;
    const node = {
      port: { onmessage: null, postMessage: jest.fn(), close: jest.fn() },
      connect: jest.fn(),
      disconnect: jest.fn(),
    };
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
      configurable: true,
      value: jest.fn(() => node),
    });
    try {
      const capture = new PcmCapture(jest.fn(), jest.fn(), {
        getUserMedia,
        audioContext: () =>
          Object.assign(Object.create(null) as AudioContext, context),
      });
      await capture.start();
      await capture.start();
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      await capture.stop();
      expect(context.close).toHaveBeenCalledTimes(1);
      expect(revoke).toHaveBeenCalledWith('blob:test');
    } finally {
      Object.defineProperty(globalThis, 'AudioWorkletNode', {
        configurable: true,
        value: original,
      });
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreate,
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevoke,
      });
    }
  });
});
