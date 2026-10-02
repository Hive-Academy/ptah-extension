---
workflow: general-video
flow: automation
storyboard: yes
message: "Your agents work in parallel lanes, and they talk back."
destination: web-and-social
aspect: 1920x1080
language: en
audience: developers who already use AI coding agents
length: 14s (Act 1 prototype)
angle: product-explainer
---

## Intent

Comparison prototype C ("Group chat", as the session transcript) for the agent-lanes promo, the pilot of a series of small feature promos. The user asked to try direction A (Swimlanes, `projects/agent-lanes-v3`) and C side by side, Act 1 only (2026-10-01). Same beats, captions, music and SFX as A; only the visual world differs.

Truth note: the product does not show lanes as chat participants. C therefore shows your session's real transcript: the prompt, the gold `ptah_agent_spawn` rows, the Agents panel as proof, and the pushed result arriving at the bottom of the transcript (kit `lane-completion-toast`, a labelled visualization of the `<agent-lane-completed>` turn).

## Notes

- Same rules as `../agent-lanes-v3/BRIEF.md` and `STORYBOARD.md` (v2): one caption per beat, never two kit components on top of each other, no `data-layout-ignore` / `-allow-*`.
- Pipeline: fragments in `compositions/frames/`, `node assemble.mjs` writes `index.html` from `src/index.tpl`.
