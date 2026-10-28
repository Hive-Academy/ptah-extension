import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { LibraryPassStatus } from '@ptah-extension/shared';

/**
 * C10 LibraryStaleNotice: a non-fatal warning shown only when the files were
 * written but the Library refresh after them failed (`libraryPass: 'failed'`).
 * A primary write failure is never shown here; it is a failed outcome.
 */
@Component({
  selector: 'ptah-library-stale-notice',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (libraryPass() === 'failed') {
      <div
        class="alert alert-warning mt-3 block text-xs"
        role="alert"
        data-testid="library-stale-notice"
      >
        The Library may not show the new agents until its next refresh. Your
        files were written.
      </div>
    }
  `,
})
export class LibraryStaleNoticeComponent {
  public readonly libraryPass = input<LibraryPassStatus | undefined>(undefined);
}
