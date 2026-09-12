import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GitReviewPanelComponent } from './git-review-panel.component';
import { GitReviewService } from '../services/git-review.service';
describe('GitReviewPanelComponent', () => {
  it('renders the real filter control and empty state', async () => {
    const review = {
      loading: signal(false),
      error: signal(null),
      files: signal([]),
      filterQuery: signal(''),
      setFilter: jest.fn(),
      expand: jest.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [GitReviewPanelComponent],
      providers: [{ provide: GitReviewService, useValue: review }],
    }).compileComponents();
    const fixture = TestBed.createComponent(GitReviewPanelComponent);
    fixture.componentRef.setInput('workspaceRoot', '/ws');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[aria-label="Filter files"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'No matching changed files',
    );
  });
});
