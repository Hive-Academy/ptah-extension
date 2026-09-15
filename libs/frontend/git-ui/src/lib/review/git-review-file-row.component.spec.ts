import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { VSCodeService } from '@ptah-extension/core';
import { DiffViewComponent } from '../diff-view/diff-view.component';
import { MonacoLoaderService } from '../services/monaco-loader.service';
import { GitReviewFileRowComponent } from './git-review-file-row.component';
import { GitReviewService } from '../services/git-review.service';
import { EditorLauncherService } from '../services/editor-launcher.service';

describe('GitReviewFileRowComponent', () => {
  async function create(
    options: {
      status?: 'M' | 'A' | 'D' | 'R' | 'C';
      expanded?: boolean;
      viewed?: boolean;
      hasFile?: boolean;
      originalPath?: string;
    } = {},
  ) {
    const path = 'src/components/review-panel.ts';
    const expandedPath = signal(options.expanded ? path : null);
    const viewed = signal(options.viewed ?? false);
    const toggleViewed = jest.fn(() => viewed.update((value) => !value));
    const expand = jest.fn((requestedPath: string) =>
      expandedPath.update((current) =>
        current === requestedPath ? null : requestedPath,
      ),
    );
    const review = {
      expandedPath,
      file: signal(
        options.expanded || options.hasFile
          ? {
              success: true,
              path,
              originalPath: options.originalPath ?? path,
              baseSha: 'base-sha',
              headSha: 'head-sha',
              original: { outcome: 'absent' as const },
              modified: { outcome: 'content' as const, content: 'added\n' },
            }
          : null,
      ),
      base: signal('main'),
      head: signal('feature'),
      isViewed: () => viewed(),
      toggleViewed,
      expand,
    };
    await TestBed.configureTestingModule({
      imports: [GitReviewFileRowComponent],
      providers: [
        { provide: GitReviewService, useValue: review },
        {
          provide: EditorLauncherService,
          useValue: { targets: signal([]), openFile: jest.fn() },
        },
        { provide: VSCodeService, useValue: { getState: jest.fn() } },
        {
          provide: MonacoLoaderService,
          useValue: { load: () => new Promise(() => undefined) },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(GitReviewFileRowComponent);
    fixture.componentRef.setInput('workspaceRoot', '/ws');
    fixture.componentRef.setInput('file', {
      path,
      originalPath: options.originalPath,
      status: options.status ?? 'M',
      additions: 3,
      deletions: 1,
      binary: false,
    });
    fixture.detectChanges();
    return { fixture, toggleViewed, expand, expandedPath, path };
  }

  it('renders the name before its truncated directory and an accessible status badge', async () => {
    const { fixture } = await create({ status: 'M' });
    const header = fixture.nativeElement.querySelector('header') as HTMLElement;
    const text = header.textContent ?? '';

    expect(text.indexOf('review-panel.ts')).toBeLessThan(
      text.indexOf('src/components'),
    );
    expect(header.querySelector('.font-medium')?.textContent).toContain(
      'review-panel.ts',
    );
    expect(
      header.querySelector('[data-testid="review-parent-directory"]')
        ?.textContent,
    ).toContain('src/components');
    expect(header.querySelector('[aria-label="Modified"]')).not.toBeNull();
  });

  it('uses a compact Viewed checkbox and toggles the file', async () => {
    const { fixture, toggleViewed, path } = await create();
    const viewed = fixture.nativeElement.querySelector(
      `input[aria-label="Viewed ${path}"]`,
    ) as HTMLInputElement;

    viewed.click();
    expect(toggleViewed).toHaveBeenCalledWith(path);
    expect(fixture.nativeElement.textContent).toContain('Viewed');
  });

  it('collapses when marked Viewed and lets a viewed row expand normally', async () => {
    const { fixture, expand, expandedPath, path } = await create({
      expanded: true,
      hasFile: true,
    });
    const viewed = fixture.nativeElement.querySelector(
      `input[aria-label="Viewed ${path}"]`,
    ) as HTMLInputElement;

    expect(
      fixture.nativeElement.querySelector('ptah-diff-view'),
    ).not.toBeNull();
    viewed.click();
    fixture.detectChanges();
    expect(expand).toHaveBeenCalledWith(path);
    expect(expandedPath()).toBeNull();
    expect(fixture.nativeElement.querySelector('ptah-diff-view')).toBeNull();

    const name = fixture.nativeElement.querySelector(
      `button[aria-label="Toggle diff for ${path}"]`,
    ) as HTMLButtonElement;
    name.click();
    fixture.detectChanges();
    expect(expandedPath()).toBe(path);
    expect(name.getAttribute('aria-expanded')).toBe('true');
    expect(
      fixture.nativeElement.querySelector('ptah-diff-view'),
    ).not.toBeNull();
  });

  it('forces added files inline while suppressing the duplicate diff header', async () => {
    const { fixture } = await create({ status: 'A', expanded: true });
    const diff = fixture.debugElement.query(By.directive(DiffViewComponent))
      .componentInstance as DiffViewComponent;

    expect(diff.layoutOverride()).toBe('inline');
    expect(diff.showHeader()).toBe(false);
  });

  it('shows old and new names for a rename', async () => {
    const { fixture } = await create({
      status: 'R',
      originalPath: 'src/components/old-panel.ts',
    });
    expect(fixture.nativeElement.textContent).toContain(
      'old-panel.ts → review-panel.ts',
    );
    expect(
      fixture.nativeElement
        .querySelector('button[title]')
        ?.getAttribute('title'),
    ).toBe('src/components/old-panel.ts → src/components/review-panel.ts');
  });
});
