import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  ExternalLink,
  FileText,
  LucideAngularModule,
  Maximize2,
} from 'lucide-angular';
import type { ArtifactRecord } from '@ptah-extension/shared';

/**
 * ArtifactCardComponent — the transcript card for one published artifact
 * (TASK_2026_710, batch 7).
 *
 * Metadata only (fixed decision: only one live iframe, and it lives in the
 * display panel viewer, never in the transcript). The card shows the title,
 * the created time and two buttons whose meaning the host wires up:
 * `open` selects the artifact's tab in the display panel, `fullscreen` asks
 * for the full-screen viewer. Neither button opens anything itself.
 */
@Component({
  selector: 'ptah-artifact-card',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="flex flex-col gap-2 rounded-box border border-base-content/15 bg-base-200/40 p-3"
      data-testid="artifact-card"
    >
      <header class="flex items-start gap-2">
        <lucide-angular
          [img]="ArtifactIcon"
          class="mt-0.5 h-4 w-4 shrink-0 text-base-content-muted"
          aria-hidden="true"
        />
        <div class="min-w-0 flex-1">
          <p
            class="truncate text-sm font-semibold text-base-content"
            [title]="artifact().title"
            data-testid="artifact-card-title"
          >
            {{ artifact().title }}
          </p>
          <p class="text-xs text-base-content-muted" data-testid="artifact-card-created">
            {{ createdLabel() }}
          </p>
        </div>
      </header>
      <footer class="flex items-center gap-2">
        <button
          type="button"
          class="btn btn-primary btn-xs gap-1"
          (click)="open.emit(artifact().id)"
          data-testid="artifact-card-open"
        >
          <lucide-angular [img]="OpenIcon" class="h-3.5 w-3.5" aria-hidden="true" />
          Open
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs gap-1"
          (click)="fullscreen.emit(artifact().id)"
          data-testid="artifact-card-fullscreen"
        >
          <lucide-angular [img]="FullscreenIcon" class="h-3.5 w-3.5" aria-hidden="true" />
          Full screen
        </button>
      </footer>
    </article>
  `,
})
export class ArtifactCardComponent {
  /** The immutable record this card represents. */
  readonly artifact = input.required<ArtifactRecord>();

  /** The user asked to open this artifact in the display panel viewer. */
  readonly open = output<string>();
  /** The user asked for the full-screen viewer of this artifact. */
  readonly fullscreen = output<string>();

  protected readonly ArtifactIcon = FileText;
  protected readonly OpenIcon = ExternalLink;
  protected readonly FullscreenIcon = Maximize2;

  /** The created time in the host's locale; the ISO string is never shown. */
  protected readonly createdLabel = computed(
    () => `Created ${new Date(this.artifact().createdAt).toLocaleString()}`,
  );
}