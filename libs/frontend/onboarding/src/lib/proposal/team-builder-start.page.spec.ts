import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ProposalFlowStore } from './proposal-flow.store';
import { TeamBuilderStartPage } from './team-builder-start.page';
import { ComposerAttachmentsService } from '@ptah-extension/chat';
import { FilePickerService } from '@ptah-extension/chat';
import { ClaudeRpcService } from '@ptah-extension/core';

const attachment = (path: string) => ({
  path, name: path.split('/').pop() ?? path, size: 12,
  type: 'text' as const, isLarge: false, tokenEstimate: 3,
});

describe('TeamBuilderStartPage', () => {
  it('requires an intent and discards a new session when navigation is cancelled', async () => {
    const start = jest.fn().mockResolvedValue('new-tab');
    const discardCancelledStart = jest.fn().mockResolvedValue(undefined);
    const navigate = jest.fn().mockResolvedValue(false);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ProposalFlowStore,
          useValue: {
            workspaceRoot: signal('/ws'),
            records: { readDraft: () => null },
            actionError: signal(null),
            leaveOpen: signal(false),
            lastStartCreated: signal(true),
            start,
            discardCancelledStart,
          },
        },
        { provide: Router, useValue: { navigate } },
        ComposerAttachmentsService,
        { provide: ClaudeRpcService, useValue: { call: jest.fn() } },
        { provide: FilePickerService, useValue: { isFileSupported: () => true } },
      ],
    });
    const page = TestBed.runInInjectionContext(
      () => new TeamBuilderStartPage(),
    );
    await page.submit({ preventDefault: jest.fn() } as unknown as Event);
    expect(start).not.toHaveBeenCalled();
    page.intent.set('A research team');
    page.attachments.addFile(attachment('/ws/team.md'));
    await page.submit({ preventDefault: jest.fn() } as unknown as Event);
    expect(start).toHaveBeenCalledWith({
      mode: 'configure-harness',
      workspaceRoot: '/ws',
      intent: 'A research team',
      attachments: { files: ['/ws/team.md'], images: undefined },
    });
    expect(navigate).toHaveBeenCalled();
    expect(discardCancelledStart).toHaveBeenCalledTimes(1);
    expect(page.attachments.files()).toHaveLength(0);
  });

  it('preserves attachments added while team start is pending', async () => {
    let finish!: (tab: string) => void;
    const start = jest.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    TestBed.configureTestingModule({ providers: [
      { provide: ProposalFlowStore, useValue: {
        workspaceRoot: signal('/ws'), records: { readDraft: () => null },
        actionError: signal(null), leaveOpen: signal(false), lastStartCreated: signal(true),
        start, discardCancelledStart: jest.fn(),
      } },
      { provide: Router, useValue: { navigate: jest.fn().mockResolvedValue(true) } },
      ComposerAttachmentsService,
      { provide: ClaudeRpcService, useValue: { call: jest.fn() } },
      { provide: FilePickerService, useValue: { isFileSupported: () => true } },
    ] });
    const page = TestBed.runInInjectionContext(() => new TeamBuilderStartPage());
    page.intent.set('A research team');
    page.attachments.addFile(attachment('/ws/first.md'));
    page.attachments.pendingReads.set(1);
    await page.submit({ preventDefault: jest.fn() } as unknown as Event);
    expect(start).not.toHaveBeenCalled();
    page.attachments.pendingReads.set(0);
    const pending = page.submit({ preventDefault: jest.fn() } as unknown as Event);
    page.attachments.addFile(attachment('/ws/later.md'));
    finish('new-tab');
    await pending;
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ attachments: { files: ['/ws/first.md'], images: undefined } }));
    expect(page.attachments.files().map((file) => file.path)).toEqual(['/ws/later.md']);
  });
});
