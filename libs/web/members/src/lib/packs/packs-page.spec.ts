import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import type { MemberPack } from '@ptah-contracts/community';

import { DEFAULT_ACCESS_NOTE } from '../services/member-packs-api.service';
import { PacksPage } from './packs-page';

const PACKS = '/api/v1/members/packs';

/**
 * `border-base-300` — the class this panel must never emit (`base-300` is a
 * FILL, panel-theme-spec.md §2).
 *
 * ⚠️ ASSEMBLED RATHER THAN WRITTEN AS A LITERAL, and that is not a workaround
 * for the rule — it is the only way to assert it from INSIDE this lib. Task
 * 4.7's `no-restricted-syntax` selector matches ANY string literal containing
 * the token, including one written in a spec in order to prove its ABSENCE.
 */
const BORDER_FILL_MISUSE = ['border', 'base-300'].join('-');

/** The `/40` opacity B13's F-1 proved is a real 3.2:1 WCAG AA failure on text. */
const LOW_CONTRAST_TEXT = ['text', 'base-content/40'].join('-');

/** The live cohort-labelled pack, captured from `:3011` at `54650edee`. */
function labelledPack(overrides: Partial<MemberPack> = {}): MemberPack {
  return {
    id: 'b15a_pack_labelled',
    slug: 'b15a-labelled',
    title: 'B15A Labelled Pack',
    description: 'Visible and cohort-labelled.',
    repoUrl: 'https://github.com/x/labelled',
    tags: ['agents', 'nx'],
    cohortName: 'Founding Members',
    accessNote: 'Invite lands within 24h of your GitHub handle being shared.',
    ...overrides,
  };
}

/** The live unlabelled pack — both nullable fields actually null. */
function unlabelledPack(): MemberPack {
  return {
    id: 'b15a_pack_unlabelled',
    slug: 'b15a-unlabelled',
    title: 'B15A Unlabelled Pack',
    description: 'Visible with no cohort label.',
    repoUrl: 'https://github.com/x/unlabelled',
    tags: [],
    cohortName: null,
    accessNote: null,
  };
}

describe('PacksPage (R5.1, R5.5, R5.7, RISK-AQ, NFR-U)', () => {
  let fixture: ComponentFixture<PacksPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PacksPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PacksPage);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function root(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return (root().textContent ?? '').replace(/\s+/g, ' ');
  }

  function html(): string {
    return root().innerHTML;
  }

  function flush(body: unknown, opts?: { status: number }): void {
    const request = http.expectOne(PACKS);
    if (opts) {
      request.flush(body, { status: opts.status, statusText: 'Error' });
    } else {
      request.flush(body);
    }
    fixture.detectChanges();
  }

  function cards(): HTMLElement[] {
    return Array.from(root().querySelectorAll('[data-pack-slug]'));
  }

  /**
   * Every element that renders TEXT A MEMBER MUST READ.
   *
   * "Text-bearing" means it owns a non-whitespace DIRECT text child — so a
   * wrapper `div` whose text lives in a descendant is not counted twice — and
   * is not inside an `aria-hidden` subtree, because a decorative glyph is not
   * text and no contrast ratio applies to it. `<svg>` internals are excluded
   * for the same reason.
   */
  function textBearingElements(): HTMLElement[] {
    return Array.from(root().querySelectorAll<HTMLElement>('*')).filter(
      (element) => {
        if (element.closest('[aria-hidden="true"]')) return false;
        if (element.closest('svg')) return false;

        return Array.from(element.childNodes).some(
          (node) =>
            node.nodeType === Node.TEXT_NODE &&
            (node.textContent ?? '').trim().length > 0,
        );
      },
    );
  }

  /**
   * 🔴 R5.5's actual assertion: the note PRECEDES the link in DOM order.
   *
   * `compareDocumentPosition` rather than comparing `innerHTML` indices,
   * because the first is a statement about the DOM tree and the second is a
   * statement about a string that happens to serialise it.
   */
  function expectNoteBeforeLink(card: HTMLElement): void {
    const note = card.querySelector('[data-access-note]');
    const link = card.querySelector('[data-repo-link]');

    if (note === null || link === null) {
      throw new Error('the card is missing its access note or its repo link');
    }

    expect(
      note.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }

  function expectNoLowContrastText(): void {
    for (const element of textBearingElements()) {
      expect({
        tag: element.tagName.toLowerCase(),
        text: (element.textContent ?? '').trim().slice(0, 40),
        className: element.className,
      }).toEqual(
        expect.objectContaining({
          className: expect.not.stringContaining(LOW_CONTRAST_TEXT),
        }),
      );
    }
  }

  /* ---------------------------------------------------------------------- */
  /* 🔴 RISK-AQ — four distinct cells, each asserted BY ITS COPY             */
  /* ---------------------------------------------------------------------- */

  describe('🔴 RISK-AQ — error, loading, empty and list are four different renders', () => {
    it('LOADING: a resolving busy state, never a spinner that hangs', () => {
      expect(root().querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(text()).toContain('Loading your packs');

      flush([]);
    });

    it('EMPTY: the server answered and nothing is member-visible', () => {
      flush([]);

      // The exact sentence matters: it says the packs are not there YET and
      // that nothing is wrong with the account.
      expect(text()).toContain('No packs are available to you yet.');
      expect(text()).toContain('Nothing is missing from your account.');
      expect(text()).not.toContain('We could not load your packs.');
    });

    it('ERROR: our request failed — a DIFFERENT sentence from empty', () => {
      flush(null, { status: 500 });

      expect(text()).toContain('We could not load your packs.');
      // 🔴 THE ASSERTION THAT CATCHES A COLLAPSED BRANCH ORDER. On a 500 the
      // rows are cleared, so a page testing `length === 0` first renders the
      // empty cell here and tells a paying member no packs exist.
      expect(text()).not.toContain('No packs are available to you yet.');
    });

    it('ERROR carries role="alert" and EMPTY does not', () => {
      flush(null, { status: 500 });

      const alert = root().querySelector('[role="alert"]');
      expect(alert).not.toBeNull();
      expect(alert?.textContent).toContain('We could not load your packs.');
    });

    it('EMPTY announces politely, not as an alert', () => {
      flush([]);

      // A blank list is not an emergency. `EmptyState` carries the polite
      // announcement; an `alert` role here would interrupt a screen-reader
      // user for a non-event.
      expect(root().querySelector('[role="alert"]')).toBeNull();
    });

    it('ERROR is retryable, and the retry issues a fresh request', () => {
      flush(null, { status: 500 });

      const retry = root().querySelector<HTMLButtonElement>('button');
      expect(retry?.textContent).toContain('Try again');

      retry?.click();
      fixture.detectChanges();

      flush([labelledPack()]);
      expect(text()).toContain('B15A Labelled Pack');
      expect(text()).not.toContain('We could not load your packs.');
    });

    it('a failed RETRY does not leave stale rows under the banner', () => {
      flush([labelledPack()]);
      expect(cards()).toHaveLength(1);

      root().querySelector<HTMLButtonElement>('button');
      fixture.componentInstance['reload']();
      fixture.detectChanges();
      flush(null, { status: 500 });

      expect(cards()).toHaveLength(0);
      expect(text()).toContain('We could not load your packs.');
    });

    it('LIST: rows render once the server answers', () => {
      flush([labelledPack(), unlabelledPack()]);

      expect(cards()).toHaveLength(2);
      expect(text()).not.toContain('No packs are available to you yet.');
      expect(text()).not.toContain('We could not load your packs.');
      expect(root().querySelector('[aria-busy="true"]')).toBeNull();
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 R5.5 — the access note, and where it sits                            */
  /* ---------------------------------------------------------------------- */

  describe('🔴 R5.5 — the access note renders BEFORE the repository link', () => {
    it('the authored note appears', () => {
      flush([labelledPack()]);

      expect(text()).toContain(
        'Invite lands within 24h of your GitHub handle being shared.',
      );
    });

    it('🔴 the note PRECEDES the link in DOM order, not merely on the page', () => {
      // 🔴 THIS IS THE ASSERTION THE REQUIREMENT ACTUALLY MAKES. "The text is
      // somewhere on the page" is true of the broken version too — the one
      // where the note sits UNDER the link and the member reads it only after
      // GitHub has already refused them. R5.5 says "in advance", so ORDER is
      // the requirement.
      flush([labelledPack()]);

      expectNoteBeforeLink(cards()[0]);
    });

    it('🔴 a pack with accessNote: null still gets a line (ASSUMPTION-27)', () => {
      // Every pack in this workspace has the column null on day one — measured
      // live. Rendering nothing would leave a blank gap at exactly the spot
      // R5.5 exists to fill, on every row.
      flush([unlabelledPack()]);

      expect(text()).toContain(DEFAULT_ACCESS_NOTE);

      const card = cards()[0];
      expect(card.querySelector('[data-access-note]')).not.toBeNull();
      expect(
        card.querySelector('[data-access-note]')?.textContent?.trim().length,
      ).toBeGreaterThan(0);
    });

    it('the null fallback also precedes the link', () => {
      // The fallback is the case that ships today, so the ordering guarantee
      // has to hold for it specifically and not only for the authored one.
      flush([unlabelledPack()]);

      expectNoteBeforeLink(cards()[0]);
    });

    it('every pack in a mixed list gets a note', () => {
      flush([labelledPack(), unlabelledPack()]);

      for (const card of cards()) {
        expect(card.querySelector('[data-access-note]')).not.toBeNull();
      }
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R5.1 — what a pack shows                                               */
  /* ---------------------------------------------------------------------- */

  describe('R5.1 — title, description, tags, cohort label and repo link', () => {
    it('renders title and description as escaped text', () => {
      flush([labelledPack()]);

      expect(text()).toContain('B15A Labelled Pack');
      expect(text()).toContain('Visible and cohort-labelled.');
    });

    it('renders the pack’s own tags', () => {
      flush([labelledPack()]);

      expect(text()).toContain('agents');
      expect(text()).toContain('nx');
    });

    it('renders cohortName as a chip BESIDE the tags, not as a group heading', () => {
      // ASSUMPTION-25 / A-1. Grouping by the label would render it as
      // STRUCTURE and re-create, visually, the access illusion A-1 refuses.
      flush([labelledPack()]);

      const card = cards()[0];
      const chips = Array.from(card.querySelectorAll('ptah-tag-chip'));

      expect(chips).toHaveLength(3);
      expect(card.textContent).toContain('Founding Members');
    });

    it('🔴 ONE FLAT LIST — no cohort grouping, even across mixed packs', () => {
      flush([labelledPack(), unlabelledPack()]);

      // One `<ul>` of cards. A grouped render would produce a heading per
      // cohort and a list per group.
      const cardLists = Array.from(root().querySelectorAll('ul')).filter(
        (list) => list.querySelector('[data-pack-slug]'),
      );
      expect(cardLists).toHaveLength(1);
      expect(cards()).toHaveLength(2);
    });

    it('a pack with no cohort and no tags renders no chip row at all', () => {
      flush([unlabelledPack()]);

      expect(cards()[0].querySelectorAll('ptah-tag-chip')).toHaveLength(0);
    });

    it('the repo link points at repoUrl and opens safely', () => {
      flush([labelledPack()]);

      const link =
        cards()[0].querySelector<HTMLAnchorElement>('[data-repo-link]');

      expect(link?.getAttribute('href')).toBe('https://github.com/x/labelled');
      expect(link?.getAttribute('target')).toBe('_blank');
      // `noopener` is the security half — without it the opened tab gets a
      // `window.opener` handle back into this origin.
      expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('🔴 each link’s accessible name names ITS pack', () => {
      // A page of links all reading "Open repository" is unusable on a screen
      // reader, which reads them out of context in a link list.
      flush([labelledPack(), unlabelledPack()]);

      const names = cards().map((card) =>
        card.querySelector('[data-repo-link]')?.getAttribute('aria-label'),
      );

      expect(names).toEqual([
        'Open the B15A Labelled Pack repository on GitHub',
        'Open the B15A Unlabelled Pack repository on GitHub',
      ]);
      expect(new Set(names).size).toBe(2);
    });

    it('the order is the SERVER’S — nothing is re-sorted', () => {
      // The server orders alphabetically by title. A client-side sort reorders
      // only the rows this page happens to hold.
      flush([unlabelledPack(), labelledPack()]);

      expect(
        cards().map((card) => card.getAttribute('data-pack-slug')),
      ).toEqual(['b15a-unlabelled', 'b15a-labelled']);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 NFR-S5 — `notes` appears nowhere                                     */
  /* ---------------------------------------------------------------------- */

  describe('🔴 NFR-S5 — the admin-only note never reaches the DOM', () => {
    it('a fixture carrying notes renders it nowhere', () => {
      // The server strips it and the client schema strips it again. This is
      // the third end: even if both failed, it would have to reach a template
      // binding to be seen, and there is none.
      flush([
        { ...labelledPack(), notes: 'B15A-ADMIN-ONLY-SECRET' },
        { ...unlabelledPack(), notes: 'B15A-ADMIN-ONLY-SECRET' },
      ]);

      expect(html()).not.toContain('B15A-ADMIN-ONLY-SECRET');
      expect(text()).not.toContain('B15A-ADMIN-ONLY-SECRET');
      expect(cards()).toHaveLength(2);
    });

    it('the assertion above is not true-because-empty', () => {
      // Anti-vacuity: the page IS populated when the secret is absent.
      flush([{ ...labelledPack(), notes: 'B15A-ADMIN-ONLY-SECRET' }]);

      expect(text()).toContain('B15A Labelled Pack');
      expect(html()).not.toContain('B15A-ADMIN-ONLY-SECRET');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* R5.7 — Ptah grants nothing                                             */
  /* ---------------------------------------------------------------------- */

  describe('🔴 R5.7 — nothing here implies Ptah grants access', () => {
    it('there is no request-access control of any kind', () => {
      flush([labelledPack(), unlabelledPack()]);

      const copy = text().toLowerCase();
      expect(copy).not.toContain('request access');
      expect(copy).not.toContain('unlock');
      expect(copy).not.toContain('you have access');

      // Exactly one interactive control per card, and it is a LINK OUT.
      expect(root().querySelectorAll('button')).toHaveLength(0);
      expect(root().querySelectorAll('[data-repo-link]')).toHaveLength(2);
    });

    it('the header says access is administered on GitHub', () => {
      flush([labelledPack()]);

      expect(text()).toContain('Access is administered on GitHub.');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* NFR-S2 / NFR-U — no renderer, and token discipline                     */
  /* ---------------------------------------------------------------------- */

  describe('NFR-S2 / NFR-U — no markdown renderer, tokens only', () => {
    it('no markdown block is rendered on this page', () => {
      // `description` and `accessNote` are admin-authored plain prose. The
      // chokepoint importer list stays at SIX.
      flush([labelledPack()]);

      expect(html()).not.toContain('ptah-markdown-block');
    });

    it('markdown in a description is shown LITERALLY, not rendered', () => {
      // The proof that the text node is escaped rather than merely
      // un-marked-up: a body carrying markup arrives as characters.
      flush([
        labelledPack({ description: '**bold** <img src=x onerror=alert(1)>' }),
      ]);

      expect(text()).toContain('**bold**');
      expect(root().querySelector('img')).toBeNull();
    });

    it(`emits no ${BORDER_FILL_MISUSE}`, () => {
      flush([labelledPack(), unlabelledPack()]);
      expect(html()).not.toContain(BORDER_FILL_MISUSE);
    });

    it(`🔴 no ${LOW_CONTRAST_TEXT} on a TEXT-BEARING element, in any cell (B13's F-1)`, () => {
      // 🔴 SCOPED TO TEXT, NOT TO THE FILE — and that scoping is the finding,
      // not a concession. A file-wide `expect(html()).not.toContain(...)` FAILS
      // here, because `EmptyState` renders its decorative glyph as
      // `<lucide-angular aria-hidden="true" class="... text-base-content/40">`.
      // That is LEGAL: `/40` on a decorative icon carries no information a
      // member has to read, so no contrast ratio applies to it. `/40` on TEXT
      // is what B13's F-1 was — a real 3.2:1 WCAG AA failure — and it is what
      // this asserts. RISK-AR names exactly this distinction as one B13 drew
      // but did not enforce.
      //
      // Run across ALL FOUR cells, because B13's F-1 survived three phases
      // precisely because every prior pass ran against POPULATED surfaces only.
      expectNoLowContrastText(); // loading

      flush(null, { status: 500 });
      expectNoLowContrastText(); // error

      fixture.componentInstance['reload']();
      fixture.detectChanges();
      flush([]);
      expectNoLowContrastText(); // empty — the cell that hid B13's F-1

      fixture.componentInstance['reload']();
      fixture.detectChanges();
      flush([labelledPack(), unlabelledPack()]);
      expectNoLowContrastText(); // list
    });

    it('the /40 check is NOT vacuous — it sees the classes it is scanning', () => {
      // Anti-vacuity. If the walk found no text-bearing elements at all, the
      // assertion above would pass over an empty set forever.
      flush([labelledPack()]);

      const scanned = textBearingElements();
      expect(scanned.length).toBeGreaterThan(3);
      expect(
        scanned.some((el) => el.className.includes('base-content/60')),
      ).toBe(true);
    });

    it('decorative icons are hidden from assistive tech', () => {
      flush([labelledPack()]);

      const icons = Array.from(root().querySelectorAll('lucide-angular'));
      expect(icons.length).toBeGreaterThan(0);
      for (const icon of icons) {
        expect(icon.getAttribute('aria-hidden')).toBe('true');
      }
    });

    it('the page has exactly one h1 and each pack an h2', () => {
      flush([labelledPack(), unlabelledPack()]);

      expect(root().querySelectorAll('h1')).toHaveLength(1);
      expect(root().querySelectorAll('h2')).toHaveLength(2);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The request                                                            */
  /* ---------------------------------------------------------------------- */

  describe('the request', () => {
    it('issues exactly ONE request on load, with no parameters', () => {
      const request = http.expectOne(PACKS);

      expect(request.request.params.keys()).toEqual([]);
      request.flush([]);
      fixture.detectChanges();

      http.verify();
    });
  });
});
