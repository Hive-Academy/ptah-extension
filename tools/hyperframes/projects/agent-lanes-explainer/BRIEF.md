---
workflow: general-video
flow: automation
storyboard: no
message: "Behind one Ptah chat, a main agent, in-process subagents and CLI lanes of any model family work as one team, and they talk to each other."
destination: youtube-x-linkedin-landing
aspect: "16:9"
length: 90s
language: en
audience: developers and engineering leads
---

# Brief: how Ptah lanes work (illustrated explainer)

## Intent

User's words: "build a beautiful and high resolution illustrations of how our (main agent, subagents, cli lanes) work
based on your understanding of the agent lanes skills, and how each agent session can easily communicate to each
other and how different families can be easily used". No footage. Music and SFX only.

## Assets

- Illustrations: all SVG/CSS, drawn in the composition (sharp at 4K via `--resolution 4k`).
- Family logos: resolved with media-use (`.media/images`, copied to `assets/logos/`). Pi has no mark: "π" monogram.
- Music: `mixkit-uplifting-bass.mp3` (134 BPM) from `apps/ptah-video-studio/assets/music`.

## Notes

Facts come from the code: SYSTEM_CLI_TYPES (`libs/shared/src/lib/types/agent-process.types.ts:58-65`), the provider
registry (`libs/shared/src/lib/providers/`), the ptah_agent_* tools (`tool-description.builder.ts`), the completion
envelope (`lane-completion-notifier.service.ts:342-397`), Peer sessions (`peer-session-messenger.service.ts`) and
`.claude/skills/agent-lanes/SKILL.md`.
