# E00 — Setup — Full Script

**Length:** 8–10 min · **Trial day:** Day 1 / 100 · **Runtime:** Ptah Desktop (Electron) · **Orchestrator:** Kimi (open weight, Ollama Cloud)
**Goal:** Get the rig set up on camera — an open-weight model and the CLI agents — and explain plainly what the series is going to do.
**What this episode is:** the setup video. Nothing gets built yet.

## Pre-record checklist

- Clean machine/user profile; Ptah Desktop installed and ready to first-launch on camera.
- Ollama Cloud account + Kimi model access confirmed working in a dry run.
- `codex`, `copilot`, `ptah-cli` installed and reachable from the desktop app (smoke-tested).
- Throwaway `TaskFlow` folder created.
- Pre-test the exact Kimi model id and that the model badge renders it.
- Secrets/endpoints staged off-camera; editor will blur anything sensitive.

## Assets / overlays

- Trial-day counter ("Day 1 / 100") — small, for continuity.
- Simple diagram: main model (Kimi) → CLI agents (codex / copilot / ptah-cli).
- Plain card listing what the series builds (task manager: accounts, tenants, billing, front end).

---

### [00:00–00:30] Cold open

- **VISUAL:** Ptah Desktop chat open, model badge visible in the corner.
- **VO:** "I'm going to build a SaaS — a real one, with accounts, multiple tenants, and billing — using open-weight models instead of a closed, hosted one. The whole thing runs in one desktop app called Ptah. This first video is just setup: getting the model and the tools wired up. Let's get into it."
- **ON-SCREEN:** "Day 1 / 100"

### [00:30–01:15] What the series is

- **VISUAL:** Plain card: what gets built, listed simply.
- **VO:** "Quick outline. I'm building inside Ptah's desktop app. The model doing the planning and the writing is an open-weight one. What we end up with is a working task manager — accounts, tenants, billing, a front end. And along the way you'll see most of what this app can do. I'll point things out as I go, and I'll be honest when a step is rough or when a closed model would probably handle it more smoothly."

### [01:15–02:30] First launch — the setup wizard

- **VISUAL:** First launch; the setup wizard opens. Click through at a steady pace.
- **VO:** "First launch drops you into a setup wizard. It covers the basics — your details, how you want it to work, and which model runs your agents. I'll move through it. The one screen I actually want to stop on is the provider."
- **ON-SCREEN (lower-third):** "Setup wizard"

### [02:30–04:30] Pick the model (Kimi via Ollama Cloud)

- **VISUAL:** Open the provider settings; point it at Ollama Cloud; select the Kimi model. [VERIFY exact desktop path on camera — I'll point this out live.]
- **VO:** "Ptah can use any Anthropic-compatible endpoint as a provider, including open-weight hosts. I'm pointing it at Ollama Cloud and choosing Kimi as the main model — that's the one that plans and reviews everything. Let me send a turn just to confirm it's connected."
- **VISUAL:** Send a short message; response streams; badge shows the model.
- **VO:** "There's the model, in the badge. That's running on open weights. Whether that matters to you depends on what you care about — cost, keeping your data off a third party, not being tied to one vendor. For me that's the reason I'm doing the series this way, but it's a trade-off like anything else. A closed model might get through some of these steps with less back-and-forth. We'll see where it holds up and where it doesn't."
- **ON-SCREEN (lower-third):** "Main model: Kimi (open weight)"

### [04:30–06:30] The CLI agents

- **VISUAL:** Simple diagram: main model → codex / copilot / ptah-cli.
- **VO:** "One model on its own is slow for a big build, so Ptah can hand work to command-line agents — codex, copilot, and Ptah's own CLI. The idea is the main model does the planning, and these handle the repetitive parts, sometimes a few at once. The pattern is straightforward: it sends a self-contained task, the agent runs it on its own, the result comes back."
- **VISUAL:** Ask the main model to hand a throwaway task to one CLI agent (e.g. print the Node version). Show it dispatch and return.
- **VO:** "Here it's just confirming the Node version — nothing useful yet. But this is the same mechanism that'll be scaffolding code and writing tests later. I'll flag it each time it happens so you can see which parts I did and which parts an agent did."
- **ON-SCREEN (lower-third):** "CLI agents: codex / copilot / ptah-cli"

### [06:30–07:40] Where that leaves us

- **VISUAL:** Back on the chat; the empty TaskFlow folder in the file tree.
- **VO:** "So that's the setup. An open-weight model for the planning, a few CLI agents for the legwork, and the memory, skills, scheduling, and remote features that come with the app — we'll get to those when there's a reason to. Nothing's been built yet. This is just the bench."

### [07:40–08:30] CTA / End screen

- **VISUAL:** Cursor in the chat box, ready.
- **VO:** "Next time I take a one-line idea — a task manager SaaS — and turn it into an actual plan using Ptah's orchestration. If you want to see how far an open-weight setup gets on a real project, the rest of the series follows it through to a deployed app. I'll see you in the next one."
- **ON-SCREEN:** End card — "Next: Idea → Roadmap" · "Day 2 / 100".

---

## Shot list (quick capture summary)

1. Cold open on Ptah Desktop chat + model badge.
2. "What gets built" card.
3. Setup wizard walkthrough, pause on provider step.
4. Provider settings → Ollama Cloud + Kimi. [point out live]
5. First chat turn + badge.
6. Main-model → CLI-agents diagram.
7. CLI agent smoke task (dispatch + return).
8. Empty TaskFlow folder.
9. End card.

## [VERIFY] flags (I'll point these out live on camera)

- Exact desktop path for selecting Ollama Cloud + the Kimi model, and how the badge renders the name.
- The in-chat way to hand a task to a CLI agent from the desktop app.
- Current free-trial length wording ("/ 100" framing) — adjust counter if different.
