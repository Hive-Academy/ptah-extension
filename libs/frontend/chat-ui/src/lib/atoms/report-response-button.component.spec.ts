import { TestBed } from '@angular/core/testing';
import type { ExecutionChatMessage } from '@ptah-extension/shared';
import {
  REPORT_EXCERPT_LIMIT,
  ReportResponseButtonComponent,
} from './report-response-button.component';

function makeMessage(rawContent: string): ExecutionChatMessage {
  return {
    id: 'msg-42',
    role: 'assistant',
    rawContent,
    timestamp: 0,
    streamingState: null,
  };
}

describe('ReportResponseButtonComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReportResponseButtonComponent],
    }).compileComponents();
  });

  function render(message: ExecutionChatMessage): HTMLAnchorElement {
    const fixture = TestBed.createComponent(ReportResponseButtonComponent);
    fixture.componentRef.setInput('message', message);
    fixture.detectChanges();
    const anchor = fixture.nativeElement.querySelector(
      '[data-testid="report-response-button"]',
    ) as HTMLAnchorElement;
    expect(anchor).not.toBeNull();
    return anchor;
  }

  function body(anchor: HTMLAnchorElement): string {
    const href = anchor.getAttribute('href') ?? '';
    const encoded = href.slice(href.indexOf('&body=') + '&body='.length);
    return decodeURIComponent(encoded);
  }

  it('is an accessible anchor that opens a mail draft to help@ptah.live', () => {
    const anchor = render(makeMessage('bad answer'));
    const href = anchor.getAttribute('href') ?? '';

    expect(anchor.tagName).toBe('A');
    expect(href.startsWith('mailto:help@ptah.live?')).toBe(true);
    expect(href).toContain('subject=Report%20AI%20response');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('aria-label')).toBe('Report this response');
    expect(anchor.getAttribute('title')).toBe('Report response');
  });

  it('puts the message id, its ISO timestamp and the excerpt in the body', () => {
    const text = body(render(makeMessage('the reported answer & more')));

    expect(text).toContain('Message ID: msg-42');
    expect(text).toContain('Response time: 1970-01-01T00:00:00.000Z');
    expect(text).toContain('the reported answer & more');
  });

  it('truncates the excerpt to 1,000 characters', () => {
    const long = 'a'.repeat(REPORT_EXCERPT_LIMIT) + 'TAIL';
    const text = body(render(makeMessage(long)));

    expect(text).toContain('a'.repeat(REPORT_EXCERPT_LIMIT));
    expect(text).not.toContain('TAIL');
  });

  it('omits the excerpt section when the response has no text', () => {
    const text = body(render(makeMessage('')));

    expect(text).toContain('Message ID: msg-42');
    expect(text).not.toContain('Response excerpt:');
  });
});
