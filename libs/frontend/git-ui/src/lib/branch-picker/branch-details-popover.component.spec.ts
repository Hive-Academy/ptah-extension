import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BranchDetailsPopoverComponent } from './branch-details-popover.component';
import { GitBranchesService } from '../services/git-branches.service';
describe('BranchDetailsPopoverComponent', () => {
  it('renders current branch details and lazily refreshes remotes', async () => {
    const refreshRemotes = jest.fn();
    const branches = {
      currentBranch: signal('main'),
      stashCount: signal(2),
      lastCommit: signal(null),
      remotes: signal([]),
      refreshRemotes,
    };
    await TestBed.configureTestingModule({
      imports: [BranchDetailsPopoverComponent],
      providers: [{ provide: GitBranchesService, useValue: branches }],
    }).compileComponents();
    const fixture = TestBed.createComponent(BranchDetailsPopoverComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('main');
    expect(refreshRemotes).toHaveBeenCalled();
  });
});
