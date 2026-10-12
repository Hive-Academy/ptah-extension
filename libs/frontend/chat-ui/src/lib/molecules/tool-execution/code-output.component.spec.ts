import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import type { ExecutionNode } from '@ptah-extension/shared';
import { Clipboard } from '@angular/cdk/clipboard';
import { VSCodeService } from '@ptah-extension/core';
import { CodeOutputComponent } from './code-output.component';

/**
 * These cases pin language detection and code-fence containment, including
 * rendered output through the real markdown component.
 */
describe('CodeOutputComponent — output language detection', () => {
  let fixture: ComponentFixture<CodeOutputComponent>;

  function node(partial: Partial<ExecutionNode>): ExecutionNode {
    return {
      id: 'n1',
      type: 'tool',
      status: 'complete',
      content: null,
      children: [],
      startTime: 0,
      ...partial,
    } as ExecutionNode;
  }

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
    expect(formatted).toContain('```bash');
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
      '```````bash\n' + output + '\n```````',
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

    function node(partial: Partial<ExecutionNode>): ExecutionNode {
      return {
        id: 'n1',
        type: 'tool',
        status: 'complete',
        content: null,
        children: [],
        startTime: 0,
        ...partial,
      } as ExecutionNode;
    }

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
      [{ toolName: 'Bash', toolOutput: 'ok' }, 'Bash'],
      [
        {
          toolName: 'Read',
          toolInput: { file_path: '/src/app.ts' },
          toolOutput: 'const a = 1;',
        },
        'TypeScript',
      ],
      [{ toolName: 'Bash', toolOutput: '{"ok":true}' }, 'JSON'],
      [{ toolName: 'Grep', toolOutput: 'a.ts:1' }, 'Plain text'],
    ] as const)('labels the language (%#)', (partial, label) => {
      const host = render(partial);
      expect(
        host
          .querySelector('[data-testid="code-output-language"]')
          ?.textContent?.trim(),
      ).toBe(label);
    });

    it('makes the block focusable with an aria-label naming the tool', () => {
      const block = render({
        toolName: 'Bash',
        toolOutput: 'ok',
      }).querySelector('[role="region"]') as HTMLElement;
      expect(block.getAttribute('tabindex')).toBe('0');
      expect(block.getAttribute('aria-label')).toMatch(/^Bash output \d+$/);
    });

    it('keeps short output in the max-h-48 scroll with no toggle', () => {
      const host = render({ toolName: 'Bash', toolOutput: lines(6) });
      const block = host.querySelector('[role="region"]') as HTMLElement;
      expect(host.querySelector('button[aria-expanded]')).toBeNull();
      expect(block.classList).toContain('max-h-48');
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
      expect(block.classList).not.toContain('max-h-48');
      // Clipped text stays in the document for assistive technology.
      expect(block.textContent).toContain('line 20');

      toggle.click();
      fixture.detectChanges();
      expect(toggle.textContent?.trim()).toBe('Show less');
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(block.classList).not.toContain('is-clipped');
      expect(block.classList).toContain('max-h-48');
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
      expect(block.classList).toContain('max-h-48');
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
