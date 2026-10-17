import type { CommandWorkNode } from '../model/command-center.store';
import type { ProjectionResult } from '../model/work-projection';

export interface PlacedNode extends CommandWorkNode {
  readonly phases: readonly CommandWorkNode[];
}

export interface OverflowCounts {
  readonly completed: number;
  readonly other: number;
}

export interface StatusCounts {
  readonly inProgress: number;
  readonly waiting: number;
  readonly finished: number;
  readonly other: number;
}

export interface ScenePlacement {
  readonly placed: readonly PlacedNode[];
  readonly overflow: OverflowCounts;
  readonly activeCount: number;
  readonly counts: StatusCounts;
}

const EMPTY: ScenePlacement = {
  placed: [],
  overflow: { completed: 0, other: 0 },
  activeCount: 0,
  counts: { inProgress: 0, waiting: 0, finished: 0, other: 0 },
};

function priority(node: CommandWorkNode, selectedId: string | null): number {
  if (node.id === selectedId) return 0;
  if (node.state === 'failed' || node.state === 'awaiting input') return 1;
  if (node.state === 'completed') return 3;
  return 2;
}

/** Keep the original 23-node priority, ancestor, and projection-order contract. */
export function placeScene(
  projection: ProjectionResult,
  selectedId: string | null = null,
): ScenePlacement {
  const root = projection.nodes.find((node) => node.parentId === null && node.kind === 'root');
  if (!root) return EMPTY;

  const byId = new Map(projection.nodes.map((node) => [node.id, node]));
  const delegates = projection.nodes.filter(
    (node) => node.id !== root.id && node.kind !== 'phase',
  );
  const counts = { inProgress: 0, waiting: 0, finished: 0, other: 0 };
  for (const node of delegates) {
    if (node.state === 'starting' || node.state === 'running') counts.inProgress++;
    else if (node.state === 'awaiting input') counts.waiting++;
    else if (node.state === 'completed') counts.finished++;
    else counts.other++;
  }

  const visibleIds = new Set<string>();
  for (const { node } of delegates
    .map((node, index) => ({ node, index }))
    .sort((a, b) => priority(a.node, selectedId) - priority(b.node, selectedId) || a.index - b.index)) {
    const ancestors: string[] = [];
    const visited = new Set([node.id]);
    let parentId = node.parentId;
    let valid = true;
    while (parentId !== root.id) {
      if (!parentId || visited.has(parentId)) {
        valid = false;
        break;
      }
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent || parent.kind === 'phase') {
        valid = false;
        break;
      }
      ancestors.push(parent.id);
      parentId = parent.parentId;
    }
    if (!valid) continue;
    const needed = [node.id, ...ancestors].filter((id) => !visibleIds.has(id));
    if (visibleIds.size + needed.length > 23) continue;
    for (const id of needed) visibleIds.add(id);
  }

  const phasesByParent = new Map<string, CommandWorkNode[]>();
  for (const node of projection.nodes) {
    if (node.kind !== 'phase' || !node.parentId) continue;
    const phases = phasesByParent.get(node.parentId) ?? [];
    phases.push(node);
    phasesByParent.set(node.parentId, phases);
  }
  const placed = delegates
    .filter((node) => visibleIds.has(node.id))
    .map((node): PlacedNode => ({ ...node, phases: phasesByParent.get(node.id) ?? [] }));
  const excluded = delegates.filter((node) => !visibleIds.has(node.id));
  const completed = excluded.filter((node) => node.state === 'completed').length;
  return {
    placed,
    overflow: { completed, other: excluded.length - completed },
    activeCount: counts.inProgress,
    counts,
  };
}
