import {
  derivePhase,
  type PhaseDerivationInput,
} from '@ptah-extension/tribunal-panel/phase';
import type {
  CommandWorkEdge,
  CommandWorkNode,
  CommandWorkState,
} from './command-center.store';

export interface OwnedChild {
  readonly tabId: string;
  readonly sessionId?: string;
  readonly parentSessionId: string;
  readonly state: CommandWorkState;
  readonly name?: string;
  readonly providerId?: string;
  readonly updatedAt?: number;
}
export interface OwnedAgent {
  readonly agentId: string;
  readonly kind: 'cli' | 'sdk';
  readonly parentSessionId: string;
  readonly state: CommandWorkState;
  readonly providerId?: string;
  readonly runId?: string;
  readonly updatedAt?: number;
}
export interface OwnedRun {
  readonly runId: string;
  readonly rootSessionId: string;
  readonly phase: PhaseDerivationInput;
  readonly state: CommandWorkState;
  readonly updatedAt?: number;
}
export interface ProjectionInput {
  readonly rootTabId: string;
  readonly rootSessionId: string;
  readonly rootProviderId?: string;
  readonly children: readonly OwnedChild[];
  readonly persistedChildren: readonly {
    readonly sessionId: string;
    readonly parentSessionId: string;
    readonly updatedAt?: number;
  }[];
  readonly agents: readonly OwnedAgent[];
  readonly runs: readonly OwnedRun[];
}
export interface ProjectionResult {
  readonly nodes: readonly CommandWorkNode[];
  readonly edges: readonly CommandWorkEdge[];
}

/** The only ownership source is the root's recursive session ancestry. */
export function projectOwnedWork(input: ProjectionInput): ProjectionResult {
  const rootId = `root:${input.rootSessionId}`;
  const nodes: CommandWorkNode[] = [
    {
      id: rootId,
      parentId: null,
      label: 'Ptah',
      providerId: input.rootProviderId ?? null,
      state: 'running',
    },
  ];
  const owned = new Set([input.rootSessionId, input.rootTabId]);
  const aliases = new Map(
    input.children.flatMap((child) =>
      child.sessionId ? [[child.tabId, child.sessionId] as const] : [],
    ),
  );
  const canonical = (id: string): string => aliases.get(id) ?? id;
  const childBySession = new Set<string>(
    input.children.flatMap((child) =>
      child.sessionId ? [canonical(child.sessionId)] : [],
    ),
  );
  const candidates = [
    ...input.children.map((child) => ({
      id: child.sessionId ?? child.tabId,
      parent: child.parentSessionId,
      state: child.state,
      name: child.name,
      providerId: child.providerId,
      updatedAt: child.updatedAt,
    })),
    ...input.persistedChildren
      .filter((child) => !childBySession.has(canonical(child.sessionId)))
      .map((child) => ({
        id: child.sessionId,
        parent: child.parentSessionId,
        state: 'unknown' as const,
        name: undefined,
        providerId: undefined,
        updatedAt: child.updatedAt,
      })),
  ];
  const childrenBySession = new Map<string, (typeof candidates)[number]>();
  for (const child of candidates) {
    const id = canonical(child.id);
    const existing = childrenBySession.get(id);
    if (
      !existing ||
      (existing.state === 'unknown' && child.state !== 'unknown')
    )
      childrenBySession.set(id, child);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const child of childrenBySession.values()) {
      const id = canonical(child.id);
      if (!owned.has(id) && owned.has(canonical(child.parent))) {
        owned.add(id);
        changed = true;
      }
    }
  }
  const nodeForSession = (id: string): string =>
    canonical(id) === input.rootSessionId || id === input.rootTabId
      ? rootId
      : `child:${canonical(id)}`;
  for (const child of childrenBySession.values()) {
    if (!owned.has(canonical(child.id))) continue;
    nodes.push({
      id: nodeForSession(child.id),
      parentId: nodeForSession(child.parent),
      label: child.name ?? 'Child session',
      providerId: child.providerId ?? null,
      state: child.state,
      updatedAt: child.updatedAt,
    });
  }
  const runs = new Map(
    input.runs
      .filter((run) => owned.has(run.rootSessionId))
      .map((run) => [run.runId, run]),
  );
  for (const run of runs.values()) {
    const runId = `tribunal:${run.runId}`;
    nodes.push({
      id: runId,
      parentId: nodeForSession(run.rootSessionId),
      label: `Tribunal ${run.phase.move}`,
      providerId: null,
      state: run.state,
      updatedAt: run.updatedAt,
    });
    for (const lane of run.phase.laneBindings.lanes) {
      const status = run.phase.laneBindings.bound.get(lane.laneId)?.status;
      const state: CommandWorkState =
        status === 'running'
          ? 'running'
          : status === 'completed'
            ? 'completed'
            : status === 'failed' || status === 'timeout'
              ? 'failed'
              : status === 'stopped'
                ? 'cancelled'
                : 'queued';
      nodes.push({
        id: `lane:${run.runId}:${lane.laneId}`,
        parentId: runId,
        label: lane.role
          ? `${lane.displayName} (${lane.role})`
          : lane.displayName,
        providerId: lane.cli,
        state,
      });
    }
    const phase = derivePhase(run.phase);
    if (phase.kind === 'relay') {
      for (const step of phase.phases)
        nodes.push({
          id: `phase:${run.runId}:${step.role}`,
          parentId: runId,
          label: step.role,
          providerId: null,
          state:
            step.status === 'pending'
              ? 'queued'
              : step.status === 'complete'
                ? 'completed'
                : 'failed',
        });
    } else if (phase.kind === 'crucible') {
      nodes.push({
        id: `phase:${run.runId}:round-${phase.currentRound}`,
        parentId: runId,
        label: `Round ${phase.currentRound}`,
        providerId: null,
        state: phase.termination === 'in-progress' ? 'running' : 'completed',
      });
    } else {
      nodes.push({
        id: `phase:${run.runId}:stage`,
        parentId: runId,
        label:
          phase.kind === 'none' ? 'No phase tracking' : 'Phase unavailable',
        providerId: null,
        state: run.state,
      });
    }
  }
  for (const agent of input.agents) {
    if (!owned.has(canonical(agent.parentSessionId))) continue;
    const run = agent.runId ? runs.get(agent.runId) : undefined;
    const lane = run?.phase.laneBindings.lanes.find(
      (candidate) => candidate.agentId === agent.agentId,
    );
    if (agent.kind === 'cli' && lane) continue;
    const id =
      agent.kind === 'cli'
        ? `cli:${agent.agentId}`
        : `sdk:${agent.parentSessionId}:${agent.agentId}`;
    nodes.push({
      id,
      parentId:
        run && lane
          ? `lane:${run.runId}:${lane.laneId}`
          : run
            ? `tribunal:${run.runId}`
            : nodeForSession(agent.parentSessionId),
      label: agent.kind === 'cli' ? 'CLI agent' : 'SDK agent',
      providerId: agent.providerId ?? null,
      state: agent.state,
      updatedAt: agent.updatedAt,
    });
  }
  const unique = [...new Map(nodes.map((node) => [node.id, node])).values()];
  return {
    nodes: unique,
    edges: unique.flatMap((node) =>
      node.parentId === null ? [] : [{ fromId: node.parentId, toId: node.id }],
    ),
  };
}

/** Ages for nodes whose source supplied a timestamp. */
export function computeAgesMs(
  nodes: readonly CommandWorkNode[],
  now: number,
): ReadonlyMap<string, number> {
  return new Map(
    nodes.flatMap((node) =>
      node.updatedAt === undefined
        ? []
        : [[node.id, now - node.updatedAt] as const],
    ),
  );
}
