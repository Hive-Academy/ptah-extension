import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import type { ExecutionNode } from '@ptah-extension/shared';
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
