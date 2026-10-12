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
      fixture.componentInstance.isPreviewExpanded.set(true);
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
      const host = render({ toolInput: { command: 'ls -la', timeout: 1000 } });

      expect(marker(host)).toBeNull();
      expect(
        host.querySelector('[data-testid="input-preview-label"]')?.textContent,
      ).toContain('Command');
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

    it('renders OUTSIDE the hasInput guard — no toolInput, marker still shown', () => {
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

    it('is visible beside the input sections, with nothing to expand first', () => {
      // The marker must not be trapped inside a collapsed block, or the user
      // who never expands never learns the payload was cut.
      const host = render({
        toolInput: { command: 'ls' },
        retention: retention(),
      });

      expect(marker(host)).not.toBeNull();
      expect(marker(host)?.closest('[data-testid="input-preview"]')).toBeNull();
    });
  });
});

/** Classes that would let a block scroll sideways (decision #119, R9.5). */
const HORIZONTAL_SCROLL =
  '.overflow-x-auto, .overflow-x-scroll, .whitespace-nowrap';

describe.each([true, false])(
  'ToolInputDisplayComponent — Command, Content, Prompt, Arguments (isElectron=%s)',
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

    function render(partial: Partial<ExecutionNode>): HTMLElement {
      fixture.componentRef.setInput('node', node(partial));
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

    function previewLabel(host: HTMLElement): string | undefined {
      return host
        .querySelector('[data-testid="input-preview-label"]')
        ?.textContent?.trim();
    }

    function previewToggle(host: HTMLElement): HTMLButtonElement | null {
      return host.querySelector<HTMLButtonElement>(
        '[data-testid="input-preview"] button[aria-expanded]',
      );
    }

    function previewBlock(host: HTMLElement): HTMLElement {
      return host.querySelector(
        '[data-testid="input-preview"] [role="region"]',
      ) as HTMLElement;
    }

    function args(host: HTMLElement): string[][] {
      const keys = host.querySelectorAll('[data-testid="tool-input-arg-key"]');
      const values = host.querySelectorAll(
        '[data-testid="tool-input-arg-value"]',
      );
      return Array.from(keys).map((key, i) => [
        key.textContent?.trim() ?? '',
        values[i]?.textContent?.trim() ?? '',
      ]);
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

    it('has no generic "Input" heading or toggle', () => {
      const host = render({ toolInput: { command: 'ls', timeout: 1000 } });

      expect(host.textContent).not.toMatch(/\bInput\b/);
      expect(
        host.querySelector('button[aria-controls^="ptah-tool-input-"]'),
      ).toBeNull();
    });

    // Regression: the description and command each showed twice. The header
    // shows the description; the body shows the command once; chips take
    // the background flag and the timeout.
    it.each(['Bash', 'PowerShell'])(
      'shows the %s command once as "$ command", without the description or chip params',
      (toolName) => {
        const host = render({
          toolName,
          toolInput: {
            command: 'npx nx test chat-ui',
            description: 'Run the tests',
            run_in_background: true,
            timeout: 120000,
          },
        });
        const command = host.querySelector('[data-testid="input-command"]');

        expect(previewLabel(host)).toBe('Command');
        expect(command?.textContent).toBe('$ npx nx test chat-ui');
        expect(host.textContent?.match(/npx nx test chat-ui/g)).toHaveLength(1);
        expect(host.textContent).not.toContain('Run the tests');
        expect(args(host)).toEqual([]);
        expect(host.textContent).not.toContain('Arguments');
      },
    );

    it('copies the exact command with "Copy command"', () => {
      const host = render({ toolInput: { command: 'git status --short' } });
      const copy = host.querySelector(
        'button[aria-label="Copy command"]',
      ) as HTMLButtonElement;

      copy.click();
      expect(copyMock).toHaveBeenCalledWith('git status --short');
    });

    it.each([
      [
        'WebFetch',
        { url: 'https://example.com', prompt: 'Summarise' },
        'https://example.com',
      ],
      [
        'Agent',
        { description: 'Review it', prompt: 'Go', subagent_type: 'x' },
        'Review it',
      ],
    ] as const)(
      'shows the %s prompt as a muted "Prompt" paragraph and leaves the header target out',
      (toolName, toolInput, shown) => {
        const host = render({ toolName, toolInput });
        const prompt = host.querySelector('[data-testid="input-prompt"]');

        expect(previewLabel(host)).toBe('Prompt');
        expect(prompt?.textContent).toBe(toolInput.prompt);
        expect(prompt?.classList).toContain('text-base-content-muted');
        expect(host.textContent).not.toContain(shown);
        expect(args(host)).toEqual([]);
      },
    );

    it('lists only the arguments shown nowhere else, as key/value rows', () => {
      const host = render({
        toolName: 'mcp__orchestrator__spawn',
        toolInput: { __summary: 'Spawn a lane', name: 'lane-1', retries: 3 },
      });
      const list = host.querySelector('[data-testid="tool-input-args"]');

      expect(host.textContent).toContain('Arguments');
      expect(args(host)).toEqual([['name', 'lane-1']]);
      expect(list?.getAttribute('aria-labelledby')).toBeTruthy();
      expect(
        host.querySelector('[data-testid="tool-input-arg-key"]')?.classList,
      ).toContain('text-base-content-muted');
      expect(
        host.querySelector('[data-testid="tool-input-arg-value"]')?.classList,
      ).toContain('text-base-content');
    });

    it('leaves the Grep pattern and chip params out of the arguments', () => {
      const host = render({
        toolName: 'Grep',
        toolInput: { pattern: 'needle', path: 'src', glob: '*.ts' },
      });

      expect(host.textContent?.trim()).toBe('');
    });

    it('cuts a value over 120 characters, with "more" to show the rest', () => {
      const value = 'd'.repeat(150);
      const host = render({
        toolName: 'mcp__x__tool',
        toolInput: { query_text: value },
      });
      const more = host.querySelector(
        '[data-testid="tool-input-arg-value"] button',
      ) as HTMLButtonElement;

      expect(host.textContent).toContain('d'.repeat(120) + '…');
      expect(host.textContent).not.toContain('d'.repeat(121));
      expect(more.getAttribute('aria-expanded')).toBe('false');

      more.click();
      fixture.detectChanges();
      expect(host.textContent).toContain(value);
      expect(more.getAttribute('aria-expanded')).toBe('true');
      expect(more.textContent?.trim()).toBe('less');
    });

    it.each([
      ['Edit', { file_path: '/a.ts', old_string: 'a', new_string: 'b' }],
      ['TodoWrite', { todos: [] }],
      ['Read', { file_path: '/a.ts', offset: 1, limit: 20 }],
      ['Glob', { pattern: '**/*.ts' }],
      ['WebSearch', { query: 'signals' }],
      ['mcp__orchestrator__ListAgents', {}],
    ] as const)(
      'renders nothing for %s when every fact is elsewhere',
      (toolName, toolInput) => {
        const host = render({ toolName, toolInput });

        expect(host.textContent?.trim()).toBe('');
      },
    );

    it('renders the Write content with its language label, copy and a labelled focusable block', () => {
      const host = render(write(lines(3)));
      const block = previewBlock(host);

      expect(previewLabel(host)).toBe('Content');
      expect(
        host
          .querySelector('[data-testid="input-preview-language"]')
          ?.textContent?.trim(),
      ).toBe('TypeScript');
      expect(block.getAttribute('tabindex')).toBe('0');
      expect(block.getAttribute('aria-label')).toBe('Content: source.ts');
      expect(
        host.querySelector('button[aria-label="Copy content"]'),
      ).not.toBeNull();
      expect(args(host)).toEqual([]);
    });

    it('shows short Write content in full (R7.7), with no toggle', async () => {
      const content = 'w'.repeat(150);
      const host = render(write(content));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(host.textContent).toContain(content);
      expect(previewToggle(host)).toBeNull();
      expect(previewBlock(host).classList).toContain('max-h-96');
    });

    it('limits a long preview, then toggles "Show all N lines" with aria-expanded', () => {
      const host = render(write(lines(30)));
      const toggle = previewToggle(host) as HTMLButtonElement;
      const block = previewBlock(host);

      expect(toggle.textContent?.trim()).toBe('Show all 30 lines');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.getAttribute('aria-controls')).toBe(block.id);
      expect(block.classList).toContain('is-clipped');
      expect(block.style.maxHeight).toBe('15.4em');

      toggle.click();
      fixture.detectChanges();
      expect(toggle.textContent?.trim()).toBe('Show less');
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(block.classList).not.toContain('is-clipped');
      expect(block.classList).toContain('max-h-96');
      expect(block.classList).toContain('overflow-y-auto');
    });

    it('limits a prompt to 6 rows', () => {
      const host = render({
        toolName: 'Agent',
        toolInput: { description: 'd', prompt: lines(8) },
      });

      expect(previewToggle(host)?.textContent?.trim()).toBe('Show all 8 lines');
      expect(previewBlock(host).style.maxHeight).toBe('8.4em');
    });

    it('never carries a horizontal-scroll class, in any state', () => {
      let host = render(write(lines(30)));
      expect(host.querySelectorAll(HORIZONTAL_SCROLL)).toHaveLength(0);

      previewToggle(host)?.click();
      fixture.detectChanges();
      expect(host.querySelectorAll(HORIZONTAL_SCROLL)).toHaveLength(0);

      host = render({ toolInput: { command: 'echo ' + 'q'.repeat(300) } });
      expect(host.querySelectorAll(HORIZONTAL_SCROLL)).toHaveLength(0);
      expect(
        host.querySelector('[data-testid="input-command"]')?.classList,
      ).toContain('whitespace-pre-wrap');
    });

    // Decision #120(a): Escape collapses the expanded preview and stops there.
    it('collapses the preview on Escape while expanded, focuses the toggle and stops the event', () => {
      const host = render(write(lines(30)));
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
      const host = render(write(lines(30)));
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

    // Batch 28F.1: CRLF, CR and LF all end a line; `\r` never widens a row and
    // a trailing terminator is not an extra line.
    const crlfLines = (count: number): string =>
      Array.from({ length: count }, () => 'w'.repeat(100) + '\r\n').join('');

    it('shows no toggle for 11 CRLF-terminated lines of 100 characters', () => {
      const host = render(write(crlfLines(11)));

      expect(previewToggle(host)).toBeNull();
      expect(previewBlock(host).classList).not.toContain('is-clipped');
      expect(previewBlock(host).classList).toContain('max-h-96');
    });

    it('shows "Show all 12 lines" for 12 CRLF-terminated lines of 100 characters', () => {
      const host = render(write(crlfLines(12)));

      expect(previewToggle(host)?.textContent?.trim()).toBe(
        'Show all 12 lines',
      );
      expect(previewBlock(host).classList).toContain('is-clipped');
    });

    it('counts lines separated by a lone CR', () => {
      const content = Array.from({ length: 12 }, () => 'r'.repeat(60)).join(
        '\r',
      );
      const host = render(write(content));

      expect(previewToggle(host)?.textContent?.trim()).toBe(
        'Show all 12 lines',
      );
    });
  },
);
