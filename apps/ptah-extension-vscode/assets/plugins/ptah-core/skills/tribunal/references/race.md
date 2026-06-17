# Race — compete & verify

Run N attempts at the **same change**, score them on a **fixed rubric**, and **verify the top attempt before any commit**. Losers are never committed. Race trades Forge's cross-review for speed + a hard verification gate — reach for it on high-stakes single changes where you want one correct, proven result rather than a debate.

Read [vendor-panel.md](vendor-panel.md) first, and note that Race shares Forge's worktree isolation — see [forge.md](forge.md) for the worktree mechanics.

> **Race changes files and can commit.** The verification gate is the safety contract: nothing lands unless it passes. Still never auto-merge to `main`.

---

## Race vs Forge

|              | Forge                           | Race                                                     |
| ------------ | ------------------------------- | -------------------------------------------------------- |
| Middle round | Round-robin cross-vendor review | None — straight to scoring                               |
| Decision     | Judge ranks using peer reviews  | Fixed rubric score + hard verify gate                    |
| Commit       | Winner merged after user sight  | Top attempt committed only if it **passes verification** |
| Best for     | Best implementation of a spec   | A correct, proven result, fast                           |

## Panel composition

By default Race uses **distinct vendors** (diversity — best shot from each family). Alternatively, run the **same vendor at a temperature/seed spread** for N independent attempts of one model — say which you want; default to distinct vendors.

## Flow

```
discover panel → announce + fix the rubric → worktree per attempt → parallel implement → score → verify top → commit or fall through → cleanup
```

### Step 1 — Announce & fix the rubric

Build the panel/attempts (vendor-panel.md §1–2). Define the **rubric up front** and show it to the user — it must be objective. Default rubric:

- meets the acceptance criteria,
- tests pass,
- no type/lint errors,
- handles the edge cases named in the brief,
- minimal/simple (no gratuitous churn).

Announce the attempts and cost, get the go-ahead (this writes code and may commit).

### Step 2 — Isolated parallel attempts

One worktree per attempt (forge.md §2): `ptah_git_worktree_add({ branch: "tribunal/race/<slug>/<attempt>", createBranch: true })`, spawn each with the same self-contained task + the rubric + `workingDirectory` set to its worktree. Poll and read each; resume where supported, respawn codex, drop an attempt that fails twice.

### Step 3 — Score against the rubric

Score every attempt on each rubric item (you, the judge — fan out per-attempt scoring with the `Agent`/`Task` tool for large fields). Produce a ranked table. Optionally have a second vendor co-score for independence. Rank by total; break ties by simplicity.

### Step 4 — Verify the top attempt (the gate)

Run the project's verification on the **top-ranked** attempt **in its worktree** — the `/verify` flow or the test/build/lint commands the rubric named.

- **Green** → proceed to commit.
- **Red** → drop it, move to the **next-ranked** attempt, verify again. Repeat down the ranking.
- **All fail** → commit nothing; report the ranked attempts and their failures so the user can decide.

Never commit an unverified or losing attempt.

### Step 5 — Commit → cleanup

- On a verified winner: commit/merge its branch onto the user's **active** branch (never `main`), after showing the diff + the rubric scorecard.
- **Cleanup:** `ptah_git_worktree_remove({ path, force: true })` for every attempt; confirm with `ptah_git_worktree_list`. Keep loser branches only if the user asks (audit).

---

## Guidance

- **The rubric must be objective and fixed before attempts run** — a rubric written after seeing the code is not a fair contest.
- **Verification is non-negotiable.** Race's value is "proven, not just plausible". If the project has no runnable verification for the change, say so and prefer Forge (peer review) instead.
- **Distinct vendors by default**; same-vendor temperature spread only when the user wants N shots from one model.
- **Cleanup always**, even when everything fails — leave the repo clean and confirm with `ptah_git_worktree_list`.
