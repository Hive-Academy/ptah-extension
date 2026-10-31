import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AnswerDockComponent } from './answer-dock.component';
import { ProposalFlowStore } from './proposal-flow.store';

describe('AnswerDockComponent', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('traps sheet focus, Escape closes, and returns focus to the bar', async () => {
    TestBed.configureTestingModule({
      imports: [AnswerDockComponent],
      providers: [
        {
          provide: ProposalFlowStore,
          useValue: {
            session: {
              phase: signal('idle'),
              latestAssistantMessage: signal(null),
              send: jest.fn().mockResolvedValue(true),
            },
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(AnswerDockComponent);
    const background = document.createElement('div');
    const header = document.createElement('header');
    document.body.append(background, header);
    fixture.componentRef.setInput('background', [background, header]);
    fixture.detectChanges();
    const bar = fixture.nativeElement.querySelector(
      'button[aria-controls="answer-dock-sheet"]',
    ) as HTMLButtonElement;
    bar.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(background.inert).toBe(true);
    expect(header.inert).toBe(true);
    const sheet = fixture.nativeElement.querySelector(
      '[role="dialog"]',
    ) as HTMLElement;
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(sheet.querySelector('textarea'));
    sheet.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(background.inert).toBe(false);
    expect(header.inert).toBe(false);
    expect(document.activeElement).toBe(bar);
    background.remove();
    header.remove();
    fixture.destroy();
  });
  it('announces a sent reply and closes the sheet', async () => {
    const send = jest.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      imports: [AnswerDockComponent],
      providers: [
        {
          provide: ProposalFlowStore,
          useValue: {
            session: {
              phase: signal('idle'),
              latestAssistantMessage: signal(null),
              send,
            },
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(AnswerDockComponent);
    fixture.detectChanges();
    fixture.componentInstance.open.set(true);
    fixture.componentInstance.reply.set('Use a smaller team');
    await fixture.componentInstance.send();
    fixture.detectChanges();
    expect(send).toHaveBeenCalledWith('Use a smaller team');
    expect(fixture.componentInstance.announcement()).toBe('Reply sent');
    expect(fixture.componentInstance.open()).toBe(false);
    fixture.destroy();
  });
  it('releases inert background when the viewport widens and Escape works during send', async () => {
    let listener: (() => void) | undefined;
    const media = {
      matches: false,
      addEventListener: jest.fn((_event: string, fn: () => void) => {
        listener = fn;
      }),
      removeEventListener: jest.fn(),
    };
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn(() => media),
    });
    let finishSend: ((value: boolean) => void) | undefined;
    const send = jest.fn().mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishSend = resolve;
        }),
    );
    try {
      TestBed.configureTestingModule({
        imports: [AnswerDockComponent],
        providers: [
          {
            provide: ProposalFlowStore,
            useValue: {
              session: {
                phase: signal('idle'),
                latestAssistantMessage: signal(null),
                send,
              },
            },
          },
        ],
      });
      const fixture = TestBed.createComponent(AnswerDockComponent);
      const background = document.createElement('div');
      document.body.append(background);
      fixture.componentRef.setInput('background', [background]);
      fixture.detectChanges();
      fixture.componentInstance.openSheet();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.componentInstance.reply.set('Continue');
      const pending = fixture.componentInstance.send();
      const sheet = fixture.nativeElement.querySelector(
        '[role="dialog"]',
      ) as HTMLElement;
      sheet.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      fixture.detectChanges();
      expect(fixture.componentInstance.open()).toBe(false);
      finishSend?.(true);
      await pending;
      fixture.componentInstance.openSheet();
      fixture.detectChanges();
      await fixture.whenStable();
      media.matches = true;
      listener?.();
      fixture.detectChanges();
      expect(fixture.componentInstance.open()).toBe(false);
      expect(background.inert).toBe(false);
      background.remove();
      fixture.destroy();
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: original,
      });
    }
  });
});
