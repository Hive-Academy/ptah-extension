import {
  Component,
  ElementRef,
  ViewChild,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { File } from 'lucide-angular';
import * as FloatingDom from '@floating-ui/dom';
import { UnifiedSuggestionsDropdownComponent } from './unified-suggestions-dropdown.component';
import type { SuggestionItem } from './suggestion-option.component';

jest.mock('@floating-ui/dom', () => {
  const actual = jest.requireActual('@floating-ui/dom');
  return {
    ...actual,
    computePosition: jest.fn().mockResolvedValue({ x: 0, y: 0 }),
    autoUpdate: jest.fn().mockReturnValue(() => undefined),
  };
});

function fileSuggestion(path: string, name: string): SuggestionItem {
  return {
    type: 'file',
    path,
    name,
    directory: '/workspace',
    isImage: false,
    isText: true,
    icon: File,
    description: path,
  };
}

function commandSuggestion(name: string): SuggestionItem {
  return {
    type: 'command',
    name,
    description: 'Orchestrate tasks',
    scope: 'builtin',
    icon: File,
  };
}

function promptSuggestion(
  label: string,
  category: string,
  text = `/orchestrate ${label}`,
): SuggestionItem {
  return {
    type: 'prompt',
    label,
    text,
    description: 'Plan, implement, review',
    category,
  };
}

@Component({
  standalone: true,
  imports: [UnifiedSuggestionsDropdownComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <ptah-unified-suggestions-dropdown
      [overlayOrigin]="overlayOrigin"
      [suggestions]="suggestions()"
      (suggestionSelected)="onSelected($event)"
    />
  `,
})
class HostComponent {
  @ViewChild(UnifiedSuggestionsDropdownComponent)
  dropdown!: UnifiedSuggestionsDropdownComponent;

  readonly overlayOrigin = {
    elementRef: new ElementRef(document.createElement('div')),
  };
  readonly suggestions = signal<SuggestionItem[]>([
    fileSuggestion('/workspace/a.ts', 'a.ts'),
    fileSuggestion('/workspace/b.ts', 'b.ts'),
    fileSuggestion('/workspace/c.ts', 'c.ts'),
    fileSuggestion('/workspace/d.ts', 'd.ts'),
  ]);
  readonly selectedItems: SuggestionItem[] = [];

  onSelected(item: SuggestionItem): void {
    this.selectedItems.push(item);
  }
}

describe('UnifiedSuggestionsDropdownComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    (FloatingDom.computePosition as unknown as jest.Mock).mockClear();

    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;

    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      writable: true,
      configurable: true,
      value: jest.fn(),
    });

    fixture.detectChanges();
  });

  it('resets the active row to the first match when typing narrows the suggestions', () => {
    host.dropdown.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    host.dropdown.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(host.dropdown.activeIndex()).toBe(2);

    host.suggestions.set([
      fileSuggestion('/workspace/a.ts', 'a.ts'),
      fileSuggestion('/workspace/b.ts', 'b.ts'),
    ]);
    fixture.detectChanges();

    expect(host.dropdown.activeIndex()).toBe(0);
  });

  describe('prompt suggestions (TASK_2026_721 B8c2)', () => {
    it('renders prompts after commands with a divider and category badge', () => {
      host.suggestions.set([
        commandSuggestion('orchestrate'),
        promptSuggestion('Orchestrate a feature', 'Build'),
        promptSuggestion('Security vulnerability scan', 'Review'),
      ]);
      fixture.detectChanges();

      const panel = fixture.nativeElement as HTMLElement;
      const options = Array.from(
        panel.querySelectorAll<HTMLElement>('ptah-suggestion-option'),
      );
      expect(options.length).toBe(3);
      expect(options[0]?.textContent).toContain('orchestrate');
      expect(options[1]?.textContent).toContain('Orchestrate a feature');
      expect(options[1]?.textContent).toContain('Prompt · Build');
      expect(options[2]?.textContent).toContain('Prompt · Review');

      const dividers = Array.from(
        panel.querySelectorAll('[role="presentation"]'),
      );
      expect(dividers.length).toBe(1);
      expect(dividers[0]?.textContent).toContain('Prompts');
      expect(panel.textContent).toContain('Commands & Prompts');
    });

    it('emits the prompt item when Enter selects the active prompt row', () => {
      host.suggestions.set([
        commandSuggestion('orchestrate'),
        promptSuggestion('Security vulnerability scan', 'Review'),
      ]);
      fixture.detectChanges();

      host.dropdown.onKeyDown(
        new KeyboardEvent('keydown', { key: 'ArrowDown' }),
      );
      expect(host.dropdown.activeIndex()).toBe(1);

      host.dropdown.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(host.selectedItems).toEqual([
        promptSuggestion('Security vulnerability scan', 'Review'),
      ]);
    });
  });
});
