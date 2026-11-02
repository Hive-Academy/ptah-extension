import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import type {
  InstallMigrationNotice,
  InstallMigrationOnDiskEntry,
} from '@ptah-extension/shared';

/** Which button dismissed the notice. */
export type InstallScopeMigrationNoticeAction = 'open-marketplace' | 'got-it';

/**
 * Delays between notice reads while the host reports no notice. The Electron
 * boot starts the migration without awaiting it, so it can finish after the
 * chat view loaded (reports/batch-35.json timingTrace). The schedule is
 * bounded: eight reads over about five minutes, then the view stops asking.
 * A dismissed or empty notice also reads as `null`, so an unbounded poll
 * would run for the life of the view.
 */
export const INSTALL_MIGRATION_NOTICE_RECHECK_MS: readonly number[] = [
  2_000, 5_000, 10_000, 20_000, 30_000, 60_000, 60_000, 120_000,
];

/** Fixed copy for a failed dismissal. Host error text is never shown. */
export const INSTALL_MIGRATION_NOTICE_DISMISS_ERROR =
  'Ptah could not save that you saw this notice. Try again.';

let nextNoticeId = 0;

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * InstallScopeMigrationNoticeComponent - the one-time install-scope migration
 * notice at the top of the main chat view (design-spec §3).
 *
 * Reads the persisted notice through `harness:get-install-migration-notice`,
 * so it survives restarts until the user dismisses it, and also appears when
 * the migration finished before any chat view existed. "Open Marketplace" and
 * "Got it" both record the dismissal through
 * `harness:dismiss-install-migration-notice`; the card hides only after the
 * host confirmed it, then emits `dismissed` so the container can move focus.
 *
 * A labelled region, not an alert: it never takes focus when it appears.
 */
@Component({
  selector: 'ptah-install-scope-migration-notice',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visibleNotice(); as notice) {
      <section
        class="card bg-base-200 border border-info p-3 mt-2 text-xs"
        role="region"
        [attr.aria-labelledby]="headingId"
        [attr.aria-busy]="busy() ? 'true' : null"
        data-testid="install-migration-notice"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1 basis-64">
            <h2 [id]="headingId" class="text-[13px] font-semibold leading-5">
              Installed items no longer load in every workspace
            </h2>
            <p class="mt-1.5">
              Skills and MCP servers installed earlier were shared with every
              workspace. Ptah has stopped sharing them. Files kept in a
              workspace may still be available in that workspace.
            </p>
            <ul class="mt-2 list-disc pl-[18px] space-y-0.5">
              @if (notice.counts.retired > 0) {
                <li data-testid="install-migration-retired">
                  <strong>{{ notice.counts.retired }}</strong>
                  {{ retiredText(notice.counts.retired) }}
                </li>
              }
              @if (notice.counts.deleted > 0) {
                <li data-testid="install-migration-deleted">
                  <strong>{{ notice.counts.deleted }}</strong>
                  {{ deletedText(notice.counts.deleted) }}
                </li>
              }
              @if (notice.counts.kept > 0) {
                <li data-testid="install-migration-kept">
                  <strong>{{ notice.counts.kept }}</strong>
                  {{ keptText(notice.counts.kept) }}
                </li>
              }
              @if (notice.counts.onDisk > 0) {
                <li data-testid="install-migration-on-disk">
                  <strong>{{ notice.counts.onDisk }}</strong>
                  {{ onDiskText() }}
                </li>
              }
            </ul>
            <p class="mt-2">
              <strong>To get something back:</strong> open the workspace, go to
              Marketplace, find the item and choose <em>Install</em>. It
              installs into that workspace. Pick <em>All workspaces</em> if you
              want it everywhere.
            </p>
            @if (notice.counts.kept > 0 && notice.keptPaths.length > 0) {
              <details class="mt-2" data-testid="install-migration-kept-details">
                <summary class="cursor-pointer">
                  Show the {{ notice.counts.kept }}
                  {{ plural(notice.counts.kept, 'file', 'files') }} kept in a
                  workspace
                </summary>
                <ul
                  class="mt-1.5 max-h-40 overflow-y-auto pl-[18px] list-disc font-mono text-xs break-all"
                  tabindex="0"
                  aria-label="Files kept in a workspace"
                >
                  @for (path of notice.keptPaths; track path) {
                    <li>{{ path }}</li>
                  }
                </ul>
              </details>
            }
            @if (notice.counts.onDisk > 0 && notice.onDisk.length > 0) {
              <details
                class="mt-2"
                data-testid="install-migration-on-disk-details"
              >
                <summary class="cursor-pointer">
                  Show the {{ notice.counts.onDisk }} shared
                  {{ plural(notice.counts.onDisk, 'source', 'sources') }} left
                  on disk
                </summary>
                <ul
                  class="mt-1.5 max-h-40 overflow-y-auto pl-[18px] list-disc font-mono text-xs break-all"
                  tabindex="0"
                  aria-label="Shared sources left on disk"
                >
                  @for (
                    entry of notice.onDisk;
                    track entry.kind + entry.path + entry.name
                  ) {
                    <li>{{ onDiskEntryText(entry) }}</li>
                  }
                </ul>
              </details>
            }
            @if (dismissError()) {
              <p
                class="mt-2 text-error"
                role="alert"
                data-testid="install-migration-error"
              >
                {{ dismissError() }}
              </p>
            }
          </div>
          <div class="flex flex-none gap-1.5">
            <button
              type="button"
              class="btn btn-primary btn-sm"
              [attr.aria-disabled]="busy() ? 'true' : null"
              (click)="dismiss('open-marketplace')"
              data-testid="install-migration-open-marketplace"
            >
              Open Marketplace
            </button>
            <button
              type="button"
              class="btn btn-outline btn-sm"
              [attr.aria-disabled]="busy() ? 'true' : null"
              (click)="dismiss('got-it')"
              data-testid="install-migration-got-it"
            >
              Got it
            </button>
          </div>
        </div>
      </section>
    }
  `,
})
export class InstallScopeMigrationNoticeComponent {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly appState = inject(AppStateManager);

  /** Emitted after the host recorded the dismissal and the card hid. */
  readonly dismissed = output<InstallScopeMigrationNoticeAction>();

  protected readonly headingId = `install-migration-notice-title-${nextNoticeId++}`;

  private readonly notice = signal<InstallMigrationNotice | null>(null);
  protected readonly busy = signal(false);
  protected readonly dismissError = signal<string | null>(null);

  /** Hidden only when all four counts are 0; a retired-only run still shows. */
  protected readonly visibleNotice = computed(() => {
    const notice = this.notice();
    if (!notice) return null;
    const { retired, deleted, kept, onDisk } = notice.counts;
    return retired + deleted + kept + onDisk > 0 ? notice : null;
  });

  protected readonly onDiskText = computed(() => {
    const notice = this.notice();
    if (!notice) return '';
    const count = notice.counts.onDisk;
    const folders = notice.onDisk.filter(
      (e) => e.kind === 'skills-sh-root',
    ).length;
    const entries = notice.onDisk.filter(
      (e) => e.kind === 'mcp-home-entry',
    ).length;
    const parts: string[] = [];
    if (folders > 0) {
      parts.push(
        `${folders} ${plural(folders, 'skills.sh folder', 'skills.sh folders')}`,
      );
    }
    if (entries > 0) {
      parts.push(
        `${entries} ${plural(entries, 'home-folder MCP entry', 'home-folder MCP entries')}`,
      );
    }
    const detail = parts.length > 0 ? ` (${parts.join(', ')})` : '';
    return (
      `${plural(count, 'shared source was', 'shared sources were')} left on disk ` +
      `because Ptah could not prove it created ${plural(count, 'it', 'them')}${detail}. ` +
      `${plural(count, 'It is', 'They are')} inactive in Ptah but may still be configured for other tools.`
    );
  });

  protected readonly plural = plural;

  private recheckIndex = 0;
  private recheckTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly abort = new AbortController();
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.clearRecheck();
      this.abort.abort();
    });
    void this.load();
  }

  protected retiredText(count: number): string {
    return count === 1
      ? 'shared item was retired: it no longer loads in every workspace.'
      : 'shared items were retired: they no longer load in every workspace.';
  }

  protected deletedText(count: number): string {
    return count === 1
      ? 'copy Ptah created itself was deleted.'
      : 'copies Ptah created itself were deleted.';
  }

  protected keptText(count: number): string {
    return count === 1
      ? 'file was kept in a workspace because you edited it or it is part of a git project. It may still be available in that workspace.'
      : 'files were kept in a workspace because you edited them or they are part of a git project. They may still be available in that workspace.';
  }

  protected onDiskEntryText(entry: InstallMigrationOnDiskEntry): string {
    return entry.kind === 'skills-sh-root'
      ? `${entry.path} (skills.sh folder)`
      : `${entry.path}: ${entry.name} (MCP entry)`;
  }

  /** Record the dismissal, then hide, navigate (Open Marketplace) and emit. */
  protected async dismiss(
    action: InstallScopeMigrationNoticeAction,
  ): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.dismissError.set(null);
    const result = await this.rpc.call(
      'harness:dismiss-install-migration-notice',
      {},
      { signal: this.abort.signal },
    );
    if (this.destroyed) return;
    this.busy.set(false);
    if (!result.isSuccess()) {
      this.dismissError.set(INSTALL_MIGRATION_NOTICE_DISMISS_ERROR);
      return;
    }
    // `data.success: false` means the host holds no notice to dismiss: nothing
    // is left to show, so the card hides as for a recorded dismissal.
    this.clearRecheck();
    this.notice.set(null);
    if (action === 'open-marketplace') {
      this.appState.setCurrentView('marketplace');
    }
    this.dismissed.emit(action);
  }

  private async load(): Promise<void> {
    const result = await this.rpc.call(
      'harness:get-install-migration-notice',
      {},
      { signal: this.abort.signal },
    );
    if (this.destroyed) return;
    // A failed read is not shown: the notice is informational and the next
    // scheduled read retries it.
    const notice = result.isSuccess() ? result.data.notice : null;
    if (notice) {
      this.notice.set(notice);
      return;
    }
    this.scheduleRecheck();
  }

  private scheduleRecheck(): void {
    const delay = INSTALL_MIGRATION_NOTICE_RECHECK_MS[this.recheckIndex];
    if (delay === undefined) return;
    this.recheckIndex += 1;
    this.recheckTimer = setTimeout(() => {
      this.recheckTimer = null;
      void this.load();
    }, delay);
  }

  private clearRecheck(): void {
    if (this.recheckTimer !== null) {
      clearTimeout(this.recheckTimer);
      this.recheckTimer = null;
    }
  }
}
