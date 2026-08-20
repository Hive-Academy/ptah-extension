# E12 — Finale + Trial CTA — Full Script

**Length:** 6–8 min · **Trial day:** Day 28 / 100 · **Runtime:** Ptah Desktop (Electron) · **Orchestrator:** Kimi (open weight, Ollama Cloud)
**Goal:** Close the series — full-arc montage recap, honest accounting of what the build covered and what it cost, and a low-pressure invitation to try it yourself.
**Controlling thesis:** Here's what the build covered and how it went. If it looks useful to you, here's how to start.

## Pre-record checklist

- All twelve episodes recorded; best 2–3 second beats pulled from each for the montage.
- Final stats confirmed and ready for the stats card: number of trial days used (28), final "$0 to closed models" figure, feature-coverage count (tie back to the coverage matrix in the series bible).
- `technical-content-writer` skill used to draft and polish the recap copy and CTA text before recording the VO — cite the skill in the scripted beat below.
- Trial signup URL confirmed and ready for the end card. [VERIFY the exact trial signup URL to display.]
- Episode 00 repo/roadmap template link confirmed. [VERIFY the public link to the series starter repo or roadmap template, if applicable.]
- No new features introduced. No new code. This episode is the payoff, not an extension.
- Stats card graphic prepared with real numbers — do not use placeholder figures on screen.

## Assets / overlays

- Full-arc montage (one beat per episode, labeled E00–E11).
- Stats card: "Days used: 28 / 100 · $ to closed models: $0 · Features demoed: [N]".
- Stats-card figure: closed-model spend (one factual stat, not a recurring banner).
- Episode-callback lower-thirds for each montage beat (e.g. "E02 — Scaffold · green on first run").
- Trial CTA end screen: single action, trial signup URL, "Start with E00" link.
- Trial-day counter: "Day 28 / 100 — 72 left."
- Series playlist card.

---

### [00:00–00:35] Cold open — the montage

- **VISUAL:** Rapid-cut montage. Each beat is 2–3 seconds. Order follows the build arc. Lower-thirds label each episode milestone.
  - E00: Setup wizard, open-weight badge, Kimi confirmed.
  - E01: Roadmap streaming into `.ptah/roadmap.md`.
  - E02: `nx run-many` matrix — green on first run.
  - E03: Canvas multi-tile — four bounded contexts in parallel.
  - E04: Security review finding surfaced + fixed.
  - E05: Realtime board update in two browser tabs.
  - E06: Webhook flipping the subscription state live.
  - E07: Landing page scroll animation.
  - E08: Triple-review score cards, compaction mid-session.
  - E09: Discord reply from the phone.
  - E10: "LIVE" badge over the production URL.
  - E11: Skill synthesis candidate card + custom skill saved.
- **VO:** "Twelve episodes. Twenty-eight days of trial. One open-weight model. One deployed SaaS."
- **ON-SCREEN:** Each beat labeled. Montage ends on the live TaskFlow URL from E10.

### [00:35–01:30] The arc (one sentence per episode)

- **VISUAL:** A clean slide or animated list — one line per episode, appearing in sequence.
- **VO:** "Here's what we actually did. Day one: set up an open-weight orchestrator and a team of CLI delegates. Day two: one sentence became a phased roadmap. Day three: an empty folder became a boundary-enforced Nx monorepo, green on the first run. Day four: four bounded contexts, modeled in parallel. Day six: auth and multi-tenant isolation, security-reviewed and fails-closed. Day eight: a real-time Tasks engine with a resilient service architecture. Day eleven: freemium, billing, and signature-verified webhooks — tested end-to-end in the browser. Day fourteen: a signal-based Angular app and an animated landing page, built in parallel. Day sixteen: three independent reviews, every finding addressed, inside one compacted session. Day nineteen: scheduled upkeep, a fix sent from a phone. Day twenty-two: deployed, hardened, and live. Day twenty-five: skills and a harness built from the trajectory, so the next project can load them."
- **ON-SCREEN:** Animated arc list, one line per episode beat. Each line ends green.

### [01:30–02:30] The numbers

- **VISUAL:** Stats card animates on screen. Three figures: days used, dollars to closed models, feature-coverage count.
- **VO:** "The numbers. Twenty-eight days of trial used. The whole build ran on open weights — the model costs went to Ollama Cloud, not a closed lab. Every feature in Ptah's coverage matrix was used at least once on this build: orchestration, skills, Canvas, memory, cron, gateway, compaction, triple review, harness builder."
- **ON-SCREEN:** Stats card — "Days used: 28 / 100 · Closed-model spend: $0 · Features demoed: [N]"
- **VO:** "The app is a multi-tenant SaaS — auth, billing, realtime, a reviewed codebase, a CI/CD pipeline, a production deployment. That's what the build covered. What this series doesn't prove is that open weights are better than closed models — that depends on what you're building and what you care about. What it does show is that a build this size can run from start to deployment on an open-weight setup."
- **ON-SCREEN:** "Day 28 / 100 — 72 left." [VERIFY trial length is confirmed as 100 days; if not, remove the counter framing and flag for the editor.]

### [02:30–03:30] What this proves

- **VISUAL:** Split screen: the empty TaskFlow folder from E00, next to the live production URL and the deployed app.
- **VO:** "A few things that held up across the whole build. The orchestrator-plus-delegates model kept planning and execution separate — that helped with the repetitive parts without losing track of the overall plan. The skills and memory carried context forward; by episode eleven the orchestrator was operating with twenty-five days of accumulated decisions. And Kimi, running on Ollama Cloud, handled architecture, reviews, and supervision from start to finish. It occasionally needed more back-and-forth than a closed model might, but it completed the build."
- **ON-SCREEN:** Three callout bullets animating in.

### [03:30–04:30] The technical-content-writer moment (skill called out)

- **VISUAL:** Brief cut to the Ptah chat where `technical-content-writer` was used to draft the series recap copy. The skill is active in the session. [VERIFY the recap copy was genuinely drafted with the skill — show the chat context where it was invoked.]
- **VO:** "One more thing. The arc walkthrough and this script were drafted with `technical-content-writer` — the same skill framework that was used on the product itself. It's a reasonable example of the loop: the skills work on whatever you're building, including the content around the build."
- **ON-SCREEN (lower-third):** "technical-content-writer · recap copy drafted in-app"
- **VISUAL:** The skill output visible briefly — structured copy blocks for the recap and CTA.

### [04:30–05:30] The CTA — one action

- **VISUAL:** The end screen begins to build: trial signup URL large and center, subtitle below it.
- **VO:** "If the approach looks useful to you, here's how to start: install Ptah Desktop, start from episode zero, and build along. The roadmap, the skills, and the open-weight rig are all there. You can follow the same sequence we used, or adapt it to your own project."
- **ON-SCREEN:** Single CTA — trial signup URL, large, centered. No competing actions.
- **ON-SCREEN (subtitle):** "Start the free trial · Follow from E00"
- **VO:** "We used twenty-eight days to get from an empty folder to a deployed SaaS. What you do with the rest of your trial is up to you."

### [05:30–06:15] Series close

- **VISUAL:** The full montage from the cold open plays one more time, faster — maybe eight seconds. Ends on the live URL + the Kimi badge side by side.
- **VO:** "Twenty-eight days. One open-weight model. One deployed SaaS — and a harness that makes the next one easier to start. That's what this series built."
- **ON-SCREEN:** Series title card — "Build a SaaS on Open Weights with Ptah." Episode playlist link. Trial signup URL below.
- **ON-SCREEN (lower-third, final):** "Ran start-to-deploy on an open-weight model"

### [06:15–end] End card

- **VISUAL:** Static end card. Two elements: trial signup URL (primary, large); series playlist link (secondary).
- **VO:** (silence or light music — no narration over end card)
- **ON-SCREEN:** "Start your trial: [URL]" · "Watch the full series: [playlist link]" · Ptah wordmark.

---

## Shot list (quick capture summary)

1. Montage cold open — 12 beats × 2–3 sec each, labeled E00–E11. Ends on the live URL.
2. Animated arc list — one line per episode, each ending green.
3. Stats card — three figures: days used / $0 / feature count.
4. Stats card (days, closed-model spend, features).
5. "Day 28 / 100 — and you have 72 left" counter.
6. Split screen: E00 empty folder vs E10 live URL + deployed app.
7. Three-bullet "what this proves" callout.
8. Ptah chat showing `technical-content-writer` invocation + recap copy output.
9. End-screen build: trial signup URL large and center.
10. Fast-replay montage (8 sec) + Kimi badge side-by-side close.
11. Series title card + playlist link + "$0" final lower-third.
12. Static end card: trial URL (primary) + playlist link (secondary).

## [VERIFY] flags

- Confirm the trial signup URL to display on the end card — must be the real, working link before recording.
- Confirm the public series starter repo or roadmap template link (or note "no public template" so that reference is removed from the VO if it does not exist).
- Confirm the exact feature-coverage count (the "N" on the stats card) by counting the verified-demoed rows in the coverage matrix in the series bible — do not use a placeholder on screen.
- Confirm `technical-content-writer` was genuinely used to draft the recap/CTA copy before recording, so the in-chat beat is honest. If not, adjust that section to say "could be used" and move the VISUAL to a generic chat example rather than claiming it was done.
- Confirm whether the montage beats are sourced from final-cut episode footage or captured separately — determine before the edit whether the cold-open montage needs its own screen-capture session.
- Confirm the trial length is 100 days (the "72 left" math depends on this) — if the trial term has changed, adjust the counter and VO accordingly.
- Confirm the "$0 to closed models" figure is accurate for the recording context — if any test-mode closed-model API calls were made during production, determine whether to adjust the framing to "production workload" rather than an absolute zero.
