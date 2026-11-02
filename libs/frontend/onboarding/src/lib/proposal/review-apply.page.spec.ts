import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { AppStateManager } from '@ptah-extension/core';
import { OnboardingFlagService } from '../first-run/onboarding-flag.service';
import { ProposalFlowStore } from './proposal-flow.store';
import { ReviewApplyPage } from './review-apply.page';

describe('ReviewApplyPage', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('keeps the reviewed revision pinned and exposes a newer-revision banner', () => {
    const revisions = signal([
      {
        id: 'one',
        ordinal: 1,
        config: { name: 'One' },
        isConfigComplete: false,
      },
      {
        id: 'two',
        ordinal: 2,
        config: { name: 'Two' },
        isConfigComplete: true,
      },
    ]);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ProposalFlowStore,
          useValue: {
            mode: 'new-project',
            revisions,
            current: () => revisions().at(-1),
            session: {
              phase: signal('idle'),
              error: signal(null),
              record: signal({ workspacePath: '/ws', tabId: 'tab' }),
            },
            records: {
              readSnapshot: () => ({ configUpdates: { name: 'Chosen' } }),
            },
          },
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: () => null } } },
        },
        { provide: Router, useValue: { navigate: jest.fn() } },
        {
          provide: OnboardingFlagService,
          useValue: { markCompleted: jest.fn() },
        },
        { provide: AppStateManager, useValue: { setCurrentView: jest.fn() } },
      ],
    });
    const page = TestBed.runInInjectionContext(() => new ReviewApplyPage());
    page.reviewedId.set('one');
    expect(page.reviewed()?.id).toBe('one');
    expect(page.reviewedConfig().name).toBe('Chosen');
    expect(page.newer()?.ordinal).toBe(2);
  });
  it('records the revision captured when apply starts and hides its receipt after review changes', async () => {
    const revisions = signal([
      {
        id: 'one',
        ordinal: 1,
        config: { name: 'One' },
        isConfigComplete: true,
      },
      {
        id: 'two',
        ordinal: 2,
        config: { name: 'Two' },
        isConfigComplete: true,
      },
    ]);
    const record = signal<{
      tabId: string;
      workspacePath: string;
      applyReceipt?: {
        revisionId: string;
        appliedPaths: string[];
        warnings: string[];
        appliedAt: string;
      };
    }>({ tabId: 'tab', workspacePath: '/ws' });
    const recordApply = jest.fn(
      (receipt: {
        revisionId: string;
        appliedPaths: string[];
        warnings: string[];
        appliedAt: string;
      }) => record.set({ ...record(), applyReceipt: receipt }),
    );
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ProposalFlowStore,
          useValue: {
            mode: 'new-project',
            revisions,
            current: () => revisions().at(-1),
            session: {
              phase: signal('idle'),
              error: signal(null),
              record,
              recordApply,
            },
            records: { readSnapshot: () => null },
          },
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
        {
          provide: Router,
          useValue: { navigate: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: OnboardingFlagService,
          useValue: { markCompleted: jest.fn() },
        },
        { provide: AppStateManager, useValue: { setCurrentView: jest.fn() } },
      ],
    });
    const page = TestBed.runInInjectionContext(() => new ReviewApplyPage());
    page.reviewedId.set('one');
    page.captureApplyStart();
    await page.updateReview();
    expect(page.reviewedId()).toBe('one');
    page.reviewedId.set('two');
    page.onApplied({ appliedPaths: ['/ws/file'], warnings: [] });
    expect(recordApply).toHaveBeenCalledWith(
      expect.objectContaining({ revisionId: 'one' }),
    );
    expect(page.visibleReceipt()).toBeNull();
    page.reviewedId.set('one');
    expect(page.visibleReceipt()?.revisionId).toBe('one');
  });
  it('captures apply start from the section output and clears pending state on failure', async () => {
    const revisions = signal([
      {
        id: 'one',
        ordinal: 1,
        config: { name: 'One' },
        isConfigComplete: true,
      },
      {
        id: 'two',
        ordinal: 2,
        config: { name: 'Two' },
        isConfigComplete: true,
      },
    ]);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ProposalFlowStore,
          useValue: {
            mode: 'new-project',
            revisions,
            current: () => revisions().at(-1),
            restore: jest.fn().mockResolvedValue(undefined),
            restoreState: signal('ready'),
            workspaceRoot: signal('/ws'),
            generatedDocument: signal(null),
            actionError: signal(null),
            session: {
              phase: signal('idle'),
              error: signal(null),
              record: signal({ tabId: 'tab', workspacePath: '/ws' }),
            },
            records: { readSnapshot: () => null, readStackProfile: () => null },
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: new BehaviorSubject(
              convertToParamMap({ tab: 'tab', rev: 'one' }),
            ).asObservable(),
          },
        },
        {
          provide: Router,
          useValue: { navigate: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: OnboardingFlagService,
          useValue: { markCompleted: jest.fn() },
        },
        { provide: AppStateManager, useValue: { setCurrentView: jest.fn() } },
      ],
    });
    TestBed.overrideComponent(ReviewApplyPage, {
      set: { imports: [], schemas: [NO_ERRORS_SCHEMA] },
    });
    const fixture = TestBed.createComponent(ReviewApplyPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const section = (fixture.nativeElement as HTMLElement).querySelector(
      'ptah-builder-apply-section',
    );
    expect(section).not.toBeNull();
    section?.dispatchEvent(new Event('applyStarted'));
    expect(fixture.componentInstance.pendingRevisionId()).toBe('one');
    await fixture.componentInstance.updateReview();
    expect(fixture.componentInstance.reviewedId()).toBe('one');
    section?.dispatchEvent(new Event('applyFailed'));
    expect(fixture.componentInstance.pendingRevisionId()).toBeNull();
    await fixture.componentInstance.updateReview();
    expect(fixture.componentInstance.reviewedId()).toBe('two');
    fixture.destroy();
  });
  it('keeps Done available and exposes the error when receipt persistence fails', () => {
    const record = signal({ tabId: 'tab', workspacePath: '/ws' });
    const error = signal<string | null>(null);
    const recordApply = jest.fn(() =>
      error.set('The apply receipt could not be saved. Try again.'),
    );
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ProposalFlowStore,
          useValue: {
            mode: 'new-project',
            revisions: signal([
              { id: 'one', ordinal: 1, config: { name: 'One' } },
            ]),
            current: () => null,
            session: { phase: signal('idle'), error, record, recordApply },
            records: { readSnapshot: () => null },
          },
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
        { provide: Router, useValue: { navigate: jest.fn() } },
        {
          provide: OnboardingFlagService,
          useValue: { markCompleted: jest.fn() },
        },
        { provide: AppStateManager, useValue: { setCurrentView: jest.fn() } },
      ],
    });
    const page = TestBed.runInInjectionContext(() => new ReviewApplyPage());
    page.reviewedId.set('one');
    page.onApplied({ appliedPaths: ['/ws/file'], warnings: [] });
    expect(page.appliedWithoutReceipt()).toBe(true);
    expect(error()).toContain('receipt could not be saved');
  });
  it('updates the pinned revision on same-component query changes', async () => {
    const params = new BehaviorSubject(
      convertToParamMap({ tab: 'one', rev: 'r1' }),
    );
    const revisions = signal([
      { id: 'r1', ordinal: 1, config: {} },
      { id: 'r2', ordinal: 2, config: {} },
    ]);
    const restore = jest.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ProposalFlowStore,
          useValue: {
            mode: 'new-project',
            revisions,
            current: () => revisions().at(-1),
            restore,
            restoreState: signal('idle'),
            session: {
              phase: signal('idle'),
              error: signal(null),
              record: signal(null),
            },
            records: { readSnapshot: () => null },
          },
        },
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: params.asObservable() },
        },
        { provide: Router, useValue: { navigate: jest.fn() } },
        {
          provide: OnboardingFlagService,
          useValue: { markCompleted: jest.fn() },
        },
        { provide: AppStateManager, useValue: { setCurrentView: jest.fn() } },
      ],
    });
    const page = TestBed.runInInjectionContext(() => new ReviewApplyPage());
    page.ngOnInit();
    await Promise.resolve();
    await Promise.resolve();
    expect(page.reviewedId()).toBe('r1');
    params.next(convertToParamMap({ tab: 'one', rev: 'r2' }));
    expect(page.reviewedId()).toBe('r2');
    expect(restore).toHaveBeenCalledTimes(1);
    params.next(convertToParamMap({ tab: 'two', rev: 'r1' }));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(restore).toHaveBeenCalledTimes(2);
    expect(page.reviewedId()).toBe('r1');
  });
  it('renders the newer banner and an old receipt note without showing the stale result', async () => {
    const revisions = signal([
      {
        id: 'one',
        ordinal: 1,
        config: { name: 'One' },
        isConfigComplete: true,
      },
      {
        id: 'two',
        ordinal: 2,
        config: { name: 'Two' },
        isConfigComplete: true,
      },
    ]);
    const record = signal({
      tabId: 'tab',
      workspacePath: '/ws',
      applyReceipt: {
        revisionId: 'one',
        appliedPaths: ['/ws/file'],
        warnings: [],
        appliedAt: '2026-10-31T00:00:00Z',
      },
    });
    const params = new BehaviorSubject(
      convertToParamMap({ tab: 'tab', rev: 'one' }),
    );
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ProposalFlowStore,
          useValue: {
            mode: 'new-project',
            revisions,
            current: () => revisions().at(-1),
            restore: jest.fn().mockResolvedValue(undefined),
            restoreState: signal('ready'),
            workspaceRoot: signal('/ws'),
            generatedDocument: signal(null),
            actionError: signal(null),
            session: { phase: signal('idle'), error: signal(null), record },
            records: { readSnapshot: () => null, readStackProfile: () => null },
          },
        },
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: params.asObservable() },
        },
        {
          provide: Router,
          useValue: { navigate: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: OnboardingFlagService,
          useValue: { markCompleted: jest.fn() },
        },
        { provide: AppStateManager, useValue: { setCurrentView: jest.fn() } },
      ],
    });
    TestBed.overrideComponent(ReviewApplyPage, {
      set: { imports: [], schemas: [NO_ERRORS_SCHEMA] },
    });
    const fixture = TestBed.createComponent(ReviewApplyPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(
      element.querySelector('[data-testid="newer-revision-banner"]')
        ?.textContent,
    ).toContain('Revision 2 is available');
    expect(element.querySelector('ptah-apply-result')).not.toBeNull();
    params.next(convertToParamMap({ tab: 'tab', rev: 'two' }));
    fixture.detectChanges();
    expect(element.querySelector('ptah-apply-result')).toBeNull();
    expect(element.textContent).toContain(
      'Applied revision 1; reviewing revision 2',
    );
    fixture.destroy();
  });
});
