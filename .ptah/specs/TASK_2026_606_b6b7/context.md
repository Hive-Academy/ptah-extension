# TASK_2026_606 — normalised CLI version in the tasks UI

## Why

`libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts` (around lines 69-70) builds the text
"Run through {cli} {version}." from the raw `--version` line. For codex this reads
"Run through codex codex-cli 0.155.1.". Recorded as follow-up 10 in `TASK_2026_555/batches.md`.

Settings already normalises the version in TASK_2026_555 Batch 52.1: `cliVersionLabel` in
`libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.ts`.

## Scope

- Move `cliVersionLabel` to a lib that both `chat` and `tasks-ui` may import under the boundary lattice (for example
  `libs/shared` or a `util`-tagged frontend lib); keep its behaviour and specs.
- Use it in `task-agent-discovery.service.ts`.

## Acceptance criteria

1. The tasks UI shows "Run through codex 0.155.1." for the codex example; the Settings matrix is unchanged.
2. Specs for the moved function and the discovery service; lint shows no boundary error.

## Out of scope

Other text in the tasks UI.
