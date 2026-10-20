# HANDOFF — TASK_2026_707 Analytics dashboard redesign

Written 2026-10-20 by the orchestrator session at handoff (token budget). Read `context.md` in this
folder for the full chronological log; this file is the actionable summary.

## Goal (user request)

1. **Plan-limits section** on the analytics page: was buggy, not uniform across providers, too tall.
   Explain/fix Grok (shows nothing), Ollama (showed only request counts), Antigravity (usage unknown;
   see https://antigravity.google/docs/cli/commands/usage/).
2. **Session stats**: replace basic cards with a T3-Code-style usage dashboard — usage per provider
   today, tokens burned per provider, cost per model, stats and charts.
3. User wants to **see the changes visually** (Electron) before anything merges.

User decisions (keep): two PRs (PR 1 tiles + readers, PR 2 usage dashboard), built in parallel;
in-house SVG charts (no chart lib); pricing = existing OpenRouter pricing service + bundled rate card
fallback (no LiteLLM); Grok = local CLI session usage, no new xAI key (management key = future);
Ollama = `/api/balance` for %, never compute % from request counts.

## Worktrees and branches

| PR | Worktree | Branch | State |
| --- | --- | --- | --- |
| PR 1 | `D:/projects/ptah-extension/.claude-worktrees/plan-limit-tiles` | `feat/plan-limit-tiles` | commit `c1ec75cea` pushed; **PR #784** open: https://github.com/Hive-Academy/ptah-extension/pull/784 ; **uncommitted** CI/CodeRabbit fixes on top |
| PR 2 | `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard` | `feat/analytics-dashboard` | nothing committed; all PR 2 code + this spec folder uncommitted |

Both worktrees have a `node_modules` junction to the main checkout. Main checkout stays on `main`.

## Done

### PR 1 (#784) — compact uniform plan-limit tiles
- Tile grid (`provider-account-tile/*`, `provider-account-card/plan-tile-view.model.ts`); old
  `provider-account-row.component.ts` deleted.
- Ollama reader: `/api/balance` (session/weekly %, resets, allowance) + `/api/usage` per-model
  requests; typed `statusReason` (`balance-unavailable`, `balance-auth-rejected`,
  `usage-auth-rejected`); per-endpoint cooldown; in-flight sharing; streamed body cap; split into
  `ollama-cloud-plan-usage.reader.ts` + `ollama-cloud-usage.parsers.ts`.
- Antigravity: `antigravity-cli-usage.adapter.ts` runs `agy -p /usage` (tab-separated
  `<group>\t<label>\t<remaining%>\t<ISO reset>`; used = 100 − remaining) as 3rd fallback; typed
  reasons `cli-not-found|cli-timeout|cli-not-signed-in|cli-exit-error|cli-parse-failed`.
- Grok API-key login: `api-key-no-subscription-quota` + local CLI usage.
- Claude stale generic weekly hidden when a model weekly exists; Codex lifetime tokens BigInt-safe.
- Reviews: codex REVISE → fixed → re-reviews APPROVE WITH FIXES → fixes applied.
- Checks run at commit: typecheck dashboard/auth-providers/shared PASS; tests PASS except
  `libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts`, which
  **also fails on main** (5/9) — pre-existing, not ours.

### PR 1 follow-up (UNCOMMITTED, in plan-limit-tiles worktree) — report `pr784-ci-and-review-fix.md`
- CI `checks` (degradation ratchet auth-providers 26 > 24): `ollama-cloud-usage.parsers.ts:45,91`
  now carry justified `optional-capability` suppressions → audit shows `24 ok (baseline 24)`.
- CI `webview-e2e`: `plan-limits-visual.e2e.spec.ts:221-239` now uses `provider-account-tile` and
  `tile-cooldown` test ids. Local run failed only because the harness serves a **stale**
  `dist/apps/ptah-extension-webview` bundle (no build was allowed); CI builds it.
- CodeRabbit 4320598599 (major): CLI fallback only for `cli-store`/`unknown` owners
  (`antigravity-plan-usage.reader.ts:77-84`, test at spec :446).
- CodeRabbit 4320598622: pill/notice duplicate suppressed (`plan-tile-view.model.ts:902-920`).
- CodeRabbit 4320598631: evidence notices tracked by key (`plan-tile-view.model.ts:225,809,922`,
  tile html :156).
- CodeRabbit 4320598643: UTF-8 em-dashes in `plan-limit.types.ts`, `ollama-cloud-plan-usage.reader.ts`.
- Reply texts for each CodeRabbit comment are in `pr784-ci-and-review-fix.md`.
- Also: orchestrator fixes in that worktree before commit c1ec75cea were committed (spec type errors,
  agy mojibake label, candidate loop).

### PR 2 — usage dashboard (UNCOMMITTED, in analytics-dashboard worktree)
- Contract `libs/shared/src/lib/types/rpc/rpc-analytics.types.ts` (`UsageSummary`, `UsageFact` incl.
  `cacheSavingsUsd: number | null`, `costSource`), RPC `analytics:usageSummary`.
- `libs/backend/agent-sdk/src/lib/session-stats/*`: public uncapped dated scan.
- New lib `libs/backend/usage-analytics` (sources: Claude ledger, Codex `~/.codex/sessions`,
  OpenCode `opencode.db` via lazy `better-sqlite3`, Grok `~/.grok/sessions` with 1e10 ticks/USD;
  Ollama/Antigravity = 'unavailable'); pricing OpenRouter → bundled; per-file cache; 30 s budget →
  partial summary; DI tokens/registration.
- `libs/backend/rpc-handlers/.../analytics-rpc.handlers.ts` + host registration in Electron, VS Code,
  CLI (phase-2) + DI smoke guards.
- Frontend: Usage | Sessions tabs in analytics card; `usage-dashboard/*` (cost summary, KPI strip,
  breakdown table model/day, cost quality, SVG stacked area chart), `analytics-usage.store.ts`.
- Backend review: APPROVE WITH FIXES 8/10 after fix round; orchestrator fixed N1/N2 in
  `usage-summary.service.ts` (`SOURCE_IDS`, `skippedSources`).
- Frontend review: REVISE → fix 1 → re-review REVISE 6/10 → **fix round 2 of 2** (see In progress).

## In progress at handoff
No lane is running. All lanes ended; every deliverable is on disk.

Last lane: Glm `ab9e2457` — PR 2 frontend fix round 2 (FINAL, cap reached) → `batch-pr2-frontend-fix2.md`.
Lane claims (NOT yet verified by the orchestrator, no independent re-review):
- Fixed: breakdown share heading "Share of known cost" when unpriced facts exist; chart readout
  shows `unpriced` / `at least $x` per provider in Cost mode; `console.warn` removed from
  `analytics-usage.store.ts`; chart split into `stacked-area-chart.geometry.ts` +
  `stacked-area-chart.component.html` + component (~368 lines). 51/51 scoped Jest, typecheck dashboard pass.
- NOT done (file size): `usage-summary.view-model.ts` is 708 lines (planned split:
  `usage-formatting.ts` + `usage-summary-fold.ts`); chart component still ~368 lines;
  `usage-dashboard.component.spec.ts` ~790 lines. Also untested: the per-provider
  `at least $x` chart readout branch (only the `unpriced` branch has a DOM test). Per review-cap rule: do ONE bounded correction
  for these (behavior-preserving split) and have it independently checked, or list them in the PR
  body as follow-ups. Do not start a third review round.

## Open problems and decisions
1. **Visual review not done.** User has not seen either PR. Required before merge: Electron build-dev
   from each worktree, screenshots dark + light of (a) plan-limit tiles, (b) Usage tab; show user.
2. PR 2 frontend review cap reached after round 2: verify the r2 items yourself; if a defect remains,
   one bounded correction + independent check, else report it — do not reset the cap.
3. PR 2 workspace scope: summary is per active workspace (Claude scan is per workspace). A future
   "This workspace / All workspaces" switch is a follow-up.
4. Deferred (list in PR 2 body as follow-ups): 90-day benchmark/persisted rollup; qualified bundled
   pricing lookup (prefix stripped in `pricing.utils.ts:332-337`); legacy Claude null-id dedup;
   pricing `asOf`; Ollama/Antigravity dashboard sources. OpenCode positive cost stays
   `provider-reported` (orchestrator decision: CLI records it).
5. PR 1 deferred minors: `no-oauth`/`no-local-server` declared not emitted; FIFO owner eviction.
6. `usage-summary.service.ts` has very long one-line statements → code-style review / prettier.
7. Antigravity lane limit: "Individual quota reached", reset ~2026-10-20 05:11 UTC. Note `agy -p
   /usage` showed 100% remaining at the time, so /usage windows miss this quota.
8. Side quest (not in scope; propose as separate task): agy lanes exit 1 with `result.status ERROR`
   after finishing; both failing runs had exactly one retried `503 UNAVAILABLE` in
   `~/.gemini/antigravity-cli/log/cli-*.log`; passing runs had none. Proposed adapter change in
   `libs/backend/cli-agent-runtime/.../antigravity-cli.adapter.ts:1121`: log full result event +
   ERROR steps; treat ERROR + all deliverables + report as "completed with agent warning".
   User has not answered whether to open that task.
9. Machine queue (other sessions share RAM/Electron): announce before heavy checks; 662
   (skills-epic, `ptah-ptah-extension-skills-epic-v7-ab908d0000ebk2qkufgly0h`) holds the slot now;
   708 (voice) will re-announce. Send "checks: free" when done.

## Key files
- Spec folder: `D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/.ptah/specs/TASK_2026_707/`
  — `context.md`, `implementation-plan.md`, `code-audit.md`, `provider-usage-sources.md`, batch
  reports `batch-*.md`, reviews `code-logic-review-*.md`, `pr784-ci-and-review-fix.md`.

## Exact next steps
1. Read `batch-pr2-frontend-fix2.md` and verify its 4 findings against
   `code-logic-review-pr2-frontend-r2.md` yourself (read the cited lines). Decide the file-size
   follow-up (see "In progress").
0. Before any heavy check or Electron launch, announce on the machine queue (SendMessage to the
   other sessions listed by ListAgents) and wait for "checks: free". At handoff end,
   the checks slot and Electron were FREE (notification-final sent "Electron: free" and
   "checks: free"); 662, 708 and notification-final all paused for their own handoffs and will
   re-announce. Still announce before you start.
2. PR 1 follow-up — in `plan-limit-tiles` (announce machine use first):
   ```powershell
   $env:NX_NO_CLOUD='true'
   npx nx typecheck dashboard --parallel=1; npx nx typecheck auth-providers --parallel=1; npx nx typecheck shared --parallel=1
   npx nx run-many -t test -p dashboard auth-providers shared --parallel=1 -- --maxWorkers=2   # header must say 3 projects
   npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts 2>&1 | Select-String "auth-providers|TOTAL"
   ```
   Commit (foreground; read `.commitlintrc.json`; e.g. `fix(dashboard,auth-providers,shared): address PR 784 CI and review`),
   push in background, reply to the 4 CodeRabbit comments with the texts in
   `pr784-ci-and-review-fix.md`, then watch `gh pr checks 784`.
3. PR 2 — in `analytics-dashboard`:
   ```powershell
   $env:NX_NO_CLOUD='true'
   npx nx run-many -t typecheck -p shared agent-sdk usage-analytics rpc-handlers dashboard --parallel=1
   npx nx run-many -t test -p shared agent-sdk usage-analytics rpc-handlers dashboard --parallel=1 -- --maxWorkers=2
   npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts 2>&1 | Select-String "FAIL|TOTAL"
   ```
   Plus the host smoke specs changed in batch B/fix (Electron, VS Code, CLI `container.smoke.spec.ts`)
   via `npx jest -c <app>/jest.config.ts <spec> --coverage=false --maxWorkers=2`; typecheck
   `ptah-electron`, `ptah-extension-vscode`, `ptah-cli` (shared libs changed). Commit spec folder +
   code, push, open PR 2 with summary, deferred list, test plan.
4. Visual review in Electron (dark + light) for both PRs; show screenshots to the user; merge only
   after user approval.
5. Ask the user about the agy adapter side-quest task.
