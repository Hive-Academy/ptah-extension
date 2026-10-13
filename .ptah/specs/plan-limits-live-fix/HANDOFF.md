# Handoff — plan limits live fix

Branch: `fix/plan-limits-live-providers` (from `main` @ 43803ee7e). **Nothing committed. Local only, no PR.**
Working tree: ~41 changed/new files across `shared`, `auth-providers`, `cli-agent-runtime`, `rpc-handlers`, `dashboard`, `chat-ui`.

## State at handoff (2026-10-13)

Revise round 1 of 2 is done for both review tracks. No re-review has run yet.

| Provider                                            | Root cause (proved live)                                                                                                                  | Fix                                                                                                                                                                                            | Live after                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Codex                                               | 3000 ms lookup deadline < 4.5–6.2 s `codex app-server` cold start                                                                         | `limitLookupDeadlineMs()` + `SLOW_LIMIT_LOOKUP_DEADLINE_MS` (12 s) in `libs/shared/src/lib/utils/plan-limits/evidence-precedence.ts`, used by lane lookup, owner discovery, dashboard snapshot | weekly 18% in 4.3 s                              |
| OpenCode                                            | v2.0.12 has no `auth.json`; login is in `opencode.db` table `credential`                                                                  | `opencode-go-credential.ts` reads v2 store (node:sqlite, in place read-only), owner detection + reader; 401/expired → sign-in state                                                            | 5h 15%, weekly 15%, monthly 81%                  |
| Antigravity (REVERTED, see review-r2-resolution.md) | reader expected t3code's `antigravity-acp/acp_token.json`; agy keeps token in OS keyring (`gemini:antigravity`); owner gate skipped OAuth | `readers/antigravity-keyring.ts` (Win/macOS/Linux), embedded public installed-app client, token cache bound to verified account (ID token), abortable, single-flight                           | 4 windows (Gemini wk 26.3%, Claude/GPT wk 49.4%) |
| Ollama                                              | Glm agent slot holds placeholder `"ollama"`; reader expected a % body that does not exist                                                 | owner + key follow `usesOllamaSignInFallback`; `/api/usage` request counts shown, source `'provider-api'`                                                                                      | 2,610 requests / 7 days                          |
| UI                                                  | limits section inside Session Analytics; per-provider layouts                                                                             | own card above analytics (`dashboard-grid`), one row grid `15rem minmax(0,1fr) 2rem` in `provider-account-row.component.ts`                                                                    | not seen rendered yet                            |

User decisions (final): Antigravity = keyring + embedded client. Ollama = show request counts.
Accepted trade-off: a cold Codex/Antigravity read can hold the whole lookup/dashboard response up to 12 s (documented in `lane-limit-lookup.service.ts` header).

## Checks at handoff (all green)

- typecheck: shared, auth-providers, cli-agent-runtime, rpc-handlers, dashboard, chat-ui
- jest: auth-providers quota 305/305; cli-agent-runtime limits 124/124; rpc-handlers snapshot 10/10; shared evidence-precedence 16/16; dashboard 175/175; chat-ui plan-limits 89/89
- lint (before round 1): 0 errors on the 5 original projects. chat-ui not linted yet.

## Remaining steps

1. **Re-review round 2 (cross-side, last allowed round):**
   - CLI lane reviews in-process-authored code against `code-logic-review-lane.md` + `antigravity-ollama-revise-1.md`.
   - Claude subagent reviews CLI-authored code against `code-logic-review.md` + `opencode-revise-1.md`.
   - Remaining open item from `code-logic-review.md`: #8 hard-coded slow-provider set (minor, accepted unless reviewer objects).
2. Lint all 6 projects (`--parallel=1`).
3. **Visual check** (required for UI): rebuild/reload Ptah (user runs it, or user approves `build`/`serve`), then visual-reviewer screenshots of the Dashboard in dark + light, before (main) vs after. Confirm every provider row aligns and the limits card sits above Session Analytics.
4. Confirm `ptah_agent_list` after reload: codex/antigravity/opencode/Glm show real limit states (the running host still had old code).
5. Delete `.ptah/specs/plan-limits-live-fix/probe/` (throwaway; contains a `vscode` stub under `out/node_modules`) — do not commit it.
6. Commit (commitlint style), push, open PR to `main`, report link.

## Key files

- Reports: this folder — `codex-report.md`, `codex-fix-report.md`, `opencode-report.md`, `opencode-fix-report.md`, `opencode-revise-1.md`, `antigravity-ollama-report.md`, `antigravity-ollama-revise-1.md`, `ui-report.md`, reviews `code-logic-review.md` (Claude) and `code-logic-review-lane.md` (Codex).
- Lane sessions (resumable): Codex `01a132e7-4095-74a2-80ea-d8efc9c9d949` (reviewer), OpenCode `ses_ecd3d84a0ffefYN06z7gO31p6l` (author). Resume only within the idle window; else a fresh lane with this file.
- Rules: `context.md` (live repro, no secrets, scoped checks only).
