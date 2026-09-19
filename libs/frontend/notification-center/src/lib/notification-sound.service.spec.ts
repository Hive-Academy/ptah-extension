import { TestBed } from '@angular/core/testing';
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

  it('creates no AudioContext before a gesture', () => {
    const service = create();
    expect(contextCreations).toBe(0);
    expect(service.playBurst()).toBe(false);
  });

  it('stays silent when a suspended context cannot resume', async () => {
    resume.mockRejectedValueOnce(new Error('blocked'));
    const service = create();
    await service.observeTrustedGesture();
    expect(service.playBurst()).toBe(false);
  });

  it('plays one generated envelope and applies the two-second cooldown', async () => {
    const service = create();
    await service.observeTrustedGesture();
    expect(service.playBurst(1000)).toBe(true);
    expect(service.playBurst(2999)).toBe(false);
    expect(service.playBurst(3000)).toBe(true);
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
});
