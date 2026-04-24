import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NativeOptionComponent } from './native-option.component';

describe('NativeOptionComponent', () => {
  let fixture: ComponentFixture<NativeOptionComponent<string>>;
  let component: NativeOptionComponent<string>;
  let hostElement: HTMLElement;
  let scrollIntoViewMock: jest.Mock;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NativeOptionComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(NativeOptionComponent<string>);
    component = fixture.componentInstance;
    hostElement = fixture.nativeElement as HTMLElement;

    scrollIntoViewMock = jest.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      writable: true,
      configurable: true,
      value: scrollIntoViewMock,
    });
  });

  const init = (
    overrides: {
      optionId?: string;
      value?: string;
      isActive?: boolean;
      disabled?: boolean;
    } = {},
  ) => {
    fixture.componentRef.setInput('optionId', overrides.optionId ?? 'opt-1');
    fixture.componentRef.setInput('value', overrides.value ?? 'val');
    if (overrides.isActive !== undefined) {
      fixture.componentRef.setInput('isActive', overrides.isActive);
    }
    if (overrides.disabled !== undefined) {
      fixture.componentRef.setInput('disabled', overrides.disabled);
    }
    fixture.detectChanges();
  };

  describe('Initialization', () => {
    it('should create', () => {
      init();
      expect(component).toBeTruthy();
    });

    it('should throw if optionId is empty string', () => {
      expect(() => init({ optionId: '', value: 'val' })).toThrow(
        /optionId must be a non-empty string/,
      );
    });

    it('should throw if optionId is only whitespace', () => {
      expect(() => init({ optionId: '   ', value: 'val' })).toThrow(
        /optionId must be a non-empty string/,
      );
    });

    it('should apply id attribute from optionId input', () => {
      init({ optionId: 'custom-id' });
      expect(hostElement.id).toBe('custom-id');
    });
  });

  describe('ARIA attributes', () => {
    it('should set role="option"', () => {
      init();
      expect(hostElement.getAttribute('role')).toBe('option');
    });

    it('should set aria-selected to false when not active', () => {
      init({ isActive: false });
      expect(hostElement.getAttribute('aria-selected')).toBe('false');
    });

    it('should set aria-selected to true when active', () => {
      init({ isActive: true });
      expect(hostElement.getAttribute('aria-selected')).toBe('true');
    });

    it('should set aria-disabled to true when disabled', () => {
      init({ disabled: true });
      expect(hostElement.getAttribute('aria-disabled')).toBe('true');
    });

    it('should have tabindex="-1"', () => {
      init();
      expect(hostElement.getAttribute('tabindex')).toBe('-1');
    });
  });

  describe('CSS classes - active state', () => {
    it('should apply bg-primary when active and enabled', () => {
      init({ isActive: true });
      expect(hostElement.classList.contains('bg-primary')).toBe(true);
      expect(hostElement.classList.contains('text-primary-content')).toBe(true);
    });

    it('should not apply bg-primary when inactive', () => {
      init({ isActive: false });
      expect(hostElement.classList.contains('bg-primary')).toBe(false);
    });

    it('should not apply active classes when active but disabled', () => {
      init({ isActive: true, disabled: true });
      expect(hostElement.classList.contains('bg-primary')).toBe(false);
    });
  });

  describe('CSS classes - disabled state', () => {
    it('should apply cursor-pointer when enabled', () => {
      init({ disabled: false });
      expect(hostElement.classList.contains('cursor-pointer')).toBe(true);
      expect(hostElement.classList.contains('cursor-not-allowed')).toBe(false);
    });

    it('should apply cursor-not-allowed and opacity-50 when disabled', () => {
      init({ disabled: true });
      expect(hostElement.classList.contains('cursor-not-allowed')).toBe(true);
      expect(hostElement.classList.contains('opacity-50')).toBe(true);
      expect(hostElement.classList.contains('cursor-pointer')).toBe(false);
    });
  });

  describe('Click handling - selected output', () => {
    it('should emit selected with value on click', () => {
      init({ value: 'hello' });
      const onSelected = jest.fn();
      component.selected.subscribe(onSelected);

      hostElement.click();

      expect(onSelected).toHaveBeenCalledWith('hello');
    });

    it('should emit on handleClick() directly', () => {
      init({ value: 'direct' });
      const onSelected = jest.fn();
      component.selected.subscribe(onSelected);

      component.handleClick();

      expect(onSelected).toHaveBeenCalledWith('direct');
    });

    it('should NOT emit when disabled', () => {
      init({ value: 'x', disabled: true });
      const onSelected = jest.fn();
      component.selected.subscribe(onSelected);

      hostElement.click();

      expect(onSelected).not.toHaveBeenCalled();
    });
  });

  describe('Mouse enter - hovered output', () => {
    it('should emit hovered on mouseenter', () => {
      init();
      const onHover = jest.fn();
      component.hovered.subscribe(onHover);

      hostElement.dispatchEvent(new Event('mouseenter'));

      expect(onHover).toHaveBeenCalledTimes(1);
    });

    it('should NOT emit hovered when disabled', () => {
      init({ disabled: true });
      const onHover = jest.fn();
      component.hovered.subscribe(onHover);

      hostElement.dispatchEvent(new Event('mouseenter'));

      expect(onHover).not.toHaveBeenCalled();
    });
  });

  describe('scrollIntoView()', () => {
    it('should call native scrollIntoView with smooth/nearest options', () => {
      init();
      scrollIntoViewMock.mockClear();

      component.scrollIntoView();

      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        block: 'nearest',
        behavior: 'smooth',
      });
    });
  });

  describe('getHostElement()', () => {
    it('should return the native host element', () => {
      init();
      expect(component.getHostElement()).toBe(hostElement);
    });
  });

  describe('Generic type parameter', () => {
    it('should emit typed object values on selection', () => {
      interface Item {
        id: number;
        label: string;
      }
      const objectFixture = TestBed.createComponent(
        NativeOptionComponent<Item>,
      );
      const objectComponent = objectFixture.componentInstance;
      const item: Item = { id: 1, label: 'first' };
      objectFixture.componentRef.setInput('optionId', 'o1');
      objectFixture.componentRef.setInput('value', item);
      objectFixture.detectChanges();

      let received: Item | undefined;
      objectComponent.selected.subscribe((v) => (received = v));

      objectComponent.handleClick();

      expect(received).toBe(item);
    });
  });
});
