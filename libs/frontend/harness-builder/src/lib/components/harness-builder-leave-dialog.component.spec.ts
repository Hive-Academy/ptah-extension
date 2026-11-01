import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { HarnessBuilderLeaveDialogComponent } from './harness-builder-leave-dialog.component';

describe('HarnessBuilderLeaveDialogComponent', () => {
  let fixture: ComponentFixture<HarnessBuilderLeaveDialogComponent>;
  let trigger: HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HarnessBuilderLeaveDialogComponent],
    }).compileComponents();
    trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    fixture = TestBed.createComponent(HarnessBuilderLeaveDialogComponent);
    fixture.componentRef.setInput('trigger', trigger);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    if (!fixture.componentRef.hostView.destroyed) fixture.destroy();
    trigger.remove();
  });

  it('focuses Cancel and traps Tab and Shift+Tab in button order', async () => {
    await Promise.resolve();
    const buttons = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLButtonElement>('button');
    expect(document.activeElement).toBe(buttons[0]);
    buttons[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
    );
    expect(document.activeElement).toBe(buttons[1]);
    buttons[1].dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        shiftKey: true,
      }),
    );
    expect(document.activeElement).toBe(buttons[0]);
    buttons[0].dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        shiftKey: true,
      }),
    );
    expect(document.activeElement).toBe(buttons[2]);
  });

  it('treats Escape and backdrop as Cancel', () => {
    const choices: string[] = [];
    fixture.componentInstance.choice.subscribe((choice) =>
      choices.push(choice),
    );
    const dialog = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="dialog"]',
    ) as HTMLElement;
    dialog.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    const backdrop = dialog.parentElement as HTMLElement;
    backdrop.click();
    expect(choices).toEqual(['cancel', 'cancel']);
  });

  it('keeps Save unavailable before the session starts and returns focus on close', async () => {
    fixture.componentRef.setInput('sessionStarted', false);
    fixture.detectChanges();
    const buttons = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLButtonElement>('button');
    const choices: string[] = [];
    fixture.componentInstance.choice.subscribe((choice) =>
      choices.push(choice),
    );
    expect(buttons[2].getAttribute('aria-disabled')).toBe('true');
    expect(buttons[2].getAttribute('aria-describedby')).toBe(
      'builder-save-pending',
    );
    buttons[2].click();
    expect(choices).toEqual([]);
    fixture.destroy();
    await Promise.resolve();
    expect(document.activeElement).toBe(trigger);
  });

  it('blocks duplicate choices while saving and shows a recoverable failure', () => {
    fixture.componentRef.setInput('saving', true);
    fixture.detectChanges();
    const buttons = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLButtonElement>('button');
    const choices: string[] = [];
    fixture.componentInstance.choice.subscribe((choice) =>
      choices.push(choice),
    );
    buttons[1].click();
    expect(choices).toEqual([]);
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('[role="dialog"]')
        ?.getAttribute('aria-busy'),
    ).toBe('true');
    fixture.componentRef.setInput('saving', false);
    fixture.componentRef.setInput('saveFailed', true);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')
        ?.textContent,
    ).toContain('nothing changed');
    expect(buttons[2].textContent).toContain('Try again');
  });
});

describe('HarnessBuilderLeaveDialogComponent uncertain stop', () => {
  it('offers Retry stop and Keep current without a save or discard choice', async () => {
    await TestBed.configureTestingModule({
      imports: [HarnessBuilderLeaveDialogComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(HarnessBuilderLeaveDialogComponent);
    fixture.componentRef.setInput('stopUncertain', true);
    fixture.detectChanges();
    const stopChoices: string[] = [];
    const leaveChoices: string[] = [];
    fixture.componentInstance.stopChoice.subscribe((choice) =>
      stopChoices.push(choice),
    );
    fixture.componentInstance.choice.subscribe((choice) =>
      leaveChoices.push(choice),
    );
    const buttons = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLButtonElement>('button');
    expect(
      Array.from(buttons).map((button) => button.textContent?.trim()),
    ).toEqual(['Keep current', 'Retry stop']);
    buttons[1].click();
    buttons[0].click();
    expect(stopChoices).toEqual(['retry-stop', 'keep-current']);
    expect(leaveChoices).toEqual([]);
    fixture.destroy();
  });
});

describe('HarnessBuilderLeaveDialogComponent inert boundary', () => {
  it('inerts onboarding content while leaving app chrome interactive', async () => {
    await TestBed.configureTestingModule({
      imports: [HarnessBuilderLeaveDialogComponent],
    }).compileComponents();
    const chrome = document.createElement('nav');
    const shell = document.createElement('ptah-onboarding-shell');
    const page = document.createElement('main');
    const sibling = document.createElement('section');
    shell.append(page, sibling);
    document.body.append(chrome, shell);
    const fixture = TestBed.createComponent(HarnessBuilderLeaveDialogComponent);
    page.appendChild(fixture.nativeElement as HTMLElement);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(sibling.hasAttribute('inert')).toBe(true);
    expect(chrome.hasAttribute('inert')).toBe(false);
    fixture.destroy();
    expect(sibling.hasAttribute('inert')).toBe(false);
    shell.remove();
    chrome.remove();
  });
});
