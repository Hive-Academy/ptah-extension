import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import type { MemberCategory } from '@ptah-contracts/community';
import { provideMarkdownRendering } from '@ptah-extension/markdown';

import { TopicComposer, type TopicDraft } from './topic-composer';

function category(overrides: Partial<MemberCategory> = {}): MemberCategory {
  return {
    id: 'cat_1',
    slug: 'general',
    name: 'General',
    description: null,
    visibility: 'member',
    sortOrder: 0,
    topicCount: 0,
    unreadCount: 0,
    ...overrides,
  };
}

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TopicComposer],
  template: `<ptah-topic-composer
    [categories]="categories()"
    [initialCategoryId]="initialCategoryId()"
    [submitting]="submitting()"
    [errorMessage]="errorMessage()"
    (submitted)="emitted.push($event)"
    (cancelled)="cancelCount = cancelCount + 1"
  />`,
})
class HostComponent {
  public readonly categories = signal<readonly MemberCategory[]>([
    category(),
    category({
      id: 'cat_2',
      slug: 'cohort-only',
      name: 'Cohort Lounge',
      visibility: 'cohort',
    }),
  ]);
  public readonly initialCategoryId = signal<string | null>(null);
  public readonly submitting = signal(false);
  public readonly errorMessage = signal<string | null>(null);
  public readonly emitted: TopicDraft[] = [];
  public cancelCount = 0;
}

function render(): ComponentFixture<HostComponent> {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return fixture;
}

function setValue(
  fixture: ComponentFixture<HostComponent>,
  selector: string,
  value: string,
): void {
  const element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =
    fixture.nativeElement.querySelector(selector);
  element.value = value;
  element.dispatchEvent(new Event(selector === 'select' ? 'change' : 'input'));
  fixture.detectChanges();
}

function selectedOptionValue(fixture: ComponentFixture<HostComponent>): string {
  // Read the `selected` PROPERTY on the options rather than `select.value`.
  // The component drives the choice through `[selected]` per option (see its
  // docblock), and `select.value` additionally reflects whatever the DOM did on
  // its own — which is what a spec must not silently accept as agreement.
  const options = Array.from<HTMLOptionElement>(
    fixture.nativeElement.querySelectorAll('option'),
  );
  return options.find((option) => option.selected)?.value ?? '';
}

function button(
  fixture: ComponentFixture<HostComponent>,
  text: string,
): HTMLButtonElement {
  const found = Array.from<HTMLButtonElement>(
    fixture.nativeElement.querySelectorAll('button'),
  ).find((b) => b.textContent?.trim().startsWith(text));
  if (!found) throw new Error(`No button starting with "${text}"`);
  return found;
}

function fillValidDraft(fixture: ComponentFixture<HostComponent>): void {
  setValue(fixture, 'select', 'cat_1');
  setValue(fixture, 'input[type="text"]', 'A real question');
  setValue(fixture, 'textarea', 'The body of post #1.');
}

describe('TopicComposer', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideMarkdownRendering({ extensions: 'member' })],
    });
  });

  it('emits the category, title and post #1 body (AD-9)', () => {
    // There is no separate topic body — post #1 IS the body, which is why the
    // field is named `bodyMarkdown` and shares the reply composer's bounds.
    const fixture = render();
    fillValidDraft(fixture);
    button(fixture, 'Post thread').click();

    expect(fixture.componentInstance.emitted).toEqual([
      {
        categoryId: 'cat_1',
        title: 'A real question',
        bodyMarkdown: 'The body of post #1.',
      },
    ]);
  });

  it('lists every category the SERVER returned, filtering none of them', () => {
    // The list already passed `buildCategoryVisibilityWhere` in the SQL. A
    // client-side filter here would re-implement, in the browser, a decision the
    // server already made correctly (R1.1.3).
    const options = Array.from<HTMLOptionElement>(
      render().nativeElement.querySelectorAll('option'),
    ).map((o) => o.textContent?.trim());

    expect(options).toEqual([
      'Choose a category…',
      'General',
      'Cohort Lounge (cohort only)',
    ]);
  });

  it('treats `visibility` as a LABEL, not a gate', () => {
    // A `'cohort'` category reaching a member response means that member can
    // already see it. The suffix says so; it never removes the option.
    const cohortOption: HTMLOptionElement =
      render().nativeElement.querySelectorAll('option')[2];

    expect(cohortOption.value).toBe('cat_2');
    expect(cohortOption.disabled).toBe(false);
  });

  it('preselects the rail category but lets an explicit choice win', () => {
    const fixture = render();
    fixture.componentInstance.initialCategoryId.set('cat_2');
    fixture.detectChanges();
    expect(selectedOptionValue(fixture)).toBe('cat_2');

    setValue(fixture, 'select', 'cat_1');
    // Switching the rail underneath must not move a draft the member retargeted.
    fixture.componentInstance.initialCategoryId.set('cat_2');
    fixture.detectChanges();
    expect(selectedOptionValue(fixture)).toBe('cat_1');
  });

  it('will not submit without a category, a 3-character title and a body', () => {
    const fixture = render();
    expect(button(fixture, 'Post thread').disabled).toBe(true);

    setValue(fixture, 'select', 'cat_1');
    setValue(fixture, 'input[type="text"]', 'ab');
    setValue(fixture, 'textarea', 'body');
    // 2 characters — the server's `@MinLength(3)` would 400. The affordance is
    // a disabled button, not a client-side rejection message.
    expect(button(fixture, 'Post thread').disabled).toBe(true);

    setValue(fixture, 'input[type="text"]', 'abc');
    expect(button(fixture, 'Post thread').disabled).toBe(false);
  });

  it('renders the preview through <ptah-markdown-block>, never innerHTML', () => {
    // ⚠️ NFR-S2 — see `reply-composer.spec.ts`. Both composers are on the one
    // sanitizer, and both prove it at runtime rather than by convention.
    const fixture = render();
    fillValidDraft(fixture);
    button(fixture, 'Preview').click();
    fixture.detectChanges();

    const preview = fixture.nativeElement.querySelector(
      '[data-testid="topic-preview"]',
    );
    expect(preview.querySelector('ptah-markdown-block')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('markdown').className).toContain(
      'dark:prose-invert',
    );
  });

  it('shows a server-side failure', () => {
    const fixture = render();
    fixture.componentInstance.errorMessage.set('Category not found.');
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[role="alert"]').textContent,
    ).toContain('Category not found.');
  });

  it('labels every control, and the ids are per-instance', () => {
    const fixture = render();
    const labels = Array.from<HTMLLabelElement>(
      fixture.nativeElement.querySelectorAll('label'),
    );
    const targets = labels.map((l) => l.getAttribute('for'));

    expect(targets).toHaveLength(3);
    for (const target of targets) {
      expect(fixture.nativeElement.querySelector(`#${target}`)).not.toBeNull();
    }

    const second = render();
    expect(
      (second.nativeElement.querySelector('select') as HTMLSelectElement).id,
    ).not.toBe(
      (fixture.nativeElement.querySelector('select') as HTMLSelectElement).id,
    );
  });

  it('drives the choice through [selected], never a select-level [value]', () => {
    // The options are rendered by an `@for` in the same change detection pass;
    // a `<select>` whose `value` is bound before its options exist silently
    // resets to the first one. That failure is invisible until a member submits
    // a thread into the wrong category.
    const fixture = render();
    setValue(fixture, 'select', 'cat_2');

    expect(selectedOptionValue(fixture)).toBe('cat_2');
  });

  it('emits `cancelled` without emitting a draft', () => {
    const fixture = render();
    fillValidDraft(fixture);
    button(fixture, 'Cancel').click();

    expect(fixture.componentInstance.cancelCount).toBe(1);
    expect(fixture.componentInstance.emitted).toEqual([]);
  });
});
