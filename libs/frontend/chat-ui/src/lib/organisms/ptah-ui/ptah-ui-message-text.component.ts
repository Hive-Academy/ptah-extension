import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import { SurfaceMarkdownPipe } from '@ptah-extension/markdown';
import { segmentPtahUi } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { TurnSourceSnapshot } from '@ptah-extension/shared';
import { PtahUiBlockComponent } from './ptah-ui-block.component';
import { MermaidDiagramComponent } from '../mermaid/mermaid-diagram.component';
import { segmentMermaidFences } from '../mermaid/mermaid-fences';

/** One rendered part of the message text, keyed for a stable `@for` track. */
type PtahUiTextPart =
  | { readonly kind: 'markdown'; readonly track: string; readonly text: string }
  | {
      readonly kind: 'block';
      readonly track: string;
      readonly ordinal: number;
      readonly raw: string;
      readonly body: string;
    }
  | { readonly kind: 'mermaid'; readonly track: string; readonly source: string };

/**
 * PtahUiMessageTextComponent - assistant text with in-place `ptah-ui` blocks
 * (TASK_2026_610, component 9, decisions 1 and 11).
 *
 * Re-segments the raw text on every change (one string per painted frame
 * while streaming). Markdown parts go through the same `<markdown>` +
 * `surfaceMarkdown` path as the execution node's text branch; closed fences
 * become `ptah-ui-block`s. Track keys are `md:<n>` (n-th markdown part) and
 * `ui:<ordinal>`, so a closed block keeps its instance however much text
 * streams after it, and an open fence stays inside the trailing markdown part
 * as an ordinary code block until its closing line arrives.
 */
@Component({
  selector: 'ptah-ui-message-text',
  standalone: true,
  imports: [MarkdownModule, SurfaceMarkdownPipe, PtahUiBlockComponent, MermaidDiagramComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (part of parts(); track part.track) {
      @if (part.kind === 'markdown') {
        <markdown [data]="part.text | surfaceMarkdown: active()" />
      } @else if (part.kind === 'block') {
        <ptah-ui-block
          [raw]="part.raw"
          [body]="part.body"
          [ordinal]="part.ordinal"
          [messageId]="messageId()"
          [nodeId]="nodeId()"
          [orderKey]="orderKey()"
          [active]="active()"
          [snapshot]="snapshot()"
        />
      } @else {
        <ptah-mermaid-diagram [source]="part.source" />
      }
    }
  `,
})
export class PtahUiMessageTextComponent {
  /** Raw text of the assistant text node (the throttled `renderedContent()`). */
  readonly text = input.required<string>();
  readonly messageId = input.required<string>();
  readonly nodeId = input.required<string>();
  /** Transcript order of the message; higher is newer. */
  readonly orderKey = input.required<number>();
  readonly active = input(true);
  readonly snapshot = input<TurnSourceSnapshot | null>(null);
  readonly finalized = input(false);

  protected readonly parts = computed((): readonly PtahUiTextPart[] => {
    let markdownIndex = 0;
    let mermaidIndex = 0;
    return segmentPtahUi(this.text()).flatMap((segment): readonly PtahUiTextPart[] => {
      if (segment.kind === 'markdown') {
        const parts = this.finalized()
          ? segmentMermaidFences(segment.text)
          : [{ kind: 'markdown' as const, text: segment.text }];
        return parts.map((part): PtahUiTextPart =>
          part.kind === 'markdown'
            ? { kind: 'markdown', track: `md:${markdownIndex++}`, text: part.text }
            : { kind: 'mermaid', track: `mermaid:${mermaidIndex++}`, source: part.source },
        );
      }
      return [{
            kind: 'block',
            track: `ui:${segment.ordinal}`,
            ordinal: segment.ordinal,
            raw: segment.raw,
            body: segment.body,
          }];
    });
  });
}
