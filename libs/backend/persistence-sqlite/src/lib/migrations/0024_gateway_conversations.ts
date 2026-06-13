export const sql = `
-- 0024_gateway_conversations.sql — per-conversation session rows for the
-- messaging gateway (one row per binding + external conversation, e.g. a
-- Discord thread). gateway_bindings.ptah_session_id is retired in place as
-- the session source of truth; the backfill copies it into a 'default'
-- conversation row only where a resident session exists. Rows for other
-- conversations are created lazily by ConversationStore. Forward-only.
CREATE TABLE gateway_conversations (
  id                       TEXT PRIMARY KEY,
  binding_id               TEXT NOT NULL REFERENCES gateway_bindings(id) ON DELETE CASCADE,
  external_conversation_id TEXT NOT NULL,
  ptah_session_id          TEXT,
  created_at               INTEGER NOT NULL,
  last_active_at           INTEGER,
  UNIQUE(binding_id, external_conversation_id)
);
CREATE INDEX idx_gateway_conversations_binding ON gateway_conversations(binding_id);

INSERT INTO gateway_conversations (id, binding_id, external_conversation_id, ptah_session_id, created_at, last_active_at)
SELECT lower(hex(randomblob(16))), id, 'default', ptah_session_id, created_at, last_active_at
FROM gateway_bindings
WHERE ptah_session_id IS NOT NULL;
`;
