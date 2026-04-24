import { TestBed } from '@angular/core/testing';
import { KeyboardNavigationService } from './keyboard-navigation.service';

describe('KeyboardNavigationService', () => {
  let service: KeyboardNavigationService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [KeyboardNavigationService],
    });
    service = TestBed.inject(KeyboardNavigationService);
  });

  const keyEvent = (key: string): KeyboardEvent =>
    new KeyboardEvent('keydown', { key });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initial state', () => {
    it('should start with activeIndex of -1', () => {
      expect(service.activeIndex()).toBe(-1);
    });
  });

  describe('configure()', () => {
    it('should initialize to first item when items are added and no active', () => {
      service.configure({ itemCount: 5 });
      expect(service.activeIndex()).toBe(0);
    });

    it('should reset to -1 when itemCount is 0', () => {
      service.configure({ itemCount: 5 });
      expect(service.activeIndex()).toBe(0);
      service.configure({ itemCount: 0 });
      expect(service.activeIndex()).toBe(-1);
    });

    it('should clamp active index when new itemCount is smaller', () => {
      service.configure({ itemCount: 5 });
      service.setActiveIndex(4);
      expect(service.activeIndex()).toBe(4);
      service.configure({ itemCount: 2 });
      expect(service.activeIndex()).toBe(1);
    });

    it('should preserve active index when still valid', () => {
      service.configure({ itemCount: 5 });
      service.setActiveIndex(2);
      service.configure({ itemCount: 5 });
      expect(service.activeIndex()).toBe(2);
    });
  });

  describe('handleKeyDown() - vertical navigation', () => {
    beforeEach(() => {
      service.configure({ itemCount: 3, wrap: true });
    });

    it('should return false when itemCount is 0', () => {
      service.configure({ itemCount: 0 });
      expect(service.handleKeyDown(keyEvent('ArrowDown'))).toBe(false);
    });

    it('should move to next item on ArrowDown', () => {
      expect(service.activeIndex()).toBe(0);
      expect(service.handleKeyDown(keyEvent('ArrowDown'))).toBe(true);
      expect(service.activeIndex()).toBe(1);
    });

    it('should move to previous item on ArrowUp', () => {
      service.setActiveIndex(2);
      expect(service.handleKeyDown(keyEvent('ArrowUp'))).toBe(true);
      expect(service.activeIndex()).toBe(1);
    });

    it('should wrap from last to first on ArrowDown when wrap is true', () => {
      service.setActiveIndex(2);
      service.handleKeyDown(keyEvent('ArrowDown'));
      expect(service.activeIndex()).toBe(0);
    });

    it('should wrap from first to last on ArrowUp when wrap is true', () => {
      service.setActiveIndex(0);
      service.handleKeyDown(keyEvent('ArrowUp'));
      expect(service.activeIndex()).toBe(2);
    });

    it('should NOT wrap when wrap is false', () => {
      service.configure({ itemCount: 3, wrap: false });
      service.setActiveIndex(2);
      service.handleKeyDown(keyEvent('ArrowDown'));
      expect(service.activeIndex()).toBe(2);

      service.setActiveIndex(0);
      service.handleKeyDown(keyEvent('ArrowUp'));
      expect(service.activeIndex()).toBe(0);
    });

    it('should jump to first item on Home', () => {
      service.setActiveIndex(2);
      expect(service.handleKeyDown(keyEvent('Home'))).toBe(true);
      expect(service.activeIndex()).toBe(0);
    });

    it('should jump to last item on End', () => {
      service.setActiveIndex(0);
      expect(service.handleKeyDown(keyEvent('End'))).toBe(true);
      expect(service.activeIndex()).toBe(2);
    });

    it('should return false for unhandled keys', () => {
      expect(service.handleKeyDown(keyEvent('Enter'))).toBe(false);
      expect(service.handleKeyDown(keyEvent('Escape'))).toBe(false);
      expect(service.handleKeyDown(keyEvent('a'))).toBe(false);
    });

    it('should ignore ArrowLeft/ArrowRight in vertical mode', () => {
      expect(service.handleKeyDown(keyEvent('ArrowLeft'))).toBe(false);
      expect(service.handleKeyDown(keyEvent('ArrowRight'))).toBe(false);
    });
  });

  describe('handleKeyDown() - horizontal navigation', () => {
    beforeEach(() => {
      service.configure({ itemCount: 3, wrap: true, horizontal: true });
    });

    it('should move to next item on ArrowRight', () => {
      service.setActiveIndex(0);
      expect(service.handleKeyDown(keyEvent('ArrowRight'))).toBe(true);
      expect(service.activeIndex()).toBe(1);
    });

    it('should move to previous item on ArrowLeft', () => {
      service.setActiveIndex(2);
      expect(service.handleKeyDown(keyEvent('ArrowLeft'))).toBe(true);
      expect(service.activeIndex()).toBe(1);
    });

    it('should ignore ArrowUp/ArrowDown in horizontal mode', () => {
      expect(service.handleKeyDown(keyEvent('ArrowDown'))).toBe(false);
      expect(service.handleKeyDown(keyEvent('ArrowUp'))).toBe(false);
    });
  });

  describe('setNext() / setPrevious()', () => {
    beforeEach(() => {
      service.configure({ itemCount: 3 });
    });

    it('setNext() should advance and wrap by default', () => {
      service.setActiveIndex(2);
      service.setNext();
      expect(service.activeIndex()).toBe(0);
    });

    it('setNext(false) should stop at the end without wrapping', () => {
      service.setActiveIndex(2);
      service.setNext(false);
      expect(service.activeIndex()).toBe(2);
    });

    it('setPrevious() should move back and wrap by default', () => {
      service.setActiveIndex(0);
      service.setPrevious();
      expect(service.activeIndex()).toBe(2);
    });

    it('setPrevious(false) should stop at the start without wrapping', () => {
      service.setActiveIndex(0);
      service.setPrevious(false);
      expect(service.activeIndex()).toBe(0);
    });
  });

  describe('setActiveIndex()', () => {
    beforeEach(() => {
      service.configure({ itemCount: 3 });
    });

    it('should set a valid index', () => {
      service.setActiveIndex(2);
      expect(service.activeIndex()).toBe(2);
    });

    it('should ignore negative indices', () => {
      service.setActiveIndex(1);
      service.setActiveIndex(-1);
      expect(service.activeIndex()).toBe(1);
    });

    it('should ignore out-of-range indices', () => {
      service.setActiveIndex(1);
      service.setActiveIndex(10);
      expect(service.activeIndex()).toBe(1);
    });
  });

  describe('reset() / setFirstItemActive() / setLastItemActive()', () => {
    it('reset() should set first when items exist', () => {
      service.configure({ itemCount: 3 });
      service.setActiveIndex(2);
      service.reset();
      expect(service.activeIndex()).toBe(0);
    });

    it('reset() should set -1 when no items', () => {
      service.configure({ itemCount: 0 });
      service.reset();
      expect(service.activeIndex()).toBe(-1);
    });

    it('setFirstItemActive() should move to 0', () => {
      service.configure({ itemCount: 3 });
      service.setActiveIndex(2);
      service.setFirstItemActive();
      expect(service.activeIndex()).toBe(0);
    });

    it('setFirstItemActive() should be a no-op with no items', () => {
      service.configure({ itemCount: 0 });
      service.setFirstItemActive();
      expect(service.activeIndex()).toBe(-1);
    });

    it('setLastItemActive() should move to last index', () => {
      service.configure({ itemCount: 4 });
      service.setLastItemActive();
      expect(service.activeIndex()).toBe(3);
    });

    it('setLastItemActive() should be a no-op with no items', () => {
      service.configure({ itemCount: 0 });
      service.setLastItemActive();
      expect(service.activeIndex()).toBe(-1);
    });
  });
});
