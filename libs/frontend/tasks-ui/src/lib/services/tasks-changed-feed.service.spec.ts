import { TestBed } from '@angular/core/testing';
import { TASKS_CHANGED_MESSAGE_TYPE } from '../tasks-changed';
import { TasksChangedFeed } from './tasks-changed-feed.service';

describe('TasksChangedFeed', () => {
  let feed: TasksChangedFeed;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    feed = TestBed.inject(TasksChangedFeed);
  });

  it('publishes a valid push as a numbered change', () => {
    feed.handleMessage({
      type: TASKS_CHANGED_MESSAGE_TYPE,
      payload: { workspaceRoot: '/ws', reason: 'watcher' },
    });
    expect(feed.changes()).toEqual({
      seq: 1,
      change: { workspaceRoot: '/ws', reason: 'watcher' },
    });
  });

  it('relays every raw payload in order, including ones it drops as malformed', () => {
    const seen: unknown[] = [];
    feed.listenRaw((payload) => seen.push(payload));

    feed.handleMessage({ type: TASKS_CHANGED_MESSAGE_TYPE, payload: {} });
    feed.handleMessage({
      type: TASKS_CHANGED_MESSAGE_TYPE,
      payload: { workspaceRoot: '/a', reason: 'write' },
    });

    expect(seen).toEqual([{}, { workspaceRoot: '/a', reason: 'write' }]);
    expect(feed.changes()?.seq).toBe(1);
  });

  it('ignores other message types and stops relaying after unsubscribe', () => {
    const listener = jest.fn();
    const stop = feed.listenRaw(listener);

    feed.handleMessage({ type: 'something:else', payload: {} });
    stop();
    feed.handleMessage({ type: TASKS_CHANGED_MESSAGE_TYPE, payload: {} });

    expect(listener).not.toHaveBeenCalled();
  });
});
