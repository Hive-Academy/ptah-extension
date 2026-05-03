// SQL migration — STATIC TEXT ONLY. Never add ${...} interpolation here.
// Enforced by ESLint (no-template-curly-in-migration) + Semgrep
// (sql-injection-in-migration). Adding interpolation = SQL injection by design.
export const sql = `
-- 0002_memory.sql — Memory Curator (Letta tiered)
-- Tier values: 'core' | 'recall' | 'archival'
CREATE TABLE memories (
  id              TEXT PRIMARY KEY,            -- ULID
  session_id      TEXT,
  workspace_root  TEXT,
  tier            TEXT NOT NULL CHECK (tier IN ('core','recall','archival')),
  kind            TEXT NOT NULL,               -- 'fact' | 'preference' | 'event' | 'entity'
  subject         TEXT,                        -- normalized entity key
  content         TEXT NOT NULL,
  source_message_ids TEXT,                     -- JSON array of jsonl message ids
  salience        REAL NOT NULL DEFAULT 0,
  decay_rate      REAL NOT NULL DEFAULT 0.01,  -- per-day exponential
  hits            INTEGER NOT NULL DEFAULT 0,
  pinned          INTEGER NOT NULL DEFAULT 0,  -- 0/1
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  last_used_at    INTEGER NOT NULL,
  expires_at      INTEGER                      -- NULL = no auto-expiry
);
CREATE INDEX idx_memories_session   ON memories(session_id);
CREATE INDEX idx_memories_workspace ON memories(workspace_root);
CREATE INDEX idx_memories_tier      ON memories(tier);
CREATE INDEX idx_memories_subject   ON memories(subject);
CREATE INDEX idx_memories_salience  ON memories(salience DESC);

-- Chunks = retrievable text shards of a memory (1:N)
CREATE TABLE memory_chunks (
  id          TEXT PRIMARY KEY,
  memory_id   TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  ord         INTEGER NOT NULL,
  text        TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_memory_chunks_memory ON memory_chunks(memory_id);

-- BM25 full-text index over chunk text
CREATE VIRTUAL TABLE memory_chunks_fts USING fts5(
  text,
  content='memory_chunks', content_rowid='rowid',
  tokenize='porter unicode61'
);
CREATE TRIGGER memory_chunks_ai AFTER INSERT ON memory_chunks BEGIN
  INSERT INTO memory_chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER memory_chunks_ad AFTER DELETE ON memory_chunks BEGIN
  INSERT INTO memory_chunks_fts(memory_chunks_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;
CREATE TRIGGER memory_chunks_au AFTER UPDATE ON memory_chunks BEGIN
  INSERT INTO memory_chunks_fts(memory_chunks_fts, rowid, text) VALUES('delete', old.rowid, old.text);
  INSERT INTO memory_chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;

-- Vector index (sqlite-vec). 384 dims = bge-small-en-v1.5.
CREATE VIRTUAL TABLE memory_chunks_vec USING vec0(
  rowid INTEGER PRIMARY KEY,
  embedding FLOAT[384]
);
-- No triggers - population is explicit by the indexer (it must run the
-- embedder before insert; firing an embed() inside a SQLite trigger is
-- impossible in the worker-thread architecture).
`;
