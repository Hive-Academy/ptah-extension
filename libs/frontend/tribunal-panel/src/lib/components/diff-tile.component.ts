import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import { TribunalStateService } from '../services/tribunal-state.service';
import type { ForgeDiff, VendorLane } from '../types/tribunal-ui.types';

@Component({
  selector: 'ptah-diff-tile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MarkdownBlockComponent],
  template: `
    <div
      class="flex h-full flex-col gap-3 overflow-auto p-3"
      data-testid="tribunal-diff"
      [attr.aria-label]="'Forge diff for ' + lane().displayName"
    >
      @if (diff(); as d) {
        @if (d.summary) {
          <section class="flex flex-col gap-1">
            <span
              class="text-[11px] font-semibold uppercase tracking-wide text-base-content/45"
              >Implementation</span
            >
            <ptah-markdown-block [content]="d.summary" />
          </section>
        }

        <section class="flex flex-col gap-1">
          <span
            class="text-[11px] font-semibold uppercase tracking-wide text-base-content/45"
            >Diff</span
          >
          @if (diffMarkdown()) {
            <ptah-markdown-block [content]="diffMarkdown()" />
          } @else {
            <p class="text-xs text-base-content/40">No diff produced.</p>
          }
        </section>

        @if (d.reviewNotes) {
          <section class="flex flex-col gap-1">
            <span
              class="text-[11px] font-semibold uppercase tracking-wide text-base-content/45"
              >Cross-review</span
            >
            <ptah-markdown-block [content]="d.reviewNotes" />
          </section>
        }
      } @else {
        <div
          class="flex h-full flex-col items-center justify-center gap-2 text-center text-base-content/50"
        >
          <span class="loading loading-dots loading-sm"></span>
          <p class="text-xs">Building {{ lane().displayName }}'s worktree…</p>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
    `,
  ],
})
export class DiffTileComponent {
  readonly lane = input.required<VendorLane>();

  private readonly state = inject(TribunalStateService);

  protected readonly diff = computed<ForgeDiff | null>(
    () => this.state.diffForLane(this.lane().laneId) ?? null,
  );

  protected readonly diffMarkdown = computed<string>(() => {
    const text = this.diff()?.diff?.trim() ?? '';
    if (!text) return '';
    if (text.startsWith('```')) return text;
    return '```diff\n' + text + '\n```';
  });
}
