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
  readonly displayName?: string;
  readonly task?: string;
  readonly startedAt?: number;
  readonly updatedAt?: number;
}
/** Keep scene plates legible; the full task remains available at its source. */
export const WORK_LABEL_MAX_LENGTH = 28;
const START_CLOCK_SKEW_MS = 30_000;
// Lanes stand in for their bound CLI agents, which get no node of their own.
const WORK_KINDS: ReadonlySet<CommandWorkNode['kind']> = new Set([
  'agent',
  'child',
]);
const ACTIVE_STATES: ReadonlySet<CommandWorkState> = new Set([
  'running',
  'starting',
]);

function agentLabel(agent: OwnedAgent): string {
  const provider = agent.providerId?.trim();
  const providerName = provider
    ? provider
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : agent.kind === 'cli'
      ? 'CLI'
      : 'SDK';
  const name =
    agent.displayName?.trim() || agent.task?.trim() || `${providerName} agent`;
  return name.length > WORK_LABEL_MAX_LENGTH
    ? `${name.slice(0, WORK_LABEL_MAX_LENGTH - 1).trimEnd()}…`
    : name;
}
export interface ProjectionInput {
  readonly now?: number;
  readonly rootTabId: string;
  readonly rootSessionId: string;
  readonly rootTabStatus?: string;
  readonly rootQuestionPending?: boolean;
  readonly rootProviderId?: string;
  readonly children: readonly OwnedChild[];
  readonly persistedChildren: readonly {
    readonly sessionId: string;
    readonly parentSessionId: string;
    readonly updatedAt?: number;
  }[];
  readonly agents: readonly OwnedAgent[];
}
export interface ProjectionResult {
  readonly nodes: readonly CommandWorkNode[];
  readonly edges: readonly CommandWorkEdge[];
}

export function rootWorkState(
  rootTabStatus?: string,
  rootQuestionPending = false,
): CommandWorkState {
  return rootQuestionPending
    ? 'awaiting input'
    : rootTabStatus === 'streaming'
      ? 'running'
      : 'idle';
}

/** The only ownership source is the root's recursive session ancestry. */
export function projectOwnedWork(input: ProjectionInput): ProjectionResult {
  const now = input.now ?? Date.now();
  const validStart = (startedAt: number | undefined): number | undefined =>
    startedAt !== undefined &&
    Number.isFinite(startedAt) &&
    startedAt > 0 &&
    startedAt <= now + START_CLOCK_SKEW_MS
      ? startedAt
      : undefined;
  const startField = (
    startedAt: number | undefined,
  ): { startedAt?: number } => {
    const valid = validStart(startedAt);
    return valid === undefined ? {} : { startedAt: valid };
  };
  const rootId = `root:${input.rootTabId}`;
  const nodes: CommandWorkNode[] = [
    {
      id: rootId,
      kind: 'root',
      parentId: null,
      label: 'Ptah',
      providerId: input.rootProviderId ?? null,
      state: rootWorkState(input.rootTabStatus, input.rootQuestionPending),
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
      tabId: child.tabId,
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
        tabId: undefined,
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
      kind: 'child',
      parentId: nodeForSession(child.parent),
      label: child.name ?? 'Child session',
      providerId: child.providerId ?? null,
      state: child.state,
      updatedAt: child.updatedAt,
      tabId: child.tabId,
    });
  }
  for (const agent of input.agents) {
    if (!owned.has(canonical(agent.parentSessionId))) continue;
    const id =
      agent.kind === 'cli'
        ? `cli:${agent.agentId}`
        : `sdk:${agent.parentSessionId}:${agent.agentId}`;
    nodes.push({
      id,
      kind: 'agent',
      agentKind: agent.kind,
      parentId: nodeForSession(agent.parentSessionId),
      label: agentLabel(agent),
      providerId: agent.providerId ?? null,
      state: agent.state,
      ...startField(agent.startedAt),
      updatedAt: agent.updatedAt,
      task: agent.task,
    });
  }
  const unique = [...new Map(nodes.map((node) => [node.id, node])).values()];
  // A finished root turn still orchestrates while its delegated work runs.
  if (
    unique[0].state === 'idle' &&
    unique.some(
      (node) => WORK_KINDS.has(node.kind) && ACTIVE_STATES.has(node.state),
    )
  )
    unique[0] = { ...unique[0], state: 'running' };
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
