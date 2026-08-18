/**
 * TASK_2026_295 — leaks that survived scoped cleanup because `''` was accepted
 * as a session key.
 *
 * `''` is not a session, so anything filed under it can never be named by a
 * `cleanupSession(realUuid)` / `clearNodeMaps(realUuid)` call. Each spec below
 * pins one of those unreachable buckets.
 */

import { TestBed } from '@angular/core/testing';
import type { ExecutionNode } from '@ptah-extension/shared';
import type {
  BackgroundAgentStartedEvent,
  BackgroundAgentCompletedEvent,
} from '@ptah-extension/shared';
import { SessionManager } from './session-manager.service';
import { EventDeduplicationService } from './event-deduplication.service';
import { BackgroundAgentStore } from './background-agent.store';

const REAL_SESSION = 'session-real';
const OTHER_SESSION = 'session-other';

function node(id: string): ExecutionNode {
  return {
    id,
    type: 'agent',
    status: 'streaming',
    content: '',
    children: [],
    toolCallId: id,
  } as ExecutionNode;
}

describe('SessionManager — node maps registered before the session resolved', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SessionManager] });
    sessionManager = TestBed.inject(SessionManager);
  });

  it('does not file an unresolved node under the empty-string owner', () => {
    sessionManager.registerAgent('toolu_early', node('toolu_early'), '');
    sessionManager.registerAgent(
      'toolu_owned',
      node('toolu_owned'),
      REAL_SESSION,
    );

    // A scoped clear for a DIFFERENT session must not touch either node.
    sessionManager.clearNodeMaps(OTHER_SESSION);

    expect(sessionManager.getAgent('toolu_owned')).toBeDefined();
  });

  it('evicts the unresolved node when the next conversation clears its scope', () => {
    sessionManager.registerAgent('toolu_early', node('toolu_early'), '');
    sessionManager.registerTool('tool_early', node('tool_early'), '');

    sessionManager.clearNodeMaps(REAL_SESSION);

    // Filed under `''` these were unreachable by every scoped clear and leaked
    // into the next conversation's execution tree.
    expect(sessionManager.getAgent('toolu_early')).toBeUndefined();
    expect(sessionManager.getTool('tool_early')).toBeUndefined();
  });

  it('still leaves another session`s owned nodes alone', () => {
    sessionManager.registerAgent('toolu_bg', node('toolu_bg'), OTHER_SESSION);

    sessionManager.clearNodeMaps(REAL_SESSION);

    expect(sessionManager.getAgent('toolu_bg')).toBeDefined();
  });
});

describe('EventDeduplicationService — unresolved-session buckets', () => {
  let dedup: EventDeduplicationService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [EventDeduplicationService] });
    dedup = TestBed.inject(EventDeduplicationService);
  });

  it('never lets two pre-init sessions share one bucket', () => {
    // Session A records a message id while its session is still unresolved.
    dedup.getProcessedMessageIds('').add('msg-1');

    // Session B, also pre-init, must not see A's id — the shared `''` bucket
    // made B's `message_start` look like a duplicate and dropped it.
    expect(dedup.getProcessedMessageIds('').has('msg-1')).toBe(false);
  });

  it('never lets two pre-init sessions share one tool bucket', () => {
    dedup.getProcessedToolCallIds('').add('toolu-1');
    expect(dedup.getProcessedToolCallIds('').has('toolu-1')).toBe(false);
  });

  it('still deduplicates normally once the session is known', () => {
    dedup.getProcessedMessageIds(REAL_SESSION).add('msg-1');
    expect(dedup.getProcessedMessageIds(REAL_SESSION).has('msg-1')).toBe(true);

    dedup.cleanupSession(REAL_SESSION);
    expect(dedup.getProcessedMessageIds(REAL_SESSION).has('msg-1')).toBe(false);
  });
});

describe('BackgroundAgentStore — entries whose session never resolved', () => {
  let store: BackgroundAgentStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [BackgroundAgentStore] });
    store = TestBed.inject(BackgroundAgentStore);
  });

  function started(agentId: string, sessionId: string) {
    store.onStarted({
      agentId,
      toolCallId: `toolu_${agentId}`,
      agentType: 'general-purpose',
      sessionId,
      timestamp: Date.now(),
    } as BackgroundAgentStartedEvent);
  }

  it('does not store the empty string as an owner', () => {
    started('a1', '');
    expect(store.agents()[0].sessionId).toBeUndefined();
  });

  it('keeps an ownerless entry visible from every session', () => {
    started('a1', '');
    started('a2', OTHER_SESSION);

    // Filed as `''` these were invisible to every `agentsForSession` call, so
    // the tray could neither show nor steer them.
    expect(store.agentsForSession(REAL_SESSION).map((a) => a.agentId)).toEqual([
      'a1',
    ]);
  });

  it('clears an ownerless entry through the completed sweep', () => {
    started('a1', '');
    store.onCompleted({
      agentId: 'a1',
      toolCallId: 'toolu_a1',
      agentType: 'general-purpose',
      sessionId: '',
      timestamp: Date.now(),
      result: 'done',
    } as BackgroundAgentCompletedEvent);

    store.clearCompleted();

    expect(store.agents()).toHaveLength(0);
  });
});
