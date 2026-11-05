// Persist manual dry-run intent across queue claims and process restarts. Static SQL only.
export const sql = `
ALTER TABLE review_attempts ADD COLUMN dry_run INTEGER NOT NULL DEFAULT 0;
`;
