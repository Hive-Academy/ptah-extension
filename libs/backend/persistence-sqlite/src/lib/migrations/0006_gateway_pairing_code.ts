// SQL migration — STATIC TEXT ONLY. Never add ${...} interpolation here.
// Enforced by ESLint (no-template-curly-in-migration) + Semgrep
// (sql-injection-in-migration). Adding interpolation = SQL injection by design.
export const sql = `
-- 0006_gateway_pairing_code.sql — Messaging Gateway pairing code column.
-- Architecture §4.4 specifies a 6-digit pairing code on the gateway_bindings
-- row that is shown to the user on first inbound and cleared on approval.
-- This was missing from 0005_gateway.sql; rather than back-edit a released
-- migration we add the column here (forward-only).
ALTER TABLE gateway_bindings ADD COLUMN pairing_code TEXT;
`;
