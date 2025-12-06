import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DebugElement } from '@angular/core';
import { OptionComponent } from './option.component';

describe('OptionComponent', () => {
  let component: OptionComponent<string>;
  let fixture: ComponentFixture<OptionComponent<string>>;
  let debugElement: DebugElement;
  let scrollIntoViewMock: jest.Mock;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OptionComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(OptionComponent<string>);
    component = fixture.componentInstance;
    debugElement = fixture.debugElement;

    // Mock scrollIntoView for all tests using Object.defineProperty
    scrollIntoViewMock = jest.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      writable: true,
      configurable: true,
      value: scrollIntoViewMock,
    });
  });

  describe('Initialization', () => {
    it('should create', () => {
      fixture.componentRef.setInput('optionId', 'option-1');
      fixture.componentRef.setInput('value', 'test-value');
      fixture.detectChanges();

      expect(component).toBeTruthy();
    });

    it('should initialize with isActive false', () => {
      fixture.componentRef.setInput('optionId', 'option-1');
      fixture.componentRef.setInput('value', 'test-value');
      fixture.detectChanges();

      expect(component.isActive).toBe(false);
    });

    it('should render with correct optionId', () => {
      fixture.componentRef.setInput('optionId', 'option-test-1');
      fixture.componentRef.setInput('value', 'test-value');
      fixture.detectChanges();

      const hostElement = debugElement.nativeElement as HTMLElement;
      expect(hostElement.id).toBe('option-test-1');
    });
  });

  describe('Highlightable interface - setActiveStyles', () => {
    it('should set isActive to true', () => {
      fixture.componentRef.setInput('optionId', 'option-1');
      fixture.componentRef.setInput('value', 'test-value');
      fixture.detectChanges();

      component.setActiveStyles();

      expect(component.isActive).toBe(true);
    });

    it('should apply bg-primary class when active', () => {
      fixture.componentRef.setInput('optionId', 'option-1');
      fixture.componentRef.setInput('value', 'test-value');
      fixture.detectChanges();

      component.setActiveStyles();
      fixture.detectChanges();

      const hostElement = debugElement.nativeElement as HTMLElement;
      expect(hostElement.classList.contains('bg-primary')).toBe(true);
    });

    it('should apply text-primary-content class when active', () => {
      fixture.componentRef.setInput('optionId', 'option-1');
      fixture.componentRef.setInput('value', 'test-value');
      fixture.detectChanges();

      component.setActiveStyles();
      fixture.detectChanges();

      const hostElement = debugElement.nativeElement as HTMLElement;
      expect(hostElement.classList.contains('text-primary-content')).toBe(true);
    });

    it('should call scrollIntoView with correct options', () => {
      fixture.componentRef.setInput('optionId', 'option-1');
      fixture.componentRef.setInput('value', 'test-value');
      fixture.detectChanges();

      scrollIntoViewMock.mockClear();

      component.setActiveStyles();

      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        block: 'nearest',
        behavior: 'smooth',
      });
    });
  });

  describe('Highlightable interface - setInactiveStyles', () => {
    it('should set isActive to false', () => {
      fixture.componentRef.setInput('optionId', 'option-1');
      fixture.componentRef.setInput('value', 'test-value');
      fixture.detectChanges();

      component.setActiveStyles();
      expect(component.isActive).toBe(true);

      component.setInactiveStyles();

      expect(component.isActive).toBe(false);
    });

    it('should remove bg-primary class when inactive', () => {
      fixture.componentRef.setInput('optionId', 'option-1');
      fixture.componentRef.setInput('value', 'test-value');
      fixture.detectChanges();

      component.setActiveStyles();
      fixture.detectChanges();

      component.setInactiveStyles();
      fixture.detectChanges();

      const hostElement = debugElement.nativeElement as HTMLElement;
      expect(hostElement.classList.contains('bg-primary')).toBe(false);
    });
  });

  describe('Highlightable interface - getHostElement', () => {
    it('should return the native element', () => {
      fixture.componentRef.setInput('optionId', 'option-1');
      fixture.componentRef.setInput('value', 'test-value');
      fixture.detectChanges();

      const hostElement = component.getHostElement();

      expect(hostElement).toBe(fixture.nativeElement);
    });
  });

  describe('selected output - click event', () => {
    it('should emit selected event on click', () => {
      fixture.componentRef.setInput('optionId', 'option-1');
      fixture.componentRef.setInput('value', 'test-value');
      fixture.detectChanges();

      let emittedValue: string | undefined;
      component.selected.subscribe((value) => {
        emittedValue = value;
      });

      const hostElement = debugElement.nativeElement as HTMLElement;
      hostElement.click();

      expect(emittedValue).toBe('test-value');
    });

    it('should emit correct value on handleClick', () => {
      fixture.componentRef.setInput('optionId', 'option-1');
      fixture.componentRef.setInput('value', 'my-value');
      fixture.detectChanges();

      let emittedValue: string | undefined;
      component.selected.subscribe((value) => {
        emittedValue = value;
      });

      component.handleClick();

      expect(emittedValue).toBe('my-value');
    });
  });

  describe('hovered output - mouseenter event', () => {
    it('should emit hovered event on mouseenter', () => {
      fixture.componentRef.setInput('optionId', 'option-1');
      fixture.componentRef.setInput('value', 'test-value');
      fixture.detectChanges();

      let hovered = false;
      component.hovered.subscribe(() => {
        hovered = true;
      });

      const hostElement = debugElement.nativeElement as HTMLElement;
      hostElement.dispatchEvent(new Event('mouseenter'));

      expect(hovered).toBe(true);
    });
  });

  describe('Generic type parameter', () => {
    it('should work with string values', () => {
      const stringFixture = TestBed.createComponent(OptionComponent<string>);
      const stringComponent = stringFixture.componentInstance;
      stringFixture.componentRef.setInput('optionId', 'option-1');
      stringFixture.componentRef.setInput('value', 'string-value');
      stringFixture.detectChanges();

      let emittedValue: string | undefined;
      stringComponent.selected.subscribe((value) => {
        emittedValue = value;
      });

      stringComponent.handleClick();

      expect(emittedValue).toBe('string-value');
    });

    it('should work with number values', () => {
      const numberFixture = TestBed.createComponent(OptionComponent<number>);
      const numberComponent = numberFixture.componentInstance;
      numberFixture.componentRef.setInput('optionId', 'option-1');
      numberFixture.componentRef.setInput('value', 42);
      numberFixture.detectChanges();

      let emittedValue: number | undefined;
      numberComponent.selected.subscribe((value) => {
        emittedValue = value;
      });

      numberComponent.handleClick();

      expect(emittedValue).toBe(42);
    });

    it('should work with object values', () => {
      interface TestObject {
        id: string;
        name: string;
      }

      const objectFixture = TestBed.createComponent(
        OptionComponent<TestObject>
      );
      const objectComponent = objectFixture.componentInstance;
      const testObject: TestObject = { id: '1', name: 'Test' };
      objectFixture.componentRef.setInput('optionId', 'option-1');
      objectFixture.componentRef.setInput('value', testObject);
      objectFixture.detectChanges();

      let emittedValue: TestObject | undefined;
      objectComponent.selected.subscribe((value) => {
        emittedValue = value;
      });

      objectComponent.handleClick();

      expect(emittedValue).toBe(testObject);
      expect(emittedValue?.id).toBe('1');
      expect(emittedValue?.name).toBe('Test');
    });
  });

  describe('ARIA attributes', () => {
    it('should have role="option"', () => {
      fixture.componentRef.setInput('optionId', 'option-1');
      fixture.componentRef.setInput('value', 'test-value');
      fixture.detectChanges();

      const hostElement = debugElement.nativeElement as HTMLElement;
      expect(hostElement.getAttribute('role')).toBe('option');
    });

    it('should set aria-selected to false when inactive', () => {
      fixture.componentRef.setInput('optionId', 'option-1');
      fixture.componentRef.setInput('value', 'test-value');
      fixture.detectChanges();

      const hostElement = debugElement.nativeElement as HTMLElement;
      expect(hostElement.getAttribute('aria-selected')).toBe('false');
    });

    it('should set aria-selected to true when active', () => {
      fixture.componentRef.setInput('optionId', 'option-1');
      fixture.componentRef.setInput('value', 'test-value');
      fixture.detectChanges();

      component.setActiveStyles();
      fixture.detectChanges();

      const hostElement = debugElement.nativeElement as HTMLElement;
      expect(hostElement.getAttribute('aria-selected')).toBe('true');
    });
  });

  describe('Content projection', () => {
    it('should render projected content', () => {
      const customFixture = TestBed.createComponent(OptionComponent<string>);
      customFixture.componentRef.setInput('optionId', 'option-1');
      customFixture.componentRef.setInput('value', 'test-value');

      // Set custom content directly on host element (since no wrapper div)
      const hostElement = customFixture.nativeElement as HTMLElement;
      hostElement.innerHTML =
        '<span class="test-content">Custom Content</span>';
      customFixture.detectChanges();

      const contentElement = hostElement.querySelector('.test-content');
      expect(contentElement).toBeTruthy();
      expect(contentElement?.textContent).toBe('Custom Content');
    });
  });

  describe('Integration with ActiveDescendantKeyManager', () => {
    it('should update visual state during keyboard navigation', () => {
      fixture.componentRef.setInput('optionId', 'option-1');
      fixture.componentRef.setInput('value', 'test-value');
      fixture.detectChanges();

      // Simulate keyboard navigation activating option
      component.setActiveStyles();
      fixture.detectChanges();

      const hostElement = debugElement.nativeElement as HTMLElement;
      expect(hostElement.classList.contains('bg-primary')).toBe(true);
      expect(hostElement.getAttribute('aria-selected')).toBe('true');
      expect(component.isActive).toBe(true);

      // Simulate keyboard navigation moving to another option
      component.setInactiveStyles();
      fixture.detectChanges();

      expect(hostElement.classList.contains('bg-primary')).toBe(false);
      expect(hostElement.getAttribute('aria-selected')).toBe('false');
      expect(component.isActive).toBe(false);
    });
  });
});
