# Policy Report — TASK_2026_268 (Stop the Bleeding)

Scope: half A only (`max-lines` rule + `CLAUDE.md` standard). No file was refactored, no
`eslint-disable` added, no error-level rule. Survey half (the 50 files > 1000 LOC) is a
separate concurrent task and is out of scope here.

## A. `eslint.config.mjs` — the rule

Added as a new flat-config block in the repo-root `D:/projects/ptah-extension/eslint.config.mjs`,
right after the existing `files: ['**/*.ts']` / `no-restricted-syntax` block (before the
`apps/**/*.ts` RPC-handler block). Root placement was deliberate, not accidental: every
per-project `eslint.config.mjs` in the repo (`libs/backend/skill-synthesis/eslint.config.mjs`,
`libs/api/core/eslint.config.mjs`, `libs/shared/eslint.config.mjs`, etc.) does
`import baseConfig from '.../eslint.config.mjs'; export default [...baseConfig, ...]`, and
projects with no local override (e.g. `libs/backend/task-specs`, which has no
`eslint.config.mjs` at all) fall through to this root file directly via ESLint's flat-config
directory walk. One block here reaches every project without touching 70+ per-project files.

```js
{
  files: ['**/*.ts'],
  ignores: [
    '**/*.spec.ts',
    '**/*.d.ts',
    'libs/api/core/src/lib/generated-prisma-client/**',
  ],
  rules: {
    'max-lines': [
      'warn',
      { max: 700, skipBlankLines: true, skipComments: true },
    ],
  },
},
```

### Decisions and justification

- **Severity: `warn`, not `error`.** Non-negotiable per the task brief. Verified live (see
  "Verification" below) that the pre-commit hook's actual lint invocation
  (`npx nx affected --target=lint --max-warnings=-1`, called from `.lintstagedrc.mjs`, not
  read out of the config) still exits 0 with the rule firing.
- **`skipComments: true`.** This codebase documents WHY at length — every `libs/backend/*/CLAUDE.md`
  and most service files carry multi-paragraph rationale blocks (see
  `skill-synthesis.service.ts`, `stage-handlers.service.ts`, this very `eslint.config.mjs`
  after the edit). Counting comment lines against a class that earns its comments would
  create an incentive to delete the explanation to buy line budget — the opposite of what
  this repo's culture rewards. Recommended and applied.
- **`skipBlankLines: true`.** Blank lines are formatting, not a signal of size or complexity.
  Without this, two behaviourally identical files could sit on opposite sides of the cap
  purely because one uses more paragraph breaks. Applied for the same reason as
  `skipComments`.
- **Scope: `**/_.ts`only, not`\*\*/_.tsx`.** The 700/1000 figures in `context.md`were
measured against exactly 2681 hand-written production`.ts`files.`apps/ptah-tui`has 146`.tsx`files (Ink components) that were never part of that measurement. Rather than
silently widen the ceiling to an unmeasured population,`.tsx` is left out of this pass —
  a deliberate scope decision, not an oversight, and easy to add later with its own
  measurement if wanted.
- **`*.spec.ts`: excluded.** A long spec is almost always parameterized test cases or fixture
  data, not a buried concern — the task brief itself flagged this as likely noise, and
  spot-checking confirms it (e.g. `provider-models-cross-provider-contamination.spec.ts`,
  currently being authored on this branch, is long by design). Warning on spec files would
  train people to ignore `max-lines` warnings generally. Excluded.
- **`generated-prisma-client/**`: excluded.** Generated code has no author to read the
warning. Scoped as a per-rule `ignores`entry inside this block rather than added to the
file's global`ignores`array at the top —`libs/api/core`currently has no`lint`target
at all (checked`libs/api/core/project.json`), so the generated files are not linted by
  anything today; a narrow, rule-scoped exclusion avoids silently blanket-exempting that
  directory from every future rule if a lint target is ever added there.
- **`.d.ts` excluded** — hand-authored `.d.ts` ambient declarations are a different genre
  (type-only, no logic) and would be pure noise against this rule; also matches the
  `context.md` measurement's own exclusion list.

## B. `CLAUDE.md` — the standard

Added one bullet to `D:/projects/ptah-extension/CLAUDE.md` under `## Coding Standards`
(between the RPC dual-registration bullet and the Windows-paths bullet), matching the
density of the surrounding bullets:

> - **File size**: soft ceiling 700 lines (`eslint.config.mjs` `max-lines`, warn-level —
>   TASK_2026_268); past 1000 means a deliberate look, not an alarm. Line count alone is not
>   the signal — a contract barrel or exhaustive type union can be long and correct. When a
>   split is warranted, use the **facade rule**: the public class keeps its name, DI token and
>   method signatures; the extracted concern becomes a collaborator injected into it (worked
>   example: `SkillSynthesisService` / `StageHandlersService`, TASK_2026_256). Guardrails
>   against fragment sprawl: the extracted piece must pass a nameability test (no
>   `helpers`/`utils`/`common`/`misc`); no file under ~150 lines created just to satisfy the
>   cap; a split pushing a constructor past ~8 injected deps cut in the wrong place; prefer
>   2–3 collaborators over 6 fragments.

Covers every element the task asked for: ceiling + warn-level + "1000 means deliberate
look," the facade rule with the TASK_2026_256 citation, all four guardrails compressed, and
the "count alone is not the signal" caveat. One bullet, no new section, no padding.

## Verification (real command runs, not config reading)

### 1. Rule fires as a WARNING on known-long files, lint still exits 0

```
$ npx nx lint skill-synthesis
...
D:\...\skill-synthesis\src\lib\skill-candidate.store.ts
  1025:1  warning  File has too many lines (1063). Maximum allowed is 700  max-lines
D:\...\skill-synthesis\src\lib\skill-enhancer.service.ts
  911:1  warning  File has too many lines (785). Maximum allowed is 700  max-lines
D:\...\skill-synthesis\src\lib\skill-synthesis.service.ts
  950:1  warning  File has too many lines (918). Maximum allowed is 700  max-lines
✖ 34 problems (0 errors, 34 warnings)
NX   Successfully ran target lint for project @ptah-extension/skill-synthesis
$ echo EXIT: 0
```

`skill-candidate.store.ts` (raw 1462 lines per the task brief) and `skill-synthesis.service.ts`
(raw 1232 lines) both warn, as required. The reported counted-line figures (1063 / 918) are
lower than the raw file lengths precisely because `skipBlankLines`/`skipComments` are doing
their job on a heavily-documented lib — confirms both options are live, not just configured.
0 errors, exit code 0 (checked separately with `echo EXIT:$?` → `0`).

```
$ npx nx lint task-specs
...
✖ 1 problem (0 errors, 1 warning)     [unrelated no-unused-vars warning]
NX   Successfully ran target lint for project @ptah-extension/task-specs
```

`task-specs` has no local `eslint.config.mjs` at all — it inherits the root file directly,
proving the rule is live repo-wide and not just on projects with their own config, and that
it produces zero false positives on a project with no oversized files.

### 2. Pre-commit lint path

The actual hook (`D:/projects/ptah-extension/.husky/pre-commit` → `.lintstagedrc.mjs`) runs
`npx nx affected --target=lint --max-warnings=-1` on staged TS/JS files. Ran that exact
command against `main`:

```
$ npx nx affected --target=lint --max-warnings=-1 --base=main
...
NX   Successfully ran target lint for 70 projects
$ echo EXIT: 0
```

Exit code 0 with the rule active and firing (58 `max-lines` warnings inside that affected
set — see below). Confirms `--max-warnings=-1` does what its name says: unlimited warnings
allowed, only errors fail the gate.

### 3. Warning count delta (before vs after, `nx affected --base=main`, `--skip-nx-cache` both

runs for a fair comparison)

|                                                    | Before | After | Delta     |
| -------------------------------------------------- | ------ | ----- | --------- |
| Total warnings (deduped from doubled stdout lines) | 853    | 912   | **+59**   |
| `max-lines` warnings                               | 0      | 58    | +58       |
| Exit code                                          | 0      | 0     | unchanged |

The +58 `max-lines` warnings landed on 51 distinct files inside the branch's affected set
(full list captured in the run log), spanning backend services (`sdk-agent-adapter.ts`,
`provider-models.service.ts`, `gateway.service.ts`, several `*-rpc.handlers.ts`), Angular
components (`diff-view.component.ts`, `chat-view.component.ts`), and
`libs/shared/src/lib/types/rpc.types.ts`. Manually checked the file list against the
`ignores` patterns: zero `*.spec.ts`, zero `generated-prisma-client/**` hits — the rule is
not silently matching nothing, and it is not over-matching into the excluded categories
either.

(Note: `nx affected --base=main` only lints projects touched by this branch, not the full
2681-file population from `context.md`; that population-wide 137/50 figure was a manual
measurement outside `nx lint`, not reproduced here. The affected-set check above proves the
rule is live and correctly scoped; it is not a full-repo recount.)

## Constraints honored

- No file refactored, no `max-lines` violation silenced with `eslint-disable`.
- Rule stayed `warn`; never touched to `error`.
- Both edits are additive (`eslint.config.mjs` gained one new block; `CLAUDE.md` gained one
  bullet) — nothing else in either file was changed.
- Did not commit; left for the orchestrator.
