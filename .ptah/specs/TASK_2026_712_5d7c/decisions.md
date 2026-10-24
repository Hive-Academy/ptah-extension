# Decisions

| ID | Decision | Basis | Classification |
| D1 | FEATURE / Full workflow | New lane exposure, account state, cross-layer runtime and UI | project-rule |
| D2 | Isolated feat/provider-accounts worktree from main | CLAUDE.md | project-rule |
| D3 | Lanes enabled, lane-review document approvals; independent cross-side reviewers | Memory and available Grok/Glm lanes; orchestration Gate 0.1 | project-rule |
| D4 | Claude first, Codex next; preserve defaults and existing integrations | User request and follow-up implementation request | user-requested |
| D5 | Prefer SDK reuse for first-class Claude lane | T3 source and existing Ptah SDK lane path; architect must verify suitability | proposal |
| D6 | No shadow homes, automatic account rotation, credential copying or cross-account resume | Smallest isolated implementation; no user requirement for these behaviors | proposal |
| D7 | Do not infer Anthropic approval; raise release/onboarding decision if required | Official Agent SDK authentication restriction | unresolved-user-reserved |
| D8 | No commit/push, real credential operations or paid inference probes authorized | No explicit user request for these actions | project-rule |
| D8a (2026-10-22, supersedes the commit/push part of D8) | Commit verified batches on `feat/provider-accounts` (never `main`), push, open a draft PR; CI and the pre-push hook are the host test gate. Credential operations and paid probes stay unauthorized. | User: "continue the proper orchestration workflow and fix any issues"; global CLAUDE.md lanes-first rule (CI checks, no local typecheck/test before push) and no-orphaned-branch rule | user |
| D10 (2026-10-22) | Host `marked` failures root cause: worktree had no `node_modules`; `jest.preset.js:31` maps `marked` to `<worktree>/node_modules/...`. Fixed with a git-ignored junction `node_modules` → main checkout `node_modules` (same lockfile, last change `8be217319` on both). Missing `dist` artifacts are build-dependent test targets; disposed to CI per D8a. | Investigation of verification-batch-01-*-test-direct.log and jest.preset.js | orchestration-decision |
| D11 (2026-10-22) | Accept Batch 1 on passing shared checks (B01-V2) and Batch 2 on source inspection (declaration-only, type-only exports, two `Symbol.for` tokens); host gates delegated to CI per D8a. Phase P1-A code review remains at Batch 7. | B01-V2 checkpoint; AST of provider-account-admission.port.ts | orchestration-decision |
| D9 | Initial PM author on Grok, independent in-process document review | Available lane with confirmed room; user lanes-first preference | orchestration-decision |

## Requirements revision 1

The independent requirements review returned REVISE for R1–R7. Grok is revising the two requirements artifacts; Gate 1 remains pending. Restore account add/status/sign-in/out as requested scope, separating product functionality from unauthorized live verification. Distinguish profile selection from authenticated quota ownership and specify resume lifecycle, effective directories, model/effort parity, and dependent-host checks. These are evidence-backed requirements corrections, not approved removals.

Provider approval remains unresolved. Continue technical specification and mocked implementation without treating either as permission to enable or release disputed subscription onboarding. Preserve existing behavior. No licensing decision, live authentication, inference, or reduced-scope release is authorized by this continuation.

## Gate 1 outcome

Requirements revision 1 APPROVED by independent in-process software-architect reviewer after Grok CLI authorship (cross-side, lane-review mode). R1–R7 resolved; no technical requirements blockers. Gate 1 passes to Electron design/prototype, not production implementation or release. Subscription enablement/release authorization remains unresolved. No removals approved.

## Gate 1.7 outcome

Design revision 2 APPROVED by Grok CLI reviewer after in-process ui-ux-designer authorship (cross-side, lane-review mode). Both remaining blockers and associated source corrections verified; advance to architecture. This is source-level technical design approval only. Rendered Electron dark/light, focus and viewport evidence remains pending, as does subscription enablement/release authorization. No removals approved. Design used its two allowed revision pairs.

## Gate 2 outcome

Architecture revision 1 APPROVED by Grok CLI reviewer after in-process software-architect authorship (cross-side, lane-review mode). B1 final child-environment application and B2 preserved SDK execution/prompt-admission contracts are closed at plan level. Advance to team-leader decomposition and bounded technical implementation. Subscription enablement/release, A1–A4 installed-runtime compatibility, abandoned reservation recovery limitations, and rendered Electron evidence remain open as recorded in implementation-plan-review.md. No release, removals, live authentication/inference, commits or pushes authorized.

## Review budget
Each document gets one initial cross-side review and at most two author/reviewer revision pairs. No proposed removal can be approved by reviewer alone. Announce implementation batch budget after architecture establishes batch count.

## SEQ-B02 — bounded declaration-only sequencing exception

- **Decision / verdict:** ALLOW SEQUENCING ONLY for Batch 2's existing three-file backend token/admission-contract seam before Batch 1 acceptance. No executor is dispatched by this advisory; Batch 2 / Task 2.1 remain PENDING until the orchestrator assigns them. Batch 1 / Task 1.1 stay IN_PROGRESS, B01-V2 stays NOT ACCEPTED, acceptance remains OPEN and COMPLETE count stays 0/43.
- **Options:** (1) hold all dependent implementation until host remediation; (2) allow only the additive declaration/token seam while preserving every acceptance gate. Choose (2), not general pipelining: no runtime consumer, registration or host change is needed for the actual Batch 2 definition. Nothing here authorizes Batch 3–43 or further runtime work.
- **Evidence:** batches.md B01-V2 records fresh corrected shared typecheck/lint, 122 suites / 3748 passing tests and clean scoped diagnostics. implementation-report-batch-01.md documents the five-file correction, not host acceptance. host-verification-disposition.md:76–94 expressly distinguishes a possible sequencing-only exception from gate acceptance. Existing auth-providers-tokens src/lib/tokens.ts contains identifiers using Symbol.for; src/index.ts exports tokens/types, not service registration. project.json:18–23 defines typecheck via `tsc --noEmit --project libs/backend/auth-providers-tokens/tsconfig.lib.json`, with no build prerequisite or lint/test targets. nx.json:24–63 does not add a typecheck build dependency. No fresh verification was run for this decision.
- **Exact writable code ownership:** CREATE `D:/projects/ptah-extension/.claude-worktrees/provider-accounts/libs/backend/auth-providers-tokens/src/lib/provider-account-admission.port.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/provider-accounts/libs/backend/auth-providers-tokens/src/lib/tokens.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/provider-accounts/libs/backend/auth-providers-tokens/src/index.ts`. No other production/config/spec ownership is granted.
- **Boundary:** closed readonly backend route/resource types, admission/action interfaces, type-only imports/exports and token identifiers only. Existing token-constant evaluation is allowed, not an executable admission implementation or service wiring. No runtime registration/resolution, SDK/host consumer, env application, persistence, auth operation, tuple activation, infrastructure/dependency change or Batch 1 source edit. Structural route typing does not confer admission. Extra files or runtime behavior require stopping, not scope expansion.
- **Eventual commands, not executed here:** interim `npx nx typecheck @ptah-extension/auth-providers-tokens --parallel=1`, plus scoped diagnostics on the three owned absolute paths; record an interim declaration checkpoint only. Full acceptance remains `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/auth-providers-tokens') -Hosts $H` from batches.md, retaining the explicit five-host typecheck/lint/test obligations. Builds required by four host test targets remain forbidden without separate authorization; do not execute those targets indirectly or treat direct-Jest diagnostics as equivalent passes. No invented token lint/test target.
- **Unresolved holds / stop:** historical host failures are unchanged-source/infrastructure observations, not baseline-proven, waived or passed. Batch 1 host disposition/remediation and required passing affected-host verification must be resolved before Batch 2 COMPLETE or P1-A foundation acceptance. Release/subscription enablement, A1–A4 compatibility, abandoned reservation limitations and rendered Electron dark/light evidence remain unresolved. No gate waiver, release claim, install/build/baseline authorization, credential/.env read, live auth/inference, external action, user question or git mutation is granted. Electron first; no TUI/VSCode polish. Future checks must be changed/affected scoped only, Nx --parallel=1, Jest --maxWorkers=2 and one heavy check across all lanes.
- **Reversible / handoff:** yes; return to hold on shared-input drift, scope expansion or token check failure. Orchestrator may assign one eligible contracts-capable lane with the exact Batch 2 ownership, mandatory lane rules and SEQ-B02 boundary from batches.md; no spawn in this advisory. Return after Batch 2 for team-leader verification and host-blocker disposition, not automatic next-batch dispatch. The exception expires at that declaration checkpoint and grants no further sequencing entitlement.

## P1-A interim review disposition (2026-10-22)

- Reviewer: Codex (OpenAI) on Grok (xAI) Batches 1–2; `code-logic-review-batch-01-02.md`, REVISE with 0 Blocking, 0 Serious, 2 Moderate, 1 Minor. Lean rule 4 applied; no fix round.
- R1 (Moderate, safe-text predicate accepts credential-shaped text): deferred to Batch 6, whose action results come from official CLI output; Batch 6 acceptance now includes "result text never passes raw or credential-shaped dependency output; only closed codes map to safe sentences".
- R2 (Moderate, `export *` in shared main barrel): no change. Orchestrator brief said "type-only"; batches.md:105 requires Zod-free, which holds, and matches repository convention.
- R3 (Minor, numeric/strict-union regression cases): recorded; add when Batch 25 touches the schemas.
- Full P1-A phase review remains at Batch 7.

## Cross-task coordination with TASK_2026_714 (Codex App Server, 2026-10-22)

- Peer: session `ptah-ptah-extension-codex-sdk-main-chat`, worktree `.claude-worktrees/codex-sdk-main-chat`, branch `feat/codex-sdk-main-chat` (planning phase, no code yet).
- Overlapping files: agent-adapter.types.ts (our B3), sdk-query-options-builder.ts (B8), session-metadata-store.ts (B16), sdk-agent-adapter.ts (B17), chat-session.service.ts (B18), codex-home-resolver.ts (B37), codex-account-usage.service.ts (B38), codex-cli.adapter.ts (B40).
- Rules A–E AGREED by peer 2026-10-22: claim-before-edit message per file; our shared contracts (B1–B3) land in main first; agent-sdk/chat files go to whoever claims first, the other rebases; our Codex batches 37–40 wait for TASK_2026_714 to merge and build on its App Server abstractions; shared heavy-check slot protocol.
- Before dispatching any batch that owns a listed file, the orchestrator checks for a claim from the peer.
- Peer notes: their agent-adapter.types.ts change (bypassPermissions on native route, :160-162) is additive and rebases on our B3. Their first likely touch is session-metadata-store.ts (`updateCodexExecution` writer) — our B16 rebases on it. No early edits by them to sdk-query-options-builder.ts, sdk-agent-adapter.ts, chat-session.service.ts. CodexHomeAuthReader takes a normalized home path; per-home cache/lock/watcher; they only read codex-home-resolver.ts and codex-account-usage.service.ts. codex-cli.adapter.ts is free until they claim it.

## D12 — Scope split: Claude first, Codex later on App Server (2026-10-22, user)

- User: "work on the multiple accounts for claude first then work on the codex changes later on by first unifying it to use app server then allow multi account for it".
- This task now ends at Batch 35 (Phase 1: Claude multi-account, shared account store, RPC, Electron Accounts UI, Claude exit evidence checkpoint).
- Batches 36–43 (all Codex work) move to TASK_2026_715_6cba, which depends on this task and TASK_2026_714_c8a2 (Codex App Server). They are inputs to a fresh plan there, not an approved plan, because they target the legacy Codex resolver.
- Not a removal: every Codex capability and acceptance criterion moves with the batches. Shared contracts already landed (provider discriminant `codex` in Batch 1 vocabulary, provider-scoped store in Batches 4–5) stay provider-generic so the follow-up reuses them.
- Effect on coordination: our Codex-file overlaps with TASK_2026_714 (codex-home-resolver.ts, codex-account-usage.service.ts, codex-cli.adapter.ts) are released from this task.

## D13 — Batch 7 scope answers (2026-10-22, orchestrator)

- Admission success is NOT implemented in Batch 7; SDK_PROVIDER_ACCOUNT_ADMISSION stays fail-closed (typed refusal). Certified admission belongs to Batches 8/17 and release-held live certification (D7). Evidence: batches.md Batch 8/17 scope; lane question 2026-10-22.
- Batch 7 ownership extended by one file (6/6 cap): provider-account-actions.service.ts gets a minimal dispose() that aborts active controllers plus a disposed guard. Reason: active controllers are private; disposal ownership (Batch 7 acceptance) is impossible otherwise without a brittle proxy or duplicate implementation. Reversible.
- Process note (2026-10-22): a message queued to a completed Codex lane later revived it as new turns, which collided with a second lane on the same files. Lane 68442c9c was stopped; 9d20d0ef integrated. Rule from now on: never start a second writer while messages are queued for a lane that owns the same files.

## D14 — P1-A accepted (2026-10-22)

- Phase review (Grok, xAI, reviewing Codex Batches 3–7): REVISE, 1 Serious + 2 Moderate. One fix round by Codex (2ef3b39a1). Grok re-review: all 3 RESOLVED, 1 new Moderate regression (proved status failure no longer stored as failed; contradicted an existing spec).
- Review cap reached; one bounded orchestrator correction (81701a5de), independently reviewed by Codex (OpenAI reviewing Anthropic): APPROVED.
- Review families: xAI on OpenAI (phase), OpenAI on Anthropic (correction). Static review only; CI runs tests.
- P1-A (Batches 1–7) accepted pending CI on PR #808. Next phase: P1-B (Batches 8–11).

## D15 — P1-B accepted (2026-10-23)

- Phase review (Grok, xAI, reviewing Codex Batches 8–11): REVISE 5/10, 1 Blocking, 1 Serious, 2 Moderate (`code-logic-review-phase-p1-b.md`).
- One fix round by two file-disjoint Codex lanes: f9cf528bd (finding 1: pin `CLAUDE_SECURESTORAGE_CONFIG_DIR` to the named dir, scrub `ANTHROPIC_CONFIG_DIR`/`ANTHROPIC_PROFILE`, refuse blank dir) and 5b0fac24a (findings 2–4: multi-turn prompt gate, per-run routing hint, effort without model, no segment cap). Moderates 3–4 fixed because they could break lane config or lose data (lean rule 4).
- Orchestrator decision: the broad env prefix drop (CLAUDE*/ANTHROPIC*/AWS_/GOOGLE_/...) is deferred to Batch 17 certification. Evidence: secure-storage pin closes the proven SDK path; a broad drop changes lane config for all routes. Reversible.
- CI fix by orchestrator f06ccae50: `buildClaudeLaneEnv` moved into `claude-sdk-lane-options.ts`, spawn-options import type-only (CI shard 1: 11 cli-agent-runtime suites failed on ESM `wasm-bundle-dir.ts` via agent-generation).
- Grok re-review (`code-logic-re-review-phase-p1-b.md`): APPROVED 8/10, findings 1–4 RESOLVED, CI fix confirmed, no new defects.
- Review families: xAI on OpenAI (phase + fixes), xAI on Anthropic (CI fix). Static review only; CI runs tests.
- Open CI item (P1-A code): `provider-account.store.spec.ts` two cases fail on Linux CI (`unsupported-store` where `conflict` expected, `provider-account-route.ts:62-67` mkdir error mapping). Reproduce locally when the heavy-check slot is free.

## D16 — Batch 12 import linkage moves to Batch 16 (2026-10-23, orchestrator)

- Lane finding: persisted import binding needs a linkage field in `session-metadata-store.ts` (SessionMetadata merges by SDK sessionId only; importer skips a same-ID entry from any route). That file is Batch 16 ownership and a shared file with TASK_2026_714 (their first edit).
- Decision: Batch 12 binds history/rewind/stats/import *reading* to the explicit account context and returns an explicit unavailable result for a missing requested root. With a named context, the importer refuses to persist (explicit unsupported result, no write, no ambient fallback) until Batch 16 adds the validated immutable linkage. Ambient (no context) import stays unchanged.
- Batch 16 acceptance gains: persisted import linkage per route; same SDK sessionId from two routes does not merge or skip silently.
- Evidence: implementation-report-batch-12.md; batches.md Batch 16 scope (session metadata linkage). Fail-closed, reversible.

## D17 — Batch 14 ownership +1: session registry binding (2026-10-23, orchestrator)

- Lane finding: the quota probe reads SessionRecord, which has no admitted account route or auth epoch (`session-registry.service.ts:253` register, `:422` setSessionQuery). Matching-query identity (plan 209–211) is impossible without it.
- Decision: Batch 14 also owns `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts` (5/6 files). Add an optional immutable account binding (route identity + auth epoch) on SessionRecord and one bind method; a second bind with a different value refuses. A named quota read requires a record whose binding matches the requested route and current epoch; otherwise it returns an explicit unavailable result. Batch 17 populates the binding at launch. Ambient reads unchanged.
- Options rejected: associate route and query because a caller passes both (no verification); unavailable-only quota (loses the contract Batch 17 needs).
- No batch owns the file; claim sent to TASK_2026_714. Fail-closed, reversible.

## D18 — P1-C reviewer: Claude subagent, user exception (2026-10-23, user)

- Antigravity hit its quota (429, ~98h); Grok at 99% weekly; Codex is the implementer family. User chose a Claude (Anthropic) subagent as an exception to the lanes-first rule (valid until 2026-10-24) for the P1-C phase review.
- Review family: Anthropic on OpenAI (Batches 12–15, quota split) and Anthropic on Anthropic for orchestrator fix 0c7313438 (same family; reason: no other family available; weaker evidence; CI spec run 27/27 pass locally).
- PR #808: user keeps it ready (not draft); P1-C and later phases go to the same PR.

## D19 — P1-C accepted (2026-10-23)

- Phase review (Claude subagent, Anthropic, on Codex Batches 12–15 + quota split; D18 user exception): REVISE 7/10, 0 Blocking, 2 Serious, 6 Moderate, 3 Minor (`code-logic-review-phase-p1-c.md`). Orchestrator fix 0c7313438: mapping unchanged (same family, weaker evidence).
- One fix round by two file-disjoint Codex lanes: output-styles (F1 opaque named labels, F2 real-path containment, F3 missing global style → no style + unavailable marker, F4 logs) and agent-sdk (F4 logs, F6 LRU epochs with active-read protection, F7 per-entry link skip).
- Deferred as named later items (lean rule 4; no lane-config break or data loss): F5 named plan-usage reads bypass TTL (add owner/epoch-proof cache + minimum interval); F8 no global cap on account model probes (add a small semaphore). Minors F9–F11 recorded.
- Re-review: APPROVED (`code-logic-re-review-phase-p1-c.md`). Open follow-ups for Batch 17 certification: N1 (Moderate) raw account paths still logged at jsonl-reader.service.ts:448, :898, :1069; N2 (Minor) file-level symlink can redirect a named style write; N3 (Minor) no consumer of the style-unavailable marker yet (Batch 17 launcher / UI); N4 (Minor) redundant second readdir.
- P1-C (Batches 12–15) accepted pending CI. Next phase: P1-D (Batches 16–22); Batch 16 owns shared session-metadata-store.ts — claim with TASK_2026_714 first.

## D20 — Batch 16 split: SDK session attachment needs migration 0059 (2026-10-23, orchestrator)

- Lane finding (implementation-report-batch-16.md): `0058_provider_accounts.ts:58` keys run bindings by run ID only; no SDK session ID column, attachment state or mapping table. SDK attachment, authoritative SDK-ID lookup and the two-store admission are blocked inside the five-file scope.
- Decision: commit Batch 16 part A as delivered (awaitable run-binding commit/read, immutable path-free metadata linkage, collision refusal, server-first resolver, unknown-baseline resume refusal). Admission stays release-held, so no prompt is authorized by part A.
- Batch 16b (new): append-only migration `0059_provider_account_session_links` (convention: migrations are append-only; 0044/0046 specs count them), plus store/service attach + lookup by (provider, SDK session ID). Primary key (provider, sdk_session_id): one SDK session binds to one route; a second route refuses (D16 refusal option). Two file-disjoint Codex lanes (≤6 files each) with one fixed schema contract.
- Batch 12 named-import refusal stays until 16b and the importer handoff (report § Exact importer handoff) land. Importer owner: Batch 17 certification list (not yet owned; record in batches.md).
- Recorded for its owner, not fixed: `libs/shared/src/lib/types/provider-account.schemas.ts:47,121-123` require positive epoch/revision, the registry persists zero-based values. Batch 17 aligns the shared schema.
- Options rejected: edit unshipped 0058 in place (dev databases that already ran 0058 would never get the column); use run_id as an SDK alias (overloads identity). Reversible until merge.
- Verification: diagnostics unavailable in the lane; per the user's lanes-first rule CI runs typecheck/tests. Local audit: agent-sdk 3/4, auth-providers 24/24.

## D21 — Batch 17 accepted for commit; Batch 17b scope (2026-10-23, orchestrator)

- Batch 17 (Codex, 6 files incl. session-registry.service.ts per D17): named bootstrap + own-gate final query coordinator behind a token-only persistence port `SDK_NAMED_ACCOUNT_PERSISTENCE`; route model reads and epoch invalidation; ambient path unchanged; admission stays release-held. Diagnostics clean in the six files. Claim on sdk-agent-adapter.ts acknowledged by TASK_2026_714 (keep additive).
- Orchestrator test-only fix: `session-metadata-store.account-binding.spec.ts:24` TS2352 cast removed (MockLogger is assignable, as in session-metadata-store.spec.ts).
- Batch 17b (agent-sdk + shared, file-disjoint from Batch 18): (1) `resolveAccountBinding` must require BOTH the authoritative link and matching metadata linkage — server binding with absent metadata refuses (lane finding, `session-metadata-store.ts:736`); (2) importer handoff from implementation-report-batch-16.md; (3) shared schema zero-based epoch/revision alignment (`provider-account.schemas.ts:47,121`); (4) D19 N1 raw paths in `jsonl-reader.service.ts`.
- Deferred to the certification batches (named admission stays release-held until then, D7): host registration of `SDK_NAMED_ACCOUNT_PERSISTENCE` (adapter to ProviderAccountService + SessionMetadataStore) with DI guard specs; termination proof in `off-thread-process-spawner.ts:529` (signal-only exits keep the reservation, conservative); D15 broad env prefix drop.
- Batch 18 must carry authoritative named context for bound sessions when accountSelection is omitted (active reuse and slash paths refuse explicit named selection today).

## D22 — Batch 18 partial; Batch 18b and Batch 21 additions (2026-10-23, orchestrator)

- Batch 18 (Codex, 3 files): central start/resume/slash funnel resolves the authoritative original binding before continuation/context work; ambient fresh and API-key routes unchanged; typed port refusals keep the conversation; slash gate precedes compact admission. Named execution stays release-held (successful preflight settles the unused lease and refuses). Lane diagnostics unavailable; CI runs typecheck/tests (lanes-first rule).
- Batch 17b committed e3965c65c (both-store resume, optional import lookup, zero-based epochs). CI fixes: b559e3a77 (fs/promises mock), TS2352 cast (in e02d03ea4). main (Nx 24) merged 963e2924d.
- New Batch 18b (rpc-handlers, 1–2 files): `handlers/session-rpc.handlers.ts:1383` fork calls `sdkAdapter.forkSession` without the account gate; `:1457-1470` active rewind skips the gate. Gate both before transcript copy / rewindFiles. Runs after Batch 19/20 lanes are file-disjoint from it.
- Batch 21 ownership +1: `chat/session/child-chat-session-host.adapter.ts:96,151` passes the parent/handoff SDK session id as `sourceSessionId` (inherited handoff vs fresh launch).
- Deferred to the Accounts UI / RPC contract batches: `libs/shared/src/lib/types/rpc/rpc-chat.types.ts` accountSelection + safe accountRefusal, `chat-rpc.schema.ts:64,82,96`, frontend refusal display (no recovery chooser).
- Deferred to certification (release-held, D7): SDK live-turn lease transfer (`sdk-agent-adapter.ts:1183,1653`), `SDK_NAMED_ACCOUNT_PERSISTENCE` and `SDK_SESSION_IMPORT_BINDING_LOOKUP` host registration with DI guard specs, then replace the preflight hold at `chat-slash-command-router.service.ts:142`.

## D23 — Batch 18b ownership +1: public gate-only wrapper (2026-10-23, orchestrator)

- Lane finding (implementation-report-batch-18b.md): the Batch 18 gate `ChatSessionService.gateAccount` (`chat-session.service.ts:1752`) is private; `SessionRpcHandlers` already injects ChatSessionService (`session-rpc.handlers.ts:198`). `ensureSessionActiveForRewind` can resume, so it cannot serve as a gate-only call without changing ambient behaviour.
- Decision: Batch 18b also owns `chat-session.service.ts` to add one public gate-only method that delegates to `gateAccount` (no logic copy, no DI change). Options rejected: handler DI change to the account port (duplicates gate logic); reuse ensureSessionActiveForRewind (ambient side effects). No concurrent owner (Batch 19 is cli-agent-runtime; Batch 21 comes later). Reversible.

## D24 — CI shard 4 fix for Batch 19/20 (2026-10-23, orchestrator)

- CI `test (shard 4/4)` on 9194a8d3c: 4 cli-agent-runtime suites, 15 tests failed. CLI E2E passed, so 9c3d441d5 fixed the DI boot regression.
- Production defect (Batch 20, `claude/claude-sdk-lane-runner.ts:172`): the ambient stream-loop error log changed from `[PtahCliRegistry] spawnAgent stream loop error: <message>` to a generic text. Ambient must stay unchanged: ambient lanes log the original text again; named lanes keep the generic text (a raw error can carry account paths). Pinned by `ptah-cli-registry-sakana-proxy.spec.ts`.
- Test-only: `agent-events.spec.ts`, `sdk-callbacks.spec.ts` mocks gain `findAgentInfo` (Batch 20 stale-exit check, `wiring/agent-events.ts:206,489`). Both real exit paths set a terminal status before `agent:exited`, so the guard does not skip ambient exits. `agent-process-manager.service.spec.ts` resume-gate assertions pin `accountReference: {}` (ambient passes an empty reference; `resolveLaneAccountResume` returns undefined for it — no behavior change).
- Verification (slot held, released after push): the 4 suites 231/231; Batch 19/20 specs (account-binding, claude-cli.adapter, claude-sdk-lane-runner, lane-resume-gate) 108/108; di-lint OK; degradation audit no FAIL. Commit c124a1e4b, pushed.
- The P1-D phase review is recorded as D25.

## D25 — P1-D phase review triage (2026-10-23, orchestrator)

- Review: `code-logic-review-phase-p1-d.md`, Glm lane `02bfbee6`. Review family: glm-5.3:cloud (Ollama) on OpenAI (Codex). Verdict APPROVED WITH FIXES, 7/10; 0 Blocking, 0 Serious, 3 Moderate, 6 Minor. Guarantees 1–7 pass; the open item (ambient Claude-CLI child reads the parent binding from storage, refuses on read failure) judged acceptable fail-closed.
- Fix round (orchestrator, bounded correction per agent-lanes §6): **F2** — one row with a malformed `accountBinding` made `getAll()`/`getForWorkspace()` throw for every session (ambient included), and every write path that reads `getAll()`. List reads now use `listAccountLinkage` (`session-metadata-store.ts`): a bad row keeps its stored binding key and stays listed; `get()`, `resolveAccountBinding` and every gate still refuse `invalid-bound`. No list consumer makes an account decision (registry and quota probe read in-memory records; the slash gate uses `get()`). Spec updated to pin the new list behavior. Option rejected: skip bad rows (hides sessions, data loss from the user's view).
- Deferred, unreachable while admission is release-held (D7) and `claude` is absent from the lane roster:
  - **F1** (lease retained forever when settlement runs before the child exit lands, `claude-sdk-lane-runner.ts:615-637`) → certification, together with the termination proof (`off-thread-process-spawner.ts:529`).
  - **F3** (`continueConversation` makes every `claude` lane, ambient included, account-scoped; a continue failure exits the lane and throws `LaneAccountResumeError`, which `agent-rpc.handlers.ts:1245` does not map) → Batch 26 roster activation. That batch must also pass `accountPersistence` to `ClaudeCliAdapter` (`di/register.ts:105`), or every `claude` lane resume refuses `unavailable-storage`.
  - **F8** (inherited child chat on a non-`claudeCli` workspace ignores a bound parent) → certification.
- Minor, recorded, not fixed: F4 (refusal code collapse), F5 (empty model probe skips named model check), F6 (corrupt local lane reference reads as absent), F7 (continue refusal after commit), F9 (`cliSessionId ?? ''` → misleading `invalid-bound`).
- Re-review: one short Glm re-review scoped to the F2 fix → `code-logic-re-review-phase-p1-d.md`.
- Re-review (`code-logic-re-review-phase-p1-d.md`, Glm lane `f735e959`, fresh lane with a full brief): **APPROVED**; F2 fixed for list reads and `_saveInternal`; D25 deferrals judged sound. Residual **R1** (Moderate, host-conditional): `flush()` still maps every staged row through strict `sessionIndexEntry` (`session-metadata-store.ts:876` → `:362`), so on a host with async state storage and NO session records repository one malformed row still fails every index write. Electron and the CLI always register the records repository (`apps/ptah-electron/src/di/phase-1-infra.ts:167`, `cli-engine/src/lib/container.ts:482`), so the priority host cannot reach it; VS Code reachability is unconfirmed. Not fixed in this round (the bounded post-review correction was already used for F2). Follow-up owner: next agent-sdk batch — map non-target staged rows through `listAccountLinkage` in `flush()`, keep `sessionIndexEntry` strict for the row being written. Two Minor re-review notes recorded in the re-review file.

## D26 — Session 6 setup: P1-E/P1-F delivery, executors, verification (2026-10-24, orchestrator)

- PR #808 head 476f87d67 failed only `test (shard 3/4)`: four rpc-handlers persona specs from main lacked the account-gate mocks. Spec-only fix b7cfb14f4 on `feat/provider-accounts` (report `ci-fix-pr808-shard3.md`). No feature commits on #808.
- New branch `feat/provider-accounts-p1e` from b7cfb14f4, worktree `.claude-worktrees/provider-accounts-p1e` (node_modules junction per D10). PR base `feat/provider-accounts`; retarget to `main` after #808 merges.
- Executors: the lanes-first rule expired 2026-10-24. Live roster: codex room, grok unknown (API key), Glm unknown, opencode AT LIMIT, antigravity reader failed, copilot disabled. Implementation: Claude specialist subagents (Anthropic) under the lane rules (≤6 files, ≤45 tool calls, scoped diagnostics, no heavy checks; the orchestrator runs checks in the shared slot). Phase reviews: Codex lane (OpenAI family), so Review family differs from the implementer. Fallback reviewer: Glm (Ollama), then a same-family subagent with a weaker-evidence label.
- Verification: the batches.md `Verify-ProviderAccountsBatch` five-host sweep per batch exceeds the memory-safe rule for this machine. Scoped equivalent per batch: typecheck + lint + test of the changed projects, plus typecheck of dependent hosts only where a shared tuple/contract changes (Batch 25, 26, 34, 35). CI runs the full matrix on each push. Reversible.

## D27 — Batch 23–25 scope adjustments and recorded gaps (2026-10-24, orchestrator)

- Batch 23b (new, 4 files): Batch 23 left three call sites unwired, so named lanes shared the `ptah-cli:claude` remembered-owner key. 23b passes the route from the lane runner, manager and limit lookup (`laneRouteFingerprint`). A corrupt binding is neither remembered nor read (fail-closed). Live named usage windows still need a certified per-row route source → Batch 27/28.
- Lint: `nx lint cli-agent-runtime` had 6 errors from P1-B..P1-D batches (CI runs no project lint). Fixed with no behavior change (holder objects instead of `const` where reads precede assignment). Pre-existing main lint debt left untouched and out of scope: `chat` "Static imports of lazy-loaded libraries" (many files), `usage-analytics/codex.source.ts:43` prefer-const.
- Batch 24 gap: a named account whose directory is physically `~/.claude` is counted twice (the default route has no directory identity). Owner: admission must refuse that directory, or the default route gets an identity → certification list. `observeRoute` has no production caller yet → the batch that admits named runs (certification).
- Batch 25 → Batch 27 ownership +1: the 10 `provider:*Account*` methods cannot enter `RpcMethodRegistry`/`RPC_METHOD_ENTRIES` without a same-change owner in `rpc-handlers/src/lib/host-profile/manifest.ts` (`assertManifestInvariants`). Batch 25 ships `ProviderAccountRpcMethodRegistry` + names only; Batch 27 also owns `libs/shared/src/lib/types/rpc.types.ts` to extend the registry atomically with the manifest. RPC zod schemas live in Batch 27's `provider-account-rpc.schema.ts` (shared barrel stays zod-free).
- Follow-ups with owners (D27): push message type in `libs/shared/src/lib/types/messages/message-constants.ts` → Batch 27; `claudeModel`/`claudeReasoningEffort` write routing in `libs/backend/platform-core/src/file-settings-keys.ts` → Batch 28 (+1 file, with the agent config handler mapping); `rpc-chat.types.ts` accountSelection + safe refusal (D22) → Batch 28 if within six files, else Batch 34.

## D28 — Batch 26 split and roster activation (2026-10-24, orchestrator)

- Batch 26 split into 26 (roster: `claude` is the 8th, last `SYSTEM_CLI_TYPES` member), 26b (D25 F3: `agent:continue` maps `LaneAccountResumeError` to wire code `unknown` with fixed safe text), 26c (read-only `LaneAccountBindingPort` from `ProviderAccountService.lookupBySdkSession`: absent → ambient continue proceeds, bound → `release-held`, store missing/failing → `unavailable-storage`; `CLAUDE_LANE_ACCOUNT_PERSISTENCE` stays unregistered on every host, D7) and 26d (tuple compatibility: `AgentListCliModelsResult = Record<SystemCliType, …>`, matrix/permission/tribunal rows, spec fixtures). Reason: the tuple change broke 6 consumer projects (Batch 26 report, exhaustiveness inventory).
- `laneAccountRefusalCode` in `agent-rpc.handlers.ts` matches `LaneAccountResumeError` by name plus a whitelisted code, not `instanceof`: 7 agent-rpc specs mock the barrel without the class, so `instanceof` would throw. Follow-ups: add the class to those mocks and switch to `instanceof`; add a dedicated `account_refused` code to both `AgentContinueErrorCode` copies; check `agent:resumeCliSession` generic catch for the same error.
- `cli-permission-notes.ts` claude note is not in `PENDING_USER_REVIEW_IDS` (the spec pins the list) → decide in Batch 28/29.
- `listModelsForAll()` now calls the ambient Claude native catalog when `claude` is installed (no inference, no named query).
- Orchestrator spec-only fix: `cli-model-list.service.spec.ts` "returns empty arrays for missing detector entries" expects the 8-key tuple (`claude: []`).
- Orchestrator fixes found by the scoped run (bounded correction): `lane-model-listing.adapter.spec.ts` fixture gets `claude: []` (TS2741); `apps/ptah-cli/.../agent-cli.ts` unscoped `models list` now reports `claude` (it dropped the key, the same defect its comment describes), and `agent-cli.spec.ts` no longer lists `claude` as an unknown selector. Lint: `rpc-handlers/package.json` declares `@ptah-extension/auth-providers-tokens` (type imports from P1-C/P1-D), and Prettier fixed two `no-unexpected-multiline` errors in `chat-session.account-binding.spec.ts` (format only).
- Verification (slot held): tests shared 124/3754, lane-routing 25/756, chat-ui 85/1565, cli-agent-runtime 116/2520, vscode-lm-tools 99/3169, tasks-ui 20/651, tribunal-panel 21/347, rpc-handlers 175/4527; ptah-cli agent-cli spec 62/62; chat ptah-ai settings 19 suites/467; lint cli-agent-runtime, shared, rpc-handlers 0 errors; typecheck ptah-cli OK. `vendor-roster-drift.spec.ts` passed (no Batch 28 dependency).

## D29 — Batch 27 split (2026-10-24, orchestrator)

- Batch 27 owns 6 files plus 2 from D27 (`rpc.types.ts`, `message-constants.ts`) plus a handler spec: over the 6-file lane cap. Split, file-disjoint and sequential:
  - **27a** (unregistered domain endpoint): CREATE `provider-account-rpc.schema.ts`, `provider-account-rpc.handlers.ts`, `provider-account-rpc.handlers.spec.ts`; MODIFY `libs/shared/src/lib/types/messages/message-constants.ts` (push type). The handler class is not yet registered, so no method is reachable.
  - **27b** (registration, atomic): MODIFY `libs/shared/src/lib/types/rpc.types.ts` (registry + `RPC_METHOD_ENTRIES`), `host-profile/manifest.ts`, `register-shared-rpc-handlers.ts`, `host-profile/host-profile.ts`, `apps/ptah-electron/src/rpc-host-profile.ts`, plus at most one guard spec. Further guard specs (rpc-surface, surface-composition, expected-resolvable) are reported and become 27c if needed.
- Reason: lane cap (≤6 files) and the D27 rule that the registry and the manifest change in one commit. Reversible.

## D30 — Batch 27a acceptance and 27b/27c split (2026-10-24, orchestrator)

- 27a accepted (be9ea2f25): spec 44/44, typecheck + lint rpc-handlers and shared 0 errors. Orchestrator bounded correction: `safeStoreSummary` no longer forwards the store's generic default sentence, so a `conflict` shows its fixed copy ("Refresh and try again"); the real `ProviderAccountStoreError` default (`provider-account-route.ts:18`) is the same generic sentence.
- Recorded gap (owner: certification): the handler keeps its own revision seeded from `Date.now()`; account changes made outside the handler do not bump it or push. `ProviderAccountStoreError` is matched structurally (not exported from the auth-providers barrel).
- 27b needs 7 source files (27a report: + `host-profile/capabilities.ts`, + `rpc-handlers/src/index.ts`). Split, file-disjoint, run in parallel, committed together:
  - **27b** (registration core): `libs/shared/src/lib/types/rpc.types.ts`, `host-profile/manifest.ts`, `host-profile/capabilities.ts`, `host-profile/host-profile.ts`, `register-shared-rpc-handlers.ts`, `rpc-handlers/src/index.ts`.
  - **27c** (Electron enable + guards): `apps/ptah-electron/src/rpc-host-profile.ts`, `apps/ptah-extension-vscode/src/di/expected-absent.ts`, `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`, `host-profile/manifest.spec.ts`, `host-profile/resolve-handler-plan.spec.ts`, plus at most one CLI/TUI absent list.
  - Shared contract: capability key `providerAccounts` (true in Electron only, false in `ALL_DISABLED`); handler class `ProviderAccountRpcHandlers`; method names from `PROVIDER_ACCOUNT_RPC_METHOD_NAMES`.

## D31 — Batch 28 split (2026-10-24, orchestrator)

- Batch 28 owns 6 files plus `platform-core/src/file-settings-keys.ts` (D27) = 7. Split, file-disjoint, parallel with 27b/27c (no shared files):
  - **28a** (agent RPC + settings routing): `rpc-handlers/.../agent-rpc.schema.ts`, `agent-rpc.handlers.ts`, `platform-core/src/file-settings-keys.ts`, plus their specs (≤6 files).
  - **28b** (MCP/namespace parity): `vscode-lm-tools/.../agent-spawn-args.schema.ts`, `tool-description.builder.ts`, `agent-namespace.builder.ts`, `system-namespace.builders.ts`, plus ≤2 specs.
- `rpc-chat.types.ts` accountSelection (D22) stays out of Batch 28 → Batch 34 (file cap). `PENDING_USER_REVIEW_IDS` for the claude permission note → Batch 29 (frontend owner).
- Both use the Batch 25 contracts in `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`; neither edits shared.

## D32 — Batches 27b/27c/28a/28b acceptance (2026-10-24, orchestrator)

- Verification (slot held): typecheck shared, rpc-handlers, platform-core, vscode-lm-tools, cli-engine, ptah-electron, ptah-extension-vscode, ptah-cli OK; tests shared 124/3754, platform-core 48/961, rpc-handlers 176/4601, cli-engine 25/230, vscode-lm-tools 99/3213; Electron rpc-surface + surface-composition + container.smoke 42/42; VS Code rpc-surface + container.smoke 54/54; lint of the five libs 0 errors.
- Orchestrator corrections: shared `rpc-provider-accounts.spec.ts` now asserts each account method is registered exactly once (27b registered them by design); 28b `ptah_agent_spawn` top-level description exceeded its 1568-char budget (1900) → the claude sentence moved into the `cli` property description, the top-level text is unchanged; `agent-spawn-args.schema.spec.ts` imports `reflect-metadata` (it now loads the builder).
- For the P1-E review: 28a reads the stored account through the handler's container instead of a constructor `@inject` (keeps 7 agent-rpc specs that build the handler directly); 27b registers `ProviderAccountRpcHandlers` as a singleton (request ledger + revision state). `SpawnAgentRequest` has no account field, so a selection is validated but not forwarded → Batch 34. Recommended, not done: Electron `container.smoke.spec.ts` resolve test for `ProviderAccountRpcHandlers`.
- Out-of-scope observation (28a): `grokReasoningEffort` / `antigravityReasoningEffort` may not be routed in `file-settings-keys.ts` → check in Batch 34.

## D33 — PR #808 review fixes and P1-E review triage (2026-10-24, orchestrator)

- Check slots: the user confirmed (AskUserQuestion, this session) that up to 3 heavy checks may run at the same time across sessions, with no "released" messages. This replaces the one-slot rule for this task.
- PR #808: the 7 CodeRabbit threads are answered. Fixed in 87c373e1f: 1fe (fail-closed admission port without SQLite), 1fL (never-spawned child releases with proved termination), 1fh (unknown identity never matches; bootstrap refuses it before any binding), 41SX (lenient async index flush). No change with evidence: 1fH (D25 F2), 1fi (needs named admission, D7), 1fl (roster arrives in Batch 26). Orchestrator spec-only correction: the `provider-account.store.spec.ts` disposal fixture now uses a spawn promise that never settles (`null` now means "never started").
- P1-E Serious (request-id idempotency lost after ledger eviction or restart): fixed in fb0041487, the profile id is derived from the request id, so the primary key blocks a duplicate. No schema change.
- P1-E complete re-review (codex, 74/74 files, `code-logic-review-phase-p1-e-r2.md`): 8/10, no Blocking or Serious, no release-hold bypass. One Moderate (Add replay after rename compares the current label) cannot lose data or break a lane config → named later task P1E-F4. Deferred also: P1E-F2 (post-commit snapshot push loss), P1E-F3 (clock-seeded revision, D30), P1E-S1 (D32 container lookup).
- Review family: codex (OpenAI) reviewing Claude (Anthropic) implementers. The first P1-E review had incomplete coverage (role forbade git); the r2 review ran without a role and read the full diff `87c373e1f..HEAD`.
- Known local-only failure: `auth-providers` `translation-proxy.sdk.integration.spec.ts` (real CLI, 4 tests) fails on both branches; its folder is unchanged and CI passes. Pre-existing lint errors in `auth-providers` (package.json dependency-checks, `provider-account.store.ts:16`, `provider-account.store.spec.ts:131`) and `claude-sdk-lane-runner.ts:92,352,467` come from #808 commits 738ae99ef7 / b95a97e47a, not from this round.

## D34 — Batch 29 acceptance (2026-10-24, orchestrator)

- Executor: frontend-developer subagent (Claude). Review deferred to the P1-F phase review at Batch 35 (different family).
- File swap allowed by the batch: `apps/ptah-extension-webview/src/app/app.config.ts` registers `ProviderAccountsStateService` as a `MESSAGE_HANDLERS` multi-provider (the router reads handlers once at startup); `core/src/index.ts` is unchanged because `providers-settings-state.service.ts` re-exports the service, like the Providers types (`index.ts:7`).
- The webview cannot read the `providerAccounts` capability; the service gates on `isElectron` (the only host where the capability is true). Inert elsewhere: no RPC, pushes ignored.
- `claudeModel` / `claudeReasoningEffort` are read into Providers state only. Writing them needs `providers-commit.service.ts` → Batch 33 (Electron Accounts composition owns the Providers write path) or Batch 34 if the file cap does not allow it.
- `PENDING_USER_REVIEW_IDS` for the claude permission note (D31) moved out of Batch 29 (file cap) → Batch 33.
- Verification: core 46 suites / 1341 tests; typecheck core, ptah-extension-webview; lint of the 5 changed files 0 errors. The new config fields are optional on `agent:getConfig`, so the 5 specs that build the config literally still compile.
