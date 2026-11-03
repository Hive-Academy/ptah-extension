import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { TabManagerService } from '@ptah-extension/chat-state';
import { BehaviorSubject } from 'rxjs';
import { ProposalFlowStore } from './proposal-flow.store';
import { ProposalWorkspacePage } from './proposal-workspace.page';

describe('ProposalWorkspacePage', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('stops the session before saving a draft and reports an uncertain stop', async () => {
    const leaveCurrent = jest
      .fn()
      .mockResolvedValueOnce('left')
      .mockResolvedValueOnce('uncertain');
    const replaceDraft = jest.fn();
    const actionError = signal<string | null>(null);
    const navigate = jest.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ProposalFlowStore,
          useValue: {
            mode: 'new-project',
            session: {
              record: signal({ tabId: 'tab', workspacePath: '/ws' }),
              phase: signal('busy'),
            },
            leaveCurrent,
            records: { replaceDraft },
            actionError,
          },
        },
        { provide: ActivatedRoute, useValue: {} },
        { provide: Router, useValue: { navigate } },
        { provide: TabManagerService, useValue: { tabs: signal([]) } },
      ],
    });
    const page = TestBed.runInInjectionContext(
      () => new ProposalWorkspacePage(),
    );
    await page.saveDraft();
    expect(leaveCurrent).toHaveBeenCalledWith('save');
    expect(replaceDraft).not.toHaveBeenCalled();
    expect(actionError()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/onboarding']);
    await page.saveDraft();
    expect(page.stopUncertain()).toBe(true);
    expect(page.leaveOpen()).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
  it('restores a new tab when query parameters change on the same component', async () => {
    const params = new BehaviorSubject(convertToParamMap({ tab: 'first' }));
    const restore = jest.fn().mockResolvedValue(undefined);
    const release = jest.fn();
    const attachView = jest.fn(() => release);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ProposalFlowStore,
          useValue: {
            mode: 'new-project',
            session: {
              record: signal({ tabId: 'first', workspacePath: '/ws' }),
              phase: signal('done'),
              attachView,
            },
            restore,
            restoreState: signal('idle'),
            actionError: signal(null),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: params.asObservable() },
        },
        { provide: Router, useValue: { navigate: jest.fn() } },
        { provide: TabManagerService, useValue: { tabs: signal([]) } },
      ],
    });
    const page = TestBed.runInInjectionContext(
      () => new ProposalWorkspacePage(),
    );
    page.ngOnInit();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(restore).toHaveBeenCalledWith('first');
    params.next(convertToParamMap({ tab: 'second' }));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(restore).toHaveBeenCalledWith('second');
    expect(release).toHaveBeenCalledTimes(1);
  });
});
