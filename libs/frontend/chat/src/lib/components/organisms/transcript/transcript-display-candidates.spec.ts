import {
  createExecutionChatMessage,
  createExecutionNode,
  type ExecutionChatMessage,
  type ExecutionNode,
  type ExecutionNodeType,
} from '@ptah-extension/shared';
import { collectDisplayCandidates } from './transcript-display-candidates';

const BODY = 'stats\n  stat "Tests" 1\n';
const DISPLAY = '```ptah-ui display release\n' + BODY + '```\n';
const ANON_DISPLAY = 'Intro.\n\n```ptah-ui display\n' + BODY + '```\n';
const INLINE = '```ptah-ui\n' + BODY + '```\n';

function node(
  id: string,
  type: ExecutionNodeType,
  content: string | null = null,
  children: readonly ExecutionNode[] = [],
): ExecutionNode {
  return createExecutionNode({
    id,
    type,
    status: 'complete',
    content,
    children,
  });
}

function text(id: string, content: string | null): ExecutionNode {
  return node(id, 'text', content);
}

function root(
  id: string,
  children: readonly ExecutionNode[],
  startTime?: number,
): ExecutionNode {
  return createExecutionNode({
    id,
    type: 'message',
    status: 'complete',
    content: null,
    children,
    ...(startTime !== undefined ? { startTime } : {}),
  });
}

function user(
  id: string,
  timestamp: number,
  streamingState: ExecutionNode | null = null,
): ExecutionChatMessage {
  return createExecutionChatMessage({
    id,
    role: 'user',
    timestamp,
    streamingState,
  });
}

function assistant(
  id: string,
  timestamp: number,
  streamingState: ExecutionNode | null,
): ExecutionChatMessage {
  return createExecutionChatMessage({
    id,
    role: 'assistant',
    timestamp,
    streamingState,
  });
}

describe('collectDisplayCandidates', () => {
  describe('scope (R2.11)', () => {
    it('takes top-level assistant text reachable through message nodes only', () => {
      const tree = root('root', [
        text('t-top', DISPLAY),
        node('m-nested', 'message', null, [text('t-nested', ANON_DISPLAY)]),
        node('thinking', 'thinking', DISPLAY),
        node('tool', 'tool', null, [text('t-tool', DISPLAY)]),
        node('agent', 'agent', null, [
          text('t-agent', DISPLAY),
          node('m-agent', 'message', null, [text('t-agent-msg', DISPLAY)]),
        ]),
        node('system', 'system', DISPLAY),
      ]);
      const messages = [user('u1', 1), assistant('a1', 2, tree)];

      const result = collectDisplayCandidates(messages, messages.length);

      expect(result.map((c) => c.nodeId)).toEqual(['t-top', 't-nested']);
    });

    it('accepts a root that is itself a text node', () => {
      const messages = [
        user('u1', 1),
        assistant('a1', 2, text('t-root', DISPLAY)),
      ];

      const result = collectDisplayCandidates(messages, 2);

      expect(result.map((c) => c.blockKey)).toEqual(['a1:t-root']);
    });

    it('ignores user messages, even with a tree, and system messages', () => {
      const messages = [
        user('u1', 1, root('u-root', [text('u-text', DISPLAY)])),
        createExecutionChatMessage({
          id: 's1',
          role: 'system',
          timestamp: 2,
          streamingState: root('s-root', [text('s-text', DISPLAY)]),
        }),
      ];

      expect(collectDisplayCandidates(messages, 2)).toEqual([]);
    });

    it('skips text with inline fences only, null content and legacy null trees', () => {
      const messages = [
        user('u1', 1),
        assistant('a1', 2, root('r1', [text('t-inline', INLINE)])),
        assistant('a2', 3, root('r2', [text('t-null', null)])),
        assistant('a3', 4, null),
      ];

      expect(collectDisplayCandidates(messages, 4)).toEqual([]);
    });

    it('drops an assistant message before the first user message (no turn)', () => {
      const messages = [
        assistant('a0', 1, root('r0', [text('t0', DISPLAY)])),
        user('u1', 2),
        assistant('a1', 3, root('r1', [text('t1', DISPLAY)])),
      ];

      const result = collectDisplayCandidates(messages, 3);

      expect(result.map((c) => c.messageId)).toEqual(['a1']);
    });
  });

  describe('fields', () => {
    it('fills blockKey, messageId, nodeId, orderKey, text, turnKey and live', () => {
      const messages = [
        user('u1', 100),
        assistant('a1', 200, root('r1', [text('t1', DISPLAY)], 150)),
      ];

      const [candidate] = collectDisplayCandidates(messages, 2);

      expect(candidate).toEqual({
        blockKey: 'a1:t1',
        messageId: 'a1',
        nodeId: 't1',
        // transcriptOrderKey: the root's start time, not the message timestamp.
        orderKey: 150,
        text: DISPLAY,
        turnKey: 'u1',
        live: false,
      });
    });

    it('keeps ids that contain ":" intact (decision #71)', () => {
      const messages = [
        user('u:1', 1),
        assistant(
          'msg:a:1',
          2,
          root('r', [text('node:text:7', DISPLAY), text('n:2', DISPLAY)]),
        ),
      ];

      const result = collectDisplayCandidates(messages, 2);

      expect(
        result.map(({ blockKey, messageId, nodeId, turnKey }) => ({
          blockKey,
          messageId,
          nodeId,
          turnKey,
        })),
      ).toEqual([
        {
          blockKey: 'msg:a:1:node:text:7',
          messageId: 'msg:a:1',
          nodeId: 'node:text:7',
          turnKey: 'u:1',
        },
        {
          blockKey: 'msg:a:1:n:2',
          messageId: 'msg:a:1',
          nodeId: 'n:2',
          turnKey: 'u:1',
        },
      ]);
    });

    it('attributes each assistant message to the user message that opened its turn', () => {
      const messages = [
        user('u1', 1),
        assistant('a1', 2, root('r1', [text('t1', DISPLAY)])),
        assistant('a2', 3, root('r2', [text('t2', DISPLAY)])),
        user('u2', 4),
        assistant('a3', 5, root('r3', [text('t3', DISPLAY)])),
      ];

      const result = collectDisplayCandidates(messages, 5);

      expect(result.map((c) => [c.messageId, c.turnKey])).toEqual([
        ['a1', 'u1'],
        ['a2', 'u1'],
        ['a3', 'u2'],
      ]);
    });
  });

  describe('order (R2.8)', () => {
    it('follows message order, then text-node order', () => {
      const messages = [
        user('u1', 1),
        assistant(
          'a1',
          2,
          root('r1', [
            text('t-b', DISPLAY),
            node('m', 'message', null, [text('t-c', DISPLAY)]),
            text('t-a', DISPLAY),
          ]),
        ),
        assistant('a2', 3, root('r2', [text('t-z', DISPLAY)])),
      ];

      const result = collectDisplayCandidates(messages, 3);

      expect(result.map((c) => c.blockKey)).toEqual([
        'a1:t-b',
        'a1:t-c',
        'a1:t-a',
        'a2:t-z',
      ]);
      expect(result.map((c) => c.orderKey)).toEqual([2, 2, 2, 3]);
    });

    it('keeps only the first node of a repeated blockKey', () => {
      const messages = [
        user('u1', 1),
        assistant(
          'a1',
          2,
          root('r1', [text('t1', DISPLAY), text('t1', ANON_DISPLAY)]),
        ),
      ];

      const result = collectDisplayCandidates(messages, 2);

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe(DISPLAY);
    });
  });

  describe('live flag and streaming text (A4, R2.7)', () => {
    it('marks messages at or past the streaming boundary as live', () => {
      const messages = [
        user('u1', 1),
        assistant('a1', 2, root('r1', [text('t1', DISPLAY)])),
        user('u2', 3),
        assistant('a2', 4, root('r2', [text('t2', DISPLAY)])),
      ];

      const result = collectDisplayCandidates(messages, 3);

      expect(result.map((c) => [c.messageId, c.live])).toEqual([
        ['a1', false],
        ['a2', true],
      ]);
    });

    it('includes a streaming tree whose display fence is still open', () => {
      const streaming = createExecutionNode({
        id: 'r-live',
        type: 'message',
        status: 'streaming',
        content: null,
        children: [
          createExecutionNode({
            id: 't-live',
            type: 'text',
            status: 'streaming',
            content: 'Working.\n\n```ptah-ui display release\ntitle Rel',
            children: [],
          }),
        ],
      });
      const messages = [user('u1', 1), assistant('r-live', 2, streaming)];

      const [candidate] = collectDisplayCandidates(messages, 1);

      expect(candidate.live).toBe(true);
      expect(candidate.text).toBe(
        'Working.\n\n```ptah-ui display release\ntitle Rel',
      );
    });

    it('treats every message as settled when the boundary is the total count (replay)', () => {
      const messages = [
        user('u1', 1),
        assistant('a1', 2, root('r1', [text('t1', DISPLAY)])),
      ];

      const result = collectDisplayCandidates(messages, messages.length);

      expect(result[0].live).toBe(false);
    });
  });

  describe('identity cache', () => {
    const turn = (displayText: string): ExecutionChatMessage[] => [
      user('u1', 1),
      assistant('a1', 2, root('r1', [text('t1', DISPLAY)])),
      assistant('a2', 3, root('r2', [text('t2', displayText)])),
    ];

    it('returns the previous array when nothing changed', () => {
      const first = collectDisplayCandidates(turn(DISPLAY), 3);
      // A new tree and new messages with equal text (a re-built streaming tree).
      const second = collectDisplayCandidates(turn(`${DISPLAY}`), 3, first);

      expect(second).toBe(first);
    });

    it('reuses unchanged candidates and replaces the changed one', () => {
      const first = collectDisplayCandidates(turn(DISPLAY), 3);
      const second = collectDisplayCandidates(
        turn(`${DISPLAY}more text\n`),
        3,
        first,
      );

      expect(second).not.toBe(first);
      expect(second[0]).toBe(first[0]);
      expect(second[1]).not.toBe(first[1]);
      expect(second[1].text).toBe(`${DISPLAY}more text\n`);
    });

    it('replaces a candidate whose text has the same length but differs', () => {
      const first = collectDisplayCandidates(turn(DISPLAY), 3);
      const sameLength = DISPLAY.replace('release', 'releasf');
      const second = collectDisplayCandidates(turn(sameLength), 3, first);

      expect(second[1]).not.toBe(first[1]);
      expect(second[1].text).toBe(sameLength);
    });

    it('replaces a candidate when its live flag flips at finalization', () => {
      const first = collectDisplayCandidates(turn(DISPLAY), 2);
      expect(first[1].live).toBe(true);

      const second = collectDisplayCandidates(turn(DISPLAY), 3, first);

      expect(second[0]).toBe(first[0]);
      expect(second[1]).not.toBe(first[1]);
      expect(second[1].live).toBe(false);
    });

    it('does not reuse a previous candidate with the same blockKey but other ids', () => {
      const before = [
        user('u1', 1),
        assistant('a:b', 2, root('r', [text('c', DISPLAY)])),
      ];
      const after = [
        user('u1', 1),
        assistant('a', 2, root('r', [text('b:c', DISPLAY)])),
      ];
      const first = collectDisplayCandidates(before, 2);
      const second = collectDisplayCandidates(after, 2, first);

      expect(second[0].blockKey).toBe(first[0].blockKey);
      expect(second[0]).not.toBe(first[0]);
      expect(second[0]).toMatchObject({ messageId: 'a', nodeId: 'b:c' });
    });

    it('keeps no state between calls: each transcript passes its own previous', () => {
      const a = collectDisplayCandidates(turn(DISPLAY), 3);
      const b = collectDisplayCandidates(turn(DISPLAY), 3);

      expect(b).not.toBe(a);
      expect(b).toEqual(a);
    });
  });
});
