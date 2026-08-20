---
title: Crucible
description: A cheap, fast lane writes the code; a stronger lane from a different vendor family grades it against a rubric frozen before the run and hands back numbered defects. The loop repeats until it passes, or until the round cap stops it.
---

# Crucible

Crucible puts one task through a **deliberately unequal loop**. A cheap, fast lane — the **executor** — writes the code. A stronger lane from a **different vendor family** — the **judge** — reads it, scores it against a rubric you wrote before the run started, and hands back numbered defects. The executor revises. Repeat until the judge returns `PASS`, the executor stops improving, or the round cap runs out.

Every other Tribunal move treats its lanes as peers answering the same prompt. Crucible does the opposite on purpose: the asymmetry is what makes the economics work. A cheap model gets a well-specified task roughly 80% right, and a strong reviewer can close the rest in two rounds — for a fraction of what running the strong model end to end would cost.

:::caution[Crucible changes files]
The executor writes code in place on your active branch. The judge never writes product code — it may write its report and nothing else. Nothing is committed without you seeing the diff.
:::

## When to use Crucible

- **The quality bar can be written down in advance.** If you can state 3–7 conditions that are either met or not, Crucible can grade against them.
- **The work is well-specified but fiddly** — the kind of change where the hard part is care and completeness, not judgment.
- **You want an independent reviewer, not a self-check.** The judge did not write the code and cannot fix it, so its findings are evidence rather than a rationalization.

## When not to use it

- **The bar cannot be written down.** If you are still deciding what "good" means, that is a [Council](/tribunal/council/), not a Crucible.
- **You want competing designs.** Crucible converges on one implementation. For several independent attempts, use [Forge](/tribunal/forge/) or [Race](/tribunal/race/).
- **The task is small enough for one good lane.** A single-call change does not repay the cost of a judge, and the loop's overhead is real.

## Crucible vs. the other moves

|                | Council / Forge / Race      | [Relay](/tribunal/relay/)      | Crucible                                 |
| -------------- | --------------------------- | ------------------------------ | ---------------------------------------- |
| **Lane roles** | Peers, same prompt          | One phase each, sequential     | Executor vs. judge — unequal on purpose  |
| **Shape**      | Parallel panel              | Linear pipeline, one pass      | A loop, until PASS or the cap            |
| **Signal**     | Disagreement between equals | Specialization plus one review | Convergence under an independent bar     |
| **Ends when**  | The verdict is synthesized  | The review phase is written    | PASS, the cap, a REJECT, or a regression |

## How it runs

### Step 1 — Write the rubric, then freeze it

Before anything is spawned, the bar is written down: 3–7 criteria, each with a condition that is either met or not, and a note on who checks it — the judge reading the diff, or the build. Typical criteria are the acceptance criteria themselves, type safety, validation at new boundaries, a test that failed before and passes after, and scope discipline.

**The rubric is frozen after round 1.** Adding criteria mid-loop moves the goalposts, and a loop with moving goalposts never terminates. Anything new the judge notices lands in the final summary as a follow-up, not in this round's bar.

### Step 2 — The executor writes

The executor lane gets the task, the acceptance criteria, and the rubric **verbatim** — it is being graded on it, so it gets to see it. It writes code in place, does not commit, and does not touch files outside the stated scope.

### Step 3 — The judge grades

The judge lane gets the acceptance criteria, the rubric, and the executor's diff, plus a strict instruction set: you are reviewing another vendor's work, you did not write it, and you may not edit anything. It returns one of three verdicts:

- **`PASS`** — every criterion met, no blocking or major defects.
- **`REVISE`** — the approach is sound but defects remain. The loop continues.
- **`REJECT`** — the approach itself is wrong. Nothing gets patched; the task is re-specified, the executor lane is swapped, or the run stops.

Two rules make the judge's output worth paying for:

**Every defect must cite `file:line`.** A defect with no location is discarded before it ever reaches the executor. Without that rule, a hallucinated nitpick buys a paid revise round.

**Every round ends with a mentor note** — five lines or fewer naming the _pattern_ behind the defects, not just the symptoms. This is what separates Crucible from an ordinary review round: hand a cheap model a list of symptoms and it fixes symptoms. Name the underlying mistake and round 2 is genuinely better than round 1 instead of merely different.

### Step 4 — Revise, up to the cap

On `REVISE` the executor is resumed with the defect list and the mentor note verbatim, plus an instruction to fix those defects and refactor nothing else.

The loop is bounded three ways, and all three matter:

- **A round cap of 2 revise rounds**, set in the wizard before launch. At the cap the run stops and reports whatever defects are still open. A third round happens only if you explicitly ask for one mid-run — never a fourth.
- **A regression stop.** If the defect count did not go down _and_ the severity mix did not improve versus the previous round, the executor is not converging and the loop stops rather than spending another round going backwards.
- **A hard stop on `REJECT`.** A rejected approach is never fed back for patching.

### Step 5 — Verify, because a PASS is not proof

**The judge's `PASS` is an opinion; the build is the fact.** On `PASS`, the conductor runs the project's typecheck, tests, and lint before presenting anything. If they go red, that is a defect the judge missed, and it goes back for one more round with the real failure output attached.

Then you see the diff. Nothing is committed without you, and nothing is ever merged to `main`.

## Launching from the Tribunal panel

Crucible is launchable from the **Tribunal panel** — the same place as every other move — as well as from chat. From the dashboard, choose **Convene a Tribunal** and the wizard walks four steps:

1. **Move** — pick Crucible.
2. **Roster** — two role slots, `Executor` and `Judge`, each with a vendor and a model. The roster is validated as you fill it, and two rules block launch outright: an unfilled slot, and an executor and judge from the **same vendor family**. A lane grading its own output is not a signal, and on round 2 it would be grading work it effectively authored.
3. **Rubric** — the rubric text, prefilled with a sensible starting table and fully editable, plus the revise-round cap. The rubric cannot be empty; the judge would have nothing to grade against.
4. **Run** — a rough paid-turn estimate and the launch button. Type your objective in the conductor chat to start the run.

Once running, the panel shows a **verdict readout** above the lane tiles: the current round out of the cap, the latest verdict as a chip, and every judged round expanded with its defects — each with a severity, its `file:line` citation, what is wrong, and what correct looks like — followed by that round's mentor note. When the loop ends, a banner states which of the four honest stopping conditions it hit: a PASS (labelled as the judge's opinion, pending the build), the cap reached with defects still open, a REJECT, or a regression stop.

A verdict that was never written and a verdict that could not be parsed both read as **"awaiting verdict"**. Neither is ever shown as a pass.

:::note[Crucible needs two vendor families]
Crucible cannot run with fewer than two independent vendor families — there is no independent judge to be had. The wizard disables the Crucible card in that case and offers a shortcut to configure another provider. Everything else on the panel is unaffected.
:::

:::tip[The tribunal skill]
Crucible and [Relay](/tribunal/relay/) are the two **role** moves, and their protocol lives in the `tribunal` skill that ships with the `ptah-core` plugin. If that skill is not installed, the wizard flags it — both moves still launch, and the conductor will ask for the protocol it needs, but they run best with the skill present.
:::

## Invoking from chat

Natural-language triggers:

- "Run this as a crucible"
- "Cheap model writes it, a stronger one grades it"
- "Have one vendor implement this and another judge it against a rubric"

**Explicit harness**: select **Tribunal Conductor** from the harness picker, then describe the task and the bar it has to clear.

## Cost

Crucible costs **2 paid calls per round** — one executor, one judge — across the first pass plus each revise round, so a default run with a cap of 2 is roughly six vendor calls plus the conductor's own turns. The wizard shows an estimate before you launch, and the conductor announces the lanes, the cap, and the cost before it spends anything.

Rounds are strictly sequential: the judge cannot score work that is still being written.

## Limitations

- **A vague task produces a vague rubric**, and a vague rubric produces a loop that terminates on the judge's taste rather than on working software.
- **Independence is only as good as the roster.** A judge from the same family as the executor is blocked in the panel for exactly this reason.
- **The loop can end without a pass** — and when it does, it says so. A Crucible that stopped at the cap with two open defects is a useful result; one that claims a PASS it never got is not.
