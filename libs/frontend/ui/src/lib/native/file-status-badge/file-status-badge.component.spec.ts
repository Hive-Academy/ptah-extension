import { TestBed } from '@angular/core/testing';
import type { GitConflictKind } from '@ptah-extension/shared';

import {
  FileStatusBadgeComponent,
  type FileStatusCode,
} from './file-status-badge.component';

describe('FileStatusBadgeComponent', () => {
  function render(status: FileStatusCode, conflictKind?: GitConflictKind) {
    const fixture = TestBed.createComponent(FileStatusBadgeComponent);
    fixture.componentRef.setInput('status', status);
    if (conflictKind !== undefined) {
      fixture.componentRef.setInput('conflictKind', conflictKind);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it.each<[FileStatusCode, string, string, string]>([
    ['M', 'M', 'Modified', 'border-l-warning'],
    ['A', 'A', 'Added', 'border-l-success'],
    ['D', 'D', 'Deleted', 'border-l-error'],
    ['R', 'R', 'Renamed', 'border-l-secondary'],
    ['C', 'C', 'Copied', 'border-l-secondary'],
    ['U', '!', 'Conflicted', 'border-l-error'],
    ['T', 'T', 'Type changed', 'border-l-warning'],
    ['??', 'U', 'Untracked', 'border-l-info'],
    ['!', 'I', 'Ignored', 'border-l-base-content-muted'],
  ])(
    'renders %s as "%s", labelled "%s", with the %s accent',
    (status, letter, label, accent) => {
      const host = render(status);

      expect(host.textContent?.trim()).toBe(letter);
      expect(host.getAttribute('aria-label')).toBe(label);
      expect(host.getAttribute('title')).toBe(label);
      expect(host.classList.contains(accent)).toBe(true);
    },
  );

  it('exposes the full word as an image name, not the bare letter', () => {
    const host = render('A');

    expect(host.getAttribute('role')).toBe('img');
  });

  it('keeps the letter on base-content over base-300 whatever the status', () => {
    for (const status of ['A', 'D', '??'] as const) {
      const host = render(status);

      expect(host.classList.contains('text-base-content')).toBe(true);
      expect(host.classList.contains('bg-base-300')).toBe(true);
      expect(host.classList.contains('font-semibold')).toBe(true);
    }
  });

  it.each<[GitConflictKind, string]>([
    ['content', 'Conflicted'],
    ['delete-modify', 'Conflicted (deleted on one side)'],
    ['add-add', 'Conflicted (added on both sides)'],
    ['symlink', 'Conflicted (symlink)'],
    ['submodule', 'Conflicted (submodule)'],
  ])('names a %s conflict "%s"', (kind, label) => {
    expect(render('U', kind).getAttribute('aria-label')).toBe(label);
  });

  it('ignores a conflict kind on a status that is not a conflict', () => {
    expect(render('M', 'add-add').getAttribute('aria-label')).toBe('Modified');
  });

  it('still renders a status code this build does not know', () => {
    const host = render('X' as FileStatusCode);

    expect(host.textContent?.trim()).toBe('?');
    expect(host.getAttribute('aria-label')).toBe('Unknown status');
  });
});
