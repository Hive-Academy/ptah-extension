import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NotificationLedgerService } from './notification-ledger.service';

/**
 * The polite live region that announces notification bursts.
 *
 * Separate from the bell on purpose (TASK_2026_524 batch 3). In the VS Code
 * shell the bell sits inside chrome that is detached on a standalone surface,
 * and a detached live region is out of the document, so nothing would be
 * announced while Settings is open. Each shell renders exactly one of these
 * outside any retained view.
 */
@Component({
  selector: 'ptah-notification-announcer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span
    class="sr-only"
    role="status"
    aria-live="polite"
    aria-atomic="true"
    >{{ ledger.announcement() }}</span
  >`,
})
export class NotificationAnnouncerComponent {
  protected readonly ledger = inject(NotificationLedgerService);
}
