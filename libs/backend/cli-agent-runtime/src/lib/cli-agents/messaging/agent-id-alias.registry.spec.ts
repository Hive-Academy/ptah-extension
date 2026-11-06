import { AgentId } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { AGENT_ID_ALIAS_KEY, AgentIdAliasRegistry } from './agent-id-alias.registry';
import { AGENT_MESSAGE_ENVELOPE_INDEX_KEY } from './envelope/agent-message-envelope.schema';
import type { AgentMessagePersistence } from './envelope/agent-message-envelope.store';

const DAY = 24 * 60 * 60 * 1000;
const MAX_EDGES = 512;

class FakeStorage implements AgentMessagePersistence {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, value);
  }

  keys(): readonly string[] {
    return [...this.values.keys()];
  }

  seed(key: string, value: unknown): void {
    this.values.set(key, value);
  }

  has(key: string): boolean {
    return this.values.has(key);
  }
}

interface PersistedAliasIndex {
  readonly version: 1;
  readonly edges: readonly { readonly from: string; readonly to: string; readonly lastUsedAt: number }[];
}

function createLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as Partial<Logger> as Logger;
}

function envelopeIndex(records: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { version: 1, records };
}

describe('AgentIdAliasRegistry', () => {
  let storage: FakeStorage;
  let now: number;

  beforeEach(() => {
    storage = new FakeStorage();
    now = 1_000_000;
  });

  function registry(logger?: Logger): AgentIdAliasRegistry {
    return new AgentIdAliasRegistry(storage, logger, () => now);
  }

  it('resolves a resume chain to the live id and keeps the requested id', async () => {
    const [a, b, c] = [AgentId.create(), AgentId.create(), AgentId.create()];
    const aliases = registry();

    await aliases.record(a, b);
    await aliases.record(b, c);

    await expect(aliases.resolve(a)).resolves.toEqual({ requestedAgentId: a, agentId: c });
    await expect(aliases.resolve(b)).resolves.toEqual({ requestedAgentId: b, agentId: c });
    await expect(aliases.resolve(c)).resolves.toEqual({ requestedAgentId: c, agentId: c });
  });

  it('reports the first id of the chain as the root and lists the reverse aliases', async () => {
    const [a, b, c] = [AgentId.create(), AgentId.create(), AgentId.create()];
    const aliases = registry();

    await aliases.record(a, b);
    await aliases.record(b, c);

    await expect(aliases.rootOf(c)).resolves.toBe(a);
    await expect(aliases.rootOf(b)).resolves.toBe(a);
    await expect(aliases.rootOf(a)).resolves.toBe(a);
    await expect(aliases.aliasesOf(c)).resolves.toEqual(expect.arrayContaining([a, b]));
    await expect(aliases.aliasesOf(b)).resolves.toEqual([]);
  });

  it('bounds the chain walk to eight edges', async () => {
    const ids = Array.from({ length: 10 }, () => AgentId.create());
    const aliases = registry();

    for (let index = 0; index < ids.length - 1; index += 1)
      await aliases.record(ids[index], ids[index + 1]);

    await expect(aliases.resolve(ids[0])).resolves.toEqual({
      requestedAgentId: ids[0],
      agentId: ids[8],
    });
    await expect(aliases.rootOf(ids[9])).resolves.toBe(ids[1]);
  });

  it('guards a cycle without hanging', async () => {
    const [a, b] = [AgentId.create(), AgentId.create()];
    const aliases = registry();

    await aliases.record(a, b);
    await aliases.record(b, a);

    const resolved = await aliases.resolve(a);
    expect([a, b]).toContain(resolved.agentId);
    await expect(aliases.rootOf(b)).resolves.toBeDefined();
  });

  it('expires an alias seven days after its last use', async () => {
    const [a, b] = [AgentId.create(), AgentId.create()];
    const aliases = registry();

    await aliases.record(a, b);
    now += 7 * DAY + 1;

    await expect(aliases.resolve(a)).resolves.toEqual({ requestedAgentId: a, agentId: a });
    expect(storage.get<PersistedAliasIndex>(AGENT_ID_ALIAS_KEY)?.edges).toEqual([]);
  });

  it('refreshes the last use when a chain is resolved', async () => {
    const [a, b] = [AgentId.create(), AgentId.create()];
    const aliases = registry();

    await aliases.record(a, b);
    now += 6 * DAY;
    await expect(aliases.resolve(a)).resolves.toMatchObject({ agentId: b });
    now += 6 * DAY;

    await expect(aliases.resolve(a)).resolves.toMatchObject({ agentId: b });
  });

  it('bounds the alias index to 512 edges, evicting the oldest unpinned edge', async () => {
    const target = AgentId.create();
    const fromIds = Array.from({ length: MAX_EDGES + 1 }, () => AgentId.create());
    const aliases = registry();

    for (const from of fromIds) {
      await aliases.record(from, target);
      now += 1;
    }

    const persisted = storage.get<PersistedAliasIndex>(AGENT_ID_ALIAS_KEY);
    expect(persisted?.edges).toHaveLength(MAX_EDGES);
    expect(persisted?.edges.some((edge) => edge.from === fromIds[0])).toBe(false);
    expect(persisted?.edges.some((edge) => edge.from === fromIds[MAX_EDGES])).toBe(true);
    await expect(aliases.resolve(fromIds[0])).resolves.toMatchObject({ agentId: fromIds[0] });
    await expect(aliases.resolve(fromIds[MAX_EDGES])).resolves.toMatchObject({ agentId: target });
  });

  it('keeps a pinned alias past the TTL while an undelivered envelope carries its lineage', async () => {
    const [a, b] = [AgentId.create(), AgentId.create()];
    storage.seed(AGENT_MESSAGE_ENVELOPE_INDEX_KEY, envelopeIndex([
      { laneLineageId: a, state: 'failed' },
    ]));
    const aliases = registry();

    await aliases.record(a, b);
    now += 8 * DAY;
    await aliases.record(AgentId.create(), AgentId.create());

    await expect(aliases.resolve(a)).resolves.toMatchObject({ agentId: b });
  });

  it('never evicts a pinned alias to respect the cap', async () => {
    const pinnedFrom = AgentId.create();
    const pinnedTo = AgentId.create();
    const target = AgentId.create();
    storage.seed(AGENT_MESSAGE_ENVELOPE_INDEX_KEY, envelopeIndex([
      { laneLineageId: pinnedFrom, state: 'failed' },
    ]));
    const aliases = registry();

    await aliases.record(pinnedFrom, pinnedTo);
    for (let index = 0; index < MAX_EDGES; index += 1) {
      await aliases.record(AgentId.create(), target);
      now += 1;
    }

    await expect(aliases.resolve(pinnedFrom)).resolves.toMatchObject({ agentId: pinnedTo });
    const persisted = storage.get<PersistedAliasIndex>(AGENT_ID_ALIAS_KEY);
    expect(persisted?.edges).toHaveLength(MAX_EDGES);
    expect(persisted?.edges.some((edge) => edge.from === pinnedFrom)).toBe(true);
  });

  it('restores persisted edges', async () => {
    const [a, b] = [AgentId.create(), AgentId.create()];
    await registry().record(a, b);

    await expect(registry().resolve(a)).resolves.toMatchObject({ agentId: b });
  });

  it('drops malformed edges and logs the count', async () => {
    const [a, b] = [AgentId.create(), AgentId.create()];
    storage.seed(AGENT_ID_ALIAS_KEY, {
      version: 1,
      edges: [
        { from: a, to: b, lastUsedAt: now },
        { from: 'not-a-uuid', to: b, lastUsedAt: now },
      ],
    });
    const logger = createLogger();

    const aliases = registry(logger);

    expect(logger.warn).toHaveBeenCalledWith(
      '[AgentIdAliasRegistry] Dropped malformed alias records',
      { malformed: 1 },
    );
    await expect(aliases.resolve(a)).resolves.toMatchObject({ agentId: b });
  });

  it('starts empty when the alias index cannot be read', async () => {
    const [a] = [AgentId.create()];
    const logger = createLogger();
    const locked: AgentMessagePersistence = {
      get: () => { throw new Error('locked'); },
      update: async () => undefined,
    };

    const aliases = new AgentIdAliasRegistry(locked, logger, () => now);

    await expect(aliases.resolve(a)).resolves.toEqual({ requestedAgentId: a, agentId: a });
    expect(logger.error).toHaveBeenCalledWith(
      '[AgentIdAliasRegistry] Restore failed',
      expect.any(Error),
    );
  });

  it('ignores a self alias', async () => {
    const a = AgentId.create();
    const aliases = registry();

    await aliases.record(a, a);

    expect(storage.has(AGENT_ID_ALIAS_KEY)).toBe(false);
    await expect(aliases.resolve(a)).resolves.toMatchObject({ agentId: a });
  });
});
