import { inject, Injectable, InjectionToken, signal } from '@angular/core';

const MUTE_KEY = 'ptah:notification-center:sound-muted:v1';
const COOLDOWN_MS = 2000;

export const NOTIFICATION_AUDIO_ENABLED = new InjectionToken<boolean>(
  'NOTIFICATION_AUDIO_ENABLED',
  {
    providedIn: 'root',
    factory: () =>
      typeof navigator !== 'undefined' && navigator.webdriver !== true,
  },
);

@Injectable({ providedIn: 'root' })
export class NotificationSoundService {
  private readonly enabled = inject(NOTIFICATION_AUDIO_ENABLED);
  private context: AudioContext | null = null;
  private gestureObserved = false;
  private lastPlayedAt = Number.NEGATIVE_INFINITY;
  private readonly _muted = signal(this.readMutePreference());
  readonly muted = this._muted.asReadonly();

  constructor() {
    if (!this.enabled || typeof window === 'undefined') return;
    const observeGesture = (event: Event): void => {
      if (!event.isTrusted) return;
      window.removeEventListener('pointerdown', observeGesture);
      window.removeEventListener('keydown', observeGesture);
      void this.observeTrustedGesture();
    };
    window.addEventListener('pointerdown', observeGesture);
    window.addEventListener('keydown', observeGesture);
  }

  setMuted(muted: boolean): void {
    this._muted.set(muted);
    try {
      localStorage.setItem(MUTE_KEY, String(muted));
    } catch {
      // Storage can be unavailable in hardened webviews; mute remains in-memory.
    }
  }

  async observeTrustedGesture(): Promise<void> {
    if (!this.enabled || this.gestureObserved) return;
    this.gestureObserved = true;
    const Context = window.AudioContext;
    if (!Context) return;
    this.context = new Context();
    if (this.context.state === 'suspended') {
      try {
        await this.context.resume();
      } catch (error: unknown) {
        console.debug(
          '[NotificationSound] Audio context resume was rejected',
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  playBurst(now = Date.now()): boolean {
    const context = this.context;
    if (
      !this.enabled ||
      this._muted() ||
      !context ||
      now - this.lastPlayedAt < COOLDOWN_MS
    ) {
      return false;
    }
    if (context.state === 'suspended') {
      this.lastPlayedAt = now;
      void context
        .resume()
        .then(() => {
          if (context.state === 'running' && !this._muted()) {
            this.playEnvelope(context);
          }
        })
        .catch((_error: unknown) => {
          // degradation-audit: optional-capability - browser autoplay policy
          // may reject a background resume; notifications remain available
          // visually and a later burst can retry after the cooldown.
        });
      return true;
    }
    if (context.state !== 'running') return false;
    this.lastPlayedAt = now;
    this.playEnvelope(context);
    return true;
  }

  private playEnvelope(context: AudioContext): void {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(660, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      880,
      context.currentTime + 0.09,
    );
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(context.currentTime);
    oscillator.stop(context.currentTime + 0.17);
  }

  private readMutePreference(): boolean {
    try {
      return localStorage.getItem(MUTE_KEY) === 'true';
    } catch {
      // degradation-audit: optional-capability - the mute preference is a
      // UI-only convenience; where storage is blocked, partitioned or over
      // quota, `false` restores the shipped default of an audible cue, which
      // the user can mute again from the panel for the life of the session.
      return false;
    }
  }
}
