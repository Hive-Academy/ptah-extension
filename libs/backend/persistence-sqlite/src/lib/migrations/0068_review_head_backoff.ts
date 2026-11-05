// Persist automatic retry eligibility for each repository, PR, and head SHA.
export const sql = `
ALTER TABLE review_heads ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE review_heads ADD COLUMN next_eligible_at INTEGER;
`;
