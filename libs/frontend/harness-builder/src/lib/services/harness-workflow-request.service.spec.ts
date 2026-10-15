import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChatStore } from '@ptah-extension/chat';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  LoggingService,
  SurfaceRouterService,
  VSCodeService,
} from '@ptah-extension/core';
import { HarnessBuilderRecordsService } from './harness-builder-records.service';
import { HarnessRpcService } from './harness-rpc.service';
import { HarnessWorkflowRequestService } from './harness-workflow-request.service';

describe('HarnessWorkflowRequestService', () => {
  const intake = {
    what: 'Clinic scheduler',
    audience: 'b2b' as const,
    stack: 'recommend' as const,
  };
  const tabsSignal = signal<
    Array<{ id: string; workflow: 'harness-configure' | 'harness-new-project' }>
  >([]);
  const activeId = signal<string | null>(null);
  const visible = signal<ReadonlySet<string>>(new Set(['new-tab']));
  let service: HarnessWorkflowRequestService;
  let router: { navigateToSurface: jest.Mock };
  let tabs: {
    createTab: jest.Mock;
    setWorkflow: jest.Mock;
    setFirstMessagePreamble: jest.Mock;
    closeTab: jest.Mock;
    findTabByIdAcrossWorkspaces: jest.Mock;
  };
  let rpc: { startNewProject: jest.Mock; workflowPrompt: jest.Mock };
  let records: {
    readDraft: jest.Mock;
    writeStackProfile: jest.Mock;
    clearTab: jest.Mock;
  };
  let chat: { sendOrQueueMessage: jest.Mock };

  beforeEach(() => {
    tabsSignal.set([]);
    activeId.set(null);
    visible.set(new Set(['new-tab']));
    router = { navigateToSurface: jest.fn().mockResolvedValue('navigated') };
    tabs = {
      createTab: jest.fn().mockReturnValue('new-tab'),
      setWorkflow: jest.fn(),
      setFirstMessagePreamble: jest.fn(),
      closeTab: jest.fn().mockResolvedValue(undefined),
      findTabByIdAcrossWorkspaces: jest.fn().mockReturnValue(null),
    };
    rpc = {
      startNewProject: jest.fn().mockImplementation(async (value) => ({
        success: true,
        seedPrompt: 'hidden seed',
        intake: value,
        plugins: {
          enabledBundled: [],
          missingExternal: [],
          availableSkillIds: [],
        },
      })),
      workflowPrompt: jest
        .fn()
        .mockResolvedValue({ prompt: 'context preamble' }),
    };
    records = {
      readDraft: jest.fn().mockReturnValue(null),
      writeStackProfile: jest.fn().mockReturnValue(true),
      clearTab: jest.fn(),
    };
    chat = {
      sendOrQueueMessage: jest.fn().mockResolvedValue({ success: true }),
    };
    TestBed.configureTestingModule({
      providers: [
        HarnessWorkflowRequestService,
        {
          provide: TabManagerService,
          useValue: {
            ...tabs,
            tabs: tabsSignal,
            activeTabId: activeId,
            visibleTabIds: visible,
            activeWorkspacePath: 'C:/work',
          },
        },
        { provide: ChatStore, useValue: chat },
        { provide: HarnessRpcService, useValue: rpc },
        { provide: HarnessBuilderRecordsService, useValue: records },
        { provide: SurfaceRouterService, useValue: router },
        {
          provide: VSCodeService,
          useValue: { config: () => ({ workspaceRoot: 'C:/work' }) },
        },
        { provide: LoggingService, useValue: { error: jest.fn() } },
      ],
    });
    service = TestBed.inject(HarnessWorkflowRequestService);
  });

  it('resumes the same-mode running tab without another seed or send', async () => {
    tabsSignal.set([{ id: 'running', workflow: 'harness-new-project' }]);
    activeId.set('running');
    expect(await service.requestAndNavigate({ mode: 'new-project' })).toBe(
      'landed',
    );
    expect(router.navigateToSurface).toHaveBeenCalledWith('harness-builder', [
      'new-project',
      'running',
    ]);
    expect(rpc.startNewProject).not.toHaveBeenCalled();
    expect(chat.sendOrQueueMessage).not.toHaveBeenCalled();
  });

  it('resumes a saved draft when its tagged tab still exists', async () => {
    records.readDraft.mockReturnValue({ tabId: 'draft' });
    tabs.findTabByIdAcrossWorkspaces.mockReturnValue({
      tab: { id: 'draft', workflow: 'harness-configure' },
    });
    expect(
      await service.requestAndNavigate({ mode: 'configure-harness' }),
    ).toBe('landed');
    expect(router.navigateToSurface).toHaveBeenCalledWith('harness-builder', [
      'configure-harness',
      'draft',
    ]);
    expect(tabs.createTab).not.toHaveBeenCalled();
  });

  it.each([
    ['harness-configure', 'new-project', 'configure-harness'],
    ['harness-new-project', 'configure-harness', 'new-project'],
  ] as const)(
    'hands %s off to the running builder and ignores a second click',
    async (workflow, target, source) => {
      tabsSignal.set([{ id: 'old', workflow }]);
      const request =
        target === 'new-project' ? { mode: target, intake } : { mode: target };
      expect(await service.requestAndNavigate(request)).toBe('landed');
      expect(service.pendingIntent()?.targetMode).toBe(target);
      expect(router.navigateToSurface).toHaveBeenCalledWith('harness-builder', [
        source,
        'old',
      ]);
      expect(await service.requestAndNavigate(request)).toBe('cancelled');
      expect(rpc.startNewProject).not.toHaveBeenCalled();
      expect(tabs.createTab).not.toHaveBeenCalled();
    },
  );

  it('Cancel preserves the old run and never starts a New Project', async () => {
    tabsSignal.set([{ id: 'old', workflow: 'harness-configure' }]);
    await service.requestAndNavigate({ mode: 'new-project', intake });
    service.cancelPendingIntent();
    expect(service.pendingIntent()).toBeNull();
    expect(rpc.startNewProject).not.toHaveBeenCalled();
  });

  it('copies validated intake before clearing intent and starts after the leave choice', async () => {
    tabsSignal.set([{ id: 'old', workflow: 'harness-configure' }]);
    await service.requestAndNavigate({ mode: 'new-project', intake });
    const stored = service.pendingIntent()?.validatedIntake;
    expect(stored).toEqual(intake);
    tabsSignal.set([]);
    expect(await service.completePendingIntent()).toBe('landed');
    expect(service.pendingIntent()).toBeNull();
    expect(rpc.startNewProject).toHaveBeenCalledWith(intake);
    expect(tabs.setWorkflow).toHaveBeenCalledWith(
      'new-tab',
      'harness-new-project',
    );
    expect(tabs.setFirstMessagePreamble).toHaveBeenCalledWith(
      'new-tab',
      'hidden seed',
    );
    expect(records.writeStackProfile.mock.invocationCallOrder[0]).toBeLessThan(
      chat.sendOrQueueMessage.mock.invocationCallOrder[0],
    );
    expect(chat.sendOrQueueMessage).toHaveBeenCalledWith(
      expect.stringContaining('Clinic scheduler'),
      { tabId: 'new-tab' },
    );
  });

  it('uses context-only preamble for Configure', async () => {
    expect(
      await service.requestAndNavigate({ mode: 'configure-harness' }),
    ).toBe('landed');
    expect(rpc.workflowPrompt).toHaveBeenCalledWith({
      mode: 'configure-harness',
      contextOnly: true,
    });
    expect(tabs.setWorkflow).toHaveBeenCalledWith(
      'new-tab',
      'harness-configure',
    );
    expect(chat.sendOrQueueMessage).not.toHaveBeenCalled();
  });

  it('keeps the first turn when stack-profile storage fails', async () => {
    records.writeStackProfile.mockReturnValue(false);
    expect(
      await service.requestAndNavigate({ mode: 'new-project', intake }),
    ).toBe('landed');
    expect(chat.sendOrQueueMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps an abort warning until dismissed', () => {
    service.reportAbortFailure(new Error('abort failed'));
    expect(service.hubWarning()).toContain('could not be stopped');
    service.dismissHubWarning();
    expect(service.hubWarning()).toBeNull();
  });
});
