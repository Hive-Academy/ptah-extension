// Additive review attempt failure details. Existing rows remain nullable.
export const sql = `
ALTER TABLE review_attempts ADD COLUMN failure_stage TEXT;
ALTER TABLE review_attempts ADD COLUMN failure_code TEXT;
ALTER TABLE review_attempts ADD COLUMN failure_message TEXT;
`;
