# Context — TASK_2026_875_af9e

Request: make three unstable CI tests deterministic in one PR (see evidence.md). Test files only;
production-code changes need user approval first. Prove Jest fixes stable with repeated
`npm run verify` runs; e2e relies on CI only.

- Type: BUGFIX, depth Minimal/Partial (three file-disjoint test files).
- Worktree: `/home/amun/ptah-extension/.claude-worktrees/flaky-ci-tests`, branch `fix/flaky-ci-tests`.
- Gate 0.1: preference source = memory (`cli-lane-context-handoffs`: user wants CLI lanes used
  proactively, Codex implementation lane where available). Mode `enabled`. Approval mode
  `lane-review` (BUGFIX has no document gates).
- `ptah_agent_list` rows: codex installed (Weekly 53%, room); grok installed (limits unknown);
  antigravity installed (reader failed); Ollama Code near limit (98% weekly); kimi AT LIMIT;
  copilot, claude disabled; cursor, opencode, pi not installed.

## Executors
- Spec 1 (agent-pack-download): codex lane.
- Spec 2 (markdown reducer): backend-developer subagent (claude family).
- Spec 3 (marketplace e2e): orchestrator, scoped locator edit (trivial).
- Final review: grok lane (different family from codex and claude).
