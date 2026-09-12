import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BranchPickerDropdownComponent } from './branch-picker-dropdown.component';
import { GitBranchesService } from '../services/git-branches.service';
describe('BranchPickerDropdownComponent', () => {
  it('clicks a clean branch once without force', async () => {
    const checkout = jest.fn().mockResolvedValue({ success: true });
    const branches = {
      localBranches: signal([
        {
          name: 'feature',
          isCurrent: false,
          isRemote: false,
          ahead: 0,
          behind: 0,
        },
      ]),
      remoteBranches: signal([]),
      recentBranches: signal([]),
      checkout,
      recordVisitedBranch: jest.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [BranchPickerDropdownComponent],
      providers: [{ provide: GitBranchesService, useValue: branches }],
    }).compileComponents();
    const fixture = TestBed.createComponent(BranchPickerDropdownComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector('button') as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(checkout).toHaveBeenCalledWith({ branch: 'feature', force: false });
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
    const branches = {
      localBranches: signal(makeBranches('local', false)),
      remoteBranches: signal(makeBranches('remote', true)),
      recentBranches: signal([]),
      checkout: jest.fn(),
      recordVisitedBranch: jest.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [BranchPickerDropdownComponent],
      providers: [{ provide: GitBranchesService, useValue: branches }],
    }).compileComponents();
    const fixture = TestBed.createComponent(BranchPickerDropdownComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

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
