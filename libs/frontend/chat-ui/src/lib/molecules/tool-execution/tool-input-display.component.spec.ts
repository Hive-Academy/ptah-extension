import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Clipboard } from '@angular/cdk/clipboard';
import { VSCodeService } from '@ptah-extension/core';
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
      providers: [provideSurfaceActiveTesting(), provideMarkdown()],
    }).compileComponents();
    fixture = TestBed.createComponent(ToolInputDisplayComponent);
  });

  it.each(['/tmp/source.ts', undefined])(
    'contains fenced HTML in expanded Write input with path %s',
    async (filePath) => {
      const content =
        'a'.repeat(201) + '\n```html\n<div class="fixed">x</div>\n```';
      fixture.componentInstance.isInputCollapsed.set(false);
      fixture.componentInstance.isContentExpanded.set(true);
      const host = render({
        toolName: 'Write',
        toolInput: filePath ? { file_path: filePath, content } : { content },
      });
      await fixture.whenStable();

      expect(host.querySelectorAll('pre code')).toHaveLength(1);
      expect(host.querySelector('pre code')?.textContent).toBe(content + '\n');
      expect(host.querySelector('div.fixed')).toBeNull();
    },
  );

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

/** Classes that would let a block scroll sideways (decision #119, R9.5). */
const HORIZONTAL_SCROLL =
  '.overflow-x-auto, .overflow-x-scroll, .whitespace-nowrap';

describe.each([true, false])(
  'ToolInputDisplayComponent — full command, Write preview and wrapping (isElectron=%s)',
  (isElectron) => {
    let fixture: ComponentFixture<ToolInputDisplayComponent>;
    let copyMock: jest.Mock<boolean, [string]>;

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

    /** Renders with the Input section open. */
    function renderOpen(partial: Partial<ExecutionNode>): HTMLElement {
      fixture.componentRef.setInput('node', node(partial));
      fixture.componentInstance.isInputCollapsed.set(false);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    const lines = (count: number): string =>
      Array.from({ length: count }, (_, i) => `const line${i} = ${i};`).join(
        '\n',
      );

    function write(content: string): Partial<ExecutionNode> {
      return {
        toolName: 'Write',
        toolInput: { file_path: '/repo/src/source.ts', content },
      };
    }

    function previewToggle(host: HTMLElement): HTMLButtonElement | null {
      return host.querySelector<HTMLButtonElement>(
        '[data-testid="write-preview"] button[aria-expanded]',
      );
    }

    function previewBlock(host: HTMLElement): HTMLElement {
      return host.querySelector(
        '[data-testid="write-preview"] [role="region"]',
      ) as HTMLElement;
    }

    function escape(target: HTMLElement): KeyboardEvent {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      jest.spyOn(event, 'stopPropagation');
      target.dispatchEvent(event);
      fixture.detectChanges();
      return event;
    }

    beforeEach(async () => {
      copyMock = jest.fn().mockReturnValue(true);
      await TestBed.configureTestingModule({
        imports: [ToolInputDisplayComponent],
        providers: [
          provideSurfaceActiveTesting(),
          provideMarkdown(),
          { provide: Clipboard, useValue: { copy: copyMock } },
          { provide: VSCodeService, useValue: { isElectron } },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent(ToolInputDisplayComponent);
    });

    it('exposes the Input toggle state with aria-expanded', () => {
      fixture.componentRef.setInput(
        'node',
        node({ toolInput: { command: 'ls' } }),
      );
      fixture.detectChanges();
      const toggle = (fixture.nativeElement as HTMLElement).querySelector(
        'button',
      ) as HTMLButtonElement;

      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      toggle.click();
      fixture.detectChanges();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });

    it('shows the full Bash command, never cut to 60 characters (R7.2)', () => {
      const command =
        'npx nx test @ptah-extension/chat-ui ' + '--flag '.repeat(20).trim();
      const host = renderOpen({ toolInput: { command } });

      expect(host.textContent).toContain(command);
      expect(host.textContent).not.toContain('...');
    });

    it('keeps the 60-character rule for other parameters', () => {
      const description = 'd'.repeat(80);
      const host = renderOpen({ toolInput: { command: 'ls', description } });

      expect(host.textContent).toContain('d'.repeat(60) + '...');
      expect(host.textContent).not.toContain('d'.repeat(61));
    });

    it('shows short Write content in full (R7.7)', () => {
      const content = 'w'.repeat(150);
      const host = renderOpen(write(content));

      expect(host.textContent).toContain(content);
      expect(host.querySelector('[data-testid="write-preview"]')).toBeNull();
    });

    it.each([
      ['Edit', { file_path: '/a.ts', old_string: 'a', new_string: 'b' }],
      ['TodoWrite', { todos: [] }],
      ['Read', { file_path: '/a.ts' }],
    ] as const)('hides the trivial %s input', (toolName, toolInput) => {
      fixture.componentRef.setInput('node', node({ toolName, toolInput }));
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe(
        '',
      );
    });

    it('renders the Write preview with a language label, line count, copy and a labelled focusable block', () => {
      const content = lines(30);
      const host = renderOpen(write(content));

      expect(
        host
          .querySelector('[data-testid="write-preview-language"]')
          ?.textContent?.trim(),
      ).toBe('TypeScript');
      expect(
        host
          .querySelector('[data-testid="write-preview-lines"]')
          ?.textContent?.replace(/\s+/g, ' ')
          .trim(),
      ).toBe('30 lines');

      const block = previewBlock(host);
      expect(block.getAttribute('tabindex')).toBe('0');
      expect(block.getAttribute('aria-label')).toBe('Write content: source.ts');

      const copy = host.querySelector(
        '[data-testid="write-preview"] button[aria-label="Copy content"]',
      ) as HTMLButtonElement;
      copy.click();
      expect(copyMock).toHaveBeenCalledWith(content);
    });

    it('limits a long preview, then toggles "Show all N lines" with aria-expanded', async () => {
      const host = renderOpen(write(lines(30)));
      await fixture.whenStable();
      const toggle = previewToggle(host) as HTMLButtonElement;
      const block = previewBlock(host);

      expect(toggle.textContent?.trim()).toBe('Show all 30 lines');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.getAttribute('aria-controls')).toBe(block.id);
      expect(block.classList).toContain('is-clipped');
      // Clipped text stays in the accessibility tree.
      expect(block.textContent).toContain('const line29 = 29;');

      toggle.click();
      fixture.detectChanges();
      expect(toggle.textContent?.trim()).toBe('Show less');
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(block.classList).not.toContain('is-clipped');
      expect(block.classList).toContain('max-h-96');
      expect(block.classList).toContain('overflow-y-auto');
    });

    it('shows no toggle for a preview that fits the limit', () => {
      const content = Array.from({ length: 3 }, () => 'y'.repeat(80)).join(
        '\n',
      );
      const host = renderOpen(write(content));

      expect(previewToggle(host)).toBeNull();
      expect(previewBlock(host).classList).toContain('max-h-96');
      expect(previewBlock(host).classList).not.toContain('is-clipped');
    });

    it('never carries a horizontal-scroll class, in any state', () => {
      fixture.componentRef.setInput(
        'node',
        node(write(lines(30) + '\n' + 'z'.repeat(500))),
      );
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelectorAll(HORIZONTAL_SCROLL)).toHaveLength(0);

      fixture.componentInstance.isInputCollapsed.set(false);
      fixture.detectChanges();
      expect(previewBlock(host).classList).toContain('is-clipped');
      expect(host.querySelectorAll(HORIZONTAL_SCROLL)).toHaveLength(0);

      previewToggle(host)?.click();
      fixture.detectChanges();
      expect(previewBlock(host).classList).not.toContain('is-clipped');
      expect(host.querySelectorAll(HORIZONTAL_SCROLL)).toHaveLength(0);

      fixture.componentRef.setInput(
        'node',
        node({ toolInput: { command: 'echo ' + 'q'.repeat(300) } }),
      );
      fixture.detectChanges();
      expect(host.querySelectorAll(HORIZONTAL_SCROLL)).toHaveLength(0);
    });

    // Decision #120(a): Escape collapses the expanded preview and stops there.
    it('collapses the preview on Escape while expanded, focuses the toggle and stops the event', () => {
      const host = renderOpen(write(lines(30)));
      const toggle = previewToggle(host) as HTMLButtonElement;
      toggle.click();
      fixture.detectChanges();
      const block = previewBlock(host);
      block.focus();

      const event = escape(block);

      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.textContent?.trim()).toBe('Show all 30 lines');
      expect(block.classList).toContain('is-clipped');
      expect(document.activeElement).toBe(toggle);
      expect(event.defaultPrevented).toBe(true);
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('lets Escape bubble while the preview is collapsed', () => {
      const host = renderOpen(write(lines(30)));
      const block = previewBlock(host);
      const outer = jest.fn();
      host.parentElement?.addEventListener('keydown', outer);

      const event = escape(block);

      host.parentElement?.removeEventListener('keydown', outer);
      expect(event.defaultPrevented).toBe(false);
      expect(event.stopPropagation).not.toHaveBeenCalled();
      expect(outer).toHaveBeenCalledTimes(1);
      expect(block.classList).toContain('is-clipped');
    });

    it('keeps the retention notice', () => {
      fixture.componentRef.setInput(
        'node',
        node({
          retention: {
            droppedChars: 10,
            capped: ['toolInput'],
            foldFailed: false,
          },
        }),
      );
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        'Input truncated',
      );
    });
  },
);
