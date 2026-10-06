import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  TabManagerService,
  type ClosedTabEvent,
} from '@ptah-extension/chat-state';
import { SessionRotationKeepService } from './session-rotation-keep.service';

type OpenTab = {
  claudeSessionId: string | null;
  sessionBudget?: { sessionId: string } | null;
};

describe('SessionRotationKeepService', () => {
  let service: SessionRotationKeepService;
  let tabs: WritableSignal<OpenTab[]>;
  let listeners: Set<(event: ClosedTabEvent) => void>;

  const close = (
    sessionId: string | null,
    kind: ClosedTabEvent['kind'] = 'close',
  ): void => {
    for (const listener of listeners) {
      listener({ tabId: 'tab', sessionId, kind });
    }
  };

  beforeEach(() => {
    tabs = signal<OpenTab[]>([]);
    listeners = new Set();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: TabManagerService,
          useValue: {
            tabs,
            onTabClosed: (listener: (event: ClosedTabEvent) => void) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          },
        },
      ],
    });
    service = TestBed.inject(SessionRotationKeepService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('keeps per session and threshold', () => {
    service.keep('s1', 200_000);

    expect(service.isKept('s1', 200_000)).toBe(true);
    expect(service.isKept('s1', 400_000)).toBe(false);
    expect(service.isKept('s2', 200_000)).toBe(false);
  });

  it('forgetSession drops only that session', () => {
    service.keep('s1', 200_000);
    service.keep('s1', 400_000);
    service.keep('s2', 200_000);

    service.forgetSession('s1');

    expect(service.isKept('s1', 200_000)).toBe(false);
    expect(service.isKept('s1', 400_000)).toBe(false);
    expect(service.isKept('s2', 200_000)).toBe(true);
  });

  it('forgetSession on an unknown session keeps the same set instance', () => {
    service.keep('s1', 1);
    const before = service.kept();

    service.forgetSession('nope');

    expect(service.kept()).toBe(before);
  });

  describe('pruning for closed sessions', () => {
    it('drops the keys of a session whose last tab closed', () => {
      service.keep('s1', 200_000);
      service.keep('s2', 200_000);
      tabs.set([{ claudeSessionId: 's2' }]);

      close('s1');

      expect(service.isKept('s1', 200_000)).toBe(false);
      expect(service.isKept('s2', 200_000)).toBe(true);
    });

    it('drops the keys of a session whose tab was reset in place', () => {
      service.keep('s1', 200_000);
      tabs.set([{ claudeSessionId: null }]);

      close('s1', 'reset');

      expect(service.kept().size).toBe(0);
    });

    it('keeps the keys while another open tab still holds the session', () => {
      service.keep('s1', 200_000);
      tabs.set([{ claudeSessionId: 's1' }]);
      close('s1');
      expect(service.isKept('s1', 200_000)).toBe(true);

      tabs.set([{ claudeSessionId: null, sessionBudget: { sessionId: 's1' } }]);
      close('s1');
      expect(service.isKept('s1', 200_000)).toBe(true);
    });

    it('ignores a closed tab that never had a session', () => {
      service.keep('s1', 1);
      const before = service.kept();

      close(null);

      expect(service.kept()).toBe(before);
    });

    it('stops listening when the injector is destroyed', () => {
      expect(listeners.size).toBe(1);

      TestBed.resetTestingModule();

      expect(listeners.size).toBe(0);
    });
  });
});
