export const sql = `
-- 0013_code_symbols.sql — Dedicated table for tree-sitter code symbol index.
-- Separates code navigation from Letta-style curated memory (previously
-- conflated under subject='code:%' in the memories table).

CREATE TABLE code_symbols (
  id              TEXT PRIMARY KEY,
  workspace_root  TEXT NOT NULL,
  file_path       TEXT NOT NULL,
  kind            TEXT NOT NULL,
  symbol_name     TEXT NOT NULL,
  subject         TEXT NOT NULL,
  text            TEXT NOT NULL,
  token_count     INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE(workspace_root, subject)
);
CREATE INDEX idx_code_symbols_workspace ON code_symbols(workspace_root);
CREATE INDEX idx_code_symbols_file      ON code_symbols(workspace_root, file_path);
CREATE INDEX idx_code_symbols_subject   ON code_symbols(subject);

CREATE VIRTUAL TABLE code_symbols_fts USING fts5(
  text,
  content='code_symbols', content_rowid='rowid',
  tokenize='porter unicode61'
);
CREATE TRIGGER code_symbols_ai AFTER INSERT ON code_symbols BEGIN
  INSERT INTO code_symbols_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER code_symbols_ad AFTER DELETE ON code_symbols BEGIN
  INSERT INTO code_symbols_fts(code_symbols_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;
CREATE TRIGGER code_symbols_au AFTER UPDATE ON code_symbols BEGIN
  INSERT INTO code_symbols_fts(code_symbols_fts, rowid, text) VALUES('delete', old.rowid, old.text);
  INSERT INTO code_symbols_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE VIRTUAL TABLE code_symbols_vec USING vec0(
  rowid INTEGER PRIMARY KEY,
  embedding FLOAT[384]
);

-- Drop legacy code-symbol rows from the memories table; ON DELETE CASCADE
-- on memory_chunks.memory_id removes their chunks. Orphan rows in
-- memory_chunks_vec (no FK) are harmless until rebuildIndex runs.
DELETE FROM memories WHERE subject LIKE 'code:%';
`;
