# Batch 8FE report

## Task 8FE.1 — S7, M6, style Moderate 3

- **S7:** `work-projection.ts:121-143` projects every Tribunal roster lane under its run, labels an optional role, uses the lane CLI as provider, and maps bound statuses (`running`, `completed`, `failed`, `timeout`, `stopped`) to work states; unbound lanes are queued. `work-projection.ts:167-176` adds a stage for `none` and `unavailable` phase derivations, while Relay and Crucible phase branches remain intact. `work-projection.ts:180-199` places a matching owned agent under its run's lane. The existing node ID map removes duplicates.
- **M6:** `command-center.store.ts:15-23` adds `unknown` to `CommandWorkState`; `work-projection.ts:75-83` assigns it to persisted-only children. A live child with the same session ID takes precedence.
- **Style Moderate 3:** `work-projection.ts:60-64` uses `flatMap` to narrow optional child session IDs; `work-projection.ts:204-209` uses `flatMap` to narrow non-null parent IDs. Both `as string` casts are gone.

## Changed files

- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/work-projection.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/work-projection.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/command-center.store.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/.ptah/specs/TASK_2026_678_9083/reports/batch-8FE-report.md`

## Specs

Changed `work-projection.spec.ts`:

- `:31`: recursive ancestry, sibling exclusion, and unknown persisted grandchild.
- `:70`: persisted child becomes running when its live descriptor arrives, with one node.
- `:93`: three bound Council lanes produce three correctly labelled/provider/state nodes and one stage; matching agent and edge are under its lane.
- `:178`: Relay keeps its four phase nodes and adds a queued role-labelled lane.
- `:212`: Crucible without artifacts produces an unavailable stage with the run state.
- `:235`: two runs under one root retain independent lane IDs, parents, and stage states.

## Audit and verification

- Catch sites added or changed: none. Degradation-audit classification: not applicable.
- `npx prettier --check` output: `All matched files use Prettier code style!`
- Scoped Nx/Jest verification was not run by this lane, as required; the team leader owns `npx nx run-many -t test typecheck lint -p @ptah-extension/command-center --parallel=1`.
- Unable to confirm typecheck, lint, or test results in this lane because those commands were explicitly prohibited.
