import {
  Component,
  computed,
  input,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, Archive } from 'lucide-angular';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import { ExpandableContentComponent } from '../../atoms/expandable-content.component';

@Component({
  selector: 'ptah-compaction-marker',
  standalone: true,
  imports: [
    LucideAngularModule,
    MarkdownBlockComponent,
    ExpandableContentComponent,
  ],
  template: `
    <div class="alert shadow-sm mb-4 py-2 px-3 flex-col items-start gap-2">
      <div class="flex items-center gap-2 w-full">
        <lucide-angular [img]="ArchiveIcon" class="w-4 h-4 flex-shrink-0" />
        <div class="flex-1 min-w-0">
          <h3 class="font-bold text-sm">Context compacted</h3>
          @if (tokenLine(); as line) {
            <p class="text-xs opacity-70">{{ line }}</p>
          }
        </div>
      </div>

      @if (summary(); as text) {
        <ptah-expandable-content
          [content]="text"
          [isExpanded]="expanded()"
          (toggleClicked)="toggle()"
        />
        @if (expanded()) {
          <div class="w-full text-xs">
            <ptah-markdown-block [content]="text" />
          </div>
        }
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactionMarkerComponent {
  readonly summary = input<string | null>(null);
  readonly preTokens = input<number | null>(null);
  readonly postTokens = input<number | null>(null);
  readonly durationMs = input<number | null>(null);

  protected readonly ArchiveIcon = Archive;
  private readonly _expanded = signal(false);
  protected readonly expanded = this._expanded.asReadonly();

  protected readonly tokenLine = computed<string | null>(() => {
    const pre = this.preTokens();
    const post = this.postTokens();
    if (pre === null || post === null) return null;
    const base = `shrank ${this.format(pre)} → ${this.format(post)} tokens`;
    const ms = this.durationMs();
    if (ms === null) return base;
    return `${base} in ${this.formatDuration(ms)}`;
  });

  protected toggle(): void {
    this._expanded.update((v) => !v);
  }

  private format(value: number): string {
    return value.toLocaleString();
  }

  private formatDuration(ms: number): string {
    const seconds = ms / 1000;
    return `${Math.round(seconds * 10) / 10}s`;
  }
}
