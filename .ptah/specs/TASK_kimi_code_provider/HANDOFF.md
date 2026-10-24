# HANDOFF — TASK_kimi_code_provider

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\kimi-code-provider`
- Branch: `refactor/kimi-code-provider` (from `main` at `6b63d0dd3`)
- State: **all edits uncommitted** (about 140 changed paths). No commit, no push, no PR yet.
- `node_modules` in the worktree is a **junction** to the main checkout. Never run `npm install` there.
  Before any `git worktree remove`, run `cmd /c rmdir <worktree>\node_modules` first (only with user OK).

## Goal

The user has a Kimi Code subscription (39 USD plan, used through kimi.ai/code, outside China).
Ptah's old Kimi integration (`moonshot`) used the Kimi Platform pay-as-you-go API. The user wants:

1. Claude Agent SDK stays the agent harness.
2. ONE Kimi path only: **Kimi Code**. Remove the Kimi Platform (`moonshot`) provider fully.
3. Configurable models and effort settings, exactly like the other providers.

Out of scope: a plan-usage tile for the 5 h / monthly quota (phase 2), the China endpoint, and
data migration of old `moonshot` settings (they stay inert and fail closed).

## Kimi Code facts (source: https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html)

- Base URL `https://api.kimi.ai/coding/`. Key goes in `ANTHROPIC_API_KEY` (x-api-key), not `ANTHROPIC_AUTH_TOKEN`.
  Users create the key in the Kimi Code console (https://www.kimi.com/code).
- Do NOT change the User-Agent (Kimi treats that as a terms violation).
- Models: `k3.1-pro`, `k3.1-pro[1m]`, `k3.1-pro-highspeed`, `k3`, `k3-256k`, `kimi-for-coding`,
  `kimi-for-coding-highspeed`. No cost fields (subscription). K3.1 Pro returns 400 with thinking off.
- Default tiers: opus `k3.1-pro`, sonnet `k3`, haiku `kimi-for-coding`.
- The pinned runtime sends effort for non-Claude models only when
  `ANTHROPIC_DEFAULT_<TIER>_MODEL_SUPPORTED_CAPABILITIES` is set. Hence static-model `capabilities`
  plus the helper `buildStaticTierCapabilityEnv()`.

## Done (uncommitted)

The plan of record is `implementation-plan.md` in this folder (WP-1..WP-9). All WPs are implemented:

- WP-1 shared registry: new `libs/shared/src/lib/providers/entries/kimi-code-provider-entry.ts`,
  `provider-registry.ts` (moonshot → kimi-code, `capabilities` on `ProviderStaticModel`,
  `getStaticModelCapabilities()`).
- WP-2 settings keys: `platform-core/src/file-settings-keys.ts`, `settings-core/src/schema/provider-schema.ts`,
  `agent-sdk/.../settings-export.types.ts`.
- WP-3 `agent-sdk/src/lib/helpers/sdk-model-service.ts` → `buildStaticTierCapabilityEnv()` (exported).
- WP-4 auth-providers: fail-closed unknown ids (`api-key.strategy.ts`, `provider-auth-resolver.ts`),
  workspace snapshots blank both auth vars, capability env added, static capability fallback in
  `provider-models.service.ts`.
- WP-5 `cli-agent-runtime/.../ptah-cli-registry.ts` `applyTierEnv` merges capability env.
- WP-6 rpc-handlers: kimi-code key format row; Anthropic model fetcher requires `isDirectAnthropic`.
- WP-7 ptah-cli (`auth.ts`, `init.ts`, `router.ts`), ptah-tui `provider-form.ts`, electron-e2e, specs.
- WP-8 frontend (31 files): brand slug `'kimi-code': 'moonshot'`, accent, usage label, specs, e2e fixtures.
- WP-9 docs: `providers/moonshot.md` → `kimi-code.md` (git mv), other docs, both ptah-cli-usage skill copies
  (identical, checked with `cmp`), video-studio script and knowledge base.

### Review fixes (after `code-logic-review.md`, verdict NEEDS_REVISION 6/10), all applied, NOT yet tested

1. S1 `apps/ptah-cli/src/cli/commands/auth.ts:744`: `auth use kimi-code` now writes
   `authMethod: 'thirdParty'`, `anthropicProviderId: 'kimi-code'` (was `apiKey` → direct Anthropic).
2. S2 `workspace-provider-profile-resolver.ts:85` `createIsolatedSnapshot()`: all 12 tier env keys set to
   `undefined` (NOT `''`; `''` = empty capability allowlist in claude.exe) in all four snapshot builders.
3. S3 `api-key.strategy.ts:574`: no env-snapshot fallback for providers whose `authEnvVar` is
   `ANTHROPIC_API_KEY` (Kimi Code). Z.AI/OpenRouter headless bridge fallback unchanged.
4. `provider-auth-resolver.ts:638`: draft-verify throws `ProviderAuthError` for an unknown id with no URL.
5. `provider-models.service.ts:1078`: `_NAME`/`_DESCRIPTION` from live catalogue only (as on main),
   capabilities from live then `getStaticModelCapabilities`. Kimi tier labels show raw ids (cosmetic).

### Intentional remaining `moonshot` mentions (do not "fix")

Fail-closed regression specs, `brand-slugs.ts` art key + `provider-brand-art.vendored.ts`, `pricing.utils.ts`
prefix regex + spec, `openrouter-pricing.service.spec.ts` (`moonshot/kimi-k2`), `cli-adapter.utils.spec.ts`,
`vendor-roster-drift.spec.ts`, `scripts/brand-icons/scanner-tokens.mjs`, `tools/mcp-bench`, `tools/hyperframes`,
the "Moving from the Moonshot Platform?" note in `kimi-code.md`, the comment in `provider-accent.ts`.

## Not verified yet

- The backend lane ran targeted Jest **before** the review fixes, all green: shared 377, platform-core 167,
  settings-core 64, agent-sdk 495, auth-providers 389, cli-agent-runtime 263, rpc-handlers 385,
  agent-generation 101, cron-scheduler 10, lane-routing 29, ptah-tui 26, ptah-cli 105.
- The frontend lane ran **no** tests. **No typecheck has run** on any project.
- No independent code-style review.

## Open problems and decisions

- Not in this PR (list in PR body as follow-ups): `auth use openrouter` / `auth use z-ai` have the same
  direct-Anthropic routing bug as S1 (pre-existing). Z.AI keeps the env `ANTHROPIC_API_KEY` last-resort
  fallback (pre-existing, tested headless bridge flow). Z.AI has the same effort-capability gap.
- Documented limitations: effort only reaches models that are the value of a tier var (3 of 7 at a time);
  a custom tier id or a Ptah CLI `selectedModel` / spawn `model` override runs without the effort setting.
  No warning when haiku is set to the thinking-only `k3.1-pro`. Fable tier unmapped.
- Accepted risks: `ApiKeyStrategy` reads `ANTHROPIC_AUTH_TOKEN` snapshot before `ANTHROPIC_API_KEY` for
  other providers; `ProviderProfileAuthEnv`/`ProviderProfileSchema` do not declare `_SUPPORTED_CAPABILITIES`;
  orphaned secret `ptah.auth.provider.moonshot` stays unread.
- Live assumptions needing a real-key smoke test: thinking + effort accepted (incl. xhigh/max), `[1m]` id
  matches capability lookup, key prefix, thinking-off on `kimi-for-coding`.
- Prettier reformatted some unrelated lines in files that also carry task edits (e.g.
  `draft-verification.service.spec.ts`, `skills.spec.ts`, `auth-strategy.types.ts`, unions in `auth.ts`).
  Decision so far: keep (lint-staged formats staged files anyway).

## Heavy-check slot (cross-session convention)

CLAUDE.md: one heavy check (nx test/typecheck/jest/tsc/build/push) at a time across all sessions.
Last state: 712 finished, this session gave its turn to **TASK_2026_717**. Before the sweep, ask the peers
(`ListAgents`, then `SendMessage`) whether the slot is free, claim it, and send "released" to waiters
(717 asked for it) when your checks and push are done.

## Next steps

1. Get the slot (see above).
2. Run tests, one run at a time, from the worktree. Confirm the header says
   "Running target test for N projects" with the right N:
   ```
   npx nx run-many -t test -p shared platform-core settings-core agent-sdk auth-providers cli-agent-runtime rpc-handlers vscode-core agent-generation cron-scheduler lane-routing --parallel=1
   npx nx run-many -t test -p ui dashboard chat core tribunal-panel ptah-cli ptah-tui --parallel=1
   ```
   (Check exact project names with `npx nx show projects` if one is not found.)
3. Typecheck the changed projects and the hosts (Electron first):
   ```
   npx nx run-many -t typecheck -p ptah-electron shared platform-core settings-core agent-sdk auth-providers cli-agent-runtime rpc-handlers vscode-core --parallel=1
   npx nx run-many -t typecheck -p ui dashboard chat core tribunal-panel webview-e2e-harness ptah-cli ptah-tui ptah-extension-vscode ptah-extension-webview --parallel=1
   ```
   Pipe output through `| tail -40`; do not re-run just to re-read.
4. Fix failures. Optionally run a `code-style-reviewer` pass.
5. Read `.commitlintrc.json` (subject ≤ 72, body lines ≤ 100 wrapped at 72; valid scopes include
   shared, agent-sdk, auth-providers, cli-agent-runtime, rpc-handlers, settings-core, platform-core, cli,
   webview, docs). Inspect `git status` + full diff. Stage by explicit path (include the new
   `kimi-code-provider-entry.ts`, the renamed doc, the new `tier-capability-env.spec.ts`, and this task
   folder if desired). Commit in the FOREGROUND, ending with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
6. In ONE background command: `git push -u origin refactor/kimi-code-provider` then `gh pr create --base main`
   (title < 70 chars, `## Summary`, `## Test plan` with real results and checks not run, open risks,
   follow-ups, and the required live smoke test: one turn per tier at effort high and max, a commit-message
   generation, and an Electron connection check with a real Kimi Code key). End body with
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Pre-push runs di-lint + validate-deps.
7. Send "released" to waiting sessions. Watch CI and reviews with `gh pr checks` / `gh pr view --comments`,
   fix confirmed findings with new commits. Report PR URL, head, CI and review state.
8. Never merge, force push, delete the branch, or remove the worktree without user approval.
