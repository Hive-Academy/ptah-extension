import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { FileDecision } from '@ptah-extension/shared';
import { DiffDisclosureComponent } from './diff-disclosure.component';
import { KeepReplaceControlComponent } from './keep-replace-control.component';
import {
  LIBRARY_COPY_EDITED_NOTE,
  UNCHANGED_SINCE_WIZARD_NOTE,
  UNREADABLE_NOTE,
  hasControl,
  stateBadge,
  type DecisionRow,
} from './preview-decisions.state';

let nextRowNoteId = 0;

/**
 * C2 FileDecisionRow: path, state badge, notes, the keep/replace control and
 * "What changes".
 *
 * New and already-current files get no control. An unreadable file shows the
 * forced-keep explanation, which the control references through
 * `aria-describedby`. Per-agent notes from the surface (the model line, C6)
 * are projected between the head and the notes.
 */
@Component({
  selector: 'ptah-file-decision-row',
  standalone: true,
  imports: [KeepReplaceControlComponent, DiffDisclosureComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="mb-1.5 rounded-lg border border-surface-border bg-surface-1 px-2.5 py-2 text-xs"
      data-testid="file-decision-row"
    >
      <div class="flex flex-wrap items-center gap-2">
        <code
          class="min-w-[140px] flex-1 font-mono [overflow-wrap:anywhere] max-sm:basis-full"
          >{{ row().path }}</code
        >
        <span
          class="badge badge-ghost badge-sm whitespace-nowrap"
          data-testid="file-state-badge"
          >{{ badge() }}</span
        >
      </div>
      <ng-content />
      @if (row().unchangedSinceWizardWrite && row().state === 'exists') {
        <p
          class="mt-1 text-[11px] text-base-content-muted [overflow-wrap:anywhere]"
          data-testid="unchanged-note"
        >
          {{ unchangedNote }}
        </p>
      }
      @if (row().libraryCopyEdited && isElectron()) {
        <p
          class="mt-1 text-[11px] text-base-content-muted [overflow-wrap:anywhere]"
          data-testid="library-note"
        >
          {{ libraryNote }}
        </p>
      }
      @if (row().forcedKeep) {
        <p
          class="mt-1 text-[11px] text-base-content-muted [overflow-wrap:anywhere]"
          data-testid="unreadable-note"
          [id]="noteId"
        >
          {{ unreadableNote }}
        </p>
      }
      @if (showControl()) {
        <div class="mt-1.5 flex flex-wrap items-center gap-2">
          <ptah-keep-replace-control
            [path]="row().path"
            [kind]="row().kind"
            [decision]="row().decision"
            [forcedKeep]="row().forcedKeep"
            [disabled]="disabled()"
            [describedBy]="row().forcedKeep ? noteId : null"
            (decisionChange)="decisionChange.emit($event)"
          />
          @if (!row().forcedKeep) {
            <ptah-diff-disclosure
              [mode]="row().kind === 'pack' ? 'diff' : 'unavailable'"
              [fileName]="row().path"
              [original]="row().localText"
              [modified]="row().incomingText"
            />
          }
        </div>
      }
    </div>
  `,
})
export class FileDecisionRowComponent {
  public readonly row = input.required<DecisionRow>();
  /** Electron shows the Library-copy note; VS Code has no Library (D3). */
  public readonly isElectron = input(true);
  /** Disabled while the comparison reloads. */
  public readonly disabled = input(false);

  public readonly decisionChange = output<FileDecision>();

  protected readonly noteId = `ptah-file-note-${++nextRowNoteId}`;
  protected readonly unchangedNote = UNCHANGED_SINCE_WIZARD_NOTE;
  protected readonly libraryNote = LIBRARY_COPY_EDITED_NOTE;
  protected readonly unreadableNote = UNREADABLE_NOTE;

  protected readonly badge = computed(() => stateBadge(this.row()));
  protected readonly showControl = computed(() => hasControl(this.row()));
}
