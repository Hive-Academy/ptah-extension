import { computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { InspectorOpenStateService } from './inspector-open-state.service';

describe('InspectorOpenStateService', () => {
  let service: InspectorOpenStateService;
  let closedListeners: Set<(event: { tabId: string }) => void>;
  let unsubscribe: jest.Mock;

  function closeTab(tabId: string): void {
    for (const listener of closedListeners) listener({ tabId });
  }

  beforeEach(() => {
    closedListeners = new Set();
    unsubscribe = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: TabManagerService,
          useValue: {
            onTabClosed: jest.fn(
              (listener: (event: { tabId: string }) => void) => {
                closedListeners.add(listener);
                return () => {
                  unsubscribe();
                  closedListeners.delete(listener);
                };
              },
            ),
          },
        },
      ],
    });
    service = TestBed.inject(InspectorOpenStateService);
  });

  afterEach(() => TestBed.resetTestingModule());

  describe('default (no stored choice)', () => {
    it('is open in full mode and closed in compact mode', () => {
      expect(service.dockedOpen('tab-1', 'full', null)).toBe(true);
      expect(service.dockedOpen('tab-1', 'compact', null)).toBe(false);
    });

    it('a workflow tab (initialOpen true) defaults to open in any mode', () => {
      expect(service.dockedOpen('tab-1', 'full', true)).toBe(true);
      expect(service.dockedOpen('tab-1', 'compact', true)).toBe(true);
    });

    it('initialOpen false wins over the full-mode default', () => {
      expect(service.dockedOpen('tab-1', 'full', false)).toBe(false);
    });
  });

  describe('setDocked', () => {
    it('stores the choice per tab', () => {
      service.setDocked('tab-1', 'full', false);
      expect(service.dockedOpen('tab-1', 'full', null)).toBe(false);
      expect(service.dockedOpen('tab-2', 'full', null)).toBe(true);
    });

    it('a choice made in another view mode counts as absent', () => {
      service.setDocked('tab-1', 'full', false);
      expect(service.dockedOpen('tab-1', 'compact', null)).toBe(false);
      service.setDocked('tab-1', 'compact', true);
      expect(service.dockedOpen('tab-1', 'compact', null)).toBe(true);
      // The compact choice replaced the full one: full is back to its default.
      expect(service.dockedOpen('tab-1', 'full', null)).toBe(true);
    });

    it('overrides a workflow tab default', () => {
      service.setDocked('tab-1', 'full', false);
      expect(service.dockedOpen('tab-1', 'full', true)).toBe(false);
    });

    it('is reactive to a computed reader', () => {
      const open = computed(() => service.dockedOpen('tab-1', 'full', null));
      expect(open()).toBe(true);
      service.setDocked('tab-1', 'full', false);
      expect(open()).toBe(false);
    });
  });

  describe('closed tab', () => {
    it('is forgotten so a reused id gets the default again', () => {
      service.setDocked('tab-1', 'full', false);
      service.setDocked('tab-2', 'full', false);
      closeTab('tab-1');
      expect(service.dockedOpen('tab-1', 'full', null)).toBe(true);
      expect(service.dockedOpen('tab-2', 'full', null)).toBe(false);
    });

    it('forget of an unknown tab is a no-op', () => {
      service.setDocked('tab-1', 'full', false);
      service.forget('missing');
      expect(service.dockedOpen('tab-1', 'full', null)).toBe(false);
    });

    it('unsubscribes from tab-close events on destroy', () => {
      TestBed.resetTestingModule();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(closedListeners.size).toBe(0);
    });
  });
});
