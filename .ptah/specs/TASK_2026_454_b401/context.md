# TASK_2026_454_b401 — context

## Triage 2026-10-30

Backlog audit after the October refactors. Still open (a cancel was proposed and rejected).

The CLAUDE.md sentence is gone, but queue-slot-timeout.ts:14-19 still says an agent-sdk import "would close the cycle" while curator-pass-admission.ts:55 and other files import agent-sdk. Decide the memory-curator -> agent-sdk direction and fix the code or the comment.
