import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import type { ExecutionNode } from '@ptah-extension/shared';
import { Clipboard } from '@angular/cdk/clipboard';
import { VSCodeService } from '@ptah-extension/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { provideMarkdownRendering } from '@ptah-extension/markdown';
import { CodeOutputComponent } from './code-output.component';

function node(partial: Partial<ExecutionNode>): ExecutionNode {
  return {
    id: 'n1',
    type: 'tool',
    status: 'complete',
    content: null,
    children: [],
    startTime: 0,
    isCollapsed: false,
    ...partial,
  };
}

/**
 * These cases pin language detection and code-fence containment, including
 * rendered output through the real markdown component.
 */
describe('CodeOutputComponent — output language detection', () => {
  let fixture: ComponentFixture<CodeOutputComponent>;

  function outputFor(partial: Partial<ExecutionNode>): string {
    fixture.componentRef.setInput('node', node(partial));
    return fixture.componentInstance.formattedOutput();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodeOutputComponent],
      providers: [provideSurfaceActiveTesting(), provideMarkdown()],
    }).compileComponents();
    fixture = TestBed.createComponent(CodeOutputComponent);
  });

  it('labels a whole-document JSON output as json', () => {
    expect(
      outputFor({
        toolName: 'Bash',
        toolOutput: JSON.stringify({ ok: true }, null, 2),
      }),
    ).toContain('```json');
  });

  it('does not throw on JSONL output — it is not one JSON document', () => {
    // The regression: JSON.parse was unguarded inside the computed, so every
    // change detection re-threw "Unexpected non-whitespace character after
    // JSON at position N".
    const jsonl = '{"type":"user","uuid":"a"}\n{"type":"assistant","uuid":"b"}';

    let formatted = '';
    expect(() => {
      formatted = outputFor({
        toolName: 'Read',
        toolInput: { file_path: '/tmp/journal.jsonl' },
        toolOutput: jsonl,
      });
    }).not.toThrow();
    expect(formatted).not.toContain('```json');
    expect(formatted).toContain(jsonl);
  });

  it('does not throw on a log line that merely starts with a bracket', () => {
    let formatted = '';
    expect(() => {
      formatted = outputFor({
        toolName: 'Bash',
        toolOutput: '[NX] Successfully ran target build\nDone in 4s',
      });
    }).not.toThrow();
    expect(formatted).toContain('```text');
  });

  it.each(['Bash', 'PowerShell'])(
    'fences %s output as plain text, not shell code',
    (toolName) => {
      const formatted = outputFor({
        toolName,
        toolOutput: 'Build finished for the project\nDone',
      });
      expect(formatted).toMatch(/^```text\n/);
      expect(formatted).not.toContain('```bash');
    },
  );

  it('keeps the line breaks of plain-text MCP output in a text fence', () => {
    const output = 'Agent: claude\nAgent: codex\nAgent: gemini';
    expect(
      outputFor({ toolName: 'mcp__github__ListAgents', toolOutput: output }),
    ).toBe('```text\n' + output + '\n```');
  });

  it('leaves markdown MCP output unfenced', () => {
    const output = '## Agents\n- claude\n- codex';
    expect(
      outputFor({ toolName: 'mcp__ptah__agents', toolOutput: output }),
    ).toBe(output);
  });

  it.each([0, 1, 2, 3, 6])(
    'uses a fence longer than an inner run of %i backticks',
    (length) => {
      const inner = '`'.repeat(length);
      const output = `before ${inner} after`;
      const fence = '`'.repeat(Math.max(3, length + 1));

      expect(outputFor({ toolName: 'Tool', toolOutput: output })).toBe(
        `${fence}text\n${output}\n${fence}`,
      );
    },
  );

  it('keeps fenced HTML in one code block without tool input', async () => {
    const output = '```html\n<div class="fixed inset-0 z-50">x</div>\n```';
    const formatted = outputFor({ toolName: 'Read', toolOutput: output });
    expect(formatted).toBe('````text\n' + output + '\n````');

    fixture.detectChanges();
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('pre code')).toHaveLength(1);
    expect(host.querySelector('pre code')?.textContent).toBe(output + '\n');
    expect(host.querySelector('div.fixed')).toBeNull();
  });

  it('uses the longest backtick run even when a shorter fence appears first', () => {
    const output = '```html\n<div>x</div>\n```\n``````';
    expect(outputFor({ toolName: 'Bash', toolOutput: output })).toBe(
      '```````text\n' + output + '\n```````',
    );
  });

  it('leaves markdown file output unfenced', () => {
    const output = '# Notes\n```html\n<div>x</div>\n```';
    expect(
      outputFor({
        toolName: 'Read',
        toolInput: { file_path: '/tmp/notes.md' },
        toolOutput: output,
      }),
    ).toBe(output);
  });
});

/**
 * Expand, label and copy (R7.4, R7.5). Both webviews render the same block
 * (decision #8), so every case runs with the host flag true and false.
 */
describe.each([true, false])(
  'CodeOutputComponent — expand, language label and copy (isElectron=%s)',
  (isElectron) => {
    let fixture: ComponentFixture<CodeOutputComponent>;
    let copyMock: jest.Mock<boolean, [string]>;

    function render(partial: Partial<ExecutionNode>): HTMLElement {
      fixture.componentRef.setInput('node', node(partial));
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    const lines = (count: number): string =>
      Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n');

    beforeEach(async () => {
      copyMock = jest.fn().mockReturnValue(true);
      await TestBed.configureTestingModule({
        imports: [CodeOutputComponent],
        providers: [
          provideSurfaceActiveTesting(),
          provideMarkdown(),
          { provide: Clipboard, useValue: { copy: copyMock } },
          { provide: VSCodeService, useValue: { isElectron } },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent(CodeOutputComponent);
    });

    it.each([
      [
        {
          toolName: 'Read',
          toolInput: { file_path: '/src/app.ts' },
          toolOutput: 'const a = 1;',
        },
        'TypeScript',
      ],
      [{ toolName: 'Bash', toolOutput: '{"ok":true}' }, 'JSON'],
    ] as const)('labels the language (%#)', (partial, label) => {
      const host = render(partial);
      expect(
        host
          .querySelector('[data-testid="code-output-language"]')
          ?.textContent?.trim(),
      ).toBe(label);
    });

    it.each([
      [{ toolName: 'Bash', toolOutput: lines(8) }],
      [{ toolName: 'PowerShell', toolOutput: lines(8) }],
      [{ toolName: 'Grep', toolOutput: lines(8) }],
    ] as const)(
      'shows no language label for plain-text output (%#)',
      (partial) => {
        const host = render(partial);
        expect(
          host.querySelector('[data-testid="code-output-header"]'),
        ).not.toBeNull();
        expect(
          host.querySelector('[data-testid="code-output-language"]'),
        ).toBeNull();
        expect(host.textContent).not.toContain('Bash');
      },
    );

    it('wraps the header row and keeps its actions from shrinking', () => {
      const host = render({ toolName: 'Bash', toolOutput: lines(8) });
      const header = host.querySelector(
        '[data-testid="code-output-header"]',
      ) as HTMLElement;
      const actions = host.querySelector(
        '[data-testid="code-output-actions"]',
      ) as HTMLElement;
      const toggle = host.querySelector(
        'button[aria-expanded]',
      ) as HTMLButtonElement;
      expect(header.classList).toContain('flex-wrap');
      expect(actions.classList).toContain('shrink-0');
      expect(actions.classList).toContain('ml-auto');
      expect(toggle.classList).toContain('shrink-0');
      // Unshrinkable items keep "8 lines" on one line without whitespace-nowrap.
      expect(
        host.querySelector('[data-testid="code-output-lines"]')?.classList,
      ).toContain('shrink-0');
    });

    it.each([
      [{ toolName: 'Bash', toolOutput: lines(8) }, 'Result'],
      [
        {
          toolName: 'Read',
          toolInput: { file_path: '/src/app.ts' },
          toolOutput: 'x',
        },
        'Content',
      ],
      [{ toolName: 'Grep', toolOutput: lines(8) }, 'Matches'],
      [{ toolName: 'Bash', toolOutput: lines(8), status: 'error' }, 'Error'],
    ] as const)(
      'names the content in the header row (%#)',
      (partial, label) => {
        const host = render(partial);
        expect(
          host
            .querySelector('[data-testid="code-output-label"]')
            ?.textContent?.trim(),
        ).toBe(label);
        expect(host.textContent).not.toMatch(/\bOutput\b/);
      },
    );

    it('counts the output lines in the header row', () => {
      const host = render({
        toolName: 'Read',
        toolInput: { file_path: '/src/a.ts' },
        toolOutput: 'a\nb\nc\n',
      });
      expect(
        host
          .querySelector('[data-testid="code-output-lines"]')
          ?.textContent?.trim(),
      ).toBe('3 lines');
    });

    it('gives short plain text no label row, only a floating Copy in the tab order', () => {
      const host = render({ toolName: 'mcp__srv__ping', toolOutput: 'pong' });

      expect(
        host.querySelector('[data-testid="code-output-header"]'),
      ).toBeNull();
      expect(
        host.querySelector('[data-testid="code-output-label"]'),
      ).toBeNull();
      const floating = host.querySelector(
        '[data-testid="code-output-floating-copy"]',
      ) as HTMLElement;
      expect(floating).not.toBeNull();
      expect(floating.className).toContain(
        'group-focus-within/output:opacity-100',
      );
      expect(floating.className).toContain('group-hover/output:opacity-100');
      const copy = floating.querySelector('button') as HTMLButtonElement;
      expect(copy.getAttribute('aria-label')).toBe('Copy output');
      expect(copy.disabled).toBe(false);
      expect(copy.tabIndex).toBe(0);
    });

    it.each([
      [
        'expandable plain text',
        { toolName: 'mcp__srv__ping', toolOutput: lines(8) },
      ],
      [
        'a non-text language',
        {
          toolName: 'Read',
          toolInput: { file_path: '/src/a.ts' },
          toolOutput: 'ok',
        },
      ],
    ] as const)('keeps the label row for %s', (_case, partial) => {
      const host = render(partial);
      expect(
        host.querySelector('[data-testid="code-output-header"]'),
      ).not.toBeNull();
      expect(
        host.querySelector('[data-testid="code-output-floating-copy"]'),
      ).toBeNull();
    });

    it('renders a failed call as the error block with readable text', () => {
      const host = render({
        toolName: 'Bash',
        toolOutput: 'error TS2322',
        status: 'error',
      });
      const block = host.querySelector('[role="region"]') as HTMLElement;
      expect(block.classList).toContain('bg-error/10');
      expect(block.classList).toContain('text-base-content');
      expect(block.classList).not.toContain('bg-base-300/50');
    });

    it('uses an 11px floor for the block text', () => {
      const block = render({
        toolName: 'Bash',
        toolOutput: 'ok',
      }).querySelector('[role="region"]') as HTMLElement;
      expect(block.classList).toContain('text-[11px]');
    });

    it('makes the block focusable with an aria-label naming the tool', () => {
      const block = render({
        toolName: 'Bash',
        toolOutput: 'ok',
      }).querySelector('[role="region"]') as HTMLElement;
      expect(block.getAttribute('tabindex')).toBe('0');
      expect(block.getAttribute('aria-label')).toMatch(/^Bash output \d+$/);
    });

    it('says "failed" in the region label of a failed call', () => {
      const block = render({
        toolName: 'PowerShell',
        toolOutput: 'boom',
        status: 'error',
      }).querySelector('[role="region"]') as HTMLElement;
      expect(block.getAttribute('aria-label')).toMatch(
        /^PowerShell output \d+, failed$/,
      );
    });

    it('does not style the output as a failure while a permission is pending', () => {
      fixture.componentRef.setInput('awaitingPermission', true);
      const host = render({
        toolName: 'Bash',
        toolOutput: 'needs approval',
        status: 'error',
      });
      const block = host.querySelector('[role="region"]') as HTMLElement;
      expect(block.classList).not.toContain('bg-error/10');
      expect(block.classList).toContain('bg-base-300/50');
      expect(block.getAttribute('aria-label')).toMatch(/^Bash output \d+$/);
      const label = host.querySelector('[data-testid="code-output-label"]');
      expect(label?.textContent).not.toBe('Error');
    });

    it('keeps short output in the max-h-96 scroll with no toggle', () => {
      const host = render({ toolName: 'Bash', toolOutput: lines(6) });
      const block = host.querySelector('[role="region"]') as HTMLElement;
      expect(host.querySelector('button[aria-expanded]')).toBeNull();
      expect(block.classList).toContain('max-h-96');
      expect(block.classList).toContain('overflow-y-auto');
      expect(block.classList).not.toContain('is-clipped');
    });

    it('limits long output, then toggles it with aria-expanded', async () => {
      const host = render({ toolName: 'Bash', toolOutput: lines(20) });
      await fixture.whenStable();
      const block = host.querySelector('[role="region"]') as HTMLElement;
      const toggle = host.querySelector(
        'button[aria-expanded]',
      ) as HTMLButtonElement;

      expect(toggle.textContent?.trim()).toBe('Show full output');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.getAttribute('aria-controls')).toBe(block.id);
      expect(block.classList).toContain('is-clipped');
      expect(block.classList).not.toContain('max-h-96');
      // Clipped text stays in the document for assistive technology.
      expect(block.textContent).toContain('line 20');

      toggle.click();
      fixture.detectChanges();
      expect(toggle.textContent?.trim()).toBe('Show less');
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(block.classList).not.toContain('is-clipped');
      expect(block.classList).toContain('max-h-96');
      expect(block.classList).toContain('overflow-y-auto');

      toggle.click();
      fixture.detectChanges();
      expect(toggle.textContent?.trim()).toBe('Show full output');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });

    it('counts wrapped rows for markdown output', () => {
      const host = render({
        toolName: 'mcp__ptah__search',
        toolOutput: 'word '.repeat(200),
      });
      expect(host.querySelector('button[aria-expanded]')).not.toBeNull();
    });

    it('copies the stripped output, not the fenced markdown', () => {
      const host = render({
        toolName: 'Read',
        toolInput: { file_path: '/src/a.ts' },
        toolOutput:
          '     1→const a = 1;\n     2→\x1b[32mok\x1b[0m<system-reminder>hide</system-reminder>',
      });
      const copy = host.querySelector(
        'button[aria-label="Copy output"]',
      ) as HTMLButtonElement;
      copy.click();
      expect(copyMock).toHaveBeenCalledWith('const a = 1;\nok');
      expect(copyMock.mock.calls[0][0]).not.toContain('```');
    });

    // Decision #118: wrapped rows count toward the 6-row limit for every language.
    it('shows no toggle for 6 short lines', () => {
      const host = render({ toolName: 'Bash', toolOutput: lines(6) });
      expect(host.querySelector('button[aria-expanded]')).toBeNull();
      expect(host.querySelector('[role="region"]')?.classList).not.toContain(
        'is-clipped',
      );
    });

    it('shows the toggle for 7 short lines', () => {
      const host = render({ toolName: 'Bash', toolOutput: lines(7) });
      expect(host.querySelector('button[aria-expanded]')).not.toBeNull();
    });

    it('shows the toggle for 3 code lines of 250 characters', () => {
      const host = render({
        toolName: 'Read',
        toolInput: { file_path: '/src/app.ts' },
        toolOutput: Array.from({ length: 3 }, () => 'x'.repeat(250)).join('\n'),
      });
      expect(host.querySelector('button[aria-expanded]')).not.toBeNull();
      expect(host.querySelector('[role="region"]')?.classList).toContain(
        'is-clipped',
      );
    });

    // Decision #119: code wraps; the block never scrolls sideways.
    it('never carries overflow-x-auto, collapsed or expanded', () => {
      const host = render({ toolName: 'Bash', toolOutput: lines(20) });
      const block = host.querySelector('[role="region"]') as HTMLElement;
      expect(block.classList).not.toContain('overflow-x-auto');

      (
        host.querySelector('button[aria-expanded]') as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      expect(block.classList).toContain('max-h-96');
      expect(block.classList).not.toContain('overflow-x-auto');
    });

    // Decision #120(a): Escape collapses an expanded block and stops there.
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

    it('collapses on Escape while expanded, focuses the toggle and stops the event', () => {
      const host = render({ toolName: 'Bash', toolOutput: lines(20) });
      const block = host.querySelector('[role="region"]') as HTMLElement;
      const toggle = host.querySelector(
        'button[aria-expanded]',
      ) as HTMLButtonElement;
      toggle.click();
      fixture.detectChanges();
      block.focus();

      const event = escape(block);

      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.textContent?.trim()).toBe('Show full output');
      expect(block.classList).toContain('is-clipped');
      expect(document.activeElement).toBe(toggle);
      expect(event.defaultPrevented).toBe(true);
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('lets Escape bubble while collapsed', () => {
      const host = render({ toolName: 'Bash', toolOutput: lines(20) });
      const block = host.querySelector('[role="region"]') as HTMLElement;
      const outer = jest.fn();
      host.parentElement?.addEventListener('keydown', outer);

      const event = escape(block);

      host.parentElement?.removeEventListener('keydown', outer);
      expect(event.defaultPrevented).toBe(false);
      expect(event.stopPropagation).not.toHaveBeenCalled();
      expect(outer).toHaveBeenCalledTimes(1);
      expect(block.classList).toContain('is-clipped');
    });

    // Batch 28F.1: CRLF, CR and LF all end a line; `\r` never widens a row.
    const crlfLines = (count: number): string =>
      Array.from({ length: count }, () => 'x'.repeat(100) + '\r\n').join('');

    it('shows no toggle for 6 CRLF-terminated lines of 100 characters', () => {
      const host = render({ toolName: 'Bash', toolOutput: crlfLines(6) });
      expect(host.querySelector('button[aria-expanded]')).toBeNull();
      expect(host.textContent).not.toContain('Show full output');
      expect(host.querySelector('[role="region"]')?.classList).not.toContain(
        'is-clipped',
      );
    });

    it('shows the toggle for 7 CRLF-terminated lines of 100 characters', () => {
      const host = render({ toolName: 'Bash', toolOutput: crlfLines(7) });
      expect(
        host.querySelector('button[aria-expanded]')?.textContent?.trim(),
      ).toBe('Show full output');
      expect(host.querySelector('[role="region"]')?.classList).toContain(
        'is-clipped',
      );
    });

    it('shows no toggle for empty output', () => {
      const host = render({ toolName: 'Bash', toolOutput: '' });
      expect(host.querySelector('button[aria-expanded]')).toBeNull();
      expect(host.querySelector('[role="region"]')?.classList).not.toContain(
        'is-clipped',
      );
    });

    it('shows the toggle for one 701-character line (wrapped rows)', () => {
      const host = render({ toolName: 'Bash', toolOutput: 'x'.repeat(701) });
      expect(host.querySelector('button[aria-expanded]')).not.toBeNull();
      expect(host.querySelector('[role="region"]')?.classList).toContain(
        'is-clipped',
      );
    });
  },
);

/**
 * Regression (blank output): the app's markdown preset wraps each fence in a
 * language header and, from 15 lines, a <details> "Collapse" summary. Inside
 * the 9.6em limit those bars pushed the first code row under the fade. They
 * must stay hidden, leaving one language label: the component's own row.
 */
describe('CodeOutputComponent — inner code-block chrome (full markdown preset)', () => {
  let fixture: ComponentFixture<CodeOutputComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodeOutputComponent],
      providers: [
        provideSurfaceActiveTesting(),
        provideMarkdownRendering({ extensions: 'full' }),
        { provide: Clipboard, useValue: { copy: jest.fn() } },
        { provide: VSCodeService, useValue: { isElectron: false } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CodeOutputComponent);
  });

  async function render(toolOutput: string): Promise<HTMLElement> {
    fixture.componentRef.setInput(
      'node',
      node({ toolName: 'PowerShell', toolOutput }),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * jest-preset-angular strips component `styles`, so the hiding rule cannot
   * be observed through getComputedStyle. Both halves of the contract are
   * pinned instead: the renderer emits the chrome under
   * `.tool-output-markdown`, and the shared stylesheet
   * (`tool-output-markdown.styles.ts`, used by code-output and
   * tool-input-display) hides exactly that selector. This is the one pin.
   */
  const source = readFileSync(
    join(__dirname, 'tool-output-markdown.styles.ts'),
    'utf-8',
  );

  // Defect 4: the pipe's containment root has an inline overflow-x: auto,
  // which made it a second scroller inside the block.
  it('lifts the containment root overflow so the block is the only scroller', async () => {
    const host = await render('row 0');

    expect(
      host.querySelector('.tool-output-markdown .ptah-markdown-root'),
    ).not.toBeNull();
    expect(source).toMatch(
      /\.tool-output-markdown \.ptah-markdown-root \{\s*overflow: visible !important;/,
    );
  });

  it('hides the inner header and Collapse summary in its stylesheet', () => {
    expect(source).toMatch(
      /\.tool-output-markdown \.code-block-header,\s*:host ::ng-deep \.tool-output-markdown \.code-block-toggle \{\s*display: none;/,
    );
  });

  // Visual review issue 3: the dark global Prism theme left light-theme
  // tokens at 1.3-2.2:1. Every token rule is scoped to the light marker, so
  // dark themes keep the global Prism colours.
  it('gives Prism tokens a light palette only under the light theme marker', () => {
    const tokenRules = source.match(/[^{}]*\.token\.[^{}]*\{/g) ?? [];

    expect(tokenRules.length).toBeGreaterThan(0);
    for (const rule of tokenRules) {
      expect(rule.trim()).toMatch(
        /^:host-context\(\[data-theme-mode='light'\]\)\s+::ng-deep\s+\.tool-output-markdown/,
      );
    }
    expect(source).toMatch(/\.token\.keyword\) \{\s*color: #a40e26;/);
  });

  it.each([3, 20])(
    'renders the inner chrome where that rule applies, for %i lines',
    async (count) => {
      const output = Array.from({ length: count }, (_, i) => `row ${i}`).join(
        '\n',
      );
      const host = await render(output);

      // Up to three plain-text lines render as a wrapped note with no header;
      // the shared stylesheet keeps it in the code font.
      if (count <= 3) {
        expect(
          host.querySelector('.tool-output-markdown .code-block-note')
            ?.textContent,
        ).toContain('row 0');
        expect(
          host.querySelector('.tool-output-markdown .code-block-header'),
        ).toBeNull();
        expect(source).toMatch(
          /\.tool-output-markdown \.code-block-note \{[^}]*font-family: 'JetBrains Mono'/,
        );
        return;
      }
      expect(
        host.querySelector('.tool-output-markdown .code-block-header'),
      ).not.toBeNull();
      if (count >= 15) {
        expect(
          host.querySelector('.tool-output-markdown .code-block-toggle'),
        ).not.toBeNull();
      }
      // The code itself is in the block. Short plain text has no label row;
      // long output has one, and its label is the only one.
      expect(host.querySelector('pre code')?.textContent).toContain('row 0');
      expect(host.textContent).not.toContain('Output');
      if (count <= 6) {
        expect(
          host.querySelector('[data-testid="code-output-label"]'),
        ).toBeNull();
        return;
      }
      expect(
        host.querySelector('[data-testid="code-output-label"]')?.textContent,
      ).toBe('Result');
      // PowerShell output is plain text: no language label repeats the tool.
      expect(
        host.querySelectorAll('[data-testid="code-output-language"]'),
      ).toHaveLength(0);
    },
  );
});
