import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AnswerDockComponent } from './answer-dock.component';
import { ProposalFlowStore } from './proposal-flow.store';
import { ClaudeRpcService } from '@ptah-extension/core';
import { FilePickerService } from '@ptah-extension/chat';

describe('AnswerDockComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [
      { provide: ClaudeRpcService, useValue: { call: jest.fn() } },
      { provide: FilePickerService, useValue: { isFileSupported: () => true } },
    ] });
  });
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
    expect(send).toHaveBeenCalledWith('Use a smaller team', { files: undefined, images: undefined });
    expect(fixture.componentInstance.announcement()).toBe('Reply sent');
    expect(fixture.componentInstance.open()).toBe(false);
    fixture.destroy();
  });
  it('keeps attachments when a reply fails', async () => {
    const send = jest.fn().mockResolvedValue(false);
    TestBed.configureTestingModule({
      imports: [AnswerDockComponent],
      providers: [{ provide: ProposalFlowStore, useValue: {
        session: { phase: signal('idle'), latestAssistantMessage: signal(null), send },
      } }],
    });
    const fixture = TestBed.createComponent(AnswerDockComponent);
    fixture.componentInstance.attachments.addFile({
      path: '/ws/brief.md', name: 'brief.md', size: 12, type: 'text',
      isLarge: false, tokenEstimate: 3,
    });
    fixture.componentInstance.reply.set('Consider the brief');
    await fixture.componentInstance.send();
    expect(send).toHaveBeenCalledWith('Consider the brief', { files: ['/ws/brief.md'], images: undefined });
    expect(fixture.componentInstance.attachments.files()).toHaveLength(1);
    fixture.destroy();
  });
  it('keeps attachments added during a reply and blocks a pending image read', async () => {
    let finish!: (sent: boolean) => void;
    const send = jest.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    TestBed.configureTestingModule({
      imports: [AnswerDockComponent],
      providers: [{ provide: ProposalFlowStore, useValue: {
        session: { phase: signal('idle'), latestAssistantMessage: signal(null), send },
      } }],
    });
    const fixture = TestBed.createComponent(AnswerDockComponent);
    fixture.detectChanges();
    const dock = fixture.componentInstance;
    dock.reply.set('Consider these files');
    dock.attachments.pendingReads.set(1);
    await dock.send();
    fixture.detectChanges();
    expect(send).not.toHaveBeenCalled();
    expect((fixture.nativeElement.querySelector('button.btn-primary') as HTMLButtonElement).disabled).toBe(true);
    dock.attachments.pendingReads.set(0);
    dock.attachments.addFile({ path: '/ws/first.md', name: 'first.md', size: 12, type: 'text', isLarge: false, tokenEstimate: 3 });
    const pending = dock.send();
    dock.attachments.addFile({ path: '/ws/later.md', name: 'later.md', size: 12, type: 'text', isLarge: false, tokenEstimate: 3 });
    finish(true);
    await pending;
    expect(send).toHaveBeenCalledWith('Consider these files', { files: ['/ws/first.md'], images: undefined });
    expect(dock.attachments.files().map((file) => file.path)).toEqual(['/ws/later.md']);
    expect((fixture.nativeElement.querySelector('#dock-reply') as HTMLTextAreaElement).getAttribute('aria-describedby')).toBe('dock-attachment-hint');
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
