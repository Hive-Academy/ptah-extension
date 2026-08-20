import { Component, ElementRef, ViewChild, signal } from '@angular/core';
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

@Component({
  standalone: true,
  imports: [UnifiedSuggestionsDropdownComponent],
  template: `
    <ptah-unified-suggestions-dropdown
      [overlayOrigin]="overlayOrigin"
      [suggestions]="suggestions()"
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
});
