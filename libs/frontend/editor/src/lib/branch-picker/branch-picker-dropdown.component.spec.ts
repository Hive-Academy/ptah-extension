/**
 * BranchPickerDropdownComponent — unit specs (TASK_2026_111 Batch 6).
 *
 * Coverage:
 *   - filteredLocal computed: searchQuery filters local branches by substring
 *   - dirty-tree warning: shown when checkout() returns { dirty: true }
 *   - confirmForceCheckout: calls checkout({ branch, force: true })
 *   - cancelDirtyWarning: clears showDirtyWarning without calling force checkout
 *   - outside-click via host (document:click) emits 'closed' output
 *   - successful checkout: calls recordVisitedBranch + emits branchCheckedOut + closed
 *
 * GitBranchesService is stubbed at the TestBed boundary so no RPC bridge is needed.
 *
 * Source-under-test:
 *   libs/frontend/editor/src/lib/branch-picker/branch-picker-dropdown.component.ts
 */

import { signal, computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentRef } from '@angular/core';
import { BranchPickerDropdownComponent } from './branch-picker-dropdown.component';
import { GitBranchesService } from '../services/git-branches.service';
import type { BranchRef, GitCheckoutResult } from '@ptah-extension/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBranchRef(
  name: string,
  overrides: Partial<BranchRef> = {},
): BranchRef {
  return {
    name,
    isRemote: false,
    isCurrent: false,
    ahead: 0,
    behind: 0,
    ...overrides,
  };
}

/**
 * Build a minimal GitBranchesService stub backed by writable signals so tests
 * can push data into the computed views.
 */
function makeGitBranchesStub() {
  const _branches = signal({
    current: 'main',
    local: [] as BranchRef[],
    remote: [] as BranchRef[],
    recent: [] as string[],
  });
  const _recentBranches = signal<string[]>([]);

  const stub = {
    // Signals the component reads
    branches: _branches.asReadonly(),
    localBranches: computed(() => _branches().local),
    remoteBranches: computed(() => _branches().remote),
    recentBranches: _recentBranches.asReadonly(),
    stashCount: signal(0).asReadonly(),
    lastCommit: signal(null).asReadonly(),
    isLoading: signal(false).asReadonly(),

    // Methods the component calls
    checkout: jest
      .fn<
        Promise<GitCheckoutResult>,
        [{ branch: string; force?: boolean; createNew?: boolean }]
      >()
      .mockResolvedValue({ success: true }),
    recordVisitedBranch: jest.fn(),
    refreshBranches: jest.fn().mockResolvedValue(undefined),
    startListening: jest.fn(),
    stopListening: jest.fn(),

    // Test helpers to mutate state
    __setLocal: (branches: BranchRef[]) =>
      _branches.update((b) => ({ ...b, local: branches })),
    __setRemote: (branches: BranchRef[]) =>
      _branches.update((b) => ({ ...b, remote: branches })),
    __setRecent: (names: string[]) => _recentBranches.set(names),
  };

  return stub;
}

type GitStub = ReturnType<typeof makeGitBranchesStub>;

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

async function createFixture(gitStub?: GitStub) {
  const stub = gitStub ?? makeGitBranchesStub();

  await TestBed.configureTestingModule({
    imports: [BranchPickerDropdownComponent],
    providers: [{ provide: GitBranchesService, useValue: stub }],
  }).compileComponents();

  const fixture = TestBed.createComponent(BranchPickerDropdownComponent);
  const componentRef: ComponentRef<BranchPickerDropdownComponent> =
    fixture.componentRef;

  // Set required input
  componentRef.setInput('isOpen', true);
  fixture.detectChanges();

  return { fixture, component: fixture.componentInstance, componentRef, stub };
}

// ---------------------------------------------------------------------------
// Output capture helper
// ---------------------------------------------------------------------------
function captureOutput<T>(
  componentRef: ComponentRef<BranchPickerDropdownComponent>,
  outputName: 'closed' | 'branchCheckedOut',
): T[] {
  const emitted: T[] = [];
  componentRef.instance[outputName].subscribe((v: T) => emitted.push(v));
  return emitted;
}

// ===========================================================================
// Test suites
// ===========================================================================

describe('BranchPickerDropdownComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // ==========================================================================
  // filteredLocal computed
  // ==========================================================================

  describe('filteredLocal computed signal', () => {
    it('returns all local branches when searchQuery is empty', async () => {
      const { component, stub } = await createFixture();
      stub.__setLocal([
        makeBranchRef('main'),
        makeBranchRef('feat/search-ui'),
        makeBranchRef('fix/bug-123'),
      ]);

      component.searchQuery.set('');

      expect(component['filteredLocal']()).toHaveLength(3);
    });

    it('filters local branches by case-insensitive substring match', async () => {
      const { component, stub } = await createFixture();
      stub.__setLocal([
        makeBranchRef('main'),
        makeBranchRef('feat/search-ui'),
        makeBranchRef('fix/SEARCH-something'),
        makeBranchRef('chore/cleanup'),
      ]);

      component.searchQuery.set('search');

      const filtered = component['filteredLocal']();
      expect(filtered).toHaveLength(2);
      expect(filtered.map((b) => b.name)).toContain('feat/search-ui');
      expect(filtered.map((b) => b.name)).toContain('fix/SEARCH-something');
    });

    it('returns empty array when no local branch matches the query', async () => {
      const { component, stub } = await createFixture();
      stub.__setLocal([makeBranchRef('main'), makeBranchRef('develop')]);

      component.searchQuery.set('xyz-no-match');

      expect(component['filteredLocal']()).toHaveLength(0);
    });
  });

  // ==========================================================================
  // dirty-tree warning flow
  // ==========================================================================

  describe('dirty-tree warning flow', () => {
    it('shows dirty warning when checkout() returns { dirty: true }', async () => {
      const stub = makeGitBranchesStub();
      stub.checkout.mockResolvedValueOnce({ success: false, dirty: true });

      const { component } = await createFixture(stub);
      stub.__setLocal([makeBranchRef('feat/x')]);

      // Trigger checkout click
      await component['onCheckoutClick']('feat/x');

      expect(component['showDirtyWarning']()).toBe('feat/x');
    });

    it('does NOT show dirty warning for a successful checkout', async () => {
      const stub = makeGitBranchesStub();
      stub.checkout.mockResolvedValueOnce({ success: true });

      const { component } = await createFixture(stub);

      await component['onCheckoutClick']('main');

      expect(component['showDirtyWarning']()).toBeNull();
    });

    it('confirmForceCheckout calls checkout({ branch, force: true })', async () => {
      const stub = makeGitBranchesStub();
      // First call returns dirty; force call returns success
      stub.checkout
        .mockResolvedValueOnce({ success: false, dirty: true })
        .mockResolvedValueOnce({ success: true });

      const { component } = await createFixture(stub);

      await component['onCheckoutClick']('feat/x');
      // Now the dirty warning is showing
      await component['confirmForceCheckout']('feat/x');

      expect(stub.checkout).toHaveBeenNthCalledWith(2, {
        branch: 'feat/x',
        force: true,
      });
    });

    it('cancelDirtyWarning clears showDirtyWarning without calling checkout again', async () => {
      const stub = makeGitBranchesStub();
      stub.checkout.mockResolvedValueOnce({ success: false, dirty: true });

      const { component } = await createFixture(stub);

      await component['onCheckoutClick']('feat/x');
      expect(component['showDirtyWarning']()).toBe('feat/x');

      component['cancelDirtyWarning']();

      expect(component['showDirtyWarning']()).toBeNull();
      // checkout should only have been called once (the initial attempt)
      expect(stub.checkout).toHaveBeenCalledTimes(1);
    });

    it('force checkout clears showDirtyWarning on success', async () => {
      const stub = makeGitBranchesStub();
      stub.checkout
        .mockResolvedValueOnce({ success: false, dirty: true })
        .mockResolvedValueOnce({ success: true });

      const { component } = await createFixture(stub);

      await component['onCheckoutClick']('feat/x');
      await component['confirmForceCheckout']('feat/x');

      expect(component['showDirtyWarning']()).toBeNull();
    });
  });

  // ==========================================================================
  // Successful checkout effects
  // ==========================================================================

  describe('successful checkout', () => {
    it('calls recordVisitedBranch with the checked-out branch name', async () => {
      const stub = makeGitBranchesStub();
      stub.checkout.mockResolvedValueOnce({ success: true });

      const { component } = await createFixture(stub);

      await component['onCheckoutClick']('feat/done');

      expect(stub.recordVisitedBranch).toHaveBeenCalledWith('feat/done');
    });

    it('emits branchCheckedOut with the branch name', async () => {
      const stub = makeGitBranchesStub();
      stub.checkout.mockResolvedValueOnce({ success: true });

      const { component, componentRef } = await createFixture(stub);
      const checkedOut: string[] = [];
      componentRef.instance.branchCheckedOut.subscribe((v: string) =>
        checkedOut.push(v),
      );

      await component['onCheckoutClick']('main');

      expect(checkedOut).toEqual(['main']);
    });

    it('emits closed after successful checkout', async () => {
      const stub = makeGitBranchesStub();
      stub.checkout.mockResolvedValueOnce({ success: true });

      const { component, componentRef } = await createFixture(stub);
      let closedCount = 0;
      componentRef.instance.closed.subscribe(() => closedCount++);

      await component['onCheckoutClick']('main');

      expect(closedCount).toBe(1);
    });
  });

  // ==========================================================================
  // Outside-click closes the dropdown
  // ==========================================================================

  describe('outside-click via host (document:click)', () => {
    it('emits closed when a click occurs outside the component element', async () => {
      const stub = makeGitBranchesStub();
      const { componentRef, component } = await createFixture(stub);
      let closedCount = 0;
      componentRef.instance.closed.subscribe(() => closedCount++);

      // Simulate a click on an element OUTSIDE the component
      const outsideEl = document.createElement('div');
      document.body.appendChild(outsideEl);
      const event = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'target', { value: outsideEl });

      component.onDocumentClick(event);

      expect(closedCount).toBe(1);

      document.body.removeChild(outsideEl);
    });

    it('does NOT emit closed when the dropdown is closed (isOpen=false)', async () => {
      const stub = makeGitBranchesStub();
      const { componentRef, component } = await createFixture(stub);
      componentRef.setInput('isOpen', false);

      let closedCount = 0;
      componentRef.instance.closed.subscribe(() => closedCount++);

      const outsideEl = document.createElement('div');
      document.body.appendChild(outsideEl);
      const event = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'target', { value: outsideEl });

      component.onDocumentClick(event);

      expect(closedCount).toBe(0);

      document.body.removeChild(outsideEl);
    });
  });
});
