# Decisions - TASK_2026_678_9083

| # | Decision | Evidence | Step | Reversible |
| - | -------- | -------- | ---- | ---------- |
| 1 | Classify as FEATURE, Full depth | New page, unclear scope, many libs | evidence | yes |
| 2 | Research before PM, split in two codex lanes (property-hub ElevenLabs, Ptah reuse) | User asked which requirements already exist; codex is the only lane with confirmed room | evidence | yes |
| 3 | Lanes enabled, approval mode lane-review | Memory `orchestration-executor-preference`; codex spawnable | evidence | yes |
| 4 | Voice = Hybrid ConvAI; hosts = Electron only; canvas = orchestrator's own tree | AskUserQuestion answers | user | yes |
| 5 | Reuse Ptah voice-providers key vault and settings, do not port property-hub Nest proxy | research-ptah-reuse.md §6, research-property-hub-elevenlabs.md Decisions | evidence | yes |
| 6 | Run ElevenLabs ConvAI API research in parallel with PM | Neither repo has ConvAI code; architect needs transport, auth, client tools, contextual update facts | evidence | yes |
| 7 | Voice = existing chat session + existing voice config, no ConvAI (supersedes #4 voice part and #6); ConvAI lane stopped | User correction 2026-10-15 | user | yes |
| 8 | Gate 1 passed (lane-review): task-description.md rev 3, author codex PM lane, reviewer in-process Claude subagent, round 2 APPROVED | task-description-review.md | peer | yes |
| 9 | PM-proposed rules accepted pending user objection: AC22 no voice tool approval, AC6 barge-in queues, AC25 one session + regular chat read-only during voice, AC16 resume offer, AC24 bounded speech | task-description-review.md Lane-introduced constraints | peer | yes |
| 10 | Designer on codex lane; prototype = one self-contained HTML file with real canvas, dark + light | Lanes-first preference; Gate 1.7 needs a prototype | evidence | yes |
| 11 | Restart design as a 3D WebGL scene (spheres, lucide icons, GSAP motion) with a performance budget; 2D revision lane stopped; Gate 1.7 rev-1 findings carried as requirements | User direction 2026-10-15 | user | yes |
| 13 | NO 3D libraries (no three.js, no @hive-academy/angular-3d): pseudo-3D spheres with Canvas 2D drawing + enhanced CSS transforms; supersedes #12; 3D lane stopped before writing | User direction 2026-10-15 | user | yes |
| 14 | Agent nodes use existing provider brand marks (PROVIDER_BRAND_ART path data via Path2D, PROVIDER_BRAND_SLUGS mapping, ptah-brand-mark in DOM, monogram fallback); subagents/participants show parent provider mark + name chip | User request 2026-10-15; libs/frontend/ui/src/lib/native/brand-mark/* | user | yes |
| 15 | Gate 1.7 passed (lane-review): design-spec rev 3 + prototype, author codex designer lane, reviewer in-process Claude subagent, round 3 APPROVED; open Moderates (PROVIDER_BRAND_ART export path vs barrel guard, tribunal orb "T" monogram vs shield icon, 12 stale screenshots, p95 5.4 ms outlier, Electron perf gate procedure/owner) carried to architect | design-spec-review.md | peer | yes |
| 16 | Architect on codex lane; Gate 2 reviewer in-process subagent | Lanes-first; opposite-side review | evidence | yes |
| 17 | Voice-started Tribunal: Ptah proposes roster from ptah_agent_list (skip AT LIMIT, honor saved lane preferences), speaks a summary, shows a confirm card (lanes, mode, rounds); spawns start only after explicit click/key (same rule as AC22) | AskUserQuestion answer 2026-10-15 (Gate 2 round 2 finding N0) | user | yes |
| 18 | Gate 2 escalated at revise cap (open S1); user chose "Approve + apply fix": binding Amendment A1 added to implementation-plan.md (page owns Tribunal launch decision, Confirm never sent to the model, separate coordinator launch turn after explicit click/key, page verifies Decline-first) | implementation-plan-review.md round 3; AskUserQuestion 2026-10-15 | user | yes |
| 19 | Property-hub voice code (vad.ts, sentence-chunker.ts, tts-playback-queue.ts + specs) may be adapted; user owns both repositories (resolves plan's licence deferral) | AskUserQuestion 2026-10-15 | user | yes |
| 12 | (superseded by #13) Prototype uses raw three.js from installed node_modules served over local HTTP; Angular binding (raw three.js service vs adding @hive-academy/angular-3d) left to architect | three 0.185.1 in package.json; angular-3d not installed; file:// blocks ES modules | evidence | yes |
