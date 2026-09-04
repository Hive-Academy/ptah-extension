import { TestBed, type ComponentFixture } from '@angular/core/testing';

import type {
  AdminCategory,
  AdminCreateTopicRequest,
} from '../../../../services/admin-builders-api.service';
import { NewThreadModal } from './new-thread-modal';

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

describe('NewThreadModal', () => {
  let submitted: jest.Mock<void, [AdminCreateTopicRequest]>;
  let cancelled: jest.Mock;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    submitted = jest.fn();
    cancelled = jest.fn();
  });

  function open(
    categories: AdminCategory[] = [category()],
  ): ComponentFixture<NewThreadModal> {
    const fixture = TestBed.createComponent(NewThreadModal);
    fixture.componentRef.setInput('categories', categories);
    fixture.componentRef.setInput('open', true);
    fixture.componentInstance.submitted.subscribe(submitted);
    fixture.componentInstance.cancelled.subscribe(cancelled);
    fixture.detectChanges();
    return fixture;
  }

  function fill(
    fixture: ComponentFixture<NewThreadModal>,
    title: string,
    body: string,
  ): void {
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

  function button(
    fixture: ComponentFixture<NewThreadModal>,
    label: string,
  ): HTMLButtonElement {
    const found = Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === label);
    if (!found) throw new Error(`No button labelled "${label}"`);
    return found;
  }

  it('emits the EXACT create body, with the title and body trimmed', () => {
    // ⚠️ IT MAKES NO REQUEST. The route component owns the write, because the
    // response is `{ id, slug }` and the queue it has to re-read is its data.
    const fixture = open();
    fill(fixture, '  Welcome to the forum  ', '  ## Hello everyone  ');

    button(fixture, 'Post thread').click();

    expect(submitted).toHaveBeenCalledWith({
      categoryId: 'cat_1',
      title: 'Welcome to the forum',
      body: '## Hello everyone',
      pinned: false,
      locked: false,
    });
  });

  it('preselects the first category, so the first submit cannot fail on it', () => {
    const fixture = open([
      category({ id: 'cat_7', name: 'Announcements' }),
      category({ id: 'cat_8', name: 'Help' }),
    ]);
    fill(fixture, 'A valid title', 'A body.');

    button(fixture, 'Post thread').click();

    expect(submitted.mock.calls[0][0].categoryId).toBe('cat_7');
  });

  it('renders the markdown body as a PLAIN TEXTAREA, with no preview', () => {
    // Previewing the draft would put a second consumer on the member markdown
    // chokepoint from an admin surface. The admin reads it back on the member
    // thread view, where it is sanitized once.
    const fixture = open();

    expect(fixture.nativeElement.querySelector('#thread-body').tagName).toBe(
      'TEXTAREA',
    );
    expect(
      fixture.nativeElement.querySelector('ptah-markdown-block'),
    ).toBeNull();
  });

  it('refuses an OVER-LONG title and emits nothing', () => {
    // Mirrors `CreateAdminTopicDto.title` `@MaxLength(200)`. The server's own
    // rejection is a `message: string[]` the screen masks, so this guard is
    // what turns the mistake into a sentence naming the field.
    const fixture = open();
    fill(fixture, 'x'.repeat(201), 'A body.');

    button(fixture, 'Post thread').click();
    fixture.detectChanges();

    expect(submitted).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'A title is at most 200 characters.',
    );
  });

  it('refuses a title under 3 characters and an empty body', () => {
    const fixture = open();
    fill(fixture, 'ab', 'A body.');
    button(fixture, 'Post thread').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'A title needs at least 3 characters.',
    );

    fill(fixture, 'A valid title', '   ');
    button(fixture, 'Post thread').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'The first post cannot be empty.',
    );

    expect(submitted).not.toHaveBeenCalled();
  });

  it('shows the route component sentence when its POST failed', () => {
    const fixture = open();
    fixture.componentRef.setInput('errorMessage', 'Category not found');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Category not found');
  });

  it('emits cancelled when the draft is discarded', () => {
    const fixture = open();

    button(fixture, 'Discard draft').click();

    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(submitted).not.toHaveBeenCalled();
  });
});
