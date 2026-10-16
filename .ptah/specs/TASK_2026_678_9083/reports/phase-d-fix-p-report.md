# Phase D fix P: projection source

## Findings

### S1 — descendant closure

- `libs/frontend/command-center/src/lib/components/command-center-projection.source.ts:61`: collect reachable live tab IDs and persisted session IDs until the sets stop growing. Preserve each live child's actual parent session ID, and filter agents through the resulting session set.
- `libs/frontend/command-center/src/lib/components/command-center-projection.source.spec.ts:154`: `includes live and persisted descendants and their agents without following unrelated sessions or cycling` covers R → C → G, G's parent and agent, unrelated descendants and agents, and a disconnected parent cycle.

### S2 — lane binding and run state

- `libs/frontend/command-center/src/lib/components/command-center-projection.source.ts:155`: bind each manifest lane to one unclaimed agent in the same workflow run by CLI or Ptah CLI family and optional role. `:178` passes those bindings to phase derivation; `:193` derives running, completed, or failed run state from monitored agents.
- `libs/frontend/command-center/src/lib/model/work-projection.ts:211`: omit the separate CLI node when its agent is represented by a bound lane.
- `libs/frontend/command-center/src/lib/components/command-center-projection.source.spec.ts:249`: `binds UUID agents to manifest lanes and advances the lane and run through terminal states` covers different lane and agent IDs, running and completed lane states, completed and failed run states, and no duplicate CLI node.
- `libs/frontend/command-center/src/lib/model/work-projection.spec.ts:172`: `projects three bound Council lanes without a duplicate CLI agent and a stage` checks the lane state and absence of a duplicate CLI node and edge.

## Verification

- `npx eslint` on the four changed TypeScript files: passed.
- `npx prettier --write` then `npx prettier --check` on the same files: passed.
- `ptah_get_diagnostics` scoped to those four files: no diagnostics in requested files. It reported 25 errors in sibling files outside this lane.
- Jest, Nx, TypeScript CLI, and Git commands were not run, per lane instructions. The orchestrator owns those checks.

## Decisions

- Kept the persisted run manifest schema unchanged. The lane ID's trailing `#<number>` distinguishes repeated family lanes; matching uses the family portion and optional role, and claims each agent at most once.
- A run with no monitored agents starts in `starting`. A run with running agents is `running`; after all agents become terminal, failures or timeouts make it `failed`, otherwise `completed`.

## Anything not done

- No project test suite was run in this lane, per verification instructions.
