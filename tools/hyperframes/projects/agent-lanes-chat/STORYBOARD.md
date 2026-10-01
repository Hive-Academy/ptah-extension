---
format: 1920x1080
duration: 14.328s
message: "Your agents work in parallel lanes, and they talk back."
arc: Wait → Split → Parallel proof → Pushed back (Act 1 of storyboard v2)
audience: developers who already use AI coding agents
mode: collaborative
version: v1
---

# Agent lanes — prototype C (session transcript), Act 1

Beats, times, captions and SFX follow `../agent-lanes-v3/STORYBOARD.md` (v2) Frames 01-04. Only the world differs: one chat column (design width 1400, u 1, top edge fades like the app's chat view). Items flow top-down with 24 px gaps; the column scrolls as items arrive.

## Frame 01 — Waiting (0.000-1.791)

- src: compositions/frames/01-wait.html
- On screen: "ONE AGENT. ONE TASK."; prompt "Fix the review on 579 and run the full test suite."; one running Bash row; clock 18m 01s → 18m 04s on the beats.

## Frame 02 — Split (1.791-5.373)

- src: compositions/frames/02-split.html
- On screen: on the drop the old transcript scrolls out; prompt "Review batch 5 in three lanes: Glm, Codex and Copilot."; three gold `ptah agent spawn` rows on beats 2-4 ("Glm · review the code logic", "Codex · fix the review comments", "Copilot · run lint and tests"). Caption "ONE PROMPT. THREE LANES."

## Frame 03 — All at once (5.373-10.746)

- src: compositions/frames/03-parallel.html
- On screen: "ALL AT ONCE."; the transcript slides out left, the real Agents panel slides in (three columns, rows on the same beats); Glm completes on bar 3 beat 3; the panel leaves, then the transcript returns.

## Frame 04 — Pushed back (10.746-14.328)

- src: compositions/frames/04-pushed.html
- On screen: "RESULTS COME BACK TO YOU." / "Pushed to your session. No polling."; the transcript scrolls up and Glm's pushed result lands at the bottom; the "delivered" chip gets the focus ring on bar 2.
