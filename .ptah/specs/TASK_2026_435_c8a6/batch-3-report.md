# Batch 3 report — cross-plugin `## Requires` declarations and widened sibling-links guard

Scope: every shipped plugin under
`apps/ptah-extension-vscode/assets/plugins/` (ptah-angular, ptah-core, ptah-dotnet,
ptah-nx-saas, ptah-react, ptah-video). Frontmatter untouched in every edited skill.

## Spec change — `libs/backend/harness-sync/src/lib/targets/skill-sibling-links.spec.ts`

- `GUARDED_PLUGINS` was `['ptah-core']`; it is now `listDirs(PLUGINS_ROOT)` — every plugin
  directory is guarded, and a plugin added later is covered with no spec edit.
- Cross-plugin resolution added: links are written against the flat installed layout, where
  every shipped skill sits at `<skills dir>/<slug>` no matter which plugin ships it (the spec's
  second describe already enforces exactly that layout). A new `shippedSkillDir(plugin, slug)`
  helper resolves a sibling slug first against the linking skill's own plugin, then against
  every other guarded plugin.
- Test 2 ("every cross-skill link lands on an existing file…") now checks the link against the
  resolved sibling skill dir in whichever plugin ships the slug. A link that escapes the
  skills root, names a slug no plugin ships, or points at a missing file inside the sibling is
  still an offender — the guard is not weakened.
- Test 4 ("every ## Requires entry names a sibling skill…") now accepts a sibling shipped by any
  guarded plugin, not only the same one.
- Test 1 gained two assertions (`dotnet-solution-initializer`, `saas-workspace-initializer`) so
  the widening cannot silently regress to ptah-core only.

## Skills changed and why

| Skill | Change | Why |
| ----- | ------ | --- |
| `ptah-dotnet/skills/dotnet-solution-initializer/SKILL.md` | Added `## Requires`: `saas-workspace-initializer` (ptah-nx-saas — cross-plugin), `dotnet-solution-architect`, `nx-dotnet-workspace` | Its body links all three siblings (shared Stage A contract, layout skill, Nx decision skill) and declared nothing; the widened guard flagged them. Format copied from orchestration/tribunal. |
| `ptah-nx-saas/skills/saas-workspace-initializer/SKILL.md` | Added `## Requires`: `dotnet-solution-initializer` (ptah-dotnet — cross-plugin), `nx-workspace-architect` | `references/roadmap-format.md` links dotnet-solution-initializer; `references/stage-a-workflow.md` links nx-workspace-architect; the guard reads Requires from the skill's SKILL.md. |
| `ptah-core/skills/agent-lanes/SKILL.md` | Added one sentence in the intro: "Skill and workflow authors: write and trim prompts against the [prompt-authoring rubric](../skill-creator/references/prompt-authoring-rubric.md) in `skill-creator`." Plus a `## Requires` entry for `skill-creator` | Batch 3 item 3. The new rubric line is itself a sibling link, and ptah-core was already guarded, so `skill-creator` must be declared. |

Copies synced: `.claude/skills/agent-lanes/SKILL.md` and
`.claude/skills/saas-workspace-initializer/SKILL.md` (cp + cmp, byte-identical).
`.claude/skills/dotnet-solution-initializer/` does not exist — no copy needed.
All edited files are LF-only (verified with a CR-byte count: 0 everywhere).

No other skill in any plugin links a sibling — a full scan of every `.md` under all six
plugins' `skills/` directories found cross-skill links only in orchestration, tribunal,
dotnet-solution-initializer and saas-workspace-initializer.

## Test output summary

- `npx jest -c libs/backend/harness-sync/jest.config.ts --coverage=false --maxWorkers=2
  skill-sibling-links` — **1 suite passed, 11/11 tests passed** (6.1 s).
- `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts --coverage=false --maxWorkers=2
  skill-description-shape` — **1 suite passed, 6/6 tests passed** (1.7 s).

## Decisions

1. **Derived plugin list, not an explicit one.** `listDirs(PLUGINS_ROOT)` matches the spec's
   existing style (it already derives skill slugs with `listDirs`) and auto-covers future
   plugins, which is the point of widening the guard.
2. **Cross-plugin links resolve through the flat sibling namespace.** Skills link
   `../<slug>/…` because harness targets install every skill as a flat sibling, so the
   source-tree resolution differs from the runtime one. The resolver prefers the linking
   skill's own plugin, then scans the others. `saas-workspace-initializer/references/roadmap-format.md`
   already documents this intent in its own link text ("resolves via the flat skills namespace
   at runtime"), so no link needed rewriting and no link was removed.
3. **`skill-description-shape` does not exist in harness-sync** (grep, no matches). The batch-1
   guard lives in `vscode-lm-tools`; it was run against that lib instead. Frontmatter was
   untouched in this batch, and the guard passes.
4. **`ddd-architecture` gets no Requires entry** in dotnet-solution-initializer: it is named in
   prose but not linked, and the guard convention (orchestration, tribunal) lists only linked
   siblings.
5. **agent-lanes gained a `## Requires` section** — required by the guard because of the new
   rubric link, and consistent with the ptah-core format ("If it is not installed, tell the
   user to enable it; do not improvise a rubric.").

Not done: nothing. No commit made (per task rules).