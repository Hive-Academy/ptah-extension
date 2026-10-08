import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import DOMPurify from 'dompurify';
import { ChartNoAxesCombined, Code2, Copy, LucideAngularModule } from 'lucide-angular';
import { MermaidThemeService } from './mermaid-theme.service';

let nextDiagramId = 0;

export function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['style'] });
}

@Component({
  selector: 'ptah-mermaid-diagram', standalone: true, imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="not-prose my-3 overflow-hidden rounded-lg border border-base-300 bg-base-100" aria-label="Mermaid diagram">
      <div class="flex items-center justify-between gap-2 border-b border-base-300 bg-base-200 px-2 py-1.5">
        <div class="join" role="group" aria-label="Diagram display mode">
          <button type="button" class="btn btn-xs join-item" [class.btn-active]="view() === 'diagram'" [attr.aria-pressed]="view() === 'diagram'" (click)="view.set('diagram')"><lucide-angular [img]="DiagramIcon" class="h-3.5 w-3.5" /> Diagram</button>
          <button type="button" class="btn btn-xs join-item" [class.btn-active]="view() === 'code'" [attr.aria-pressed]="view() === 'code'" (click)="view.set('code')"><lucide-angular [img]="CodeIcon" class="h-3.5 w-3.5" /> Code</button>
        </div>
        <button type="button" class="btn btn-ghost btn-xs" (click)="copy()" aria-label="Copy Mermaid source"><lucide-angular [img]="CopyIcon" class="h-3.5 w-3.5" /> Copy</button>
      </div>
      @if (view() === 'diagram' && !error()) {
        @if (svg(); as diagram) { <div class="overflow-x-auto p-3" [innerHTML]="diagram"></div> }
        @else { <div class="p-3 text-sm text-base-content">Rendering diagram…</div> }
      } @else { <pre class="m-0 overflow-x-auto p-3 text-sm"><code>{{ source() }}</code></pre> }
      @if (error()) { <p class="px-3 pb-3 text-sm text-error">Unable to render diagram.</p> }
    </section>
  `,
})
export class MermaidDiagramComponent {
  readonly source = input.required<string>();
  protected readonly svg = signal<SafeHtml | null>(null);
  protected readonly error = signal(false);
  protected readonly view = signal<'diagram' | 'code'>('diagram');
  protected readonly DiagramIcon = ChartNoAxesCombined;
  protected readonly CodeIcon = Code2;
  protected readonly CopyIcon = Copy;
  private readonly theme = inject(MermaidThemeService);
  private readonly sanitizer = inject(DomSanitizer);

  constructor() {
    effect((onCleanup) => {
      const source = this.source();
      const themeVariables = this.theme.variables();
      let cancelled = false;
      this.svg.set(null); this.error.set(false);
      void this.render(source, themeVariables).then(
        (svg) => { if (!cancelled) this.svg.set(svg); },
        () => { if (!cancelled) { this.error.set(true); this.view.set('code'); } },
      );
      onCleanup(() => (cancelled = true));
    });
  }

  protected async copy(): Promise<void> { await navigator.clipboard?.writeText(this.source()); }

  private async render(source: string, themeVariables: ReturnType<MermaidThemeService['variables']>): Promise<SafeHtml> {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables });
    const { svg } = await mermaid.render(`ptah-mermaid-${nextDiagramId++}`, source);
    // DOMPurify establishes the SVG safety boundary before Angular is told to retain its style tag.
    return this.sanitizer.bypassSecurityTrustHtml(sanitizeMermaidSvg(svg));
  }
}
