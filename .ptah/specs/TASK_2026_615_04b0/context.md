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
- Lane owner resolution reads at spawn, so a lane started with a readable account file gets the account key
  from the start. `upgradeQuotaOwner` keeps its rule (only `unknown` is replaced), so a lane that spawned as
  `cli-store` before the file existed stays `cli-store` (review finding 2, a follow-up).
- Assumption (review finding 1, Major, accepted): Antigravity is signed in to the same Google account as the
  Gemini CLI on this root. If they differ, Antigravity windows are attributed to the Gemini CLI account.
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

## Outcome (2026-10-05)

- Lanes: A (codex, 1 revise round: tsyringe constructor seam removed), B (codex, 1 revise round: shim
  removed, non-Claude scopes restored, specs added), C (opencode, no revise). Orchestrator fixed lane spec
  defects (missing import, sync mock returning a promise, wrong expectations) and switched the discovery
  Antigravity call to `ownerForAntigravity()`.
- Also fixed on main: `session-query-executor.service.spec.ts` D.11 `StreamTransformer` arity (PR #648 + #650).
- Review: `code-logic-review.md`, APPROVED WITH MINORS (0 Blocking, 1 Major, 9 Minor). Bounded correction:
  findings 3 (schema `old` optional, email lowercased) and the `lane-tiles.ts` raw label.
- Evidence: the after screenshots (`plan-limits-visual.e2e.spec.ts`, 12 runs) and the lane reports are kept in
  the local worktree only, not committed. E2E fixtures now use 16-hex fingerprints so the suffix renders.

## Follow-ups (open)

1. Major: read the Antigravity account from the language server `GetUserStatus` once its payload is confirmed.
2. Let a `cli-store` lane owner upgrade to `account` for the same provider at exit.
3. Cache the account-file read (mtime or short TTL); it runs on every discovery.
4. Broadcaster: bound `currentSnapshot` / `broadcastMessage` so a never-settling promise cannot stall pushes.
5. `resolveModelScope` applies the Claude family rule to every CLI; restrict it to Claude-backed lanes and
   decide what to do with ledger rows keyed by the old full model id.
6. Frontend `modelScope` merge: a backend `null` never clears a known scope; document or change.
7. The opened plan tile no longer shows the percentage meter; consider keeping the meter without the text.
8. At 280 px the tile caption truncation hides the owner suffix (still in the tooltip, the opened tile and the
   dashboard card). The LANES subtotal caption still wraps.
9. Earlier FU items not in this task: FU-PHASE2 #4, FU-PHASE3 A4-A6/B1/B7/B8, FU-PHASE4 #2-#3, FU-PHASE5 #1,
   FU-PHASE6 contrast and Batch 17-20 Minors.
