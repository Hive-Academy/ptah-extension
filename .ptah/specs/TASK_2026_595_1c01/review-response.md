# Review response - TASK_2026_595_1c01

Response to `code-logic-review.md` (REVISE 7/10).

| # | Decision | Reason |
|---|----------|--------|
| 1 | Not a defect, no change | The Apps page never calls `chat:resume` (activate) or rewind. A grep of `libs/frontend/mcp-apps-page/src` outside specs finds no caller. It resumes only through `chat:continue`, which carries `mcpToolProfile: 'apps'`. If an Apps conversation is opened from history in the main chat, it resumes in a view with no Apps panel, so the `coding` profile is the correct result there. Persisting the profile in session metadata would add a storage shape and no reachable benefit. |
| 2 | Fix (Lane A, round 1) | The `execute_code` namespaces `ptah.dashboard` / `ptah.surface` refuse calls under `coding`. |
| 3 | Fix (Lane A, round 1) | Fix the namespace count in the coding overview. |
| 4 | Fix (Lane A, round 1) | Restore the plain-URL trust-boundary cases and keep the apps variants as extra cases. |
| 5 | Fix (Lane A, round 1) | The driver-coverage check runs on both the coding and the apps listing. |
| 6 | Fix or pin (Lane A, round 1) | Handle a malformed escape in the `/profile/` segment. |
| 7 | No change | `chat:continue` must carry the profile for the auto-resume path. For a live session the field has no effect. The field doc in `rpc-chat.types.ts` says it is re-sent so a resumed session keeps it. |
