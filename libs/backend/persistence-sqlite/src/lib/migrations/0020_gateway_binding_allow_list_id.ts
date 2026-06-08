export const sql = `
-- 0020_gateway_binding_allow_list_id.sql — persist the allow-list id
-- (Telegram user / Discord guild / Slack team) on the binding so the gateway
-- UI can offer a one-click "add this sender to the allow-list" action without
-- the user hunting for a raw id. Forward-only; the column is NULL for rows
-- created before this migration.
ALTER TABLE gateway_bindings ADD COLUMN allow_list_id TEXT;
`;
