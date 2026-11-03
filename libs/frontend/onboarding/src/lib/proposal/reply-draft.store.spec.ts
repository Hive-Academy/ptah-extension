import { TestBed } from '@angular/core/testing';
import { ComposerAttachmentsService, FilePickerService } from '@ptah-extension/chat';
import { ClaudeRpcService } from '@ptah-extension/core';
import { ProposalFlowStore } from './proposal-flow.store';
import { ReplyDraftStore } from './reply-draft.store';

const file = (path: string) => ({
  path, name: path.split('/').at(-1) ?? path, size: 12, type: 'text',
  isLarge: false, tokenEstimate: 3,
});

describe('ReplyDraftStore', () => {
  let store: ReplyDraftStore;
  let attachments: ComposerAttachmentsService;
  let send: jest.Mock<Promise<boolean>, [string, unknown]>;

  beforeEach(() => {
    send = jest.fn<Promise<boolean>, [string, unknown]>().mockResolvedValue(true);
    TestBed.configureTestingModule({ providers: [
      ReplyDraftStore,
      ComposerAttachmentsService,
      { provide: ProposalFlowStore, useValue: { session: { send } } },
      { provide: ClaudeRpcService, useValue: { call: jest.fn() } },
      { provide: FilePickerService, useValue: { isFileSupported: () => true } },
    ] });
    store = TestBed.inject(ReplyDraftStore);
    attachments = TestBed.inject(ComposerAttachmentsService);
  });
  afterEach(() => TestBed.resetTestingModule());

  it('rejects blank replies and pending reads', async () => {
    expect(store.canSend()).toBe(false);
    expect(await store.send()).toBe(false);
    store.setReply('  ');
    expect(await store.send()).toBe(false);
    store.setReply('Answer');
    attachments.pendingReads.set(1);
    expect(store.canSend()).toBe(false);
    expect(await store.send()).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a snapshot, clears sent content, and keeps files added during send', async () => {
    let resolve!: (value: boolean) => void;
    send.mockImplementation(() => new Promise<boolean>((done) => { resolve = done; }));
    attachments.addFile(file('/ws/first.md'));
    store.setReply('  Revise this  ');
    const pending = store.send();
    expect(store.sending()).toBe(true);
    expect(store.canSend()).toBe(false);
    attachments.addFile(file('/ws/later.md'));
    resolve(true);
    expect(await pending).toBe(true);
    expect(send).toHaveBeenCalledWith('Revise this', { files: ['/ws/first.md'], images: undefined });
    expect(attachments.files().map((item) => item.path)).toEqual(['/ws/later.md']);
    expect(store.reply()).toBe('');
    expect(store.announcement()).toBe('Reply sent');
  });

  it('keeps text typed while a send is in flight', async () => {
    let resolve!: (value: boolean) => void;
    send.mockImplementation(() => new Promise<boolean>((done) => { resolve = done; }));
    store.setReply('First reply');
    const pending = store.send();
    store.setReply('Second reply');
    resolve(true);
    expect(await pending).toBe(true);
    expect(send).toHaveBeenCalledWith('First reply', { files: undefined, images: undefined });
    expect(store.reply()).toBe('Second reply');
    expect(store.announcement()).toBe('Reply sent');
  });

  it('resets sending and announces failure when the attachment snapshot throws', async () => {
    jest.spyOn(attachments, 'snapshotForSend').mockImplementation(() => {
      throw new Error('snapshot failed');
    });
    store.setReply('Keep this reply');
    expect(await store.send()).toBe(false);
    expect(store.sending()).toBe(false);
    expect(store.reply()).toBe('Keep this reply');
    expect(store.announcement()).toBe('Reply could not be sent. Try again.');
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps the reply and attachments after a rejected send', async () => {
    send.mockRejectedValue(new Error('private provider error'));
    attachments.addFile(file('/ws/brief.md'));
    store.setReply('Consider the brief');
    expect(await store.send()).toBe(false);
    expect(store.reply()).toBe('Consider the brief');
    expect(attachments.files()).toHaveLength(1);
    expect(store.announcement()).toBe('Reply could not be sent. Try again.');
    expect(store.sending()).toBe(false);
  });
});
