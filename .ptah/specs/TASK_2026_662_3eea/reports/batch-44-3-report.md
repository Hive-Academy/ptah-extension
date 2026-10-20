# Task 44.3: Per-workspace grades

## Changed signatures

- `SkillTaskGradeStore.getAggregates(kind, slugs, workspaceRoot: string | null)` and `listRecent(kind, slug, limit, workspaceRoot: string | null)` now require the root. Both bind its normalized value in a `workspace_root = ?` predicate. `upsert` normalizes non-null roots with the same `normalizeWorkspaceRoot` function used by the reads; `removeAbsent` normalizes its root to match those writes. The queries retain `idx_skill_task_grades_subject` on `(subject_kind, subject_slug)`; SQLite then filters `workspace_root` within that subject's rows.
- `SkillScorecardService.getInvocationStats(kind, slug, workspaceRoot?)`, `getScorecards(slugs, workspaceRoot?)`, `getWinRates(slugs, workspaceRoot?)`, and `getScorecardDetail(slug, limit?, workspaceRoot?)` pass the root to all grade reads, including recent verdicts. The new service parameters are optional solely to keep the existing outside callers compiling until Task 59.1 passes the active root. The grade-store parameters are required because it has no outside callers.

## Null-root behavior

An omitted, null, or empty workspace root is treated as no workspace: aggregate queries count no rows and recent grade queries return no rows. Rates stay `null` ("No grade"), even when telemetry has invocation counts. A grade in another workspace cannot become a zero-percent or non-null rate here. An actual graded failure in the selected workspace remains `0`.

## Outside callers (rg over libs, apps, tools)

- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:1820` — `getInvocationStats`
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:1865` — `getScorecards`
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:1866` — `getWinRates`
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:1903` — `getScorecardDetail`
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:2381` — `getInvocationStats`
- `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:948` — `getScorecards`

There are no outside callers of the changed grade-store methods. No outside caller was edited.

## Tests added and updated

- Grade-store spec: same slug with a pass and a failure in separate workspaces; each root sees only its grade and recent verdict. A third root and null root yield null rate and no recent grades. A trailing separator confirms normalization on write and read.
- Scorecard spec: each grade-consuming method passes the root; two roots produce distinct rates; null root produces a null rate and empty detail rows. Existing expectations now supply and assert the root.
- Checks were not run, as required by this task.

## Decisions

- Null or missing root means "No grade", never a global grade query and never `0%`. The SQL equality predicate with a null bound value matches no rows, including grades whose stored root is null.
- The root is the last argument of each method to preserve existing positional arguments, especially the detail limit.
- Keep using `idx_skill_task_grades_subject`, the available index for the leading kind and slug predicates. It does not include workspace root; this task's four-file scope excludes a migration for a composite index.

## Clarifications Needed

none
