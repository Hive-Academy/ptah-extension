import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  VoiceInputService,
  MEDIA_RECORDER_FACTORY,
  type MediaRecorderFactory,
} from './voice-input.service';

class FakeMediaStreamTrack {
  stopped = false;
  stop(): void {
    this.stopped = true;
  }
}

class FakeMediaStream {
  tracks: FakeMediaStreamTrack[];
  constructor(count = 1) {
    this.tracks = Array.from(
      { length: count },
      () => new FakeMediaStreamTrack(),
    );
  }
  getTracks(): FakeMediaStreamTrack[] {
    return this.tracks;
  }
}

class FakeMediaRecorder {
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
    this.ondataavailable?.({
      data: new Blob(['audio-bytes'], { type: 'audio/webm' }),
    });
    this.onstop?.();
  }

  emitError(): void {
    this.onerror?.();
  }
}

describe('VoiceInputService', () => {
  let service: VoiceInputService;
  let rpcCall: jest.Mock;
  let lastRecorder: FakeMediaRecorder;
  let lastStream: FakeMediaStream;
  let getUserMedia: jest.Mock;

  function configure(
    factoryOverrides: Partial<MediaRecorderFactory> = {},
  ): void {
    lastStream = new FakeMediaStream(2);
    getUserMedia = jest.fn().mockResolvedValue(lastStream);
    rpcCall = jest.fn().mockResolvedValue({
      success: true,
      data: { ok: true, transcript: 'hello world' },
    });

    const factory: MediaRecorderFactory = {
      getUserMedia,
      createRecorder: () => {
        lastRecorder = new FakeMediaRecorder();
        return lastRecorder as unknown as MediaRecorder;
      },
      isTypeSupported: (mimeType: string) =>
        mimeType === 'audio/webm;codecs=opus',
      ...factoryOverrides,
    };

    TestBed.configureTestingModule({
      providers: [
        VoiceInputService,
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
        { provide: MEDIA_RECORDER_FACTORY, useValue: factory },
      ],
    });

    service = TestBed.inject(VoiceInputService);
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('starts idle', () => {
    configure();
    expect(service.state()).toBe('idle');
    expect(service.isRecording()).toBe(false);
  });

  it('record -> stop -> transcribe happy path returns transcript', async () => {
    configure();
    await service.startRecording();
    expect(service.state()).toBe('recording');

    const result = await service.stopRecording();

    expect(result).toEqual({ ok: true, transcript: 'hello world' });
    expect(service.state()).toBe('idle');
    expect(rpcCall).toHaveBeenCalledWith(
      'voice:transcribe',
      expect.objectContaining({ mimeType: 'audio/webm;codecs=opus' }),
      expect.objectContaining({ timeout: 300_000 }),
    );
  });

  it('stops all media stream tracks after stop', async () => {
    configure();
    await service.startRecording();
    await service.stopRecording();

    expect(lastStream.getTracks().every((t) => t.stopped)).toBe(true);
  });

  it('surfaces an error and releases tracks when getUserMedia rejects', async () => {
    configure({
      getUserMedia: jest.fn().mockRejectedValue(new Error('Permission denied')),
    });

    await service.startRecording();

    expect(service.state()).toBe('idle');
    expect(service.error()).toBe('Permission denied');
  });

  it('returns ok:false when RPC reports failure', async () => {
    configure();
    rpcCall.mockResolvedValue({
      success: true,
      data: { ok: false, error: 'whisper unavailable' },
    });

    await service.startRecording();
    const result = await service.stopRecording();

    expect(result).toEqual({ ok: false, error: 'whisper unavailable' });
    expect(service.error()).toBe('whisper unavailable');
    expect(service.state()).toBe('idle');
  });

  it('returns ok:false when RPC transport fails', async () => {
    configure();
    rpcCall.mockResolvedValue({ success: false, error: 'timeout' });

    await service.startRecording();
    const result = await service.stopRecording();

    expect(result?.ok).toBe(false);
    expect(result?.error).toBe('timeout');
  });

  it('falls back to audio/webm when opus is unsupported', async () => {
    configure({ isTypeSupported: (mt: string) => mt === 'audio/webm' });

    await service.startRecording();
    await service.stopRecording();

    expect(rpcCall).toHaveBeenCalledWith(
      'voice:transcribe',
      expect.objectContaining({ mimeType: 'audio/webm' }),
      expect.objectContaining({ timeout: 300_000 }),
    );
  });

  it('cancelRecording stops tracks and resets state', async () => {
    configure();
    await service.startRecording();

    service.cancelRecording();

    expect(service.state()).toBe('idle');
    expect(lastStream.getTracks().every((t) => t.stopped)).toBe(true);
  });
});
