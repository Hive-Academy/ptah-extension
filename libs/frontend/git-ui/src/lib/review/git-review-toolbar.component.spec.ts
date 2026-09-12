import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GitReviewToolbarComponent } from './git-review-toolbar.component';
import { GitReviewService } from '../services/git-review.service';
import { GitBranchesService } from '../services/git-branches.service';
describe('GitReviewToolbarComponent', () => {
  it('switches to branch review through the rendered button', async () => {
    const setMode = jest.fn();
    const review = {
      mode: signal('working-tree'),
      base: signal('main'),
      head: signal('feature'),
      result: signal(null),
      setMode,
      setBase: jest.fn(),
      setHead: jest.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [GitReviewToolbarComponent],
      providers: [
        { provide: GitReviewService, useValue: review },
        {
          provide: GitBranchesService,
          useValue: { localBranches: signal([]) },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(GitReviewToolbarComponent);
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelectorAll('button')[1] as HTMLButtonElement
    ).click();
    expect(setMode).toHaveBeenCalledWith('branch-review');
  });
});
