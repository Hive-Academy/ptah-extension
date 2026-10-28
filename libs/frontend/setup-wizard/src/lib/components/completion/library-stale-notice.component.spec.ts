import { TestBed } from '@angular/core/testing';
import type { LibraryPassStatus } from '@ptah-extension/shared';
import { LibraryStaleNoticeComponent } from './library-stale-notice.component';

function render(pass: LibraryPassStatus | undefined): HTMLElement {
  TestBed.configureTestingModule({ imports: [LibraryStaleNoticeComponent] });
  const fixture = TestBed.createComponent(LibraryStaleNoticeComponent);
  fixture.componentRef.setInput('libraryPass', pass);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('LibraryStaleNoticeComponent', () => {
  it('warns, without claiming a failure, when the Library pass failed', () => {
    const notice = render('failed').querySelector(
      '[data-testid="library-stale-notice"]',
    );
    expect(notice?.getAttribute('role')).toBe('alert');
    expect(notice?.textContent).toContain(
      'The Library may not show the new agents until its next refresh.',
    );
    expect(notice?.textContent).toContain('Your files were written.');
  });

  it.each<LibraryPassStatus | undefined>([
    'updated',
    'not-applicable',
    undefined,
  ])(
    'renders nothing for libraryPass %s',
    (pass) => {
      expect(
        render(pass).querySelector('[data-testid="library-stale-notice"]'),
      ).toBeNull();
    },
  );
});
