import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, TemplateRef, ViewChild, signal } from '@angular/core';
import { AutocompleteComponent } from './autocomplete.component';
import { OverlayModule } from '@angular/cdk/overlay';

interface TestSuggestion {
  id: number;
  name: string;
  icon: string;
}

@Component({
  standalone: true,
  imports: [AutocompleteComponent],
  template: `
    <lib-autocomplete
      [suggestions]="suggestions()"
      [isLoading]="isLoading()"
      [isOpen]="isOpen()"
      [headerTitle]="headerTitle()"
      [ariaLabel]="ariaLabel()"
      [emptyMessage]="emptyMessage()"
      [trackBy]="trackByFn"
      [suggestionTemplate]="suggestionTemplate"
      (suggestionSelected)="onSuggestionSelected($event)"
      (closed)="onClosed()">
      <input type="text" autocompleteInput #input />
    </lib-autocomplete>

    <ng-template #suggestionTemplate let-suggestion>
      <div class="flex items-center gap-2">
        <span>{{ suggestion.icon }}</span>
        <span>{{ suggestion.name }}</span>
      </div>
    </ng-template>
  `,
})
class TestHostComponent {
  @ViewChild(AutocompleteComponent)
  autocompleteComponent!: AutocompleteComponent<TestSuggestion>;
  @ViewChild('suggestionTemplate', { static: true })
  suggestionTemplate!: TemplateRef<{ $implicit: TestSuggestion }>;

  suggestions = signal<TestSuggestion[]>([
    { id: 1, name: 'Option 1', icon: '📄' },
    { id: 2, name: 'Option 2', icon: '📁' },
    { id: 3, name: 'Option 3', icon: '🔧' },
  ]);
  isLoading = signal(false);
  isOpen = signal(false);
  headerTitle = signal('Test Suggestions');
  ariaLabel = signal('Test Autocomplete');
  emptyMessage = signal('No matches');

  trackByFn = (index: number, item: TestSuggestion) => item.id;

  selectedSuggestion: TestSuggestion | null = null;
  closedCount = 0;

  onSuggestionSelected(suggestion: TestSuggestion): void {
    this.selectedSuggestion = suggestion;
  }

  onClosed(): void {
    this.closedCount++;
  }
}

describe('AutocompleteComponent', () => {
  let component: AutocompleteComponent<TestSuggestion>;
  let hostComponent: TestHostComponent;
  let fixture: ComponentFixture<TestHostComponent>;
  let scrollIntoViewMock: jest.Mock;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent, AutocompleteComponent, OverlayModule],
    }).compileComponents();

    // Mock scrollIntoView for all tests using Object.defineProperty
    scrollIntoViewMock = jest.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      writable: true,
      configurable: true,
      value: scrollIntoViewMock,
    });

    fixture = TestBed.createComponent(TestHostComponent);
    hostComponent = fixture.componentInstance;
    fixture.detectChanges();
    component = hostComponent.autocompleteComponent;
  });

  describe('Component Initialization', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should have correct selector', () => {
      const autocompleteElement =
        fixture.nativeElement.querySelector('lib-autocomplete');
      expect(autocompleteElement).toBeTruthy();
    });

    it('should accept required inputs', () => {
      expect(component.suggestions()).toEqual(hostComponent.suggestions());
      expect(component.isOpen()).toBe(false);
    });

    it('should accept optional inputs with defaults', () => {
      expect(component.isLoading()).toBe(false);
      expect(component.headerTitle()).toBe('Test Suggestions');
      expect(component.ariaLabel()).toBe('Test Autocomplete');
      expect(component.emptyMessage()).toBe('No matches');
    });
  });

  describe('Portal Rendering', () => {
    it('should NOT render dropdown when isOpen is false', () => {
      hostComponent.isOpen.set(false);
      fixture.detectChanges();

      const overlayContainer = document.querySelector('.cdk-overlay-container');
      const suggestionsPanel =
        overlayContainer?.querySelector('.suggestions-panel');
      expect(suggestionsPanel).toBeFalsy();
    });

    it('should render dropdown in portal when isOpen is true', (done) => {
      hostComponent.isOpen.set(true);
      fixture.detectChanges();

      // Give CDK time to render overlay
      setTimeout(() => {
        const overlayContainer =
          document.querySelector('.cdk-overlay-container');
        expect(overlayContainer).toBeTruthy();

        const suggestionsPanel =
          overlayContainer?.querySelector('.suggestions-panel');
        expect(suggestionsPanel).toBeTruthy();
        done();
      }, 100);
    });

    it('should render dropdown with correct ARIA role', (done) => {
      hostComponent.isOpen.set(true);
      fixture.detectChanges();

      setTimeout(() => {
        const suggestionsPanel = document.querySelector('.suggestions-panel');
        expect(suggestionsPanel?.getAttribute('role')).toBe('listbox');
        done();
      }, 100);
    });

    it('should render dropdown with correct ARIA label', (done) => {
      hostComponent.ariaLabel.set('Custom Label');
      hostComponent.isOpen.set(true);
      fixture.detectChanges();

      setTimeout(() => {
        const suggestionsPanel = document.querySelector('.suggestions-panel');
        expect(suggestionsPanel?.getAttribute('aria-label')).toBe(
          'Custom Label'
        );
        done();
      }, 100);
    });
  });

  describe('Loading State', () => {
    it('should show loading spinner when isLoading is true', (done) => {
      hostComponent.isLoading.set(true);
      hostComponent.isOpen.set(true);
      fixture.detectChanges();

      setTimeout(() => {
        const spinner = document.querySelector('.loading-spinner');
        expect(spinner).toBeTruthy();

        const loadingText = document.querySelector('.suggestions-panel');
        expect(loadingText?.textContent).toContain('Loading...');
        done();
      }, 100);
    });

    it('should NOT show suggestions when loading', (done) => {
      hostComponent.isLoading.set(true);
      hostComponent.isOpen.set(true);
      fixture.detectChanges();

      setTimeout(() => {
        const options = document.querySelectorAll('lib-option');
        expect(options.length).toBe(0);
        done();
      }, 100);
    });

    it('should disable keyboard navigation when loading', () => {
      hostComponent.isLoading.set(true);
      hostComponent.isOpen.set(true);
      fixture.detectChanges();

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown' });
      const handled = component.onKeyDown(event);
      expect(handled).toBe(false);
    });
  });

  describe('Empty State', () => {
    it('should show empty message when suggestions array is empty', (done) => {
      hostComponent.suggestions.set([]);
      hostComponent.isLoading.set(false);
      hostComponent.isOpen.set(true);
      fixture.detectChanges();

      setTimeout(() => {
        const emptyMessage = document.querySelector('.suggestions-panel');
        expect(emptyMessage?.textContent).toContain('No matches');
        done();
      }, 100);
    });

    it('should show custom empty message', (done) => {
      hostComponent.suggestions.set([]);
      hostComponent.emptyMessage.set('Custom empty message');
      hostComponent.isOpen.set(true);
      fixture.detectChanges();

      setTimeout(() => {
        const emptyMessage = document.querySelector('.suggestions-panel');
        expect(emptyMessage?.textContent).toContain('Custom empty message');
        done();
      }, 100);
    });

    it('should NOT show suggestions when empty', (done) => {
      hostComponent.suggestions.set([]);
      hostComponent.isOpen.set(true);
      fixture.detectChanges();

      setTimeout(() => {
        const options = document.querySelectorAll('lib-option');
        expect(options.length).toBe(0);
        done();
      }, 100);
    });
  });

  describe('Suggestions Rendering', () => {
    it('should render correct number of suggestions', (done) => {
      hostComponent.isLoading.set(false);
      hostComponent.isOpen.set(true);
      fixture.detectChanges();

      setTimeout(() => {
        const options = document.querySelectorAll('lib-option');
        expect(options.length).toBe(3);
        done();
      }, 100);
    });

    it('should render header when headerTitle is provided', (done) => {
      hostComponent.headerTitle.set('File Suggestions');
      hostComponent.isOpen.set(true);
      fixture.detectChanges();

      setTimeout(() => {
        const header = document.querySelector('.suggestions-panel');
        expect(header?.textContent).toContain('FILE SUGGESTIONS');
        done();
      }, 100);
    });

    it('should NOT render header when headerTitle is empty', (done) => {
      hostComponent.headerTitle.set('');
      hostComponent.isOpen.set(true);
      fixture.detectChanges();

      setTimeout(() => {
        const headerElement = document.querySelector('.border-b');
        expect(headerElement).toBeFalsy();
        done();
      }, 100);
    });
  });

  describe('Keyboard Navigation - ActiveDescendantKeyManager', () => {
    it('should handle ArrowDown key', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown' });
      const handled = component.onKeyDown(event);
      expect(handled).toBe(true);
    });

    it('should handle ArrowUp key', () => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowUp' });
      const handled = component.onKeyDown(event);
      expect(handled).toBe(true);
    });

    it('should handle Home key', () => {
      const event = new KeyboardEvent('keydown', { key: 'Home' });
      const handled = component.onKeyDown(event);
      expect(handled).toBe(true);
    });

    it('should handle End key', () => {
      const event = new KeyboardEvent('keydown', { key: 'End' });
      const handled = component.onKeyDown(event);
      expect(handled).toBe(true);
    });

    it('should handle Enter key and emit selection', (done) => {
      hostComponent.isOpen.set(true);
      fixture.detectChanges();

      setTimeout(() => {
        const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
        const handled = component.onKeyDown(enterEvent);

        expect(handled).toBe(true);
        expect(hostComponent.selectedSuggestion).toEqual({
          id: 1,
          name: 'Option 1',
          icon: '📄',
        });
        done();
      }, 100);
    });

    it('should handle Escape key and emit closed', () => {
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      const handled = component.onKeyDown(event);

      expect(handled).toBe(true);
      expect(hostComponent.closedCount).toBe(1);
    });

    it('should NOT handle unrelated keys', () => {
      const event = new KeyboardEvent('keydown', { key: 'a' });
      const handled = component.onKeyDown(event);
      expect(handled).toBe(false);
    });
  });

  describe('Mouse Interaction', () => {
    it('should handle hover event and update active item', () => {
      component.handleHover(2);
      fixture.detectChanges();

      const activeId = component.getActiveDescendantId();
      expect(activeId).toContain('suggestion-');
    });

    it('should emit suggestionSelected on option click', () => {
      const suggestion = hostComponent.suggestions()[1];
      component.handleSelection(suggestion);

      expect(hostComponent.selectedSuggestion).toEqual(suggestion);
    });
  });

  describe('Public API Methods', () => {
    it('should selectFocused emit currently active suggestion', (done) => {
      hostComponent.isOpen.set(true);
      fixture.detectChanges();

      setTimeout(() => {
        component.handleHover(1);
        fixture.detectChanges();

        component.selectFocused();

        expect(hostComponent.selectedSuggestion).toEqual({
          id: 2,
          name: 'Option 2',
          icon: '📁',
        });
        done();
      }, 100);
    });

    it('should getActiveDescendantId return active option ID', (done) => {
      hostComponent.isOpen.set(true);
      fixture.detectChanges();

      setTimeout(() => {
        component.handleHover(0);
        fixture.detectChanges();

        const activeId = component.getActiveDescendantId();
        expect(activeId).toBe('suggestion-0');
        done();
      }, 100);
    });

    it('should getActiveDescendantId return null when no active item', () => {
      const activeId = component.getActiveDescendantId();
      expect(activeId).toBeNull();
    });
  });

  describe('Dynamic Suggestions Updates', () => {
    it('should update suggestions when input changes', (done) => {
      hostComponent.isOpen.set(true);
      fixture.detectChanges();

      setTimeout(() => {
        let options = document.querySelectorAll('lib-option');
        expect(options.length).toBe(3);

        hostComponent.suggestions.set([
          { id: 4, name: 'New Option 1', icon: '🆕' },
          { id: 5, name: 'New Option 2', icon: '✨' },
        ]);
        fixture.detectChanges();

        setTimeout(() => {
          options = document.querySelectorAll('lib-option');
          expect(options.length).toBe(2);
          done();
        }, 100);
      }, 100);
    });
  });

  describe('Lifecycle Hooks', () => {
    it('should cleanup keyManager on destroy', (done) => {
      hostComponent.isOpen.set(true);
      fixture.detectChanges();

      setTimeout(() => {
        const destroySpy = jest.spyOn(
          component['keyManager'] as any,
          'destroy'
        );
        fixture.destroy();

        expect(destroySpy).toHaveBeenCalled();
        done();
      }, 100);
    });
  });

  describe('Accessibility - ARIA Attributes', () => {
    it('should set correct role on suggestions panel', (done) => {
      hostComponent.isOpen.set(true);
      fixture.detectChanges();

      setTimeout(() => {
        const suggestionsPanel = document.querySelector('.suggestions-panel');
        expect(suggestionsPanel?.getAttribute('role')).toBe('listbox');
        done();
      }, 100);
    });

    it('should set aria-label on suggestions panel', (done) => {
      hostComponent.ariaLabel.set('File Autocomplete');
      hostComponent.isOpen.set(true);
      fixture.detectChanges();

      setTimeout(() => {
        const suggestionsPanel = document.querySelector('.suggestions-panel');
        expect(suggestionsPanel?.getAttribute('aria-label')).toBe(
          'File Autocomplete'
        );
        done();
      }, 100);
    });

    it('should provide activeOptionId for parent aria-activedescendant', (done) => {
      hostComponent.isOpen.set(true);
      fixture.detectChanges();

      setTimeout(() => {
        const activeId = component.getActiveDescendantId();
        expect(activeId).toBe('suggestion-0');
        done();
      }, 100);
    });
  });
});
