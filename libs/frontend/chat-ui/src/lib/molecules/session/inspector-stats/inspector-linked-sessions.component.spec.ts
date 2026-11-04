import { TestBed } from '@angular/core/testing';
import {
  InspectorLinkedSessionsComponent,
  type InspectorLinkedSessionEntry,
} from './inspector-linked-sessions.component';

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';
const C = 'cccccccc-3333-4333-8333-333333333333';

function render(
  entries: readonly InspectorLinkedSessionEntry[],
  currentSessionId: string | null = null,
) {
  TestBed.configureTestingModule({
    imports: [InspectorLinkedSessionsComponent],
  });
  const fixture = TestBed.createComponent(InspectorLinkedSessionsComponent);
  fixture.componentRef.setInput('entries', entries);
  fixture.componentRef.setInput('currentSessionId', currentSessionId);
  fixture.detectChanges();
  const opened: string[] = [];
  fixture.componentInstance.openSession.subscribe((id) => opened.push(id));
  return { fixture, root: fixture.nativeElement as HTMLElement, opened };
}

const buttons = (root: HTMLElement) =>
  Array.from(
    root.querySelectorAll<HTMLButtonElement>(
      '[data-testid="inspector-linked-session"]',
    ),
  );
const text = (el: Element | null) => el?.textContent?.trim() ?? '';

const chainOnB: readonly InspectorLinkedSessionEntry[] = [
  { sessionId: A, label: 'Plan the refactor', relation: 'from' },
  { sessionId: B, label: 'Implement batch 2', relation: 'current' },
  { sessionId: C, label: 'Review and ship', relation: 'in' },
];

describe(InspectorLinkedSessionsComponent.name, () => {
  it('labels the section by its "Linked sessions" heading', () => {
    const { root } = render(chainOnB, B);
    const section = root.querySelector('section');
    const heading = root.querySelector('h3');
    expect(text(heading)).toBe('Linked sessions');
    expect(heading?.classList).not.toContain('uppercase');
    expect(section?.getAttribute('aria-labelledby')).toBe(heading?.id);
  });

  it('lists a chain of three on B root first: A from, B current, C in', () => {
    const { root } = render(chainOnB, B);
    const rows = buttons(root);
    expect(rows.map((b) => b.dataset['sessionId'])).toEqual([A, B, C]);
    expect(
      rows.map((b) =>
        text(b.querySelector('[data-testid="inspector-linked-session-relation"]')),
      ),
    ).toEqual(['Continued from', 'This session', 'Continued in']);
    expect(rows.map((b) => b.getAttribute('aria-current'))).toEqual([
      null,
      'true',
      null,
    ]);
    expect(rows[1].classList).toContain('bg-surface-2');
    expect(rows[1].classList).toContain('font-semibold');
    expect(rows[0].classList).toContain('font-medium');
    expect(rows[1].querySelector('.bg-secondary')).not.toBeNull();
    expect(rows[0].querySelector('.bg-secondary')).toBeNull();
    expect(rows.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Open Plan the refactor, continued from',
      'Current session, Implement batch 2',
      'Open Review and ship, continued in',
    ]);
    expect(rows.every((b) => b.type === 'button')).toBe(true);
  });

  it('does not emit openSession when the current row is activated', () => {
    const { root, opened } = render(chainOnB, B);
    buttons(root)[1].click();
    expect(opened).toEqual([]);
  });

  it('emits openSession with the id of another activated row', () => {
    const { root, opened } = render(chainOnB, B);
    buttons(root)[0].click();
    buttons(root)[2].click();
    expect(opened).toEqual([A, C]);
  });

  it('truncates a long label and keeps the full label in title and name', () => {
    const long = 'A very long session label '.repeat(8).trim();
    const { root } = render(
      [
        { sessionId: A, label: long, relation: 'from' },
        { sessionId: B, label: 'Short', relation: 'current' },
      ],
      B,
    );
    const title = buttons(root)[0].querySelector(
      '[data-testid="inspector-linked-session-title"]',
    );
    expect(title?.classList).toContain('truncate');
    expect(title?.classList).toContain('min-w-0');
    expect(title?.getAttribute('title')).toBe(long);
    expect(buttons(root)[0].getAttribute('aria-label')).toBe(
      `Open ${long}, continued from`,
    );
    const relation = buttons(root)[0].querySelector(
      '[data-testid="inspector-linked-session-relation"]',
    );
    expect(relation?.classList).toContain('shrink-0');
    expect(relation?.classList).toContain('whitespace-nowrap');
  });

  it('falls back to "Session " plus 8 id characters for a missing name and keeps the button', () => {
    const { root, opened } = render(
      [
        { sessionId: A, label: null, relation: 'from' },
        { sessionId: B, label: '  ', relation: 'current' },
      ],
      B,
    );
    const [first, second] = buttons(root);
    const title = first.querySelector(
      '[data-testid="inspector-linked-session-title"]',
    );
    expect(text(title)).toBe('Session aaaaaaaa');
    expect(title?.getAttribute('title')).toBe('Session aaaaaaaa');
    expect(title?.classList).toContain('text-base-content-muted');
    expect(second.getAttribute('aria-label')).toBe(
      'Current session, Session bbbbbbbb',
    );
    first.click();
    expect(opened).toEqual([A]);
  });

  it('keeps every row of a long chain inside the 10.5rem scroll viewport', () => {
    const ids = Array.from(
      { length: 7 },
      (_, i) => `${String(i).repeat(8)}-0000-4000-8000-000000000000`,
    );
    const entries = ids.map(
      (sessionId, i): InspectorLinkedSessionEntry => ({
        sessionId,
        label: `Hop ${i + 1}`,
        relation: i === 6 ? 'current' : 'from',
      }),
    );
    const { root } = render(entries, ids[6]);
    const list = root.querySelector(
      '[data-testid="inspector-linked-sessions-list"]',
    );
    expect(list?.classList).toContain('max-h-[10.5rem]');
    expect(list?.classList).toContain('overflow-y-auto');
    expect(buttons(root)).toHaveLength(7);
    expect(root.textContent).not.toContain('Show more');
  });

  it('marks no row current when the open id is not in the chain', () => {
    const { root } = render(
      [
        { sessionId: A, label: 'One', relation: 'from' },
        { sessionId: C, label: 'Two', relation: 'in' },
      ],
      B,
    );
    expect(
      buttons(root).some((b) => b.getAttribute('aria-current') === 'true'),
    ).toBe(false);
  });
});
