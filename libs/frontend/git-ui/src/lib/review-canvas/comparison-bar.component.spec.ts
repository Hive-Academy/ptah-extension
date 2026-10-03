import axe from 'axe-core';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { ElectronLayoutService, VSCodeService } from '@ptah-extension/core';
import { GitBranchesService } from '../services/git-branches.service';
import { GitReviewService } from '../services/git-review.service';
import {
  ReviewNavigationService,
  type ReviewComparisonKind,
  type ReviewScope,
} from '../services/review-navigation.service';
import { ComparisonBarComponent } from './comparison-bar.component';

const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return {
    ...actual,
    rpcCall: (...args: unknown[]) => mockRpcCall(...args),
  };
});

describe('ComparisonBarComponent', () => {
  let fixture: ComponentFixture<ComparisonBarComponent>;

  const scope = signal<ReviewScope>({ kind: 'worktree' });
  const navigation = {
    current: () => ({
      seq: 1,
      tab: 'changes',
      scope: scope(),
      target: { kind: 'none' },
    }),
    selectComparison: jest.fn((kind: ReviewComparisonKind) =>
      scope.set({ kind }),
    ),
  };
  const base = signal('main');
  const head = signal('HEAD');
  const review = {
    base: base.asReadonly(),
    head: head.asReadonly(),
    setMode: jest.fn(),
    setBase: jest.fn((value: string) => base.set(value)),
    setHead: jest.fn((value: string) => head.set(value)),
  };
  const branches = {
    localBranches: signal([
      { name: 'main', isCurrent: false, isRemote: false, ahead: 0, behind: 0 },
      { name: 'feat', isCurrent: true, isRemote: false, ahead: 0, behind: 0 },
    ]).asReadonly(),
  };

  const railCollapsed = signal(false);
  const layout = {
    gitRailCollapsed: railCollapsed.asReadonly(),
    toggleGitRail: jest.fn(() => railCollapsed.update((value) => !value)),
  };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byTestId = <T extends HTMLElement = HTMLElement>(
    id: string,
  ): T | null => host().querySelector<T>(`[data-testid="${id}"]`);
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  function create(setting: unknown = undefined): void {
    mockRpcCall.mockImplementation(async (_vscode: unknown, method: string) =>
      method === 'settings:get'
        ? setting === undefined
          ? { success: false, error: 'unset' }
          : { success: true, data: { value: setting } }
        : { success: true, data: {} },
    );
    fixture = TestBed.createComponent(ComparisonBarComponent);
    fixture.detectChanges();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    scope.set({ kind: 'worktree' });
    base.set('main');
    head.set('HEAD');
    railCollapsed.set(false);
    TestBed.configureTestingModule({
      imports: [ComparisonBarComponent],
      providers: [
        { provide: VSCodeService, useValue: {} },
        { provide: ReviewNavigationService, useValue: navigation },
        { provide: GitReviewService, useValue: review },
        { provide: GitBranchesService, useValue: branches },
        { provide: ElectronLayoutService, useValue: layout },
      ],
    });
  });

  describe('collapsed file tree (parity row 36, L-13)', () => {
    it('offers "Show changed files" only while the tree is collapsed, and it brings the tree back', () => {
      create();
      expect(byTestId('comparison-show-files')).toBeNull();

      railCollapsed.set(true);
      fixture.detectChanges();
      const show = byTestId<HTMLButtonElement>('comparison-show-files');
      expect(show?.textContent?.trim()).toBe('Show changed files');
      show?.click();
      fixture.detectChanges();
      expect(layout.toggleGitRail).toHaveBeenCalledTimes(1);
      expect(byTestId('comparison-show-files')).toBeNull();
    });
  });

  describe('comparison picker', () => {
    it('labels the trigger with the current comparison', () => {
      create();
      const trigger = byTestId<HTMLButtonElement>('comparison-trigger');
      expect(trigger?.textContent?.trim()).toBe('Working tree');
      expect(trigger?.getAttribute('aria-expanded')).toBe('false');
      scope.set({
        kind: 'historical',
        base: { name: 'abc^', sha: 'b' },
        head: { name: 'abc', sha: 'h' },
        label: 'WIP on main · 0123456',
        files: [],
      });
      fixture.detectChanges();
      expect(trigger?.textContent?.trim()).toBe('WIP on main · 0123456');
    });

    it('switches to Staged, leaves branch mode and closes', async () => {
      create();
      byTestId<HTMLButtonElement>('comparison-trigger')?.click();
      fixture.detectChanges();
      expect(
        byTestId('comparison-option-worktree')?.getAttribute('aria-pressed'),
      ).toBe('true');
      byTestId<HTMLButtonElement>('comparison-option-staged')?.click();
      await settle();
      expect(review.setMode).toHaveBeenCalledWith('working-tree');
      expect(navigation.selectComparison).toHaveBeenCalledWith('staged');
      expect(byTestId('comparison-option-staged')).toBeNull();
      expect(byTestId('comparison-trigger')?.textContent?.trim()).toBe(
        'Staged',
      );
    });

    it('enters branch review and keeps the picker open for base and head', async () => {
      create();
      byTestId<HTMLButtonElement>('comparison-trigger')?.click();
      fixture.detectChanges();
      byTestId<HTMLButtonElement>('comparison-option-branch')?.click();
      await settle();
      expect(review.setMode).toHaveBeenCalledWith('branch-review');
      expect(navigation.selectComparison).toHaveBeenCalledWith('branch');
      const baseSelect = byTestId<HTMLSelectElement>('comparison-base');
      const headSelect = byTestId<HTMLSelectElement>('comparison-head');
      expect(baseSelect?.value).toBe('main');
      expect(headSelect?.value).toBe('HEAD');
      if (!baseSelect || !headSelect) throw new Error('selects missing');
      baseSelect.value = 'feat';
      baseSelect.dispatchEvent(new Event('change'));
      headSelect.value = 'main';
      headSelect.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(review.setBase).toHaveBeenCalledWith('feat');
      expect(review.setHead).toHaveBeenCalledWith('main');
    });
  });

  describe('filter', () => {
    it('shows the canvas filter and emits edits', () => {
      create();
      const emitted: string[] = [];
      fixture.componentInstance.filterChange.subscribe((value) =>
        emitted.push(value),
      );
      fixture.componentRef.setInput('filter', 'src');
      fixture.detectChanges();
      const input = byTestId<HTMLInputElement>('comparison-filter');
      expect(input?.value).toBe('src');
      expect(input?.getAttribute('aria-label')).toBe('Filter changed files');
      if (!input) throw new Error('filter missing');
      input.value = 'src/app';
      input.dispatchEvent(new Event('input'));
      expect(emitted).toEqual(['src/app']);
    });
  });

  describe('split / unified', () => {
    it('loads the persisted layout', async () => {
      create(false);
      await settle();
      expect(mockRpcCall).toHaveBeenCalledWith(
        expect.anything(),
        'settings:get',
        {
          key: 'diff.renderSideBySide',
        },
      );
      expect(fixture.componentInstance.sideBySide()).toBe(false);
      expect(byTestId('layout-unified')?.getAttribute('aria-pressed')).toBe(
        'true',
      );
      expect(byTestId('layout-split')?.getAttribute('aria-pressed')).toBe(
        'false',
      );
    });

    it('keeps split when nothing is stored or the read fails', async () => {
      create();
      await settle();
      expect(fixture.componentInstance.sideBySide()).toBe(true);
    });

    it('toggles, emits the two-way change and persists it', async () => {
      create();
      await settle();
      const changes: boolean[] = [];
      fixture.componentInstance.sideBySide.subscribe((value) =>
        changes.push(value),
      );
      byTestId<HTMLButtonElement>('layout-unified')?.click();
      await settle();
      expect(changes).toEqual([false]);
      expect(mockRpcCall).toHaveBeenCalledWith(
        expect.anything(),
        'settings:set',
        {
          key: 'diff.renderSideBySide',
          value: false,
        },
      );
      byTestId<HTMLButtonElement>('layout-unified')?.click();
      await settle();
      expect(changes).toEqual([false]);
    });

    it('does not let a late settings read override a choice already made', async () => {
      let finish: (value: unknown) => void = () => undefined;
      mockRpcCall.mockImplementation((_v: unknown, method: string) =>
        method === 'settings:get'
          ? new Promise((resolve) => (finish = resolve))
          : Promise.resolve({ success: true, data: {} }),
      );
      fixture = TestBed.createComponent(ComparisonBarComponent);
      fixture.detectChanges();
      byTestId<HTMLButtonElement>('layout-unified')?.click();
      finish({ success: true, data: { value: true } });
      await settle();
      expect(fixture.componentInstance.sideBySide()).toBe(false);
    });

    it('keeps the new layout when persisting it fails', async () => {
      create();
      await settle();
      mockRpcCall.mockRejectedValueOnce(new Error('ipc closed'));
      const warn = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      byTestId<HTMLButtonElement>('layout-unified')?.click();
      await settle();
      expect(fixture.componentInstance.sideBySide()).toBe(false);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('reads as Unified while the canvas is auto-unified, and reports a Split press without re-persisting (V-5)', async () => {
      create();
      await settle();
      fixture.componentRef.setInput('autoUnified', true);
      fixture.detectChanges();
      expect(byTestId('layout-unified')?.getAttribute('aria-pressed')).toBe(
        'true',
      );
      expect(byTestId('layout-split')?.getAttribute('aria-pressed')).toBe(
        'false',
      );
      expect(byTestId('layout-split')?.getAttribute('title')).toContain(
        'narrow',
      );

      const picked: boolean[] = [];
      fixture.componentInstance.layoutPicked.subscribe((value) =>
        picked.push(value),
      );
      mockRpcCall.mockClear();
      byTestId<HTMLButtonElement>('layout-split')?.click();
      await settle();
      expect(picked).toEqual([true]);
      // The stored preference is already split: nothing to write.
      expect(mockRpcCall).not.toHaveBeenCalledWith(
        expect.anything(),
        'settings:set',
        expect.anything(),
      );
    });
  });

  describe('totals', () => {
    it('shows nothing until totals are known', () => {
      create();
      expect(byTestId('comparison-totals')).toBeNull();
    });

    it('shows files, additions, deletions and binaries with a spoken summary', () => {
      create();
      fixture.componentRef.setInput('totals', {
        files: 142,
        additions: 1204,
        deletions: 318,
        binaryFiles: 2,
      });
      fixture.detectChanges();
      const totals = byTestId('comparison-totals');
      expect(totals?.querySelector('.diff-add-text')?.textContent).toContain(
        '+',
      );
      expect(totals?.querySelector('.diff-del-text')?.textContent).toContain(
        '−',
      );
      expect(totals?.textContent).toContain('2 binary');
      // Full ink on the base-200 bar: the muted tier is under 4.5:1 there on
      // the light theme (Batch 59 axe color-contrast).
      expect(totals?.classList.contains('text-base-content')).toBe(true);
      expect(totals?.querySelector('.text-base-content-muted')).toBeNull();
      expect(totals?.querySelector('.sr-only')?.textContent?.trim()).toBe(
        '142 files changed, 1204 additions, 318 deletions, 2 binary',
      );
    });
  });

  it('has no axe violations', async () => {
    create();
    fixture.componentRef.setInput('totals', {
      files: 1,
      additions: 1,
      deletions: 0,
      binaryFiles: 0,
    });
    fixture.detectChanges();
    const results = await axe.run(host() as Parameters<typeof axe.run>[0], {
      rules: {
        'color-contrast': { enabled: false },
        'target-size': { enabled: false },
      },
    });
    expect(results.violations.map((v) => v.id)).toEqual([]);
    const ran = [...results.passes, ...results.incomplete].map((r) => r.id);
    expect(ran).toEqual(expect.arrayContaining(['button-name', 'label']));
  });
});
