import { TestBed } from '@angular/core/testing';
import { LaneThreadRowComponent } from './lane-thread-row.component';
import type { LaneThreadEntry } from './lane-thread';

function render(entry: LaneThreadEntry): HTMLElement {
  const fixture = TestBed.createComponent(LaneThreadRowComponent);
  fixture.componentRef.setInput('entry', entry);
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).querySelector('[role="listitem"]')!;
}

describe('LaneThreadRowComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [LaneThreadRowComponent] }));

  it('renders a lane-sender entry with its name, its own border and an accessible label', () => {
    const item = render({ id: 'receipt:peer-1', sender: 'From lane Schema', senderKind: 'peer-lane', senderAgentId: 'agent-2',
      kind: 'message', timestamp: 1_700_000_000_000, body: 'Schema is ready' });
    expect(item.textContent).toContain('From lane Schema');
    expect(item.getAttribute('aria-label')).toMatch(/^From lane Schema, .+, message$/);
    expect(item.getAttribute('data-sender-kind')).toBe('peer-lane');
    expect(item.classList.contains('border-secondary')).toBe(true);
    expect(item.classList.contains('border-info')).toBe(false);
    expect(item.classList.contains('border-primary')).toBe(false);
    expect(item.classList.contains('border-success')).toBe(false);
    expect(item.querySelector('span.font-semibold')?.getAttribute('title')).toBe('agent-2');
  });

  it('styles by entry kind, not by the label text', () => {
    // A parent label that happens to read "You" must still style as the parent.
    const item = render({ id: 'm', sender: 'You', senderKind: 'parent', kind: 'message', timestamp: 1, body: 'x' });
    expect(item.classList.contains('border-info')).toBe(true);
    expect(item.classList.contains('border-primary')).toBe(false);
  });

  it('marks a failed completion of this lane as an error only', () => {
    const item = render({ id: 'completion', sender: 'Docs · Codex', senderKind: 'this-lane', kind: 'completion',
      timestamp: 1, body: '', verdict: 'Failed' });
    expect(item.classList.contains('border-error')).toBe(true);
    expect(item.classList.contains('border-success')).toBe(false);
  });
});
