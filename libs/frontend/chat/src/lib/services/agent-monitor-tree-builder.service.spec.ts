/**
 * AgentMonitorTreeBuilderService specs — pure tree-building service that
 * transforms flat streaming events / CLI output segments into ExecutionNode
 * trees for the agent monitor UI.
 *
 * Coverage focuses on the public API:
 *   - buildTree: empty input, simple message_start → text, tool flow
 *   - buildTreeFromSegments: text merging, thinking merging, tool-call +
 *     tool-result pairing, error/info segments, orphan results
 *   - buildTreeFromSegments normalizes `path` → `file_path` for read/write tools
 *   - finalizeOrphanedTools marks streaming tools as error and recurses
 *   - clearAgentCache / clearCache drop memoization entries
 *   - Memoization: same-length input returns the same reference
 */

import { TestBed } from '@angular/core/testing';
import { AgentMonitorTreeBuilderService } from './agent-monitor-tree-builder.service';
import { createExecutionNode } from '@ptah-extension/shared';
import type {
  CliOutputSegment,
  ExecutionNode,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';

// Minimal event factories — we only fill fields the builder reads.
function messageStart(
  id: string,
  messageId: string,
  timestamp = 1000,
  extras: Record<string, unknown> = {},
): FlatStreamEventUnion {
  return {
    id,
    eventType: 'message_start',
    messageId,
    role: 'assistant',
    timestamp,
    ...extras,
  } as unknown as FlatStreamEventUnion;
}

function textDelta(
  id: string,
  messageId: string,
  blockIndex: number,
  delta: string,
): FlatStreamEventUnion {
  return {
    id,
    eventType: 'text_delta',
    messageId,
    blockIndex,
    delta,
  } as unknown as FlatStreamEventUnion;
}

function toolStart(
  id: string,
  messageId: string,
  toolCallId: string,
  toolName: string,
  timestamp = 1100,
): FlatStreamEventUnion {
  return {
    id,
    eventType: 'tool_start',
    messageId,
    toolCallId,
    toolName,
    timestamp,
  } as unknown as FlatStreamEventUnion;
}

function toolResult(
  id: string,
  toolCallId: string,
  content: unknown,
): FlatStreamEventUnion {
  return {
    id,
    eventType: 'tool_result',
    toolCallId,
    content,
  } as unknown as FlatStreamEventUnion;
}

describe('AgentMonitorTreeBuilderService', () => {
  let service: AgentMonitorTreeBuilderService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AgentMonitorTreeBuilderService],
    });
    service = TestBed.inject(AgentMonitorTreeBuilderService);
  });

  afterEach(() => TestBed.resetTestingModule());

  describe('buildTree (events)', () => {
    it('returns [] for an empty event list', () => {
      expect(service.buildTree('agent-1', [])).toEqual([]);
    });

    it('returns [] when there are no message_start events', () => {
      const events = [textDelta('e1', 'msg-1', 0, 'stray')];
      expect(service.buildTree('agent-1', events)).toEqual([]);
    });

    it('builds a single text node from message_start + text_delta', () => {
      const events = [
        messageStart('e1', 'msg-1'),
        textDelta('e2', 'msg-1', 0, 'Hello '),
        textDelta('e3', 'msg-1', 0, 'world'),
      ];
      const tree = service.buildTree('agent-1', events);

      expect(tree).toHaveLength(1);
      expect(tree[0].type).toBe('text');
      expect(tree[0].status).toBe('complete');
      expect(tree[0].content).toBe('Hello world');
    });

    it('builds a tool node paired with its tool_result', () => {
      const events = [
        messageStart('e1', 'msg-1'),
        toolStart('e2', 'msg-1', 'tc-1', 'Bash'),
        toolResult('e3', 'tc-1', 'command output'),
      ];
      const tree = service.buildTree('agent-1', events);
      const toolNode = tree.find((n) => n.type === 'tool');

      expect(toolNode).toBeDefined();
      expect(toolNode?.toolName).toBe('Bash');
      expect(toolNode?.status).toBe('complete');
    });

    it('memoizes by event length — same length returns the same tree reference', () => {
      const events = [
        messageStart('e1', 'msg-1'),
        textDelta('e2', 'msg-1', 0, 'cached'),
      ];
      const first = service.buildTree('agent-1', events);
      const second = service.buildTree('agent-1', events);
      expect(second).toBe(first);
    });

    it('per-agent caches are isolated', () => {
      const events = [
        messageStart('e1', 'msg-1'),
        textDelta('e2', 'msg-1', 0, 'one'),
      ];
      const a = service.buildTree('agent-A', events);
      const b = service.buildTree('agent-B', events);
      // Different agents, different cache slots — content equal, references distinct.
      expect(b).not.toBe(a);
      expect(b[0].content).toBe(a[0].content);
    });
  });

  describe('buildTreeFromSegments', () => {
    it('returns [] for empty segments', () => {
      expect(service.buildTreeFromSegments('agent-1', [])).toEqual([]);
    });

    it('merges consecutive text segments into a single text node', () => {
      const segments: CliOutputSegment[] = [
        { type: 'text', content: 'hello ' } as CliOutputSegment,
        { type: 'text', content: 'world' } as CliOutputSegment,
      ];
      const tree = service.buildTreeFromSegments('agent-1', segments);
      expect(tree).toHaveLength(1);
      expect(tree[0].type).toBe('text');
      expect(tree[0].content).toBe('hello world');
    });

    it('merges consecutive thinking segments into a single thinking node', () => {
      const segments: CliOutputSegment[] = [
        { type: 'thinking', content: 'hmm ' } as CliOutputSegment,
        { type: 'thinking', content: 'ok' } as CliOutputSegment,
      ];
      const tree = service.buildTreeFromSegments('agent-1', segments);
      expect(tree).toHaveLength(1);
      expect(tree[0].type).toBe('thinking');
      expect(tree[0].content).toBe('hmm ok');
    });

    it('pairs a tool-call with a tool-result by toolCallId', () => {
      const segments: CliOutputSegment[] = [
        {
          type: 'tool-call',
          toolCallId: 'tc-1',
          toolName: 'Bash',
          toolArgs: 'ls -la',
        } as CliOutputSegment,
        {
          type: 'tool-result',
          toolCallId: 'tc-1',
          content: 'file1 file2',
        } as CliOutputSegment,
      ];
      const tree = service.buildTreeFromSegments('agent-1', segments);
      expect(tree).toHaveLength(1);
      expect(tree[0].type).toBe('tool');
      expect(tree[0].status).toBe('complete');
      expect(tree[0].toolName).toBe('Bash');
      expect(tree[0].toolOutput).toBe('file1 file2');
    });

    it('marks tool-result-error segments as error status', () => {
      const segments: CliOutputSegment[] = [
        {
          type: 'tool-call',
          toolCallId: 'tc-1',
          toolName: 'Bash',
        } as CliOutputSegment,
        {
          type: 'tool-result-error',
          toolCallId: 'tc-1',
          content: 'failed',
        } as CliOutputSegment,
      ];
      const tree = service.buildTreeFromSegments('agent-1', segments);
      expect(tree[0].status).toBe('error');
    });

    it('converts orphan tool-result segments into standalone text nodes', () => {
      const segments: CliOutputSegment[] = [
        {
          type: 'tool-result',
          toolCallId: 'unmatched',
          content: 'no tool',
        } as CliOutputSegment,
      ];
      const tree = service.buildTreeFromSegments('agent-1', segments);
      expect(tree).toHaveLength(1);
      expect(tree[0].type).toBe('text');
      expect(tree[0].content).toBe('no tool');
    });

    it('renders error segments as text with error field', () => {
      const segments: CliOutputSegment[] = [
        { type: 'error', content: 'boom' } as CliOutputSegment,
      ];
      const tree = service.buildTreeFromSegments('agent-1', segments);
      expect(tree).toHaveLength(1);
      expect(tree[0].error).toBe('boom');
      expect(tree[0].content).toBe('boom');
    });

    it('normalizes `path` → `file_path` for read/write tools', () => {
      const segments: CliOutputSegment[] = [
        {
          type: 'tool-call',
          toolCallId: 'tc-1',
          toolName: 'read_file',
          toolInput: { path: '/tmp/a.txt' },
        } as CliOutputSegment,
      ];
      const tree = service.buildTreeFromSegments('agent-1', segments);
      const input = tree[0].toolInput as Record<string, unknown>;
      expect(input['path']).toBe('/tmp/a.txt');
      expect(input['file_path']).toBe('/tmp/a.txt');
    });

    it('does NOT add file_path for non-read/write tools', () => {
      const segments: CliOutputSegment[] = [
        {
          type: 'tool-call',
          toolCallId: 'tc-1',
          toolName: 'bash',
          toolInput: { path: '/tmp/a.txt' },
        } as CliOutputSegment,
      ];
      const tree = service.buildTreeFromSegments('agent-1', segments);
      const input = tree[0].toolInput as Record<string, unknown>;
      expect(input['path']).toBe('/tmp/a.txt');
      expect(input['file_path']).toBeUndefined();
    });

    it('memoizes by segment length', () => {
      const segments: CliOutputSegment[] = [
        { type: 'text', content: 'cached' } as CliOutputSegment,
      ];
      const first = service.buildTreeFromSegments('agent-1', segments);
      const second = service.buildTreeFromSegments('agent-1', segments);
      expect(second).toBe(first);
    });
  });

  describe('finalizeOrphanedTools', () => {
    it('returns the same reference when no streaming tools exist', () => {
      const nodes: ExecutionNode[] = [
        createExecutionNode({
          id: 'n1',
          type: 'text',
          status: 'complete',
          content: 'plain',
        }),
      ];
      const result = service.finalizeOrphanedTools(nodes);
      expect(result).toBe(nodes);
    });

    it('marks streaming tools as error with a descriptive message', () => {
      const nodes: ExecutionNode[] = [
        createExecutionNode({
          id: 'n1',
          type: 'tool',
          status: 'streaming',
          toolName: 'Bash',
          content: null,
        }),
      ];
      const result = service.finalizeOrphanedTools(nodes);
      expect(result).not.toBe(nodes);
      expect(result[0].status).toBe('error');
      expect(result[0].error).toContain('interrupted');
    });

    it('recurses into nested children', () => {
      const child = createExecutionNode({
        id: 'child',
        type: 'tool',
        status: 'streaming',
        toolName: 'Read',
        content: null,
      });
      const parent = createExecutionNode({
        id: 'parent',
        type: 'text',
        status: 'complete',
        content: 'group',
        children: [child],
      });
      const result = service.finalizeOrphanedTools([parent]);
      const finalizedChild = result[0].children[0];
      expect(finalizedChild.status).toBe('error');
    });
  });

  describe('cache management', () => {
    it('clearAgentCache drops the per-agent memoization entry', () => {
      const events = [
        messageStart('e1', 'msg-1'),
        textDelta('e2', 'msg-1', 0, 'a'),
      ];
      const first = service.buildTree('agent-1', events);
      service.clearAgentCache('agent-1');
      const second = service.buildTree('agent-1', events);
      // Same content, but new tree reference (cache was cleared).
      expect(second).not.toBe(first);
    });

    it('clearCache drops every agent cache', () => {
      const events = [
        messageStart('e1', 'msg-1'),
        textDelta('e2', 'msg-1', 0, 'a'),
      ];
      const aFirst = service.buildTree('agent-A', events);
      const bFirst = service.buildTree('agent-B', events);
      service.clearCache();
      expect(service.buildTree('agent-A', events)).not.toBe(aFirst);
      expect(service.buildTree('agent-B', events)).not.toBe(bFirst);
    });
  });
});
