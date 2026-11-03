/** Session-scoped tiles require exact ownership; the null-scoped builder lists ownerless records. */

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

  it('shows an unattributed agent only in the unscoped tray', () => {
    const ids = entryIds(TILE_SESSION, [
      record('unattributed', undefined),
      record('mine', TILE_SESSION),
      record('theirs', OTHER_SESSION),
    ]);

    expect(ids).toEqual(['mine']);
    expect(entryIds(null, [record('unattributed', undefined)])).toEqual([
      'unattributed',
    ]);
  });
});
