# E08 — Quality Gate: Triple Review — Full Script

**Length:** 9–11 min · **Trial day:** Day 16 / 100 · **Runtime:** Ptah Desktop (Electron) · **Orchestrator:** Kimi (open weight, Ollama Cloud)
**Goal:** Run the full triple-review protocol — `/review-code`, `/review-logic`, `/review-security` — across the entire E04–E07 codebase, fix the findings with delegated CLI agents, use compaction (`/compact`) to keep the long session going, and note the session cost honestly (there's no per-token meter to run on an open-weight provider).
**Controlling thesis:** Three independent reviewers, each focused on a different dimension, catch things that any single pass misses.

> **Provider-accuracy note (important):** `/compact` and the `/review-*` skills work on **all** providers, but `/context` and `/cost` are **Anthropic-only** and will NOT function on this Kimi/Ollama session. This script deliberately does not invoke them — the absence of a cost meter is reframed as the payoff (see Beat 5).

## Pre-record checklist

- Full app (E04–E07) green and committed; all three Angular builds, NestJS API, and SSE stream working.
- Intentionally planted smells present and labeled in a private note (do NOT show the note on camera):
  - One N+1 query: a service method that queries tasks and then queries tags per task in a loop.
  - One missing input validation: a controller endpoint that accepts a numeric field without a `@IsInt()` or `@Min()` guard.
  - One dead-code block: an unused `calculateLegacyScore()` helper from early iteration.
  - One security smell: a response that echoes back a user-supplied string without sanitization (minor, realistic).
- Confirm `/review-code`, `/review-logic`, `/review-security` slash commands are available and load the correct skills.
- A long prior-session transcript is already in the window so compaction triggers naturally (or simulate by having a chat with substantial prior context).
- `/compact` confirmed working on the open-weight session. Do NOT plan to use `/context` or `/cost` — they are Anthropic-only and won't run here. [VERIFY whether Ptah Desktop surfaces a UI context/usage indicator for the compaction beat.]

## Assets / overlays

- "Day 16 / 100" trial counter.
- Triple-review score cards: one per review dimension with a findings tally.
- Compaction "before/after tokens" overlay.
- Session-stats note (factual; no "$0" slogan banner).
- "Intentional demo smell" label card (brief, honest, to camera).

---

### [00:00–00:20] Cold open

- **VISUAL:** Ptah Desktop chat, open-weight model badge in corner. The task board is running in a browser tab in the background.
- **ON-SCREEN (lower-third):** "Day 16 / 100"
- **VO:** "We've built auth, tenancy, a task engine, billing, and a full Angular front end. Today we stop and ask a harder question: is it actually good?"

### [00:20–01:00] Setup: why triple review

- **VISUAL:** A simple three-row table animates in: code review → logic review → security review.
- **VO:** "Ptah's review system runs three separate passes, each focused on a different dimension. Code review is about standards and style — dead code, naming, complexity. Logic review is about correctness — are the business rules actually right? Are there stubs that never got finished? Security review is OWASP — injection, validation gaps, data exposure. One reviewer misses things. Three reviewers, focused, rarely do."
- **VISUAL:** Camera pushes in on the three rows.
- **VO:** "We're going to run all three against everything we've built since episode four. And I'll be honest with you now: I left a few real smells in there on purpose. This is a demo — I want you to see reviewers find something. You'll know when it happens."

### [01:00–03:00] Beat 1 — `/review-code`

- **VISUAL:** In chat, type `/review-code`. Skill activates, streams findings.
- **ON-SCREEN:** Score card overlay: "Code Review — findings: N" [VERIFY count matches planted smells + any genuine ones]
- **VO:** "First pass: `/review-code`. This reviewer looks at the structure and standards of the implementation — naming, complexity, dead code, and anything that would slow down a future maintainer."
- **VISUAL:** Findings stream in. Highlight the dead `calculateLegacyScore()` function being flagged.
- **VO:** "There — a dead helper that survived four episodes of iteration. The reviewer flagged it with the right context: it's unreachable, it references a data shape that no longer exists, and it has no callers. That's a code reviewer doing exactly what a senior engineer would do in a pull request."
- **VISUAL:** The review finishes. Score card shows final findings count with severity breakdown.
- **VO:** "One pass done. We'll fix those in a batch after all three reviews. Let's keep the momentum."

### [03:00–05:00] Beat 2 — `/review-logic`

- **VISUAL:** In chat, type `/review-logic`.
- **ON-SCREEN:** Score card overlay: "Logic Review — findings: N"
- **VO:** "Second pass: `/review-logic`. This reviewer is not looking at whether the code is tidy — it's asking whether the code is correct. Are the domain rules enforced? Is there anything that would produce wrong results under real usage?"
- **VISUAL:** Findings stream in. Highlight the N+1 query being flagged — the service method querying tags per task in a loop.
- **VO:** "That N+1 is the one I was watching for. A service method queries all tasks for a board and then, inside the loop, fires a separate query for each task's tags. That's fine with ten tasks. It's a page-load problem with a thousand. The logic reviewer found it, described exactly why it matters, and suggested the correct fix: a single join query."
- **VISUAL:** Also highlight a check on the subscription state machine from E06 — any transition gap or an untested edge.
- **VO:** "It also flagged a transition in the subscription state machine: past-due to active has no guard against a reactivation for an already-active account. Small — but in billing, small gaps cost money."
- **VISUAL:** Score card finalizes.
- **VO:** "Two reviews down. Now the one that matters most for a multi-tenant app."

### [05:00–07:00] Beat 3 — `/review-security`

- **VISUAL:** In chat, type `/review-security`.
- **ON-SCREEN:** Score card overlay: "Security Review — findings: N"
- **VO:** "Third pass: `/review-security`. OWASP-aligned, looking for injection vectors, validation gaps, data exposure, and anything that touches tenant isolation."
- **VISUAL:** Findings stream in. Highlight the missing `@IsInt()` / `@Min()` guard on the controller endpoint.
- **VO:** "There it is: a controller accepting a numeric limit parameter with no validation guard. No `@IsInt()`, no `@Min()`. An attacker sends a negative number or a float and the query behavior is undefined. The security reviewer flagged it, cited the OWASP input-validation category, and gave the exact fix."
- **VISUAL:** Also show the response-echoing smell being flagged — user-supplied string echoed without sanitization.
- **VO:** "And here — a response body that echoes back a user-supplied field without sanitization. Reflected, not stored, but the reviewer still calls it: label it, sanitize it, or remove it. That's the right call."
- **VISUAL:** Score card finalizes. All three score cards visible simultaneously.
- **ON-SCREEN:** All three score cards side by side: code review, logic review, security review.
- **VO:** "Three passes, three different lenses, real findings across all of them. I'll be straight with you: I planted one of those smells deliberately so the reviewer would have something concrete to find. The other three are genuine patterns that accumulated over seven episodes. That's the honest answer to 'is it good.' Let's fix it."

### [07:00–08:00] Beat 4 — Delegate fixes and compaction

- **VISUAL:** Orchestrator chat. User asks orchestrator to triage and delegate the fix batches to CLI agents — one per review dimension.
- **ON-SCREEN (lower-third):** "Spawn → Poll → Read"
- **VO:** "Fixes go to CLI agents — one batch per review dimension. The orchestrator triages the findings, groups related fixes, and spawns an agent per batch. While those run, the session's been going for a while — and that's worth talking about."
- **VISUAL:** The chat's context/usage indicator in the UI shows the window filling up. [VERIFY Ptah Desktop surfaces a context indicator; `/context` is Anthropic-only and is NOT used here.]
- **VO:** "We're deep. A long planning session, three reviews, and all the code context in the window adds up. This is exactly when compaction earns its keep."
- **VISUAL:** Trigger compaction with `/compact` — show the compaction event firing. A summary streams in; then the context indicator drops.
- **ON-SCREEN:** "Before compaction: [N] tokens · After compaction: [M] tokens" overlay. [VERIFY actual numbers at recording time]
- **VO:** "Compaction distills the session history into a tight summary, hands it back to the model, and we carry on. The orchestrator still knows every finding, every fix batch in flight, every decision from episode one that's in memory. The thread is unbroken — just leaner."
- **VISUAL:** Orchestrator resumes; CLI agent results start streaming back — dead code removed, N+1 replaced with a join, validation guard added, response sanitized.
- **VO:** "And there are the fixes, streaming back. Dead code gone, N+1 resolved, validation guard added, response sanitized. The orchestrator verifies each one against the original finding."

### [08:00–09:00] Beat 5 — No cost meter on open weights

- **VISUAL:** Orchestrator chat at rest; camera settles on the open-weight model badge. No command is typed.
- **ON-SCREEN:** open-weight model badge in view (no cost-meter overlay).
- **VO:** "On a closed model you'd open a cost breakdown here and see what the session spent. I can't do that — there's no per-token meter to run on an open-weight provider through Ollama Cloud. Three full reviews, a planning session, parallel fix delegation, and compaction. If you want to know what that used: I'll note the session stats, but there's no closed-lab bill to report."
- **VO:** "That's just how it works on open weights. Whether the trade-off is worth it depends on what you care about — that's for you to decide."
- **VISUAL:** Settle back on the chat; on with the fixes.

### [09:00–10:00] Close green: re-run all three reviews

- **VISUAL:** Orchestrator re-runs all three review commands: `/review-code`, `/review-logic`, `/review-security` against the patched code.
- **VO:** "Now we close this green. Not just a build pass — we re-run all three reviewers against the patched code."
- **VISUAL:** All three reviews stream findings: zero new findings in the original categories; all previously flagged items resolved.
- **ON-SCREEN:** "Code: ✓ · Logic: ✓ · Security: ✓"
- **VO:** "Clean. Three independent reviewers, every finding fixed and re-verified, inside one compacted session on open weights."
- **VISUAL:** `nx run-many -t lint typecheck build` passes.
- **ON-SCREEN:** Green build matrix.

### [10:00–11:00] CTA / End screen

- **VISUAL:** End card. All three score cards in the background, all green.
- **VO:** "That's episode eight. The codebase has been reviewed from three angles and the findings are fixed. Next episode: make it run itself. Scheduled agent jobs, the messaging gateway — Discord, Telegram, Slack — and voice. I'll see you in episode nine."
- **ON-SCREEN:** End card — "Next: Always-On Ops" · "Day 19 / 100" · subscribe/playlist link.

---

## Shot list (quick capture summary)

1. Cold open: Desktop chat + open-weight badge + task board in background tab.
2. Three-row review table animation.
3. `/review-code` invoke — streaming findings.
4. Dead-code finding close-up and score card.
5. `/review-logic` invoke — streaming findings.
6. N+1 finding close-up and score card.
7. State-machine transition gap finding.
8. `/review-security` invoke — streaming findings.
9. Missing validation guard finding close-up.
10. Response-echo finding.
11. All three score cards side by side.
12. Orchestrator triage + CLI agent spawn for fix batches.
13. UI context/usage indicator filling (NOT `/context` — Anthropic-only).
14. `/compact` trigger + before/after context overlay.
15. CLI agent fix results streaming back.
16. Settle on open-weight badge (no cost-meter overlay; point covered in VO).
17. Re-run all three reviews: clean pass.
18. `nx run-many` green matrix.
19. End card.

## [VERIFY] flags

- Confirm `/review-code`, `/review-logic`, `/review-security` are the exact slash-command strings that invoke the review skills in Ptah Desktop (not `/code-review` or another variant).
- Confirm the review skills produce a structured findings output with severity labels that can be captured cleanly on screen.
- RESOLVED (do not re-add): `/context` and `/cost` are Anthropic-only and are intentionally NOT used in this episode — the session runs on an open-weight provider. Verify instead whether Ptah Desktop surfaces a UI context/usage indicator that can stand in for the compaction before/after visual.
- Confirm compaction (`/compact`) is triggerable manually from the chat (not only automatic) and that the before/after context reduction is visible in the UI. [Note: from project memory, compaction emits a `compact_boundary` message and Pre/PostCompact hooks — verify the desktop UI surfaces this visibly enough for a screen capture.]
- Confirm that "code-style reviewer" and "code-logic reviewer" are the agent types loaded by the respective review skills — and that they run as sub-agents visible in the UI rather than inline responses.
- Confirm the planted N+1 smell is real (a genuine pattern that the logic reviewer would flag) — do not use an artificial smell that a real reviewer would ignore.
- Confirm the security smell (response echo) is genuinely minor enough that it is not a real security incident in the recorded state — label it clearly as intentional demo material in the pre-record note.
