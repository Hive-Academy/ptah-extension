# Docs changes — TASK_2026_239

Tribunal docs updated to five moves, panel-first entry points, and discovery-driven
vendor language. Authority for behaviour: the shipped skill references under
`apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/references/`
(read only — not edited). Panel behaviour is described from the shipped UI in
`libs/frontend/tribunal-panel/`.

## Files touched

### NEW — `apps/ptah-docs/src/content/docs/tribunal/crucible.md`

Starlight frontmatter (`title`, `description`) matching the four siblings. Written for
a user deciding whether to reach for the move, not as a restatement of the conductor
protocol. Covers:

- the executor/judge asymmetry, and why the asymmetry is the economics
- the rubric written and frozen **before** the first spawn
- the defect contract — every defect needs `file:line` evidence or it is discarded
- the mentor note, and why naming the pattern beats listing symptoms
- the round cap of 2 (a 3rd only on explicit request mid-run, never a 4th)
- the regression stop, and the hard stop on `REJECT`
- "the judge's PASS is an opinion; the build is the fact"
- when **not** to use it: bar can't be written down → Council; competing designs →
  Forge/Race; task small enough for one good lane
- the panel wizard (move → roster → rubric → run), the live verdict readout, the
  two-family requirement, the tribunal-skill advisory
- cost: 2 paid calls per round; rounds strictly sequential

### `apps/ptah-docs/astro.config.mjs`

Tribunal sidebar section (explicit `items`): added
`{ label: 'Crucible', slug: 'tribunal/crucible' }` after Relay.

### `apps/ptah-docs/src/content/docs/tribunal/index.md`

- "The four moves" → **"The five moves"**; Crucible card added (`icon="star"` —
  verified present in `@astrojs/starlight/components-internals/Icons.ts`).
- **Killed the "Vendor family → CLI agent used" table** (8 hardcoded rows). Replaced
  with discovery-driven prose: the panel is built from what is installed/configured on
  this machine right now, one lane per family, absent families simply absent, and any
  vendor named anywhere is an illustration rather than a roster.
- Added the role-slot concept (Relay 4 slots, Crucible 2) to "How the panel is
  assembled", folding in the user-facing half of `vendor-panel.md`.
- Minimum-panel note now also states Crucible's stricter two-family requirement.
- Tribunal-vs-Orchestration table: structure/output/vendor-relationship rows updated so
  Crucible's unequal pair is represented; the tip now names both Relay and Crucible as
  the deliberate exceptions.
- "Invoking Tribunal" split into **The Tribunal panel** (four wizard steps, live grid,
  Relay/Crucible progress) and **Natural language**; Crucible trigger phrase added.
- Platform requirements de-listed: "two or more independent vendors", no named roster.

### `apps/ptah-docs/src/content/docs/tribunal/council.md`

- Dropped "first and currently available move" (stale — all five ship).
- Anonymization example de-branded, plus the honest caveat that anonymization is
  best-effort (from `vendor-panel.md §4`).
- Panel entry point added to "Invoking Council".
- Panel size & cost paragraph now says the list is discovered, never hardcoded.

### `apps/ptah-docs/src/content/docs/tribunal/forge.md`

- De-branded the cross-vendor-review bullet.
- Panel entry point added, with the no-fixed-vendor-list statement.

### `apps/ptah-docs/src/content/docs/tribunal/race.md`

- "Panel composition" now says distinct **families** from discovery, and mentions the
  same-vendor-different-model option the panel actually supports.
- Panel entry point added (lanes can repeat a vendor).

### `apps/ptah-docs/src/content/docs/tribunal/relay.md`

- Panel entry point added as a **role** move: four phase slots, per-slot vendor+model,
  the blocking rule (review lane ≠ implement lane) and the same-family warning — both
  taken from `tribunal-roster-rules.ts`.
- Live four-step phase rail documented, including the honest "progress unavailable"
  state when no spec folder was allocated.
- Tribunal-skill note added.
- "Relay vs. the other moves" table extended with a Crucible row.

## Verification

`npx nx build ptah-docs` — **PASS**. 144 pages built (was 143);
`dist/apps/ptah-docs/tribunal/crucible/` emitted; Pagefind indexed 145 HTML files.
No frontmatter or content-collection errors.

Grep sweep over all six tribunal pages for `claude|codex|copilot|cursor|anthropic|
openai|kimi|moonshot|glm|z.ai|ollama|openrouter|github` returns **zero matches**.

## Deliberately left out

- **No `vendor-panel.md` docs page.** Per the decision in the task brief: that
  reference is conductor protocol (spawn args, `ptahCliId`, anonymization labels,
  `[tribunal:<laneId>]` grammar) and is not user-facing. Only its user-relevant half —
  how the panel is assembled, the two-family minimum, what a role slot is — was folded
  into `index.md`.
- **No edits to `assets/plugins/**`or`.github/skills/**`.** Both untouched, so the
  byte-equality between the shipped and dev-side skill copies is unaffected and no
  `cmp` sweep is required.
- **No screenshots.** The panel is described in prose; adding images would need a
  `visual-reviewer` pass and a capture pipeline that is out of scope here.
- **Site-wide `.md` + MDX-component defect not fixed.** `tribunal/index.md` is a `.md`
  file that carries `import { Card, CardGrid } from '@astrojs/starlight/components';`
  and renders `<CardGrid>`. Plain `.md` does not process imports or components, so the
  import line renders as literal text and the cards render as raw HTML. This is **not**
  tribunal-specific — 29 other `.md` pages across the site do the same thing. Fixing it
  only here would make this page inconsistent with the rest of the site, and fixing it
  everywhere is its own task. The existing pattern was followed for the new Crucible
  card. **Worth filing as a follow-up.**

## Correction to the task brief

The brief stated the wizard "disables" Relay and Crucible when the `ptah-core` tribunal
skill is missing. `step-pick-move.component.ts` does **not** do that — `SKILL_DEPENDENT_MOVES`
drives an advisory badge ("Needs the tribunal skill") plus a note saying both moves
still launch and the conductor will ask for the protocol it needs. The only move ever
disabled is **Crucible**, and only when discovery reports fewer than two vendor families
(`blockedReason`). The docs describe the shipped behaviour, not the brief's version.
