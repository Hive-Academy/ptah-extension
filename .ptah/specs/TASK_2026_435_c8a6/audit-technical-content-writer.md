# Audit: technical-content-writer (TASK_2026_435 batch 2b)

Method: same as batch 2a (`audit-skill-creator.md`) — walk the skill against
`skill-creator/references/prompt-authoring-rubric.md`, cut narration, move
detail behind reference homes, keep contracts. Trigger-time KB = bytes of
SKILL.md. Packaged dir under `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/technical-content-writer/`
is master; `.claude/skills/technical-content-writer/` synced byte-identical.

Required outcome of this batch: MOVE the Ptah brand out of the shipped skill
into this repo — not delete it. Done (see "Brand move" below).

## Findings (original SKILL.md, 308 lines; references as noted)

| Rubric rule | Finding | Original line refs |
| --- | --- | --- |
| 1 SKILL.md routes | 308 lines; activation prose and example prompts padded the router | whole file |
| 2 one home per rule | "When This Skill Activates" restated the frontmatter description | SKILL.md:10-19 |
| 2 one home per rule | Landing workflow Step 2 duplicated the Mandatory Investigation Protocol | SKILL.md (Landing Page Workflow) |
| 5 no history | Hardcoded task references as the design source (TASK_2026_072) | SKILL.md + LANDING-PAGES.md ("Design spec reference") |
| 5 no history | "Example Prompts That Activate This Skill" | SKILL.md:298-308 |
| 9 no hardcoded brand | Ptah brand mandated for all content ("Ptah content must align…") | SKILL.md:86 |
| 9 no hardcoded brand | Bundled DESIGN-SYSTEM.md carried the full Ptah token library (colors, Cinzel scale, glow tokens, ankh/pyramid 3D specs) inside a generic shipped skill | DESIGN-SYSTEM.md:10-40, whole file (11,305 B) |
| 9 no hardcoded brand | LANDING-PAGES.md embedded the Ptah token tables and Ptah example copy in every template | LANDING-PAGES.md:17-51 and template sections |
| 9 no hardcoded brand | Blog title formula used a Ptah marketing headline | BLOG-POSTS.md:159 |

## Brand move (required by the brief — moved, not deleted)

- `skills/technical-content-writer/DESIGN-SYSTEM.md` (11,305 B, 522 ln)
  → **`docs/design-system/ptah-content-brand.md`** (12,877 B, 565 ln).
- The new file's header declares it a project input, not a shipped-skill part:
  technical-content-writer loads the project's own design system when one
  exists and stays brand-neutral otherwise.
- A "Discovery Record" section was appended to the same file — moved verbatim
  from `ui-ux-designer/SKILL.md:209-237` (discovery yaml, research process,
  result). Nothing from either skill was deleted.
- `docs/design-system/` had no existing Ptah-token file (designs-systems.md is
  a generic design overview; panel-theme-spec.md and stitch_* do not match) —
  no duplication.
- The byte delta (11,305 → 12,877) is the rewritten header plus the moved
  discovery record.

## Cuts and moves in the shipped skill

SKILL.md:

- Cut :10-19 (activation prose, dup of frontmatter) and :298-308 (example
  prompts).
- Mandatory Investigation Protocol compressed to one fenced block (project
  understanding / task history mining / code deep dive), with the
  task-history yield folded into a comment; links CODEBASE-MINING.md.
- "Design System Reference" replaced the brand mandate with project-input
  discovery: `Glob(docs/design-system/**/*.md)`,
  `Glob(**/design-tokens*.json)`,
  `Glob(.ptah/specs/TASK_*/{design-spec,visual-design-specification}.md)`;
  follow project tokens when they exist; otherwise keep content brand-neutral
  and defer visual identity to ui-ux-designer.
- Landing workflow: Step 1 loads the project design system (task reference
  removed); duplicate Step 2 cut; Step 4 checklist genericized ("Colors
  reference the project's design system tokens", …).
- Integration Notes trimmed to two bullets (researcher-expert delegation;
  ui-ux-designer owns visual identity and the design system).

LANDING-PAGES.md (13,539 B → 12,464 B):

- Token tables (:17-51) replaced with a pointer to the SKILL.md's Design
  System Reference; never invent colors/typography/effects.
- `Read(.ptah/specs/TASK_2026_072/...)` → `Glob(.ptah/specs/TASK_*/design-spec.md)`
  and `Glob(.ptah/specs/TASK_*/design-assets/*)`.
- Templates preserved structurally; brand specifics became token-anchored
  placeholders: "[The project's signature 3D motif, from its design system]",
  "[Project display font]", "[accent] glow center → [background] edge",
  "box-shadow … [accent glow token from the design system]"; Ptah example
  headlines → neutral ones ("Where Code Meets Craft", …).

BLOG-POSTS.md: :159 headline de-branded ("How Ptah Achieves…" → "How We
Achieved…"). Byte count unchanged — the old and new strings are the same
length; the edit is applied.

Kept: Core Philosophy, Anti-Patterns, Focus Area Management, Output Format,
content-spec template — all contracts (rule 6). `.ptah/specs` paths kept: they
are the skill's native environment, not a brand.

## Trigger-time KB

| Item | Before | After | Delta |
| --- | --- | --- | --- |
| SKILL.md | 8,458 B / 308 ln | 6,737 B / 245 ln | −20.3% |
| dir total (wc -c/du) | 51,208 B | 37,107 B | −14,101 B |

Dir delta check: 11,305 (DESIGN-SYSTEM.md removed) + 1,721 (SKILL.md) +
1,075 (LANDING-PAGES.md) = 14,101. Exact; BLOG-POSTS.md and the untouched
references account for the rest.

## Checks

- `diff -r` packaged vs `.claude` copy: identical (re-synced after the final
  SKILL.md edit; verified for both skills).
- Every markdown link target named in SKILL.md exists in the skill dir:
  5/5 (LANDING-PAGES, BLOG-POSTS, DOCUMENTATION, VIDEO-SCRIPTS,
  CODEBASE-MINING).
- No cross-skill markdown links remain (the old cross-skill references were
  backtick pseudocode, now removed) — the sibling-links guard is satisfied.
- Frontmatter `name`/`description` lines: no `+`/`−` in `git diff` — unchanged.
- `npx jest -c libs/backend/harness-sync/jest.config.ts --coverage=false
  --maxWorkers=2 skill-sibling-links`: 11 passed, 0 failed.

## Decisions

1. **SKILL.md stays at 245 lines, above the ~150 target.** The remaining bulk
   is output contracts (content spec template, focus-area table, Output
   Format, landing section yaml, validation checklists) which rule 6 pins as
   load-bearing. Cutting further would remove contracts, not narration. Same
   burden-of-proof call as batch 2a landing at 161.
2. **Brand scope**: moved/removed the mandated Ptah brand (token library,
   mandated alignment, Ptah example copy). Third-party inspiration references
   (BlueYard, Augmentcode, Antigravity, Stripe, Claude) stay — they are
   reference material the skill teaches users to analyze, not a mandated
   brand.
3. **content-manifest.json** (repo root) still lists the removed
   `DESIGN-SYSTEM.md`. Regenerating it is outside this lane's edit set — same
   note as batch 2a; needs one follow-up pass when the batch lands.
4. **LANDING-PAGES.md fence nesting** was already imperfect in the original
   (3-backtick blocks inside 3-backtick blocks, stray 4-backtick closers).
   Preserved as-is in untouched sections to keep the diff minimal; fences
   normalized only in rewritten sections.
5. **DESIGN-SYSTEM-BUILDER.md:26** (ui-ux-designer skill) points at
   `docs/design-system/README.md`, which does not exist — pre-existing, out of
   this batch's focus; recorded in the ui-ux-designer audit too.