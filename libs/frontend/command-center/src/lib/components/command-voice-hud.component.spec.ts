import { TestBed } from '@angular/core/testing';
import { CommandVoiceHudComponent } from './command-voice-hud.component';

describe('CommandVoiceHudComponent', () => {
  function render() {
    TestBed.configureTestingModule({ imports: [CommandVoiceHudComponent] });
    const fixture = TestBed.createComponent(CommandVoiceHudComponent);
    fixture.componentRef.setInput('voiceState', 'idle');
    fixture.componentRef.setInput('provider', {
      transcription: true,
      synthesis: true,
    });
    fixture.detectChanges();
    return fixture;
  }

  it('shows a clamped five-bar Speaker meter only while speaking', () => {
    const fixture = render();
    const speaker = () =>
      fixture.nativeElement.querySelector(
        '[role="meter"][aria-label="Speaker"]',
      ) as HTMLElement | null;
    expect(speaker()).toBeNull();
    fixture.componentRef.setInput('voiceState', 'speaking');
    fixture.componentRef.setInput('outputLevel', 0.6);
    fixture.detectChanges();
    expect(speaker()?.getAttribute('aria-valuemin')).toBe('0');
    expect(speaker()?.getAttribute('aria-valuemax')).toBe('100');
    expect(speaker()?.getAttribute('aria-valuenow')).toBe('60');
    expect(speaker()?.getAttribute('aria-valuetext')).toBe('Speaker level 60%');
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('[role="meter"][aria-label="Microphone level"]')
        ?.getAttribute('aria-valuetext'),
    ).toBe('Microphone level 0%');
    expect(speaker()?.querySelectorAll('span')).toHaveLength(5);
    fixture.componentRef.setInput('outputLevel', 2);
    fixture.detectChanges();
    expect(speaker()?.getAttribute('aria-valuenow')).toBe('100');
    fixture.componentRef.setInput('outputLevel', -1);
    fixture.detectChanges();
    expect(speaker()?.getAttribute('aria-valuenow')).toBe('0');
    fixture.componentRef.setInput('voiceState', 'listening');
    fixture.detectChanges();
    expect(speaker()).toBeNull();
  });

  it('offers an enabled mic retry for a typed capture failure', () => {
    const fixture = render();
    const start = jest.fn();
    fixture.componentInstance.start.subscribe(start);
    fixture.componentRef.setInput('voiceError', {
      kind: 'worklet',
      message: 'Voice capture could not start.',
    });
    fixture.detectChanges();
    const orb = fixture.nativeElement.querySelector(
      'button[aria-label="Start voice"]',
    ) as HTMLButtonElement;
    expect(orb.disabled).toBe(false);
    expect(fixture.nativeElement.textContent).toContain(
      'Voice capture could not start.',
    );
    orb.click();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('shows permission copy and a settings recovery when permission is denied', () => {
    const fixture = render();
    const settings = jest.fn();
    fixture.componentInstance.openVoiceSettings.subscribe(settings);
    fixture.componentRef.setInput('voiceError', {
      kind: 'mic-denied',
      message: 'Microphone permission was denied.',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Microphone permission was denied.',
    );
    const recovery = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: HTMLButtonElement) =>
        button.textContent?.includes('Open Voice settings'),
    ) as HTMLButtonElement;
    expect(recovery.className).toContain('text-base-content');
    recovery.click();
    expect(settings).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['mic-unavailable', 'Microphone is unavailable.'],
    ['stt', 'Transcription failed.'],
    ['tts', 'Speech synthesis failed.'],
    ['playback', 'Audio playback failed.'],
    ['chat', 'The chat turn failed.'],
  ] as const)(
    'shows the %s recovery message without disabling retry',
    (kind, message) => {
      const fixture = render();
      fixture.componentRef.setInput('voiceError', { kind, message });
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(message);
      expect(
        (
          fixture.nativeElement.querySelector(
            'button[aria-label="Start voice"]',
          ) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    },
  );

  it('keeps Stop actionable during a typed turn with idle voice', () => {
    const fixture = render();
    const mute = jest.fn();
    fixture.componentInstance.toggleMute.subscribe(mute);
    fixture.componentRef.setInput('turnAbortable', true);
    fixture.detectChanges();
    const start = fixture.nativeElement.querySelector(
      'button[aria-label="Start voice"]',
    ) as HTMLButtonElement;
    const muteButton = [
      ...fixture.nativeElement.querySelectorAll('button'),
    ].find(
      (button: HTMLButtonElement) => button.textContent?.trim() === 'Mute',
    ) as HTMLButtonElement;
    const stop = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: HTMLButtonElement) => button.textContent?.trim() === 'Stop',
    ) as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    expect(muteButton.disabled).toBe(true);
    expect(stop.disabled).toBe(false);
    muteButton.click();
    expect(mute).not.toHaveBeenCalled();
  });
  it('offers capture retry for unavailable and worklet errors without permission settings', () => {
    const fixture = render();
    const start = jest.fn();
    fixture.componentInstance.start.subscribe(start);
    for (const kind of ['mic-unavailable', 'worklet'] as const) {
      fixture.componentRef.setInput('voiceError', {
        kind,
        message: 'Capture failed.',
      });
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain(
        'Open Voice settings',
      );
      const retry = [...fixture.nativeElement.querySelectorAll('button')].find(
        (button: HTMLButtonElement) =>
          button.textContent?.includes('Retry microphone'),
      ) as HTMLButtonElement;
      retry.click();
    }
    expect(start).toHaveBeenCalledTimes(2);
  });
});
