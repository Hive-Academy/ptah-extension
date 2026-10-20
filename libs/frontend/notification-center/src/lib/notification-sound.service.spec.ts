import { TestBed } from '@angular/core/testing';
import { NotificationService, type AttentionItem } from '@ptah-extension/core';
import {
  NOTIFICATION_AUDIO_ENABLED,
  NotificationSoundService,
} from './notification-sound.service';

describe('NotificationSoundService', () => {
  const start = jest.fn();
  const stop = jest.fn();
  const connect = jest.fn();
  const resume = jest.fn();
  let state: AudioContextState = 'suspended';
  let contextCreations = 0;
  const original = window.AudioContext;

  class AudioContextMock {
    constructor() {
      contextCreations += 1;
    }
    get state(): AudioContextState {
      return state;
    }
    currentTime = 0;
    destination = {} as AudioDestinationNode;
    resume = resume;
    createOscillator = () =>
      ({
        type: 'sine',
        frequency: {
          setValueAtTime: jest.fn(),
          exponentialRampToValueAtTime: jest.fn(),
        },
        connect,
        start,
        stop,
      }) as unknown as OscillatorNode;
    createGain = () =>
      ({
        gain: {
          setValueAtTime: jest.fn(),
          exponentialRampToValueAtTime: jest.fn(),
        },
        connect,
      }) as unknown as GainNode;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    contextCreations = 0;
    state = 'suspended';
    start.mockReset();
    stop.mockReset();
    connect.mockReset();
    resume.mockReset().mockImplementation(async () => {
      state = 'running';
    });
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: AudioContextMock,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: original,
    });
  });

  function create(enabled = true): NotificationSoundService {
    TestBed.configureTestingModule({
      providers: [
        NotificationSoundService,
        { provide: NOTIFICATION_AUDIO_ENABLED, useValue: enabled },
      ],
    });
    return TestBed.inject(NotificationSoundService);
  }

  function cue(key: string): void {
    TestBed.inject(NotificationService).upsert({
      key, generation: 1, kind: 'permission', source: 'test',
      workspacePath: '/workspace', workspaceName: 'Workspace', severity: 'info',
      title: 'Permission needed', actions: [], actionable: true, soundEligible: true,
    });
    jest.advanceTimersByTime(350);
    TestBed.flushEffects();
  }

  it('creates no AudioContext before a gesture', () => {
    const service = create();
    expect(contextCreations).toBe(0);
    expect(service.playBurst()).toBe(false);
  });

  it('stays silent when a suspended context cannot resume', async () => {
    resume.mockRejectedValue(new Error('blocked'));
    const service = create();
    await service.observeTrustedGesture();
    cue('blocked');
    await Promise.resolve();
    expect(start).not.toHaveBeenCalled();
  });

  it('plays one generated envelope per eligible cue and applies the two-second cooldown', async () => {
    const service = create();
    await service.observeTrustedGesture();
    cue('first');
    expect(service.playBurst()).toBe(false);
    cue('within-cooldown');
    expect(start).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(2000);
    cue('after-cooldown');
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('resumes a context suspended after the initial gesture and then plays', async () => {
    const service = create();
    await service.observeTrustedGesture();
    cue('first');
    state = 'suspended';
    jest.advanceTimersByTime(2000);
    cue('second');
    expect(start).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(resume).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('persists mute only in localStorage', () => {
    const service = create();
    service.setMuted(true);
    expect(
      localStorage.getItem('ptah:notification-center:sound-muted:v1'),
    ).toBe('true');
    TestBed.resetTestingModule();
    expect(create().muted()).toBe(true);
  });

  it('suppresses audio when the injectable automation seam is disabled', async () => {
    const service = create(false);
    await service.observeTrustedGesture();
    expect(contextCreations).toBe(0);
    expect(service.playBurst()).toBe(false);
  });

  it('plays only for a core sound cue and honors persisted mute', async () => {
    const service = create();
    const notifications = TestBed.inject(NotificationService);
    await service.observeTrustedGesture();
    TestBed.flushEffects();
    expect(start).not.toHaveBeenCalled();

    const item: AttentionItem = {
      key: 'permission-1', generation: 1, kind: 'permission', source: 'test',
      workspacePath: '/workspace', workspaceName: 'Workspace', severity: 'info',
      title: 'Permission needed', actions: [], actionable: true, soundEligible: true,
    };
    notifications.upsert(item);
    jest.advanceTimersByTime(350);
    TestBed.flushEffects();
    expect(start).toHaveBeenCalledTimes(1);

    service.setMuted(true);
    jest.advanceTimersByTime(2000);
    notifications.upsert({ ...item, key: 'permission-2' });
    jest.advanceTimersByTime(350);
    TestBed.flushEffects();
    expect(start).toHaveBeenCalledTimes(1);
    service.setMuted(false);
    TestBed.flushEffects();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('does not play a cue that already existed when the service starts', async () => {
    TestBed.configureTestingModule({ providers: [
      NotificationSoundService,
      { provide: NOTIFICATION_AUDIO_ENABLED, useValue: true },
    ] });
    TestBed.inject(NotificationService).upsert({
      key: 'before-start', generation: 1, kind: 'permission', source: 'test',
      workspacePath: '/workspace', workspaceName: 'Workspace', severity: 'info',
      title: 'Permission needed', actions: [], actionable: true, soundEligible: true,
    });
    jest.advanceTimersByTime(350);
    const service = TestBed.inject(NotificationSoundService);
    await service.observeTrustedGesture();
    TestBed.flushEffects();
    expect(start).not.toHaveBeenCalled();
  });
});
