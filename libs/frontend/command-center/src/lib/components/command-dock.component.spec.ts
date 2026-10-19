import { TestBed } from '@angular/core/testing';
import { commandDockStyles, CommandDockComponent } from './command-dock.component';

describe('CommandDockComponent', () => {
  function render() {
    TestBed.configureTestingModule({ imports: [CommandDockComponent] });
    const fixture = TestBed.createComponent(CommandDockComponent);
    fixture.componentRef.setInput('voiceState', 'idle');
    fixture.componentRef.setInput('provider', { transcription: true, synthesis: true });
    fixture.componentRef.setInput('sessionStatus', 'idle');
    fixture.detectChanges();
    return fixture;
  }

  it('places desktop regions on one row and keeps the approved responsive rows', () => {
    const fixture = render();
    const dock = fixture.nativeElement.querySelector('[data-dock-layout="responsive"]') as HTMLElement;
    expect(dock).not.toBeNull();
    expect(dock.getAttribute('role')).toBe('group');
    expect(dock.querySelectorAll('ptah-command-voice-hud')).toHaveLength(1);
    expect(dock.querySelectorAll('ptah-command-session-controls')).toHaveLength(1);
    const styles = commandDockStyles;
    const [desktop, narrowAndMobile] = styles.split('@container (max-width: 1100px)');
    const [narrow, mobileAndMotion] = narrowAndMobile.split('@container (max-width: 720px)');
    const [mobile] = mobileAndMotion.split('@media (prefers-reduced-motion: reduce)');

    expect(desktop).toContain('.voice-identity { grid-row: 1; grid-column: 1;');
    expect(desktop).toContain('.voice-actions { grid-row: 1; grid-column: 2;');
    expect(desktop).toContain('.command-entry { grid-row: 1; grid-column: 3;');
    expect(desktop).toContain('.session-actions > button:first-child { grid-row: 1; grid-column: 4;');
    expect(desktop).toContain('.session-new { grid-row: 1; grid-column: 5;');
    expect(desktop).toContain('.voice-recovery { grid-column: 1 / -1; grid-row: 2;');

    expect(narrow).toContain('.voice-identity { grid-row: 1; grid-column: 1 / -1;');
    expect(narrow).toContain('.voice-actions { grid-row: 2; grid-column: 1;');
    expect(narrow).toContain('.session-actions > button:first-child { grid-row: 2; grid-column: 2;');
    expect(narrow).toContain('.session-new { grid-row: 2; grid-column: 3;');
    expect(narrow).toContain('.command-entry { grid-row: 3; grid-column: 1 / -1;');

    expect(mobile).toContain('.command-dock { grid-template-columns: minmax(0, 1fr) auto;');
    expect(mobile).toContain('.session-new { grid-row: 4; grid-column: 1 / -1; width: 100%;');
    expect(mobile).toContain('.command-entry { grid-row: 3;');
    expect(mobile).toContain('.voice-recovery { grid-row: 5;');
  });

  it('forwards Start new, Status, send and all voice outputs', () => {
    const fixture = render();
    const dock = fixture.componentInstance;
    const newSession = jest.fn();
    const status = jest.fn();
    const submit = jest.fn();
    const start = jest.fn();
    const stop = jest.fn();
    const mute = jest.fn();
    const interrupt = jest.fn();
    const settings = jest.fn();
    dock.newSession.subscribe(newSession);
    dock.requestStatus.subscribe(status);
    dock.commandSubmit.subscribe(submit);
    dock.start.subscribe(start);
    dock.stop.subscribe(stop);
    dock.toggleMute.subscribe(mute);
    dock.interrupt.subscribe(interrupt);
    dock.openVoiceSettings.subscribe(settings);
    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('.session-new')?.click();
    [...root.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Status')?.click();
    root.querySelector<HTMLButtonElement>('[aria-label="Start voice"]')?.click();
    expect(newSession).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('voiceState', 'speaking');
    fixture.detectChanges();
    [...root.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Mute')?.click();
    [...root.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Stop')?.click();
    [...root.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Interrupt speech')?.click();
    expect(mute).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(interrupt).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('voiceError', { kind: 'mic-denied', message: 'Microphone permission was denied.' });
    fixture.detectChanges();
    [...root.querySelectorAll('button')].find(button => button.textContent?.includes('Open Voice settings'))?.click();
    expect(settings).toHaveBeenCalledTimes(1);
    const input = root.querySelector('#command-text') as HTMLInputElement;
    input.value = '  Check status  ';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (root.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    expect(submit).toHaveBeenCalledWith('Check status');
    expect(input.value).toBe('  Check status  ');
    dock.clearDraft('Check status');
    fixture.detectChanges();
    expect(root.querySelector<HTMLInputElement>('#command-text')?.value).toBe('');
  });

  it('shows a waveform and numeric speaker meter only while speaking', () => {
    const fixture = render();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-dock-waveform]')).toBeNull();
    expect(root.querySelector('[role="meter"][aria-label="Speaker"]')).toBeNull();
    fixture.componentRef.setInput('voiceState', 'speaking');
    fixture.componentRef.setInput('outputLevel', 0.42);
    fixture.detectChanges();
    expect(root.querySelector('[data-dock-waveform]')).not.toBeNull();
    expect(root.querySelector('[role="meter"][aria-label="Speaker"]')?.getAttribute('aria-valuenow')).toBe('42');
  });
});
