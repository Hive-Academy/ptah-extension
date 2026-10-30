import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { AppStateManager, LoggingService, SurfaceRouterService, VSCodeService } from '@ptah-extension/core';
import { HarnessBuilderRecordsService } from './harness-builder-records.service';
import { HarnessSessionController } from './harness-session.controller';
import { HarnessWorkflowRequestService } from './harness-workflow-request.service';

describe('HarnessWorkflowRequestService', () => {
  const intake = { what: 'Clinic scheduler', audience: 'b2b' as const, stack: 'recommend' as const };
  let service: HarnessWorkflowRequestService;
  let navigateToSurface: jest.Mock;
  let start: jest.Mock;
  let retrySend: jest.Mock;
  let leave: jest.Mock;
  const record = signal<{ tabId: string } | null>(null);
  const phase = signal<'idle' | 'failed'>('idle');
  const tabs = signal<Array<{ id: string; workflow: 'harness-new-project' | 'harness-configure' }>>([]);

  beforeEach(() => {
    record.set(null);
    phase.set('idle');
    tabs.set([]);
    navigateToSurface = jest.fn().mockResolvedValue('navigated');
    start = jest.fn().mockImplementation(async () => {
      record.set({ tabId: 'new-tab' });
      return { kind: 'started', tabId: 'new-tab' };
    });
    retrySend = jest.fn().mockResolvedValue(true);
    leave = jest.fn().mockResolvedValue('left');
    const modeSession = { start, retrySend, record, phase, restore: jest.fn().mockResolvedValue('ready') };
    TestBed.configureTestingModule({ providers: [
      HarnessWorkflowRequestService,
      { provide: HarnessSessionController, useValue: { session: jest.fn().mockReturnValue(modeSession), leave } },
      { provide: TabManagerService, useValue: {
        tabs, activeTabId: signal<string | null>(null), activeWorkspacePath: 'C:/work',
        findTabByIdAcrossWorkspaces: jest.fn().mockReturnValue(null),
      } },
      { provide: HarnessBuilderRecordsService, useValue: { readDraft: jest.fn().mockReturnValue(null) } },
      { provide: SurfaceRouterService, useValue: { navigateToSurface, currentSurface: signal('harness-builder') } },
      { provide: VSCodeService, useValue: { config: () => ({ workspaceRoot: 'C:/work' }) } },
      { provide: AppStateManager, useValue: { requestComposerPrefill: jest.fn() } },
      { provide: LoggingService, useValue: { error: jest.fn() } },
    ] });
    service = TestBed.inject(HarnessWorkflowRequestService);
  });

  it('delegates first start before navigating to the unchanged harness-builder target', async () => {
    expect(await service.requestAndNavigate({ mode: 'new-project', intake })).toBe('landed');
    expect(start).toHaveBeenCalledWith({ mode: 'new-project', workspaceRoot: 'c:/work', intake });
    expect(navigateToSurface).toHaveBeenCalledWith('harness-builder', ['new-project', 'new-tab']);
  });

  it('resumes the same-mode tab without starting or sending again', async () => {
    tabs.set([{ id: 'existing', workflow: 'harness-new-project' }]);
    expect(await service.requestAndNavigate({ mode: 'new-project' })).toBe('landed');
    expect(start).not.toHaveBeenCalled();
    expect(navigateToSurface).toHaveBeenCalledWith('harness-builder', ['new-project', 'existing']);
  });

  it('offers the old builder retry UI after a failed first send', async () => {
    start.mockImplementationOnce(async () => {
      record.set({ tabId: 'new-tab' });
      phase.set('failed');
      return { kind: 'failed', error: 'The first message could not be sent. Retry send.' };
    });
    expect(await service.requestAndNavigate({ mode: 'new-project', intake })).toBe('failed');
    expect(navigateToSurface).toHaveBeenCalledWith('harness-builder', ['new-project', 'new-tab']);
    expect(service.entryErrors()['new-tab']).toContain('Retry send');
    expect(await service.retryFirstSend('new-tab')).toBe(true);
    expect(retrySend).toHaveBeenCalledTimes(1);
  });

  it('reports a pre-tab start failure on the hub without navigating to a stale tab', async () => {
    start.mockResolvedValueOnce({ kind: 'failed', error: 'Could not start New Project. Try again.' });
    expect(await service.requestAndNavigate({ mode: 'new-project', intake })).toBe('failed');
    expect(navigateToSurface).not.toHaveBeenCalled();
    expect(service.hubError()).toContain('Could not start New Project');
  });

  it('keeps a cross-mode pending intent until the previous flow is left', async () => {
    tabs.set([{ id: 'old', workflow: 'harness-configure' }]);
    expect(await service.requestAndNavigate({ mode: 'new-project', intake })).toBe('landed');
    expect(service.pendingIntent()?.sourceTabId).toBe('old');
    expect(start).not.toHaveBeenCalled();
    expect(navigateToSurface).toHaveBeenCalledWith('harness-builder', ['configure-harness', 'old']);
  });

  it('discards a newly started session when navigation fails', async () => {
    navigateToSurface.mockResolvedValueOnce('failed');
    expect(await service.requestAndNavigate({ mode: 'new-project', intake })).toBe('failed');
    expect(leave).toHaveBeenCalledWith('new-project', 'discard');
  });

  it('reports an uncertain stop when failed navigation cannot discard the session', async () => {
    navigateToSurface.mockResolvedValueOnce('failed');
    leave.mockResolvedValueOnce('uncertain');
    expect(await service.requestAndNavigate({ mode: 'new-project', intake })).toBe('failed');
    expect(service.hubError()).toContain('builder started');
  });
});
