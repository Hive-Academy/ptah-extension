import { Component, TemplateRef, ViewChild, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import * as FloatingDom from '@floating-ui/dom';
import { NativeAutocompleteComponent } from './native-autocomplete.component';

jest.mock('@floating-ui/dom', () => {
  const actual = jest.requireActual('@floating-ui/dom');
  return {
    ...actual,
    computePosition: jest.fn().mockResolvedValue({ x: 0, y: 0 }),
    autoUpdate: jest.fn().mockReturnValue(() => undefined),
  };
});

interface TestSuggestion {
  id: number;
  name: string;
}

@Component({
  standalone: true,
  imports: [NativeAutocompleteComponent],
  template: `
    <ptah-native-autocomplete
      [suggestions]="suggestions()"
      [isLoading]="isLoading()"
      [isOpen]="isOpen()"
      [headerTitle]="headerTitle()"
      [ariaLabel]="ariaLabel()"
      [emptyMessage]="emptyMessage()"
      [suggestionTemplate]="tpl"
      (suggestionSelected)="onSelected($event)"
      (closed)="onClosed()"
    >
      <input type="text" autocompleteInput />
    </ptah-native-autocomplete>

    <ng-template #tpl let-suggestion>
      <span class="item-label">{{ suggestion.name }}</span>
    </ng-template>
  `,
})
class HostComponent {
  @ViewChild(NativeAutocompleteComponent)
  autocomplete!: NativeAutocompleteComponent<TestSuggestion>;
  @ViewChild('tpl', { static: true })
  tpl!: TemplateRef<{ $implicit: TestSuggestion }>;

  suggestions = signal<TestSuggestion[]>([
    { id: 1, name: 'Alpha' },
    { id: 2, name: 'Beta' },
    { id: 3, name: 'Gamma' },
  ]);
  isLoading = signal(false);
  isOpen = signal(false);
  headerTitle = signal('Suggestions');
  ariaLabel = signal('Autocomplete');
  emptyMessage = signal('Nothing found');

  selected: TestSuggestion | null = null;
  closedCount = 0;

  onSelected(s: TestSuggestion): void {
    this.selected = s;
  }
  onClosed(): void {
    this.closedCount++;
  }
}

describe('NativeAutocompleteComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let scrollIntoViewMock: jest.Mock;

  beforeEach(async () => {
    (FloatingDom.computePosition as unknown as jest.Mock).mockClear();

    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;

    scrollIntoViewMock = jest.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      writable: true,
      configurable: true,
      value: scrollIntoViewMock,
    });

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(host.autocomplete).toBeTruthy();
  });

  it('should always render the input slot', () => {
    const input = (fixture.nativeElement as HTMLElement).querySelector('input');
    expect(input).toBeTruthy();
  });

  it('should NOT render suggestions panel when isOpen is false', () => {
    const panel = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="listbox"]',
    );
    expect(panel).toBeFalsy();
  });

  it('should render suggestions panel when isOpen is true', () => {
    host.isOpen.set(true);
    fixture.detectChanges();

    const panel = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="listbox"]',
    );
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('aria-label')).toBe('Autocomplete');
  });

  it('should render header title when provided', () => {
    host.isOpen.set(true);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Suggestions');
  });

  it('should render loading state when isLoading is true', () => {
    host.isLoading.set(true);
    host.isOpen.set(true);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.loading-spinner')).toBeTruthy();
    expect(compiled.textContent).toContain('Loading');
  });

  it('should render empty message when suggestions is empty and not loading', () => {
    host.suggestions.set([]);
    host.isOpen.set(true);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Nothing found');
  });

  it('should render one option per suggestion with template content', () => {
    host.isOpen.set(true);
    fixture.detectChanges();

    const items = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.item-label',
    );
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('Alpha');
    expect(items[1].textContent).toBe('Beta');
    expect(items[2].textContent).toBe('Gamma');
  });

  describe('onKeyDown()', () => {
    beforeEach(() => {
      host.isOpen.set(true);
      fixture.detectChanges();
    });

    it('should return false when loading', () => {
      host.isLoading.set(true);
      fixture.detectChanges();
      const handled = host.autocomplete.onKeyDown(
        new KeyboardEvent('keydown', { key: 'ArrowDown' }),
      );
      expect(handled).toBe(false);
    });

    it('should handle Enter by selecting active suggestion', () => {
      host.autocomplete.onKeyDown(
        new KeyboardEvent('keydown', { key: 'ArrowDown' }),
      );
      const handled = host.autocomplete.onKeyDown(
        new KeyboardEvent('keydown', { key: 'Enter' }),
      );
      expect(handled).toBe(true);
      expect(host.selected?.name).toBe('Beta');
    });

    it('should handle Escape by emitting closed', () => {
      const handled = host.autocomplete.onKeyDown(
        new KeyboardEvent('keydown', { key: 'Escape' }),
      );
      expect(handled).toBe(true);
      expect(host.closedCount).toBe(1);
    });

    it('should handle ArrowDown / ArrowUp via keyboard navigation', () => {
      const downHandled = host.autocomplete.onKeyDown(
        new KeyboardEvent('keydown', { key: 'ArrowDown' }),
      );
      expect(downHandled).toBe(true);
      expect(host.autocomplete.activeIndex()).toBe(1);

      const upHandled = host.autocomplete.onKeyDown(
        new KeyboardEvent('keydown', { key: 'ArrowUp' }),
      );
      expect(upHandled).toBe(true);
      expect(host.autocomplete.activeIndex()).toBe(0);
    });

    it('should return false for unknown keys', () => {
      const handled = host.autocomplete.onKeyDown(
        new KeyboardEvent('keydown', { key: 'x' }),
      );
      expect(handled).toBe(false);
    });
  });

  describe('selectFocused()', () => {
    it('should emit suggestionSelected with the active item', () => {
      host.isOpen.set(true);
      fixture.detectChanges();

      host.autocomplete.selectFocused();

      expect(host.selected?.name).toBe('Alpha');
    });

    it('should NOT emit when no active item (empty list)', () => {
      host.suggestions.set([]);
      host.isOpen.set(true);
      fixture.detectChanges();

      host.autocomplete.selectFocused();

      expect(host.selected).toBeNull();
    });
  });

  describe('handleHover() / handleSelection()', () => {
    beforeEach(() => {
      host.isOpen.set(true);
      fixture.detectChanges();
    });

    it('handleHover() should update active index', () => {
      host.autocomplete.handleHover(2);
      expect(host.autocomplete.activeIndex()).toBe(2);
    });

    it('handleSelection() should emit the value', () => {
      host.autocomplete.handleSelection({ id: 99, name: 'Custom' });
      expect(host.selected).toEqual({ id: 99, name: 'Custom' });
    });
  });

  describe('getActiveDescendantId()', () => {
    it('should return null when no active index', () => {
      host.suggestions.set([]);
      host.isOpen.set(true);
      fixture.detectChanges();
      expect(host.autocomplete.getActiveDescendantId()).toBeNull();
    });

    it('should return suggestion-<index> when active', () => {
      host.isOpen.set(true);
      fixture.detectChanges();
      // Default first-item active after configure
      expect(host.autocomplete.getActiveDescendantId()).toBe('suggestion-0');
    });
  });

  describe('Click-outside behavior', () => {
    it('should emit closed when clicking outside the autocomplete', () => {
      host.isOpen.set(true);
      fixture.detectChanges();

      const outside = document.createElement('div');
      document.body.appendChild(outside);
      outside.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );

      expect(host.closedCount).toBe(1);
      outside.remove();
    });

    it('should NOT emit closed when clicking the input area', () => {
      host.isOpen.set(true);
      fixture.detectChanges();

      const input = (fixture.nativeElement as HTMLElement).querySelector(
        'input',
      ) as HTMLElement;
      input.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );

      expect(host.closedCount).toBe(0);
    });

    it('should NOT emit closed when isOpen is false', () => {
      const outside = document.createElement('div');
      document.body.appendChild(outside);
      outside.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
      expect(host.closedCount).toBe(0);
      outside.remove();
    });
  });

  describe('Escape key on document', () => {
    it('should emit closed when Escape is dispatched on document', () => {
      host.isOpen.set(true);
      fixture.detectChanges();

      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );

      expect(host.closedCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('ngOnDestroy', () => {
    it('should cleanup without throwing', () => {
      host.isOpen.set(true);
      fixture.detectChanges();
      expect(() => fixture.destroy()).not.toThrow();
    });
  });
});
