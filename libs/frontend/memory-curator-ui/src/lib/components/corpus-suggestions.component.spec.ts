import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import type { CorpusSuggestion } from '@ptah-extension/shared';

import { CorpusSuggestionsComponent } from './corpus-suggestions.component';

const conceptSuggestion: CorpusSuggestion = {
  suggestedName: 'auth',
  filter: { name: 'auth', concepts: ['auth'], limit: 100 },
  memberCount: 8,
  topConcepts: ['auth', 'login'],
  rationale: '8 memories tagged "auth" (mostly bugfix)',
  signal: 'concept',
};

const typeSuggestion: CorpusSuggestion = {
  suggestedName: 'Bugfix memories',
  filter: { name: 'Bugfix memories', type: ['bugfix'], limit: 100 },
  memberCount: 14,
  topConcepts: [],
  rationale: '14 bugfix memories',
  signal: 'type',
};

function makeFixture(): ComponentFixture<CorpusSuggestionsComponent> {
  return TestBed.createComponent(CorpusSuggestionsComponent);
}

describe('CorpusSuggestionsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CorpusSuggestionsComponent],
    }).compileComponents();
  });

  it('renders a card per suggestion with name, member count, concepts and rationale', () => {
    const fixture = makeFixture();
    fixture.componentRef.setInput('suggestions', [
      conceptSuggestion,
      typeSuggestion,
    ]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';

    expect(el.querySelectorAll('article').length).toBe(2);
    expect(text).toContain('auth');
    expect(text).toContain('8 memories');
    expect(text).toContain('login');
    expect(text).toContain('8 memories tagged "auth" (mostly bugfix)');
    expect(text).toContain('Bugfix memories');
    expect(text).toContain('14 memories');
  });

  it('renders nothing when there are no suggestions and not loading', () => {
    const fixture = makeFixture();
    fixture.componentRef.setInput('suggestions', []);
    fixture.componentRef.setInput('loading', false);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('section')).toBeNull();
    expect((el.textContent ?? '').trim()).toBe('');
  });

  it('renders skeleton cards while loading even with no suggestions', () => {
    const fixture = makeFixture();
    fixture.componentRef.setInput('suggestions', []);
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('section')).not.toBeNull();
    expect(el.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
  });

  it('emits (create) with the suggestion when Create is clicked', () => {
    const fixture = makeFixture();
    fixture.componentRef.setInput('suggestions', [conceptSuggestion]);
    fixture.detectChanges();

    const created: CorpusSuggestion[] = [];
    fixture.componentInstance.create.subscribe((s) => created.push(s));

    const createBtn = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find(
      (b) => (b.textContent ?? '').trim() === 'Create',
    ) as HTMLButtonElement;
    createBtn.click();

    expect(created).toEqual([conceptSuggestion]);
  });

  it('emits (dismiss) with the suggestion when the × button is clicked', () => {
    const fixture = makeFixture();
    fixture.componentRef.setInput('suggestions', [conceptSuggestion]);
    fixture.detectChanges();

    const dismissed: CorpusSuggestion[] = [];
    fixture.componentInstance.dismiss.subscribe((s) => dismissed.push(s));

    const dismissBtn = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => (b.textContent ?? '').trim() === '×') as HTMLButtonElement;
    dismissBtn.click();

    expect(dismissed).toEqual([conceptSuggestion]);
  });

  it('disables the Create button when busyName matches the suggestion', () => {
    const fixture = makeFixture();
    fixture.componentRef.setInput('suggestions', [conceptSuggestion]);
    fixture.componentRef.setInput('busyName', 'auth');
    fixture.detectChanges();

    const createBtn = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) =>
      (b.textContent ?? '').trim().includes('Create'),
    ) as HTMLButtonElement;

    expect(createBtn.disabled).toBe(true);
  });
});
