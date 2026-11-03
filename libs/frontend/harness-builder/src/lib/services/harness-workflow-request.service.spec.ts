import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  AppStateManager,
  LoggingService,
  SurfaceRouterService,
  VSCodeService,
} from '@ptah-extension/core';
import { HarnessBuilderRecordsService } from './harness-builder-records.service';
import { HarnessSessionController } from './harness-session.controller';
import { HarnessWorkflowRequestService } from './harness-workflow-request.service';

describe('HarnessWorkflowRequestService', () => {
  const intake = {
    what: 'Clinic scheduler',
    audience: 'b2b' as const,
    stack: 'recommend' as const,
  };
  let service: HarnessWorkflowRequestService;
  let navigateToSurface: jest.Mock;
  let start: jest.Mock;
  let retrySend: jest.Mock;
  let leave: jest.Mock;
  const record = signal<{ tabId: string } | null>(null);
  const phase = signal<'idle' | 'failed'>('idle');
  const tabs = signal<
    Array<{ id: string; workflow: 'harness-new-project' | 'harness-configure' }>
  >([]);
  const angularRouter = { url: '/onboarding' };
  let findTabByIdAcrossWorkspaces: jest.Mock;

  beforeEach(() => {
    record.set(null);
    phase.set('idle');
    tabs.set([]);
    angularRouter.url = '/onboarding';
    findTabByIdAcrossWorkspaces = jest.fn().mockReturnValue(null);
    navigateToSurface = jest.fn().mockResolvedValue('navigated');
    start = jest.fn().mockImplementation(async () => {
      record.set({ tabId: 'new-tab' });
      return { kind: 'started', tabId: 'new-tab' };
    });
    retrySend = jest.fn().mockResolvedValue(true);
    leave = jest.fn().mockResolvedValue('left');
    const modeSession = {
      start,
      retrySend,
      record,
      phase,
      restore: jest.fn().mockResolvedValue('ready'),
    };
    TestBed.configureTestingModule({
      providers: [
        HarnessWorkflowRequestService,
        {
          provide: HarnessSessionController,
          useValue: { session: jest.fn().mockReturnValue(modeSession), leave },
        },
        {
          provide: TabManagerService,
          useValue: {
            tabs,
            activeTabId: signal<string | null>(null),
            activeWorkspacePath: 'C:/work',
            findTabByIdAcrossWorkspaces,
          },
        },
        {
          provide: HarnessBuilderRecordsService,
          useValue: { readDraft: jest.fn().mockReturnValue(null) },
        },
        {
          provide: SurfaceRouterService,
          useValue: { navigateToSurface, currentSurface: signal('onboarding') },
        },
        { provide: Router, useValue: angularRouter },
        {
          provide: VSCodeService,
          useValue: { config: () => ({ workspaceRoot: 'C:/work' }) },
        },
        {
          provide: AppStateManager,
          useValue: { requestComposerPrefill: jest.fn() },
        },
        { provide: LoggingService, useValue: { error: jest.fn() } },
      ],
    });
    service = TestBed.inject(HarnessWorkflowRequestService);
  });

  it('delegates first start before navigating to the onboarding workspace', async () => {
    expect(
      await service.requestAndNavigate({ mode: 'new-project', intake }),
    ).toBe('landed');
    expect(start).toHaveBeenCalledWith({
      mode: 'new-project',
      workspaceRoot: 'c:/work',
      intake,
    });
    expect(navigateToSurface).toHaveBeenCalledWith(
      'onboarding',
      ['new-project', 'workspace'],
      { queryParams: { tab: 'new-tab' } },
    );
  });

  it('resumes the same-mode tab without starting or sending again', async () => {
    tabs.set([{ id: 'existing', workflow: 'harness-new-project' }]);
    expect(await service.requestAndNavigate({ mode: 'new-project' })).toBe(
      'landed',
    );
    expect(start).not.toHaveBeenCalled();
    expect(navigateToSurface).toHaveBeenCalledWith(
      'onboarding',
      ['new-project', 'workspace'],
      { queryParams: { tab: 'existing' } },
    );
  });

  it('offers the old builder retry UI after a failed first send', async () => {
    start.mockImplementationOnce(async () => {
      record.set({ tabId: 'new-tab' });
      phase.set('failed');
      return {
        kind: 'failed',
        error: 'The first message could not be sent. Retry send.',
      };
    });
    expect(
      await service.requestAndNavigate({ mode: 'new-project', intake }),
    ).toBe('failed');
    expect(navigateToSurface).toHaveBeenCalledWith(
      'onboarding',
      ['new-project', 'workspace'],
      { queryParams: { tab: 'new-tab' } },
    );
    expect(service.entryErrors()['new-tab']).toContain('Retry send');
    expect(await service.retryFirstSend('new-tab')).toBe(true);
    expect(retrySend).toHaveBeenCalledTimes(1);
  });

  it('reports a pre-tab start failure on the hub without navigating to a stale tab', async () => {
    start.mockResolvedValueOnce({
      kind: 'failed',
      error: 'Could not start New Project. Try again.',
    });
    expect(
      await service.requestAndNavigate({ mode: 'new-project', intake }),
    ).toBe('failed');
    expect(navigateToSurface).not.toHaveBeenCalled();
    expect(service.hubError()).toContain('Could not start New Project');
  });

  it('keeps a cross-mode pending intent until the previous flow is left', async () => {
    tabs.set([{ id: 'old', workflow: 'harness-configure' }]);
    expect(
      await service.requestAndNavigate({ mode: 'new-project', intake }),
    ).toBe('landed');
    expect(service.pendingIntent()?.sourceTabId).toBe('old');
    expect(start).not.toHaveBeenCalled();
    expect(navigateToSurface).toHaveBeenCalledWith(
      'onboarding',
      ['team-builder', 'workspace'],
      { queryParams: { tab: 'old' } },
    );
  });

  it('replaces a stale pending intent from onboarding Home with a new open-workflow request', async () => {
    tabs.set([{ id: 'old', workflow: 'harness-configure' }]);
    await service.requestAndNavigate({ mode: 'new-project', intake });
    expect(service.pendingIntent()?.sourceTabId).toBe('old');

    findTabByIdAcrossWorkspaces.mockReturnValue({
      workspacePath: 'C:/work',
      tab: { id: 'old', workflow: 'harness-configure' },
    });
    tabs.set([
      { id: 'old', workflow: 'harness-configure' },
      { id: 'new-request', workflow: 'harness-new-project' },
    ]);
    angularRouter.url = '/onboarding';

    expect(
      await service.requestAndNavigate({ mode: 'new-project', intake }),
    ).toBe('resumed');
    expect(service.pendingIntent()).toBeNull();
    expect(navigateToSurface).toHaveBeenLastCalledWith(
      'onboarding',
      ['new-project', 'workspace'],
      { queryParams: { tab: 'new-request' } },
    );
  });

  it('cancels a new request while a live pending source tab is on its onboarding flow', async () => {
    tabs.set([{ id: 'old', workflow: 'harness-configure' }]);
    await service.requestAndNavigate({ mode: 'new-project', intake });
    expect(service.pendingIntent()?.sourceTabId).toBe('old');

    findTabByIdAcrossWorkspaces.mockReturnValue({
      workspacePath: 'C:/work',
      tab: { id: 'old', workflow: 'harness-configure' },
    });
    angularRouter.url = '/onboarding/team-builder/workspace?tab=old';

    expect(
      await service.requestAndNavigate({ mode: 'new-project', intake }),
    ).toBe('cancelled');
    expect(service.pendingIntent()?.sourceTabId).toBe('old');
    expect(navigateToSurface).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it('discards a newly started session when navigation fails', async () => {
    navigateToSurface.mockResolvedValueOnce('failed');
    expect(
      await service.requestAndNavigate({ mode: 'new-project', intake }),
    ).toBe('failed');
    expect(leave).toHaveBeenCalledWith('new-project', 'discard');
  });

  it('reports an uncertain stop when failed navigation cannot discard the session', async () => {
    navigateToSurface.mockResolvedValueOnce('failed');
    leave.mockResolvedValueOnce('uncertain');
    expect(
      await service.requestAndNavigate({ mode: 'new-project', intake }),
    ).toBe('failed');
    expect(service.hubError()).toContain('builder started');
  });
});
