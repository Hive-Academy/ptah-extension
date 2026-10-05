# TASK_2026_615 — TASK_2026_596 follow-ups

Source: `.ptah/specs/TASK_2026_596_0a19/batches.md`, "Named follow-ups (open, not fixed in this task)"
(PR #651 records that folder). Workflow: orchestration, BUGFIX, Partial depth (Plan > Implement > Verify).
Branch: `feat/task-596-followups`, worktree `.claude-worktrees/task-596-followups`.

## User decisions (carried over)

- Owner label: add a short non-secret suffix from the hashed owner key, e.g. "Claude account · a1b2"
  (TASK_2026_596 context.md line 148). `user-requested`.
- Lanes: codex and opencode. Implementation by CLI lanes, review by in-process subagents (cross-side).
- Commit and open a PR when verified.

## Scope (priority order)

1. FU-PHASE4 #1 — Antigravity account identity.
2. FU-PHASE6 — owner label suffix; lane runs send `modelScope: null`; an opened plan tile repeats its own
   face; captions wrap at 280 px.
3. FU-PHASE2 #1 — `void readAccount` on turn-start can reject unhandled.
4. FU-PHASE5 #3 — discovery timeout answers `provider-unsupported` instead of `service-unavailable`.
5. Minors in the same libs: FU-PHASE2 #2, #3; FU-PHASE3 B6, B8; FU-PHASE5 #2.

## Design decision: Antigravity identity source (orchestrator, `lane-proposed`)

The batches.md plan named the `GetUserStatus` account field, "once the provisional payload (AS8) is
confirmed". It is still not confirmed: `StatusSchema` has no account field, and the endpoint is marked
"unverified". A local check found `~/.gemini/google_accounts.json` with `{ active: string, old: [] }`.
This is the Gemini CLI account file in the same `~/.gemini` root that Antigravity uses, and Antigravity
has no separate account file. The plan uses this file as the account source:

- `provider-owner.resolver.ts` (the only hashing site) gets `ownerForAntigravity()`. It reads the `active`
  value and returns `accountOwnerKey('antigravity', <root>\0<active>)` with kind `account`. When the file is
  missing, unreadable, invalid or `active` is empty, it returns the existing `cli-store` owner.
- The value is hashed and never logged, returned or stored in clear text.
- Lane owner resolution reads at spawn and again at exit, so no `recordQuotaOwner` upgrade path is needed.
  `upgradeQuotaOwner` keeps its rule (a known owner is never replaced).
- Two accounts on one root (different `active` values) give distinct owner keys. A spec proves it.

## Lane split (file-disjoint)

| Lane | Family | Files (may touch) |
|---|---|---|
| A | codex | auth-providers `quota/provider-owner.resolver.ts` (+spec), `quota/readers/antigravity-plan-usage.reader.ts` (+spec, B6), cli-agent-runtime `cli-agents/limits/lane-owner.resolver.ts` (+spec), agent-sdk `helpers/plan-limits/session-quota-probe.service.ts` (+spec), `session-plan-limit-callback-registry.ts` (doc only) |
| B | codex | rpc-handlers `services/plan-limits-snapshot.service.ts`, `handlers/plan-limits-broadcaster.ts`, `handlers/provider-rpc.handlers.ts`, `plan-limit-owner-discovery.service.ts` (+specs); modelScope persistence: shared `agent-process.types.ts`, cli-agent-runtime `agent-process-manager.service.ts`, `wiring/agent-events.ts`, chat-streaming `agent-monitor.store.ts`, chat `chat-view.component.ts` (+specs) |
| C | opencode | shared `utils/plan-limits` (new owner-suffix helper + spec), chat-ui `plan-limits/*` (tile, detail, tiles builder, lane tiles label, styles), dashboard `provider-account-card` (+specs) |

After A and B land, the orchestrator switches the Antigravity call in `plan-limit-owner-discovery.service.ts`
to `ownerForAntigravity()` (it belongs to lane B's file).

## Verification

- `npx nx run-many -t typecheck,test,lint -p <changed projects>`.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` (baseline may not go up).
- Code review: in-process `code-logic-reviewer` (cross-side for CLI authors) → `code-logic-review.md`.
- UI (lane C): before/after screenshots of the plan tile and the dashboard card in dark and light themes.
