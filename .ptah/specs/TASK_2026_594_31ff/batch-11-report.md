# Batch 11 report — TASK_2026_594_31ff (plan F)

Executor: the Glm CLI lane wrote all five files. Its session ended before it could verify them or write a report, and the resume failed. A frontend-developer subagent then verified the work and wrote this report. **No defects were found, so nothing was changed.** Every line below is the lane's original work.

## Task 11.1: Apps prompt pointer — DONE

- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/apps-system-prompt.ts:19-21`: one prompt line names the `ptah-surface-authoring` skill. It lists every kind with `SURFACE_COMPONENT_KINDS.join(', ')`, so the list comes from the contract and is not a separate copy. The prompt only points to the skill; it does not carry a per-kind schema.
- `apps-system-prompt.ts:17`: the selectable-items line now includes `badges`.
- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/apps-system-prompt.spec.ts`:
  - `:25-31` checks that exactly one line contains `ptah-surface-authoring`.
  - `:33-48` splits the text after `component kind: ` into exact comma tokens. It then checks the token count and set equality with `SURFACE_COMPONENT_KINDS`, so a substring match cannot pass.
  - `:50-54` checks the badges wording.

## Task 11.2: Skill link and `references/catalog.md` — DONE

- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/SKILL.md:12`: the link to `references/catalog.md` sits next to the existing `ptah-ui.md` link. The frontmatter (`:1-4`) is unchanged.
- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/references/catalog.md`:
  - It has 19 `### <kind>` headings and 19 fenced `json` blocks (counted with grep), one per kind in `SURFACE_COMPONENT_KINDS`.
  - The shared rules at `:5-9` cover ids, RichText, the ban on `class`/`style`/`html` with unknown keys rejected, the limits, and the action rules.
  - Closed props for the new kinds, checked against `libs/shared/src/mcp-apps-contracts/surface.schemas.ts:442-459` and `surface.types.ts:103-128`:
    - **alert** (`:258-269`): tone is closed to info, success, warning or error. `text` is required and `title` is optional. With only tone and text it reads as a short inline note.
    - **badge** (`:271-289`): six tones. The only action allowed is `dashboard.select`, with no `url`. The selection target is `{ "kind": "badge" }`.
    - **progress** (`:291-303`) and **radial-progress** (`:305-317`): `value` is a finite number from 0 to 100, plus a closed tone and a RichText label.
    - **divider** (`:319-330`) and **text-block** (`:332-343`): fully covered.
  - It contains no daisyUI class names; a grep for `btn|badge-|alert-*|progress-*|card-body|divider-|"class"|"style"` returned nothing.
- `.claude/skills/ptah-surface-authoring/` does not exist, which is correct (checked with `ls`).

## Task 11.3: Catalog-reference spec — DONE

- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/surface-catalog-reference.spec.ts`:
  - `:21-30` finds the asset path by walking up from the spec to `nx.json`.
  - `:45-72` keys each example by its exact `### <kind>` heading and records the fence info string.
  - `:81-85` checks the example count and set equality with `SURFACE_COMPONENT_KINDS`, which gives exactly one example per kind. This stops `progress` being satisfied by `radial-progress`, or `text` by `text-block`.
  - `:87-93` requires each fence to be `json` and each heading to be a real kind.
  - `:95-100` checks that each example's `kind` matches its heading.
  - `:102-119` wraps each example in a `SURFACE_SCHEMA_VERSION` (`dashboard-spec/2`) + `SURFACE_CATALOG_VERSION` (`dashboard-catalog/3`) envelope and checks `validateSurfaceDocument(...).ok`. On failure it reports the kind and the reason.

## Verification

- `npx nx run-many -t typecheck,test,lint -p mcp-apps-page vscode-lm-tools --parallel=2` → `Successfully ran targets typecheck, test, lint for 2 projects`. Nx Cloud printed a connectivity notice, which does not affect the result.
- Re-run without the cache to make sure the new specs actually executed:
  - `npx nx test vscode-lm-tools --skip-nx-cache` → `Tests: 2848 passed, 2848 total`.
  - `npx nx test mcp-apps-page --skip-nx-cache` → `Tests: 291 passed, 291 total`.
  - The `--testPathPattern` filter was not applied, so both full suites ran, including the new and modified specs.
  - The known code-outliner timing flake did not occur.
- `manifest:generate` was not run, as instructed; that is Batch 12's job.

## Fixes made by the verifier

None. All five Batch 11 files meet batches.md:801-863 and implementation-plan.md:325-341 as the lane wrote them. No files outside Batch 11 were touched.

## Out-of-scope observations

None.
