import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
} from '@angular/core';
import {
  LucideAngularModule,
  ExternalLink,
  FileText,
  Folder,
  Send,
} from 'lucide-angular';
import { FILE_LINK_OPENER } from '@ptah-extension/core';
import type {
  LaneResult,
  LaneVerdictTone,
} from '../../utils/lane-result.utils';

const PILL_BASE =
  'ml-auto max-w-[50%] truncate flex-shrink-0 rounded-full border px-2 py-px text-[11px] leading-4';

/** Pill classes per verdict tone; colour is never the only signal (text). */
const PILL_CLASSES: Record<LaneVerdictTone, string> = {
  approved: `${PILL_BASE} text-success border-success/40 bg-success/10`,
  revision: `${PILL_BASE} text-warning border-warning/40 bg-warning/10`,
  rejected: `${PILL_BASE} text-error border-error/40 bg-error/10`,
  neutral: `${PILL_BASE} text-base-content border-base-content/15 bg-base-300/60`,
};

/**
 * LaneResultCardComponent - the files an agent message reports it wrote.
 *
 * Complexity Level: 2 (Molecule)
 *
 * Renders a `LaneResult` (`parseLaneResult`) below the message body:
 * - Optional note: send icon, the muted label "Reported to the spawning
 *   session" and the wrapped text
 * - Header "Files written · N"; when every file shares one folder, its last
 *   segment once on the right (full folder path in `title`)
 * - One row per file: file icon, bold name (truncates), verdict pill tinted
 *   by tone, and an "Open <name>" button that opens through
 *   `FILE_LINK_OPENER`, like `ToolCallHeaderComponent.openFile()`. The row
 *   and the button carry the full path in `title`, exactly as written
 */
@Component({
  selector: 'ptah-lane-result-card',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <section
      class="my-2 rounded-lg border border-base-content/10 bg-base-200 overflow-hidden text-sm"
      aria-label="Files written"
      data-testid="lane-result-card"
    >
      @if (result().reported; as reported) {
        <div
          class="flex gap-2 px-3 py-2.5 border-b border-base-content/10"
          data-testid="lane-result-reported"
        >
          <lucide-angular
            [img]="SendIcon"
            class="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-success"
            aria-hidden="true"
          />
          <div class="min-w-0">
            <span
              class="block text-[11px] uppercase tracking-wide text-base-content-muted"
              >Reported to the spawning session</span
            >
            <span
              class="whitespace-pre-wrap [overflow-wrap:anywhere] text-base-content"
              >{{ reported }}</span
            >
          </div>
        </div>
      }

      <div
        class="flex items-center gap-2 px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-base-content-muted"
      >
        <span class="flex-shrink-0" data-testid="lane-result-count"
          >Files written · {{ result().files.length }}</span
        >
        @if (result().folder; as folder) {
          <span
            class="ml-auto min-w-0 flex items-center gap-1 font-mono normal-case tracking-normal"
            [title]="folder.path"
            data-testid="lane-result-folder"
          >
            <lucide-angular
              [img]="FolderIcon"
              class="w-3 h-3 flex-shrink-0"
              aria-hidden="true"
            />
            <span class="truncate">{{ folder.name }}</span>
          </span>
        }
      </div>

      <ul class="m-0 p-0 list-none">
        @for (file of result().files; track $index) {
          <li
            class="flex items-center gap-2.5 py-1 pl-3 pr-2 border-t border-base-content/5 first:border-t-0 hover:bg-[var(--surface-highlight)]"
            [title]="file.path"
            data-testid="lane-result-file"
          >
            <lucide-angular
              [img]="FileIcon"
              class="w-4 h-4 flex-shrink-0 text-info"
              aria-hidden="true"
            />
            <span
              class="min-w-0 truncate font-semibold text-[13px] text-base-content"
              data-testid="lane-result-name"
              >{{ file.name }}</span
            >
            @if (file.verdict) {
              <span
                [class]="pillClasses[file.tone]"
                [title]="file.verdict"
                data-testid="lane-result-verdict"
                >{{ file.verdict }}</span
              >
            }
            <button
              type="button"
              class="btn btn-ghost btn-square btn-xs h-7 w-7 min-h-0 flex-shrink-0 text-info/80 hover:text-info"
              [class.ml-auto]="!file.verdict"
              [attr.aria-label]="'Open ' + file.name"
              [title]="file.path"
              (click)="openFile(file.path)"
            >
              <lucide-angular
                [img]="ExternalLinkIcon"
                class="w-3 h-3"
                aria-hidden="true"
              />
            </button>
          </li>
        }
      </ul>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LaneResultCardComponent {
  private readonly opener = inject(FILE_LINK_OPENER);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  readonly result = input.required<LaneResult>();

  protected readonly pillClasses = PILL_CLASSES;
  protected readonly SendIcon = Send;
  protected readonly FolderIcon = Folder;
  protected readonly FileIcon = FileText;
  protected readonly ExternalLinkIcon = ExternalLink;

  /**
   * Open a written file through the host's opener. A rejection is logged, as
   * in `ToolCallHeaderComponent`; the host renders the failure.
   */
  protected openFile(path: string): void {
    void this.opener
      .open({ path, origin: this.host.nativeElement })
      .catch((error: unknown) => {
        console.error('[LaneResultCard] Failed to open', path, error);
      });
  }
}
