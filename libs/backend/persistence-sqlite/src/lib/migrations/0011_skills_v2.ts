// SQL migration — STATIC TEXT ONLY. Never add ${...} interpolation here.
export const sql = `
ALTER TABLE skill_candidates ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skill_invocations ADD COLUMN context_id TEXT;
CREATE INDEX idx_skill_invocations_context ON skill_invocations(context_id);
`;
