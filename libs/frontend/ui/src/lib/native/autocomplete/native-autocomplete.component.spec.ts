import {
  Component,
  TemplateRef,
  ViewChild,
  ViewChildren,
  QueryList,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
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
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <ptah-native-autocomplete
      [suggestions]="suggestions()"
      [isLoading]="isLoading()"
      [isOpen]="isOpen()"
      [openActiveIndex]="openActiveIndex()"
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
  openActiveIndex = signal<number | null>(null);
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

@Component({
  standalone: true,
  imports: [NativeAutocompleteComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <ptah-native-autocomplete
      [suggestions]="firstSuggestions()"
      [isOpen]="isOpen()"
      [suggestionTemplate]="tpl"
    >
      <input type="text" autocompleteInput />
    </ptah-native-autocomplete>
    <ptah-native-autocomplete
      [suggestions]="secondSuggestions()"
      [isOpen]="isOpen()"
      [suggestionTemplate]="tpl"
    >
      <input type="text" autocompleteInput />
    </ptah-native-autocomplete>

    <ng-template #tpl let-suggestion>
      <span class="item-label">{{ suggestion.name }}</span>
    </ng-template>
  `,
})
class TwoAutocompleteHostComponent {
  @ViewChildren(NativeAutocompleteComponent)
  autocompletes!: QueryList<NativeAutocompleteComponent<TestSuggestion>>;
  @ViewChild('tpl', { static: true })
  tpl!: TemplateRef<{ $implicit: TestSuggestion }>;

  firstSuggestions = signal<TestSuggestion[]>([
    { id: 1, name: 'Alpha' },
    { id: 2, name: 'Beta' },
  ]);
  secondSuggestions = signal<TestSuggestion[]>([
    { id: 3, name: 'Gamma' },
    { id: 4, name: 'Delta' },
  ]);
  isOpen = signal(false);
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

    it('should return the prefixed option id when active', () => {
      host.isOpen.set(true);
      fixture.detectChanges();
      // Default first-item active after the open reset
      expect(host.autocomplete.getActiveDescendantId()).toBe(
        `${host.autocomplete.optionIdPrefix()}-0`,
      );
    });
  });

  describe('per-instance ids', () => {
    it('should render the listbox with the listboxId input', () => {
      host.isOpen.set(true);
      fixture.detectChanges();
      const panel = (fixture.nativeElement as HTMLElement).querySelector(
        '[role="listbox"]',
      );
      expect(panel?.getAttribute('id')).toBe(host.autocomplete.listboxId());
    });

    it('should render option ids from the optionIdPrefix input', () => {
      host.isOpen.set(true);
      fixture.detectChanges();
      const ids = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll(
          '[role="option"]',
        ),
      ).map((o) => o.id);
      expect(ids).toEqual(
        [0, 1, 2].map((i) => `${host.autocomplete.optionIdPrefix()}-${i}`),
      );
    });

    describe('two instances on one page', () => {
      let twoFixture: ComponentFixture<TwoAutocompleteHostComponent>;
      let twoHost: TwoAutocompleteHostComponent;
      let panels: HTMLElement[];

      beforeEach(() => {
        twoFixture = TestBed.createComponent(TwoAutocompleteHostComponent);
        twoHost = twoFixture.componentInstance;
        twoHost.isOpen.set(true);
        twoFixture.detectChanges();
        panels = Array.from(
          (twoFixture.nativeElement as HTMLElement).querySelectorAll(
            '[role="listbox"]',
          ),
        );
      });

      it('should generate disjoint listbox and option ids', () => {
        const [first, second] = twoHost.autocompletes.toArray();
        expect(panels).toHaveLength(2);
        expect(panels[0].id).toBe(first.listboxId());
        expect(panels[1].id).toBe(second.listboxId());
        expect(panels[0].id).not.toBe(panels[1].id);

        const ids = Array.from(
          (twoFixture.nativeElement as HTMLElement).querySelectorAll(
            '[role="option"]',
          ),
        ).map((o) => o.id);
        expect(ids).toHaveLength(4);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it('should point each activedescendant at its own panel only', () => {
        const [first, second] = twoHost.autocompletes.toArray();
        second.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

        const firstId = first.getActiveDescendantId();
        const secondId = second.getActiveDescendantId();
        expect(firstId).not.toBeNull();
        expect(secondId).not.toBeNull();
        expect(firstId).not.toBe(secondId);

        expect(
          panels[0].querySelector(`[id="${firstId}"]`),
        ).not.toBeNull();
        expect(panels[1].querySelector(`[id="${firstId}"]`)).toBeNull();
        expect(
          panels[1].querySelector(`[id="${secondId}"]`),
        ).not.toBeNull();
        expect(panels[0].querySelector(`[id="${secondId}"]`)).toBeNull();
      });
    });
  });

  describe('active index reset on reopen', () => {
    it('should reset to the first row when no openActiveIndex is given', () => {
      host.isOpen.set(true);
      fixture.detectChanges();
      host.autocomplete.onKeyDown(
        new KeyboardEvent('keydown', { key: 'ArrowDown' }),
      );
      expect(host.autocomplete.activeIndex()).toBe(1);

      host.isOpen.set(false);
      fixture.detectChanges();
      host.isOpen.set(true);
      fixture.detectChanges();

      expect(host.autocomplete.activeIndex()).toBe(0);
      expect(host.autocomplete.getActiveDescendantId()).toBe(
        `${host.autocomplete.optionIdPrefix()}-0`,
      );
    });

    it('should mark the requested row active on open and on reopen', () => {
      host.openActiveIndex.set(1);
      host.isOpen.set(true);
      fixture.detectChanges();
      expect(host.autocomplete.activeIndex()).toBe(1);

      host.isOpen.set(false);
      fixture.detectChanges();
      host.autocomplete.handleHover(2); // a stale index from the last session
      host.isOpen.set(true);
      fixture.detectChanges();
      expect(host.autocomplete.activeIndex()).toBe(1);
    });

    it('should keep no row active on open when openActiveIndex is -1', () => {
      host.openActiveIndex.set(-1);
      host.isOpen.set(true);
      fixture.detectChanges();
      expect(host.autocomplete.activeIndex()).toBe(-1);
      expect(host.autocomplete.getActiveDescendantId()).toBeNull();

      // Enter must not pick a row the user never navigated to.
      host.autocomplete.onKeyDown(
        new KeyboardEvent('keydown', { key: 'Enter' }),
      );
      expect(host.selected).toBeNull();

      // Arrows enter from the ends of the list.
      host.autocomplete.onKeyDown(
        new KeyboardEvent('keydown', { key: 'ArrowDown' }),
      );
      expect(host.autocomplete.activeIndex()).toBe(0);
    });

    it('should activate the first match when suggestions change while suppressed', () => {
      host.openActiveIndex.set(-1);
      host.isOpen.set(true);
      fixture.detectChanges();
      expect(host.autocomplete.activeIndex()).toBe(-1);

      // The user typed and the list narrowed: the first match must become
      // the active row, so Enter selects it.
      host.suggestions.set([
        { id: 2, name: 'Beta' },
        { id: 3, name: 'Gamma' },
      ]);
      fixture.detectChanges();

      expect(host.autocomplete.activeIndex()).toBe(0);
      host.autocomplete.onKeyDown(
        new KeyboardEvent('keydown', { key: 'Enter' }),
      );
      expect(host.selected?.name).toBe('Beta');
    });

    it('should hand the reopen highlight over to the first match when suggestions change', () => {
      host.openActiveIndex.set(2);
      host.isOpen.set(true);
      fixture.detectChanges();
      expect(host.autocomplete.activeIndex()).toBe(2);

      // The highlight holds until the user types; a changed list re-targets
      // the first match instead of staying sticky on the old row.
      host.suggestions.set([{ id: 1, name: 'Alpha' }]);
      fixture.detectChanges();

      expect(host.autocomplete.activeIndex()).toBe(0);
      host.autocomplete.onKeyDown(
        new KeyboardEvent('keydown', { key: 'Enter' }),
      );
      expect(host.selected?.name).toBe('Alpha');
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
