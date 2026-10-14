import type { ExecutionChatMessage, ExecutionNode, ToolResultEvent } from '@ptah-extension/shared';
import { patchHistoryToolResult } from './history-tool-result-patch';

function node(type: ExecutionNode['type'], id: string, children: ExecutionNode[] = []): ExecutionNode {
  return { id, type, status: 'streaming', content: null, children, isCollapsed: false, toolCallId: id };
}

function message(id: string, tree: ExecutionNode | null): ExecutionChatMessage {
  return { id, role: 'assistant', timestamp: 1, streamingState: tree };
}

const result = { id: 'r', eventType: 'tool_result', messageId: 'X', timestamp: 1,
  toolCallId: 'toolu_1', output: { value: 'real' }, isError: true,
  isPermissionRequest: true } as ToolResultEvent;

describe('patchHistoryToolResult', () => {
  it('patches a tool two levels down and its Task agent while preserving unrelated identities', () => {
    const nested = node('tool', 'toolu_1');
    const agent = node('agent', 'toolu_1', [node('message', 'inner', [nested])]);
    const root = node('message', 'root', [agent, node('text', 'other')]);
    const untouched = message('other', node('message', 'untouched'));
    const messages = [message('one', root), untouched];
    const patched = patchHistoryToolResult(messages, result);
    expect(patched).not.toBe(messages);
    expect(patched[1]).toBe(untouched);
    const newRoot = patched[0].streamingState as ExecutionNode;
    expect(newRoot).not.toBe(root);
    expect(newRoot.children[1]).toBe(root.children[1]);
    expect(newRoot.children[0]).toMatchObject({ status: 'complete', toolCallId: 'toolu_1' });
    expect(newRoot.children[0].children[0].children[0]).toMatchObject({
      status: 'complete', toolOutput: { value: 'real' }, isError: true,
      isPermissionRequest: true,
    });
    expect(nested.status).toBe('streaming');
  });

  it('returns the identical array when no node matches or the matching nodes already agree', () => {
    const messages = [message('one', node('tool', 'toolu_2')), message('empty', null)];
    expect(patchHistoryToolResult(messages, result)).toBe(messages);
    const once = patchHistoryToolResult([message('one', node('tool', 'toolu_1'))], result);
    expect(patchHistoryToolResult(once, result)).toBe(once);
  });

  it('updates output and clears an old permission flag when the real result changes', () => {
    const old = { ...node('tool', 'toolu_1'), status: 'complete' as const,
      toolOutput: 'synthetic', isError: false, isPermissionRequest: true };
    const patched = patchHistoryToolResult([message('one', old)], { ...result, isPermissionRequest: undefined });
    expect(patched[0].streamingState).toMatchObject({ toolOutput: { value: 'real' }, isError: true });
    expect(patched[0].streamingState?.isPermissionRequest).toBeUndefined();
  });
});
