import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import { GitReviewFileRowComponent } from './git-review-file-row.component';
import { GitReviewService } from '../services/git-review.service';
import { EditorLauncherService } from '../services/editor-launcher.service';
describe('GitReviewFileRowComponent', () => {
  it('toggles viewed from the rendered action and shows unknown binary counts', async () => {
    const toggleViewed = jest.fn();
    const review = {
      expandedPath: signal(null),
      file: signal(null),
      isViewed: () => false,
      toggleViewed,
      expand: jest.fn(),
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
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(GitReviewFileRowComponent);
    fixture.componentRef.setInput('workspaceRoot', '/ws');
    fixture.componentRef.setInput('file', {
      path: 'asset.bin',
      status: 'M',
      additions: null,
      deletions: null,
      binary: true,
    });
    fixture.detectChanges();
    const viewed = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: HTMLButtonElement) =>
        button.textContent?.includes('Mark as viewed'),
    ) as HTMLButtonElement;
    viewed.click();
    expect(toggleViewed).toHaveBeenCalledWith('asset.bin');
    expect(fixture.nativeElement.textContent).toContain('?');
  });
});
