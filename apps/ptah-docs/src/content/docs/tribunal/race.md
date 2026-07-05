---
title: Race
description: N attempts at the same change, scored on a fixed rubric, with the top attempt verified before any commit.
---

# Race

Race runs N attempts at the **same change**, scores each on a **fixed rubric**, and **verifies the top attempt before anything is committed**. Losing attempts are never committed. It trades Forge's cross-review for raw speed plus a hard verification gate — the move for high-stakes single changes where you want one correct, _proven_ result.

## Race vs Forge

|              | [Forge](/tribunal/forge/)       | Race                                           |
| ------------ | ------------------------------- | ---------------------------------------------- |
| Middle step  | Round-robin cross-vendor review | None — straight to scoring                     |
| Decision     | Judge ranks using peer reviews  | Fixed rubric + hard verification gate          |
| What commits | Winner, after you see the diffs | Top attempt **only if it passes verification** |
| Best for     | Best implementation of a spec   | A correct, proven result, fast                 |

## Panel composition

By default Race uses **distinct vendors** — the best shot from each family. You can instead run the **same vendor across several independent attempts** (a temperature/seed spread) if you want N tries from one model. Say which you prefer; the default is distinct vendors.

## How it runs

### Phase 1 — Fix the rubric

The rubric is defined and shown to you **before any attempt runs** — it must be objective. A typical rubric: meets the acceptance criteria, tests pass, no type/lint errors, handles the named edge cases, and stays simple (no gratuitous churn).

### Phase 2 — Parallel attempts

Each attempt runs in its own isolated git worktree (the same isolation [Forge](/tribunal/forge/) uses), implementing the task against the rubric. No attempt sees the others.

### Phase 3 — Score & verify

Every attempt is scored against the rubric and ranked. The **top-ranked** attempt is then verified — the test/build/lint flow the rubric named is run against it in its worktree:

- **Passes** → it's committed to your active branch (after you see the diff and scorecard).
- **Fails** → it's dropped and the next-ranked attempt is verified, and so on down the ranking.
- **All fail** → nothing is committed; you get the ranked attempts and their failures to decide.

## Safety

- **Verification is the contract** — nothing lands unless it passes the rubric's checks.
- **Never commits to `main`** — verified winners land on your active branch only, after you've seen the diff.
- **Worktrees are cleaned up** at the end; losing attempts are never committed.

## Invoking Race

**Natural language triggers:**

- "Race the vendors on this"
- "Best verified attempt at X"
- "Have the models compete and commit the one that passes"

**Explicit harness**: select **Tribunal Conductor** from the harness picker, then describe the change and (optionally) the rubric.

## Limitations

- **Needs runnable verification** — Race's value is "proven, not just plausible". If there's no test/build/lint that can verify the change, prefer [Forge](/tribunal/forge/)'s peer review instead.
- **The rubric must be fixed up front** — a rubric written after seeing the code isn't a fair contest.
- **Cost** — N attempts plus verification. Ptah announces the attempts and cost before spending.
