/**
 * SessionMcpStatusRegistry — the backend's record of what the CLI said about
 * each session's MCP servers (TASK_2026_375 B4.3).
 *
 * A pure in-memory store keyed by session id. No I/O, no timers. Two writers,
 * both fed from `SessionMcpStatusCallbackRegistry` in `agent-sdk`:
 * `recordServers` from the SDK `init` message, and `recordNotice` from the one
 * CLI stderr line Ptah surfaces.
 *
 * ## Why a record at all, when the message is already pushed
 *
 * `session:mcpStatus` is pushed once per session, at start. A webview that
 * cold-loads afterwards — VS Code recreates the webview on panel hide→reshow,
 * and HMR reloads it outright — never saw that push and has nothing to render.
 * `session:status` reads this registry so a restored tab recovers the chip
 * instead of showing an empty one for the rest of the session.
 *
 * ## The two writers do not overwrite each other
 *
 * The notice and the server list arrive from different places, in an order
 * neither side controls: the stderr line is written while the CLI starts, the
 * `init` message after it connects. So `recordServers` REPLACES the server list
 * and leaves the notices alone, and `recordNotice` appends to the notices and
 * leaves the servers alone. Notices are folded by `code`, keeping the latest
 * message — the CLI repeats the same line on some paths, and one row per code
 * is what the popover renders.
 *
 * ## Alias
 *
 * A fresh session runs under its tabId until the SDK reports the real UUID.
 * `rekey` migrates the record, and is wired to
 * `SessionIdResolvedCallbackRegistry` in `chat/di.ts` — the same wiring
 * `SessionTurnStateRegistry` gets in `agent-sdk/di/register.ts`. When BOTH ids
 * hold a record the two are merged rather than one dropped: the stderr notice
 * can land under the tabId while the `init` message has already created the
 * real-id entry. The real id's servers win (they are the later, more specific
 * observation) and the notices are unioned by code.
 *
 * ## Bound
 *
 * `MCP_STATUS_MAP_LIMIT` (256), least-recently-written evicted. This is a
 * long-lived Electron process and a map that only ever grows is a leak whatever
 * its retention rule. Eviction is cheap here in a way it is not for
 * `SessionTurnStateRegistry`'s revision floor: losing this record costs a
 * `session:status` read its `mcpServers` field, which the chip renders as "no
 * MCP data" rather than as a wrong answer.
 */
import { injectable } from 'tsyringe';
import type {
  SessionMcpNotice,
  SessionMcpServerEntry,
} from '@ptah-extension/shared';

/**
 * Upper bound for the record map; the least-recently-written entry is evicted.
 * One entry is a session id plus a handful of short strings, so the cap costs
 * tens of kilobytes. It matches `REVISION_FLOOR_MAP_LIMIT` in `agent-sdk`
 * because both bound "one small thing per session in this process", not because
 * either derives from the other.
 */
export const MCP_STATUS_MAP_LIMIT = 256;

/** One session's MCP picture, as the backend last heard it. */
export interface SessionMcpStatusRecord {
  readonly servers: readonly SessionMcpServerEntry[];
  readonly notices: readonly SessionMcpNotice[];
  /** Epoch millis of the last write. */
  readonly updatedAt: number;
}

/** Merge two notice lists, keeping ONE entry per code, latest message wins. */
function mergeNotices(
  base: readonly SessionMcpNotice[],
  incoming: readonly SessionMcpNotice[],
): readonly SessionMcpNotice[] {
  if (incoming.length === 0) return base;
  const byCode = new Map<string, SessionMcpNotice>();
  for (const notice of base) byCode.set(notice.code, notice);
  for (const notice of incoming) byCode.set(notice.code, notice);
  return Array.from(byCode.values());
}

@injectable()
export class SessionMcpStatusRegistry {
  private readonly records = new Map<string, SessionMcpStatusRecord>();

  /**
   * Record the server list the SDK `init` message reported.
   *
   * REPLACES the list — a later init is a later truth — and leaves any notice
   * already recorded for the session alone.
   */
  recordServers(
    sessionId: string,
    servers: readonly SessionMcpServerEntry[],
  ): SessionMcpStatusRecord | null {
    if (!sessionId) return null;
    const existing = this.records.get(sessionId);
    return this.write(sessionId, {
      servers: [...servers],
      notices: existing?.notices ?? [],
      updatedAt: Date.now(),
    });
  }

  /**
   * Record one CLI notice. Folds by `code`, so the same line arriving twice
   * leaves one row.
   */
  recordNotice(
    sessionId: string,
    notice: SessionMcpNotice,
  ): SessionMcpStatusRecord | null {
    if (!sessionId) return null;
    const existing = this.records.get(sessionId);
    return this.write(sessionId, {
      servers: existing?.servers ?? [],
      notices: mergeNotices(existing?.notices ?? [], [notice]),
      updatedAt: Date.now(),
    });
  }

  /** Read one session's record, or `null` when nothing was ever recorded. */
  get(sessionId: string): SessionMcpStatusRecord | null {
    return this.records.get(sessionId) ?? null;
  }

  /** Session ids currently held. Primarily for tests and diagnostics. */
  get size(): number {
    return this.records.size;
  }

  /**
   * Migrate a record from the placeholder tabId onto the canonical SDK UUID.
   *
   * When both ids hold a record the two are MERGED rather than one dropped —
   * see the alias section of the file header. The placeholder entry is removed
   * either way, so a later read under the tabId correctly answers "nothing
   * recorded" instead of a stale half.
   */
  rekey(placeholderId: string, realId: string): void {
    if (!placeholderId || !realId || placeholderId === realId) return;
    const from = this.records.get(placeholderId);
    if (!from) return;
    this.records.delete(placeholderId);
    const to = this.records.get(realId);
    if (!to) {
      this.write(realId, from);
      return;
    }
    this.write(realId, {
      // The real id's list is the later, more specific observation. An empty
      // list there is still an observation ("this session has no MCP servers"),
      // so it wins over the placeholder's only when the real id actually
      // recorded servers — otherwise the placeholder's list is all we have.
      servers: to.servers.length > 0 ? to.servers : from.servers,
      notices: mergeNotices(from.notices, to.notices),
      updatedAt: Math.max(from.updatedAt, to.updatedAt),
    });
  }

  /** Forget one session's record. */
  clear(sessionId: string): void {
    this.records.delete(sessionId);
  }

  /**
   * Write and keep the map inside `MCP_STATUS_MAP_LIMIT`. The entry is
   * re-inserted (delete then set) so Map key order IS write recency, which
   * makes the eviction below drop the record nobody has written for longest
   * rather than the oldest session still in use. Re-inserting an existing key
   * shrinks the map first, so an update can never evict anything.
   */
  private write(
    sessionId: string,
    record: SessionMcpStatusRecord,
  ): SessionMcpStatusRecord {
    this.records.delete(sessionId);
    if (this.records.size >= MCP_STATUS_MAP_LIMIT) {
      const oldest = this.records.keys().next().value;
      if (oldest !== undefined) this.records.delete(oldest);
    }
    this.records.set(sessionId, record);
    return record;
  }
}
