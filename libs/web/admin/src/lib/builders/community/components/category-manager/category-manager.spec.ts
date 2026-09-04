import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import type { AdminCategory } from '../../../../services/admin-builders-api.service';
import { CategoryManager } from './category-manager';

const CATEGORIES_URL = '/api/v1/admin/community/categories';

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

describe('CategoryManager', () => {
  let httpMock: HttpTestingController;
  let changed: jest.Mock;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    changed = jest.fn();
  });

  afterEach(() => httpMock.verify());

  /**
   * Renders the section with a list and expands it. The section opens itself
   * when the list is empty or the read failed, so those two cases pass
   * `expand: false` — clicking would close it.
   */
  function open(
    categories: AdminCategory[] = [category()],
    loadError: string | null = null,
    expand = true,
  ): ComponentFixture<CategoryManager> {
    const fixture = TestBed.createComponent(CategoryManager);
    fixture.componentRef.setInput('categories', categories);
    fixture.componentRef.setInput('loadError', loadError);
    fixture.componentInstance.changed.subscribe(changed);
    fixture.detectChanges();

    if (expand) {
      const toggle: HTMLButtonElement = fixture.nativeElement.querySelector(
        'button[aria-controls="community-categories"]',
      );
      toggle.click();
      fixture.detectChanges();
    }
    return fixture;
  }

  function button(
    fixture: ComponentFixture<CategoryManager>,
    label: string,
  ): HTMLButtonElement {
    const found = Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === label);
    if (!found) throw new Error(`No button labelled "${label}"`);
    return found;
  }

  /* ---------------------------------------------------------------------- */
  /* Writes                                                                  */
  /* ---------------------------------------------------------------------- */

  it('CREATES a category and asks the route component to re-read', () => {
    // ⚠️ IT ASKS FOR A RELOAD RATHER THAN APPENDING. The category filter, every
    // row's move control and the new-thread select all read the route
    // component's list, so a local append would leave all three blind to it.
    const fixture = open();

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
    post.flush(category({ id: 'cat_2', slug: 'announcements' }));

    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('REORDERS with the COMPLETE id list, never the pair that moved', () => {
    // ⚠️ `sortOrder` is a TOTAL ordering and the server refuses a partial list
    // with a 400 and no writes: renumbering a subset onto the sparse scale
    // would interleave it with the untouched rows at values nobody chose.
    const fixture = open([
      category({ id: 'cat_1', name: 'General' }),
      category({ id: 'cat_2', slug: 'help', name: 'Help' }),
      category({ id: 'cat_3', slug: 'showcase', name: 'Showcase' }),
    ]);

    const up: HTMLButtonElement = fixture.nativeElement.querySelector(
      'button[aria-label="Move Showcase up"]',
    );
    up.click();

    const patch = httpMock.expectOne(`${CATEGORIES_URL}/reorder`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ ids: ['cat_1', 'cat_3', 'cat_2'] });
    patch.flush({ reordered: 3 });

    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('EDITS a category without ever sending a slug', () => {
    // `UpdateCategoryDto` has no `slug` field: the slug is the category's
    // public URL and is written into stored notification routes.
    const fixture = open();

    button(fixture, 'Edit category').click();
    fixture.detectChanges();

    const name: HTMLInputElement =
      fixture.nativeElement.querySelector('#edit-name-cat_1');
    name.value = 'General chat';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    button(fixture, 'Save category').click();

    const patch = httpMock.expectOne(`${CATEGORIES_URL}/cat_1`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({
      name: 'General chat',
      description: null,
      visibility: 'member',
      cohortKeys: [],
    });
    patch.flush(category({ name: 'General chat' }));

    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('refuses an OVER-LONG name before the request', () => {
    // `CreateCategoryDto.name` is `@MaxLength(120)`. A ValidationPipe rejection
    // answers 400 with `message: string[]`, which this screen masks on purpose,
    // so the guard is what keeps the admin from a sentence naming no field.
    const fixture = open();

    const name: HTMLInputElement =
      fixture.nativeElement.querySelector('#category-name');
    name.value = 'n'.repeat(121);
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    button(fixture, 'Create category').click();
    fixture.detectChanges();

    httpMock.expectNone(CATEGORIES_URL);
    expect(fixture.nativeElement.textContent).toContain(
      'A category name is at most 120 characters.',
    );
  });

  /* ---------------------------------------------------------------------- */
  /* Delete                                                                  */
  /* ---------------------------------------------------------------------- */

  it('warns that the Topics count cannot promise the delete will succeed', () => {
    // ⚠️ `listForAdmin` counts topics with `NOT_DELETED` while the foreign key
    // counts every row. A category showing 0 can still be refused, so the
    // confirmation says so rather than letting the row's own number promise it.
    const fixture = open([category({ topicCount: 0 })]);

    button(fixture, 'Delete category').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'The delete can still be refused because of deleted topics the “Topics” count does not show.',
    );
  });

  it('surfaces the SERVER SENTENCE on a 409 delete, not a generic failure', () => {
    // ⚠️ A 409 here is a refusal that carries an actionable instruction.
    // `Topic.category` is `onDelete: Restrict`, and the server turns the
    // resulting P2003 into a fixed sentence naming the remedy.
    const fixture = open();

    button(fixture, 'Delete category').click();
    fixture.detectChanges();
    button(fixture, 'Yes, delete category').click();

    const request = httpMock.expectOne(`${CATEGORIES_URL}/cat_1`);
    expect(request.request.method).toBe('DELETE');
    request.flush(
      {
        statusCode: 409,
        message:
          'This category still contains topics and cannot be deleted. Move or delete its topics first.',
        error: 'Conflict',
      },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Move or delete its topics first.');
    expect(text).not.toContain('We could not delete the category.');
    expect(text).not.toContain('Http failure response');
    expect(changed).not.toHaveBeenCalled();
  });

  it('surfaces the SERVER SENTENCE on a 400 create refusal too', () => {
    // ⚠️ A 400 on this surface is composed from caller-supplied values, exactly
    // like the 409 — "Unknown cohort key(s): alumni" names the fix, and the
    // generic sentence it used to be replaced by named nothing.
    const fixture = open();

    const name: HTMLInputElement =
      fixture.nativeElement.querySelector('#category-name');
    name.value = 'Alumni';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    button(fixture, 'Create category').click();
    httpMock.expectOne(CATEGORIES_URL).flush(
      {
        statusCode: 400,
        message:
          'Unknown cohort key(s): alumni — create the member group first',
        error: 'Bad Request',
      },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Unknown cohort key(s): alumni');
    expect(text).not.toContain('We could not create the category.');
  });

  it('still refuses a raw transport message on a 500 delete', () => {
    // The refusal branch is narrow ON PURPOSE: a 500 body is not a sentence
    // anyone wrote, so it falls back exactly as every other failure here.
    const fixture = open();

    button(fixture, 'Delete category').click();
    fixture.detectChanges();
    button(fixture, 'Yes, delete category').click();

    httpMock
      .expectOne(`${CATEGORIES_URL}/cat_1`)
      .flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('We could not delete the category.');
    expect(text).not.toContain('Http failure response');
  });

  /* ---------------------------------------------------------------------- */
  /* A failed read is its own state                                          */
  /* ---------------------------------------------------------------------- */

  it('opens itself on a FAILED read and offers the read again', () => {
    // ⚠️ An empty list here means "unknown", not "empty forum": the section
    // says so, and the retry is the only way back without a page reload.
    const fixture = open([], 'We could not load the categories.', false);

    const text: string = fixture.nativeElement.textContent;
    expect(
      fixture.nativeElement.querySelector('#community-categories'),
    ).not.toBeNull();
    expect(text).toContain('We could not load the categories.');
    expect(text).toContain('Categories (unavailable)');

    button(fixture, 'Retry the categories').click();

    expect(changed).toHaveBeenCalledTimes(1);
    httpMock.expectNone(CATEGORIES_URL);
  });

  it('opens itself when the read SUCCEEDED with zero rows', () => {
    // The other cause of an empty list, and the one where creating a category
    // is the whole remedy.
    const fixture = open([], null, false);

    expect(
      fixture.nativeElement.querySelector('#community-categories'),
    ).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Categories (0)');
    expect(
      fixture.nativeElement.querySelector('#category-name'),
    ).not.toBeNull();
  });
});
