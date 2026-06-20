import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import type { ExecutionNode } from '@ptah-extension/shared';
import { TribunalSurfaceService } from '../services/tribunal-surface.service';

@Component({
  selector: 'ptah-verdict-tile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MarkdownBlockComponent],
  template: `
    <div
      class="flex h-full flex-col gap-2 p-3"
      data-testid="tribunal-verdict"
      aria-label="Tribunal verdict"
    >
      @if (verdict()) {
        <ptah-markdown-block [content]="verdict()" />
      } @else {
        <div
          class="flex h-full flex-col items-center justify-center gap-2 text-center text-base-content/50"
        >
          <span class="loading loading-dots loading-sm"></span>
          <p class="text-xs">Awaiting the cited verdict…</p>
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
export class VerdictTileComponent {
  private readonly surface = inject(TribunalSurfaceService);
  private readonly treeBuilder = inject(ExecutionTreeBuilderService);

  protected readonly verdict = computed<string>(() => {
    const state = this.surface.streamingState();
    if (state.events.size === 0) return '';
    const nodes = this.treeBuilder.buildTree(state, 'tribunal-verdict');
    const text = this.collectAssistantText(nodes).trim();
    return text;
  });

  private collectAssistantText(nodes: readonly ExecutionNode[]): string {
    const parts: string[] = [];
    for (const node of nodes) {
      if (node.type === 'text' && node.content) {
        parts.push(node.content);
      }
      if (node.children.length > 0) {
        const childText = this.collectAssistantText(node.children);
        if (childText) parts.push(childText);
      }
    }
    return parts.join('\n\n');
  }
}
