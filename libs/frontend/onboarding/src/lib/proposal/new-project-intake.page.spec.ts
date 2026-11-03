import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { NewProjectIntakePage } from './new-project-intake.page';
import { ProposalFlowStore } from './proposal-flow.store';
import { ComposerAttachmentsService } from '@ptah-extension/chat';
import { ClaudeRpcService } from '@ptah-extension/core';
import { FilePickerService } from '@ptah-extension/chat';
import { HarnessRpcService } from '@ptah-extension/harness-builder';

const attachment = (path: string) => ({
  path, name: path.split('/').pop() ?? path, size: 12,
  type: 'text' as const, isLarge: false, tokenEstimate: 3,
});

describe('NewProjectIntakePage', () => {
  const makePage = () =>
    TestBed.runInInjectionContext(() => new NewProjectIntakePage());
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ProposalFlowStore,
          useValue: {
            workspaceRoot: signal('/ws'),
            records: { readDraft: () => null },
            actionError: signal(null),
            leaveOpen: signal(false),
          },
        },
        { provide: Router, useValue: { navigate: jest.fn() } },
        ComposerAttachmentsService,
        { provide: ClaudeRpcService, useValue: { call: jest.fn() } },
        { provide: FilePickerService, useValue: { isFileSupported: () => true } },
        { provide: HarnessRpcService, useValue: { initialize: jest.fn().mockResolvedValue({ workspaceEffectivelyEmpty: true }) } },
      ],
    }),
  );
  it('validates required brief and other stack on submit', async () => {
    const page = makePage();
    await page.submit({ preventDefault: jest.fn() } as unknown as Event);
    expect(page.errors()).toContain('What are you building is required.');
    page.what.set('A planning app');
    page.stack.set('other');
    expect(page.errors()).toContain('Enter your stack.');
  });
  it('requires confirmation before starting in a nonempty folder', async () => {
    const start = jest.fn();
    TestBed.overrideProvider(HarnessRpcService, { useValue: { initialize: jest.fn().mockResolvedValue({ workspaceEffectivelyEmpty: false }) } });
    TestBed.overrideProvider(ProposalFlowStore, { useValue: {
      workspaceRoot: signal('/ws'), records: { readDraft: () => null }, actionError: signal(null),
      leaveOpen: signal(false), start, lastStartCreated: signal(false),
    } });
    const page = makePage();
    await Promise.resolve();
    expect(page.workspaceEmpty()).toBe(false);
    page.what.set('A planning app');
    await page.submit({ preventDefault: jest.fn() } as unknown as Event);
    expect(start).not.toHaveBeenCalled();
    page.confirmedNonEmpty.set(true);
    start.mockResolvedValue(null);
    await page.submit({ preventDefault: jest.fn() } as unknown as Event);
    expect(start).toHaveBeenCalledTimes(1);
  });
  it('holds submission until the folder check succeeds and offers retry on failure', async () => {
    let finish!: (value: { workspaceEffectivelyEmpty: boolean }) => void;
    const initialize = jest.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ workspaceEffectivelyEmpty: true });
    const start = jest.fn().mockResolvedValue(null);
    TestBed.overrideProvider(HarnessRpcService, { useValue: { initialize } });
    TestBed.overrideProvider(ProposalFlowStore, { useValue: {
      workspaceRoot: signal('/ws'), records: { readDraft: () => null }, actionError: signal(null),
      leaveOpen: signal(false), start, lastStartCreated: signal(false),
    } });
    const page = makePage();
    page.what.set('Planning app');
    await page.submit({ preventDefault: jest.fn() } as unknown as Event);
    expect(start).not.toHaveBeenCalled();
    finish({ workspaceEffectivelyEmpty: true });
    await Promise.resolve();
    expect(page.workspaceEmpty()).toBe(true);
    await page.submit({ preventDefault: jest.fn() } as unknown as Event);
    expect(start).toHaveBeenCalledTimes(1);
    page.workspaceEmpty.set(null);
    await page.retryWorkspaceCheck();
    expect(page.workspaceCheckError()).toBe('Could not check this folder. Try again.');
    await page.retryWorkspaceCheck();
    expect(page.workspaceEmpty()).toBe(true);
    expect(page.workspaceCheckError()).toBeNull();
  });
  it('resets stack and custom stack when platform changes', () => {
    const page = makePage();
    page.stack.set('other');
    page.stackOther.set('Rust');
    page.setPlatform('python');
    expect(page.stack()).toBe('recommend');
    expect(page.stackOther()).toBe('');
  });
  it('uses one registry option per stack, including the other platform', () => {
    const page = makePage();
    const labels = page.stackOptions().map((option) => option.label);
    expect(labels.filter((label) => label === 'Recommend for me')).toHaveLength(
      1,
    );
    expect(labels.filter((label) => label === 'Other')).toHaveLength(1);
    page.setPlatform('other');
    expect(page.stackOptions().map((option) => option.value)).toEqual([
      'recommend',
      'other',
    ]);
  });
  it('starts a valid brief and discards its new session when navigation is cancelled', async () => {
    const start = jest.fn().mockResolvedValue('new-tab');
    const discardCancelledStart = jest.fn().mockResolvedValue(undefined);
    TestBed.overrideProvider(ProposalFlowStore, {
      useValue: {
        workspaceRoot: signal('/ws'),
        records: { readDraft: () => null },
        actionError: signal(null),
        leaveOpen: signal(false),
        lastStartCreated: signal(true),
        start,
        discardCancelledStart,
      },
    });
    const navigate = jest.fn().mockResolvedValue(false);
    TestBed.overrideProvider(Router, { useValue: { navigate } });
    const page = makePage();
    page.what.set('Planning app');
    await page.retryWorkspaceCheck();
    page.attachments.addFile(attachment('/ws/brief.md'));
    await page.submit({ preventDefault: jest.fn() } as unknown as Event);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'new-project',
        workspaceRoot: '/ws',
        intake: expect.objectContaining({ what: 'Planning app' }),
        attachments: { files: ['/ws/brief.md'], images: undefined },
      }),
    );
    expect(navigate).toHaveBeenCalled();
    expect(discardCancelledStart).toHaveBeenCalledTimes(1);
    expect(page.attachments.files()).toHaveLength(0);
  });

  it('keeps attachments when the first send fails', async () => {
    const start = jest.fn().mockResolvedValue(null);
    TestBed.overrideProvider(ProposalFlowStore, { useValue: {
      workspaceRoot: signal('/ws'), records: { readDraft: () => null },
      actionError: signal('Send failed'), leaveOpen: signal(false), start,
      lastStartCreated: signal(false),
    } });
    const page = makePage();
    page.what.set('Planning app');
    await page.retryWorkspaceCheck();
    page.attachments.addFile(attachment('/ws/brief.md'));
    await page.submit({ preventDefault: jest.fn() } as unknown as Event);
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ attachments: { files: ['/ws/brief.md'], images: undefined } }));
    expect(page.attachments.files()).toHaveLength(1);
  });

  it('preserves attachments added while the first send is pending', async () => {
    let finish!: (tab: string) => void;
    const start = jest.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    TestBed.overrideProvider(ProposalFlowStore, { useValue: {
      workspaceRoot: signal('/ws'), records: { readDraft: () => null },
      actionError: signal(null), leaveOpen: signal(false), lastStartCreated: signal(true),
      start, discardCancelledStart: jest.fn(),
    } });
    TestBed.overrideProvider(Router, { useValue: { navigate: jest.fn().mockResolvedValue(true) } });
    const page = makePage();
    page.what.set('Planning app');
    await page.retryWorkspaceCheck();
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
