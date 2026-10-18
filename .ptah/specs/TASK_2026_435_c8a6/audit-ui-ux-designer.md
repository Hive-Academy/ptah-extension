# Audit: ui-ux-designer (TASK_2026_435 batch 2b)

Method: same as batch 2a (`audit-skill-creator.md`) — walk the skill against
`skill-creator/references/prompt-authoring-rubric.md`, cut narration, move
detail behind reference homes, keep contracts. Trigger-time KB = bytes of
SKILL.md. Packaged dir under `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ui-ux-designer/`
is master; `.claude/skills/ui-ux-designer/` synced byte-identical.

## Findings (original SKILL.md, 248 lines)

| Rubric rule | Finding | Original line refs |
| --- | --- | --- |
| 1 SKILL.md routes | 248 lines; the file carried full phase methods instead of routing | whole file |
| 2 one home per rule | Quick Start phase templates paraphrased the reference homes (discovery questions, token table, tool matrix) | :35-116 |
| 2 one home per rule | Prototype section duplicated PROTOTYPING.md (folder layout, rules, screenshot loop, Gate 1.7 iteration) | :120-142 |
| 2 drift | Output Format taught saving the project design system INTO the shipped `technical-content-writer` skill directory, while DESIGN-SYSTEM-BUILDER.md:19 and DEVELOPER-HANDOFF.md:377,450 already taught the project as its home — the SKILL.md contradicted its own references | :164-168, :189-205 |
| 4 one example per mechanism | Pro Tips restated reference rules as filler | :241-248 |
| 5 no history | "Example: How Ptah's Design System Was Created" told one project's discovery story with task references | :209-237 |
| 9 no hardcoded brand | The same example hardcoded the Ptah brand (niche, references, tokens) in a generic skill | :209-237 |

## Cuts and moves

Cuts (paraphrase removed, homes already carry the teaching):

- :35-116 Quick Start phase templates → four one-line phases, each linking its
  home (NICHE-DISCOVERY.md, DESIGN-SYSTEM-BUILDER.md, ASSET-GENERATION.md).
- :120-142 prototype detail → kept the Gate 1.7 rule, the deliverable shape and
  the "rules that break silently" (contracts), plus one pointer to
  PROTOTYPING.md for layout/skeleton/state checklist/screenshot/README.
- :241-248 Pro Tips.

Moves (nothing deleted):

- :209-237 Ptah discovery example → `docs/design-system/ptah-content-brand.md`
  "Discovery Record" section (see the technical-content-writer audit for the
  brand file).

Kept as contracts: role line, Core Philosophy pipeline (+ new rule: investigate
the project's existing design system first, linking DESIGN-SYSTEM-BUILDER.md
Phase 0), Skill Components index (7 links, unchanged), Output Format contract —
with the home fixed:

```markdown
- Save the design system to the project's own design-system location (for
  example `docs/design-system/design-system.md`), next to the project's
  existing design docs there — never inside a shipped skill's directory.
- Save design specification to: `.ptah/specs/<TASK_FOLDER>/design-spec.md`
```

The "Integration with Content Writer" section now states the design system
lives in the project and a shipped skill's directory is never its home (the old
`Write(<technical-content-writer skill dir>/DESIGN-SYSTEM.md)` pseudocode is
gone).

## Trigger-time KB

| Item | Before | After | Delta |
| --- | --- | --- | --- |
| SKILL.md | 10,421 B / 248 ln | 5,889 B / 115 ln | −43.5% |
| dir total (wc -c/du) | 105,048 B | 100,516 B | −4,532 B |

The dir delta equals the SKILL.md delta exactly; no reference file changed in
this skill.

## Checks

- `diff -r` packaged vs `.claude` copy: identical (both skills).
- Every markdown link target named in SKILL.md exists in the skill dir:
  7/7 (NICHE-DISCOVERY, DESIGN-SYSTEM-BUILDER, ASSET-GENERATION,
  REFERENCE-LIBRARY, LAYOUT-PATTERNS, DEVELOPER-HANDOFF, PROTOTYPING).
- Frontmatter `name`/`description` lines: no `+`/`−` in `git diff` — unchanged.
- `npx jest -c libs/backend/harness-sync/jest.config.ts --coverage=false
  --maxWorkers=2 skill-sibling-links`: 11 passed, 0 failed.

## Decisions

1. **115 lines meets the ~150 routing target** without losing a contract; the
   four one-line phases keep the ordering the old templates taught.
2. **The save-location fix is rule 2, not new policy**: the references already
   taught `docs/design-system/` as the home; the SKILL.md was the outlier.
3. **Prototype "rules that break silently" stay in the router** — they are
   contracts that fail without an error (purged CSS, banned components, status
   buttons), so routing-only would lose them.
4. **Left as-is, recorded for follow-up** (out of this batch's focus):
   - `DESIGN-SYSTEM-BUILDER.md:26` points at `docs/design-system/README.md`,
     which does not exist in this repo. Dangling path; fixing it changes
     teaching text in a reference and needs a decision on the right home.
   - Reference files keep "Sacred Tech (Ptah Style)" as one archetype/example
     among several (NICHE-DISCOVERY archetype table, ASSET-GENERATION keyword
     bank, REFERENCE-LIBRARY section). Rule 9 tolerates an example; the skill
     does not mandate the brand.