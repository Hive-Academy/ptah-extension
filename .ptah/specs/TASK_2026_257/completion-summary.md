# Completion Summary — TASK_2026_257

**Status**: ALL BATCHES COMPLETE
**Branch**: `ak/tui-defects`
**Totals**: 15 tasks across 5 batches (Batches 3–5 collapsed into one execution pass) → 3 commits

---

## Commits

| Batch | Commit      | Subject                                                                     |
| ----- | ----------- | --------------------------------------------------------------------------- |
| 1     | `1062fda2a` | fix(docs): give the tribunal page an extension that runs its imports        |
| 2     | `f7663b861` | fix(docs): give the four card hub pages extensions that run their imports   |
| 3–5   | `4b50309b6` | fix(docs): give the last thirty-two pages extensions that run their imports |

Two unrelated commits from a concurrent session (`5c9094f12`, `10d49d43a`) are
interleaved between Batch 1 and Batch 2 in the branch history. See "Git forensics" below.

---

## End state

**Verified by direct count under `apps/ptah-docs/src/content/docs/`, not by prediction:**

- `.md` files: **107**
- `.mdx` files: **39**

That matches the plan's projected 107 / 39 exactly.

- **37 files renamed** `.md` → `.mdx` (1 in Batch 1, 4 in Batch 2, 32 in the collapsed 3–5 pass).
- **1 file kept as `.md`** — `apps/ptah-docs/src/content/docs/browser-automation/index.md`.
  It imported `Aside` and used it zero times. Renaming it would have produced a valid but
  pointless `.mdx` carrying a dead import, so Batch 1 deleted the import line instead. This
  is the only content edit in the entire task.
- **Every other change is a pure rename.** All 32 files in the final commit landed at
  `R100` / `(100%)` similarity — `git diff --cached --numstat` reported `0 0` for all 32.
- `astro.config.mjs` was **not touched** at any point (`git diff HEAD` against it is empty),
  as the validation pass predicted: the sidebar addresses pages by extension-free `slug`
  and `autogenerate: { directory }`, never by filename.

---

## What the fix proved in built HTML

The defect and the fix were both confirmed in `dist/`, never inferred.

**Before** — `dist/apps/ptah-docs/tribunal/index.html`:

```
import { Card, CardGrid } from ‘@astrojs/starlight/components   ← smart-quoted = text path
<cardgrid>
<card title="Council" icon="approve-check">                     ← unknown lowercase elements
```

The smart quote (`‘` for `'`) is the tell: the import line went through the markdown
typographer rather than the component path, because plain `.md` processes neither imports
nor components.

**After** — full-site sweep against a cache-busted rebuild:

| Assertion                                                          | Result  |
| ------------------------------------------------------------------ | ------- |
| `nx build ptah-docs --skipNxCache` exit code                       | **0**   |
| Pages built (must not drift from the 147-page baseline)            | **147** |
| `.md` files under `content/docs/` importing `starlight/components` | **0**   |
| Literal `starlight/components` anywhere under `dist/`              | **0**   |
| Lowercase `<card`, `<cardgrid`, `<aside title` under `dist/`       | **0**   |

Absence of the defect is not sufficient evidence, so the sweep was paired with positive
rendering checks confirming the components actually mount:

| Positive assertion                               | Result                                          |
| ------------------------------------------------ | ----------------------------------------------- |
| Pages emitting real `card-grid` Starlight chrome | **9**                                           |
| Pages emitting real `starlight-aside` chrome     | **118**                                         |
| `skill-synthesis/how-it-works` aside containers  | **3**, matching its 3 `<Aside>` pairs in source |

Per-directory spot checks confirmed `sessions/`, `workspace/` and `skill-synthesis/`
indexes emit `card-grid`, and `settings/`, `troubleshooting/`, `reference/` and
`browser-automation/` emit `starlight-aside`.

---

## For the reviewer and the next task

### 1. The content-layer cache hazard — read this before verifying any future rename in this app

This is the single most valuable thing the task learned, and it will bite anyone who
verifies a byte-identical rename in `ptah-docs`.

Astro's content-layer store keys entries by **extension-less id** (`tribunal/index`) and
skips re-reading any file whose content digest is unchanged. A `.md` → `.mdx` rename is
byte-identical by design, so the digest always matches, the stale `.md` entry is reused,
and the page rebuilds **through the old markdown path**. The built HTML then still shows
the literal import and the lowercase elements — a **false FAIL on a correct rename**.

- The store that matters at build time is `apps/ptah-docs/node_modules/.astro/data-store.json`.
- Deleting only `apps/ptah-docs/.astro/data-store.json` (the dev-mode store) does **nothing**.
- Both are gitignored, so this is a **local-verification hazard only**. CI and clean
  checkouts are unaffected; no code change is warranted.

Always bust the store before asserting against `dist/`:

```bash
rm -f apps/ptah-docs/node_modules/.astro/data-store.json
npx nx build ptah-docs --skipNxCache
```

Batch 1 hit this on two consecutive rebuilds before diagnosing it.

### 2. The MDX-strictness risk was measured away, not accepted

The brief warned that MDX parses `{` as a JS expression and `<` as JSX, so bare braces or
angle brackets in prose would hard-fail the build. All 38 files were scanned outside
fenced/inline code for bare braces, bare `<`, HTML comments (`<!-- -->`, unsupported in
MDX), raw HTML tags and 4-space indented code blocks. **Zero hazards found**, and the
build confirmed it: **no escaping was needed anywhere, in any batch**.

The one non-uniform construct — bare `&` inside a JSX attribute, as in
`title="Planning & Leadership"` (3× in `agents/index.mdx`, 1× in `memory/index.mdx`) —
was deliberately front-loaded into Batch 2 to resolve it early. **Verdict: no change
needed.** MDX accepts bare `&` in a string-literal attribute and the built HTML renders
`Planning & Leadership` with zero doubled `&amp;amp;`.

That verdict is what justified collapsing Batches 3–5: the isolating commit had nothing
left to isolate.

### 3. There is no `astro check` gate

`nx build ptah-docs` is the only gate, deliberately — the `check` target was removed by
TASK_2026_249. Do not add one as a side effect of reviewing this work.

### 4. Explicitly out of scope

Content rewrites, adding `starlight-links-validator`, any file outside `apps/ptah-docs/`,
and any `astro.config.mjs` change. None were performed.

---

## Git forensics — the vanishing `libs/backend/**` changes

The developer reported that `libs/backend/**` modifications present in the session-start
git snapshot were gone by the time the collapsed pass began. **Investigated as requested;
nothing was restored, reverted, or otherwise touched.**

**Finding: the work was committed by a concurrent session, not lost.** `git stash list` is
empty, so nothing was stashed. The files surface in two commits authored by the repo owner
and timestamped `2026-08-16 17:17`, landing between our Batch 1 and Batch 2:

- **`5c9094f12`** — _fix(auth-providers): make an unservable model id say so in the log_
  Carries `libs/backend/auth-providers/src/lib/auth/model-resolver.ts` (+ spec),
  `libs/backend/skill-synthesis/**` lane-resolver and model-resolver changes, and the
  `TASK_2026_250` / `TASK_2026_262` spec files.

- **`10d49d43a`** — _fix(platform-core): stop exporting a model key nothing reads_
  Carries exactly the files from the session-start snapshot:
  `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts` (+ the then-untracked
  `settings-export.types.spec.ts`), `libs/backend/platform-core/src/file-settings-keys.ts`
  and its `.spec.ts`.

**Conclusion: no data loss.** Both belong to TASK_2026_250 follow-up work owned by another
session. Because the concurrent process was observed staging files mid-task, every commit
in this task staged **explicitly by pathspec** and never used `git add -A`. The final
commit staged exactly 33 paths (32 renames + `tasks.md`); the unrelated working-tree
changes under `.ptah/specs/TASK_2026_242/` were left untouched and remain uncommitted.

---

## Verification checklist

- [x] 32 renames confirmed at `R100`, zero content drift (`numstat` = `0 0` for all)
- [x] No unstaged drift in `apps/ptah-docs` at commit time
- [x] `astro.config.mjs` untouched
- [x] `browser-automation/index.md` still `.md`, dead import gone
- [x] Cache-busted `--skipNxCache` build: exit 0, 147 pages
- [x] Site-wide negative sweep clean (0 / 0 / 0)
- [x] Positive rendering confirmed per directory
- [x] Real `.md` / `.mdx` counts verified by direct count: 107 / 39
- [x] Pre-commit hooks passed on all commits — none bypassed
- [x] Foreign working-tree state preserved, not staged
