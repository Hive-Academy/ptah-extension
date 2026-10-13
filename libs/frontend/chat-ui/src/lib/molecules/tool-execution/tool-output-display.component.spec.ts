import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import { Clipboard } from '@angular/cdk/clipboard';
import { FILE_LINK_OPENER, VSCodeService } from '@ptah-extension/core';
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
      providers: [provideSurfaceActiveTesting(), provideMarkdown()],
    }).compileComponents();
    fixture = TestBed.createComponent(ToolOutputDisplayComponent);
  });

  describe('no retention field', () => {
    it('renders no marker and leaves the output section untouched', () => {
      const host = render({ toolOutput: 'ok\n' });

      expect(marker(host)).toBeNull();
      expect(host.querySelector('ptah-code-output')).not.toBeNull();
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

/** Classes that would let a block scroll sideways (decision #119, R9.5). */
const HORIZONTAL_SCROLL =
  '.overflow-x-auto, .overflow-x-scroll, .whitespace-nowrap';

describe.each([true, false])(
  'ToolOutputDisplayComponent — routing, notices and wrapping (isElectron=%s)',
  (isElectron) => {
    let fixture: ComponentFixture<ToolOutputDisplayComponent>;
    let open: jest.Mock;

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

    const edit: Partial<ExecutionNode> = {
      toolName: 'Edit',
      toolInput: {
        file_path: '/repo/src/source.ts',
        old_string: 'a',
        new_string: 'b'.repeat(400),
      },
    };

    const longOutput = Array.from(
      { length: 20 },
      (_, i) => `line ${i} ` + 'o'.repeat(i * 30),
    ).join('\n');

    beforeEach(async () => {
      open = jest.fn().mockResolvedValue(undefined);
      await TestBed.configureTestingModule({
        imports: [ToolOutputDisplayComponent],
        providers: [
          provideSurfaceActiveTesting(),
          provideMarkdown(),
          { provide: Clipboard, useValue: { copy: jest.fn() } },
          { provide: FILE_LINK_OPENER, useValue: { open } },
          { provide: VSCodeService, useValue: { isElectron } },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent(ToolOutputDisplayComponent);
    });

    it('routes TodoWrite to the todo list', () => {
      const host = render({
        toolName: 'TodoWrite',
        toolInput: {
          todos: [
            { content: 'Ship it', status: 'pending', activeForm: 'Shipping' },
          ],
        },
        toolOutput: 'ok',
      });

      expect(host.querySelector('ptah-todo-list-display')).not.toBeNull();
      expect(host.querySelector('ptah-diff-display')).toBeNull();
      expect(host.querySelector('ptah-code-output')).toBeNull();
    });

    it('routes Edit to the diff, with the replacement count from the output', () => {
      const host = render({
        ...edit,
        toolOutput: {
          message: 'ok',
          replacements: 3,
          file_path: '/repo/src/source.ts',
        },
      });

      expect(host.querySelector('ptah-diff-display')).not.toBeNull();
      expect(host.querySelector('ptah-code-output')).toBeNull();
      expect(host.textContent).toContain('3 replacements');
    });

    it('routes Edit to the diff even before any output arrives', () => {
      const host = render(edit);

      expect(host.querySelector('ptah-diff-display')).not.toBeNull();
      expect(host.textContent).toContain('1 replacement');
    });

    it('routes other tools to the code output', () => {
      const host = render({ toolOutput: 'ok' });

      expect(host.querySelector('ptah-code-output')).not.toBeNull();
      expect(host.querySelector('ptah-diff-display')).toBeNull();
    });

    // Regression: "Output" heading, then a language badge in a second row.
    it('has no generic "Output" heading; the code output names its content', () => {
      // Long enough for the label row: short plain text (Bash) has none.
      const host = render({ toolOutput: 'a\nb\nc\nd\ne\nf\ng\nh' });

      expect(host.textContent).not.toMatch(/\bOutput\b/);
      expect(
        host.querySelector('[data-testid="code-output-label"]')?.textContent,
      ).toBe('Result');
    });

    it('labels the todo list "Tasks" and the diff "Diff", with no "Output" heading', () => {
      let host = render({
        toolName: 'TodoWrite',
        toolInput: {
          todos: [
            { content: 'Ship it', status: 'pending', activeForm: 'Shipping' },
          ],
        },
        toolOutput: 'ok',
      });
      expect(host.textContent).toContain('Tasks');
      expect(host.textContent).not.toMatch(/\bOutput\b/);

      host = render(edit);
      expect(
        host.querySelector('[data-testid="diff-label"]')?.textContent,
      ).toBe('Diff');
      expect(host.textContent).not.toMatch(/\bOutput\b/);
    });

    it("shows a failed command's error once: the output block, no second alert", async () => {
      const host = render({
        status: 'error',
        toolOutput: 'npm ERR! missing script: lint',
        error: 'npm ERR! missing script: lint',
      });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(host.querySelector('[data-testid="tool-error"]')).toBeNull();
      expect(host.textContent?.match(/missing script/g)).toHaveLength(1);
    });

    it('renders an error with no output as one readable "Error" block', () => {
      const host = render({ status: 'error', error: 'Permission denied' });
      const block = host.querySelector(
        '[data-testid="tool-error"]',
      ) as HTMLElement;

      expect(block.textContent).toContain('Error');
      expect(block.textContent).toContain('Permission denied');
      expect(block.querySelector('.bg-error\\/10')?.classList).toContain(
        'text-base-content',
      );
      expect(host.querySelector('.alert-error')).toBeNull();
    });

    it('keeps the Error block when the output only mentions the error incidentally', () => {
      const host = render({
        status: 'error',
        toolOutput:
          'Permission denied was mentioned in the log, then retry succeeded',
        error: 'Permission denied',
      });

      const block = host.querySelector('[data-testid="tool-error"]');
      expect(block?.textContent).toContain('Permission denied');
    });

    it('treats ANSI-coloured output and error as the same displayed message', () => {
      const host = render({
        status: 'error',
        toolOutput: 'Compiling...\n\x1b[31mError: build failed\x1b[0m\n',
        error: '\x1b[1mError: build failed\x1b[0m',
      });

      expect(host.querySelector('[data-testid="tool-error"]')).toBeNull();
    });

    it('keeps the Error block when the output holds the error only mid-line', () => {
      const host = render({
        status: 'error',
        toolOutput: 'warning: Error: build failed',
        error: 'Error: build failed',
      });

      expect(host.querySelector('[data-testid="tool-error"]')).not.toBeNull();
    });

    it('drops the Error block for one-line markdown (MCP) output that equals the error', async () => {
      const message = '**fatal**: build stopped';
      const host = render({
        toolName: 'mcp__server__run',
        status: 'error',
        toolOutput: message,
        error: message,
      });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(host.querySelector('[data-testid="tool-error"]')).toBeNull();
      expect(host.textContent).toContain('build stopped');
    });

    // Regression: an image moves its text into a non-visible alt attribute,
    // and a fence info string becomes a CSS class.
    it.each([
      ['an image', '![fatal: disk full](https://example.com/icon.png)'],
      ['a ~~~ fence info string', '~~~fatal-disk-full\nbody\n~~~'],
      ['a ``` fence info string', '```fatal-disk-full\nbody\n```'],
      ['an unclosed one-line fence', '```fatal-disk-full'],
      ['more than one line', '## Failed\n- **fatal**: build stopped'],
      ['a link', '## Failed\nsee [the log](https://example.com/log) for why'],
      ['an entity', '## Failed\n- **fatal**: &lt;eof&gt; reached'],
      ['a backslash escape', '## Failed\n- **fatal**: C:\\temp is full'],
    ])(
      'keeps the Error block for markdown output whose error holds %s',
      async (_case, message) => {
        const host = render({
          toolName: 'mcp__server__run',
          status: 'error',
          toolOutput: message,
          error: message,
        });
        await fixture.whenStable();
        fixture.detectChanges();

        const block = host.querySelector('[data-testid="tool-error"]');
        expect(block).not.toBeNull();
        expect(block?.textContent).toContain(message);
      },
    );

    it('keeps the Error block when markdown output only mentions the error incidentally', async () => {
      const host = render({
        toolName: 'mcp__server__run',
        status: 'error',
        toolOutput: '## Log\n- Permission denied was seen, then retry succeeded',
        error: 'Permission denied',
      });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(host.querySelector('[data-testid="tool-error"]')).not.toBeNull();
    });

    // Regression: markdown output is sanitised, so markup in the error can vanish.
    it('keeps the Error block for markdown output whose error holds a <b> tag', async () => {
      const message = '## Failed\n<b>fatal</b> build stopped';
      const host = render({
        toolName: 'mcp__server__run',
        status: 'error',
        toolOutput: message,
        error: message,
      });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(host.querySelector('[data-testid="tool-error"]')).not.toBeNull();
    });

    it('keeps the Error block for markdown (MCP) output whose error holds a <script> tag', async () => {
      const message = '**fatal** <script>boom</script>';
      const host = render({
        toolName: 'mcp__server__run',
        status: 'error',
        toolOutput: message,
        error: message,
      });
      await fixture.whenStable();
      fixture.detectChanges();

      const block = host.querySelector('[data-testid="tool-error"]');
      expect(block).not.toBeNull();
      expect(block?.textContent).toContain(message);
    });

    // Plain-text MCP output is fenced as text, so it shows the error whole.
    it('drops the Error block for plain-text MCP output that equals the error', async () => {
      const host = render({
        toolName: 'mcp__server__run',
        status: 'error',
        toolOutput: '<script>fatal</script>',
        error: '<script>fatal</script>',
      });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(host.querySelector('[data-testid="tool-error"]')).toBeNull();
      expect(host.querySelector('pre code')?.textContent).toContain(
        '<script>fatal</script>',
      );
    });

    it('drops the Error block for a .md Read whose output equals the error', () => {
      const host = render({
        toolName: 'Read',
        toolInput: { file_path: '/repo/README.md' },
        status: 'error',
        toolOutput: 'File not found',
        error: 'File not found',
      });

      expect(host.querySelector('[data-testid="tool-error"]')).toBeNull();
    });

    it('forwards a pending permission: the output is not styled as a failure', () => {
      fixture.componentRef.setInput('awaitingPermission', true);
      const host = render({ status: 'error', toolOutput: 'needs approval' });

      const region = host.querySelector(
        'ptah-code-output [role="region"]',
      ) as HTMLElement;
      expect(region.classList).not.toContain('bg-error/10');
      expect(region.classList).toContain('bg-base-300/50');
      expect(region.getAttribute('aria-label')).not.toContain('failed');
    });

    it('styles the same output as a failure once no permission is pending', () => {
      const host = render({ status: 'error', toolOutput: 'needs approval' });

      const region = host.querySelector(
        'ptah-code-output [role="region"]',
      ) as HTMLElement;
      expect(region.classList).toContain('bg-error/10');
    });

    it('shows a whitespace-only error as an Error block with a stated message', () => {
      const host = render({
        status: 'error',
        toolOutput: 'some output',
        error: '   \n ',
      });

      const block = host.querySelector('[data-testid="tool-error"]');
      expect(block).not.toBeNull();
      expect(block?.textContent).toContain(
        'The tool reported an error without a message.',
      );
    });

    it('keeps the retention notice and the error block', () => {
      const host = render({
        toolOutput: 'partial',
        retention: {
          droppedChars: 5,
          capped: ['toolOutput'],
          foldFailed: false,
        },
        error: 'exit code 2',
      });

      expect(host.textContent).toContain('Output truncated');
      expect(
        host.querySelector('[data-testid="tool-error"]')?.textContent,
      ).toContain('exit code 2');
    });

    it('never carries a horizontal-scroll class, in any state', () => {
      let host = render({ toolOutput: longOutput });
      const toggle = host.querySelector(
        'ptah-code-output button[aria-expanded]',
      ) as HTMLButtonElement;
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(host.querySelectorAll(HORIZONTAL_SCROLL)).toHaveLength(0);

      toggle.click();
      fixture.detectChanges();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(host.querySelectorAll(HORIZONTAL_SCROLL)).toHaveLength(0);

      host = render(edit);
      expect(host.querySelector('ptah-diff-display')).not.toBeNull();
      expect(host.querySelectorAll(HORIZONTAL_SCROLL)).toHaveLength(0);

      host = render({
        toolName: 'TodoWrite',
        toolInput: {
          todos: [
            {
              content: 't'.repeat(300),
              status: 'in_progress',
              activeForm: 'Working',
            },
          ],
        },
        toolOutput: 'ok',
      });
      expect(host.querySelectorAll(HORIZONTAL_SCROLL)).toHaveLength(0);
    });
  },
);
