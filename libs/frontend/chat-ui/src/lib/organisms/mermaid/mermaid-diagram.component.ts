import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, signal, viewChild } from '@angular/core';
import DOMPurify from 'dompurify';
import { ChartNoAxesCombined, Code2, Copy, LucideAngularModule } from 'lucide-angular';
import { MermaidThemeService } from './mermaid-theme.service';

let nextDiagramId = 0;

const SVG_PURIFY_CONFIG = { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['style'] };
const UNSAFE_CSS = /url\(|@import|expression\(|javascript:|<\//i;

export function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, SVG_PURIFY_CONFIG);
}

/** Mermaid's generated, id-scoped stylesheet. Dropped entirely if it could load or execute anything. */
export function extractMermaidCss(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const css = Array.from(doc.querySelectorAll('style'), (style) => style.textContent ?? '').join('\n');
  return UNSAFE_CSS.test(css) ? '' : css;
}

interface RenderedDiagram { svg: string; css: string }

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
        <div #diagramHost class="overflow-x-auto p-3" [class.hidden]="!svg()"></div>
        @if (!svg()) { <div class="p-3 text-sm text-base-content">Rendering diagram…</div> }
      } @else { <pre class="m-0 overflow-x-auto p-3 text-sm"><code>{{ source() }}</code></pre> }
      @if (error()) { <p class="px-3 pb-3 text-sm text-error">Unable to render diagram.</p> }
    </section>
  `,
})
export class MermaidDiagramComponent {
  readonly source = input.required<string>();
  protected readonly svg = signal<RenderedDiagram | null>(null);
  protected readonly error = signal(false);
  protected readonly view = signal<'diagram' | 'code'>('diagram');
  protected readonly DiagramIcon = ChartNoAxesCombined;
  protected readonly CodeIcon = Code2;
  protected readonly CopyIcon = Copy;
  private readonly theme = inject(MermaidThemeService);
  private readonly diagramHost = viewChild<ElementRef<HTMLElement>>('diagramHost');

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
    effect(() => {
      const host = this.diagramHost()?.nativeElement;
      const diagram = this.svg();
      if (!host) return;
      host.replaceChildren();
      if (!diagram) return;
      const fragment = DOMPurify.sanitize(diagram.svg, { ...SVG_PURIFY_CONFIG, RETURN_DOM_FRAGMENT: true });
      const root = fragment.querySelector('svg');
      if (root && diagram.css) {
        const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
        style.textContent = diagram.css;
        root.prepend(style);
      }
      host.append(fragment);
    });
  }

  protected async copy(): Promise<void> { await navigator.clipboard?.writeText(this.source()); }

  private async render(source: string, themeVariables: ReturnType<MermaidThemeService['variables']>): Promise<RenderedDiagram> {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables });
    const { svg } = await mermaid.render(`ptah-mermaid-${nextDiagramId++}`, source);
    return { svg: sanitizeMermaidSvg(svg), css: extractMermaidCss(svg) };
  }
}
