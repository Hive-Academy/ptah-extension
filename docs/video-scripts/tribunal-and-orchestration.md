# Tribunal + Orchestration — Two Topologies — Full Script

**Length:** 5–6 min · **Runtime:** Ptah Desktop (Electron — tribunal is Electron/CLI-leaning) · **Orchestrator:** your default desktop model [VERIFY badge on camera]
**Goal:** Show that Ptah runs multiple agents two fundamentally different ways — a hierarchy for throughput, a peer panel for judgement — and that the peer panel is worth something precisely because the vendors are different.
**Controlling thesis:** Asking the same model twice is not a second opinion. Ptah lets you ask _different vendors_ and treats their disagreement as the signal.

> Standalone product video, not part of the SaaS-on-open-weights series. Follows the shared style guide for voice and format.

## Pre-record checklist

- **⚠️ BLOCKER — the panel is currently two families.** `ptah_agent_list` today returns `ollama cloud` (Ollama Cloud) and `claude fable` (Claude Subscription) as available; `cursor` is **not installed**; codex and copilot are not registered at all. The skill refuses below 2 distinct families and calls a two-family panel the bare minimum. **Install at least one or two more before shooting** — codex, copilot, cursor, or additional ptah-cli providers (Moonshot Kimi, Z.AI GLM, OpenRouter). A three-or-four-vendor panel is the difference between demonstrating the idea and merely describing it.
- **Every panelist spawn is a real, paid vendor call.** A council across four vendors plus a critique round is 8+ calls. Budget the takes; do a full dry run off camera first so the on-camera run is the second one.
- Pre-warm all lanes — first-call latency on a cold provider is long and dead air kills the scene. Speed-ramp any remaining wait.
- Pick a **genuinely contestable** council question. If all vendors agree the scene has no story. Something with real trade-offs — "should this be one lib or three", "is optimistic locking right here" — where you expect a split. [VERIFY the question actually splits them during the dry run; if it doesn't, pick another.]
- Have a small, well-specified task ready for the Relay demo so the pipeline finishes inside the video.
- No API keys or provider tokens on screen — check the provider settings panel before recording.

## Assets / overlays

- Lower-third per vendor as its lane first appears (vendor name + provider).
- The **contrast table** as a full-frame graphic at Scene 4 — this is the spine of the video, give it the frame.
- Callout box on the anonymized labels (P1..Pn / Answer A..N) when the critique round starts — the anonymization is the credibility move and viewers will miss it otherwise.
- Callout on the cited verdict showing which vendor said what.
- End card: Ptah logo · GitHub repo URL · "Download Ptah → ptah.live".

---

### [00:00–00:25] Cold open

- **VISUAL:** Ptah Desktop. A chat where the same model has just been asked "are you sure?" and has agreed with itself.
- **VO:** "If you ask a model to double-check its own work, it agrees with itself. That is not a second opinion, that is the same opinion twice. So Ptah can convene actual different vendors — and treat where they disagree as the useful part."
- **ON-SCREEN:** (none)

### [00:25–01:00] The panel

- **VISUAL:** Open the Tribunal panel. Show the vendor cards — each installed CLI vendor and each ptah-cli provider as its own lane.
- **VO:** "These are the vendors I have installed. Different companies, different models, different training. The tribunal builds a panel by taking one from each family — the spread is deliberate, because two lanes of the same vendor would just agree with each other."
- **ON-SCREEN (lower-thirds, per lane as it appears):** vendor name · provider
- **[VERIFY]** exact Tribunal panel entry point and whether vendor cards show provider names on camera.

### [01:00–01:40] The default: orchestration

- **VISUAL:** Switch to a normal chat. Type an ordinary implementation request. Show the orchestration skill announcing the detected task type, workflow depth and planned agent sequence.
- **VO:** "Most of the time this is not what you want. For ordinary work — build this feature, fix this bug — Ptah uses orchestration, and that is a hierarchy. It classifies the task, picks a workflow depth, then runs a team: project manager, architect, team leader, reviewers. The agents are specialists doing parallel work, and I am reviewing their output."
- **ON-SCREEN (callout):** the announced task type + agent sequence.

### [01:40–02:10] The contrast

- **VISUAL:** Full-frame graphic — the two topologies side by side.
- **VO:** "So there are two shapes. Orchestration is a hierarchy and the point is throughput — more hands on the work. The tribunal is flat, every vendor is a peer, and the point is not throughput at all. It is disagreement. One is for getting work done. The other is for deciding whether the work is right."
- **ON-SCREEN (full-frame table):**

  |                     | Tribunal                                      | Orchestration                    |
  | ------------------- | --------------------------------------------- | -------------------------------- |
  | Topology            | Flat panel of peers                           | Hierarchy                        |
  | Why multiple agents | Diversity is the signal                       | Throughput                       |
  | Vendor choice       | Deliberate max spread                         | Availability priority            |
  | Vendor output       | First-class evidence                          | Junior labor, reviewed           |
  | Use for             | Second opinions, debates, cross-vendor review | Features, bugfixes — the default |

### [02:10–03:20] Council, live

- **VISUAL:** Run a council. Type the contestable question on camera. Lanes fan out in parallel — show them running side by side.
- **VO:** "This is a council. One question, every vendor answers independently, and none of them can see the others yet."
- **VISUAL:** Answers land. Then the critique round starts and the labels flip to anonymous.
- **VO:** "Now they critique each other — but anonymized. P1, P2, Answer A, Answer B. No vendor knows whose answer it is pulling apart, so the round is about the content and not about the brand."
- **VISUAL:** The synthesized verdict, with citations back to each vendor.
- **VO:** "And the verdict cites them. Here is where they agreed, here is where they genuinely split, and here is what I would do. I am not overwriting anyone — their answers are the evidence."
- **ON-SCREEN (callout):** the anonymized labels during critique; the citations in the verdict.

### [03:20–04:20] Relay — the bridge

- **VISUAL:** Run a relay on the prepared task. Show each phase handing to a different vendor lane.
- **VO:** "Relay is where the two shapes meet. Same phased pipeline orchestration uses — plan, architect, implement, review — but every phase runs on a different vendor instead of a subagent. One vendor plans, another implements, a third reviews the second one's work. Cross-vendor review is the whole point, and it all persists into the task spec folder."
- **VISUAL:** Open `.ptah/specs/TASK_.../` and show the phase outputs on disk.
- **VO:** "So it is auditable. Every phase, from whichever vendor produced it, written down."
- **ON-SCREEN (callout):** the spec folder contents.
- **[VERIFY]** relay phase naming on screen and the exact spec folder layout it writes.

### [04:20–04:50] When not to use it

- **VISUAL:** Back to a plain chat.
- **VO:** "One honest thing. Do not make this your default. Every panelist is a real paid call, so a four-vendor council costs four times a normal question, plus the critique round. For ordinary work use orchestration. Reach for the tribunal when the decision is expensive to get wrong — an architecture call, a second opinion, a change you cannot easily undo."
- **ON-SCREEN (callout):** "council ≈ N vendors + critique round = N+ paid calls"

### [04:50–05:20] CTA / End screen

- **VISUAL:** GitHub repo; the tribunal skill in `.claude/skills/tribunal/`.
- **VO:** "The skill is in the repo — the four moves are council, forge, race and relay. Forge gives every vendor its own git worktree to implement the same task and then merges the winner. Race scores attempts on a rubric and verifies before committing. Both are in there. Download Ptah, connect whichever vendors you already pay for, and convene a panel."
- **ON-SCREEN:** End card — Ptah logo · repo URL · "Download Ptah → ptah.live".

---

## The prompts

Council — paste on camera:

```
Convene a council: <your genuinely contestable question here>
```

Relay — paste on camera:

```
Relay this task through plan → architect → implement → review,
one vendor lane per phase: <task description>
```

Both trigger the skill by phrase. Nothing else needs configuring — the panel comes from whichever vendors are installed.

---

## Shot list (quick capture summary)

1. Cold open — model agreeing with itself.
2. Tribunal panel — vendor cards, one per installed family.
3. Ordinary chat — orchestration announcing task type + agent sequence.
4. Full-frame contrast table.
5. Council question typed on camera; lanes fanning out in parallel.
6. Answers landing.
7. Critique round with anonymized labels — callout.
8. Cited verdict — callout on the citations.
9. Relay running; phases handing between vendor lanes.
10. `.ptah/specs/TASK_.../` on disk with phase outputs.
11. Cost caveat beat.
12. Repo + tribunal skill folder.
13. End card.

## [VERIFY] flags

- **Vendor count is the blocker.** Two families available today (Ollama Cloud, Claude Subscription). Install more before shooting or the "diversity is the signal" thesis has almost nothing to stand on. Re-run `ptah_agent_list` on record day and update Scene 2.
- Does the council question actually split the panel? Confirm in the dry run — an all-agree council is a dead scene, and you cannot fix it in the edit.
- Exact Tribunal panel entry point in Ptah Desktop, and whether the wizard's three steps (pick move → panel preview → run) should be shown or skipped for pacing.
- Whether the anonymized labels are visible in the UI during the critique round, or only inside the conductor's reasoning — this determines whether Scene 5's best beat is filmable at all. If it is not visible, consider a graphic instead.
- Relay's on-screen phase labels and the `.ptah/specs/` folder layout it produces.
- Real cost of one full council + relay run, so the Scene 8 caveat quotes a true number rather than a hand-wave.
- Confirm no provider keys are visible in any settings panel shown on camera.
