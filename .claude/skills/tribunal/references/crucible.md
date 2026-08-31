# Crucible — cheap executor, strong judge, bounded revise loop

Put one task through a **role-asymmetric loop**: a cheap, fast **executor lane** does the work; a stronger **judge lane from a different vendor family** scores it against a frozen rubric and hands back numbered defects; the executor revises. Repeat until the judge returns `PASS`, the executor stops converging, or 2 revise rounds are spent.

Read [vendor-panel.md](vendor-panel.md) first — Crucible runs on that spine, but the lanes are **unequal by design** and the loop is **iterative** rather than one-shot.

> **Crucible changes files.** The executor writes code in-place on the active branch. The judge never writes product code. Nothing is committed without the user seeing the diff.

---

## Crucible vs the other moves

|              | Council / Forge / Race      | Relay                       | Crucible                                   |
| ------------ | --------------------------- | --------------------------- | ------------------------------------------ |
| Lane roles   | Peers, same prompt          | One phase each, sequential  | **Executor vs judge — unequal on purpose** |
| Shape        | Parallel panel              | Linear pipeline, one pass   | **Loop until PASS or cap**                 |
| Signal       | Disagreement between equals | Specialization + one review | **Convergence under an independent bar**   |
| Cost profile | N × strong lanes            | 1 call per phase            | **Cheap lane × N + strong lane × N**       |
| Ends when    | Verdict synthesized         | Review phase written        | Judge says `PASS`, or cap, or regression   |

Reach for Crucible when the quality bar is **statable in advance** and the work is **well-specified but fiddly** — the kind of task a cheap model gets 80% right and a strong reviewer can close in two rounds for a fraction of the cost of running the strong model end-to-end.

Do **not** use it when: the bar cannot be written down (use Council), you want competing designs rather than one converged one (Forge / Race), or the task is small enough that one good lane finishes it in a single call.

## Topology

```
Tier 1: Conductor (you)
  ├── writes the rubric BEFORE any spawn, and freezes it
  ├── sole spawner; owns every user gate
  ├── drops defects that carry no file:line evidence
  └── verifies with the build/tests after PASS — the judge's PASS is not proof
Tier 2a: Executor lane   — cheap / fast vendor. Writes code. Resumed between rounds.
Tier 2b: Judge lane      — strongest reasoning vendor, DIFFERENT family. Reads and scores. Never edits.
```

The judge **must** be a different vendor family from the executor. A lane grading its own output is not a signal, and on the next round it would be grading work it effectively authored.

## Lane roster heuristic

Pick by **capability, not by brand** — the roster comes from `ptah_agent_list`, and the set of vendors differs per release and per machine.

| Role         | Select the lane that is…                                                                                                                   | Why                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| **Executor** | Cheapest / fastest lane that can still write competent code from a precise spec                                                            | It will run several rounds; its per-call cost is what makes the loop pay off |
| **Judge**    | Strongest-reasoning lane available, from a **different family** — a ptah-cli lane at `modelTier: 'opus'`, or a system CLI on its top model | Reasoning depth + rubric discipline; independence is the whole point         |
| **Swap-in**  | Any third family, spent only after a regression stop                                                                                       | Costs another lane; only worth it once the first executor stops converging   |

If the user names the lanes, that overrides the heuristic — resolve each name against `ptah_agent_list` and use exactly what they asked for.

Build the roster per [vendor-panel.md §2](vendor-panel.md), but select for **role fit**, not family spread. If the Tribunal UI supplied explicit lanes ([§0](vendor-panel.md)), the **first** lane is the executor and the **last** is the judge unless the user said otherwise — confirm that reading before spending a call. When those lanes carry an explicit `(executor)` / `(judge)` role token, that token is authoritative per [vendor-panel.md §0](vendor-panel.md): the first-lane/last-lane heuristic does not apply and no confirmation round-trip is needed.

The user may pin both roles explicitly, including a same-family-different-model judge. Address the lanes exactly as in [relay.md → Pinning the roster](relay.md#pinning-the-roster-per-phase-lane-assignment) — that section is the single source for what goes into `ptah_agent_spawn`, and for the rule that the vendor list is discovered rather than hardcoded. A same-family judge on a different model is permitted when asked for, but say so in the summary — it is a weaker independence signal than a cross-family judge, and independence is the whole basis of the loop.

If discovery turns up fewer than two families, Crucible cannot run — there is no independent judge to be had. Say so, and offer Relay's single-lane pipeline, an in-house review, or point the user at settings to configure another provider.

## The rubric (write it first, then freeze it)

Before the first spawn, the Conductor writes `rubric.md` into the spec folder: 3–7 criteria, each with a **binary pass condition** and how to check it.

```markdown
# Rubric — TASK_2026_NNN

| #   | Criterion           | Pass condition                                                 | Checked by                        |
| --- | ------------------- | -------------------------------------------------------------- | --------------------------------- |
| 1   | Acceptance criteria | Every AC in task-description.md demonstrably satisfied         | Judge reads the diff              |
| 2   | Type safety         | No `any`, `catch (error: unknown)` everywhere, no `@ts-ignore` | Judge + `typecheck`               |
| 3   | Boundary validation | Zod schema on every new external boundary                      | Judge reads the diff              |
| 4   | Test coverage       | New behaviour has a failing-before/passing-after test          | Conductor runs tests              |
| 5   | Scope discipline    | No files touched outside the stated scope                      | Conductor reads `git diff --stat` |
```

**The rubric is frozen after round 1.** Adding criteria mid-loop moves the goalposts and the loop never terminates. Anything new the judge notices goes into the final summary as a follow-up, not into this round's bar.

## Judge output contract (strict — the loop gates on it)

Every judge spawn prompt ends with this contract verbatim, so the Conductor can gate deterministically:

```markdown
## VERDICT

PASS | REVISE | REJECT

## SCORES

| # | Criterion | Pass? | Evidence (file:line) |

## DEFECTS <!-- omit when PASS -->

D1 [blocking|major|minor] <file:line> — what is wrong — what correct looks like
D2 ...

## MENTOR NOTE

<= 5 lines. The _pattern_ behind the defects, so the next round does not repeat the class of error.
```

- `PASS` — every criterion passes. No blocking or major defects.
- `REVISE` — defects exist but the approach is sound. The loop continues.
- `REJECT` — the approach itself is wrong. **Do not revise.** The Conductor re-specs, swaps the executor lane, or aborts — never feeds a rejected approach back for patching.

The **mentor note** is what separates this from an ordinary review round: the executor is a cheap model, and a list of symptoms makes it fix symptoms. Naming the underlying pattern is what makes round 2 better than round 1 instead of merely different.

## Flow

```
write rubric → announce lanes + round cap + cost → EXECUTE → JUDGE → gate
  PASS      → Conductor verifies (build/test/lint) → present diff → user commits
  REVISE    → resume executor with defects + mentor note → JUDGE again  (round++)
  REJECT    → stop the loop; re-spec / swap lane / abort — Conductor decides with the user
  2 revise rounds done → stop; present best artifact + open defects honestly.
                         A 3rd round only on the user's explicit say-so; never a 4th.
```

### Step 1 — Init & announce

Create `.ptah/specs/TASK_[ID]/` (ID per [relay.md](relay.md) — folder scan, not `registry.md`). Write `context.md` with `mode: tribunal-crucible`, the executor lane, the judge lane, and the round cap. Write `rubric.md`. Announce: both lanes, the cap, and the cost — **2 paid calls per round**. Get the go-ahead; this writes code.

### Step 2 — Execute

```
ptah_agent_spawn({
  task: <self-contained prompt
         + absolute paths
         + the full acceptance criteria
         + the rubric verbatim (it is being graded on it — let it see the bar)
         + "do NOT commit; do NOT touch files outside <scope>">,
  ...executorLane.spawnArgs,
  taskFolder: <spec folder>,
  files: [...absolute paths]
})
# poll ptah_agent_status every ~8s until status != "running"
```

Round 2+ **resumes** the executor via `resume_session_id` so it keeps its own reasoning — check `ptah_agent_status` for a `CLI Session ID`; where the adapter is ephemeral and reports none, respawn with the prior diff described in the prompt. The revise prompt carries the defect list and the mentor note **verbatim**, plus: `fix D1..Dn only; do not refactor anything else`.

### Step 3 — Judge

Spawn the judge with: the acceptance criteria, `rubric.md`, the executor's diff (`git diff` output or the changed file paths), and the output contract above. Add:

- `you are reviewing another vendor's work; you did not write it`
- `every defect MUST cite file:line — a defect without a location will be discarded`
- `do NOT edit any file; do NOT commit; write your report to <abs path>/round-N-judge.md and reply only "WROTE: <path>" + the verdict word`

Then Read `round-N-judge.md`. The Conductor **drops any defect with no file:line evidence** before relaying it — otherwise hallucinated nitpicks buy paid rounds.

### Step 4 — Gate, and stop honestly

| Condition                                                                                            | Action                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PASS`                                                                                               | Conductor runs the project's typecheck / tests / lint. Green → present diff. Red → that is a defect the judge missed; relay one more round with the real failure output.                                                       |
| `REVISE`, rounds remaining                                                                           | Resume the executor with defects + mentor note.                                                                                                                                                                                |
| `REVISE` after the **2nd** revise round                                                              | **Stop by default.** Present the current state, the open defects, and what it would take to close them. You may run a 3rd revise round **only if the user asks for it** — never a 4th, and never a 3rd on your own initiative. |
| The defect count did not go down **and** the severity mix did not improve, versus the previous round | **Regression stop.** The executor is not converging. Escalate: swap the executor family, or take it in-house.                                                                                                                  |
| `REJECT`                                                                                             | Stop the loop. Re-spec with the user, or swap lanes.                                                                                                                                                                           |
| Judge fails/times out twice                                                                          | Promote a third family to judge, or judge it yourself and say plainly that the round was self-judged.                                                                                                                          |

### Step 5 — Synthesize

Final summary cites **which lane did what**, links every artifact, lists the rounds with each verdict, and states any defect that was accepted-as-is. Present the diff. Never commit without the user; never merge to `main`.

## Spec folder layout

```
.ptah/specs/TASK_[ID]/
├── task.md                 # the carrier — frontmatter status/type/title (see root CLAUDE.md)
├── context.md              # user intent, lanes, mode: tribunal-crucible, round cap
├── rubric.md               # frozen after round 1
├── round-1-judge.md        # verdict + scores + defects + mentor note
├── round-2-judge.md
└── (code changes land in-place on the branch)
```

## Variants

- **Crucible-solo** (default) — one executor, one judge. 2 calls per round.
- **Crucible-fanned** — 2–3 executors on the same task in isolated worktrees ([forge.md](forge.md)), one judge scoring all of them on the same rubric and issuing per-lane defects. This is Forge with a mentor loop. The executors within one round run concurrently; the rounds themselves stay sequential. Cost is `(lanes + 1) × rounds`, and more than 3 lanes in flight exceeds the default concurrency budget — announce both the cost and the widening, and get the user's say-so first.
- **Crucible-in-relay** — drop a Crucible loop into [Relay's](relay.md) implement phase when that phase is the risky one, and leave the other phases single-pass.

## Guidance

- **Asymmetry is the point.** Every other Tribunal move treats lanes as peers. Here the cheap lane produces and the strong lane judges — that is what makes the economics work, and it is why the judge must never be allowed to just fix things itself.
- **The judge's PASS is an opinion; the build is the fact.** Always run typecheck/tests before presenting.
- **Bound everything.** Frozen rubric, hard round cap, regression stop. An unbounded critic loop spends real money forever and converges on the critic's taste, not on working software.
- **Never let the judge write product code.** It may write its report and nothing else. The moment it edits, the next round has no independent reviewer.
- **Report the loop honestly.** If it hit the cap at `REVISE`, say so. A Crucible that stopped short with two open defects is a useful result; one that claims PASS it never got is not.
