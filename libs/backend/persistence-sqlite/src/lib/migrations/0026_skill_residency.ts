export const sql = `
-- 0026_skill_residency.sql — progressive disclosure residency for skills.
-- 'resident' skills are eagerly fed to the junction layer (name+description
-- resident in the model, body on demand); 'dormant' skills are skipped at the
-- junction seam so they no longer occupy prompt budget yet keep their row +
-- SKILL.md for future re-promotion. Replaces the old decay-cap demotion to
-- 'rejected' (which destroyed the skill). Additive base-table column only —
-- never gated behind sqlite-vec so it survives a vec-load failure. SQLite
-- ADD COLUMN does not support IF NOT EXISTS; the runner applies each version
-- exactly once, so a bare ADD COLUMN with a DEFAULT is safe.
ALTER TABLE skill_candidates ADD COLUMN residency TEXT NOT NULL DEFAULT 'resident' CHECK (residency IN ('resident','dormant'));
`;
