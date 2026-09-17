import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import { GitReviewPanelComponent } from './git-review-panel.component';
import { GitReviewService } from '../services/git-review.service';
import { EditorLauncherService } from '../services/editor-launcher.service';

describe('GitReviewPanelComponent', () => {
  async function create(files: unknown[] = []) {
    const expandedPath = signal<string | null>(null);
    const expand = jest.fn((path: string) => expandedPath.set(path));
    const review = {
      loading: signal(false),
      error: signal(null),
      files: signal(files),
      filterQuery: signal(''),
      expandedPath,
      setFilter: jest.fn(),
      expand,
      isViewed: () => false,
      toggleViewed: jest.fn(),
      file: signal(null),
    };
    await TestBed.configureTestingModule({
      imports: [GitReviewPanelComponent],
      providers: [
        { provide: GitReviewService, useValue: review },
        {
          provide: EditorLauncherService,
          useValue: { targets: signal([]), openFile: jest.fn() },
        },
        { provide: VSCodeService, useValue: { getState: jest.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(GitReviewPanelComponent);
    fixture.componentRef.setInput('workspaceRoot', '/ws');
    fixture.detectChanges();
    return { fixture, expand, expandedPath };
  }

  it('renders the centered empty state', async () => {
    const { fixture } = await create();
    expect(fixture.nativeElement.textContent).toContain(
      'No files changed between these branches',
    );
  });

  it('collapses and expands folders from the file tree', async () => {
    const { fixture } = await create([
      {
        path: 'src/review.ts',
        status: 'M',
        additions: 3,
        deletions: 1,
        binary: false,
      },
    ]);
    const folder = fixture.nativeElement.querySelector(
      'aside button[title="src"]',
    ) as HTMLButtonElement;
    expect(
      fixture.nativeElement.querySelector(
        'aside button[title="src/review.ts"]',
      ),
    ).not.toBeNull();

    folder.click();
    fixture.detectChanges();
    expect(folder.getAttribute('aria-expanded')).toBe('false');
    expect(
      fixture.nativeElement.querySelector(
        'aside button[title="src/review.ts"]',
      ),
    ).toBeNull();

    folder.click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        'aside button[title="src/review.ts"]',
      ),
    ).not.toBeNull();
  });

  it('expands a tree file and scrolls its review row into view', async () => {
    const scrollIntoView = jest.fn();
    const wrongScrollIntoView = jest.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const otherPanelRow = document.createElement('div');
    otherPanelRow.dataset['reviewPath'] = 'src/review.ts';
    otherPanelRow.scrollIntoView = wrongScrollIntoView;
    document.body.prepend(otherPanelRow);
    const { fixture, expand } = await create([
      {
        path: 'src/review.ts',
        status: 'A',
        additions: 3,
        deletions: 0,
        binary: false,
      },
    ]);

    (
      fixture.nativeElement.querySelector(
        'aside button[title="src/review.ts"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await Promise.resolve();

    expect(expand).toHaveBeenCalledWith('src/review.ts');
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
    expect(wrongScrollIntoView).not.toHaveBeenCalled();
    otherPanelRow.remove();
    HTMLElement.prototype.scrollIntoView = original;
  });
});
