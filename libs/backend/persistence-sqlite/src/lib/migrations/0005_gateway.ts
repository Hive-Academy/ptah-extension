// SQL migration — STATIC TEXT ONLY. Never add ${...} interpolation here.
// Enforced by ESLint (no-template-curly-in-migration) + Semgrep
// (sql-injection-in-migration). Adding interpolation = SQL injection by design.
export const sql = `
-- 0005_gateway.sql — Messaging Gateway
-- Per-platform conversation routing. Approval status governs the human-in-
-- the-loop "did the user authorize this remote chat?" flow.
CREATE TABLE gateway_bindings (
  id              TEXT PRIMARY KEY,
  platform        TEXT NOT NULL CHECK (platform IN ('telegram','discord','slack')),
  external_chat_id TEXT NOT NULL,                 -- chat id / guild+channel / team+channel
  display_name    TEXT,
  approval_status TEXT NOT NULL CHECK (approval_status IN ('pending','approved','rejected','revoked')) DEFAULT 'pending',
  ptah_session_id TEXT,                           -- one resident session per binding
  workspace_root  TEXT,
  created_at      INTEGER NOT NULL,
  approved_at     INTEGER,
  last_active_at  INTEGER,
  UNIQUE(platform, external_chat_id)
);
CREATE INDEX idx_gateway_bindings_status ON gateway_bindings(approval_status);

-- Inbound + outbound message log for replay/debug + dedup of provider retries.
CREATE TABLE gateway_messages (
  id              TEXT PRIMARY KEY,
  binding_id      TEXT NOT NULL REFERENCES gateway_bindings(id) ON DELETE CASCADE,
  direction       TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  external_msg_id TEXT,                           -- provider message id (NULL for outbound chunks)
  ptah_message_id TEXT,                           -- our session message id (when applicable)
  body            TEXT NOT NULL,
  voice_path      TEXT,                           -- absolute path if voice was attached
  created_at      INTEGER NOT NULL,
  UNIQUE(binding_id, direction, external_msg_id)
);
CREATE INDEX idx_gateway_messages_binding ON gateway_messages(binding_id, created_at DESC);
`;
