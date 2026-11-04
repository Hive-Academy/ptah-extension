import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ComposerAttachmentsService, FilePickerService } from '@ptah-extension/chat';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  COMPOSER_CARD_BORDER_CLASS, COMPOSER_CARD_CLASS,
  COMPOSER_SEND_BUTTON_CLASS, COMPOSER_TEXTAREA_CLASS, COMPOSER_TOOLBAR_CLASS,
} from '@ptah-extension/chat-ui';
import { ProposalFlowStore } from './proposal-flow.store';
import { ReplyComposerComponent } from './reply-composer.component';
import { ReplyDraftStore } from './reply-draft.store';

describe('ReplyComposerComponent', () => {
  const record = signal<object | null>({});
  const send = jest.fn<Promise<boolean>, [string, unknown]>().mockResolvedValue(true);
  beforeEach(() => {
    record.set({});
    send.mockReset().mockResolvedValue(true);
    TestBed.configureTestingModule({
      imports: [ReplyComposerComponent],
      providers: [
        ReplyDraftStore, ComposerAttachmentsService,
        { provide: ProposalFlowStore, useValue: { session: { record, send } } },
        { provide: ClaudeRpcService, useValue: { call: jest.fn() } },
        { provide: FilePickerService, useValue: { isFileSupported: () => true } },
      ],
    });
  });
  afterEach(() => TestBed.resetTestingModule());

  function render(status: 'ready' | 'working' = 'ready') {
    const fixture = TestBed.createComponent(ReplyComposerComponent);
    fixture.componentRef.setInput('status', status);
    fixture.detectChanges();
    return fixture;
  }

  it('uses the shared card classes and hides without a bound record', () => {
    const fixture = render();
    const root = fixture.nativeElement as HTMLElement;
    const card = root.querySelector('[data-glass-surface="tile"]') as HTMLElement;
    const textarea = root.querySelector('textarea') as HTMLTextAreaElement;
    const toolbar = root.querySelector('button[aria-label="Send reply"]')?.parentElement as HTMLElement;
    const sendButton = root.querySelector('button[aria-label="Send reply"]') as HTMLButtonElement;
    for (const [element, classes] of [
      [card, `${COMPOSER_CARD_CLASS} ${COMPOSER_CARD_BORDER_CLASS}`],
      [textarea, COMPOSER_TEXTAREA_CLASS],
      [toolbar, COMPOSER_TOOLBAR_CLASS],
      [sendButton, COMPOSER_SEND_BUTTON_CLASS],
    ] as const) for (const token of classes.split(' ')) expect(element.classList.contains(token)).toBe(true);
    expect(sendButton.classList.contains('btn-primary')).toBe(false);
    expect(root.querySelector('[data-testid="reply-composer"]')?.classList.contains('hidden')).toBe(true);
    record.set(null);
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="reply-composer"]')).toBeNull();
  });

  it('sends on Enter, keeps focus, and leaves Shift+Enter and IME Enter alone', async () => {
    const fixture = render();
    const textarea = (fixture.nativeElement as HTMLElement).querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Revise this';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    for (const options of [{ shiftKey: true }, { isComposing: true }]) {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options });
      textarea.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(send).not.toHaveBeenCalled();
    textarea.focus();
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(send).toHaveBeenCalledWith('Revise this', { files: undefined, images: undefined });
    expect(textarea.value).toBe('');
    expect(document.activeElement).toBe(textarea);
    expect(TestBed.inject(ReplyDraftStore).announcement()).toBe('Reply sent');
  });

  it('places the tray before attachment controls and shows the working hint', () => {
    const fixture = render('working');
    const root = fixture.nativeElement as HTMLElement;
    const textarea = root.querySelector('textarea') as HTMLTextAreaElement;
    const tray = root.querySelector('[data-testid="reply-tray"]') as HTMLElement;
    const attach = root.querySelector('button[aria-label="Attach files"]') as HTMLButtonElement;
    const sendButton = root.querySelector('button[aria-label="Send reply"]') as HTMLButtonElement;
    expect(textarea.compareDocumentPosition(tray) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tray.compareDocumentPosition(attach) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(attach.compareDocumentPosition(sendButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(textarea.getAttribute('aria-describedby')).toBe('reply-working-hint reply-attachment-hint');
    expect(sendButton.disabled).toBe(true);
    expect(sendButton.getAttribute('aria-label')).toBe('Send reply');
  });
});
