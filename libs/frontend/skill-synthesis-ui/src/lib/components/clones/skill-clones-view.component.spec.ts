import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import type {
  CloneSummary,
  SkillCloneHistoryEntry,
} from '@ptah-extension/shared';

import { SkillClonesViewComponent } from './skill-clones-view.component';
import { SkillSynthesisRpcService } from '../../services/skill-synthesis-rpc.service';
import {
  SkillClonesStateService,
  SkillCloneDetail,
} from '../../services/skill-clones-state.service';

function vscodeServiceStub(isElectron: boolean): Partial<VSCodeService> {
  return {
    config: signal({ isElectron }),
  } as unknown as Partial<VSCodeService>;
}

function clone(overrides: Partial<CloneSummary> = {}): CloneSummary {
  return {
    slug: 'deep-research',
    kind: 'skill',
    cloneStatus: 'clone',
    diverged: false,
    invocationCount: 4,
    successRate: 0.75,
    lastEnhancedAt: null,
    historyCount: 0,
    pendingSourceHash: null,
    ...overrides,
  };
}

interface StateStub {
  readonly clones: ReturnType<typeof signal<CloneSummary[]>>;
  readonly loading: ReturnType<typeof signal<boolean>>;
  readonly error: ReturnType<typeof signal<string | null>>;
  readonly detailLoading: ReturnType<typeof signal<boolean>>;
  readonly detail: ReturnType<typeof signal<SkillCloneDetail | null>>;
  readonly refreshClones: jest.Mock<Promise<void>, []>;
  readonly loadDetail: jest.Mock<Promise<void>, [string, CloneSummary['kind']]>;
  readonly clearDetail: jest.Mock<void, []>;
}

function makeStateStub(initial: CloneSummary[] = []): StateStub {
  return {
    clones: signal<CloneSummary[]>(initial),
    loading: signal<boolean>(false),
    error: signal<string | null>(null),
    detailLoading: signal<boolean>(false),
    detail: signal<SkillCloneDetail | null>(null),
    refreshClones: jest.fn(async () => undefined),
    loadDetail: jest.fn(async () => undefined),
    clearDetail: jest.fn(() => undefined),
  };
}

function makeRpcStub(): jest.Mocked<
  Pick<
    SkillSynthesisRpcService,
    | 'enhanceNow'
    | 'revertEnhancement'
    | 'rebaseClone'
    | 'keepClone'
    | 'getClone'
    | 'listClones'
  >
> {
  return {
    enhanceNow: jest.fn(async () => ({
      changed: true,
      slug: 'deep-research',
      kind: 'skill',
      judgeScore: 8,
      judgeReason: 'judge-verdict',
      historyTs: '20260101T000000',
      skipReason: null,
    })),
    revertEnhancement: jest.fn(async () => ({
      reverted: true,
      slug: 'deep-research',
      revertedFrom: '20260101T000000',
      newHistoryTs: '20260102T000000',
    })),
    rebaseClone: jest.fn(async () => ({
      kind: 'skill' as const,
      slug: 'deep-research',
      sourceHash: 'sha256:abc',
      snapshotPath: null,
      failed: false,
      reason: null,
    })),
    keepClone: jest.fn(async () => ({
      kind: 'skill' as const,
      slug: 'deep-research',
      sourceHash: 'sha256:def',
    })),
    getClone: jest.fn(async () => ({
      clone: clone(),
      body: '# body',
      history: [] as SkillCloneHistoryEntry[],
    })),
    listClones: jest.fn(async () => []),
  } as unknown as jest.Mocked<
    Pick<
      SkillSynthesisRpcService,
      | 'enhanceNow'
      | 'revertEnhancement'
      | 'rebaseClone'
      | 'keepClone'
      | 'getClone'
      | 'listClones'
    >
  >;
}

function setup(opts: {
  isElectron?: boolean;
  state?: StateStub;
  rpc?: ReturnType<typeof makeRpcStub>;
}) {
  const state = opts.state ?? makeStateStub();
  const rpc = opts.rpc ?? makeRpcStub();
  TestBed.configureTestingModule({
    imports: [SkillClonesViewComponent],
    providers: [
      { provide: SkillClonesStateService, useValue: state },
      { provide: SkillSynthesisRpcService, useValue: rpc },
      {
        provide: VSCodeService,
        useValue: vscodeServiceStub(opts.isElectron ?? true),
      },
    ],
  });
  const fixture = TestBed.createComponent(SkillClonesViewComponent);
  fixture.detectChanges();
  return { fixture, state, rpc };
}

describe('SkillClonesViewComponent', () => {
  it('shows the desktop-only notice and does not refresh in VS Code', () => {
    const { fixture, state } = setup({ isElectron: false });
    const el = fixture.nativeElement as HTMLElement;
    expect(
      el.querySelector('[data-testid="clones-desktop-notice"]'),
    ).toBeTruthy();
    expect(el.querySelector('[data-testid="clones-view"]')).toBeNull();
    expect(state.refreshClones).not.toHaveBeenCalled();
  });

  it('refreshes clones on init in Electron and renders rows', () => {
    const state = makeStateStub([clone(), clone({ slug: 'caveman' })]);
    const { fixture } = setup({ isElectron: true, state });
    expect(state.refreshClones).toHaveBeenCalledTimes(1);
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid="clones-row"]',
    );
    expect(rows.length).toBe(2);
  });

  it('renders the diverged badge for diverged rows', () => {
    const state = makeStateStub([
      clone({ cloneStatus: 'diverged', diverged: true }),
    ]);
    const { fixture } = setup({ isElectron: true, state });
    const badge = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="clones-status-badge"]',
    ) as HTMLElement;
    expect(badge.textContent?.trim()).toBe('diverged');
    expect(badge.className).toContain('badge-warning');
  });

  it('shows Rebase/Keep only for diverged rows, not for normal rows', () => {
    const normal = setup({
      isElectron: true,
      state: makeStateStub([clone()]),
    });
    expect(
      (normal.fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-rebase-btn"]',
      ),
    ).toBeNull();

    TestBed.resetTestingModule();

    const diverged = setup({
      isElectron: true,
      state: makeStateStub([clone({ diverged: true })]),
    });
    const el = diverged.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="clones-rebase-btn"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="clones-keep-btn"]')).toBeTruthy();
  });

  it('formats success rate as a percentage', () => {
    const state = makeStateStub([clone({ successRate: 0.5 })]);
    const { fixture } = setup({ isElectron: true, state });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('50%');
  });

  it('calls enhanceNow with the row kind and refreshes', async () => {
    const state = makeStateStub([clone()]);
    const rpc = makeRpcStub();
    const { fixture } = setup({ isElectron: true, state, rpc });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-enhance-btn"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(rpc.enhanceNow).toHaveBeenCalledWith('skill', 'deep-research');
    expect(state.refreshClones).toHaveBeenCalledTimes(2);
  });

  it('calls enhanceNow with the agent kind for an agent clone', async () => {
    const state = makeStateStub([clone({ kind: 'agent', slug: 'planner' })]);
    const rpc = makeRpcStub();
    const { fixture } = setup({ isElectron: true, state, rpc });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-enhance-btn"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(rpc.enhanceNow).toHaveBeenCalledWith('agent', 'planner');
  });

  it('calls enhanceNow with the command kind for a command clone', async () => {
    const state = makeStateStub([clone({ kind: 'command', slug: 'ship' })]);
    const rpc = makeRpcStub();
    const { fixture } = setup({ isElectron: true, state, rpc });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-enhance-btn"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(rpc.enhanceNow).toHaveBeenCalledWith('command', 'ship');
  });

  it('opens the revert modal and loads detail', () => {
    const state = makeStateStub([clone()]);
    const { fixture } = setup({ isElectron: true, state });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-revert-btn"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(state.loadDetail).toHaveBeenCalledWith('deep-research', 'skill');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-revert-modal"]',
      ),
    ).toBeTruthy();
  });

  it('reverts to a chosen history snapshot', async () => {
    const state = makeStateStub([clone()]);
    state.detail.set({
      clone: clone(),
      body: '# body',
      history: [{ ts: '20260101T000000', hasBody: true }],
    });
    const rpc = makeRpcStub();
    const { fixture } = setup({ isElectron: true, state, rpc });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-revert-btn"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-history-revert-btn"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(rpc.revertEnhancement).toHaveBeenCalledWith(
      'skill',
      'deep-research',
      '20260101T000000',
    );
  });

  it('reverts an agent clone forwarding the agent kind', async () => {
    const state = makeStateStub([clone({ kind: 'agent', slug: 'planner' })]);
    state.detail.set({
      clone: clone({ kind: 'agent', slug: 'planner' }),
      body: '# body',
      history: [{ ts: '20260101T000000', hasBody: true }],
    });
    const rpc = makeRpcStub();
    const { fixture } = setup({ isElectron: true, state, rpc });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-revert-btn"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-history-revert-btn"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(rpc.revertEnhancement).toHaveBeenCalledWith(
      'agent',
      'planner',
      '20260101T000000',
    );
  });

  it('calls rebaseClone for a diverged row', async () => {
    const state = makeStateStub([clone({ diverged: true })]);
    const rpc = makeRpcStub();
    const { fixture } = setup({ isElectron: true, state, rpc });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-rebase-btn"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(rpc.rebaseClone).toHaveBeenCalledWith('skill', 'deep-research');
    expect(state.refreshClones).toHaveBeenCalledTimes(2);
  });

  it('calls keepClone for a diverged row', async () => {
    const state = makeStateStub([clone({ diverged: true })]);
    const rpc = makeRpcStub();
    const { fixture } = setup({ isElectron: true, state, rpc });
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="clones-keep-btn"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(rpc.keepClone).toHaveBeenCalledWith('skill', 'deep-research');
    expect(state.refreshClones).toHaveBeenCalledTimes(2);
  });
});
