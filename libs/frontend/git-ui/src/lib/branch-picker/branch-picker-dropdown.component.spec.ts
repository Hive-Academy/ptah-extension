import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { BranchRef, GitCheckoutResult } from '@ptah-extension/shared';
import { BranchPickerDropdownComponent } from './branch-picker-dropdown.component';
import { GitBranchesService } from '../services/git-branches.service';

const localBranch = (name: string): BranchRef => ({
  name,
  isCurrent: false,
  isRemote: false,
  ahead: 0,
  behind: 0,
});

async function setup(options: {
  local?: BranchRef[];
  remote?: BranchRef[];
  checkout?: jest.Mock<Promise<GitCheckoutResult>>;
}) {
  const branches = {
    localBranches: signal(options.local ?? []),
    remoteBranches: signal(options.remote ?? []),
    recentBranches: signal<string[]>([]),
    checkout: options.checkout ?? jest.fn().mockResolvedValue({ success: true }),
    recordVisitedBranch: jest.fn(),
  };
  await TestBed.configureTestingModule({
    imports: [BranchPickerDropdownComponent],
    providers: [{ provide: GitBranchesService, useValue: branches }],
  }).compileComponents();
  const fixture = TestBed.createComponent(BranchPickerDropdownComponent);
  fixture.componentRef.setInput('isOpen', true);
  const checkedOut: string[] = [];
  fixture.componentInstance.branchCheckedOut.subscribe((name) =>
    checkedOut.push(name),
  );
  fixture.detectChanges();
  return { fixture, branches, checkedOut };
}

async function click(
  fixture: ComponentFixture<BranchPickerDropdownComponent>,
  selector: string,
): Promise<void> {
  const button = fixture.nativeElement.querySelector(
    selector,
  ) as HTMLButtonElement | null;
  if (!button) throw new Error(`No element for ${selector}`);
  button.click();
  await fixture.whenStable();
  fixture.detectChanges();
}

const query = (
  fixture: ComponentFixture<BranchPickerDropdownComponent>,
  selector: string,
): HTMLElement | null => fixture.nativeElement.querySelector(selector);

describe('BranchPickerDropdownComponent', () => {
  it('switches to a clean branch once, without stash or force', async () => {
    const { fixture, branches, checkedOut } = await setup({
      local: [localBranch('feature')],
    });

    await click(fixture, '.max-h-72 > button');

    expect(branches.checkout).toHaveBeenCalledTimes(1);
    expect(branches.checkout).toHaveBeenCalledWith({ branch: 'feature' });
    expect(checkedOut).toEqual(['feature']);
  });

  it('offers Stash & switch as the primary action on a dirty refusal and lists the paths', async () => {
    const checkout = jest
      .fn()
      .mockResolvedValueOnce({
        success: false,
        dirty: true,
        conflictingPaths: ['src/a.ts', 'README.md'],
      })
      .mockResolvedValueOnce({ success: true, stashRef: 'abc123' });
    const { fixture, branches, checkedOut } = await setup({
      local: [localBranch('feature')],
      checkout,
    });

    await click(fixture, '.max-h-72 > button');

    const stash = query(fixture, '[data-testid="stash-switch"]');
    expect(stash?.textContent?.trim()).toBe('Stash & switch');
    expect(stash?.classList).toContain('btn-primary');
    expect(document.activeElement).toBe(stash);
    const paths = [
      ...(query(fixture, '[data-testid="conflicting-paths"]')?.querySelectorAll(
        'li',
      ) ?? []),
    ].map((item) => item.textContent?.trim());
    expect(paths).toEqual(['src/a.ts', 'README.md']);

    await click(fixture, '[data-testid="stash-switch"]');

    expect(checkout).toHaveBeenLastCalledWith({
      branch: 'feature',
      stash: true,
    });
    expect(branches.recordVisitedBranch).toHaveBeenCalledWith('feature');
    expect(checkedOut).toEqual(['feature']);
  });

  it('keeps Discard & switch behind a second confirmation', async () => {
    const checkout = jest
      .fn()
      .mockResolvedValueOnce({ success: false, dirty: true })
      .mockResolvedValueOnce({ success: true });
    const { fixture } = await setup({
      local: [localBranch('feature')],
      checkout,
    });
    await click(fixture, '.max-h-72 > button');
    expect(query(fixture, '[data-testid="conflicting-paths"]')).toBeNull();

    await click(fixture, '[data-testid="discard-switch"]');

    expect(checkout).toHaveBeenCalledTimes(1);
    const confirm = query(fixture, '[data-testid="confirm-discard"]');
    expect(confirm?.textContent?.trim()).toBe('Discard changes');
    expect(document.activeElement).toBe(confirm);
    expect(query(fixture, '[data-testid="stash-switch"]')).toBeNull();

    await click(fixture, '[data-testid="confirm-discard"]');

    expect(checkout).toHaveBeenLastCalledWith({
      branch: 'feature',
      force: true,
    });
  });

  it('names the stash after a successful Stash & switch and closes only on Dismiss', async () => {
    const checkout = jest
      .fn()
      .mockResolvedValueOnce({ success: false, dirty: true })
      .mockResolvedValueOnce({ success: true, stashRef: 'abc123' });
    const { fixture, checkedOut } = await setup({
      local: [localBranch('feature')],
      checkout,
    });
    let closedCount = 0;
    fixture.componentInstance.closed.subscribe(() => closedCount++);
    await click(fixture, '.max-h-72 > button');
    await click(fixture, '[data-testid="stash-switch"]');

    const notice = query(fixture, '[data-testid="stash-notice"]');
    expect(notice?.getAttribute('role')).toBe('status');
    expect((notice?.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe(
      'Changes stashed as stash@{0} — find them in Stashes. Dismiss',
    );
    expect(notice?.querySelector('.font-mono')?.getAttribute('title')).toBe(
      'abc123',
    );
    const dismiss = query(fixture, '[data-testid="dismiss-stash-notice"]');
    expect(document.activeElement).toBe(dismiss);
    expect(query(fixture, '[data-testid="blocked-switch"]')).toBeNull();
    expect(checkedOut).toEqual(['feature']);
    expect(closedCount).toBe(0);

    await click(fixture, '[data-testid="dismiss-stash-notice"]');
    expect(closedCount).toBe(1);

    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    expect(query(fixture, '[data-testid="stash-notice"]')).toBeNull();
  });

  it('closes straight away when Stash & switch needed no stash entry', async () => {
    const checkout = jest
      .fn()
      .mockResolvedValueOnce({ success: false, dirty: true })
      .mockResolvedValueOnce({ success: true });
    const { fixture } = await setup({
      local: [localBranch('feature')],
      checkout,
    });
    let closedCount = 0;
    fixture.componentInstance.closed.subscribe(() => closedCount++);
    await click(fixture, '.max-h-72 > button');
    await click(fixture, '[data-testid="stash-switch"]');

    expect(query(fixture, '[data-testid="stash-notice"]')).toBeNull();
    expect(closedCount).toBe(1);
  });

  it('re-prompts with the paths and reason when a confirmed discard is refused, offering only stash', async () => {
    const reason =
      'Untracked files would be overwritten; move or delete them first.';
    const checkout = jest
      .fn()
      .mockResolvedValueOnce({
        success: false,
        dirty: true,
        conflictingPaths: ['new.txt'],
      })
      .mockResolvedValueOnce({
        success: false,
        dirty: true,
        conflictingPaths: ['new.txt'],
        error: reason,
      })
      .mockResolvedValueOnce({ success: true });
    const { fixture, checkedOut } = await setup({
      local: [localBranch('feature')],
      checkout,
    });
    await click(fixture, '.max-h-72 > button');
    await click(fixture, '[data-testid="discard-switch"]');
    await click(fixture, '[data-testid="confirm-discard"]');

    expect(query(fixture, '[data-testid="blocked-switch"]')).not.toBeNull();
    expect(
      query(fixture, '[data-testid="discard-refusal"]')?.textContent?.trim(),
    ).toBe(reason);
    const paths = [
      ...(query(fixture, '[data-testid="conflicting-paths"]')?.querySelectorAll(
        'li',
      ) ?? []),
    ].map((item) => item.textContent?.trim());
    expect(paths).toEqual(['new.txt']);
    expect(query(fixture, '[data-testid="discard-switch"]')).toBeNull();
    expect(query(fixture, '[data-testid="confirm-discard"]')).toBeNull();
    const stash = query(fixture, '[data-testid="stash-switch"]');
    expect(document.activeElement).toBe(stash);
    expect(checkedOut).toEqual([]);

    await click(fixture, '[data-testid="stash-switch"]');
    expect(checkout).toHaveBeenLastCalledWith({
      branch: 'feature',
      stash: true,
    });
    expect(checkedOut).toEqual(['feature']);
  });

  it('Cancel dismisses the dirty prompt without switching', async () => {
    const checkout = jest
      .fn()
      .mockResolvedValue({ success: false, dirty: true });
    const { fixture } = await setup({
      local: [localBranch('feature')],
      checkout,
    });
    await click(fixture, '.max-h-72 > button');

    const cancel = [
      ...fixture.nativeElement.querySelectorAll(
        '[data-testid="blocked-switch"] button',
      ),
    ].find((button) => button.textContent?.trim() === 'Cancel') as
      | HTMLButtonElement
      | undefined;
    cancel?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(query(fixture, '[data-testid="blocked-switch"]')).toBeNull();
    expect(checkout).toHaveBeenCalledTimes(1);
  });

  it('shows the error when a stash & switch fails', async () => {
    const checkout = jest
      .fn()
      .mockResolvedValueOnce({ success: false, dirty: true })
      .mockResolvedValueOnce({
        success: false,
        error: 'pathspec did not match',
      });
    const { fixture, checkedOut } = await setup({
      local: [localBranch('feature')],
      checkout,
    });
    await click(fixture, '.max-h-72 > button');
    await click(fixture, '[data-testid="stash-switch"]');

    expect(query(fixture, '[data-testid="blocked-switch"]')).toBeNull();
    expect(query(fixture, '[role="alert"]')?.textContent?.trim()).toBe(
      'pathspec did not match',
    );
    expect(checkedOut).toEqual([]);
  });

  it('passes track:true for a remote row and records the local branch name', async () => {
    const { fixture, branches, checkedOut } = await setup({
      remote: [
        { ...localBranch('origin/feature/x'), isRemote: true, remote: 'origin' },
      ],
    });

    await click(fixture, '.max-h-72 > button');

    expect(branches.checkout).toHaveBeenCalledWith({
      branch: 'origin/feature/x',
      track: true,
    });
    expect(branches.recordVisitedBranch).toHaveBeenCalledWith('feature/x');
    expect(checkedOut).toEqual(['feature/x']);
  });

  it('shows the reason when creating a branch fails', async () => {
    const checkout = jest.fn().mockResolvedValue({
      success: false,
      error: "a branch named 'topic' already exists",
    });
    const { fixture } = await setup({ checkout });
    const input = query(
      fixture,
      '[aria-label="New branch name"]',
    ) as HTMLInputElement;
    input.value = 'topic';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();

    await click(fixture, '.border-t > button');

    expect(checkout).toHaveBeenCalledWith({ branch: 'topic', createNew: true });
    expect(query(fixture, '[role="alert"]')?.textContent?.trim()).toBe(
      "Could not create branch topic: a branch named 'topic' already exists",
    );
  });

  it('renders the ten most recent branches per group until search is used', async () => {
    const makeBranches = (prefix: string, isRemote: boolean) =>
      Array.from({ length: 12 }, (_, index) => ({
        name: `${prefix}-${index}`,
        isCurrent: false,
        isRemote,
        ahead: 0,
        behind: 0,
        lastCommitTime: index,
      }));
    const { fixture } = await setup({
      local: makeBranches('local', false),
      remote: makeBranches('remote', true),
    });

    const branchButtons = () =>
      [
        ...fixture.nativeElement.querySelectorAll('.max-h-72 > button'),
      ] as HTMLButtonElement[];
    expect(branchButtons().map((button) => button.textContent?.trim())).toEqual(
      [
        ...Array.from({ length: 10 }, (_, index) => `local-${11 - index}`),
        ...Array.from({ length: 10 }, (_, index) => `remote-${11 - index}`),
      ],
    );

    const search = fixture.nativeElement.querySelector(
      '[aria-label="Search branches"]',
    ) as HTMLInputElement;
    search.value = 'local';
    search.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(branchButtons()).toHaveLength(12);
    expect(branchButtons().at(-1)?.textContent?.trim()).toBe('local-11');
  });
});
