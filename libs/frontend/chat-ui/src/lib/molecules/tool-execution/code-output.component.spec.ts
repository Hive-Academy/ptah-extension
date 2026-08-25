import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import type { ExecutionNode } from '@ptah-extension/shared';
import { CodeOutputComponent } from './code-output.component';

/**
 * These cases pin the language-detection pipeline behind `formattedOutput()`,
 * not the markdown rendering — but the template instantiates `<markdown>`, so
 * `provideMarkdown()` has to be present for the fixture to come up at all.
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
      providers: [provideMarkdown()],
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
});
