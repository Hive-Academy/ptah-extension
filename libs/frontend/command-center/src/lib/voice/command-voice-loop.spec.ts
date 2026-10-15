import { CommandVoiceLoop } from './command-voice-loop';
import type { CommandCenterStore } from '../model/command-center.store';
import type { CommandCenterSessionCoordinator } from '../model/session-coordinator';
import type { ClaudeRpcService } from '@ptah-extension/core';

describe('CommandVoiceLoop', () => {
  const frames = new Float32Array(128).fill(0.2);
  const silence = new Float32Array(128);

  function frameLoop(isIndependentSpeech?: () => boolean): {
    loop: CommandVoiceLoop;
    bargeIn: jest.SpyInstance;
  } {
    const store = Object.assign(Object.create(null) as CommandCenterStore, {
      voiceState: () => 'speaking',
      setVoiceState: jest.fn(),
      updateLevels: jest.fn(),
      resetLevels: jest.fn(),
    });
    const loop = new CommandVoiceLoop(
      store,
      Object.create(null) as CommandCenterSessionCoordinator,
      Object.create(null) as ClaudeRpcService,
      { isIndependentSpeech },
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
      { captureFactories: { getUserMedia, audioContext: jest.fn() } },
    );
    await expect(loop.start()).resolves.toBe(false);
    expect(setProvider).toHaveBeenCalledWith({
      transcription: false,
      synthesis: true,
    });
    expect(getUserMedia).not.toHaveBeenCalled();
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
      { answerOrdinaryQuestion },
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
        loop.onTurnBoundary('A spoken reply.');
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
});
