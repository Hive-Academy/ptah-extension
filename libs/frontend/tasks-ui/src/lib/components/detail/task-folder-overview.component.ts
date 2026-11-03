import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { ExternalLink, LucideAngularModule } from 'lucide-angular';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import { CARRIER_FILE, type TaskSpecDetail } from '@ptah-extension/shared';

/**
 * The carrier overview: what the machine-owned `task.md` says about the task,
 * kept apart from authored prose such as `context.md`.
 *
 * Shows the canonical folder identity and path, the carrier description, its
 * validation warnings and its markdown body. The folder name IS the task's
 * identity; a frontmatter `id` that disagrees is reported, never adopted.
 *
 * NFR-10: the body renders ONLY through {@link MarkdownBlockComponent} (the
 * DOMPurify chokepoint) with the theme-aware `auto` variant.
 */
@Component({
  selector: 'ptah-task-folder-overview',
  standalone: true,
  imports: [LucideAngularModule, MarkdownBlockComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="bg-surface-2 border border-surface-border rounded-box p-4 flex flex-col gap-3 min-w-0"
      aria-labelledby="task-overview-heading"
      data-testid="task-folder-overview"
    >
      <header
        class="flex flex-wrap items-center gap-2 border-b border-surface-border pb-3"
      >
        <h3
          id="task-overview-heading"
          class="font-mono text-sm font-semibold text-base-content"
        >
          {{ carrierFile }}
        </h3>
        <span class="badge badge-ghost badge-sm text-base-content"
          >Machine-owned carrier</span
        >
        <span class="flex-1"></span>
        @if (carrierOpenable()) {
          <button
            type="button"
            class="btn btn-primary btn-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
            [attr.aria-label]="'Open ' + carrierFile + ' in the editor'"
            data-testid="task-overview-open-editor"
            (click)="openInEditor.emit(carrierFile)"
          >
            Open in editor
            <lucide-angular
              [img]="ExternalLinkIcon"
              class="h-3.5 w-3.5"
              aria-hidden="true"
            />
          </button>
        }
      </header>

      <p
        class="font-mono text-xs text-base-content-muted break-all select-text"
        data-testid="task-overview-path"
      >
        {{ folderPath() }}
      </p>

      @if (idMismatch()) {
        <p
          class="text-xs text-base-content"
          data-testid="task-overview-id-mismatch"
        >
          The carrier's frontmatter id
          <code class="font-mono">{{ detail().id }}</code> differs from its
          folder name. The folder name
          <code class="font-mono">{{ detail().folderName }}</code> is the task's
          identity.
        </p>
      }

      @if (detail().description; as description) {
        <p
          class="text-sm text-base-content"
          data-testid="task-overview-description"
        >
          {{ description }}
        </p>
      }

      <!-- Validation warnings.
           The track key must be unique per ROW, and the field name is not:
           duplicates and relates_to are arrays, so one field carries one
           issue per bad entry. The ref narrows that but is optional AND
           repeats when the same bad entry is listed twice (FR-B4.8 permits
           it), so the position is folded in as well. Anything less throws
           NG0955. -->
      @if (detail().validationIssues.length > 0) {
        <div class="alert alert-warning py-2 px-3 text-xs" role="note">
          <ul class="list-disc pl-4" data-testid="task-detail-issues">
            @for (
              issue of detail().validationIssues;
              track issue.code +
                '|' +
                issue.field +
                '|' +
                (issue.ref ?? '') +
                '|' +
                $index
            ) {
              <li>{{ issue.field }}: {{ issue.message }}</li>
            }
          </ul>
        </div>
      }

      @if (hasBody()) {
        <div class="task-reader-body min-w-0" data-testid="task-overview-body">
          <ptah-markdown-block [content]="detail().body" [variant]="'auto'" />
        </div>
      } @else {
        <p
          class="text-sm text-base-content-muted"
          data-testid="task-overview-empty"
        >
          This file has no readable body.
        </p>
      }
    </section>
  `,
})
export class TaskFolderOverviewComponent {
  public readonly detail = input.required<TaskSpecDetail>();
  /** `task.md` is a present regular file the editor opener accepts. */
  public readonly carrierOpenable = input(false);

  /** Hand the carrier to the editor opener. */
  public readonly openInEditor = output<string>();

  protected readonly carrierFile = CARRIER_FILE;

  /** The canonical location, built from the folder name, never the frontmatter id. */
  protected readonly folderPath = computed(
    () => `.ptah/specs/${this.detail().folderName}/`,
  );

  protected readonly idMismatch = computed(
    () => this.detail().id !== this.detail().folderName,
  );

  protected readonly hasBody = computed(
    () => this.detail().body.trim().length > 0,
  );

  protected readonly ExternalLinkIcon = ExternalLink;
}
