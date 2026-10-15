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
}
export interface OwnedAgent {
  readonly agentId: string;
  readonly kind: 'cli' | 'sdk';
  readonly parentSessionId: string;
  readonly state: CommandWorkState;
  readonly providerId?: string;
  readonly runId?: string;
}
export interface OwnedRun {
  readonly runId: string;
  readonly rootSessionId: string;
  readonly phase: PhaseDerivationInput;
  readonly state: CommandWorkState;
}
export interface ProjectionInput {
  readonly rootTabId: string;
  readonly rootSessionId: string;
  readonly children: readonly OwnedChild[];
  readonly persistedChildren: readonly {
    readonly sessionId: string;
    readonly parentSessionId: string;
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
      providerId: null,
      state: 'running',
    },
  ];
  const owned = new Set([input.rootSessionId, input.rootTabId]);
  const aliases = new Map(
    input.children
      .filter((child) => child.sessionId)
      .map((child) => [child.tabId, child.sessionId as string]),
  );
  const canonical = (id: string): string => aliases.get(id) ?? id;
  const childBySession = new Map(
    input.children
      .filter((child) => child.sessionId)
      .map((child) => [child.sessionId, child]),
  );
  const candidates = [
    ...input.children.map((child) => ({
      id: child.sessionId ?? child.tabId,
      parent: child.parentSessionId,
      state: child.state,
    })),
    ...input.persistedChildren
      .filter((child) => !childBySession.has(child.sessionId))
      .map((child) => ({
        id: child.sessionId,
        parent: child.parentSessionId,
        state: 'completed' as const,
      })),
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const child of candidates) {
      if (!owned.has(child.id) && owned.has(canonical(child.parent))) {
        owned.add(child.id);
        changed = true;
      }
    }
  }
  const nodeForSession = (id: string): string =>
    canonical(id) === input.rootSessionId || id === input.rootTabId
      ? rootId
      : `child:${canonical(id)}`;
  for (const child of candidates) {
    if (!owned.has(child.id)) continue;
    nodes.push({
      id: nodeForSession(child.id),
      parentId: nodeForSession(child.parent),
      label: 'Child session',
      providerId: null,
      state: child.state,
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
    });
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
    }
  }
  for (const agent of input.agents) {
    if (!owned.has(canonical(agent.parentSessionId))) continue;
    const run = agent.runId ? runs.get(agent.runId) : undefined;
    const id =
      agent.kind === 'cli'
        ? `cli:${agent.agentId}`
        : `sdk:${agent.parentSessionId}:${agent.agentId}`;
    nodes.push({
      id,
      parentId: run
        ? `tribunal:${run.runId}`
        : nodeForSession(agent.parentSessionId),
      label: agent.kind === 'cli' ? 'CLI agent' : 'SDK agent',
      providerId: agent.providerId ?? null,
      state: agent.state,
    });
  }
  const unique = [...new Map(nodes.map((node) => [node.id, node])).values()];
  return {
    nodes: unique,
    edges: unique
      .filter((node) => node.parentId !== null)
      .map((node) => ({ fromId: node.parentId as string, toId: node.id })),
  };
}
