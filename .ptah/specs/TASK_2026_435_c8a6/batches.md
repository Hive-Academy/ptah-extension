# Batches - TASK_2026_435_c8a6

Batches: 3 | Complete: 1/3

## Batch 1 — Skill description pass — COMPLETE

Scope: the `description` frontmatter of all 26 shipped skills under
`apps/ptah-extension-vscode/assets/plugins/*/skills/*/SKILL.md`, plus a guard.
Bodies, `name` and everything below the frontmatter are untouched.

Rule applied to every description:

- Shape: `<what it does, one clause>. Use when <concrete situations / distinctive keywords>. Not for <confusable sibling>.`
  The "Not for" clause only where a real sibling overlap exists.
- Target 150–300 characters; hard cap 400.
- Cut: feature inventories, versions, flags, file names, internal workflow steps,
  numbered `(1)…(n)` lists, long quoted trigger-phrase lists (at most 2–4
  distinctive keywords, inline), body invariants, filler.
- Keep: nouns and verbs a user would say, the real scope, and the delegation cue
  for skills other skills load (agent-lanes).
- Third person, present tense, no marketing adjectives, no new trademarked
  vendor names.
- Single-line scalar. A block scalar (`>-`) breaks
  `plugin-skill-discovery.ts`, which reads only the first line.

Deliverables:

- 26 frontmatter edits; totals 13,733 → 6,627 characters (see
  `description-audit.md`).
- Guard `libs/backend/vscode-lm-tools/src/lib/code-execution/skill-description-shape.spec.ts`:
  missing or empty, block scalar, over 400 characters, numbered list, more than
  four double-quoted phrases.
- `content-manifest.json` regenerated.

Commits:

| Commit      | Subject                                                               |
| ----------- | --------------------------------------------------------------------- |
| `a9513c124` | refactor(vscode): tighten shipped skill descriptions to trigger text  |
| `be81894f2` | test(vscode-lm-tools): guard skill description size and shape         |

## Batch 2 — Per-skill body trims — PENDING

Apply the rubric in `context.md` to each audit target (ptah-cli-usage,
ui-ux-designer, technical-content-writer, ddd-architecture, humanize-library,
skill-creator, the Angular 3D and GSAP crafters, then ptah-nx-saas, ptah-react,
ptah-dotnet, ptah-video). One `audit-<skill>.md` per skill with trigger KB before
and after. Put the rubric into skill-creator as a reference.

## Batch 3 — Cross-plugin `## Requires` declarations — PENDING

`skill-sibling-links.spec.ts` guards `ptah-core` only. Skills in other plugins
link siblings across plugins (for example saas-workspace-initializer ↔
dotnet-solution-initializer), as noted by TASK_2026_431. Declare those links
under `## Requires` and widen the guard to every plugin.
