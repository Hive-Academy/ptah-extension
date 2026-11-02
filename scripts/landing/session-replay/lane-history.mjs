/**
 * Reads the CLI lanes PtahCode recorded for a session, read-only.
 *
 * Mirrors what `SessionMetadataStore` serves to the webview:
 * - lane references: `SessionMetadata.cliSessions` in the session record
 *   (`sessions.detail_json` in `<stateDir>/sessions.sqlite`), returned by
 *   `chat:resume` as `cliSessions`;
 * - lane output: the per-session blob `agent-output.<agentId>` (`agentOutputBlobName`
 *   in libs/backend/agent-sdk/src/lib/session-metadata-store.ts), paged to the
 *   webview by `session:cli-output-page` (`getAgentOutputPage`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function readLanes(stateDir, sessionId) {
  const dbPath = join(stateDir, 'sessions.sqlite');
  if (!existsSync(dbPath)) throw new Error(`No PtahCode session index at ${dbPath}`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare('select detail_json from sessions where session_id = ?').get(sessionId);
    if (!row) return [];
    const detail = JSON.parse(row.detail_json);
    return (detail.cliSessions ?? []).map((ref) => ({ ...ref, output: readLaneOutput(stateDir, sessionId, ref.agentId) }));
  } finally {
    db.close();
  }
}

function readLaneOutput(stateDir, sessionId, agentId) {
  const file = join(stateDir, 'sessions', sessionId, `agent-output.${agentId}.json`);
  if (!existsSync(file)) return { segments: [], streamEvents: [] };
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return {
    segments: Array.isArray(parsed.segments) ? parsed.segments : [],
    streamEvents: Array.isArray(parsed.streamEvents) ? parsed.streamEvents : [],
  };
}
