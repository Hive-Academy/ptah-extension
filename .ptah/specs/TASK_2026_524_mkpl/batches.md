# Batches — TASK_2026_524_mkpl

Source of truth for contracts: `implementation-plan.md` (specs 1–11 and the
handoff table at the end). This file only fixes the execution order.

| Wave | Batch | Lib                                                      | Executor            | Depends on                                      |
| ---- | ----- | -------------------------------------------------------- | ------------------- | ----------------------------------------------- |
| 1    | B1a   | `core`                                                   | frontend-developer  | —                                               |
| 1    | B1    | `chat-ui`                                                | frontend-developer  | — (panel + grouping use only existing core API) |
| 2    | B2    | `chat`                                                   | frontend-developer  | B1a                                             |
| 2    | B3    | `marketplace`                                            | frontend-developer  | B1a, B1                                         |
| 3    | B4    | `chat-ui`, `chat`, `dashboard`, `apps/ptah-electron-e2e` | frontend-developer  | B2, B3                                          |
| 4    | Judge | read-only                                                | code-logic-reviewer | B4                                              |

Rules:

- Two concurrent batches never edit the same lib.
- Each batch writes `batch-<id>-report.md` in this folder before it returns.
- The orchestrator commits in a quiet window after wave 3 and the judge.
- Tests: `npx nx run-many -t test -p <projects>` and read the
  "Running target test for N projects" header.
