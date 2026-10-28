# Batch 7 pins1 report (head version 59 -> 60)

Directory: libs/backend/persistence-sqlite/src/lib/migrations/
- 0028_gateway_conversation_workspace_root.spec.ts line 84: toBe(59) -> toBe(60)
- 0030_skill_event_metrics.spec.ts line 39: toBe(59) -> toBe(60)
- 0038_gateway_message_turn_state.spec.ts line 92: toBe(59) -> toBe(60)
- 0039_reap_orphaned_queue_rows.spec.ts line 66: toBe(59) -> toBe(60)
- 0040_skill_candidate_workspace_root.spec.ts line 79: toBe(59) -> toBe(60)
- 0041_skill_md_migration_state.spec.ts line 63: toBe(59) -> toBe(60)
- 0059_provider_account_session_links.spec.ts line 55: toBe(59) -> toBe(60)

Precedent (ea27188eb) changed only the pin; the history comments stop at 51 and were not extended, so none were edited.
In the 0059 spec, the migration's own version 59 and name (lines 51-52) are unchanged.
