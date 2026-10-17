import { CommandVoiceLoop } from './command-voice-loop';
import { CommandCenterStore } from '../model/command-center.store';
import type { CommandCenterSessionCoordinator } from '../model/session-coordinator';
import type { ClaudeRpcService } from '@ptah-extension/core';

describe('CommandVoiceLoop', () => {
  const frames = new Float32Array(128).fill(0.2);
  const silence = new Float32Array(128);

  describe('speech playback state', () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    let state: string;
    let resolveSpeech: () => void;
    let ended: () => void;
    let stopAudio: jest.Mock;
    let pendingInput: ReturnType<CommandCenterStore['pendingInput']>;

    beforeEach(() => {
      state = 'thinking';
      ended = () => undefined;
      stopAudio = jest.fn();
      pendingInput = null;
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: () => 'blob:voice-state',
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: jest.fn(),
      });
    });

    afterEach(() => {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreate,
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevoke,
      });
    });

    function createLoop(): CommandVoiceLoop {
      const synthesis = new Promise<void>((resolve) => {
        resolveSpeech = resolve;
      });
      const store = Object.assign(Object.create(null) as CommandCenterStore, {
        voiceState: () => state,
        setVoiceState: (next: string) => {
          state = next;
        },
        setMuted: jest.fn(),
        updateLevels: jest.fn(),
        resetLevels: jest.fn(),
        pendingInput: () => pendingInput,
      });
      const coordinator = Object.assign(
        Object.create(null) as CommandCenterSessionCoordinator,
        {
          mute: () => {
            state = 'muted';
          },
          stop: () => {
            state = 'stopped';
          },
        },
      );
      const rpc = Object.assign(Object.create(null) as ClaudeRpcService, {
        call: jest.fn().mockImplementation(async () => {
          await synthesis;
          return {
            success: true,
            data: { ok: true, audioBase64: 'AA==', mimeType: 'audio/wav' },
          };
        }),
      });
      const loop = new CommandVoiceLoop(store, coordinator, rpc, {
        sendTranscript: async () => true,
        audioFactory: () => ({
          play: () => Promise.resolve(),
          stop: stopAudio,
          onEnded: (callback) => {
            ended = callback;
          },
        }),
      });
      loop['active'] = true;
      return loop;
    }

    async function startPlayback(loop: CommandVoiceLoop): Promise<void> {
      loop['speak']('A spoken reply.', 'reply');
      loop['finishTurn']();
      expect(state).toBe('thinking');
      loop['onFrame'](silence, 0);
      expect(state).toBe('thinking');
      resolveSpeech();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(state).toBe('speaking');
    }

    it('stays thinking during synthesis, speaks through mic frames, then listens after playback', async () => {
      const loop = createLoop();
      await startPlayback(loop);
      loop['onFrame'](silence, 100);
      expect(state).toBe('speaking');
      ended();
      expect(state).toBe('listening');
    });

    it('listens after a pending prompt ends while the turn awaits its boundary', async () => {
      const loop = createLoop();
      pendingInput = {
        id: 'question-1',
        kind: 'question',
        title: 'Choose',
        description: 'Pick an option',
      };
      loop['busy'] = true;
      loop['awaitingBoundary'] = true;
      loop.onPendingPrompt('Choose an option.');
      resolveSpeech();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(state).toBe('speaking');
      ended();
      expect(state).toBe('listening');
    });

    it('returns to thinking after status speech while a turn still runs', async () => {
      const loop = createLoop();
      loop['busy'] = true;
      loop['awaitingBoundary'] = true;
      loop.onPendingPrompt('Working on the request.');
      resolveSpeech();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(state).toBe('speaking');
      ended();
      expect(state).toBe('thinking');
    });

    it('listens after barge-in during a busy turn with pending input', async () => {
      const loop = createLoop();
      pendingInput = {
        id: 'question-2',
        kind: 'question',
        title: 'Choose',
        description: 'Pick an option',
      };
      loop['busy'] = true;
      loop['awaitingBoundary'] = true;
      loop.onPendingPrompt('Choose an option.');
      resolveSpeech();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(state).toBe('speaking');
      loop.interruptSpeech();
      expect(stopAudio).toHaveBeenCalledTimes(1);
      expect(state).toBe('listening');
    });

    it('returns to listening when barge-in stops playback', async () => {
      const loop = createLoop();
      await startPlayback(loop);
      loop['onFrame'](frames, 0);
      loop['onFrame'](frames, 301);
      expect(state).toBe('speaking');
      loop['onFrame'](frames, 552);
      expect(stopAudio).toHaveBeenCalledTimes(1);
      expect(state).toBe('listening');
    });

    it('ends speaking on mute and stop', async () => {
      const loop = createLoop();
      await startPlayback(loop);
      await loop.mute();
      expect(stopAudio).toHaveBeenCalledTimes(1);
      expect(state).toBe('muted');
      ended();
      expect(state).toBe('muted');

      const stoppedLoop = createLoop();
      await startPlayback(stoppedLoop);
      await stoppedLoop.stop();
      expect(state).toBe('stopped');
    });
  });

  it.each(['rejects', 'fails'] as const)(
    'clears stale provider labels when config RPC %s',
    async (failure) => {
      const store = new CommandCenterStore();
      store.setProvider({
        transcription: true,
        synthesis: true,
        stt: {
          providerId: 'local',
          providerLabel: 'Local',
          modelLabel: 'whisper',
          ready: true,
          status: 'Ready',
        },
        tts: {
          providerId: 'elevenlabs',
          providerLabel: 'ElevenLabs',
          modelLabel: 'Voice',
          ready: true,
          status: 'Ready',
        },
      });
      const rpc = {
        call:
          failure === 'rejects'
            ? jest.fn().mockRejectedValue(new Error('offline'))
            : jest.fn().mockResolvedValue({ success: false }),
      };
      const loop = new CommandVoiceLoop(
        store,
        Object.create(null) as CommandCenterSessionCoordinator,
        Object.assign(Object.create(null) as ClaudeRpcService, rpc),
        { sendTranscript: async () => true },
      );
      await expect(loop.start()).resolves.toBe(false);
      expect(store.provider()).toEqual({
        transcription: false,
        synthesis: false,
        stt: null,
        tts: null,
      });
    },
  );

  it('keeps provider labels after voice starts', async () => {
    const originalNode = globalThis.AudioWorkletNode;
    const store = new CommandCenterStore();
    const context = Object.assign(Object.create(null) as AudioContext, {
      audioWorklet: { addModule: jest.fn().mockResolvedValue(undefined) },
      createMediaStreamSource: () => ({
        connect: jest.fn(),
        disconnect: jest.fn(),
      }),
      destination: {},
      close: jest.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
      configurable: true,
      value: jest.fn(() => ({
        port: { onmessage: null, close: jest.fn() },
        connect: jest.fn(),
        disconnect: jest.fn(),
      })),
    });
    const loop = new CommandVoiceLoop(
      store,
      Object.assign(Object.create(null) as CommandCenterSessionCoordinator, {
        startVoice: jest.fn(),
      }),
      Object.assign(Object.create(null) as ClaudeRpcService, {
        call: jest.fn().mockResolvedValue({
          success: true,
          data: {
            ok: true,
            config: {
              sttProvider: 'local',
              ttsProvider: 'local',
              local: {
                sttDownloaded: true,
                ttsDownloaded: true,
                modelSource: 'curated',
                whisperModel: 'tiny',
                ttsVoice: 'nova',
              },
              elevenlabs: { apiKeyConfigured: false },
            },
          },
        }),
      }),
      {
        sendTranscript: async () => true,
        captureFactories: {
          getUserMedia: async () =>
            Object.assign(Object.create(null) as MediaStream, {
              getTracks: () => [],
            }),
          audioContext: () => context,
        },
      },
    );
    try {
      await expect(loop.start()).resolves.toBe(true);
      expect(store.provider()).toEqual({
        transcription: true,
        synthesis: true,
        stt: {
          providerId: 'local',
          providerLabel: 'Local',
          modelLabel: 'tiny',
          ready: true,
          status: 'Ready',
        },
        tts: {
          providerId: 'local',
          providerLabel: 'Local',
          modelLabel: 'nova',
          ready: true,
          status: 'Ready',
        },
      });
    } finally {
      await loop.exit();
      Object.defineProperty(globalThis, 'AudioWorkletNode', {
        configurable: true,
        value: originalNode,
      });
    }
  });

  it('ignores Mute before voice has started', async () => {
    const store = new CommandCenterStore();
    const mute = jest.fn();
    const rpc = { call: jest.fn() };
    const loop = new CommandVoiceLoop(
      store,
      Object.assign(Object.create(null) as CommandCenterSessionCoordinator, {
        mute,
      }),
      Object.assign(Object.create(null) as ClaudeRpcService, rpc),
      { sendTranscript: async () => true },
    );
    await loop.mute();
    expect(mute).not.toHaveBeenCalled();
    expect(store.muted()).toBe(false);
    expect(store.voiceState()).toBe('idle');
    expect(rpc.call).not.toHaveBeenCalled();
  });

  it('rejects a boundary carrying an older voice turn token', () => {
    const { loop } = frameLoop();
    loop['generation'] = 1;
    loop['turnGeneration'] = 1;
    loop['awaitingBoundary'] = true;
    loop['awaitingTurnToken'] = 2;
    loop['speak'] = jest.fn();
    loop.onTurnBoundary('Older reply.', 1);
    expect(loop['awaitingBoundary']).toBe(true);
    expect(loop['lastReply']).toBe('');
    loop.onTurnBoundary('Current reply.', 2);
    expect(loop['lastReply']).toBe('Current reply.');
  });

  it('arms one typed turn only while active and rejects a stale token', () => {
    const { loop } = frameLoop();
    loop['speak'] = jest.fn();
    loop['active'] = false;
    loop.armTypedTurn();
    expect(loop['awaitingBoundary']).toBe(false);
    loop['active'] = true;
    loop.armTypedTurn();
    expect(loop['awaitingTurnToken']).toBe(1);
    loop.onTurnBoundary('Stale', 0);
    expect(loop['awaitingBoundary']).toBe(true);
    loop.onTurnBoundary('Current', 1);
    expect(loop['lastReply']).toBe('Current');
    expect(loop['awaitingBoundary']).toBe(false);
    loop.onTurnBoundary('Duplicate', 1);
    expect(loop['lastReply']).toBe('Current');
  });

  it('queues a typed turn behind a voice boundary and arms token 2 after token 1', () => {
    const { loop } = frameLoop();
    const armed: number[] = [];
    Object.assign(loop['options'], {
      onVoiceSend: (token: number) => armed.push(token),
    });
    loop['speak'] = jest.fn();
    loop['active'] = true;
    loop['turnGeneration'] = loop['generation'];
    loop['awaitingBoundary'] = true;
    loop['awaitingTurnToken'] = 1;
    loop['nextVoiceTurnToken'] = 1;
    loop.armTypedTurn();
    expect(loop['awaitingTurnToken']).toBe(1);
    expect(armed).toEqual([]);
    loop.onTurnBoundary('Voice reply', 1);
    expect(armed).toEqual([2]);
    expect(loop['awaitingTurnToken']).toBe(2);
    loop.onTurnBoundary('Typed reply', 2);
    expect(loop['lastReply']).toBe('Typed reply');
  });

  it('queues typed input during transcription and arms it after the voice reply', () => {
    const { loop } = frameLoop();
    const armed: number[] = [];
    Object.assign(loop['options'], {
      onVoiceSend: (token: number) => armed.push(token),
    });
    loop['active'] = true;
    loop['busy'] = true;
    loop['turnGeneration'] = loop['generation'];
    loop.armTypedTurn();
    expect(loop['queuedTypedTurns']).toHaveLength(1);
    expect(armed).toEqual([]);
    loop['awaitingBoundary'] = true;
    loop['awaitingTurnToken'] = 1;
    loop['nextVoiceTurnToken'] = 1;
    loop['speak'] = jest.fn();
    loop.onTurnBoundary('Voice reply', 1);
    expect(armed).toEqual([2]);
    loop.onTurnBoundary('Typed reply', 2);
    expect(loop['lastReply']).toBe('Typed reply');
  });

  it('keeps each queued typed turn pre-send sequence in FIFO order', () => {
    const { loop } = frameLoop();
    const armed = jest.fn();
    Object.assign(loop['options'], { onVoiceSend: armed });
    loop['speak'] = jest.fn();
    loop['busy'] = true;
    loop.armTypedTurn(5);
    loop.armTypedTurn(9);
    loop['awaitingBoundary'] = true;
    loop['turnGeneration'] = loop['generation'];
    loop['awaitingTurnToken'] = 1;
    loop['nextVoiceTurnToken'] = 1;

    loop.onTurnBoundary('Voice reply', 1);
    loop.onTurnBoundary('First typed reply', 2);
    loop.onTurnBoundary('Second typed reply', 3);

    expect(armed.mock.calls).toEqual([
      [2, 5],
      [3, 9],
    ]);
    expect(loop['lastReply']).toBe('Second typed reply');
  });

  it('holds a clip behind an already armed typed turn', async () => {
    const { loop } = frameLoop();
    loop['speak'] = jest.fn();
    loop.armTypedTurn(4);
    await loop['onClip']({ audioBase64: 'AA==', mimeType: 'audio/wav' });
    expect(loop['queuedClip']).not.toBeNull();
    expect(loop['busy']).toBe(false);
    loop['onClip'] = jest.fn();
    loop.onTurnBoundary('Typed reply', 1);
    expect(loop['onClip']).toHaveBeenCalledTimes(1);
  });

  it('gives one retry cue for failure or timeout and no cue for abort', () => {
    const { loop } = frameLoop();
    const speak = jest.fn();
    loop['speak'] = speak;
    loop.armTypedTurn();
    loop.abandonTurn(1, 'failed');
    loop.abandonTurn(1, 'failed');
    expect(speak).toHaveBeenCalledTimes(1);
    loop.armTypedTurn();
    loop.abandonTurn(2, 'aborted');
    expect(speak).toHaveBeenCalledTimes(1);
    loop.armTypedTurn();
    loop.abandonTurn(3, 'timed-out');
    expect(speak).toHaveBeenCalledTimes(2);
  });

  it('cues a successful reply with no speakable text', () => {
    const { loop } = frameLoop();
    const speak = jest.fn();
    loop['speak'] = speak;
    loop.armTypedTurn();
    loop.onTurnBoundary('', 1);
    expect(speak).toHaveBeenCalledWith(
      'The turn finished without a spoken reply.',
      'status',
    );
  });

  it('clears a queued typed turn on mute and does not arm it on restart', async () => {
    const { loop } = frameLoop();
    Object.assign(loop['coordinator'], { mute: jest.fn() });
    const armed = jest.fn();
    Object.assign(loop['options'], { onVoiceSend: armed });
    loop['active'] = true;
    loop['busy'] = true;
    loop.armTypedTurn();
    await loop.mute();
    expect(loop['queuedTypedTurns']).toHaveLength(0);
    loop['active'] = true;
    loop['muted'] = false;
    loop['finishTurn']();
    expect(armed).not.toHaveBeenCalled();
  });

  it('only guards speech as a roster while the roster card is shown', () => {
    const { loop } = frameLoop();
    loop.onRosterProposal('Roster', true);
    expect(loop['pendingRoster']).toBe(true);
    loop.setRosterPending(false);
    expect(loop['pendingRoster']).toBe(false);
    loop.setRosterPending(true);
    expect(loop['pendingRoster']).toBe(true);
  });

  function frameLoop(isIndependentSpeech?: () => boolean): {
    loop: CommandVoiceLoop;
    bargeIn: jest.SpyInstance;
  } {
    const store = Object.assign(Object.create(null) as CommandCenterStore, {
      voiceState: () => 'speaking',
      setVoiceState: jest.fn(),
      updateLevels: jest.fn(),
      resetLevels: jest.fn(),
      pendingInput: () => null,
    });
    const loop = new CommandVoiceLoop(
      store,
      Object.create(null) as CommandCenterSessionCoordinator,
      Object.create(null) as ClaudeRpcService,
      { isIndependentSpeech, sendTranscript: async () => true },
    );
    loop['active'] = true;
    Object.defineProperty(loop['playback'], 'isPlaying', {
      configurable: true,
      get: () => true,
    });
    return { loop, bargeIn: jest.spyOn(loop['playback'], 'bargeIn') };
  }

  it('accepts sustained playback-mode onset by default and stops stale playback', () => {
    const { loop, bargeIn } = frameLoop();
    loop['onFrame'](frames, 0);
    loop['onFrame'](frames, 301);
    expect(bargeIn).not.toHaveBeenCalled();
    loop['onFrame'](frames, 552);
    expect(bargeIn).toHaveBeenCalledTimes(1);
  });

  it('allows an echo-correlation override to reject playback onset', () => {
    const { loop, bargeIn } = frameLoop(() => false);
    loop['onFrame'](frames, 0);
    loop['onFrame'](frames, 301);
    loop['onFrame'](frames, 552);
    expect(bargeIn).not.toHaveBeenCalled();
  });

  it('does not stop playback for a short burst discarded by VAD', () => {
    const { loop, bargeIn } = frameLoop();
    loop['onFrame'](frames, 0);
    loop['onFrame'](frames, 301);
    loop['onFrame'](silence, 350);
    loop['onFrame'](silence, 1100);
    expect(bargeIn).not.toHaveBeenCalled();
  });

  it('keeps an unready provider in text mode without requesting the microphone', async () => {
    const setProvider = jest.fn();
    const setToast = jest.fn();
    const getUserMedia = jest.fn();
    const rpc = {
      call: jest.fn().mockResolvedValue({
        success: true,
        data: {
          ok: true,
          config: {
            sttProvider: 'local',
            ttsProvider: 'local',
            local: { sttDownloaded: false, ttsDownloaded: true },
            elevenlabs: { apiKeyConfigured: false },
          },
        },
      }),
    };
    const loop = new CommandVoiceLoop(
      Object.assign(Object.create(null) as CommandCenterStore, {
        setProvider,
        setToast,
      }),
      Object.create(null) as CommandCenterSessionCoordinator,
      Object.assign(Object.create(null) as ClaudeRpcService, rpc),
      {
        captureFactories: { getUserMedia, audioContext: jest.fn() },
        sendTranscript: async () => true,
      },
    );
    await expect(loop.start()).resolves.toBe(false);
    expect(setProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        transcription: false,
        synthesis: true,
        stt: expect.objectContaining({ providerId: 'local', ready: false }),
        tts: expect.objectContaining({ providerId: 'local', ready: true }),
      }),
    );
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it.each([
    [
      new DOMException('Permission denied', 'NotAllowedError'),
      'mic-denied',
      'Microphone permission was denied.',
    ],
    [
      new Error('Device missing'),
      'mic-unavailable',
      'Microphone is unavailable.',
    ],
  ] as const)(
    'surfaces a typed capture error for %s',
    async (failure, kind, message) => {
      const setVoiceError = jest.fn();
      const setToast = jest.fn();
      const loop = new CommandVoiceLoop(
        Object.assign(Object.create(null) as CommandCenterStore, {
          setProvider: jest.fn(),
          setVoiceError,
          setToast,
        }),
        Object.create(null) as CommandCenterSessionCoordinator,
        Object.assign(Object.create(null) as ClaudeRpcService, {
          call: jest.fn().mockResolvedValue({
            success: true,
            data: {
              ok: true,
              config: {
                sttProvider: 'local',
                ttsProvider: 'local',
                local: { sttDownloaded: true, ttsDownloaded: true },
                elevenlabs: { apiKeyConfigured: false },
              },
            },
          }),
        }),
        {
          captureFactories: {
            getUserMedia: jest.fn().mockRejectedValue(failure),
            audioContext: jest.fn(),
          },
          sendTranscript: async () => true,
        },
      );
      await expect(loop.start()).resolves.toBe(false);
      expect(setVoiceError).toHaveBeenCalledWith({ kind, message });
      expect(setToast).toHaveBeenCalledWith({ message, tone: 'error' });
    },
  );

  it('surfaces a worklet failure without reporting microphone denial', async () => {
    const setVoiceError = jest.fn();
    const stopTrack = jest.fn();
    const context = Object.assign(Object.create(null) as AudioContext, {
      audioWorklet: {
        addModule: jest
          .fn()
          .mockRejectedValue(new Error('Worklet unavailable')),
      },
      close: jest.fn().mockResolvedValue(undefined),
    });
    const stream = Object.assign(Object.create(null) as MediaStream, {
      getTracks: () => [{ stop: stopTrack }],
    });
    const loop = new CommandVoiceLoop(
      Object.assign(Object.create(null) as CommandCenterStore, {
        setProvider: jest.fn(),
        setVoiceError,
        setToast: jest.fn(),
      }),
      Object.create(null) as CommandCenterSessionCoordinator,
      Object.assign(Object.create(null) as ClaudeRpcService, {
        call: jest.fn().mockResolvedValue({
          success: true,
          data: {
            ok: true,
            config: {
              sttProvider: 'local',
              ttsProvider: 'local',
              local: { sttDownloaded: true, ttsDownloaded: true },
              elevenlabs: { apiKeyConfigured: false },
            },
          },
        }),
      }),
      {
        captureFactories: {
          getUserMedia: jest.fn().mockResolvedValue(stream),
          audioContext: () => context,
        },
        sendTranscript: async () => true,
      },
    );
    await expect(loop.start()).resolves.toBe(false);
    expect(setVoiceError).toHaveBeenCalledWith({
      kind: 'worklet',
      message: 'Voice capture could not start.',
    });
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it('retries capture after an unavailable microphone and clears the error', async () => {
    const originalNode = globalThis.AudioWorkletNode;
    const store = new CommandCenterStore();
    const context = Object.assign(Object.create(null) as AudioContext, {
      audioWorklet: { addModule: jest.fn().mockResolvedValue(undefined) },
      createMediaStreamSource: () => ({
        connect: jest.fn(),
        disconnect: jest.fn(),
      }),
      destination: {},
      close: jest.fn().mockResolvedValue(undefined),
    });
    const stream = Object.assign(Object.create(null) as MediaStream, {
      getTracks: () => [],
    });
    const getUserMedia = jest
      .fn()
      .mockRejectedValueOnce(new Error('device unavailable'))
      .mockResolvedValue(stream);
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
      configurable: true,
      value: jest.fn(() => ({
        port: { onmessage: null, close: jest.fn() },
        connect: jest.fn(),
        disconnect: jest.fn(),
      })),
    });
    const loop = new CommandVoiceLoop(
      store,
      Object.assign(Object.create(null) as CommandCenterSessionCoordinator, {
        startVoice: jest.fn(),
      }),
      Object.assign(Object.create(null) as ClaudeRpcService, {
        call: jest.fn().mockResolvedValue({
          success: true,
          data: {
            ok: true,
            config: {
              sttProvider: 'local',
              ttsProvider: 'local',
              local: { sttDownloaded: true, ttsDownloaded: true },
              elevenlabs: { apiKeyConfigured: false },
            },
          },
        }),
      }),
      {
        captureFactories: { getUserMedia, audioContext: () => context },
        sendTranscript: async () => true,
      },
    );
    try {
      await expect(loop.start()).resolves.toBe(false);
      expect(store.voiceError()?.kind).toBe('mic-unavailable');
      await expect(loop.start()).resolves.toBe(true);
      expect(store.voiceError()).toBeNull();
      expect(getUserMedia).toHaveBeenCalledTimes(2);
    } finally {
      await loop.exit();
      Object.defineProperty(globalThis, 'AudioWorkletNode', {
        configurable: true,
        value: originalNode,
      });
    }
  });

  it('does not turn a pending approval into a voice answer', () => {
    const store = {
      pendingInput: () => ({ kind: 'approval' }),
      setToast: jest.fn(),
      setVoiceState: jest.fn(),
      resetLevels: jest.fn(),
    };
    const coordinator = { send: jest.fn() };
    const loop = new CommandVoiceLoop(
      Object.assign(Object.create(null) as CommandCenterStore, store),
      Object.assign(
        Object.create(null) as CommandCenterSessionCoordinator,
        coordinator,
      ),
      Object.assign(Object.create(null) as ClaudeRpcService, {
        call: jest.fn(),
      }),
      { sendTranscript: coordinator.send },
    );
    loop.onPendingPrompt('Permission is waiting on the page.');
    expect(coordinator.send).not.toHaveBeenCalled();
  });

  it('blocks roster speech and resumes ordinary question answers after resolution', async () => {
    const answerOrdinaryQuestion = jest.fn().mockReturnValue(true);
    const send = jest.fn();
    const setToast = jest.fn();
    const store = Object.assign(Object.create(null) as CommandCenterStore, {
      pendingInput: () => ({ kind: 'question' }),
      setToast,
      setVoiceState: jest.fn(),
      resetLevels: jest.fn(),
    });
    const rpc = Object.assign(Object.create(null) as ClaudeRpcService, {
      call: jest.fn().mockResolvedValue({
        success: true,
        data: { ok: true, transcript: 'yes, confirm' },
      }),
    });
    const loop = new CommandVoiceLoop(
      store,
      Object.assign(Object.create(null) as CommandCenterSessionCoordinator, {
        send,
      }),
      rpc,
      { answerOrdinaryQuestion, sendTranscript: send },
    );
    loop.onRosterProposal('Confirm the roster.', true);
    loop['active'] = true;
    await loop['onClip']({ audioBase64: 'AA==', mimeType: 'audio/wav' });
    expect(answerOrdinaryQuestion).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(setToast).toHaveBeenCalledWith({
      message: 'Confirm or decline the roster on the card.',
      tone: 'error',
    });
    loop.onRosterResolved();
    await loop['onClip']({ audioBase64: 'AA==', mimeType: 'audio/wav' });
    expect(answerOrdinaryQuestion).toHaveBeenCalledWith('yes, confirm');
  });

  it('records one VAD-close-to-play mark per reply with cold, barge-in and warm labels', async () => {
    let now = 0;
    const endings: (() => void)[] = [];
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: () => 'blob:voice',
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: jest.fn(),
    });
    try {
      const store = Object.assign(Object.create(null) as CommandCenterStore, {
        voiceState: () => 'thinking',
        setVoiceState: jest.fn(),
        updateLevels: jest.fn(),
        resetLevels: jest.fn(),
        pendingInput: () => null,
      });
      const coordinator = Object.assign(
        Object.create(null) as CommandCenterSessionCoordinator,
        { send: jest.fn().mockResolvedValue(true) },
      );
      const rpc = Object.assign(Object.create(null) as ClaudeRpcService, {
        call: jest.fn().mockImplementation((method: string) =>
          Promise.resolve(
            method === 'voice:transcribe'
              ? { success: true, data: { ok: true, transcript: 'task' } }
              : {
                  success: true,
                  data: {
                    ok: true,
                    audioBase64: 'AA==',
                    mimeType: 'audio/wav',
                  },
                },
          ),
        ),
      });
      const loop = new CommandVoiceLoop(store, coordinator, rpc, {
        sendTranscript: coordinator.send,
        now: () => now,
        audioFactory: () => ({
          play: () => Promise.resolve(),
          stop: jest.fn(),
          onEnded: (callback) => {
            endings.push(callback);
          },
        }),
      });
      loop['active'] = true;
      const utterance = async (
        offset: number,
        barged: boolean,
      ): Promise<void> => {
        loop['vad'].reset();
        loop['onFrame'](frames, offset);
        loop['onFrame'](frames, offset + 121);
        loop['onFrame'](silence, offset + 500);
        now = offset + 600;
        loop['onFrame'](silence, offset + 1201);
        if (barged)
          loop['currentUtteranceOrigin'] = { endedAt: now, barged: true };
        await loop['onClip']({ audioBase64: 'AA==', mimeType: 'audio/wav' });
        now += 400;
        loop.onTurnBoundary('A spoken reply.', loop['awaitingTurnToken'] ?? 0);
        await new Promise((resolve) => setTimeout(resolve, 0));
        endings.shift()?.();
      };
      await utterance(0, false);
      await utterance(2000, true);
      await utterance(4000, false);
      expect(loop.getLatencyMarks()).toEqual([
        { kind: 'cold-worker', ms: 400 },
        { kind: 'post-barge-in', ms: 400 },
        { kind: 'warm', ms: 400 },
      ]);
    } finally {
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

  it('serializes send across mute and restart and ignores the old turn boundary', async () => {
    let resolveOld: (value: boolean) => void = () => undefined;
    const oldSend = new Promise<boolean>((resolve) => {
      resolveOld = resolve;
    });
    const send = jest.fn().mockReturnValueOnce(oldSend).mockResolvedValue(true);
    const setVoiceState = jest.fn();
    const store = Object.assign(Object.create(null) as CommandCenterStore, {
      voiceState: () => 'listening',
      setVoiceState,
      resetLevels: jest.fn(),
      pendingInput: () => null,
    });
    const coordinator = Object.assign(
      Object.create(null) as CommandCenterSessionCoordinator,
      {
        send,
        mute: jest.fn(),
        stop: jest.fn().mockResolvedValue(undefined),
      },
    );
    const rpc = Object.assign(Object.create(null) as ClaudeRpcService, {
      call: jest.fn().mockResolvedValue({
        success: true,
        data: { ok: true, transcript: 'command' },
      }),
    });
    const loop = new CommandVoiceLoop(store, coordinator, rpc, {
      sendTranscript: send,
    });
    const clip = { audioBase64: 'AA==', mimeType: 'audio/wav' } as const;
    loop['active'] = true;
    const first = loop['onClip'](clip);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await loop.mute();
    loop['active'] = true;
    loop['muted'] = false;
    const second = loop['onClip'](clip);
    await Promise.resolve();
    loop.onTurnBoundary('Old reply.', 1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(loop['busy']).toBe(true);
    resolveOld(true);
    await first;
    await second;
    expect(send).toHaveBeenCalledTimes(2);
    expect(loop['busy']).toBe(true);
    loop.onTurnBoundary('New reply.', loop['awaitingTurnToken'] ?? 0);
    expect(loop['busy']).toBe(false);
    expect(setVoiceState).not.toHaveBeenCalledWith('idle');
  });

  it('does not restore listening when send fails after stop', async () => {
    let resolveSend: (value: boolean) => void = () => undefined;
    const send = jest.fn().mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveSend = resolve;
      }),
    );
    const setVoiceState = jest.fn();
    const store = Object.assign(Object.create(null) as CommandCenterStore, {
      voiceState: () => 'stopped',
      setVoiceState,
      setMuted: jest.fn(),
      resetLevels: jest.fn(),
      pendingInput: () => null,
    });
    const loop = new CommandVoiceLoop(
      store,
      Object.assign(Object.create(null) as CommandCenterSessionCoordinator, {
        send,
        stop: jest.fn().mockResolvedValue(undefined),
      }),
      Object.assign(Object.create(null) as ClaudeRpcService, {
        call: jest.fn().mockResolvedValue({
          success: true,
          data: { ok: true, transcript: 'command' },
        }),
      }),
      { sendTranscript: send },
    );
    loop['active'] = true;
    const turn = loop['onClip']({ audioBase64: 'AA==', mimeType: 'audio/wav' });
    await Promise.resolve();
    await loop.stop();
    resolveSend(false);
    await turn;
    expect(setVoiceState).not.toHaveBeenCalledWith('listening');
    expect(loop['active']).toBe(false);
  });

  it('keeps the latency origin when the first of two identical chunks fails', async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: () => 'blob:voice',
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: jest.fn(),
    });
    let synthCalls = 0;
    const rpc = Object.assign(Object.create(null) as ClaudeRpcService, {
      call: jest.fn().mockImplementation(() =>
        Promise.resolve(
          ++synthCalls === 1
            ? { success: false }
            : {
                success: true,
                data: {
                  ok: true,
                  audioBase64: 'AA==',
                  mimeType: 'audio/wav',
                },
              },
        ),
      ),
    });
    const store = Object.assign(Object.create(null) as CommandCenterStore, {
      setVoiceState: jest.fn(),
      setToast: jest.fn(),
      voiceState: () => 'thinking',
    });
    const loop = new CommandVoiceLoop(
      store,
      Object.create(null) as CommandCenterSessionCoordinator,
      rpc,
      {
        sendTranscript: async () => true,
        now: () => 250,
        audioFactory: () => ({
          play: async () => undefined,
          stop: jest.fn(),
          onEnded: jest.fn(),
        }),
      },
    );
    try {
      loop['active'] = true;
      loop['speak']('A full sentence. A full sentence.', 'reply', {
        endedAt: 100,
        barged: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(loop.getLatencyMarks()).toEqual([
        { kind: 'cold-worker', ms: 150 },
      ]);
      expect(loop['playbackMarks']).toHaveLength(0);
    } finally {
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

  it('clears queued synthesis ids on a four-chunk barge-in before a failed next reply', async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: () => 'blob:voice',
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: jest.fn(),
    });
    const oldSynths: Array<(value: object) => void> = [];
    let synthCalls = 0;
    const rpc = Object.assign(Object.create(null) as ClaudeRpcService, {
      call: jest.fn().mockImplementation(() => {
        synthCalls++;
        if (synthCalls <= 2)
          return new Promise<object>((resolve) => oldSynths.push(resolve));
        return Promise.resolve(
          synthCalls === 3
            ? { success: false }
            : {
                success: true,
                data: { ok: true, audioBase64: 'AA==', mimeType: 'audio/wav' },
              },
        );
      }),
    });
    const store = Object.assign(Object.create(null) as CommandCenterStore, {
      voiceState: () => 'speaking',
      setVoiceState: jest.fn(),
      updateLevels: jest.fn(),
      resetLevels: jest.fn(),
      setToast: jest.fn(),
      pendingInput: () => null,
    });
    const loop = new CommandVoiceLoop(
      store,
      Object.create(null) as CommandCenterSessionCoordinator,
      rpc,
      {
        sendTranscript: async () => true,
        now: () => 250,
        audioFactory: () => ({
          play: async () => undefined,
          stop: jest.fn(),
          onEnded: jest.fn(),
        }),
      },
    );
    try {
      loop['active'] = true;
      loop['speak'](
        'First old sentence. Second old sentence. Third old sentence. Fourth old sentence.',
        'reply',
      );
      expect(loop['playbackMarks']).toHaveLength(4);
      Object.defineProperty(loop['playback'], 'isPlaying', {
        configurable: true,
        get: () => true,
      });
      loop['onFrame'](frames, 0);
      loop['onFrame'](frames, 301);
      loop['onFrame'](frames, 552);
      expect(loop['synthesisIds']).toHaveLength(0);
      Object.defineProperty(loop['playback'], 'isPlaying', {
        configurable: true,
        get: () => false,
      });
      loop['speak']('First new sentence. Second new sentence.', 'reply', {
        endedAt: 100,
        barged: true,
      });
      for (const resolve of oldSynths)
        resolve({
          success: true,
          data: { ok: true, audioBase64: 'AA==', mimeType: 'audio/wav' },
        });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(loop.getLatencyMarks()).toEqual([
        { kind: 'post-barge-in', ms: 150 },
      ]);
      expect(loop['playbackMarks']).toHaveLength(0);
    } finally {
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
