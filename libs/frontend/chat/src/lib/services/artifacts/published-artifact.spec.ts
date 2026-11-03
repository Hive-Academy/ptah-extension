import {
  createExecutionNode,
  type ExecutionNode,
} from '@ptah-extension/shared';
import { publishedArtifactFromNode } from './published-artifact';

const result = {
  id: 'abcdefghijklmnop',
  title: 'Report',
  revision: 1,
  sessionId: 'registry-tab',
  viewerUrl: 'ptah-artifact://abcdefghijklmnop/index.html',
  createdAt: '2026-10-20T12:00:00.000Z',
  savedPath: 'C:/ptah/artifacts/report.html',
};

function node(partial: Partial<ExecutionNode> = {}): ExecutionNode {
  return createExecutionNode({
    id: 'tool-1',
    type: 'tool',
    status: 'complete',
    toolName: 'mcp__ptah__ptah_artifact_publish',
    toolOutput: JSON.stringify(result),
    ...partial,
  });
}

describe('publishedArtifactFromNode', () => {
  it('reads id, title and the raw result from a string tool output', () => {
    expect(publishedArtifactFromNode(node())).toEqual({
      id: result.id,
      title: 'Report',
      result,
    });
  });

  it('reads the first text part of an MCP content result, in either shape', () => {
    const content = [
      { type: 'image', data: 'x' },
      { type: 'text', text: JSON.stringify(result) },
    ];
    expect(
      publishedArtifactFromNode(node({ toolOutput: { content } }))?.result,
    ).toEqual(result);
    expect(publishedArtifactFromNode(node({ toolOutput: content }))?.id).toBe(
      result.id,
    );
  });

  it('accepts the unprefixed tool name and defaults a missing title', () => {
    const untitled: Record<string, unknown> = { ...result };
    delete untitled['title'];
    const parsed = publishedArtifactFromNode(
      node({
        toolName: 'ptah_artifact_publish',
        toolOutput: JSON.stringify(untitled),
      }),
    );
    expect(parsed?.title).toBe('Artifact');
  });

  it.each<[string, Partial<ExecutionNode>]>([
    ['another tool', { toolName: 'mcp__ptah__ptah_artifact_list' }],
    ['an error result', { isError: true }],
    ['a running call', { status: 'streaming' }],
    ['a non-JSON output', { toolOutput: 'Published.' }],
    ['a result without an id', { toolOutput: JSON.stringify({ title: 'x' }) }],
    [
      'an output without text',
      { toolOutput: { content: [{ type: 'image' }] } },
    ],
  ])('returns null for %s', (_label, partial) => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    expect(publishedArtifactFromNode(node(partial))).toBeNull();
    warn.mockRestore();
  });

  it('logs a malformed publish result once per tool node', () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const broken = node({ id: 'tool-malformed', toolOutput: 'Published.' });
    publishedArtifactFromNode(broken);
    publishedArtifactFromNode(broken);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('tool-malformed');
    publishedArtifactFromNode(
      node({ id: 'tool-no-id', toolOutput: JSON.stringify({ title: 'x' }) }),
    );
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
