import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import { SurfaceMarkdownPipe } from '@ptah-extension/markdown';
import { MermaidDiagramComponent } from './mermaid-diagram.component';
import { MermaidTextPart, segmentMermaidFences } from './mermaid-fences';

@Component({
  selector: 'ptah-mermaid-message-text', standalone: true,
  imports: [MarkdownModule, SurfaceMarkdownPipe, MermaidDiagramComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@for (part of parts(); track $index) { @if (part.kind === 'markdown') { <markdown [data]="part.text | surfaceMarkdown: active()" /> } @else { <ptah-mermaid-diagram [source]="part.source" /> } }`,
})
export class MermaidMessageTextComponent {
  readonly text = input.required<string>();
  readonly finalized = input.required<boolean>();
  readonly active = input(true);
  protected readonly parts = computed((): readonly MermaidTextPart[] => this.finalized() ? segmentMermaidFences(this.text()) : [{ kind: 'markdown', text: this.text() }]);
}
