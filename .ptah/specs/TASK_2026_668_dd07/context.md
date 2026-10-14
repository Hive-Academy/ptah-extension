# Context
Source: HANDOFF.md follow-up 5 (pre-existing, found during PR 724/725 review).
- `chat-session.service.ts` about lines 922-925 logs the first 80 characters of the prompt in
  the `chat:continue` stop-intent path. Prompt text must not go to logs.
- Note: PR 724 and PR 725 both edit this file. Start after both merge.
