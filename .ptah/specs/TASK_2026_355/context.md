# TASK_2026_355 — context

## Triage 2026-10-30

Backlog audit after the October refactors: partly delivered, still open.

- Still open: Repair the remaining non-intentional source literals and add a guard that permits only explicit sanitizer/test fixtures.
- Evidence on main: git grep main for the CP1252 mojibake em-dash sequence still finds 136 lines in 10 .ts files, including apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:2 and libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts. Original task counted 344 occurrences in 65 files.
