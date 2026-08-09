import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import type { LiveFeedItem } from '@ptah-contracts/community';

import {
  BORDER_FILL_MISUSE,
  MUTED_TOO_FAINT,
  liveFeedItem,
  liveNowItem,
  replayItem,
} from '../live-fixtures';
import { SessionCard } from './session-card';

/**
 * ⚠️ THE TEST HOST IS `OnPush` TOO. `prefer-on-push-component-change-detection`
 * is an ERROR across this lib and makes no exception for a test host —
 * correctly, since a Default-strategy host re-renders on every tick and would
 * hide an `OnPush` defect in the component under test.
 */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SessionCard],
  template: `<ptah-session-card
    [item]="item()"
    (playRequested)="played.push($event)"
  />`,
})
class Host {
  public readonly item = signal<LiveFeedItem>(liveFeedItem());
  public readonly played: LiveFeedItem[] = [];
}

describe('SessionCard', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  const render = (item: LiveFeedItem): void => {
    host.item.set(item);
    fixture.detectChanges();
  };

  const text = (): string =>
    (fixture.nativeElement as HTMLElement).textContent ?? '';

  const html = (): string => (fixture.nativeElement as HTMLElement).innerHTML;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 R3.3 / ASSUMPTION-15 — no provenance anywhere                        */
  /* ---------------------------------------------------------------------- */

  describe('🔴 R3.3 — distinguished by state, never by source', () => {
    it.each<[string, LiveFeedItem]>([
      ['calendar-sourced upcoming', liveFeedItem()],
      ['ptah-sourced live', liveNowItem()],
      ['ptah-sourced replay', replayItem()],
      ['calendar-sourced replay', replayItem({ source: 'calendar' })],
    ])('renders no provenance for a %s item', (_label, item) => {
      render(item);

      // 🔴 THE ITEM'S OWN TITLE IS EXCLUDED, AND THAT IS A NARROWING RATHER
      // THAN A WEAKENING. The first version of this assertion failed on the
      // fixture "Ptah Builders — Weekly Live Session" — a REAL title off the
      // live calendar, which a member is supposed to read. Widening the regex
      // to allow the word anywhere would have deleted the assertion's value;
      // subtracting the one string the server told us to display keeps it.
      // (B10 made the same call when a bare `googleapis.com` needle matched the
      // app's own web fonts.)
      const chrome = text().replace(item.title, '');

      expect(chrome).not.toMatch(/google/i);
      expect(chrome).not.toMatch(/\bcalendar\b/i);
      expect(chrome).not.toMatch(/\bptah\b/i);
    });

    it('the exclusion above is not vacuous — the title IS rendered', () => {
      // Without this, the previous test could pass by rendering nothing at all.
      render(liveNowItem());
      expect(text()).toContain('Ptah Builders — Weekly Live Session');
    });

    it('renders IDENTICALLY for two items differing ONLY in source', () => {
      // The strongest form of the claim: swap the discriminant and nothing in
      // the DOM moves. A badge, a class, a title suffix — anything at all —
      // fails here.
      render(liveFeedItem({ source: 'calendar' }));
      const asCalendar = html().replace(/calendar:/g, 'SRC:');

      render(liveFeedItem({ source: 'ptah' }));
      const asPtah = html().replace(/ptah:/g, 'SRC:');

      expect(asPtah).toBe(asCalendar);
    });

    it('distinguishes the three STATES from one another', () => {
      render(liveNowItem());
      const live = html();

      render(liveFeedItem());
      const upcoming = html();

      render(replayItem());
      const replay = html();

      expect(live).not.toBe(upcoming);
      expect(upcoming).not.toBe(replay);
      expect(live).not.toBe(replay);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 RISK-AC — the state is the server's                                  */
  /* ---------------------------------------------------------------------- */

  describe('🔴 RISK-AC — `state` comes from the server and is never recomputed', () => {
    it('shows LIVE NOW for state:live even when startsAt is in the FUTURE', () => {
      // A clock-recomputing implementation would call this upcoming. The
      // server derives `state` from a single clock read; the client's clock is
      // not a second opinion.
      render(
        liveNowItem({ state: 'live', startsAt: '2099-01-01T00:00:00.000Z' }),
      );

      expect(text()).toContain('Live now');
    });

    it('does NOT show LIVE NOW for state:upcoming even when startsAt is in the PAST', () => {
      render(
        liveFeedItem({
          state: 'upcoming',
          startsAt: '1999-01-01T00:00:00.000Z',
        }),
      );

      expect(text()).not.toContain('Live now');
    });

    it('changes the marker when ONLY `state` changes, startsAt held fixed', () => {
      const fixed = '2026-08-09T14:00:00.000Z';

      render(liveFeedItem({ state: 'upcoming', startsAt: fixed }));
      expect(text()).not.toContain('Live now');

      render(liveNowItem({ state: 'live', startsAt: fixed }));
      expect(text()).toContain('Live now');
    });

    it('exposes the state as a data attribute for the e2e run', () => {
      render(replayItem());
      const article = fixture.debugElement.query(
        By.css('[data-session-state]'),
      );
      expect(article.nativeElement.getAttribute('data-session-state')).toBe(
        'replay',
      );
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The workspace-default shape: both nullable fields absent                */
  /* ---------------------------------------------------------------------- */

  describe('the null-metadata default (ASSUMPTION-6)', () => {
    it('renders no runtime at all when durationSeconds is null', () => {
      // Every one of the fifty live upcoming items measured on 2026-08-09 has
      // `durationSeconds: null`. A "0:00" here would assert something the
      // server never sent.
      render(liveFeedItem({ durationSeconds: null }));

      expect(text()).not.toContain('0:00');
      expect(text()).not.toContain('·  ·');
    });

    it('renders the runtime when the server DID resolve one', () => {
      render(replayItem({ durationSeconds: 1800 }));
      expect(text()).toContain('30:00');
    });

    it('renders NO play button for a replay with no video id', () => {
      // `'replay'` is only emitted when there is something to replay, so this
      // combination should be unreachable — but a dead play button is a worse
      // failure mode than a missing one, so the branch is asserted rather than
      // assumed.
      render(replayItem({ youtubeVideoId: null }));

      expect(fixture.debugElement.query(By.css('button'))).toBeNull();
    });

    it('renders no end time when endsAt is null', () => {
      render(liveNowItem({ endsAt: null }));
      expect(text()).not.toContain('–');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The join affordance                                                     */
  /* ---------------------------------------------------------------------- */

  describe('the join link', () => {
    it('renders a real external anchor with noopener noreferrer', () => {
      render(liveFeedItem());
      const anchor = fixture.debugElement.query(By.css('a'));

      expect(anchor.nativeElement.getAttribute('href')).toBe(
        'https://meet.google.com/yef-rhxk-iwz',
      );
      expect(anchor.nativeElement.getAttribute('target')).toBe('_blank');
      expect(anchor.nativeElement.getAttribute('rel')).toBe(
        'noopener noreferrer',
      );
    });

    it('says the link is published later rather than rendering a dead button', () => {
      render(liveFeedItem({ meetLink: null }));

      expect(fixture.debugElement.query(By.css('a'))).toBeNull();
      expect(text()).toContain(
        'The join link is published by the host closer to the start time.',
      );
    });

    it('reads "Join now" while live and "Join session" while upcoming', () => {
      render(liveNowItem());
      expect(text()).toContain('Join now');

      render(liveFeedItem());
      expect(text()).toContain('Join session');
    });

    it('renders NO join link on a replay even when one is present', () => {
      // A finished session's conference room is not somewhere to send anyone.
      render(replayItem({ meetLink: 'https://meet.google.com/ope-zmee-szb' }));
      expect(fixture.debugElement.query(By.css('a'))).toBeNull();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The replay output — the card asks, the page decides                     */
  /* ---------------------------------------------------------------------- */

  describe('the play output', () => {
    it('emits the whole item when the replay button is activated', () => {
      const item = replayItem();
      render(item);

      fixture.debugElement
        .query(By.css('button'))
        .nativeElement.dispatchEvent(new MouseEvent('click'));
      fixture.detectChanges();

      expect(host.played).toEqual([item]);
    });

    it('🔴 constructs no iframe and no embed URL of its own (NFR-S3)', () => {
      // `youtube-embed-chokepoint.spec.ts` pins the bypass to ONE file. This is
      // the local half of that claim: activating a replay here changes nothing
      // in the DOM but the emitted event.
      render(replayItem());
      fixture.debugElement
        .query(By.css('button'))
        .nativeElement.dispatchEvent(new MouseEvent('click'));
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('iframe'))).toBeNull();
      expect(html()).not.toContain('youtube');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* a11y and tokens                                                         */
  /* ---------------------------------------------------------------------- */

  describe('accessibility and tokens', () => {
    it.each<[LiveFeedItem['state'], string, LiveFeedItem]>([
      ['live', 'Live now', liveNowItem()],
      ['upcoming', 'Upcoming session', liveFeedItem()],
      ['replay', 'Replay', replayItem()],
    ])('names the %p card "%s: <title>"', (_state, label, item) => {
      render(item);
      const article = fixture.debugElement.query(By.css('article'));

      expect(article.nativeElement.getAttribute('aria-label')).toBe(
        `${label}: ${item.title}`,
      );
    });

    it('marks the live dot decorative so it is not announced', () => {
      render(liveNowItem());
      const dot = fixture.debugElement.query(By.css('.animate-pulse'));
      expect(dot.nativeElement.getAttribute('aria-hidden')).toBe('true');
    });

    it('gives the activation control a >= 44px touch target', () => {
      render(replayItem());
      expect(
        fixture.debugElement.query(By.css('button')).nativeElement.className,
      ).toContain('min-h-11');
    });

    it('🔴 uses base-300 only as a FILL, never as a border', () => {
      // The Task 4.7 lint rule catches the source; this catches the render,
      // which is the pattern B7 established after `stat-tile.html` shipped
      // exactly this bug.
      for (const item of [liveFeedItem(), liveNowItem(), replayItem()]) {
        render(item);
        expect(html()).not.toContain(BORDER_FILL_MISUSE);
      }
    });

    it('🔴 uses no muted token below the AA floor', () => {
      // panel-theme-spec.md §2 measures /40 at 3.18:1. /60 is the muted token
      // this design system actually prescribes.
      for (const item of [liveFeedItem(), liveNowItem(), replayItem()]) {
        render(item);
        expect(html()).not.toContain(MUTED_TOO_FAINT);
      }
    });

    it('exposes the source-qualified key, never the bare id (RISK-AA)', () => {
      render(liveFeedItem({ id: 'shared', source: 'ptah' }));
      const article = fixture.debugElement.query(By.css('[data-session-key]'));
      expect(article.nativeElement.getAttribute('data-session-key')).toBe(
        'ptah:shared',
      );
    });
  });
});
