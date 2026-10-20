# TASK_2026_435 batch 2b — stale-reference fix

Follow-up to batch 2b. The move of `technical-content-writer/DESIGN-SYSTEM.md` to
`docs/design-system/ptah-content-brand.md` left references to the old location.
This pass updates every remaining one to the new contract: the design system
lives in the project, at `docs/design-system/`; ui-ux-designer saves new design
systems there; for this repo the brand file is
`docs/design-system/ptah-content-brand.md`. Only location wording changed; the
workflows each file teaches are unchanged.

## Files changed (13 paths, 21 mentions)

| File | Mentions | What changed |
| --- | --- | --- |
| `apps/.../ptah-core/skills/orchestration/references/strategies.md` | 10 | CREATIVE dependency-chain box, Automatic Design System Check paragraph + pseudocode, Workflow A steps, Creative Output Locations table, 2 handoff templates, reference line |
| `.claude/skills/orchestration/references/strategies.md` | — | synced copy of the above (byte-identical) |
| `apps/.../ptah-core/skills/orchestration/references/agent-catalog.md` | 2 | Task() hint cell for technical-content-writer; parallel-row inputs cell |
| `.claude/skills/orchestration/references/agent-catalog.md` | — | synced copy (byte-identical) |
| `libs/backend/agent-generation/templates/agents/technical-content-writer.template.md` | 1 | Inputs bullet |
| `libs/backend/agent-generation/templates/agents/ui-ux-designer.template.md` | 2 | Gather bullet, output-contract table row |
| `.claude/agents/technical-content-writer.md` | 1 | same text change as the template |
| `.codex/agents/technical-content-writer.toml` | 1 | same text change as the template |
| `.opencode/agent/technical-content-writer.md` | 1 | same text change as the template |
| `.claude/agents/ui-ux-designer.md` | 2 | same text changes as the template |
| `.codex/agents/ui-ux-designer.toml` | 2 | same text changes as the template |
| `.opencode/agent/ui-ux-designer.md` | 2 | same text changes as the template |
| `DESIGN.md` | 1 | line 3 authoritative path now `docs/design-system/ptah-content-brand.md` |

All edits were applied by a script with exact-count assertions (each old string
had to appear the expected number of times or nothing was written), so no
mention was missed and none was edited twice.

## Wording applied

- strategies.md, CREATIVE flow: "The design system lives in the project, at
  `docs/design-system/`; a skill directory is never its home. Resolve it with
  `Glob(docs/design-system/**/*.md)`." The pseudocode now uses
  `design_system_files = Glob(docs/design-system/**/*.md)`; ui-ux-designer
  "creates the design system in docs/design-system/"; technical-content-writer
  "loads the project's design system"; both handoff templates say "the project's
  design system in `docs/design-system/`"; the output-locations table uses
  `docs/design-system/design-system.md` in the project (the ui-ux-designer
  SKILL.md example filename).
- agent-catalog.md: Task() hint `**Design System**: the project's design system
  in docs/design-system/`; parallel-row inputs `the project's design system
  (docs/design-system/), brief, source`.
- technical-content-writer template and generated agents: "The project's own
  design system in `docs/design-system/`, whenever the content has a visual
  dimension." (rest of the sentence unchanged).
- ui-ux-designer template and generated agents: "The existing design system in
  the project's `docs/design-system/` directory." and output-contract row
  "`docs/design-system/design-system.md` in the project".
- DESIGN.md: `Authoritative long-form system: `docs/design-system/ptah-content-brand.md`
  ("Egyptian Sacred Tech v2")...` — the label stays accurate; the brand file
  carries the "Egyptian sacred tech / Neo-mystical" style at its line 27.

## Check results

- `git grep -n "DESIGN-SYSTEM.md" -- ':!content-manifest.json' ':!.ptah/specs' ':!docs/design-system'`
  → empty. No stale path remains.
- Broad audit `git grep -n "DESIGN-SYSTEM" ...` filtered for BUILDER → only
  `DESIGN-SYSTEM-BUILDER.md` mentions remain (allowed).
- `cmp` packaged vs `.claude` copy for `strategies.md` and `agent-catalog.md`
  → identical (they were identical before the edit; the packaged files were
  edited and copied over, then verified with `cmp`).
- Dependency-chain box rebuilt at the original 65-char width; alignment verified.
- Specs: `agent-recommendation.service.spec.ts` (guards the
  `templates/agents/*.template.md` set) and `subagent-tool-allowlist.spec.ts`
  (reads the real template dir) both test these templates.
  `npx jest -c libs/backend/agent-generation/jest.config.ts <both specs> --coverage=false --maxWorkers=2`
  → 2 suites, 24 tests, all passed. (`template-storage.service.spec.ts` uses
  fake `/test/` paths only; not run.)
- No build/e2e/workspace-wide checks run, per the verification rules.

## Decisions

- `design_system_path` renamed to `design_system_files` in the strategies.md
  pseudocode, matching the technical-content-writer SKILL.md contract
  (`Glob(docs/design-system/**/*.md)`); the `if NOT exists / if exists` structure
  and the rest of the block are unchanged.
- Output filename `docs/design-system/design-system.md` (the ui-ux-designer
  SKILL.md example) is used in the output-locations and output-contract tables
  for consistency.
- Generated agent copies (`.claude/agents`, `.codex/agents`, `.opencode/agent`)
  received the same sentence changes as the templates, in each file's own
  format, so the agent-recommendation drift guard stays satisfied.

## Flag for the orchestrator (not edited — outside the approved file list)

`content-manifest.json:81` still lists
`ptah-core/skills/technical-content-writer/DESIGN-SYSTEM.md`. The task excluded
this file from the grep check and from the editable set, so it was left
untouched. If that manifest is not auto-generated at build time, it needs its
own follow-up entry.