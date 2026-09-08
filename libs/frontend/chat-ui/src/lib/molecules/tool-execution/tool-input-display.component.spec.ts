import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import type {
  ExecutionNode,
  NodeRetentionNotice,
} from '@ptah-extension/shared';
import { ToolInputDisplayComponent } from './tool-input-display.component';

/**
 * Rendering spec for the retention marker on the INPUT section.
 *
 * Same contract as the output side: the marker must render even when the fold
 * preserved nothing, because "no parameters and no explanation" is
 * indistinguishable from a bug.
 */
describe('ToolInputDisplayComponent — retention marker', () => {
  let fixture: ComponentFixture<ToolInputDisplayComponent>;

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
      droppedChars: 8_192,
      capped: ['toolInput'],
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
      imports: [ToolInputDisplayComponent],
      providers: [provideMarkdown()],
    }).compileComponents();
    fixture = TestBed.createComponent(ToolInputDisplayComponent);
  });

  describe('no retention field', () => {
    it('renders no marker and leaves the input section untouched', () => {
      const host = render({ toolInput: { command: 'ls -la' } });

      expect(marker(host)).toBeNull();
      expect(host.querySelector('button')?.textContent).toContain('Input');
      expect(host.textContent).not.toMatch(/truncated|could not be preserved/i);
    });

    it('renders nothing at all when the input is trivial and retention absent', () => {
      const host = render({
        toolName: 'Read',
        toolInput: { file_path: '/tmp/a.ts' },
      });

      expect(marker(host)).toBeNull();
      expect(host.textContent?.trim()).toBe('');
    });
  });

  describe('retention present', () => {
    it('renders the marker with the dropped-character count', () => {
      const host = render({
        toolInput: { command: 'the surviving head…' },
        retention: retention({ droppedChars: 8_192 }),
      });

      const el = marker(host);
      expect(el).not.toBeNull();
      expect(el?.textContent).toContain('Input truncated');
      expect(el?.textContent).toContain((8192).toLocaleString());
    });

    it('renders OUTSIDE the hasNonTrivialInput guard — no toolInput, marker still shown', () => {
      // A fold that preserved nothing leaves no parameters to display, so the
      // guard is false. That is exactly the case the marker exists for.
      const host = render({ retention: retention() });

      expect(host.querySelector('button')).toBeNull();
      expect(marker(host)).not.toBeNull();
      expect(marker(host)?.textContent).toContain('truncated');
    });

    it('ignores a retention notice that only capped the output', () => {
      const host = render({
        toolInput: { command: 'ls' },
        retention: retention({ capped: ['toolOutput'] }),
      });

      expect(marker(host)).toBeNull();
    });

    it('renders on both sections when both payloads were capped', () => {
      const host = render({
        retention: retention({ capped: ['toolInput', 'toolOutput'] }),
      });

      expect(marker(host)?.textContent).toContain('Input truncated');
    });
  });

  describe('foldFailed copy', () => {
    it('states the content could not be preserved at all', () => {
      const host = render({
        retention: retention({
          foldFailed: true,
          droppedChars: 0,
          reason: 'a getter threw',
        }),
      });

      const text = marker(host)?.textContent ?? '';
      expect(text).toContain('Input could not be preserved');
      expect(text).toContain('a getter threw');
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
      const text =
        marker(render({ retention: retention() }))?.textContent ?? '';

      expect(text).toContain("this session's transcript on disk");
      expect(text).toContain('reopen the session to reload it');
      expect(text).toContain('before the last compaction');
    });

    it('promises no click-to-expand and no re-fetch', () => {
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
      expect(el?.textContent?.trim().length).toBeGreaterThan(0);
      expect(host.textContent).toContain('Input truncated');
    });

    it('has no aria-hidden ancestor between the marker and the host', () => {
      const host = render({ retention: retention() });

      let current = marker(host)?.parentElement ?? null;
      while (current && current !== host) {
        expect(current.getAttribute('aria-hidden')).toBeNull();
        current = current.parentElement;
      }
    });

    it('is visible without expanding the collapsed Input section', () => {
      // The Input body starts collapsed; the marker must not be trapped inside
      // it, or the user who never expands never learns the payload was cut.
      const host = render({
        toolInput: { command: 'ls' },
        retention: retention(),
      });

      expect(fixture.componentInstance.isInputCollapsed()).toBe(true);
      expect(marker(host)).not.toBeNull();
    });
  });
});
