# TASK_2026_877_85fa — README refresh for v2

## Request

Rewrite the GitHub README from the hidden-features analysis (TASK_2026_875_8be2, PR #931).
Replace the old YouTube video with the video the landing hero uses. Update the screenshots and
every other stale detail.

## Classification

- Type: DOCUMENTATION, Partial. Worktree `.claude-worktrees/readme-v2`, branch `docs/readme-v2`.
- Gate 0.1: lanes enabled (memory + user CLAUDE.md). Glm/kimi at limit, opencode fails on its Glm
  model. User did not object to codex after the disclosure in TASK_2026_875_8be2.

## Decisions

| Decision | Evidence |
| --- | --- |
| Hero video = `orchestration.mp4` with poster `orchestration.jpg` | `libs/web/landing/src/lib/live-demo/live-demo-catalog.ts:14-19`, hero spec uses it |
| GitHub cannot play a raw mp4 inline, so the README shows the poster image linked to the mp4 | GitHub markdown renders only user-attachment videos inline |
| New screenshots come from the existing mocked-RPC harness `apps/ptah-electron-e2e/src/docs-screenshots` via `nx run ptah-docs:screenshots` (user asked for screenshots, so this run is authorized) | `apps/ptah-electron-e2e/docs-screenshots.config.ts:7-8` |
| New screenshot names are fixed up front so the README and screenshot lanes can run in parallel: `v2-session-rail`, `v2-voice-stage`, `v2-apps`, `v2-thoth-memory`, `v2-attention-bell`, `v2-display-panel` | Orchestrator decision |
| Claims flagged as unverified in the analysis do not go in the README | analysis § Claims to verify |

## Lanes

- Lane R (grok, technical-content-writer): `README.md`.
- Lane S (codex, frontend-developer): new shot files + PNGs + `screenshots-report.md`.
