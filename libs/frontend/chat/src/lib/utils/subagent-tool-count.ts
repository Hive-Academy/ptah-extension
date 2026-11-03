import type { ExecutionNode } from '@ptah-extension/shared';

function finiteOrZero(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0;
}

function countToolNodes(nodes: readonly ExecutionNode[]): number {
  return nodes.reduce(
    (total, node) =>
      total + (node.type === 'tool' ? 1 : 0) + countToolNodes(node.children),
    0,
  );
}

/** Larger of the host's latest report and the tools currently displayed. */
export function subagentToolCount(
  record: { toolUses?: number } | null | undefined,
  displayed: readonly ExecutionNode[],
): number {
  return Math.max(finiteOrZero(record?.toolUses), countToolNodes(displayed));
}
