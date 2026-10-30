# TASK_2026_454_b401 — context

## Triage 2026-10-30

Backlog audit after the October refactors. Still open (a cancel was proposed and rejected).

The CLAUDE.md sentence is gone, but queue-slot-timeout.ts:14-19 still says an agent-sdk import "would close the cycle" while curator-pass-admission.ts:55 and other files import agent-sdk. Decide the memory-curator -> agent-sdk direction and fix the code or the comment.

## Triage 2026-10-30 (premise audit)

Verdict: STALE-REWRITE (lane kimi-code, verified by Claude).

- The documentation contradiction is gone: #562 (23c8eef41) removed the CLAUDE.md docs.
- Remaining contradiction is in code: `main:libs/backend/memory-curator/src/lib/curator-llm/queue-slot-timeout.ts:14-19` says importing `@ptah-extension/agent-sdk` would close the cycle, while `main:libs/backend/memory-curator/src/lib/curator-llm/curator-pass-admission.ts:55` imports `NetworkBackoff` from it.

New scope: decide whether memory-curator may depend on agent-sdk under the memory-contracts boundary; move the dependency behind a contract or correct the comment.
