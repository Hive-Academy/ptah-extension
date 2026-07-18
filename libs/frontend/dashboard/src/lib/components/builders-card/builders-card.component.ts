import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
} from '@angular/core';
import { LucideAngularModule, Users } from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';

/**
 * BuildersCardComponent
 *
 * A single, tasteful in-app promotion of the paid Ptah Builders membership
 * (community + training + priority support). Ptah itself is fully open source;
 * this card is the only in-product mention of the membership — no countdowns,
 * comparison tables, "upgrade" verbs, modals, or nags.
 *
 * Behaviour:
 * - Fully functional signed-out: no license RPC is ever called, and the card
 *   never touches the network unless the user explicitly clicks the link.
 * - Dismissal is permanent and local: seeded from and written to
 *   `localStorage['ptah.builders-card.dismissed']` (pattern mirrored from
 *   `ConversationRegistry.readPersisted`/`writePersisted`). Once dismissed the
 *   card is hidden via `@if (!dismissed())` and never re-nags.
 * - The link-out reuses the exact host mechanism `SettingsComponent.openPricing`
 *   uses: the `command:execute` RPC running the host `ptah.openPricing` command,
 *   which resolves the Builders/community URL host-side.
 */
@Component({
  selector: 'ptah-builders-card',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './builders-card.component.html',
})
export class BuildersCardComponent {
  private static readonly DISMISS_STORAGE_KEY = 'ptah.builders-card.dismissed';

  private readonly rpcService = inject(ClaudeRpcService);

  readonly UsersIcon = Users;

  /** Whether the user has permanently dismissed the card. Seeded from localStorage. */
  readonly dismissed = signal<boolean>(
    globalThis.localStorage?.getItem(
      BuildersCardComponent.DISMISS_STORAGE_KEY,
    ) === '1',
  );

  /**
   * Open the external Ptah Builders / community page in the browser via the
   * host `ptah.openPricing` command (target URL resolved host-side).
   */
  async exploreBuilders(): Promise<void> {
    await this.rpcService.call('command:execute', {
      command: 'ptah.openPricing',
    });
  }

  /** Permanently hide the card and persist the choice to localStorage. */
  dismiss(): void {
    try {
      globalThis.localStorage?.setItem(
        BuildersCardComponent.DISMISS_STORAGE_KEY,
        '1',
      );
    } catch (error: unknown) {
      console.warn('[BuildersCard] failed to persist dismissal', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.dismissed.set(true);
  }
}
