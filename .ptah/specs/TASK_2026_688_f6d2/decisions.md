# Decisions — TASK_2026_688_f6d2

| # | Decision | Evidence | Reversible |
| - | -------- | -------- | ---------- |
| D1 | BUGFIX, Minimal depth; no research or team-leader phase. | Root cause found in one method (`mergePage`); fix is one file plus spec. | yes |
| D2 | Fix in the dashboard client, not only in the e2e fake listener. | RPC responses are a boundary (CLAUDE.md coding standards: validate boundary payloads); one bad page must not fail the full load. | yes |
| D3 | A malformed page maps each requested id to `unreadableStats` (status `error`). | Same path already used for ids a page did not answer (`mergePage` doc comment). | yes |
| D4 | Implementer: codex lane; reviewer: Claude code-logic-reviewer subagent (different family). | Gate 0.1 memory `orchestration-executor-preference` (newest), codex confirmed room. | yes |
