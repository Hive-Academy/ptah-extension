# Development Tasks - TASK_2026_257

**Total Tasks**: 15 | **Batches**: 5 | **Status**: 1/5 complete

**Defect**: 38 plain `.md` pages under `apps/ptah-docs/src/content/docs/` carry a
`@astrojs/starlight/components` import. Plain `.md` processes neither imports nor
components, so the import ships as literal prose and every component degrades to an
unknown lowercase element.

**Fix**: `git mv` each affected page to `.mdx` (one outlier gets its dead import deleted
instead). No content rewrites.

**Gate**: `nx build ptah-docs` — the only gate; there is deliberately no `check` target
(TASK_2026_249).

---

## Plan Validation Summary

**Validation Status**: PASSED — with the headline risk measured and largely retired

The spec framed this as "cheap per file, but wants one sweep with a build check." The
dominant unknown going in was that **MDX is stricter than Markdown**: it parses `{` as a
JS expression and `<` as JSX, so any bare brace or angle bracket in prose would hard-fail
the build on rename. That was measured across all 38 files rather than assumed.

### Assumptions Verified

| #   | Assumption                                                                                                 | Result                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Sidebar in `astro.config.mjs` addresses pages by `slug` / `autogenerate: { directory }`, never by filename | ✅ **RESOLVED — do not re-verify.** Confirmed by orchestrator. A `.md` → `.mdx` rename leaves every sidebar entry alone.                                |
| 2   | MDX support is already wired up                                                                            | ✅ `node_modules/@astrojs/mdx` present (Starlight 0.38.3 dependency); the 2 existing `.mdx` files build today. **No `astro.config.mjs` change needed.** |
| 3   | Renaming does not change page URLs                                                                         | ✅ Starlight derives the slug from the path minus extension. `tribunal/index.md` and `tribunal/index.mdx` both emit `/tribunal/`. No redirects needed.  |
| 4   | `redirects` in `astro.config.mjs` do not reference file extensions                                         | ✅ Sole entry is `'/agents/setup-wizard': '/setup/setup-wizard/'` — route-to-route, extension-free.                                                     |
| 5   | Baseline build is currently green                                                                          | ✅ `nx build ptah-docs` → **147 pages in 6.66s, exit 0**. Any post-rename failure is attributable to the rename.                                        |
| 6   | The defect is reproducible in build output                                                                 | ✅ See Evidence below.                                                                                                                                  |

### Measured: the MDX-strictness risk is far smaller than feared

All 38 files were scanned outside fenced/inline code for: bare `{`/`}`, bare `<`,
HTML comments (`<!-- -->`, unsupported in MDX — must become `{/* */}`), raw HTML tags,
unknown pseudo-tags, and true indented (4-space) code blocks — which MDX v2+ no longer
treats as code.

**Result: zero hazards.** The only brace occurrence in any of the 38 files is the import
line itself (line 6, or line 7 in `troubleshooting/filing-bugs.md`). The only angle
brackets are well-formed Starlight components. Every component used is imported, every
tag pair balanced.

**This means no escaping work is required and no batch should budget for it.** The
"some will need escaping" concern in the brief does not survive measurement.

### Risks Identified

| Risk                                                                                                                                                                                                                                                                                                                                                                              | Severity | Mitigation                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `&` unescaped inside a JSX attribute — `title="Planning & Leadership"` (`agents/index.md` ×3), `title="Pinning & forgetting"` (`memory/index.md` ×1). Valid in a JSX string literal, so expected to pass, but it is the _only_ non-uniform construct in the corpus.                                                                                                               | LOW      | Both files deliberately front-loaded into Batch 2, immediately after the pilot. Task 2.1 / 2.2.                                                                                                                                    |
| `browser-automation/index.md` imports `Aside` and **uses it zero times** — a dead import. Renaming it to `.mdx` "works" but is the wrong fix: it would leave an unused import to serve no page.                                                                                                                                                                                   | LOW      | Task 1.3 — delete the import line, keep the file as `.md`. This is the one file in the 38 that is _not_ a rename.                                                                                                                  |
| A batch-wide build failure is hard to localize across 38 files.                                                                                                                                                                                                                                                                                                                   | MED      | Batches are directory-scoped; the build is 6.66s, so the gate is cheap enough to run **per task**, not just per batch.                                                                                                             |
| Renaming changes the `editLink.baseUrl` target from `.md` to `.mdx`.                                                                                                                                                                                                                                                                                                              | NONE     | Starlight derives the edit URL from the actual file path; it follows the rename automatically. Expected, not a defect.                                                                                                             |
| **Stale Astro content-layer store yields a false FAIL.** `node_modules\.astro\data-store.json` keys entries by extension-less id and skips re-reading files whose digest is unchanged — which byte-identical renames guarantee. The page rebuilds through the old markdown path and dist assertions fail on a correct rename. **Measured in Batch 1** (two consecutive rebuilds). | MED      | Every batch MUST `rm -f apps/ptah-docs/node_modules/.astro/data-store.json` then build with `--skipNxCache` before asserting. See "The Recipe" step 3. Gitignored, so CI/clean checkouts are unaffected — local-verification only. |

### Edge Cases to Handle

- [x] Files with `{` or `<` in prose → **none exist** (measured across all 38)
- [x] HTML comments needing `{/* */}` conversion → **none exist**
- [x] Indented code blocks that would silently become prose → **none exist**
- [ ] `&` in JSX attribute values → Tasks 2.1, 2.2
- [ ] Dead import with no component usage → Task 1.3
- [ ] Tag/import balance → verified clean pre-flight; re-confirmed by the build gate

### Blockers Found

None.

---

## Evidence (reproduced against the current baseline build)

**Defect**, `dist/apps/ptah-docs/tribunal/index.html`:

```
import { Card, CardGrid } from ‘@astrojs/starlight/components   ← smart-quoted = text path
<cardgrid>
<card title="Council" icon="approve-check">     ← 5 unknown lowercase elements
```

The smart quote (`‘` for `'`) is the tell: the line went through the markdown typographer,
not the component path.

**Target state**, `dist/apps/ptah-docs/getting-started/index.html` (an existing, working `.mdx`):

```
class="card-grid astro-nndch5g5"                ← real Starlight chrome
```

Flipping the first block into the second is the definition of done for Task 1.2.

---

## The Recipe (established in Batch 1, applied verbatim in Batches 2–5)

```bash
git mv <path>.md <path>.mdx
```

That is the whole per-file change. Then:

1. **Do not touch file content.** No frontmatter edits, no prose edits, no import edits.
   (Sole exception: Task 1.3, which deletes one dead import line.)
2. **Do not touch `astro.config.mjs`.** Sidebar, redirects, and MDX wiring are all
   already correct.
3. **Bust the content-layer cache, then build.** From `D:\projects\ptah-extension`:

   ```bash
   rm -f apps/ptah-docs/node_modules/.astro/data-store.json
   npx nx build ptah-docs --skipNxCache
   ```

   Exit 0 required.

### ⚠️ MANDATORY before any dist assertion — the stale-store trap

**Measured in Batch 1.** A plain `npx nx build ptah-docs` after a rename can rebuild the
page through the _old markdown path_, producing a false FAIL: the built HTML still shows
the literal import, `<cardgrid>`, and lowercase `<card >`, and the Starlight edit link
still points at `.md`.

Cause: Astro's content-layer store keys entries by **extension-less id** (`tribunal/index`)
and skips re-reading a file whose content digest is unchanged. This recipe mandates
byte-identical content, so the digest always matches and the stale `.md` entry is reused.

- The store that matters is `apps\ptah-docs\node_modules\.astro\data-store.json` (build-time).
- Deleting only `apps\ptah-docs\.astro\data-store.json` (dev-mode) does **nothing**.
- Both stores are gitignored → **local-verification hazard only**. CI and clean checkouts
  are unaffected. This is not a defect in the recipe and needs no code change.

Batch 1 hit this on two consecutive rebuilds before diagnosing it. Run the two commands
above every time, or you will report a passing rename as broken.

Reference for the correct shape of a working page:
`D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\getting-started\index.mdx`

---

## Batch 1: Pilot — prove the recipe end-to-end ✅ COMPLETE

**Commit**: _(recorded below after commit)_
**Recommended Executor**: `frontend-developer` (sub-agent)
**Fallback Executor**: `general-purpose`
**Execution Mode**: sequential
**Rationale**: CLI delegation is disabled for this task. The pilot must establish the
per-file recipe and prove it against built HTML before 37 more files inherit it — that is
inherently sequential and judgement-bearing, not mechanical. One executor, one batch.
**Tasks**: 3 | **Dependencies**: None

### Task 1.1: Rename the evidence page `tribunal/index.md` → `.mdx` ✅ COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\tribunal\index.md`
**Spec Reference**: context.md — "The defect", "Watch for"
**Pattern to Follow**: `D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\getting-started\index.mdx`

**Quality Requirements**:

- Use `git mv` so history follows the file. Not delete-then-create.
- Zero content changes. The file's bytes must be identical before and after.
- `npx nx build ptah-docs` exits 0.

**Validation Notes**:

- This page is the one in the original defect report: 12 component tags, `Card, CardGrid`.
- It contains no braces or angle brackets beyond the import and its own components — no
  escaping needed.

**Implementation Details**:

- Imports: `import { Card, CardGrid } from '@astrojs/starlight/components';` (line 6) — leave as-is.
- The import only becomes _live_ because of the extension change. That is the entire fix.

---

### Task 1.2: Prove the fix in built HTML ✅ COMPLETE

**File**: `D:\projects\ptah-extension\dist\apps\ptah-docs\tribunal\index.html` (build artifact — inspect, do not edit)
**Dependencies**: Task 1.1
**Spec Reference**: context.md — "Confirmed in build output, not inferred"

**Quality Requirements** — after rebuilding, assert ALL of:

- The literal import paragraph is **gone**: no `import { Card, CardGrid }` text anywhere
  in the HTML body.
- No lowercase unknown elements remain: zero `<cardgrid>`, zero `<card ` occurrences.
- Real chrome renders: `class="card-grid` present, and Starlight card markup present.
- Every `icon=` resolves to a rendered SVG rather than an unknown attribute — spot-check
  that the page contains inline `<svg` inside the card markup.

**Validation Notes**:

- The spec's evidence was gathered exactly this way, so the fix must be proven the same way.
- Compare against the known-good control: `D:\projects\ptah-extension\dist\apps\ptah-docs\getting-started\index.html`.
- **If any assertion fails, STOP.** Do not proceed to Batch 2 — the recipe is wrong and
  37 files should not inherit it.

---

### Task 1.3: Delete the dead import in `browser-automation/index.md` (do NOT rename) ✅ COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\browser-automation\index.md`
**Dependencies**: None (independent of 1.1/1.2, but batched here as the recipe's one exception)

**Quality Requirements**:

- Delete **only** line 6: `import { Aside } from '@astrojs/starlight/components';`
- Delete the now-orphaned blank line if it leaves two consecutive blanks.
- **Keep the `.md` extension.** Do not rename this file.
- `npx nx build ptah-docs` exits 0.

**Validation Notes**:

- Measured: this file imports `Aside` and uses it **zero** times. It is the only one of the
  38 in this state.
- Renaming it would produce a valid but pointless `.mdx` carrying an unused import.
  Deleting the line is the correct minimal fix and still removes the stray literal
  paragraph from the rendered page — which is the user-visible half of the defect.
- Verify afterwards that `dist\apps\ptah-docs\browser-automation\index.html` no longer
  contains the literal `import { Aside }` text.

---

**Batch 1 Verification**:

- `tribunal/index.mdx` exists; `tribunal/index.md` does not; `git status` shows a rename (R).
- `browser-automation/index.md` still `.md`, import line gone.
- `npx nx build ptah-docs` exits 0, still reports 147 pages.
- Task 1.2 assertions all pass.
- code-logic-reviewer approved.

---

## Batch 2: Card/CardGrid hub pages — high tag density + the `&` risk 🔄 IN PROGRESS

**Recommended Executor**: `frontend-developer` (sub-agent)
**Fallback Executor**: `general-purpose`
**Execution Mode**: sequential
**Rationale**: CLI delegation disabled. These four are the densest component pages (6–20
tags each) and hold both instances of the only measured attribute-level risk (`&` in a JSX
attribute). Front-loading them means the single remaining unknown is resolved on task 4 of
15, not task 30. Sequential so a failure attributes to one file.
**Tasks**: 4 | **Dependencies**: Batch 1 (recipe proven)

### Task 2.1: `agents/index.md` → `.mdx` 🔄 IN PROGRESS

**File**: `D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\agents\index.md`

**Quality Requirements**: `git mv`, zero content changes, build exits 0.

**Validation Notes**:

- **Highest-risk file in the corpus.** 20 component tags — the most of any page.
- Carries **3 of the 4** `&`-in-attribute instances: `title="Planning & Leadership"`
  (line 29), `title="Quality & Review"` (line 35), `title="Research & Design"` (line 38).
- Expected to build clean — `&` is legal in a JSX string-literal attribute. If MDX _does_
  reject it, escape to `&amp;` in the attribute value only, and report it so Task 2.2
  applies the same treatment.

---

### Task 2.2: `memory/index.md` → `.mdx` 🔄 IN PROGRESS

**File**: `D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\memory\index.md`
**Dependencies**: Task 2.1 (inherits the `&` verdict)

**Quality Requirements**: `git mv`, zero content changes, build exits 0.

**Validation Notes**: 10 component tags. Holds the 4th `&` instance:
`title="Pinning & forgetting"` (line 35).

---

### Task 2.3: `git/index.md` → `.mdx` 🔄 IN PROGRESS

**File**: `D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\git\index.md`

**Quality Requirements**: `git mv`, zero content changes, build exits 0.

**Validation Notes**: 12 component tags, `Card, CardGrid`. No measured hazards.

---

### Task 2.4: `automation/index.md` → `.mdx` 🔄 IN PROGRESS

**File**: `D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\automation\index.md`

**Quality Requirements**: `git mv`, zero content changes, build exits 0.

**Validation Notes**: 6 component tags, `Card, CardGrid`. No measured hazards.

---

**Batch 2 Verification**:

- 4 renames staged as renames (`git status --short` shows `R`).
- `npx nx build ptah-docs` exits 0.
- Spot-check `dist\apps\ptah-docs\agents\index.html`: no `<card `, `class="card-grid` present,
  and the `&` titles render as `Planning & Leadership` (not `&amp;` doubled, not broken).

---

## Batch 3: Card/CardGrid hub pages — remainder ⏸️ PENDING

**Recommended Executor**: `frontend-developer` (sub-agent)
**Fallback Executor**: `general-purpose`
**Execution Mode**: sequential
**Rationale**: CLI delegation disabled. Same page class as Batch 2 with the risky
attributes already cleared, so this is a clean mechanical sweep. Kept separate from
Batch 2 so the `&` verdict lands in its own commit and can be reverted independently.
**Tasks**: 3 | **Dependencies**: Batch 2

### Task 3.1: `sessions/index.md` → `.mdx` ⏸️ PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\sessions\index.md`
**Validation Notes**: 14 component tags, `Card, CardGrid`. No measured hazards.

### Task 3.2: `workspace/index.md` → `.mdx` ⏸️ PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\workspace\index.md`
**Validation Notes**: 16 component tags, `Card, CardGrid`. No measured hazards.

### Task 3.3: `skill-synthesis/index.md` → `.mdx` ⏸️ PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\skill-synthesis\index.md`
**Validation Notes**: 14 component tags, `Card, CardGrid`. No measured hazards. Note this
is the _only_ `Card/CardGrid` page in `skill-synthesis/` — its five siblings are `Aside`
pages handled in Batch 5.

---

**Batch 3 Verification**:

- 3 renames staged as renames.
- `npx nx build ptah-docs` exits 0.
- All 8 `Card/CardGrid` hub pages now `.mdx`; zero `<card ` in `dist\apps\ptah-docs\`.

---

## Batch 4: `Aside` sweep A — browser-automation, reference, settings ⏸️ PENDING

**Recommended Executor**: `frontend-developer` (sub-agent)
**Fallback Executor**: `general-purpose`
**Execution Mode**: sequential
**Rationale**: CLI delegation disabled. 16 files, all identical single-`Aside` renames
with zero measured hazards, so one executor sweeping directory by directory is the lowest
overhead. Grouped one task per content directory so a build failure localizes to a
directory rather than to a set of 16.
**Tasks**: 3 | **Dependencies**: Batch 3

### Task 4.1: `browser-automation/` — rename 7 `Aside` pages ⏸️ PENDING

**Directory**: `D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\browser-automation\`

**Files** (`git mv` each `.md` → `.mdx`):

- `interacting.md`
- `launching-a-browser.md`
- `navigation.md`
- `network-monitoring.md`
- `reading-content.md`
- `recording.md`
- `screenshots.md`

**Validation Notes**:

- **Do NOT rename `index.md` in this directory** — it was fixed by deleting its dead import
  in Task 1.3 and must stay `.md`.
- Each file: 1 `<Aside>` pair, import on line 6. No measured hazards.

### Task 4.2: `reference/` — rename 2 `Aside` pages ⏸️ PENDING

**Directory**: `D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\reference\`

**Files**: `keyboard-shortcuts.md`, `tier-comparison.md`

**Validation Notes**: 1 `<Aside>` pair each. No measured hazards.

### Task 4.3: `settings/` — rename 7 `Aside` pages ⏸️ PENDING

**Directory**: `D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\settings\`

**Files**: `api-keys.md`, `autopilot.md`, `global-settings.md`, `import-export.md`,
`index.md`, `why-not-package-json.md`, `workspace-settings.md`

**Validation Notes**:

- All 7 `.md` files in this directory are affected — the whole directory converts.
- `index.md` here **does** use `Aside` and **does** get renamed (unlike
  `browser-automation/index.md`).

---

**Batch 4 Verification**:

- 16 renames staged as renames.
- `npx nx build ptah-docs` exits 0.
- `browser-automation/index.md` still `.md`.
- Spot-check one built page per directory: no literal `import { Aside }` paragraph, and
  the Starlight aside chrome (`class="starlight-aside`) is present.

---

## Batch 5: `Aside` sweep B — skill-synthesis, troubleshooting ⏸️ PENDING

**Recommended Executor**: `frontend-developer` (sub-agent)
**Fallback Executor**: `general-purpose`
**Execution Mode**: sequential
**Rationale**: CLI delegation disabled. The last 13 files, same mechanical shape as
Batch 4. Two tasks rather than the usual 3–5 because there are exactly two directories
left and splitting a directory would make a build failure _harder_ to localize, not
easier — the deviation is deliberate.
**Tasks**: 2 | **Dependencies**: Batch 4

### Task 5.1: `skill-synthesis/` — rename 5 `Aside` pages ⏸️ PENDING

**Directory**: `D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\skill-synthesis\`

**Files**: `background-learning.md`, `how-it-works.md`, `reviewing-candidates.md`,
`skill-md-anatomy.md`, `the-skills-tab.md`

**Validation Notes**:

- `index.md` in this directory was already converted in Task 3.3 — skip it.
- `how-it-works.md` has 6 `Aside` tags (3 pairs); the rest have 1 pair each.
- `skill-md-anatomy.md` is referenced by explicit `slug: 'skill-synthesis/skill-md-anatomy'`
  in `astro.config.mjs` line 95. The slug is extension-free, so the rename is safe — this
  is the closest the sidebar comes to naming a file, and it still does not.

### Task 5.2: `troubleshooting/` — rename 8 `Aside` pages ⏸️ PENDING

**Directory**: `D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\troubleshooting\`

**Files**: `cli-agent-not-detected.md`, `filing-bugs.md`, `index.md`, `license-issues.md`,
`logs-and-diagnostics.md`, `mcp-port-conflicts.md`, `session-import-problems.md`,
`workspace-analysis-failures.md`

**Validation Notes**:

- All 8 `.md` files in this directory are affected — the whole directory converts.
- `filing-bugs.md` has its import on **line 7**, not line 6, unlike every other file.
  Cosmetic only; the rename is identical.

---

**Batch 5 Verification**:

- 13 renames staged as renames.
- `npx nx build ptah-docs` exits 0 and still reports **147 pages** (count must not drift —
  a drop means a page stopped being discovered).
- **Site-wide final sweep**, from `D:\projects\ptah-extension`:
  - Zero `.md` files under `apps\ptah-docs\src\content\docs\` contain
    `@astrojs/starlight/components`.
  - Zero occurrences of `<card`, `<cardgrid`, or `<aside title` (lowercase unknown
    elements) anywhere under `dist\apps\ptah-docs\`.
  - Zero literal `starlight/components` import paragraphs anywhere under `dist\apps\ptah-docs\`.

---

## Out of Scope (do NOT create work for these)

- Rewriting the content of any page.
- Adding `starlight-links-validator` — a real addition, separate concern
  (`apps/ptah-docs/CLAUDE.md`).
- Any file outside `apps/ptah-docs/`.
- Any change to `astro.config.mjs` — validated as unnecessary.
- Restoring an `astro check` target — deliberately removed by TASK_2026_249.

---

## Final Tally

| Batch                       | Files                          | Mode    | Cumulative |
| --------------------------- | ------------------------------ | ------- | ---------- |
| 1 — Pilot                   | 2 (1 rename + 1 import delete) | 3 tasks | 2 / 38     |
| 2 — Card/CardGrid + `&`     | 4 renames                      | 4 tasks | 6 / 38     |
| 3 — Card/CardGrid remainder | 3 renames                      | 3 tasks | 9 / 38     |
| 4 — Aside sweep A           | 16 renames                     | 3 tasks | 25 / 38    |
| 5 — Aside sweep B           | 13 renames                     | 2 tasks | 38 / 38    |

**End state**: 37 files renamed `.md` → `.mdx`, 1 file (`browser-automation/index.md`)
keeps `.md` with its dead import removed. Site becomes 107 `.md` + 39 `.mdx`.
