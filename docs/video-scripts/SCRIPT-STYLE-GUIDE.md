# Video Script Style Guide (shared across all episode scripts)

Source of truth for content: `docs/video-series-saas-on-open-weights.md` (the series bible).
Every script must match its episode section there — same beats, skills, features, payoff.

## Voice & tone

- Plain, conversational, first person — like showing a colleague your setup, not pitching a product.
- State what you do and what happens. Don't editorialize the outcome or tell the viewer it's impressive — let them judge.
- No hype or superlatives. Cut: "production-grade", "airtight", "bulletproof", "the whole game", "miles ahead",
  "never dropped a beat", "watch this", "seamless", "effortless", "game-changing", "the magic". No emojis.
- Don't tell the viewer how to feel ("this should make you nervous", "the part you'd dread"). Just describe it.
- Be honest about limits and trade-offs. If a step is rough, slow, or a model struggles, say so. Open weights are a
  choice with trade-offs, not a crusade — present cost and control as facts, never as proof they're "better".
- Invite, don't push: "you can decide if that fits how you work", "if that's useful to you". Avoid urgency/FOMO.
- Pace budget: ~130–150 spoken words/minute, minus demo dead-time. Prefer silence over filler. VO rides over the
  action — it doesn't nararte every click.

## On-screen conventions (every episode)

- **Cold open** shows the Ptah Desktop chat with the **open-weight model badge** visible — factual, not a slogan.
- A small **trial-day counter** lower-third (e.g. "Day 3 / 100") for series continuity.
- Mention cost/control **once, factually** where relevant (E00, E08, E12) — state that the run used open weights and
  what that means. Don't repeat it as a recurring banner or slogan, and don't claim it's superior to closed models.
- Every milestone **ends green** (build/test passes) before the section cuts — show it, don't oversell it.

## Document format (use exactly this skeleton)

```
# E<nn> — <Title> — Full Script

**Length:** … · **Trial day:** … · **Runtime:** Ptah Desktop (Electron) · **Orchestrator:** Kimi (open weight, Ollama Cloud)
**Goal:** one sentence. **Controlling thesis:** one line.

## Pre-record checklist
- … (from the bible's "Pre-record setup" + "Pitfalls")

## Assets / overlays
- … (from the bible's "Assets")

---

### [00:00–00:XX] Cold open
- **VISUAL:** …
- **VO:** "word-for-word…"
- **ON-SCREEN:** caption / lower-third text
- **SFX/B-ROLL:** (optional)

### [00:XX–0X:XX] <Section name>
- **VISUAL:** …
- **VO:** "…"
- **ON-SCREEN:** …
(repeat beats)

### [0X:XX–end] CTA / End screen
- **VISUAL:** …
- **VO:** "…"
- **ON-SCREEN:** …

---

## Shot list (quick capture summary)
- …

## [VERIFY] flags (anything not nailed down by the bible)
- …
```

## Accuracy guardrails (hard rules)

- Use the **real** names: `/orchestrate`, `/review-code|logic|security`, `nx-workspace-architect`,
  `ddd-architecture`, `nestjs-backend-patterns`, `resilient-nestjs-patterns`, `saas-platform-patterns`,
  `webhook-architecture`, `nestjs-deployment`, `angular-frontend-patterns`, `ui-ux-designer`,
  `skill-creator`, `ptah_agent_spawn` (codex / copilot / ptah-cli).
- **Do not invent UI click-paths.** Where the exact desktop menu/button path isn't established in the
  bible, write the VO generically ("open the provider settings") and add a `[VERIFY]` flag — never
  fabricate a specific menu label.
- **No secrets on screen, ever.** Reference test-mode keys; tell the editor to blur/omit.
- Honor the runtime: **Electron desktop only**; Memory/Skills/Schedules/Gateway are desktop features.
- Keep continuity: each episode opens from the green state the previous one ended in.
