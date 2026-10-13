# Plan limits — live fix (branch fix/plan-limits-live-providers)

## User report (2026-10-13, Electron Dashboard screenshot)

- Claude row: OK (5-hour "Usage unknown" + weekly 41% + Weekly·Fable 0%).
- OpenCode: "No usage source" / "Local usage only" — user has OpenCode logged in (v2.0.12, `opencode auth list` shows "OpenCode Default stored"; NO `~/.local/share/opencode/auth.json` exists; data dir has `opencode.db`).
- Antigravity: "Usage unavailable — Open Antigravity to read local quota". Creds present: `~/.gemini/oauth_creds.json`, `~/.gemini/antigravity-cli/`, `~/.gemini/google_accounts.json`. `antigravity-acp/acp_token.json` does NOT exist.
- Codex: "Codex identity unavailable — usage service did not return a readable response". codex-cli 0.162.1, `~/.codex/auth.json` exists. `ptah_agent_list` reports "limit lookup timed out".
- Ollama Cloud: "(owner unknown) (key unavailable) — API key rejected — check the key", but the user's Ollama Cloud provider ("Glm", ptah-cli) works for chat. No OLLAMA_API_KEY env var; key lives in Ptah's provider config/secret store.
- UI: the "Provider accounts & plan limits" section sits INSIDE "Session Analytics"; must move ABOVE it as its own section. Rows are misaligned across providers; only Claude looks right.

## Prior work (failed to fix at runtime)

- `.ptah/specs/plan-limits-ui/research-and-plan.md` — t3code comparison (read-only, never verified live).

## Rules for every lane / subagent

- Reproduce LIVE on this machine before and after the fix (small node/tsx script or CLI call). Code review alone is not acceptable — that is why prior attempts failed.
- Never print, log or write secrets/tokens/emails. Redact.
- Verification is scoped: `npx jest -c libs/backend/auth-providers/jest.config.ts <spec> --coverage=false --maxWorkers=2`, `npx nx typecheck <project>`. Never build/serve/e2e, never workspace-wide runs, one heavy check at a time.
- No git commit/push/stash/reset/restore/checkout. Do not revert changes you did not make.
