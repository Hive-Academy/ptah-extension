---
workflow: general-video
flow: automation
storyboard: yes
message: "One prompt puts a whole AI team to work, and every result comes back to your session."
destination: web-and-social
aspect: 1920x1080
language: en
audience: developers who already use AI coding agents
length: 47s
angle: product-explainer
---

## Intent

Explainer v3 for Ptah's agent orchestration, built only from the `ptah-ui` motion kit
(`tools/hyperframes/kits/ptah-ui`, real anubis UI, never screenshots or generic cards).
It replaces v2 (`projects/agent-lanes-v2`), which the user rejected for small text and
drifting background blobs. The footage promo was judged too slow, so v3 runs faster:
one idea per bar group, cuts on bars, entrances on beats.

User's words: "Hook A (glitch-to-clarity on app-window, camera 3.5 -> 1.0 on the drop),
feature scenes inside the 2+2 live sessions, one scene file per frame under
compositions/frames/, shader transitions, kinetic titles, outro lockup."

## Assets

- assets/music/mixkit-uplifting-bass.mp3 — music bed (134 BPM, drop at 14.366 s), copied from agent-lanes-v2.
- assets/sfx/*.mp3 — 19 media-use SFX, copied from agent-lanes-v2.
- assets/brand/ptah-icon.png — Ptah icon for app-window logo and outro lockup.

## Customizations

- Camera moves through `/hyperframes-keyframes` (seek-safe keyframes on a camera wrapper).
- SFX bus through `/hyperframes-audio` (`<hf-audio-group>` with one chain and fader).
- `*.motion.json` sidecar per scene so `check` verifies motion intent.
- Shader transitions through `@hyperframes/shader-transitions` (`HyperShader.init`).

## Notes

- Follow `tools/hyperframes/PLAYBOOK.md` and `kits/ptah-ui/SPEC.md`.
- Type floor 26 px on screen. Read small UI by camera zoom, never by a smaller mount.
- Background: flat `#131317` + one static vignette. No blobs, particles, or grain on the UI.
- Copy rules: Peer result says "Accepted", never "delivered" or "received". The lane toast
  carries the eyebrow "PUSHED TO THE PARENT SESSION" (it is a kit visualization).
- CTA facts: "Free and open source" and `ptah.live` come from
  `apps/ptah-landing-page/src/index.html:12,53-57`.
- Render only with `node tools/hyperframes/render.mjs` after the user approves the preview.

## v2 re-plan (2026-10-01)

The user rejected v1's dive scenes: stacked components, no clear message. v2 keeps the workflow (general-video), aspect (1920x1080), music and kit, and re-plans scenes, seams and on-screen messaging around two capabilities only: agent lanes (parallel background CLI agents whose results are pushed back to the session) and agent messaging (steer a running lane, a lane reports mid-run, session-to-session Peer messages). Candidate message: "Your agents work in parallel lanes, and they talk back." One focus per beat; at most one kit component on screen at a time. Direction pending the user's choice (see STORYBOARD.md, "Changes from v1").

Series context (user, 2026-10-01): Ptah has too many features for one film. The plan is a series of small promos, each about one group of related features; agent lanes (+ agent messaging) is the first one and the pilot for the series grammar. "Glm" is the user's name for their Ollama Cloud CLI lane and may appear on screen.
