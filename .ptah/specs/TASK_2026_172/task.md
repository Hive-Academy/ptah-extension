---
id: TASK_2026_172
status: in_review
type: BUGFIX
title: Provider auth follow-up — fix claude-cli misroute, Copilot logout, Ollama/Ollama Cloud gaps
description: Fix the provider-auth defects surfaced by the 2026-08-02 TUI audit that were out of scope for the TUI batch because they change cross-platform behavior (libs/shared strategy resolution, Copilot logout) or add new affordances (Ollama Cloud key field, local endpoint defaults). Claude subscription (claude-cli), Copilot logout, Ollama, and Ollama Cloud must all work correctly on Electron, VS Code, CLI, and TUI.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-02T00:00:00.000Z
updated: 2026-08-02T00:00:00.000Z
---

## Description

Follow-up to the TUI auth/setup/chat fix batch (Copilot device-code push, real Codex device-auth spawn, first-run view, workspacePath threading, workspace-activation await, EngineContext fireAndForget/dispose). That batch deliberately stopped on anything that changes behavior for VS Code/Electron. This task finishes the list. Electron remains the reference implementation: its test baseline must be unchanged except where a fix below is the explicit intent.

### Issue 1 — `claude-cli` (Claude Subscription) tile is misrouted to an Ollama probe (CROSS-PLATFORM, highest priority)

- Selecting the Claude Subscription tile saves `authMethod: 'thirdParty'`; strategy resolution at `libs/shared/.../auth-strategy.types.ts:62-63` maps `authType: 'none'` + no proxy to `local-native`.
- `LocalNativeStrategy` then runs an Ollama version probe against `127.0.0.1:11434` and sets `ANTHROPIC_BASE_URL=''` plus an Ollama placeholder token.
- `nativeAuth: true` is read by no strategy anywhere. There is NO Claude OAuth/setup-token flow in the repo; subscription auth means ambient `~/.claude` CLI credentials, i.e. the SDK's default auth path.

Fix: introduce an explicit strategy route for ambient/subscription credentials (e.g. a dedicated `subscription`/`ambient` strategy id selected when the claude-cli tile is chosen) that leaves the Agent SDK on its default credential chain — no base-URL override, no placeholder token, no localhost probe. Update the tile save path so it can never fall into `local-native`. Cover resolution with table-driven specs across all `authType` x proxy x provider combinations so the routing matrix is pinned.

### Issue 2 — Copilot logout does not stick (CROSS-PLATFORM, design decision required)

- `logout()` nulls in-memory state but `~/.config/github-copilot/hosts.json` survives, so the next `configure` silently re-authenticates via `tryRestoreAuth()`.
- CAUTION: `hosts.json` is shared with the user's real GitHub Copilot editor integrations. Deleting it would log them out of Copilot everywhere. Preferred design: persist a Ptah-side logout tombstone (settings-core) that `tryRestoreAuth()` respects, cleared on the next explicit login. Only delete `hosts.json` if we can prove Ptah created it. Record the chosen design in the implementation notes.

### Issue 3 — Ollama Cloud optional API key is unreachable in the TUI

- `apps/ptah-tui/src/components/settings/AuthSection.tsx:684-691` short-circuits on `authType: 'none'` before checking `supportsOptionalApiKey`, so the optional key form never renders. Fix the form flow; verify save + testConnection round-trip with and without a key.

### Issue 4 — Local provider endpoint defaults are wrong

- `LocalConfig` hardcodes `http://localhost:1234` for every non-`ollama` local provider. Give each local provider its correct default (Ollama 11434, LM Studio 1234, etc.) sourced from one table, not scattered literals.

### Issue 5 — Copilot success toast always says "Connected as GitHub user"

- `CliPlatformAuth.getGitHubUsername()` returns `undefined` unconditionally. Read the username from `hosts.json` (or the token exchange response) in the CLI runtime so the TUI/CLI toast shows the real account, matching VS Code behavior.

### Verification matrix (acceptance criteria)

1. `claude-cli` tile on Electron, VS Code, and TUI: selecting it with valid ambient `~/.claude` credentials produces a working chat turn; no request ever hits `127.0.0.1:11434`; `ANTHROPIC_BASE_URL` is untouched.
2. API-key Claude, Moonshot, Z.AI, OpenRouter, Sakana flows regress-tested (no strategy-resolution change may affect them — pinned by the routing-matrix specs).
3. Copilot: login → logout → configure does NOT silently re-authenticate; the user's editor Copilot session is unaffected; explicit re-login works.
4. Ollama local: probe + chat works with default endpoint 11434. Ollama Cloud: signin works without a key AND the optional API key can be entered, saved, and verified in the TUI.
5. Electron test suite identical to baseline except specs added/changed for Issues 1-2 intent.
6. All touched projects green on test/typecheck/lint (`auth-providers`, `rpc-handlers`, `libs/shared`, `cli-engine`, `ptah-tui`, plus vscode/electron typecheck).

### Out of scope

- TASK_2026_171 (RPC host-profile architecture) — explicitly sequenced after this task.
- Any new OAuth flows; Claude subscription remains ambient-credential based.
