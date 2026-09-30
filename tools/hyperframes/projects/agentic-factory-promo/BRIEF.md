---
workflow: general-video
flow: automation
storyboard: no
message: "Ptah is an agentic factory: one prompt runs a whole engineering team across the full SDLC."
destination: youtube-x-linkedin-landing
aspect: "16:9"
length: 90s
language: en
audience: developers and engineering leads
---

# Brief: Ptah agentic factory promo

## Intent

Promo cut from the screen recording `apps/ptah-video-studio/promos/Recording 2026-09-30 172846.mp4` (4:55, 1914x1032).
The user's words: "showing a screenrecording for different ptah sessions going through tasks with our
agent-lanes skills for orchestration between claude main agent with its subagents and cli tools like
antigravity and ollama through GLM and how we provide the agent mcp tool for communication between
different lanes and how we support talking directly to those lanes and also i showed our ci and review
pipelines with codeRabbit and sonarqube and how our agent is connected to them and can access the comments
and failed ci and fix them to have a full SDLC agentic workflow (agentic factory, ai factory)".

## Assets

- Footage: the recording above, re-encoded to `assets/footage/rec.mp4` (short GOP, no audio).
- Stills: `assets/stills/s100.png` (CodeRabbit comment), `assets/stills/s232.png` (SonarQube gate + checks).
- Brand: `assets/brand/ptah-icon.png`; palette and URL from `apps/ptah-video-studio/src/brand.config.ts`.
- Music: `mixkit-deep-techno-ambience.mp3` from `apps/ptah-video-studio/assets/music` (125 BPM).
- SFX: the 19 bundled media-use SFX.

## Customizations

- Music and SFX only. No voiceover. Source audio of the recording is muted.
- Rendered fully in HyperFrames. No DaVinci Resolve step.

## Notes

- HeyGen not signed in; MusicGen deps missing. Music adopted from the repository instead.
- Browser tabs and bookmarks in the GitHub segments are cropped out. The Greptile "trial has ended" note is out of frame.
