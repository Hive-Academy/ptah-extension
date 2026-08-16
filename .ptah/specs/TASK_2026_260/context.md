# Context — TASK_2026_260

## Origin

TASK_2026_258 corrected the Plugins docs. Two of its lanes hit the same class of problem
and made **opposite calls** — Lane A deleted two broken image references, Lane B found two
more and kept them with a flag. The review (`TASK_2026_258/code-logic-review.md`, Moderate
Issue 3) called out the inconsistency and asked for one call; Lane C then deleted the
remaining two.

Sweeping the rest of the site afterwards showed those four were not the problem. They were
4 of 27.

## Measurements

| Measure                                                         | Count                      |
| --------------------------------------------------------------- | -------------------------- |
| Distinct `/screenshots/*.png` referenced in `src/content/docs/` | 47                         |
| Files present in `apps/ptah-docs/public/screenshots/`           | 22                         |
| Files present in `apps/ptah-docs/src/assets/screenshots/`       | **0** (directory is empty) |
| Referenced but absent everywhere                                | **27**                     |
| Pages carrying at least one `/screenshots/` reference           | 40                         |

Spot-checked `sessions-overview.png`, `settings-overview.png` and `theme-toggle.png`:
absent from both directories.

## Why the build does not catch it

`astro build` validates content-collection frontmatter and fails on bad frontmatter — that
is the gate `apps/ptah-docs/CLAUDE.md` correctly identifies. It does **not** resolve
`/screenshots/…` references in markdown, because those are plain public-directory URLs
resolved by the browser at request time, not imports the build ever touches.

Confirmed the breakage reaches production rather than being caught downstream:

```
grep -o "screenshots/sessions-overview.png" dist/apps/ptah-docs/sessions/index.html
→ screenshots/sessions-overview.png
```

The built HTML carries the `src`. Every one of these renders as a broken image.

## Sections affected

Concentrated in the pages that document UI surfaces, which is the worst place for it:
Sessions (7 refs), Agents (5), Git (4), Workspace (4), Settings, Browser Automation,
Setup, Templates. The full list of 27 is reproducible with:

```bash
for f in $(grep -rho "/screenshots/[a-z0-9-]*\.png" apps/ptah-docs/src/content/docs/ \
           | sed 's|/screenshots/||' | sort -u); do
  [ -f "apps/ptah-docs/public/screenshots/$f" ] || echo "MISSING: $f"
done
```

## Scope

**Decide the policy first — the two lanes in 258 disagreeing about it is the actual root
cause.** The options are not equivalent:

1. **Capture the 27 missing screenshots.** Best outcome, largest job, and it needs a
   capture pass against a real running app. `apps/ptah-docs/SCREENSHOTS.md` exists and
   should be read first — it may already define the convention and the shot list.
2. **Delete the 27 references.** Cheap, immediately correct, and it strips illustration
   from 40 pages including the ones where a screenshot carries most of the explanation.
3. **Mixed** — delete where the prose stands alone, capture where the image is load-bearing.
   Requires a judgment call per reference.

**In scope regardless of which option is chosen**

- A **build-time guard** so this cannot recur silently. Either
  `starlight-links-validator` (which `apps/ptah-docs/CLAUDE.md` already names as a real
  addition rather than a lost target) if it covers public assets, or a small spec that
  walks `src/content/docs/` for `/screenshots/…` references and asserts each file exists.
  Without a guard, whichever option is chosen decays again.

**Out of scope**

- Rewriting the prose around the images.
- The `ptah-core` 8-vs-7 skill count and the docs↔manifest drift gate — both belong to
  TASK_2026_258's follow-ups, not here.

## Note

Do not fix this by deleting references without checking `SCREENSHOTS.md` first. If a
capture pipeline already exists, option 2 throws away work that only needs re-running.
