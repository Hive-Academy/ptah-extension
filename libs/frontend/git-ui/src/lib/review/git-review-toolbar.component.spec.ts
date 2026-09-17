import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GitReviewToolbarComponent } from './git-review-toolbar.component';
import { GitReviewService } from '../services/git-review.service';
import { GitBranchesService } from '../services/git-branches.service';

describe('GitReviewToolbarComponent', () => {
  async function create(mode = 'working-tree') {
    const setMode = jest.fn();
    const review = {
      mode: signal(mode),
      base: signal('main'),
      head: signal('feature/long-branch-name'),
      result: signal({
        files: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }],
        totals: { additions: 12, deletions: 4, binaryFiles: 1 },
      }),
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
          useValue: {
            localBranches: signal([
              { name: 'main' },
              { name: 'feature/long-branch-name' },
            ]),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(GitReviewToolbarComponent);
    fixture.detectChanges();
    return { fixture, setMode };
  }

  it('switches to branch review through the rendered button', async () => {
    const { fixture, setMode } = await create();
    (
      fixture.nativeElement.querySelectorAll('button')[1] as HTMLButtonElement
    ).click();
    expect(setMode).toHaveBeenCalledWith('branch-review');
  });

  it('keeps the compare controls grouped and labels the review summary', async () => {
    const { fixture } = await create('branch-review');
    const toolbar = fixture.nativeElement.querySelector(
      '[data-testid="git-review-toolbar"]',
    ) as HTMLElement;

    expect(toolbar.classList).not.toContain('flex-wrap');
    expect(toolbar.querySelector('[aria-label="Review base"]')).not.toBeNull();
    expect(toolbar.querySelector('[aria-label="Review head"]')).not.toBeNull();
    expect(toolbar.textContent).toContain('2 files changed');
    expect(toolbar.textContent).toContain('+12');
    expect(toolbar.textContent).toContain('-4');
    expect(toolbar.textContent).toContain('1 binary');
  });
});
