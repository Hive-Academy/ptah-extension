// Vec-optional split: entire body is vec0, so this exports `vecSql` only and
// stays `requiresVec`; on a vec-less machine it defers whole (not recorded)
// and runs once vec loads. Recreates the vec0 tables without the explicit
// `rowid INTEGER PRIMARY KEY` partition key (sqlite-vec rejects it). Data loss
// is intentional — both tables are derived indexes, regenerated on next index.
export const vecSql = `
DROP TABLE IF EXISTS memory_chunks_vec;
CREATE VIRTUAL TABLE memory_chunks_vec USING vec0(
  embedding FLOAT[384]
);

DROP TABLE IF EXISTS skill_candidates_vec;
CREATE VIRTUAL TABLE skill_candidates_vec USING vec0(
  embedding FLOAT[384]
);
`;
