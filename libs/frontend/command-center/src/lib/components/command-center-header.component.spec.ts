import { TestBed } from '@angular/core/testing';
import { CommandCenterHeaderComponent } from './command-center-header.component';

describe('CommandCenterHeaderComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [CommandCenterHeaderComponent] }));

  it('shows session, provider status and warns at 70 percent', () => {
    const fixture = TestBed.createComponent(CommandCenterHeaderComponent);
    fixture.componentRef.setInput('sessionId', '123456789abcdef');
    fixture.componentRef.setInput('sessionStatus', 'running');
    fixture.componentRef.setInput('voiceProviderText', 'Whisper / Kokoro');
    fixture.componentRef.setInput('showContext', true);
    fixture.componentRef.setInput('contextLabel', '69%');
    fixture.componentRef.setInput('contextPercent', 69);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Session 12345678');
    expect(fixture.nativeElement.textContent).toContain('Whisper / Kokoro');
    expect(fixture.nativeElement.textContent).not.toContain('Warning');
    fixture.componentRef.setInput('contextPercent', 70);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Warning');
  });

  it('offers settings recovery and emits both actions', () => {
    const fixture = TestBed.createComponent(CommandCenterHeaderComponent);
    const settings = jest.fn();
    const theme = jest.fn();
    fixture.componentInstance.voiceSettings.subscribe(settings);
    fixture.componentInstance.themeToggle.subscribe(theme);
    fixture.componentRef.setInput('micError', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Microphone access blocked');
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('[aria-label="Switch to light theme"]') as HTMLButtonElement).click();
    expect(settings).toHaveBeenCalledTimes(1);
    expect(theme).toHaveBeenCalledTimes(1);
  });
});
