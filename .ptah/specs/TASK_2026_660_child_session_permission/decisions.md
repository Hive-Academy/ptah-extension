
## 2026-10-14 — codex review (code-logic-review.md) fix round
- Fix all 3 findings in one round (orchestration rule: Blocking and Serious are fixed).
- F1: an unknown parent level falls back to `ask`, never to the saved global level.
- F2: an explicit `null` session id from the webview saves the default but changes no live
  session. Omission (legacy CLI/TUI callers) keeps today's behaviour.
- F3: keep the earlier decision "no broadcast to every live session" (gateway gate,
  per-workspace scope, derived child levels; fix-report-autopilot-target.md Decision 1).
  Fix only the display: the popover shows its tab's live session level, and the global
  default for a tab without a session. Evidence: reviewer fix suggestion; no layout change,
  so the change is pinned by specs, not screenshots (value shown, not the surface).
