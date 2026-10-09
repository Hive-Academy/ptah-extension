import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import DOMPurify from 'dompurify';
import { extractMermaidCss, sanitizeMermaidSvg } from './mermaid-diagram.component';
import { MermaidMessageTextComponent } from './mermaid-message-text.component';
import { segmentMermaidFences } from './mermaid-fences';

const render = jest.fn();
const initialize = jest.fn();

jest.mock('mermaid', () => ({
  __esModule: true,
  default: { initialize, render },
}));

@Component({
  standalone: true,
  imports: [MermaidMessageTextComponent],
  template: `<ptah-mermaid-message-text [text]="text()" [finalized]="finalized()" />`,
})
class HostComponent {
  readonly text = signal('');
  readonly finalized = signal(false);
}

describe('Mermaid chat fences', () => {
  let fixture: ComponentFixture<HostComponent>;

  async function show(text: string, finalized: boolean): Promise<HTMLElement> {
    fixture.componentInstance.text.set(text);
    fixture.componentInstance.finalized.set(finalized);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    render.mockReset();
    initialize.mockReset();
    render.mockResolvedValue({ svg: '<svg><style>.node { fill: red; }</style><text>diagram</text></svg>' });
    TestBed.configureTestingModule({ providers: [provideMarkdown()] });
    fixture = TestBed.createComponent(HostComponent);
  });

  it('detects only complete Mermaid fences at column zero', () => {
    expect(segmentMermaidFences('before\n```mermaid\nflowchart TD\n  A-->B\n```\nafter')).toEqual([
      { kind: 'markdown', text: 'before\n' },
      { kind: 'diagram', source: 'flowchart TD\n  A-->B', ordinal: 0 },
      { kind: 'markdown', text: 'after' },
    ]);
    expect(segmentMermaidFences('  ```mermaid\nflowchart TD\n```')).toEqual([
      { kind: 'markdown', text: '  ```mermaid\nflowchart TD\n```' },
    ]);
  });

  it('keeps Mermaid source as an ordinary code block while streaming', async () => {
    const native = await show('```mermaid\nflowchart TD\n  A-->B\n```', false);
    expect(native.querySelector('ptah-mermaid-diagram')).toBeNull();
    expect(native.querySelector('markdown code')?.textContent).toContain('flowchart TD');
    expect(render).not.toHaveBeenCalled();
  });

  it('renders a finalized Mermaid block after the dynamic import resolves', async () => {
    const native = await show('```mermaid\nflowchart TD\n  A-->B\n```', true);
    expect(native.querySelector('ptah-mermaid-diagram svg')).not.toBeNull();
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ startOnLoad: false, securityLevel: 'strict' }));
  });

  it('falls back to source and one short error line for invalid syntax', async () => {
    render.mockRejectedValueOnce(new Error('parse error'));
    const native = await show('```mermaid\nnot valid\n```', true);
    expect(native.querySelector('pre code')?.textContent).toContain('not valid');
    expect(native.querySelector('.text-error')?.textContent).toBe('Unable to render diagram.');
  });

  it('sanitizes generated SVG before binding it', () => {
    const sanitize = jest.spyOn(DOMPurify, 'sanitize');
    const svg = sanitizeMermaidSvg('<svg><style>.node { fill: red; }</style><script>alert(1)</script><text>safe</text></svg>');
    expect(sanitize).toHaveBeenCalledWith(expect.stringContaining('<script>'), expect.objectContaining({ USE_PROFILES: expect.any(Object) }));
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('<style>');
    expect(svg).toContain('<text>safe</text>');
    sanitize.mockRestore();
  });

  it('keeps Mermaid scoped CSS but drops CSS that can load resources', () => {
    expect(extractMermaidCss('<svg><style>#d .node { fill: red; }</style></svg>')).toContain('fill: red');
    expect(extractMermaidCss('<svg><style>.n { background: url(https://x) }</style></svg>')).toBe('');
    expect(extractMermaidCss('<svg><style>@import "https://x";</style></svg>')).toBe('');
  });
});
