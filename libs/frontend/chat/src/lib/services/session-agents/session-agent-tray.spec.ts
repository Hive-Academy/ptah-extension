/**
 * buildTrayContexts — scope handling for an unresolved session
 * (TASK_2026_295). Moved from the deleted background-agent tray component's
 * scope spec (TASK_2026_677 R2); same cases, now against the pure builder.
 *
 * The tray's filter was `if (scope && rec.parentSessionId !== scope) continue;`.
 * A tile whose session had not resolved passed `''`, which is falsy, so the
 * filter switched itself off and the tile listed EVERY session's agents.
 *
 * Wave 2 folded the second axis into `agentVisibleInSession` as well: a view
 * scoped to a session that has not resolved shows NOTHING. The tray used to be
 * the odd one out here — it showed unattributed agents in an unresolved tile
 * while `agent-monitor-panel` and `chat-view` showed none — purely because
 * `agentVisibleInSession(undefined, '')` happened to be true. No agent becomes
 * unreachable: every RESOLVED view still shows unattributed agents (see the
 * third case below), and the unscoped tray shows everything.
 */

import type { SubagentRecord } from '@ptah-extension/chat-streaming';
import { buildTrayContexts } from './session-agent-tray';

const TILE_SESSION = 'session-tile';
const OTHER_SESSION = 'session-other';

function record(
  parentToolUseId: string,
  parentSessionId: string | undefined,
): SubagentRecord {
  return {
    parentToolUseId,
    status: 'running',
    teammateName: parentToolUseId,
    parentSessionId,
  } as SubagentRecord;
}

describe('buildTrayContexts — unresolved session scope', () => {
  function entryIds(scope: string | null, records: SubagentRecord[]): string[] {
    const contexts = buildTrayContexts(
      new Map(records.map((r) => [r.parentToolUseId, r])),
      [],
      scope,
    );
    return Array.from(contexts.values(), (ctx) => ctx.entry.id);
  }

  it('renders nothing in a tile whose session is unresolved — least of all another session`s agents', () => {
    const ids = entryIds('', [
      record('mine', undefined),
      record('theirs', OTHER_SESSION),
    ]);
    // The original defect: `theirs` leaking into an unresolved tile.
    expect(ids).not.toContain('theirs');
    // And the reconciled rule: an unresolved scope claims nothing at all.
    expect(ids).toEqual([]);
  });

  it('lists every session`s agents on the main (unscoped) tray', () => {
    const ids = entryIds(null, [
      record('mine', TILE_SESSION),
      record('theirs', OTHER_SESSION),
    ]);

    expect(ids.sort()).toEqual(['mine', 'theirs']);
  });

  it('shows an unattributed agent inside a resolved tile', () => {
    const ids = entryIds(TILE_SESSION, [
      record('unattributed', undefined),
      record('mine', TILE_SESSION),
      record('theirs', OTHER_SESSION),
    ]);

    expect(ids.sort()).toEqual(['mine', 'unattributed']);
  });
});
