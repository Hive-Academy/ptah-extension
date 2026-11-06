import { TestBed } from '@angular/core/testing';
import {
  QueuedFollowUpStore,
  type QueuedFollowUpEntry,
} from './queued-follow-up.store';

function entry(
  clientMessageId: string,
  patch: Partial<QueuedFollowUpEntry> = {},
): QueuedFollowUpEntry {
  return {
    clientMessageId,
    tabId: 'tab-1',
    sessionId: 'session-1',
    content: `text ${clientMessageId}`,
    isCommand: false,
    phase: 'queued',
    ...patch,
  };
}

describe('QueuedFollowUpStore', () => {
  let store: QueuedFollowUpStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(QueuedFollowUpStore);
  });

  it('keeps entries FIFO and scopes a view to its tab and session', () => {
    store.add(entry('a'));
    store.add(entry('b', { sessionId: 'other-session' }));
    store.add(entry('c', { tabId: 'tab-2' }));
    store.add(entry('d', { sessionId: null, phase: 'held' }));

    expect(store.forView('tab-1', 'session-1').map((e) => e.clientMessageId))
      .toEqual(['a', 'd']);
    expect(store.forTab('tab-1').map((e) => e.clientMessageId)).toEqual([
      'a',
      'b',
      'd',
    ]);
    expect(store.tabsWithHeldEntries()).toEqual(['tab-1']);
  });

  it('settles once: removes the entry and tells each listener', () => {
    const outcomes: string[] = [];
    store.add(entry('a'));
    store.onSettled('a', (outcome) => outcomes.push(outcome));

    expect(store.settle('a', 'delivered')?.clientMessageId).toBe('a');
    expect(store.settle('a', 'failed')).toBeNull();
    expect(outcomes).toEqual(['delivered']);
    expect(store.isPending('a')).toBe(false);
  });

  it('reconcile adds unknown backend items ahead of renderer-held ones', () => {
    store.add(entry('known'));
    store.add(entry('held', { phase: 'held' }));

    store.reconcile('tab-1', 'session-1', [
      { clientMessageId: 'known', content: 'known' },
      { clientMessageId: 'missed', content: 'missed text' },
    ]);

    expect(store.forTab('tab-1').map((e) => e.clientMessageId)).toEqual([
      'known',
      'missed',
      'held',
    ]);
    expect(store.get('missed')?.phase).toBe('queued');
  });

  it('removeTab reports withdrawn for every entry of the tab', () => {
    const outcomes: string[] = [];
    store.add(entry('a'));
    store.add(entry('b', { tabId: 'tab-2' }));
    store.onSettled('a', (outcome) => outcomes.push(outcome));

    store.removeTab('tab-1');

    expect(outcomes).toEqual(['withdrawn']);
    expect(store.entries().map((e) => e.clientMessageId)).toEqual(['b']);
  });
});
