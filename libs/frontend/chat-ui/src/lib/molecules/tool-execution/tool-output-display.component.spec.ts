import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import type {
  ExecutionNode,
  NodeRetentionNotice,
} from '@ptah-extension/shared';
import { ToolOutputDisplayComponent } from './tool-output-display.component';

/**
 * Rendering spec for the retention marker on the OUTPUT section.
 *
 * The marker exists so a bounded transcript is distinguishable from data
 * corruption, which means the interesting case is the one where NOTHING
 * survived: no `toolOutput` at all. These cases pin that the marker escapes the
 * content guard, that its copy is honest about what recovery is available, and
 * that a node without `retention` renders exactly as it always did.
 */
describe('ToolOutputDisplayComponent — retention marker', () => {
  let fixture: ComponentFixture<ToolOutputDisplayComponent>;

  function node(partial: Partial<ExecutionNode>): ExecutionNode {
    return {
      id: 'n1',
      type: 'tool',
      status: 'complete',
      content: null,
      children: [],
      startTime: 0,
      toolName: 'Bash',
      ...partial,
    } as ExecutionNode;
  }

  function retention(
    partial: Partial<NodeRetentionNotice> = {},
  ): NodeRetentionNotice {
    return {
      droppedChars: 12_345,
      capped: ['toolOutput'],
      foldFailed: false,
      ...partial,
    };
  }

  function render(partial: Partial<ExecutionNode>): HTMLElement {
    fixture.componentRef.setInput('node', node(partial));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /** The marker is the only warning-tinted block this component renders. */
  function marker(host: HTMLElement): HTMLElement | null {
    return host.querySelector<HTMLElement>('[class*="bg-warning/10"]');
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToolOutputDisplayComponent],
      providers: [provideMarkdown()],
    }).compileComponents();
    fixture = TestBed.createComponent(ToolOutputDisplayComponent);
  });

  describe('no retention field', () => {
    it('renders no marker and leaves the output section untouched', () => {
      const host = render({ toolOutput: 'ok\n' });

      expect(marker(host)).toBeNull();
      expect(host.textContent).toContain('Output');
      expect(host.textContent).not.toMatch(/truncated|could not be preserved/i);
    });

    it('renders nothing at all when there is no output and no retention', () => {
      const host = render({});

      expect(marker(host)).toBeNull();
      expect(host.textContent?.trim()).toBe('');
    });
  });

  describe('retention present', () => {
    it('renders the marker with the dropped-character count', () => {
      const host = render({
        toolOutput: 'the surviving head…',
        retention: retention({ droppedChars: 12_345 }),
      });

      const el = marker(host);
      expect(el).not.toBeNull();
      expect(el?.textContent).toContain('Output truncated');
      // Locale-grouped, so assert on the component's own formatting.
      expect(el?.textContent).toContain((12345).toLocaleString());
    });

    it('renders OUTSIDE the content guard — no toolOutput, marker still shown', () => {
      // The case the marker exists for: the fold preserved nothing, so the
      // `@if (node().toolOutput || editInput())` guard is false and there is no
      // payload to hang the notice off.
      const host = render({ retention: retention() });

      // The "Output" header lives inside the guard; the marker does not.
      expect(host.querySelector('[class*="font-semibold"]')).toBeNull();
      expect(marker(host)).not.toBeNull();
      expect(marker(host)?.textContent).toContain('truncated');
    });

    it('ignores a retention notice that only capped the input', () => {
      const host = render({
        toolOutput: 'untouched',
        retention: retention({ capped: ['toolInput'] }),
      });

      expect(marker(host)).toBeNull();
    });
  });

  describe('foldFailed copy', () => {
    it('states the content could not be preserved at all', () => {
      const host = render({
        retention: retention({
          foldFailed: true,
          droppedChars: 0,
          reason: 'it contained a circular reference',
        }),
      });

      const text = marker(host)?.textContent ?? '';
      expect(text).toContain('Output could not be preserved');
      expect(text).toContain('it contained a circular reference');
      // Must not imply a partial view is on screen.
      expect(text).not.toContain('truncated');
    });

    it('falls back to a generic reason when none was recorded', () => {
      const host = render({
        retention: retention({ foldFailed: true, reason: undefined }),
      });

      expect(marker(host)?.textContent).toContain(
        'could not be converted to text',
      );
    });
  });

  describe('recovery copy', () => {
    it('promises only the transcript reload, and names its limit', () => {
      const host = render({ retention: retention() });
      const text = marker(host)?.textContent ?? '';

      expect(text).toContain("this session's transcript on disk");
      expect(text).toContain('reopen the session to reload it');
      expect(text).toContain('before the last compaction');
    });

    it('promises no click-to-expand and no re-fetch', () => {
      // Mirrors the write-side assertion in
      // chat-streaming/src/lib/execution-tree-retention.spec.ts.
      const text =
        marker(render({ retention: retention() }))?.textContent ?? '';

      expect(text).not.toContain('click to expand');
      expect(text).not.toMatch(/re-?fetch/i);
    });
  });

  describe('accessibility', () => {
    it('is real text in the flow — not aria-hidden and not title-only', () => {
      const host = render({ retention: retention() });
      const el = marker(host);

      expect(el).not.toBeNull();
      expect(el?.getAttribute('aria-hidden')).toBeNull();
      expect(el?.hasAttribute('title')).toBe(false);
      expect(el?.hasAttribute('hidden')).toBe(false);
      // The text is in the accessible name path because it IS the text node.
      expect(el?.textContent?.trim().length).toBeGreaterThan(0);
      // And it survives up the ancestor chain to the host.
      expect(host.textContent).toContain('Output truncated');
    });

    it('has no aria-hidden ancestor between the marker and the host', () => {
      const host = render({ retention: retention() });

      let current = marker(host)?.parentElement ?? null;
      while (current && current !== host) {
        expect(current.getAttribute('aria-hidden')).toBeNull();
        current = current.parentElement;
      }
    });
  });

  describe('coexistence with the error alert', () => {
    it('renders both the marker and the error, in that order', () => {
      const host = render({ retention: retention(), error: 'exit code 1' });

      expect(marker(host)).not.toBeNull();
      expect(host.textContent).toContain('exit code 1');
    });
  });
});
