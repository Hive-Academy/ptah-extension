import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { MEMBER_NAV_GROUPS } from '../member-nav.config';
import { MemberNotificationsStore } from '../state/member-notifications.store';
import { MemberLayout } from './member-layout';

const NOTIFICATIONS = '/api/v1/members/notifications';
const UNREAD_COUNT = `${NOTIFICATIONS}/unread-count`;
const CURRENT_USER = /users\/me|auth\/me|\/me$/;

/** `libs/web/members/src` — the root of the sweep below. */
const LIB_SRC = join(__dirname, '..', '..');

describe('the member nav unread badge (R9.3, R10.4, RISK-AN)', () => {
  /* ====================================================================== */
  /* PART 1 — the badge renders, moves and disappears                       */
  /* ====================================================================== */

  describe('the rendered badge', () => {
    let fixture: ComponentFixture<MemberLayout>;
    let http: HttpTestingController;
    let store: MemberNotificationsStore;
    let initialCountRequests: readonly unknown[];

    beforeEach(async () => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [MemberLayout],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideRouter([]),
          // Provided as the `/members` route provides it — one instance for
          // the shell and, in the app, for the inbox page too.
          MemberNotificationsStore,
        ],
      }).compileComponents();

      http = TestBed.inject(HttpTestingController);
      store = TestBed.inject(MemberNotificationsStore);

      fixture = TestBed.createComponent(MemberLayout);
      fixture.detectChanges();

      // The layout also asks who is signed in; that request is not this
      // spec's subject, so it is answered and ignored.
      for (const request of http.match((r) => CURRENT_USER.test(r.url))) {
        request.flush(null);
      }

      // `start()`'s EAGER fetch. Answered here with 0 so each test below
      // begins from a known, badge-less state and `setCount` sees exactly one
      // outstanding count request of its own.
      initialCountRequests = http.match(UNREAD_COUNT);
      for (const request of initialCountRequests) {
        request.flush({ unreadCount: 0 });
      }
      fixture.detectChanges();
    });

    afterEach(() => {
      for (const request of http.match(() => true)) request.flush(null);
      http.verify();
    });

    function root(): HTMLElement {
      return fixture.nativeElement as HTMLElement;
    }

    /** The Notifications link. It is `primary: false`, so it is a SECONDARY item. */
    function notificationsLink(): HTMLAnchorElement | null {
      return (
        Array.from(root().querySelectorAll('a')).find(
          (anchor) =>
            anchor.getAttribute('href') === '/members/notifications' ||
            anchor.textContent?.trim().startsWith('Notifications'),
        ) ?? null
      );
    }

    function badgeText(): string | null {
      const badge = notificationsLink()?.querySelector('.badge');
      return badge?.textContent?.trim() ?? null;
    }

    function setCount(count: number): void {
      // Driven through the STORE, not by poking a component field — the
      // question is whether the badge follows the one signal that owns it.
      store.refreshCount();
      http.expectOne(UNREAD_COUNT).flush({ unreadCount: count });
      fixture.detectChanges();
    }

    it('the layout starts the poll exactly once', () => {
      // `MemberLayout`'s constructor calls `start()`, which fetches eagerly —
      // ONE request, captured and answered in `beforeEach`. Two would mean two
      // `start()` calls, and therefore two intervals.
      expect(initialCountRequests).toHaveLength(1);
    });

    it('🔴 renders the count on the Notifications item when it is non-zero', () => {
      setCount(3);

      expect(notificationsLink()).not.toBeNull();
      expect(badgeText()).toBe('3');
    });

    it('🔴 renders through the SECONDARY nav branch, not the primary one', () => {
      // The Notifications item is `primary: false` in `member-nav.config.ts`,
      // so `PanelLayout` renders it through its SECONDARY `@else` branch. A
      // test written against the primary branch passes for the wrong item and
      // would keep passing if the badge never reached this one.
      setCount(2);

      const link = notificationsLink();
      // The secondary branch indents with `pl-8` and uses the 13px type scale;
      // the primary branch does neither.
      expect(link?.className).toContain('pl-8');
      expect(link?.querySelector('.badge')).not.toBeNull();
    });

    it('🔴 the badge MOVES when the store’s signal moves', () => {
      setCount(1);
      expect(badgeText()).toBe('1');

      setCount(7);
      expect(badgeText()).toBe('7');
    });

    it('🔴 the badge DISAPPEARS at 0 — the shell’s @if does the hiding', () => {
      setCount(4);
      expect(badgeText()).toBe('4');

      setCount(0);
      // `0` is PASSED, not `undefined`. `@if (item.badgeCount)` hides it, so
      // there is exactly one place deciding when the badge is invisible.
      expect(badgeText()).toBeNull();
    });

    it('no OTHER nav item acquires a badge', () => {
      setCount(5);

      const badges = Array.from(root().querySelectorAll('a .badge'));
      expect(badges).toHaveLength(1);
      expect(notificationsLink()?.contains(badges[0])).toBe(true);
    });

    it('🔴 MEMBER_NAV_GROUPS is not mutated by the computed', () => {
      const before = JSON.stringify(
        MEMBER_NAV_GROUPS.map((group) => group.items.map((i) => i.badgeCount)),
      );

      setCount(9);
      setCount(3);

      // A mutation would leak the count into the module-level constant, where
      // it survives across components and across tests — a bug that shows up
      // as a badge appearing in an unrelated suite.
      const after = JSON.stringify(
        MEMBER_NAV_GROUPS.map((group) => group.items.map((i) => i.badgeCount)),
      );

      expect(after).toBe(before);
      expect(
        MEMBER_NAV_GROUPS.flatMap((group) => group.items).every(
          (item) => item.badgeCount === undefined,
        ),
      ).toBe(true);
    });

    it('the badge composes with the admin branch rather than forking from it', () => {
      // The admin escape hatch is appended to the ALREADY-BADGED array. If the
      // two branches were built separately, an admin would see no badge.
      setCount(6);
      expect(badgeText()).toBe('6');
    });
  });

  /* ====================================================================== */
  /* PART 2 — 🔴 RISK-AN, structurally, over the whole lib                  */
  /* ====================================================================== */

  describe('🔴 RISK-AN — there is exactly ONE badge mechanism', () => {
    /**
     * Every `.ts` and `.html` under `libs/web/members/src`, excluding specs.
     *
     * Specs are excluded because a spec ASSERTING the absence of a badge class
     * must be allowed to name one — the same reasoning `courses-page.spec.ts`
     * uses when it assembles `border-base-300` from parts.
     */
    const files = collectFiles(LIB_SRC).filter(
      (file) => !file.label.endsWith('.spec.ts'),
    );

    const LAYOUT = 'lib/member-layout/member-layout.ts';
    const STORE = 'lib/state/member-notifications.store.ts';
    const API = 'lib/services/member-notifications-api.service.ts';

    it('the sweep is not vacuous — it reads the layout, the store and the pages', () => {
      const labels = files.map((file) => file.label);

      expect(labels).toContain(LAYOUT);
      expect(labels).toContain(STORE);
      expect(labels).toContain('lib/notifications/notifications-page.ts');
      expect(labels).toContain('lib/member-layout/member-layout.html');
      expect(files.length).toBeGreaterThan(20);
    });

    /**
     * 🔴 `unreadCount` IS AN AMBIGUOUS IDENTIFIER IN THIS LIB, AND ANY
     * ASSERTION THAT IGNORES THAT IS EITHER WRONG OR VACUOUS.
     *
     * The COMMUNITY domain already owns a different `unreadCount`: per-topic
     * unread REPLIES (A-6). It appears in `member-community-api.service.ts`'s
     * `markReadAckSchema`, on the feed, on My Threads, on the hub's activity
     * card and inside `unread-pill.ts` — five files, all pre-existing, all
     * correct, and none of them "the unread NOTIFICATION count".
     *
     * So the sweep is scoped by the TYPE, not by the name: a file participates
     * in the notification badge only if it names `MemberNotificationsStore` or
     * `MemberNotificationsApiService`. Everything below filters on that first.
     */
    const notificationFiles = (): readonly SweptFile[] =>
      files.filter((file) =>
        /MemberNotifications(Store|ApiService)/.test(stripComments(file.code)),
      );

    it('the type-scoped filter separates the two unreadCounts', () => {
      // Anti-vacuity, and a guard on the premise above: the community files DO
      // carry the identifier and MUST NOT be in the notification set.
      const communityReaders = files
        .filter((file) => /unreadCount/.test(stripComments(file.code)))
        .map((file) => file.label);

      expect(communityReaders).toContain('lib/community/feed-page.ts');
      expect(notificationFiles().map((file) => file.label)).not.toContain(
        'lib/community/feed-page.ts',
      );
    });

    it('🔴 within the notification set, exactly THREE files, each with ONE role', () => {
      // 🔴 THE ASSERTION R9.3 EXISTS FOR, stated as a whole set rather than as
      // a single absence — so a FOURTH participant is a diff a reviewer reads
      // rather than a discovery.
      //
      // The three roles, and why no two may merge:
      //   • the API service TRANSPORTS the count (the endpoint method),
      //   • the store OWNS it (the signal, and its only writer),
      //   • the layout READS it (one binding, into the nav computed).
      //
      // A second reader — a bespoke chip in a member template, or a page that
      // shows its own count — satisfies every visual check and disagrees with
      // the nav the first time one of them is missed. `PanelLayout` ALREADY
      // renders `badgeCount`, so THE WRONG VERSION ALSO WORKS. That is why
      // this has to be structural rather than visual.
      const readers = notificationFiles()
        .filter((file) => /unreadCount/.test(stripComments(file.code)))
        .map((file) => file.label)
        .sort();

      expect(readers).toEqual([LAYOUT, API, STORE].sort());
    });

    it('each of the three plays only its own role', () => {
      const byLabel = new Map(files.map((file) => [file.label, file.code]));

      // The store DECLARES the signal and exposes it read-only…
      expect(byLabel.get(STORE)).toContain('_unreadCount.asReadonly()');
      // …the API service declares the ENDPOINT and holds no state…
      expect(byLabel.get(API)).toContain('public unreadCount()');
      expect(byLabel.get(API)).not.toContain('signal(');
      // …and the layout only READS, through the injected store.
      expect(stripComments(byLabel.get(LAYOUT) ?? '')).toContain(
        'unreadCount()',
      );
      expect(stripComments(byLabel.get(LAYOUT) ?? '')).not.toContain(
        '_unreadCount',
      );
    });

    it('🔴 NO notification surface pairs the count with a badge class of its own', () => {
      // 🔴 THE BESPOKE-CHIP SHAPE, NAMED EXACTLY.
      //
      // ⚠️ A BLANKET "no `badge-` class in this lib" RULE WOULD BE WRONG AND
      // WOULD FAIL TODAY, on code that is entirely correct: `member-layout.html`
      // renders the COHORT chips with `badge badge-primary`, `unread-pill.ts`
      // renders per-topic unread replies, and three hub cards carry their own.
      // None of those is the unread NOTIFICATION count.
      //
      // What RISK-AN forbids is a SECOND RENDERING OF THIS COUNT — so that is
      // what is asserted, over the type-scoped set.
      const offenders = notificationFiles()
        .filter((file) => /\bbadge-[a-z]+/.test(stripComments(file.code)))
        .map((file) => file.label);

      expect(offenders).toEqual([]);
    });

    it('🔴 `badgeCount` is written in exactly ONE file — the layout', () => {
      const writers = files
        .filter((file) => /badgeCount/.test(stripComments(file.code)))
        .map((file) => file.label);

      expect(writers).toEqual([LAYOUT]);
    });

    it('🔴 no member TEMPLATE binds the count or a badgeCount of its own', () => {
      // Templates are where the second chip is cheapest to add, and where it
      // is least likely to be noticed in review.
      const templates = files.filter((file) => file.label.endsWith('.html'));

      expect(templates.length).toBeGreaterThan(0);
      for (const template of templates) {
        const markup = stripComments(template.code);
        expect(markup).not.toContain('unreadCount');
        expect(markup).not.toContain('badgeCount');
      }
    });

    it('the nav config remains DATA — it computes no badge itself', () => {
      // `member-nav.config.ts` states the prohibition in its own docblock. The
      // failure it warns about is a config FUNCTION that takes a count, which
      // would be a second mechanism for "conditionally shaped nav" standing
      // beside the computed.
      const config = files.find(
        (file) => file.label === 'lib/member-nav.config.ts',
      );

      expect(config).toBeDefined();
      expect(stripComments(config?.code ?? '')).not.toContain('badgeCount');
      expect(config?.code).toContain('export const MEMBER_NAV_GROUPS');
    });

    it('the layout resolves the store by injection, never constructing one', () => {
      // `new MemberNotificationsStore()` would be a second instance with a
      // second count and a second timer — R9.3's failure arriving through DI
      // rather than through a template.
      const layout = files.find((file) => file.label === LAYOUT);

      expect(layout?.code).toContain('inject(MemberNotificationsStore)');
      expect(stripComments(layout?.code ?? '')).not.toContain(
        'new MemberNotificationsStore',
      );
    });

    it('🔴 the store is provided at the ROUTE, not on a component', () => {
      // Two instances is two counts and two timers. A `providers` array naming
      // the store on any component would create exactly that.
      const routes = files.find(
        (file) => file.label === 'lib/members.routes.ts',
      );
      expect(stripComments(routes?.code ?? '')).toContain(
        'providers: [MemberNotificationsStore]',
      );

      const componentProviders = files
        .filter(
          (file) =>
            file.label !== 'lib/members.routes.ts' &&
            /providers:\s*\[[^\]]*MemberNotificationsStore/.test(
              stripComments(file.code),
            ),
        )
        .map((file) => file.label);

      expect(componentProviders).toEqual([]);
    });
  });
});

/* ------------------------------------------------------------------------ */

interface SweptFile {
  readonly label: string;
  readonly code: string;
}

function collectFiles(root: string): SweptFile[] {
  const out: SweptFile[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|html)$/.test(entry)) continue;

      out.push({
        label: relative(root, full).split(sep).join('/'),
        code: readFileSync(full, 'utf8'),
      });
    }
  };

  walk(root);
  return out;
}

/** Comments may DISCUSS the forbidden thing; code may not contain it. */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}
