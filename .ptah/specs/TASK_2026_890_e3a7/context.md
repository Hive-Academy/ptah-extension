# Context — TASK_2026_890_e3a7

- **User request**: find and fill the gaps between the PtahCode Electron app and `apps/ptah-docs`.
  Inventory first (user picks pages), then pages, then starlight-links-validator, then an
  independent different-family review with one fix round and one re-review.
- **Prior task**: TASK_2026_889_d57a (PR #967, merged 2026-11-07). Its `facts.md` and
  `decisions.md` are inputs. Do not redo its claim corrections.
- **Known missing pages** (user): remote machines, MCP caller authentication, session
  inspector, memory corpus and timeline.
- **Worktree**: `D:\projects\ptah-extension\.claude-worktrees\docs-gap-fill`, branch
  `docs/docs-gap-fill`, base `origin/main` @ bce361218. PR base: `main` (PR #967 merged).

## Gate 0.1 — CLI lanes

- Preference source: user global CLAUDE.md ("delegate heavily to CLI lanes, prefer non-Claude")
  + the request ("CLI lane, prefer a non-Claude vendor"). Memory: `cli-lane-selection-preference`
  (newest ULID, spread across codex, GLM, opencode) supersedes the older
  `cli-lane-vendor-preference` (never grok/opencode). grok is still avoided.
- Mode: `enabled`. Approval mode: `lane-review` (no Gate 1/2 documents; the user gate is the
  inventory checkpoint the user asked for).
- `ptah_agent_list` at start: codex installed (Weekly 99%, near limit, resets 2026-11-08 19:45
  UTC); copilot disabled; cursor, pi not installed; antigravity installed (limits unknown);
  opencode installed (no usage source); grok installed (unknown); claude installed (unknown);
  Glm AT LIMIT (resets 2026-11-09); kimi code AT LIMIT (resets 2026-11-25).

## Lane exhaustion

| Lane | Family | Cause | Reset |
| ---- | ------ | ----- | ----- |
| opencode (agents 4ea79b5e, 9e1b5553) | opencode | usage limit: "Free usage limit reached" in lane output, 0 tool calls | reset unknown — skip for this run |

| antigravity (agents 6bd62cb4, cdf33d7b) | antigravity | usage limit: "RESOURCE_EXHAUSTED (429) Individual quota reached … Resets in 157h13m" | ~2026-11-14 (157 h) — skip for this run |

Fallback chain: opencode → antigravity (both exhausted) → codex skipped (Weekly 99%, too little
room for an inventory) → grok skipped (memory `cli-lane-vendor-preference`) → `claude` CLI lanes
A (7468f65d) and B (6da0441e), `accountSelection: ambient` (the default named-account route was
refused: `unsupported-source`). Disclosed to the user; the request said "prefer" non-Claude.

Phase 2 writers (claude): W1 a518fb1d, W2 56cbdfc9, W3 48cad172 (spawned 14:18 UTC).
At that spawn, codex showed a new weekly window (0%, resets 2026-11-14) → reviewer codex has
room. grok now AT LIMIT (resets 2026-11-12).
