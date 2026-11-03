import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ComposerAttachmentsService, FilePickerService } from '@ptah-extension/chat';
import { ClaudeRpcService } from '@ptah-extension/core';
import { AnswerDockComponent } from './answer-dock.component';
import { ProposalFlowStore } from './proposal-flow.store';
import { ReplyDraftStore } from './reply-draft.store';

describe('AnswerDockComponent', () => {
  const status = signal<'waiting' | 'working'>('waiting');
  const send = jest.fn<Promise<boolean>, [string, unknown]>().mockResolvedValue(true);
  beforeEach(() => {
    status.set('waiting'); send.mockClear();
    TestBed.configureTestingModule({ providers: [
      ComposerAttachmentsService, ReplyDraftStore,
      { provide: ProposalFlowStore, useValue: { sessionStatus: status, session: { send } } },
      { provide: ClaudeRpcService, useValue: { call: jest.fn() } },
      { provide: FilePickerService, useValue: { isFileSupported: () => true } },
    ] });
  });
  afterEach(() => TestBed.resetTestingModule());

  it('keeps only a bar and sheet, with store status vocabulary and no preview', () => {
    const fixture = TestBed.createComponent(AnswerDockComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('aside')).toBeNull();
    expect(root.querySelector('[data-testid="answer-dock"]')).toBeNull();
    expect(root.querySelector('button[aria-controls="answer-dock-sheet"]')?.textContent).toContain('Waiting for you');
    status.set('working'); fixture.detectChanges();
    expect(root.querySelector('button[aria-controls="answer-dock-sheet"]')?.textContent).toContain('Working');
    expect(root.textContent).not.toContain('Show full message');
    fixture.destroy();
  });

  it('traps sheet focus, Escape closes, and releases inert background', async () => {
    const fixture = TestBed.createComponent(AnswerDockComponent);
    const background = document.createElement('div'); document.body.append(background);
    fixture.componentRef.setInput('background', [background]); fixture.detectChanges();
    const bar = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[aria-controls="answer-dock-sheet"]')!;
    bar.click(); fixture.detectChanges(); await fixture.whenStable();
    const sheet = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="dialog"]')!;
    expect(background.inert).toBe(true);
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(sheet.textContent).toContain('Reply to the agent');
    expect(document.activeElement).toBe(sheet.querySelector('textarea'));
    sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges(); await fixture.whenStable();
    expect(background.inert).toBe(false);
    expect(document.activeElement).toBe(bar);
    fixture.destroy(); background.remove();
  });


  it('announces send failure once outside the narrow-only bar and sheet', async () => {
    send.mockResolvedValueOnce(false);
    const fixture = TestBed.createComponent(AnswerDockComponent);
    fixture.detectChanges();
    const draft = TestBed.inject(ReplyDraftStore);
    draft.setReply('Please revise');
    await fixture.componentInstance.send(); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const live = root.querySelector<HTMLElement>('[role="status"][aria-live="polite"]');
    expect(live?.textContent).toBe('Reply could not be sent. Try again.');
    expect(root.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(live?.closest('#answer-dock-sheet')).toBeNull();
    expect(live?.closest('button[aria-controls="answer-dock-sheet"]')).toBeNull();
    expect(root.querySelector('#answer-dock-sheet')).toBeNull();
    fixture.destroy();
  });
  it('uses one draft and one polite result announcement for a sent reply', async () => {
    const fixture = TestBed.createComponent(AnswerDockComponent);
    fixture.detectChanges();
    const draft = TestBed.inject(ReplyDraftStore);
    draft.setReply('Use a smaller team');
    fixture.componentInstance.openSheet(); fixture.detectChanges(); await fixture.whenStable();
    const textarea = (fixture.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>('#dock-sheet-reply')!;
    expect(textarea.value).toBe('Use a smaller team');
    await fixture.componentInstance.send(); fixture.detectChanges();
    expect(send).toHaveBeenCalledWith('Use a smaller team', { files: undefined, images: undefined });
    expect(draft.reply()).toBe('');
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="status"]')?.textContent).toBe('Reply sent');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(fixture.componentInstance.open()).toBe(false);
    fixture.destroy();
  });
});
