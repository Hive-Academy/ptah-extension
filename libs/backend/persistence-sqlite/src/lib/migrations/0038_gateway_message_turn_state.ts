export const sql = `
-- 0038_gateway_message_turn_state.sql — durable per-inbound turn state for the
-- messaging gateway (TASK_2026_277).
--
-- ConversationQueue and ConversationTurnTracker are in-memory, so a Discord /
-- Telegram / Slack message whose agent turn was running when the host process
-- died left no trace: no reply, no error, and nothing on the next boot knew it
-- had existed. 'turn_state' makes that state durable.
--
-- Domain: 'queued' | 'running' | 'done' | 'failed' | 'interrupted'.
-- NULL means "not an inbound turn" — every outbound row, plus every inbound row
-- written before this migration. The recovery sweep selects on
-- turn_state IN ('queued','running'), so NULL rows are invisible to it and no
-- backfill is needed (or wanted: a pre-migration row's turn is long gone).
--
-- 'conversation_id' rides along because the restart notice is batched ONE PER
-- CONVERSATION, and gateway_messages previously linked only to the binding. A
-- binding can serve several Discord threads, so grouping by binding would send
-- the notice to the wrong thread. NULL for outbound rows and for legacy inbound
-- rows; the sweep falls back to one notice per binding when it is NULL.
--
-- Deliberately NO index: the sweep runs once per boot over a table that is
-- small by construction (7-day voice GC, per-binding listing), and a partial
-- index on a five-value column would cost more on every inbound write than it
-- saves on one startup scan.
ALTER TABLE gateway_messages ADD COLUMN turn_state TEXT;
ALTER TABLE gateway_messages ADD COLUMN conversation_id TEXT;
`;
