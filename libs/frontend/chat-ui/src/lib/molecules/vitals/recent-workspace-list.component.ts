import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { FolderOpen, LucideAngularModule } from 'lucide-angular';

/** One row of the recents list, already formatted by the owning store. */
export interface RecentWorkspaceItem {
  /** Full folder path; emitted on open and shown as the row tooltip. */
  readonly path: string;
  readonly name: string;
  /** The parent folder shown under the name. */
  readonly parent: string;
  /** Short age, e.g. "2d". */
  readonly ageLabel: string;
}

let nextTitleId = 0;

/**
 * RecentWorkspaceListComponent — the "Recent" column of the no-workspace
 * screen. Each row is a button: folder icon, name over parent folder, and
 * the age on the right (`20px 1fr auto`). No sparkline and no per-row data
 * fetch (TASK_2026_721 D8).
 *
 * Paths render as text only. Name and parent ellipsize on one line each;
 * the full path is the row's tooltip. The visible text (name, parent, age)
 * names the button, so speech input matches what is shown (WCAG 2.5.3).
 * Rows track by index and path, so a duplicate path cannot break the list.
 * Renders nothing when `items` is empty; the parent owns the empty copy.
 */
@Component({
  selector: 'ptah-recent-workspace-list',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length > 0) {
      <nav class="ptah-recents" [attr.aria-labelledby]="titleId">
        <div [id]="titleId" class="ptah-recents__title text-base-content-muted">
          Recent
        </div>
        <ul class="ptah-recents__list" role="list">
          @for (item of items(); track $index + ':' + item.path) {
            <li>
              <button
                type="button"
                class="ptah-recents__row"
                [title]="item.path"
                (click)="open.emit(item.path)"
              >
                <lucide-angular
                  [img]="folderIcon"
                  [size]="16"
                  class="ptah-recents__icon"
                  aria-hidden="true"
                />
                <span class="ptah-recents__text">
                  <span class="ptah-recents__name">{{ item.name }}</span>
                  <!-- Separators keep the computed name readable; Angular
                       drops the whitespace between these spans. -->
                  <span class="sr-only">, </span>
                  <span class="ptah-recents__parent">{{ item.parent }}</span>
                  <span class="sr-only">, </span>
                </span>
                <span class="ptah-recents__age tabular-nums">{{
                  item.ageLabel
                }}</span>
              </button>
            </li>
          }
        </ul>
      </nav>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .ptah-recents {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .ptah-recents__title {
        padding: 0 10px 6px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .ptah-recents__list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .ptah-recents__row {
        display: grid;
        grid-template-columns: 20px 1fr auto;
        gap: 12px;
        align-items: center;
        width: 100%;
        height: 40px;
        padding: 0 10px;
        border: 0;
        border-radius: 12px;
        background: none;
        color: oklch(var(--bc) / 0.78);
        font-size: 13.5px;
        text-align: left;
        cursor: pointer;
      }
      .ptah-recents__row:hover {
        background: oklch(var(--bc) / 0.06);
        color: oklch(var(--bc));
      }
      .ptah-recents__row:focus-visible {
        outline: 2px solid oklch(var(--p));
        outline-offset: 2px;
      }
      .ptah-recents__text {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .ptah-recents__name,
      .ptah-recents__parent {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ptah-recents__name {
        color: oklch(var(--bc));
        font-weight: 600;
        line-height: 1.2;
      }
      .ptah-recents__parent {
        font-size: 11.5px;
        color: oklch(var(--bc) / 0.68);
      }
      .ptah-recents__age {
        font-size: 12.5px;
        color: oklch(var(--bc) / 0.68);
      }
    `,
  ],
})
export class RecentWorkspaceListComponent {
  readonly items = input.required<readonly RecentWorkspaceItem[]>();

  /** Emits the full path of the activated row. */
  readonly open = output<string>();

  protected readonly folderIcon = FolderOpen;
  protected readonly titleId = `ptah-recents-title-${nextTitleId++}`;
}
