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

  it('ignores tail samples from a discarded utterance and emits a null clip', async () => {
    const originalNode = globalThis.AudioWorkletNode;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const port: {
      onmessage:
        | ((
            event: MessageEvent<{
              kind: string;
              id: number;
              samples?: Float32Array;
            }>,
          ) => void)
        | null;
      postMessage: jest.Mock;
      close: jest.Mock;
    } = {
      onmessage: null,
      postMessage: jest.fn(),
      close: jest.fn(),
    };
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
      configurable: true,
      value: jest.fn(() => ({
        port,
        connect: jest.fn(),
        disconnect: jest.fn(),
      })),
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: () => 'blob:test',
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: jest.fn(),
    });
    const onClip = jest.fn();
    const capture = new PcmCapture(jest.fn(), onClip, {
      getUserMedia: async () =>
        Object.assign(Object.create(null) as MediaStream, {
          getTracks: () => [],
        }),
      audioContext: () =>
        Object.assign(Object.create(null) as AudioContext, {
          audioWorklet: { addModule: async () => undefined },
          createMediaStreamSource: () => ({
            connect: jest.fn(),
            disconnect: jest.fn(),
          }),
          destination: {},
          sampleRate: 48000,
          close: async () => undefined,
        }),
    });
    try {
      await capture.start();
      capture.beginUtterance();
      const id = port.postMessage.mock.calls[0][0].id as number;
      capture.discardUtterance();
      port.onmessage?.({
        data: { kind: 'samples', id, samples: new Float32Array(128) },
      } as MessageEvent<{ kind: string; id: number; samples?: Float32Array }>);
      port.onmessage?.({ data: { kind: 'end', id } } as MessageEvent<{
        kind: string;
        id: number;
        samples?: Float32Array;
      }>);
      expect(onClip).toHaveBeenCalledTimes(1);
      expect(onClip).toHaveBeenCalledWith(null);
      await capture.stop();
    } finally {
      Object.defineProperty(globalThis, 'AudioWorkletNode', {
        configurable: true,
        value: originalNode,
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
