import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { Lock, LucideAngularModule } from 'lucide-angular';
import { NativePopoverComponent } from '@ptah-extension/ui';

import { CopyCommandButtonComponent } from './copy-command-button.component';

/** Per-instance suffix for the popover heading id. */
let nextLockBadgeId = 0;

/**
 * The action-column control of a server Ptah cannot remove: a compact lock
 * badge whose popover gives the reason, the command that removes it by hand
 * and a copy button. Never a paragraph in the action column
 * (`prototype-brief.md:61-64`).
 *
 * The badge's accessible name is "Removal blocked — details"; its visible
 * word "Blocked" is part of that name. Without a `fixCommand` the popover
 * shows the reason only, with no command and no copy button.
 *
 * @example
 * ```html
 * <ptah-removal-lock-badge
 *   [serverName]="row.title"
 *   [reason]="row.removal.reason"
 *   [fixCommand]="row.removal.fixCommand"
 * />
 * ```
 */
@Component({
  selector: 'ptah-removal-lock-badge',
  standalone: true,
  imports: [
    LucideAngularModule,
    NativePopoverComponent,
    CopyCommandButtonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  template: `
    <ptah-native-popover
      [isOpen]="open()"
      placement="bottom-end"
      [hasBackdrop]="true"
      backdropClass="transparent"
      (closed)="close()"
    >
      <button
        trigger
        type="button"
        class="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning transition-colors hover:bg-warning/20"
        aria-label="Removal blocked — details"
        aria-haspopup="dialog"
        [attr.aria-expanded]="open()"
        data-testid="removal-lock-button"
        (click)="toggle()"
      >
        <lucide-angular [img]="LockIcon" class="h-3 w-3" aria-hidden="true" />
        <span>Blocked</span>
      </button>

      <div
        content
        class="w-72 space-y-2 p-3"
        role="dialog"
        [attr.aria-labelledby]="headingId"
        data-testid="removal-lock-details"
      >
        <h3 [id]="headingId" class="text-xs font-semibold text-base-content">
          Ptah can't remove {{ serverName() }}
        </h3>
        <p
          class="text-[11px] leading-relaxed text-base-content-muted"
          data-testid="removal-lock-reason"
        >
          {{ reason() }}
        </p>
        @if (command(); as fix) {
          <p class="text-[11px] text-base-content-muted">
            Run this in a terminal to remove it:
          </p>
          <div
            class="flex items-start gap-2 rounded-md border border-base-300 bg-base-100 px-2 py-1.5"
          >
            <code
              #fixCommandText
              class="min-w-0 flex-1 break-all font-mono text-[11px] text-base-content"
              data-testid="removal-fix-command"
              >{{ fix }}</code
            >
            <ptah-copy-command-button
              [command]="fix"
              [selectTarget]="fixCommandText"
            />
          </div>
        }
      </div>
    </ptah-native-popover>
  `,
})
export class RemovalLockBadgeComponent {
  /** The server's display name, for the popover heading. */
  public readonly serverName = input.required<string>();

  /** Why Ptah cannot remove it (`ProviderRemoval` `blocked.reason`). */
  public readonly reason = input.required<string>();

  /** The copyable command, when the backend could build a safe one. */
  public readonly fixCommand = input<string | null | undefined>(undefined);

  protected readonly LockIcon = Lock;
  protected readonly headingId = `ptah-removal-lock-${nextLockBadgeId++}`;

  protected readonly open = signal(false);

  /** The command, or `null` when absent or blank. */
  protected readonly command = computed(() => {
    const command = this.fixCommand()?.trim() ?? '';
    return command.length > 0 ? command : null;
  });

  protected toggle(): void {
    this.open.update((isOpen) => !isOpen);
  }

  protected close(): void {
    this.open.set(false);
  }
}
