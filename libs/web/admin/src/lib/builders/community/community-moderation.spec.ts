import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { Route } from '@angular/router';

import type { Paged } from '@ptah-contracts/community';

import { ADMIN_NAV_GROUPS } from '../../admin-layout/admin-nav.config';
import { ADMIN_ROUTES } from '../../admin.routes';
import type {
  AdminCategory,
  AdminTopicSummary,
} from '../../services/admin-builders-api.service';
import { CommunityModeration } from './community-moderation';

const CATEGORIES_URL = '/api/v1/admin/community/categories';
const TOPICS_URL = '/api/v1/admin/community/topics';

function category(overrides: Partial<AdminCategory> = {}): AdminCategory {
  return {
    id: 'cat_1',
    slug: 'general',
    name: 'General',
    description: null,
    visibility: 'member',
    cohortKeys: [],
    cohortNames: [],
    sortOrder: 0,
    topicCount: 4,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function topic(overrides: Partial<AdminTopicSummary> = {}): AdminTopicSummary {
  return {
    id: 'top_1',
    slug: 'welcome',
    title: 'Welcome to the community',
    categoryId: 'cat_1',
    categoryName: 'General',
    authorName: 'Ada',
    authorEmail: 'ada@example.com',
    pinned: false,
    locked: false,
    replyCount: 3,
    hasAcceptedAnswer: false,
    deletedAt: null,
    deletedBy: null,
    lastPostedAt: '2026-08-05T10:00:00.000Z',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-05T10:00:00.000Z',
    editedAt: null,
    ...overrides,
  };
}

function paged(
  items: AdminTopicSummary[],
  overrides: Partial<Paged<AdminTopicSummary>> = {},
): Paged<AdminTopicSummary> {
  return {
    items,
    page: 1,
    pageSize: 25,
    total: items.length,
    hasMore: false,
    ...overrides,
  };
}

describe('CommunityModeration', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function topicsRequest(): TestRequest {
    return httpMock.expectOne((r) => r.url === TOPICS_URL);
  }

  function open(
    topics: AdminTopicSummary[] = [topic()],
    categories: AdminCategory[] = [category()],
  ): ComponentFixture<CommunityModeration> {
    const fixture = TestBed.createComponent(CommunityModeration);
    fixture.detectChanges();
    httpMock.expectOne(CATEGORIES_URL).flush({ categories });
    topicsRequest().flush(paged(topics));
    fixture.detectChanges();
    return fixture;
  }

  function button(
    fixture: ComponentFixture<CommunityModeration>,
    label: string,
  ): HTMLButtonElement {
    const found = Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === label);
    if (!found) throw new Error(`No button labelled "${label}"`);
    return found;
  }

  /* ---------------------------------------------------------------------- */
  /* Reachability — the §8.2 exit-gate item                                  */
  /* ---------------------------------------------------------------------- */

  it('is REACHABLE from the admin sidebar, under Builders Content', () => {
    // ⚠️ A §8.2 exit-gate item. Batch 5 deleted the old entry with the endpoints
    // behind it; a screen nobody can navigate to is not a delivered screen.
    const buildersContent = ADMIN_NAV_GROUPS.find(
      (group) => group.label === 'Builders Content',
    );

    expect(buildersContent).toBeDefined();
    expect(buildersContent?.items.map((item) => item.label)).toEqual([
      'Packs',
      'Sessions',
      'Community',
    ]);
    expect(
      buildersContent?.items.find((item) => item.label === 'Community')?.route,
    ).toBe('/admin/builders/community');
  });

  it('keeps Member Groups under People & Community — this does not move it', () => {
    // Cohorts are people-shaped; threads are content. The split is the existing
    // IA and adding a content entry must not disturb it.
    const people = ADMIN_NAV_GROUPS.find(
      (group) => group.label === 'People & Community',
    );

    expect(people?.items.map((item) => item.label)).toContain('Member Groups');
  });

  it('the route exists and resolves before the generic :model catch-all', () => {
    const flatten = (routes: readonly Route[]): string[] =>
      routes.flatMap((route) => [
        route.path ?? '',
        ...(route.children ? flatten(route.children) : []),
      ]);
    const paths = flatten(ADMIN_ROUTES);

    expect(paths).toContain('builders/community');
    expect(paths.indexOf('builders/community')).toBeLessThan(
      paths.indexOf(':model'),
    );
  });

  /* ---------------------------------------------------------------------- */
  /* Reads                                                                   */
  /* ---------------------------------------------------------------------- */

  it('loads the categories and the queue, from three separate prefixes', () => {
    // RISK-J: categories / topics / posts are three DISJOINT literal prefixes,
    // not one controller. Nothing is mounted at the bare `…/community`.
    const fixture = TestBed.createComponent(CommunityModeration);
    fixture.detectChanges();

    const urls = httpMock.match(() => true).map((r) => r.request.url);
    expect(urls.sort()).toEqual([CATEGORIES_URL, TOPICS_URL]);
    expect(urls).not.toContain('/api/v1/admin/community');

    httpMock.verify({ ignoreCancelled: true });
  });

  it('does NOT send includeDeleted until asked — tombstones stay hidden (AD-5)', () => {
    const fixture = open();

    expect(
      fixture.nativeElement.querySelector('#moderation-category'),
    ).not.toBeNull();

    const toggle: HTMLInputElement = fixture.nativeElement.querySelector(
      'input[type="checkbox"].checkbox-sm',
    );
    toggle.click();

    const request = topicsRequest();
    expect(request.request.params.get('includeDeleted')).toBe('true');
    request.flush(paged([]));
  });

  it('renders the ThreadRow primitive — the SECOND consumer that licenses it', () => {
    // ⚠️ §5.3: a primitive earns a place in @ptah-web/panel-ui when a second
    // panel ACTUALLY renders it. If this assertion is ever deleted, the
    // promotion of ThreadRow and TagChip should be reverted with it.
    const fixture = open();

    expect(
      fixture.nativeElement.querySelector('ptah-thread-row'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('ptah-tag-chip')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('ptah-status-badge'),
    ).not.toBeNull();
  });

  it('renders EmptyState when nothing matches, never a bare zero', () => {
    const fixture = open([]);

    expect(
      fixture.nativeElement.querySelector('ptah-empty-state'),
    ).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'No threads match these filters.',
    );
  });

  it('filters by category and by search, resetting to page 1 each time', () => {
    const fixture = open();

    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      '#moderation-category',
    );
    select.value = 'cat_1';
    select.dispatchEvent(new Event('change'));

    let request = topicsRequest();
    expect(request.request.params.get('categoryId')).toBe('cat_1');
    expect(request.request.params.get('page')).toBe('1');
    request.flush(paged([topic()]));
    fixture.detectChanges();

    const search: HTMLInputElement =
      fixture.nativeElement.querySelector('#moderation-search');
    search.value = '  welcome  ';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button(fixture, 'Search').click();

    request = topicsRequest();
    expect(request.request.params.get('search')).toBe('welcome');
    request.flush(paged([]));
  });

  /* ---------------------------------------------------------------------- */
  /* Writes — the capability the deleted read-only surface did not have      */
  /* ---------------------------------------------------------------------- */

  it('PINS a topic and re-reads rather than patching the row locally', () => {
    // The server returns the fields it ACTUALLY changed, and a move also
    // changes `categoryName`, which no local patch would know.
    const fixture = open([topic({ pinned: false })]);
    button(fixture, 'Pin').click();

    const patch = httpMock.expectOne(`${TOPICS_URL}/top_1`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ pinned: true });
    patch.flush({ id: 'top_1', changed: ['pinned'] });

    topicsRequest().flush(paged([topic({ pinned: true })]));
    fixture.detectChanges();

    expect(button(fixture, 'Unpin')).toBeTruthy();
  });

  it('LOCKS and unlocks a topic', () => {
    const fixture = open([topic({ locked: false })]);
    button(fixture, 'Lock').click();

    const patch = httpMock.expectOne(`${TOPICS_URL}/top_1`);
    expect(patch.request.body).toEqual({ locked: true });
    patch.flush({ id: 'top_1', changed: ['locked'] });
    topicsRequest().flush(paged([topic({ locked: true })]));
    fixture.detectChanges();

    expect(button(fixture, 'Unlock')).toBeTruthy();
  });

  it('MOVES a topic to another category', () => {
    const fixture = open(
      [topic({ categoryId: 'cat_1' })],
      [category({ id: 'cat_1' }), category({ id: 'cat_2', name: 'Help' })],
    );

    const move: HTMLSelectElement =
      fixture.nativeElement.querySelector('#move-top_1');
    move.value = 'cat_2';
    move.dispatchEvent(new Event('change'));

    const patch = httpMock.expectOne(`${TOPICS_URL}/top_1`);
    expect(patch.request.body).toEqual({ categoryId: 'cat_2' });
    patch.flush({ id: 'top_1', changed: ['categoryId'] });
    topicsRequest().flush(paged([topic({ categoryId: 'cat_2' })]));
  });

  it('does NOT write when the move select is set to its current category', () => {
    // A no-op PATCH would still write an audit row saying a moderator moved a
    // thread that never moved.
    const fixture = open([topic({ categoryId: 'cat_1' })]);

    const move: HTMLSelectElement =
      fixture.nativeElement.querySelector('#move-top_1');
    move.value = 'cat_1';
    move.dispatchEvent(new Event('change'));

    httpMock.expectNone(`${TOPICS_URL}/top_1`);
  });

  it('SOFT-DELETES a topic (AD-5), and offers RESTORE on a tombstone (R8.5)', () => {
    const fixture = open([topic()]);
    button(fixture, 'Delete').click();

    const remove = httpMock.expectOne(`${TOPICS_URL}/top_1`);
    expect(remove.request.method).toBe('DELETE');
    remove.flush({ deleted: true });

    // With "Show deleted" off the row disappears; the tombstone still exists.
    topicsRequest().flush(
      paged([
        topic({
          deletedAt: '2026-08-05T12:00:00.000Z',
          deletedBy: 'admin@ptah.live',
        }),
      ]),
    );
    fixture.detectChanges();

    // A deleted row offers Restore and NOT Pin/Lock/Delete.
    expect(button(fixture, 'Restore')).toBeTruthy();
    expect(
      Array.from<HTMLButtonElement>(
        fixture.nativeElement.querySelectorAll('button'),
      ).map((b) => b.textContent?.trim()),
    ).not.toContain('Delete');

    button(fixture, 'Restore').click();
    const restore = httpMock.expectOne(`${TOPICS_URL}/top_1/restore`);
    expect(restore.request.method).toBe('POST');
    restore.flush({ restored: true });
    topicsRequest().flush(paged([topic()]));
  });

  it('shows WHEN and BY WHOM a tombstone was deleted (R8.5 is judged on that)', () => {
    // The window runs from `deletedAt`, never from `updatedAt` — a later edit
    // to a deleted row must not appear to extend it.
    const fixture = open([
      topic({
        deletedAt: '2026-08-05T12:00:00.000Z',
        deletedBy: 'admin@ptah.live',
        updatedAt: '2026-08-06T09:00:00.000Z',
      }),
    ]);

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('deleted');
    expect(text).toContain('admin@ptah.live');
  });

  it('bulk-locks the selection with ONE PATCH PER TOPIC (one audit row each)', () => {
    // ⚠️ There is no bulk endpoint, and that is fine: a bulk route recording one
    // audit entry for twelve topics would make the log useless for exactly the
    // case it exists for.
    const fixture = open([
      topic({ id: 'top_1' }),
      topic({ id: 'top_2', slug: 'second', title: 'Second' }),
    ]);

    const checkboxes = Array.from<HTMLInputElement>(
      fixture.nativeElement.querySelectorAll('input[aria-label^="Select "]'),
    );
    checkboxes[0].click();
    checkboxes[1].click();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('ptah-selection-toolbar'),
    ).not.toBeNull();

    button(fixture, 'Lock').click();

    const patches = httpMock.match(
      (r) => r.method === 'PATCH' && r.url.startsWith(TOPICS_URL),
    );
    expect(patches.map((p) => p.request.url).sort()).toEqual([
      `${TOPICS_URL}/top_1`,
      `${TOPICS_URL}/top_2`,
    ]);
    for (const patch of patches) {
      expect(patch.request.body).toEqual({ locked: true });
      patch.flush({ id: 'x', changed: ['locked'] });
    }

    topicsRequest().flush(paged([topic({ locked: true })]));
  });

  /* ---------------------------------------------------------------------- */
  /* Drawer                                                                  */
  /* ---------------------------------------------------------------------- */

  it('shows the ADMIN-ONLY fields in the drawer, including authorEmail', () => {
    // ⚠️ `authorEmail` is the single field the member/admin contract split most
    // exists to keep apart (NFR-S4). It belongs HERE and nowhere on a member
    // surface — one `extends` on the contract would put it on every thread read.
    const fixture = open();
    button(fixture, 'Details').click();
    fixture.detectChanges();

    const drawer: HTMLElement =
      fixture.nativeElement.querySelector('ptah-detail-drawer');
    expect(drawer.textContent).toContain('ada@example.com');
    expect(drawer.textContent).toContain('welcome');
  });

  it('the drawer follows a reload rather than freezing the clicked snapshot', () => {
    // Holding the object would show an operator the state they clicked on
    // instead of the state their click produced.
    const fixture = open([topic({ pinned: false })]);
    button(fixture, 'Details').click();
    fixture.detectChanges();

    button(fixture, 'Pin').click();
    httpMock
      .expectOne(`${TOPICS_URL}/top_1`)
      .flush({ id: 'top_1', changed: ['pinned'] });
    topicsRequest().flush(
      paged([topic({ pinned: true, title: 'Renamed by the server' })]),
    );
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('ptah-detail-drawer').textContent,
    ).toContain('Pinned');
  });

  /* ---------------------------------------------------------------------- */
  /* Failure                                                                 */
  /* ---------------------------------------------------------------------- */

  it('a failed category list does not blank the queue', () => {
    const fixture = TestBed.createComponent(CommunityModeration);
    fixture.detectChanges();
    httpMock
      .expectOne(CATEGORIES_URL)
      .flush(null, { status: 500, statusText: 'Server Error' });
    topicsRequest().flush(paged([topic({ title: 'Still moderating' })]));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Still moderating');
  });

  it('never surfaces a raw HTTP error message to an operator', () => {
    const fixture = TestBed.createComponent(CommunityModeration);
    fixture.detectChanges();
    httpMock.expectOne(CATEGORIES_URL).flush({ categories: [] });
    topicsRequest().flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    const alert: HTMLElement =
      fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert.textContent).toContain(
      'We could not load the moderation queue.',
    );
    expect(alert.textContent).not.toContain('Http failure response');
  });

  it('rejects a malformed topic row at the boundary rather than rendering it', () => {
    // The Zod envelopes in `admin-builders-api.service.ts` are the admin half of
    // the contract check the member panel gets from `@ptah-contracts/community`.
    const fixture = TestBed.createComponent(CommunityModeration);
    fixture.detectChanges();
    httpMock.expectOne(CATEGORIES_URL).flush({ categories: [] });
    topicsRequest().flush({
      items: [{ id: 'top_1', slug: 'welcome' }],
      page: 1,
      pageSize: 25,
      total: 1,
      hasMore: false,
    });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[role="alert"]').textContent,
    ).toContain('GET /admin/community/topics');
  });

  it('renders NO markdown — an operator triages metadata, not bodies', () => {
    // Rendering member-authored markdown here would put a second consumer on
    // the `'member'` preset that NFR-S2's chokepoint spec — scoped to
    // `libs/web/members` — does not police.
    const fixture = open();

    expect(
      fixture.nativeElement.querySelector('ptah-markdown-block'),
    ).toBeNull();
  });
});
