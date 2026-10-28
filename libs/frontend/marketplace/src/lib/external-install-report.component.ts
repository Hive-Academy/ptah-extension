import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type {
  ExternalInstallResult,
  KeptItem,
  LocalItemFamily,
} from '@ptah-extension/shared';
import {
  LIBRARY_STALE_NOTE,
  UNREADABLE_KEPT_NOTE,
  familyName,
  isRepairableFamily,
  keptReasonLabel,
} from './kept-items-repair-prompt.component';

/** Note under a kept row, by reason; null when the badge says enough. */
function keptNote(item: KeptItem): string | null {
  switch (item.reason) {
    case 'unreadable':
      return UNREADABLE_KEPT_NOTE;
    case 'changed-since-approval':
      return 'This file changed between the preview and the install, so Ptah left it alone. Install again to review it.';
    default:
      return null;
  }
}

/**
 * ExternalInstallReportComponent — the post-install report of an external
 * plugin: only what the user still needs to know after the install landed.
 *
 * - Counters Written / Kept / Shadowed / Skipped (design 3.3).
 * - The named lists stay: files skipped as non-text and skills shadowed by an
 *   existing skill of the same name.
 * - "Kept (your files were not changed)" lists every kept item with its
 *   reason, including "Kept: changed since approval".
 * - "Review and replace…" is offered per installer family whose kept items
 *   `plugins:replace-kept-items` accepts; the parent opens the repair prompt
 *   bound to that family. External-family items were decided in the consent
 *   dialog, so they are replaced by installing again, not from here.
 * - C10 after a successful install whose Library refresh failed (the parent
 *   enables it in Electron only).
 *
 * PURELY PRESENTATIONAL: the parent owns the result and clears it on
 * `dismissed`. Split out of `ExternalMarketplacesComponent` by the plan C13
 * net-line rule.
 */
@Component({
  selector: 'ptah-external-install-report',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="rounded-lg border border-success/40 bg-success/10 p-2.5 space-y-2"
      data-testid="external-install-report"
    >
      <div class="flex items-start justify-between gap-2">
        <span class="text-xs font-semibold text-base-content">
          Installed {{ report().displayName }}
          {{ report().installedVersion }} ({{ report().filesWritten }} files)
        </span>
        <button
          class="btn btn-ghost btn-xs shrink-0"
          type="button"
          (click)="dismissed.emit()"
        >
          Dismiss
        </button>
      </div>

      <dl class="grid grid-cols-4 gap-1.5" data-testid="install-counters">
        @for (counter of counters(); track counter.label) {
          <div
            class="rounded-md border border-base-300 bg-base-100/60 px-2 py-1 flex flex-col-reverse"
            [attr.data-counter]="counter.label"
          >
            <dt class="text-[10px] text-base-content-muted">
              {{ counter.label }}
            </dt>
            <dd class="text-sm font-semibold text-base-content">
              {{ counter.value }}
            </dd>
          </div>
        }
      </dl>

      @if (report().skippedBinaryFiles.length > 0) {
        <div class="text-[11px] text-base-content-muted">
          Skipped (not valid UTF-8 text):
          @for (file of report().skippedBinaryFiles; track $index) {
            <code class="font-mono break-all">{{ file }}</code>
            <span aria-hidden="true">&nbsp;</span>
          }
        </div>
      }
      @if (report().collisions.length > 0) {
        <ul class="space-y-0.5">
          @for (collision of report().collisions; track $index) {
            <li class="text-[11px] text-base-content-muted break-all">
              skill <code class="font-mono">{{ collision.skillName }}</code
              >&nbsp;is shadowed by
              <code class="font-mono">{{ collision.shadowedBy }}</code> and will
              not take effect
            </li>
          }
        </ul>
      }

      @if (kept().length > 0) {
        <section aria-labelledby="install-report-kept" class="space-y-1">
          <h4
            id="install-report-kept"
            class="text-[11px] font-semibold text-base-content"
          >
            Kept (your files were not changed)
          </h4>
          <ul class="space-y-1">
            @for (item of kept(); track item.approvalId) {
              <li data-testid="kept-row" [attr.data-path]="item.relPath">
                <div class="flex items-start gap-2">
                  <code
                    class="grow text-[11px] font-mono [overflow-wrap:anywhere]"
                    >{{ item.relPath }}</code
                  >
                  <span class="badge badge-sm badge-ghost shrink-0">{{
                    badgeOf(item)
                  }}</span>
                </div>
                @if (noteOf(item); as note) {
                  <p class="text-[11px] text-base-content-muted">{{ note }}</p>
                }
              </li>
            }
          </ul>
          @for (family of repairFamilies(); track family) {
            <button
              type="button"
              class="btn btn-outline btn-xs"
              [attr.data-family]="family"
              [attr.aria-label]="'Review and replace kept ' + nameOf(family)"
              (click)="reviewKept.emit(family)"
            >
              Review and replace…
            </button>
          }
        </section>
      }

      @if (showLibraryNotice() && report().libraryPass === 'failed') {
        <div
          class="alert alert-warning block text-xs"
          role="status"
          data-testid="library-stale-notice"
        >
          {{ libraryStaleNote }}
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class ExternalInstallReportComponent {
  /** The successful install to report. */
  public readonly report = input.required<ExternalInstallResult>();
  /** Show C10 when the Library refresh failed (Electron only). */
  public readonly showLibraryNotice = input(false);

  /** The user dismissed the report. */
  public readonly dismissed = output<void>();
  /** "Review and replace…" for the kept items of one installer family. */
  public readonly reviewKept = output<LocalItemFamily>();

  protected readonly libraryStaleNote = LIBRARY_STALE_NOTE;

  public readonly kept = computed<readonly KeptItem[]>(
    () => this.report().kept ?? [],
  );

  /** Written / Kept / Shadowed / Skipped, in that order. */
  public readonly counters = computed(() => {
    const report = this.report();
    return [
      { label: 'Written', value: report.filesWritten },
      { label: 'Kept', value: this.kept().length },
      { label: 'Shadowed', value: report.collisions.length },
      { label: 'Skipped', value: report.skippedBinaryFiles.length },
    ];
  });

  /** Families with at least one replaceable kept item, in first-seen order. */
  public readonly repairFamilies = computed<LocalItemFamily[]>(() => {
    const families: LocalItemFamily[] = [];
    for (const item of this.kept()) {
      if (item.reason === 'unreadable') continue;
      if (!isRepairableFamily(item.family)) continue;
      if (!families.includes(item.family)) families.push(item.family);
    }
    return families;
  });

  protected badgeOf(item: KeptItem): string {
    // Unowned and owned-edited rows were the user's own Keep; the badge says
    // so plainly. Other reasons name why Ptah kept the file.
    return item.reason === 'unowned' || item.reason === 'owned-edited'
      ? 'Kept'
      : keptReasonLabel(item.reason);
  }

  protected noteOf(item: KeptItem): string | null {
    return keptNote(item);
  }

  protected nameOf(family: LocalItemFamily): string {
    return familyName(family);
  }
}
