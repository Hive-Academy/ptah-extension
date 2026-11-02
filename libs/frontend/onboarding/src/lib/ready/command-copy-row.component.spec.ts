import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { OnboardingAnnouncerService } from '../shell/onboarding-announcer.service';
import {
  COMMAND_COPIED_MS,
  CommandCopyRowComponent,
} from './command-copy-row.component';

describe('CommandCopyRowComponent', () => {
  let fixture: ComponentFixture<CommandCopyRowComponent>;
  let writeText: jest.Mock<Promise<void>, [string]>;
  let announce: jest.Mock<void, [string]>;

  const button = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('[data-testid="command-copy-button"]');

  async function click(): Promise<void> {
    button().click();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  }

  beforeEach(() => {
    jest.useFakeTimers();
    writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    announce = jest.fn();
    TestBed.configureTestingModule({
      imports: [CommandCopyRowComponent],
      providers: [
        { provide: OnboardingAnnouncerService, useValue: { announce } },
      ],
    });
    fixture = TestBed.createComponent(CommandCopyRowComponent);
    fixture.componentRef.setInput('command', 'claude');
    fixture.componentRef.setInput('copyLabel', 'Copy sign-in command');
    fixture.detectChanges();
  });

  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('renders the command as text and applies the aria-label', () => {
    expect(
      fixture.nativeElement.querySelector('[data-testid="command-copy-code"]')
        .textContent,
    ).toBe('claude');
    expect(button().getAttribute('aria-label')).toBe('Copy sign-in command');
    expect(button().textContent).toContain('Copy');
  });

  it('writes the clipboard, reads "Copied" for 2 s and announces', async () => {
    await click();
    expect(writeText).toHaveBeenCalledWith('claude');
    expect(button().textContent).toContain('Copied');
    expect(announce).toHaveBeenCalledWith('Command copied');

    jest.advanceTimersByTime(COMMAND_COPIED_MS - 1);
    fixture.detectChanges();
    expect(button().textContent).toContain('Copied');
    jest.advanceTimersByTime(1);
    fixture.detectChanges();
    expect(button().textContent).not.toContain('Copied');
  });

  it('releases the timer on destroy', async () => {
    await click();
    const clear = jest.spyOn(globalThis, 'clearTimeout');
    fixture.destroy();
    expect(clear).toHaveBeenCalled();
  });

  it('restarts the timer on a new copy', async () => {
    await click();
    jest.advanceTimersByTime(1500);
    await click();
    jest.advanceTimersByTime(1500);
    fixture.detectChanges();
    expect(button().textContent).toContain('Copied');
    jest.advanceTimersByTime(COMMAND_COPIED_MS - 1500);
    fixture.detectChanges();
    expect(button().textContent).not.toContain('Copied');
  });

  it('shows the inline fallback when the clipboard rejects', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    await click();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="command-copy-fallback"]',
      ).textContent,
    ).toContain('Select the text and copy it.');
    expect(announce).not.toHaveBeenCalled();
  });
});
