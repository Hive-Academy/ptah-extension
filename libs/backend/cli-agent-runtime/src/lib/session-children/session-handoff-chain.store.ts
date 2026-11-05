/**
 * Workspace document `ptah.handoffChain` (TASK_2026_876).
 *
 * One in-memory document per normalized workspace path. Reads and writes
 * follow `SessionMetadataStore.readStorage`: async stores use `getAsync`,
 * and `update` waits for `whenReady` first. A workspace-scoped host writes
 * only `getStorageForWorkspace`; `undefined` stays in memory for that path.
 */
import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { UUID_REGEX } from '@ptah-extension/shared';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  hasStateStorageReadiness,
  isAsyncStateStorage,
  isWorkspaceScopedStateStorage,
  type IStateStorage,
} from '@ptah-extension/platform-core';
import type {
  ISessionHandoffChain,
  SessionHandoffLinkWritten,
} from './session-handoff-chain.port';

/** Must not use the `ptah.session:` detail prefix. */
export const HANDOFF_CHAIN_STORAGE_KEY = 'ptah.handoffChain';
export const HANDOFF_CHAIN_LINK_CAP = 256;

const HandoffChainLinkSchema = z
  .object({
    fromSessionId: z.string().regex(UUID_REGEX),
    toSessionId: z.string().regex(UUID_REGEX),
    at: z.number().finite(),
  })
  .strict();

const HandoffChainDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    links: z.array(HandoffChainLinkSchema).max(HANDOFF_CHAIN_LINK_CAP),
  })
  .strict();

type HandoffChainLink = z.infer<typeof HandoffChainLinkSchema>;

interface MemoryDocument {
  links: HandoffChainLink[];
  loaded: boolean;
  dirty: boolean;
  generation: number;
}

const SINGLE_STORE_KEY = '';

/** Same spelling as `normalizeWorkspaceId` in the session metadata store. */
function normalizeWorkspaceKey(workspacePath: string): string {
  const normalized = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function wouldCycle(
  from: string,
  to: string,
  links: readonly HandoffChainLink[],
): boolean {
  const seen = new Set<string>();
  const pending = [to];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id || seen.has(id)) continue;
    if (id === from) return true;
    seen.add(id);
    for (const link of links) {
      if (link.fromSessionId === id) pending.push(link.toSessionId);
    }
  }
  return false;
}

function orderComponent(
  sessionId: string,
  links: readonly HandoffChainLink[],
): string[] {
  const neighbors = new Map<string, Set<string>>();
  const touch = (id: string): Set<string> => {
    let next = neighbors.get(id);
    if (!next) {
      next = new Set();
      neighbors.set(id, next);
    }
    return next;
  };
  for (const link of links) {
    touch(link.fromSessionId).add(link.toSessionId);
    touch(link.toSessionId).add(link.fromSessionId);
  }
  if (!neighbors.has(sessionId)) return [];

  const component = new Set<string>();
  const stack = [sessionId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || component.has(id)) continue;
    component.add(id);
    for (const next of neighbors.get(id) ?? []) {
      if (!component.has(next)) stack.push(next);
    }
  }

  const directed = links.filter(
    (link) =>
      component.has(link.fromSessionId) && component.has(link.toSessionId),
  );
  const indegree = new Map<string, number>();
  for (const id of component) indegree.set(id, 0);
  const outgoing = new Map<string, HandoffChainLink[]>();
  for (const link of directed) {
    indegree.set(link.toSessionId, (indegree.get(link.toSessionId) ?? 0) + 1);
    const list = outgoing.get(link.fromSessionId) ?? [];
    list.push(link);
    outgoing.set(link.fromSessionId, list);
  }
  for (const list of outgoing.values()) {
    list.sort((a, b) => a.at - b.at);
  }

  const earliest = (id: string): number => {
    let min = Number.POSITIVE_INFINITY;
    for (const link of directed) {
      if (
        (link.fromSessionId === id || link.toSessionId === id) &&
        link.at < min
      ) {
        min = link.at;
      }
    }
    return min;
  };

  const ready = [...component].filter((id) => (indegree.get(id) ?? 0) === 0);
  ready.sort((a, b) => earliest(a) - earliest(b) || a.localeCompare(b));
  const ordered: string[] = [];
  const seen = new Set<string>();
  while (ready.length > 0) {
    const id = ready.shift();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
    for (const edge of outgoing.get(id) ?? []) {
      const next = (indegree.get(edge.toSessionId) ?? 0) - 1;
      indegree.set(edge.toSessionId, next);
      if (next === 0) ready.push(edge.toSessionId);
    }
  }
  if (ordered.length < component.size) {
    const rest = [...component].filter((id) => !seen.has(id));
    rest.sort((a, b) => earliest(a) - earliest(b) || a.localeCompare(b));
    ordered.push(...rest);
  }
  return ordered;
}

@injectable()
export class SessionHandoffChainStore implements ISessionHandoffChain {
  private readonly documents = new Map<string, MemoryDocument>();
  private readonly operations = new Map<string, Promise<void>>();
  private readonly listeners = new Set<
    (link: SessionHandoffLinkWritten) => void
  >();
  private capLogged = false;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, { isOptional: true })
    private readonly storage: IStateStorage | null = null,
  ) {}

  async append(
    fromSessionId: string,
    toSessionId: string,
    workspacePath?: string,
  ): Promise<void> {
    try {
      const key = normalizeWorkspaceKey(workspacePath?.trim() ?? '');
      const previous = this.operations.get(key) ?? Promise.resolve();
      const next = previous
        .catch(() => {
          // degradation-audit: reported - the earlier operation logged its own failure; this only keeps the per-workspace queue moving.
          return undefined;
        })
        .then(() =>
          this.appendInner(fromSessionId, toSessionId, workspacePath),
        );
      this.operations.set(key, next);
      try {
        await next;
      } finally {
        if (this.operations.get(key) === next) this.operations.delete(key);
      }
    } catch (error: unknown) {
      this.logger.error(
        '[SessionHandoffChain] append failed',
        asError(error),
      );
    }
  }

  async read(
    sessionId: string,
    workspacePath?: string,
  ): Promise<readonly string[]> {
    try {
      const scope = this.resolveScope(workspacePath);
      const previous = this.operations.get(scope.memoryKey) ?? Promise.resolve();
      const next = previous
        .catch(() => {
          // degradation-audit: reported - the earlier operation logged its own failure; this only keeps the per-workspace queue moving.
          return undefined;
        })
        .then(async () => {
        await this.ensureLoaded(scope);
        await this.retryPersist(scope);
        const links = this.documents.get(scope.memoryKey)?.links ?? [];
        return orderComponent(sessionId, links);
      });
      const settled = next.then(() => undefined);
      this.operations.set(scope.memoryKey, settled);
      try {
        return await next;
      } finally {
        if (this.operations.get(scope.memoryKey) === settled) {
          this.operations.delete(scope.memoryKey);
        }
      }
    } catch (error: unknown) {
      this.logger.error('[SessionHandoffChain] read failed', asError(error));
      return [];
    }
  }

  onLinkWritten(
    listener: (link: SessionHandoffLinkWritten) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async appendInner(
    fromSessionId: string,
    toSessionId: string,
    workspacePath: string | undefined,
  ): Promise<void> {
    if (
      !UUID_REGEX.test(fromSessionId) ||
      !UUID_REGEX.test(toSessionId) ||
      fromSessionId === toSessionId
    ) {
      this.logger.error(
        '[SessionHandoffChain] refused a handoff edge whose ids are not two distinct UUIDs',
        new Error('invalid handoff chain endpoint'),
      );
      return;
    }
    const scope = this.resolveScope(workspacePath);
    await this.ensureLoaded(scope);
    const doc = this.documents.get(scope.memoryKey);
    if (!doc) return;
    if (
      doc.links.some(
        (link) =>
          link.fromSessionId === fromSessionId &&
          link.toSessionId === toSessionId,
      )
    ) {
      return;
    }
    if (wouldCycle(fromSessionId, toSessionId, doc.links)) {
      this.logger.error(
        '[SessionHandoffChain] refused a cyclic handoff edge',
        new Error('cyclic handoff chain edge'),
      );
      return;
    }
    doc.links.push({
      fromSessionId,
      toSessionId,
      at: Date.now(),
    });
    while (doc.links.length > HANDOFF_CHAIN_LINK_CAP) {
      let oldest = 0;
      for (let index = 1; index < doc.links.length; index++) {
        const candidate = doc.links[index];
        const current = doc.links[oldest];
        if (candidate && current && candidate.at < current.at) oldest = index;
      }
      doc.links.splice(oldest, 1);
      if (!this.capLogged) {
        this.capLogged = true;
        this.logger.warn(
          '[SessionHandoffChain] dropped the oldest handoff link to stay within the cap',
          new Error('handoff chain link cap'),
        );
      }
    }
    doc.dirty = true;
    doc.generation += 1;
    await this.retryPersist(scope);
    this.notify({ fromSessionId, toSessionId });
  }

  private resolveScope(workspacePath: string | undefined): {
    memoryKey: string;
    storage: IStateStorage | null;
    missingWorkspaceStore: boolean;
  } {
    const path = workspacePath?.trim() ?? '';
    if (!path) {
      return {
        memoryKey: SINGLE_STORE_KEY,
        storage: this.storage,
        missingWorkspaceStore: false,
      };
    }
    const memoryKey = normalizeWorkspaceKey(path);
    if (this.storage && isWorkspaceScopedStateStorage(this.storage)) {
      const scoped = this.storage.getStorageForWorkspace(path);
      return {
        memoryKey,
        storage: scoped ?? null,
        missingWorkspaceStore: scoped === undefined,
      };
    }
    return {
      memoryKey,
      storage: this.storage,
      missingWorkspaceStore: false,
    };
  }

  private async ensureLoaded(scope: {
    memoryKey: string;
    storage: IStateStorage | null;
    missingWorkspaceStore: boolean;
  }): Promise<void> {
    const existing = this.documents.get(scope.memoryKey);
    if (existing?.loaded) return;
    const links = await this.loadLinks(scope);
    const current = this.documents.get(scope.memoryKey);
    if (current?.loaded) return;
    this.documents.set(scope.memoryKey, {
      links: current?.links ?? links,
      loaded: true,
      dirty: current?.dirty ?? false,
      generation: current?.generation ?? 0,
    });
  }

  private async loadLinks(scope: {
    memoryKey: string;
    storage: IStateStorage | null;
    missingWorkspaceStore: boolean;
  }): Promise<HandoffChainLink[]> {
    if (scope.missingWorkspaceStore) {
      this.logger.error(
        '[SessionHandoffChain] workspace has no scoped store; the edge stays in memory',
        new Error('handoff chain workspace store missing'),
      );
      return [];
    }
    if (!scope.storage) {
      this.logger.error(
        '[SessionHandoffChain] state storage is not registered; the edge stays in memory',
        new Error('handoff chain storage missing'),
      );
      return [];
    }
    let raw: unknown;
    try {
      raw = await this.readRaw(scope.storage);
    } catch (error: unknown) {
      this.logger.error(
        '[SessionHandoffChain] could not read the handoff chain document',
        asError(error),
      );
      return [];
    }
    if (raw === undefined || raw === null) return [];
    const parsed = HandoffChainDocumentSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.error(
        '[SessionHandoffChain] stored handoff chain document was rejected',
        parsed.error,
      );
      return [];
    }
    const accepted: HandoffChainLink[] = [];
    for (const link of parsed.data.links) {
      if (link.fromSessionId === link.toSessionId ||
          wouldCycle(link.fromSessionId, link.toSessionId, accepted)) {
        this.logger.error(
          '[SessionHandoffChain] dropped a cyclic stored handoff edge',
          new Error('cyclic stored handoff chain edge'),
        );
        continue;
      }
      accepted.push(link);
    }
    return accepted;
  }

  private async retryPersist(scope: {
    memoryKey: string;
    storage: IStateStorage | null;
    missingWorkspaceStore: boolean;
  }): Promise<void> {
    const doc = this.documents.get(scope.memoryKey);
    if (!doc?.dirty) return;
    if (scope.missingWorkspaceStore || !scope.storage) {
      this.logger.error(
        '[SessionHandoffChain] could not persist the handoff chain; it remains in memory for this workspace',
        new Error(
          scope.missingWorkspaceStore
            ? 'handoff chain workspace store missing'
            : 'handoff chain storage missing',
        ),
      );
      return;
    }
    try {
      const generation = doc.generation;
      const snapshot = doc.links.map((link) => ({ ...link }));
      await this.writeRaw(scope.storage, snapshot);
      if (doc.generation === generation) doc.dirty = false;
    } catch (error: unknown) {
      this.logger.error(
        '[SessionHandoffChain] could not persist the handoff chain; it remains in memory for this workspace',
        asError(error),
      );
    }
  }

  private async readRaw(storage: IStateStorage): Promise<unknown> {
    if (isAsyncStateStorage(storage)) {
      return storage.getAsync(HANDOFF_CHAIN_STORAGE_KEY);
    }
    return storage.get(HANDOFF_CHAIN_STORAGE_KEY);
  }

  private async writeRaw(
    storage: IStateStorage,
    links: readonly HandoffChainLink[],
  ): Promise<void> {
    if (hasStateStorageReadiness(storage)) {
      await storage.whenReady();
    }
    await storage.update(HANDOFF_CHAIN_STORAGE_KEY, {
      schemaVersion: 1 as const,
      links,
    });
  }

  private notify(link: SessionHandoffLinkWritten): void {
    for (const listener of this.listeners) {
      try {
        listener(link);
      } catch (error: unknown) {
        this.logger.error(
          '[SessionHandoffChain] link listener failed',
          asError(error),
        );
      }
    }
  }
}
