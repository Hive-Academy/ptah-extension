# Batch 32 report — G1 eager-closure gate patterns

Executor: backend-developer. No git write commands run. batches.md and decisions.md not edited.

## Files changed

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\scripts\eager-closure-gate.js
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-electron\src\config\eager-closure-gate.spec.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\agent-sdk\src\lib\prompt-harness\ptah-ui-hint.spec.ts

## Task 32.1 — forbidden and allowed eager inputs

`FORBIDDEN_EAGER_INPUTS` adds:

- `libs/shared/src/mcp-apps-contracts/ptah-ui-agents-source.ts` (D6, #37b). The folder pattern
  `libs/shared/src/mcp-apps-contracts/` already covers it; the explicit entry names the file as required.
- `libs/frontend/chat-ui/src/display-panel.ts`
- `libs/frontend/chat-ui/src/lib/organisms/display-panel/`
- `libs/frontend/chat/.*/organisms/display-dock/`, with a comment naming
  `organisms/display-dock/display-dock.component.ts` as lazy-only (#113(b)).

`ALLOWED_EAGER_GROWTH_INPUTS` adds:

- the five plan files (component 13): `transcript-display-candidates.ts`, `transcript-agent-facts.ts`,
  `transcript-ptah-ui-host-sources.ts`, `display-dock.state.ts`, `chat-ui/src/lib/services/ptah-ui-host-sources.ts`;
- `chat-ui/src/lib/services/ptah-ui-display-dock.ts` (#59), commented as the eager port whose only runtime import is
  `@angular/core`;
- `transcript-display-feed.ts`, `transcript-turn-summaries.ts` and `transcript-turn-recap-loader.ts`. Decision #107 and
  batches.md:1604 say Batch 32 must name these. They are not in the five plan files.

All allowed patterns are anchored (`...\.ts$`) to the real file paths (checked with `git ls-files`). None of them
overlaps a forbidden pattern. `display-dock.state.ts` sits under `chat/src/lib/services/display-dock/`, not
`organisms/display-dock/`.

Matching is still done only on esbuild `outputs[*].inputs` keys (`forbiddenOutputs` / `eagerInputs`). No source import
text is read (#76). Fail-closed behaviour is unchanged: a missing `main.js` throws, and any forbidden input in the static
closure throws.

Spec fixtures added:

- One fail-closed fixture per new forbidden pattern. Each has an eager `main.js` listing the input and asserts the exact
  `forbidden eager input(s): <input>` message:
  - `ptah-ui-agents-source.ts`;
  - `chat-ui/src/display-panel.ts`;
  - `organisms/display-panel/display-panel.component.ts`;
  - `libs/frontend/chat/src/lib/components/organisms/display-dock/display-dock.component.ts` (#113(b)).
- #76 fixture: eager `main.js` lists `ptah-ui-display-dock.ts` and no display-panel input. A display-panel input is
  reachable only through a `dynamic-import` chunk. The fixture asserts that both `assertNoForbiddenEager` and
  `assertNoUnlistedEagerGrowth` (against an empty base) pass.
- One growth fixture for each of the nine new allowed inputs. Each asserts that the forbidden check and the growth check
  both pass.
- A negative fixture: a display-panel input is reported as unlisted eager growth, so the allow-list does not let it in.

The spec's `require` type now also declares the existing export `assertNoUnlistedEagerGrowth`.

## Task 32.2 — hint spec comment (#140, #141)

The comment in the `component syntax coverage: ...` case now reads: the hint carries no example because R8.1 does not
require one and R8.3 assigns worked examples to the ptah-surface-authoring skill, so the forms it names are checked
instead. The title, assertions, imports and `PTAH_UI_HINT` are unchanged.

## Verification (one at a time, run from the worktree, each with the #135 `--moduleNameMapper`)

- `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/config/eager-closure-gate.spec.ts --coverage=false --maxWorkers=2 ... | tail -n 40`
  gave 1 suite passed, 20 tests passed (5 existing + 15 new). The ts-jest `allowJs` warning for the `.js` scripts was
  there before this batch.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.spec.ts --coverage=false --maxWorkers=2 ... | tail -n 20`
  gave 1 suite passed, 7 tests passed.
- The real-build gate run was not done here. It is Batch 33 (decisions.md #17).

## Validation notes handled

- #37b: the agents-source pattern was added with its own fixture. Whether the real gate trips on an eager barrel
  importer is only known at the Batch 33 run. If it trips, the importer chain must be reported there. The pattern must
  not be loosened.
- #76: matching stays on esbuild inputs. The dock-port pass fixture was added.
- #113(b): the exact `display-dock.component.ts` input is named as lazy-only in a comment, and a fail-closed fixture
  checks it.
- #107: the three transcript files are on the allow-list.

## Findings (out of scope, not acted on)

- Other new non-spec files on this branch could become eager growth in Batch 33 but are not on the allow-list, because no
  decision lists them:
  - `chat-ui/src/lib/atoms/copy-text-button.component.ts`;
  - `chat-ui/src/lib/utils/tool-language.utils.ts`;
  - `shared/src/lib/types/rpc/rpc-lane-plan-limits.types.ts` (types only, likely erased).

  If Batch 33's growth listing shows them in the eager closure, they need a ruling.
