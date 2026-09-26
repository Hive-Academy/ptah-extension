# Context — TASK_2026_435

Origin: 2026-09-13 skills tribunal (`TASK_2026_431_39db/tribunal/`). Run after
TASK_2026_431 so the rubric is proven on the two hardest skills first.

## The rubric (merged from all three panelists, corrected in round 2)

1. **SKILL.md routes.** Triggers, the 3–5 rules that break silently, reference index
   with a load condition per link. Target ≤ ~150 lines; exceeding it puts the burden
   of proof on the longest section.
2. **One home per rule.** Every other occurrence is a link, not a paraphrase.
3. **Cut model education.** SOLID, poll loops, retry patterns, tool basics readable
   from the schema. **Keep** unfamiliar library contracts, failure cases and
   parser-sensitive labels (round-2 correction: "never teach concepts" is not a law).
4. **One example per mechanism.** Variants differing by one string → one example + table.
5. **No history.** Task IDs, dates, "this already cost us".
6. **Contracts over narrative.** Schemas, gates, output fields, stop conditions stay
   precise; prose describing them goes.
7. **No rosters, counts, versions** that discovery supplies.
8. **Role-gated.** An agent only receives capabilities it may use.
9. **No hardcoded brand/stack** in a generic skill; it is a project input.
10. **Measure what loads**, not directory size: trigger, selected reference, expanded
    agent. Validate on a representative task before accepting a cut.

## Audit targets (ptah-core unless noted)

| Skill                                                                     | Suspected issue (to verify)                                                                                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ptah-cli-usage` (104KB)                                                  | hard rules repeated in "Quick don'ts" (`SKILL.md:112–224`); family exceptions in entry text                                                                         |
| `ui-ux-designer` (100KB)                                                  | bundled design system treated as authoritative (`SKILL.md:177`); history                                                                                            |
| `technical-content-writer` (68KB)                                         | Ptah brand mandatory (`SKILL.md:86`, `DESIGN-SYSTEM.md:10–40`), repeated tokens (`LANDING-PAGES.md:17–51`) — move Ptah brand to this repo, not delete               |
| `ddd-architecture` (68KB)                                                 | model education density                                                                                                                                             |
| `humanize-library` (60KB)                                                 | example repetition                                                                                                                                                  |
| `skill-creator` (40KB)                                                    | long skill explainer + repeated progressive-disclosure examples (`:11–201, 216–348`); becomes the rubric's home                                                     |
| ptah-angular `angular-3d-scene-crafter`, `angular-gsap-animation-crafter` | both workflows + tutorials + scripted dialogues at entry (~25–29KB); move per-workflow material behind references. Keep `assets/*.ts` starters (opt-in, not loaded) |
| ptah-nx-saas, ptah-react, ptah-dotnet, ptah-video                         | not yet reviewed                                                                                                                                                    |

## Deliverables

- Rubric as a reference in `skill-creator` (and linked from `agent-lanes` authoring notes).
- Per-skill `audit-<skill>.md` in this folder: findings with line refs, cuts made,
  trigger KB before/after.
- Content manifest regenerated.

## Constraints

- VS Code marketplace scanner: plugin markdown ships via runtime download, never re-add
  as VSIX assets.
- Do not change what a skill teaches unless a copy is factually wrong.

## Resume point (status audit 2026-09-26)

Status: PARTIAL. Batch 1 of 3 is done.

Shipped:

- Batch 1 — skill description pass: `a9513c124` (26 descriptions, 13,733 to 6,627 chars), guard test `be81894f2` (`skill-description-shape.spec.ts`), docs `dec2dba41`, PR #504. Results in `description-audit.md`.

Remaining targets:

- [ ] Batch 2 — put the rubric into `skill-creator` (its `references/` holds only `output-patterns.md` and `workflows.md`) and link it from `agent-lanes`.
- [ ] Batch 2 — trim each skill body and record trigger-time KB before and after in `audit-<skill>.md`. Current SKILL.md lines: angular-3d-scene-crafter 657, angular-gsap-animation-crafter 573, technical-content-writer 308, ui-ux-designer 248, ptah-cli-usage 239. Also ptah-nx-saas, ptah-react, ptah-dotnet, ptah-video.
- [ ] Batch 3 — `## Requires` across all plugins. Extend `GUARDED_PLUGINS` (today `['ptah-core']`) in `libs/backend/harness-sync/src/lib/targets/skill-sibling-links.spec.ts`.
