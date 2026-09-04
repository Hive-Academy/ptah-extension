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

  /**
   * Expands the Categories section. Only for a fixture that HAS categories —
   * with none the section opens itself, and clicking would close it.
   */
  function openCategories(
    fixture: ComponentFixture<CommunityModeration>,
  ): void {
    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector(
      'button[aria-controls="community-categories"]',
    );
    toggle.click();
    fixture.detectChanges();
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

  /** Opens the New-thread drawer and fills a valid draft. */
  function authorDraft(
    fixture: ComponentFixture<CommunityModeration>,
    title = 'Welcome to the forum',
    body = '## Hello everyone',
  ): void {
    button(fixture, 'New thread').click();
    fixture.detectChanges();

    const titleField: HTMLInputElement =
      fixture.nativeElement.querySelector('#thread-title');
    titleField.value = title;
    titleField.dispatchEvent(new Event('input'));

    const bodyField: HTMLTextAreaElement =
      fixture.nativeElement.querySelector('#thread-body');
    bodyField.value = body;
    bodyField.dispatchEvent(new Event('input'));
    fixture.detectChanges();
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
    // 'Courses' was appended by TASK_2026_377 Batch 3 (the course authoring
    // surface). This assertion is exact on purpose — a new entry in this group
    // is a deliberate IA change and should have to be written down here.
    expect(buildersContent?.items.map((item) => item.label)).toEqual([
      'Packs',
      'Sessions',
      'Community',
      'Courses',
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

  it('keeps the FAILED subset of a bulk run selected, and names the count', () => {
    // ⚠️ Clearing the selection up front made a partial failure unrecoverable:
    // the operator was told "one or more updates failed" with nothing selected
    // and no way to know which rows to pick again out of a page of fifty.
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

    button(fixture, 'Lock').click();

    const patches = httpMock.match(
      (r) => r.method === 'PATCH' && r.url.startsWith(TOPICS_URL),
    );
    patches
      .find((patch) => patch.request.url === `${TOPICS_URL}/top_1`)
      ?.flush({ id: 'top_1', changed: ['locked'] });
    patches
      .find((patch) => patch.request.url === `${TOPICS_URL}/top_2`)
      ?.flush(null, { status: 500, statusText: 'Server Error' });

    topicsRequest().flush(
      paged([
        topic({ id: 'top_1', locked: true }),
        topic({ id: 'top_2', slug: 'second', title: 'Second' }),
      ]),
    );
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('1 thread could not be updated');
    expect(text).not.toContain('Http failure response');

    // Exactly the failed row survives the run, so the retry is one more click.
    expect(
      Array.from<HTMLInputElement>(
        fixture.nativeElement.querySelectorAll('input[aria-label^="Select "]'),
      ).map((box) => box.checked),
    ).toEqual([false, true]);
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

  it('a FAILED category read is NOT an empty forum — it says so and retries', () => {
    // ⚠️ The two states were indistinguishable: a 500 set an empty list and no
    // error, so the screen asserted "the forum has no categories yet" about
    // data nobody read, and disabled the one write that needs a category.
    const fixture = TestBed.createComponent(CommunityModeration);
    fixture.detectChanges();
    httpMock
      .expectOne(CATEGORIES_URL)
      .flush(null, { status: 500, statusText: 'Server Error' });
    topicsRequest().flush(paged([]));
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('We could not load the categories.');
    expect(text).not.toContain('The forum has no categories yet');
    expect(text).not.toContain('Http failure response');

    // Authoring stays reachable: the categories may well exist.
    expect(button(fixture, 'New thread').disabled).toBe(false);

    button(fixture, 'Retry the categories').click();
    httpMock.expectOne(CATEGORIES_URL).flush({ categories: [category()] });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain(
      'We could not load the categories.',
    );
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

  /* ---------------------------------------------------------------------- */
  /* Categories — the write surface whose absence produced "0 threads"       */
  /* ---------------------------------------------------------------------- */

  it('names the REAL cause when the forum has no categories at all', () => {
    // ⚠️ "No threads match these filters" is a LIE on an empty forum.
    // `Topic.categoryId` is a required foreign key, so with no category nothing
    // can be posted and no filter change will ever produce a row.
    const fixture = open([], []);

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain(
      'The forum has no categories yet, so it cannot hold a thread.',
    );
    expect(text).not.toContain('No threads match these filters.');

    // The section that fixes it opens itself rather than staying collapsed.
    expect(
      fixture.nativeElement.querySelector('#community-categories'),
    ).not.toBeNull();

    // And authoring is refused until a category exists to post into.
    expect(button(fixture, 'New thread').disabled).toBe(true);
  });

  it('CREATES a category and refreshes the list so every control sees it', () => {
    const fixture = open([], [category()]);
    openCategories(fixture);

    const name: HTMLInputElement =
      fixture.nativeElement.querySelector('#category-name');
    name.value = 'Announcements';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // The slug is SUGGESTED from the name; the field stays editable.
    expect(
      (
        fixture.nativeElement.querySelector(
          '#category-slug',
        ) as HTMLInputElement
      ).value,
    ).toBe('announcements');

    button(fixture, 'Create category').click();

    const post = httpMock.expectOne(CATEGORIES_URL);
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({
      slug: 'announcements',
      name: 'Announcements',
      description: null,
      visibility: 'member',
      cohortKeys: [],
    });
    post.flush(
      category({ id: 'cat_2', slug: 'announcements', name: 'Announcements' }),
    );

    // ⚠️ THE REFRESH IS THE POINT. The category filter, every row's move
    // control and the new-thread select all read the same signal, so a create
    // that appended locally would leave two of the three blind to it.
    httpMock.expectOne(CATEGORIES_URL).flush({
      categories: [
        category(),
        category({ id: 'cat_2', slug: 'announcements', name: 'Announcements' }),
      ],
    });
    fixture.detectChanges();

    const options = Array.from<HTMLOptionElement>(
      fixture.nativeElement.querySelectorAll('#moderation-category option'),
    ).map((option) => option.textContent?.trim());
    expect(options).toContain('Announcements');
  });

  /* ---------------------------------------------------------------------- */
  /* New thread                                                              */
  /* ---------------------------------------------------------------------- */

  it('AUTHORS a thread with the exact body shape, then reloads the queue', () => {
    // ⚠️ The response is `{ id, slug }` and nothing else — the slug is
    // server-allocated (R1.2.2) — so the queue is re-read rather than patched.
    const fixture = open([], [category({ id: 'cat_1' })]);

    button(fixture, 'New thread').click();
    fixture.detectChanges();

    const title: HTMLInputElement =
      fixture.nativeElement.querySelector('#thread-title');
    title.value = '  Welcome to the forum  ';
    title.dispatchEvent(new Event('input'));

    const body: HTMLTextAreaElement =
      fixture.nativeElement.querySelector('#thread-body');
    body.value = '## Hello everyone';
    body.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    button(fixture, 'Post thread').click();

    const post = httpMock.expectOne(TOPICS_URL);
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({
      categoryId: 'cat_1',
      title: 'Welcome to the forum',
      body: '## Hello everyone',
      pinned: false,
      locked: false,
    });
    post.flush({ id: 'top_9', slug: 'welcome-to-the-forum' });

    topicsRequest().flush(
      paged([topic({ id: 'top_9', title: 'Welcome to the forum' })]),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Welcome to the forum');
    // Nothing else opens on success — the form closes and the queue is the view.
    expect(fixture.nativeElement.querySelector('#thread-title')).toBeNull();
  });

  it('surfaces the SERVER SENTENCE on a 400 refusal of a thread', () => {
    // ⚠️ A 400 here is a refusal the API COMPOSED from what the caller sent —
    // "Category not found" names the fix. Masking it left the admin a generic
    // sentence and no field to correct.
    const fixture = open([], [category({ id: 'cat_1' })]);
    authorDraft(fixture);
    button(fixture, 'Post thread').click();

    httpMock.expectOne(TOPICS_URL).flush(
      {
        statusCode: 400,
        message: 'Category not found',
        error: 'Bad Request',
      },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Category not found');
    expect(text).not.toContain('We could not create the thread.');
    expect(text).not.toContain('Http failure response');
  });

  it('still MASKS a 500 on the same write, because nobody wrote that body', () => {
    const fixture = open([], [category({ id: 'cat_1' })]);
    authorDraft(fixture);
    button(fixture, 'Post thread').click();

    httpMock
      .expectOne(TOPICS_URL)
      .flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('We could not create the thread.');
    expect(text).not.toContain('Http failure response');
  });

  it('an OVER-LONG title never reaches the server', () => {
    // `CreateAdminTopicDto.title` is `@MaxLength(200)`, and a ValidationPipe
    // rejection answers 400 with `message: string[]` — a shape the screen masks
    // on purpose. The client guard is what keeps that 400 from happening.
    const fixture = open([], [category({ id: 'cat_1' })]);
    authorDraft(fixture, 'x'.repeat(201));
    button(fixture, 'Post thread').click();
    fixture.detectChanges();

    httpMock.expectNone(TOPICS_URL);
    expect(fixture.nativeElement.textContent).toContain(
      'A title is at most 200 characters.',
    );
  });
});
