export const sql = `
CREATE INDEX IF NOT EXISTS memories_subject_tier_idx
  ON memories(subject, tier);
`;
