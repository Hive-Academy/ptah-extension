export const sql = `
-- 0028_gateway_conversation_workspace_root.sql — conversation-level workspace
-- pinning for the messaging gateway (TASK_2026_156). NULL = inherit the
-- binding-level workspace_root (today's behavior). Set only by the Discord
-- '/workspace use' control command and the webview attach flow. Forward-only;
-- no backfill (existing rows inherit).
ALTER TABLE gateway_conversations ADD COLUMN workspace_root TEXT;
`;
