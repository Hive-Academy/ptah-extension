import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ThreadRow } from './thread-row';

/**
 * `ThreadRow` is promoted into `@ptah-web/panel-ui` by TASK_2026_177 Batch 7
 * because a SECOND panel renders it (§5.3). These cases pin the behaviour both
 * consumers depend on, and one — the projection slot — is the reason it is a
 * shared primitive at all rather than two similar inline templates.
 */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ThreadRow],
  template: `
    <ptah-thread-row
      [title]="title"
      [author]="author"
      [replyCount]="replyCount"
      [unreadCount]="unreadCount"
      [pinned]="pinned"
      [locked]="locked"
      [accepted]="accepted"
    >
      <span data-testid="projected">Announcements</span>
    </ptah-thread-row>
  `,
})
class HostComponent {
  public title = 'How do I wire a second provider tree?';
  public author: string | null = 'Ada Lovelace';
  public replyCount = 4;
  public unreadCount = 0;
  public pinned = false;
  public locked = false;
  public accepted = false;
}

function render(setup: (host: HostComponent) => void = () => undefined) {
  const fixture = TestBed.createComponent(HostComponent);
  setup(fixture.componentInstance);
  fixture.detectChanges();
  return fixture;
}

describe('ThreadRow', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  it('renders the title, the author and a pluralised reply count', () => {
    const text: string = render().nativeElement.textContent;

    expect(text).toContain('How do I wire a second provider tree?');
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('4 replies');
  });

  it('says "1 reply", not "1 replies"', () => {
    // The singular is the case a template-only implementation gets wrong, and
    // it is the count most rows actually have.
    const text: string = render((h) => (h.replyCount = 1)).nativeElement
      .textContent;

    expect(text).toContain('1 reply');
    expect(text).not.toContain('1 replies');
  });

  it('renders "Unknown" for a null author rather than a blank gap', () => {
    // `authorName` is null for migrated/system content (A-4) and for a deleted
    // account. Omitting the segment would change the metadata line's shape
    // between rows in the same list.
    const text: string = render((h) => (h.author = null)).nativeElement
      .textContent;

    expect(text).toContain('Unknown');
  });

  it('renders NO unread badge at zero', () => {
    // R1.7.3's principle applied to a row: a "0 new" chip is noise on every
    // read topic in the list.
    const fixture = render((h) => (h.unreadCount = 0));

    expect(fixture.nativeElement.querySelector('.badge-primary')).toBeNull();
  });

  it('renders the unread badge when there is unread activity (R1.6.2)', () => {
    const fixture = render((h) => (h.unreadCount = 3));
    const badge = fixture.nativeElement.querySelector('.badge-primary');

    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain('3 new');
  });

  it('labels the unread badge as REPLIES — a row counts posts, not topics', () => {
    // The member panel has a near-identical chip on the category rail counting
    // TOPICS with unread activity. Both read "N new"; this label is where a row
    // commits to which number it is showing.
    expect(
      render((h) => (h.unreadCount = 3))
        .nativeElement.querySelector('.badge-primary')
        .getAttribute('aria-label'),
    ).toBe('3 unread replies');

    expect(
      render((h) => (h.unreadCount = 1))
        .nativeElement.querySelector('.badge-primary')
        .getAttribute('aria-label'),
    ).toBe('1 unread reply');
  });

  it('renders the pinned, locked and accepted markers only when set', () => {
    const off: HTMLElement = render().nativeElement;
    expect(off.querySelector('[aria-label="Pinned"]')).toBeNull();
    expect(off.querySelector('[aria-label="Locked"]')).toBeNull();
    expect(
      off.querySelector('[aria-label="Has an accepted answer"]'),
    ).toBeNull();

    const on: HTMLElement = render((h) => {
      h.pinned = true;
      h.locked = true;
      h.accepted = true;
    }).nativeElement;
    expect(on.querySelector('[aria-label="Pinned"]')).not.toBeNull();
    expect(on.querySelector('[aria-label="Locked"]')).not.toBeNull();
    expect(
      on.querySelector('[aria-label="Has an accepted answer"]'),
    ).not.toBeNull();
  });

  it('projects consumer-supplied trailing metadata', () => {
    // This is the seam that lets the member feed render a category chip + a
    // <time> while the admin table renders an author email — the reason the
    // row is one shared primitive instead of two inline templates.
    const projected = render().nativeElement.querySelector(
      '[data-testid="projected"]',
    );

    expect(projected).not.toBeNull();
    expect(projected.textContent).toBe('Announcements');
  });

  it('uses no `border-base-300` anywhere (NFR-U2)', () => {
    // `libs/web/panel-ui` sits OUTSIDE the Task 4.7 lint rule, which is scoped
    // to `libs/web/members/**` — so the rule cannot catch this here. base-300 is
    // a FILL and never a border (panel-theme-spec.md §2); at 1.036:1 against a
    // base-200 card it is invisible. `stat-tile.html` shipped that exact bug
    // once, which is why this is asserted rather than left to review.
    const html: string = render().nativeElement.innerHTML;

    expect(html).not.toContain('border-base-300');
  });
});
