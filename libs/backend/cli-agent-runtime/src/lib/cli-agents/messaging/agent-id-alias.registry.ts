import { z } from 'zod';
import { AgentId, type AgentId as AgentIdValue } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  isSendTimeRefusal,
  type AgentMessagePersistence,
} from './envelope/agent-message-envelope.store';
import { AGENT_MESSAGE_ENVELOPE_INDEX_KEY } from './envelope/agent-message-envelope.schema';

export const AGENT_ID_ALIAS_KEY = 'ptah:agent-id-aliases:v1';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_EDGES = 512;
const MAX_DEPTH = 8;

const AliasEdgeSchema = z.object({
  from: z.string().refine(AgentId.validate).transform(AgentId.from),
  to: z.string().refine(AgentId.validate).transform(AgentId.from),
  lastUsedAt: z.number().int().nonnegative(),
}).strict();
const AliasIndexSchema = z.object({
  version: z.literal(1),
  edges: z.array(z.unknown()).max(MAX_EDGES),
}).strict();
type AliasEdge = z.infer<typeof AliasEdgeSchema>;

/**
 * Only the fields the pin check reads. Deliberately non-strict: the index holds full
 * envelope records, and a strict schema would reject every one of them.
 */
const EnvelopeLineageSchema = z.object({
  laneLineageId: z.string(),
  state: z.string(),
  terminalAt: z.number().int().nonnegative().optional(),
  mode: z.string().optional(),
  bodyBytes: z.number().int().nonnegative().optional(),
  everDispatched: z.boolean().optional(),
});

/** Durable alias edges for resumed lane identities. */
export class AgentIdAliasRegistry {
  private readonly edges = new Map<AgentIdValue, AliasEdge>();
  readonly ready: Promise<void>;

  constructor(
    private readonly storage: AgentMessagePersistence,
    private readonly logger?: Logger,
    private readonly clock: () => number = Date.now,
  ) {
    this.ready = this.restore().catch((error: unknown) => {
      // Degradation: an unreadable alias index leaves old ids on the existing stopped-lane path.
      this.logger?.error('[AgentIdAliasRegistry] Restore failed', this.error(error));
      this.edges.clear();
    });
  }

  async record(fromId: AgentIdValue, toId: AgentIdValue): Promise<void> {
    await this.ready;
    if (fromId === toId) return;
    await this.prune();
    while (this.edges.size >= MAX_EDGES) {
      const oldest = [...this.edges.values()]
        .filter((edge) => !this.isPinned(edge.from))
        .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
      if (!oldest) throw new Error('Agent id alias capacity is pinned by retained envelopes.');
      this.edges.delete(oldest.from);
    }
    const previous = this.edges.get(fromId);
    this.edges.set(fromId, { from: fromId, to: toId, lastUsedAt: this.clock() });
    try {
      await this.persist();
    } catch (error: unknown) {
      if (previous) this.edges.set(fromId, previous);
      else this.edges.delete(fromId);
      throw error;
    }
  }

  async resolve(id: AgentIdValue): Promise<{
    requestedAgentId: AgentIdValue;
    agentId: AgentIdValue;
  }> {
    await this.ready;
    await this.prune();
    const walked = this.walk(id);
    await this.touch(walked.edges);
    return { requestedAgentId: id, agentId: walked.agentId };
  }

  async aliasesOf(agentId: AgentIdValue): Promise<readonly AgentIdValue[]> {
    await this.ready;
    await this.prune();
    return [...this.edges.keys()].filter((from) => this.walk(from).agentId === agentId);
  }

  async rootOf(id: AgentIdValue): Promise<AgentIdValue> {
    await this.ready;
    await this.prune();
    const walked = this.walk(id);
    await this.touch(walked.edges);
    return walked.root;
  }

  private async restore(): Promise<void> {
    const stored = this.storage.get<unknown>(AGENT_ID_ALIAS_KEY);
    if (stored === undefined) return;
    const index = AliasIndexSchema.parse(stored);
    let malformed = 0;
    for (const value of index.edges) {
      const parsed = AliasEdgeSchema.safeParse(value);
      if (!parsed.success) {
        malformed++;
        continue;
      }
      this.edges.set(parsed.data.from, parsed.data);
    }
    if (malformed > 0) {
      this.logger?.warn('[AgentIdAliasRegistry] Dropped malformed alias records', { malformed });
      await this.persist();
    }
  }

  /**
   * Walk the chain from its first id. `rootOf` must return that first id for every
   * member, so a retry addressed to a resumed id shares the original idempotency scope
   * (plan: `rootOf(B) = rootOf(A) = A` after recording `A -> B`).
   */
  private walk(id: AgentIdValue): {
    root: AgentIdValue;
    agentId: AgentIdValue;
    edges: AliasEdge[];
  } {
    const root = this.rootCandidate(id);
    let current = root;
    const visited = new Set<AgentIdValue>([root]);
    const used: AliasEdge[] = [];
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const edge = this.edges.get(current);
      if (!edge) break;
      used.push(edge);
      if (visited.has(edge.to)) break;
      visited.add(edge.to);
      current = edge.to;
    }
    return { root, agentId: current, edges: used };
  }

  /** Follow incoming edges to the first id of the chain, with a cycle and depth guard. */
  private rootCandidate(id: AgentIdValue): AgentIdValue {
    let current = id;
    const visited = new Set<AgentIdValue>([id]);
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const incoming = [...this.edges.values()].find((edge) => edge.to === current);
      if (!incoming || visited.has(incoming.from)) break;
      visited.add(incoming.from);
      current = incoming.from;
    }
    return current;
  }

  private async touch(edges: readonly AliasEdge[]): Promise<void> {
    if (edges.length === 0) return;
    const now = this.clock();
    for (const edge of edges)
      this.edges.set(edge.from, { ...edge, lastUsedAt: now });
    try {
      await this.persist();
    } catch (error: unknown) {
      // Degradation: a failed last-use write does not change the resolved lane identity.
      this.logger?.warn('[AgentIdAliasRegistry] Could not persist alias use', {
        error: this.error(error).name,
      });
    }
  }

  private async prune(): Promise<void> {
    const cutoff = this.clock() - TTL_MS;
    let changed = false;
    for (const edge of [...this.edges.values()]) {
      if (edge.lastUsedAt >= cutoff || this.isPinned(edge.from)) continue;
      this.edges.delete(edge.from);
      changed = true;
    }
    if (changed) await this.persist();
  }

  private isPinned(id: AgentIdValue): boolean {
    const root = this.walk(id).root;
    const stored = this.storage.get<unknown>(AGENT_MESSAGE_ENVELOPE_INDEX_KEY);
    const records = Array.isArray(stored)
      ? stored
      : z.object({ version: z.literal(1), records: z.array(z.unknown()) }).strict()
        .safeParse(stored).data?.records ?? [];
    const now = this.clock();
    return records.some((value) => {
      const parsed = EnvelopeLineageSchema.safeParse(value);
      if (!parsed.success || parsed.data.laneLineageId !== root) return false;
      if (isSendTimeRefusal(parsed.data)) return false;
      if (parsed.data.state !== 'settled') return parsed.data.state !== 'cancelled';
      return parsed.data.terminalAt !== undefined && now < parsed.data.terminalAt + TTL_MS;
    });
  }

  private async persist(): Promise<void> {
    await this.storage.update(AGENT_ID_ALIAS_KEY, {
      version: 1,
      edges: [...this.edges.values()],
    });
  }

  private error(error: unknown): Error {
    return error instanceof Error ? error : new Error('Alias registry operation failed');
  }
}
