# Batches - TASK_2026_596_0a19

Total tasks: 53 | Batches: 22 | Phases: 7 | Complete: 21/22 (Backend Phases 1-5 closed; Batches 14-15 COMPLETE 164848d93, a90f7594f; Phase 5 review APPROVED 9/10, fix 670c74a72; Batch 16 COMPLETE c1ee76c22; Batch 17 COMPLETE a9ab741fc; Batch 21 COMPLETE b1d53356f; Batch 18 COMPLETE 0099a3c58; Batch 19 COMPLETE f6189781d; Batch 20 COMPLETE 46ba54af7; Phase 6 closed — code review APPROVED 8/10, visual review APPROVED 8/10, fix e61eaeeec, harness f077277fd; follow-up TASK-596-FU-PHASE6; Batch 22 COMPLETE dd500c95a — **all 22 batches COMPLETE; TASK COMPLETE, see "Completion summary" at the end**)

Worktree root (all paths below are absolute under it):
`D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets` (branch `feat/task-596-quota-resets`,
base origin/main 5bb19f9fb).

Binding inputs: `implementation-plan.md` Revision 3 **plus the Gate 2 amendments G1-G3 at its top (they
override any conflicting text)**, `design-spec.md` Rev 5 with §3.3 amendments A1-A3 (they override the
prototype), `task-description.md` Rev 3, `context.md` ("Rebase", "User Decisions", "CLI Lanes").

## Run rules (recorded defaults)

- **Authoring executors**: Claude sub-agents (backend-developer, frontend-developer, senior-tester).
  Every batch runs **sequential** with one executor. Updated at Batch 9 (orchestrator, user rule): a codex
  or opencode CLI lane may also author a batch; Batch 10 runs on a codex lane. Lanes never run git, and
  the lane gets a self-contained prompt with absolute paths.
- **Phase reviewers**: one code review per phase on the combined phase diff, run as a CLI lane. Allowed
  lanes (user rule, `context.md:74-76`): codex or opencode only — discover with `ptah_agent_list` at spawn
  time; opencode has no messaging, read it with `ptah_agent_read`. Antigravity and Glm are NOT allowed. If
  neither allowed lane is available, fall back to a code-logic-reviewer sub-agent and record the reason.
  Phase 6 additionally needs the visual-reviewer sub-agent (dark + light, 280/360/440 px).
- **Concurrency**: batches are file-disjoint as listed. Pairs marked "concurrent-safe" may run in two
  executors at once; each still commits separately, and the later one re-runs its verification after the
  earlier commit lands (Nx typecheck reads sibling-lib sources through path mappings).
- **Verification**: Nx project names are scoped (`@ptah-extension/<lib>`); the plan's bare names
  (`-p shared …`) do not resolve. Every command below uses the real names. Output tailed, never pasted.
- **Never touch** (check every batch diff before commit): `libs/frontend/chat/src/lib/settings/**`,
  `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings`, `apps/ptah-electron-e2e/src/specs/settings`,
  `apps/ptah-tui/src/components/settings`, and the 597-deferred files `codex-cli.adapter.ts`,
  `opencode-cli.adapter.ts`, `responses-request-translator.ts`, `sdk-adapter-events.service.ts`,
  `session-query-executor.service.ts`, any compaction file. `translation-proxy-base.ts` is the one allowed
  exception (Component 9, minimal edit).
- **No live checks**: no network call to ollama.com, no Antigravity LS probe, no rollout read, no forced 429.
  The only local command allowed is the offline Codex `--version` / `app-server generate-ts` in Batch 6.
- **Uncommitted rename**: the "Main context" → "Context" edit already on disk in
  `libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.ts` and its `.spec.ts`
  belongs to this task and is committed with **Batch 16** (the designated first frontend batch).
- Only the team-leader edits this file and commits. Executors never run git.

## Plan validation

Status: PASSED WITH RISKS

### Plan defects found (resolved here without redesign; no BLOCKER)

| # | Defect | Evidence | Resolution in batches |
| --- | --- | --- | --- |
| D1 | Verification commands use bare Nx project names | `implementation-plan.md:514-515, 635, 959, 1081, 1603-1604`; real names are `@ptah-extension/*` (`libs/shared/project.json` `"name"`, `nx show projects`) | All batch commands use scoped names |
| D2 | auth-providers barrel is already at the 150-line limit, yet Component 5 adds exports | `libs/backend/auth-providers/src/index.ts` = 150 lines; `CONVENTIONS.md:51`; `implementation-plan.md:704` | Task 8.4: quota sub-barrel + keep root barrel ≤150 (RISK R1) |
| D3 | Text still says `quotaOwnerKey` after G3 replaced it with `quotaOwner {providerId, identityKind, key, label}` | `implementation-plan.md:456-457, 497-498, 923-924, 1149-1153, 1174` vs G3 `:19-25` | Batches use `quotaOwner` everywhere; `AgentProcessInfo` carries the same shape (ASSUMPTION AS2) |
| D4 | Claude invalidation via `authFileChanged`/`configChanged` and F55 step 2 "`authFileChanged` fires" are void under G2 | `implementation-plan.md:450, 595, 623, 632, 1431, 1472` vs G2 `:12-18`; emitter is Codex-only (`codex-auth.service.ts:184-198`) | Batch 5 probe does NOT subscribe to those events for Claude; F55/F77 use two `accountInfo()` results across queries |
| D5 | G3 zod validation on restore names no file | G3 `:22-23`; the single restore seam is `SessionMetadataStore.getCliSessionsForRestore` (`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:869-874`), used by `session-rpc.handlers.ts:1008-1009` and `chat-session.service.ts:1022-1023` | Task 5.2 validates there (backend; frontend libs carry no zod) |
| D6 | `ProviderOwnerResolver.ownerForSession` is described as "Component 10b's route table", but the resolver is in auth-providers and 10b in cli-agent-runtime (auth-providers cannot import cli-agent-runtime) | `implementation-plan.md:332, 1584`; import graph `:200` | Session route→owner mapping lives in the resolver, using `SessionQuotaProbeService.sessionRoute` (agent-sdk); 10b only reuses the resolver for dashboard/lane targets (Task 6.1, 13.2) |
| D7 | Dependency list is stale: "7 needs 1" and "9 needs 7 and 4 (fingerprint)", but Component 7 imports `accountOwnerKey` from `provider-owner.resolver.ts` and the fingerprint now lives there | `implementation-plan.md:765, 1547-1549` vs `:309-315` | Batch 6 lands the resolver with the Codex hardening; Batch 7 follows |
| D8 | Component 5 still mentions "credential fingerprint from the probe" and "agent-sdk (registry, probe, fingerprint)" | `implementation-plan.md:662, 674` vs `:599, 640` | Follow Component 4 / Decision 3: probe returns route only, resolver hashes |
| D9 | No DI token named for `ProviderOwnerResolver`, `PlanCredentialSource`, `PlanLimitOwnerDiscoveryService` | tokens listed only at `implementation-plan.md:642, 702`; 10b files `:970` | Tasks 6.3 and 13.3 add `Symbol.for` tokens (CONVENTIONS §2-§9) |
| D10 | G2 "start of EVERY query" is ambiguous: the live SDK `Query` stays open across turns | `implementation-plan.md:176`; `session-registry.service.ts:62, 395` | ASSUMPTION AS1: re-read at each turn boundary (the S1 boundary), which also covers query replacement |

### Assumptions

- AS1 (G2) — "every query" = each turn: `accountInfo()` is re-read once at the first SDK message after the
  previous `result` (the S1 turn boundary) and on `Query` replacement. Bound: one read per turn, never per
  message. Unverified; Task 5.1 confirms from `session-registry.service.ts`/`session-control.service.ts`
  and records the chosen trigger in its report.
- AS2 (G3) — `AgentProcessInfo.quotaOwner?` uses the same `{providerId, identityKind, key, label}` shape as
  `CliSessionReference.quotaOwner?`, so live and restored runs compare identically; no `quotaOwnerKey`
  field exists anywhere. Verified against G3 wording "Replaces `quotaOwnerKey`".
- AS3 (A1 in plan) — installed `@openai/codex` is 0.155.1 (verified `node_modules/@openai/codex/package.json:3`)
  vs pin 0.147.0 (verified `codex-account.schemas.ts:8`). Task 6.2 runs the offline `--version` check.
- AS4 (A2 in plan) — regenerated selected Codex shapes are unchanged or additive. Task 6.2 diffs them; on
  incompatibility the executor STOPS and reports (no schema guessing).
- AS5 (A4) — `ollama-cloud` main sessions resolve `capacityRoute.providerId='ollama-cloud'`. **FALSE**
  (verified read-only in Batch 9, `batch-9-report.md` "AS5 check"):
  - Cloud-direct: `local-native.strategy.ts:213-220` sets `ANTHROPIC_BASE_URL` to
    `OLLAMA_CLOUD_DIRECT_BASE_URL = 'https://ollama.com'` (`local-provider-entry.ts:17`). This is neither
    direct Anthropic (`auth-env.utils.ts:3-6`) nor local, so `resolveCapacityRoute`
    (`session-query-executor.service.ts:110-121`) does a registry match against entry `baseUrl`
    `http://127.0.0.1:11434` (`local-provider-entry.ts:117`). Nothing matches, giving
    `{kind:'proxy', providerId:null}`.
  - Daemon: the base URL `http://127.0.0.1:11434/` matches both `ollama` (`local-provider-entry.ts:37`) and
    `ollama-cloud` (`:117`), so `matches.length === 2` and the provider id is `null`.
  - The effect: `ProviderOwnerResolver.ownerForSession` (`provider-owner.resolver.ts:357-360`) returns
    `unknown#unknown:<fp(session:<id>)>` for an Ollama Cloud main session.
  - Decision (orchestrator): unknown-owner attribution for Ollama Cloud main sessions is **not accepted**.
    `session-query-executor.service.ts` stays untouched. Resolved in **Task 10.3**.
- AS6 (A9) — cli-agent-runtime DI files are `libs\backend\cli-agent-runtime\src\lib\di\tokens.ts` and
  `register.ts`. Verified on disk.
- AS7 (A10) — main-session Ollama key lives under `getProviderKey('ollama-cloud')`. Task 8.3 reads
  `api-key.strategy.ts:356` and `local-native.strategy.ts` before writing `PlanCredentialSource`.
- AS8 (A5/A6) — Antigravity LS and Ollama `/api/usage` shapes are provisional; specs label payloads
  "provisional" and a mismatch yields `service-unavailable`. Not verifiable (no live checks).
- AS9 — Claude Agent SDK pinned at 0.3.278 (verified `package.json`); `usage_EXPERIMENTAL…` at
  `sdk.d.ts:2872`, `accountInfo()` at `:2928` (verified).
- AS10 — Nx targets `typecheck`, `test`, `lint` exist on the libs (verified on `@ptah-extension/shared`).

### Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R1 auth-providers barrel at 150 lines (D2) | MEDIUM | Task 8.4: explicit named exports in `src\lib\quota\index.ts`; root barrel adds them in as few lines as possible and stays ≤150 (consolidate an existing multi-line group if needed). Acceptance: `wc -l` ≤150 |
| R2 agent-sdk barrel already 377 lines (pre-existing violation) | LOW | Tasks 4.3/5.3 add only the minimal named exports; no growth beyond what consumers import |
| R3 Codex protocol re-pin may be incompatible (AS4) | HIGH | Task 6.2 stops and reports; Batch 6 then returns NOT ACCEPTED and the orchestrator escalates; Batches 7+ wait |
| R4 Credentials/emails leaking into logs, RPC or tool text | HIGH | F71 serialization spec (Tasks 8.3, 15.1); resolver is the only hashing site (Task 6.1); review focus in Phase 3/5 |
| R5 Shared hotspots with 597 follow-ups (`agent-process.types.ts`, `translation-proxy-base.ts`, `stats-bar.utils.ts`, `session-stats-summary.component.ts`, `agent-monitor.store.ts`) | MEDIUM | Edit only the regions named; no 597 behaviour; whichever lands second rebases (plan "597 seam") |
| R6 G2 per-turn `accountInfo()` adds a control request per turn | LOW | 3 s timeout, never awaited on the stream path, failure leaves owner unchanged (Task 5.1) |
| R7 Unknown-owner evidence leaking to lanes or other sessions | HIGH | `ownerRelation` never `same` for `unknown` (Task 3.2); F54, F67, F68 |
| R8 Tool output brand strings breaking guard specs | MEDIUM | Task 14.1 static strings brand-free; `vendor-roster-drift`, `lane-rule-single-home`, `agent-spawn-surface-parity` stay green |
| R9 Expansion state reset by pushes (A3) | MEDIUM | View-scoped state keyed `${sessionId}::${tileId}` (Task 18.2), F57/F73 |
| R10 Batch 1 exceeds 6 files | LOW | 7 tightly coupled type-only files in one lib; splitting would leave the shared barrel or payload map uncompilable mid-batch. Accepted exception |

### Edge cases

- Seconds vs ms vs ISO reset instants — Task 2.1 (F1)
- Seven-day Retry-After stays 7 d, never a weekly reset — Tasks 2.1, 7.1 (F10)
- Clock-time reset across midnight / relative `144h24m50s` — Task 2.1 (F5, F6)
- Unknown used never rendered as 0 — Tasks 3.1, 18.1, 19.x, 21.1 (F3)
- Reset passed, no newer read → "reset, usage unknown" — Task 3.1 (F4)
- Opus-only exhaustion does not touch Sonnet scope — Tasks 3.2, 8.1 (F22, F56)
- Cumulative `modelUsage` must not set S1 scope; subagent partials excluded — Task 4.2 (F75)
- Overage flag does not carry across turns — Task 4.2 (F76)
- 3xx clears the gate but emits no ledger success — Task 7.1 (F80)
- Proxy with no resolvable identity → unattributed cooldown nobody borrows — Tasks 7.1, 8.1 (F68)
- Account change A→B mid-session; restored run A with no ledger evidence still "Different owner" — Tasks 5.1, 5.2, 11.3, 13.4, 18.1 (F55, G3 restart fixture)
- Malformed or legacy `quotaOwner` restores as "Unknown owner", never current owner — Task 5.2, 18.1
- Running lane's owner upgrades unknown→known: persisted immediately — Task 11.3
- `MODEL_CAPACITY_EXHAUSTED`, timeouts, auth errors are not quota — Task 11.1 (F39)
- Slow reader > 3 s → that lane "limit lookup timed out", others returned; spawn never blocked — Tasks 13.1, 14.2 (F41, F52)
- Missing Ollama key → `unsupported-config`, still listed; placeholder key → `unsupported-auth`, no network — Tasks 10.1, 13.2
- Long lanes (>600 segments) keep exact usage totals — Task 17.1
- Harness-builder host passes no `limits` input → output unchanged — Task 19.2
- 200+ expansion entries in another view do not affect this view — Task 18.2 (F73)

---

## Phase 1 — Shared foundation (Batches 1-3)

Phase review: code-logic plus style (new public shared API), one CLI-lane review on the combined diff.

## Batch 1: Plan-limit contract types — COMPLETE (commit 977b5aad4)

- Recommended executor: backend-developer
- Fallback executor: backend-developer (fresh instance)
- Execution mode: sequential
- Rationale: type-only edits that must compile together (barrel, RPC registry, payload map)
- Tasks: 3 | Depends on: none
- Phase: 1 | Phase review: deferred to end of phase (Batch 3)

### Task 1.1: Create plan-limit types and RPC contract — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\types\plan-limit.types.ts` (CREATE), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\types\rpc\rpc-providers.types.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\types\rpc.types.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\index.ts`
- Plan reference: implementation-plan.md:470-524 (Component 1), Decision 3 `:280-307`, G3 `:19-25`
- Pattern to follow: `rpc-providers.types.ts:154-194`; registry entries `rpc.types.ts:1131-1134, 3695, 3797`
- Quality requirements: zod-free (`libs/shared/src/index.ts:30-34`); every existing `ProviderGetAccountUsageResult` field kept; additive only
- Validation notes: `ProviderGetPlanLimitsParams = {providerId?, sessionIds?, ownerKeys?, refresh?}`; no credential or credential-reference field anywhere (R4); `QuotaOwnerRef.identityKind` = `'account' | 'credential' | 'cli-store' | 'unknown'`
- Implementation details: declare every type in Component 1 list; add `'no-usage-source'` to the status union; register `provider:getPlanLimits` in both registry spots; export the new file from the shared barrel (barrel stays ≤150)

### Task 1.2: Lane failure kind and owner fields — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\types\agent-process.types.ts`
- Plan reference: Decision 5 `:389-398`, G3 `:19-25`
- Pattern to follow: `agent-process.types.ts:107-149` (AgentProcessInfo), `:378-402` (CliSessionReference)
- Quality requirements: `AgentFailureKind = 'quota'` with doc comment naming it the single failure/stop-kind union (597 adds members here)
- Validation notes: D3/AS2 — add `AgentProcessInfo.failureKind?`, `AgentProcessInfo.quotaOwner?: QuotaOwnerRef`, `CliSessionReference.quotaOwner?: QuotaOwnerRef`. **No `quotaOwnerKey`.** Do not touch the 597 regions (`SpawnAgentRequest.systemPrompt`, usage fields)
- Implementation details: import `QuotaOwnerRef` from `plan-limit.types.ts`

### Task 1.3: Push message type — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\types\messages\message-constants.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\types\messages\payload-map.ts`
- Plan reference: Decision 7 `:411-416`
- Pattern to follow: `SESSION_MCP_STATUS` entry (`message-constants.ts:132-155`, `payload-map.ts:286`)
- Quality requirements: `PLAN_LIMITS_CHANGED = 'planLimits:changed'`, payload `PlanLimitsSnapshot`
- Implementation details: add constant and payload-map entry together

### Batch 1 verification

- All 7 files exist and contain the declarations above (R10 exception)
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared`
- `grep -rn quotaOwnerKey libs/shared` returns nothing

Result (team-leader, Mode 2): typecheck, test and lint for `@ptah-extension/shared` passed; `quotaOwnerKey`
absent from libs/shared; the diff has exactly the 7 listed files, no "Never touch" file, and the chat-ui
Context rename is left unstaged for Batch 16. Batch 1 report: `batch-1-report.md`.

Tracked item for Batch 15: `provider:getPlanLimits` is now in `RpcMethodRegistry` / `RPC_METHOD_ENTRIES`
with no handler. No unit test in this batch or in `verify-and-report.spec.ts` / `provider-rpc.handlers.spec.ts`
checks the real registry against registered handlers, so no current test breaks. At runtime,
`verifyAndReportRpcRegistration` (`libs/backend/rpc-handlers/src/lib/verify-and-report.ts:87-108`) logs
drift on every boot and asserts when `NODE_ENV=development` or `PTAH_E2E=1`. Until Batch 15 lands, dev
and e2e runs of intermediate commits may fail that assert. Batch 15 must register the handler on every
platform, or list the method in `excluded` where it is not served, and confirm that the drift report is clean.

## Batch 2: Instants, precedence and CLI usage fold — COMPLETE (commit a78c4a55a)

- Recommended executor: backend-developer
- Fallback executor: backend-developer (fresh instance)
- Execution mode: sequential
- Rationale: pure functions with injected clock; one lib
- Tasks: 3 | Depends on: Batch 1
- Phase: 1 | Phase review: deferred to Batch 3

### Task 2.1: `instants.ts` — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\instants.ts` (CREATE, + spec)
- Plan reference: Component 2 `:530-535`
- Pattern to follow: `libs/shared/src/lib/utils/pricing.utils.ts` (pure shared util)
- Quality requirements: never throws; `undefined` on bad input; no `Date.now()`; Retry-After **unclamped**
- Validation notes: fixtures F1, F5, F6, F7, F8, F9, F10, F12
- Implementation details: `normaliseInstant`, `parseRetryAfterDeadline`, `resolveClockTimeReset`, `resolveRelativeReset`, `windowKindFromDuration`

### Task 2.2: `evidence-precedence.ts` and plan-limits barrel — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\evidence-precedence.ts` (CREATE, + spec), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\index.ts` (CREATE), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\index.ts`
- Depends on: Task 2.1
- Plan reference: Decision 4 precedence `:340-343`; constants `:543`
- Quality requirements: F21 (three precedence rules, one fixture each)
- Implementation details: `supersedes(next, prev, lastResetAt)`; constants `NEAR_LIMIT_PERCENT`, `FRESHNESS_MS`, `LIMIT_LOOKUP_DEADLINE_MS`

### Task 2.3: `addCliUsage` fold — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\cli-usage.utils.ts` (CREATE, + spec)
- Plan reference: Component 3 `:563-581`, Decision 8 `:418-431`
- Pattern to follow: `libs\frontend\chat\src\lib\components\molecules\agent-card\stats-bar.utils.ts:33-62` (oracle semantics)
- Quality requirements: tokens summed; latest model, cost and duration kept; `null` until any usage seen
- Validation notes: port the existing `stats-bar.utils` spec cases into the new spec as the oracle; add fold-in-order equivalence. `stats-bar.utils.ts` itself is NOT edited here (Batch 20)
- Implementation details: export from `utils/index.ts`

### Batch 2 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared`
- Specs exist beside each created file; no `Date.now()` in `plan-limits/`

Result (team-leader, Mode 2): `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared
--skip-nx-cache` passed (3/3 targets). A spec sits beside `instants.ts`, `evidence-precedence.ts` and
`cli-usage.utils.ts`. `Date.now` does not appear in `plan-limits/`. The committed diff has exactly the 8
Batch 2 files. The chat-ui Context rename and `.ptah/specs` stay unstaged. Batch 2 report:
`batch-2-report.md`.

Executor choices, judged against the plan:
- `windowKindFromDuration(durationMins, position)` returns `{kind, key, label}` with a 1-based position.
  ACCEPTED. The plan (`:535`, `:733`, Req 2.3, F12) says that unknown durations are "labelled by position"
  ("Window 1"/"Window 2"), and a single-argument signature cannot do that. Batch 9 (Codex reader) must
  pass a 1-based position (primary=1, secondary=2).
- Rule 2 of `supersedes` stays as an explicit guard, even though recency plus the tie-break already
  produce the same result. ACCEPTED. It encodes Decision 4 (`:343`) directly, F21 pins it, and it keeps
  the rule safe if the tie-break changes. Carried to Batches 3 and 8: stale data must be stamped with its
  original `observedAt`, not the time it was re-served. Otherwise rule 2 and the recency rule mean
  something different. `lastResetAt` being optional (with the conservative "keep real evidence when the
  reset is unknown" reading) is also accepted.

## Batch 3: Window/lane state engine and formatting — COMPLETE (commit 698f8497c; Phase 1 fix d6c20cc20; review phase-1-code-review.md APPROVED 8/10)

- Recommended executor: backend-developer
- Fallback executor: backend-developer (fresh instance)
- Execution mode: sequential
- Rationale: the design §2 state machine; one lib; drives both UI and tool text
- Tasks: 2 | Depends on: Batch 2
- Phase: 1 | Phase review: **due after this batch** — code-logic + style, CLI lane

### Task 3.1: `window-state.ts` and `lane-state.ts` — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\window-state.ts` (CREATE, + spec), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\lane-state.ts` (CREATE, + spec), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\index.ts`
- Plan reference: Decision 1 `:255-268`, Decision 3 relation rule `:304-307`, Component 2 `:537`; design-spec.md §2
- Quality requirements: first-match state order exactly as Decision 1; `applicableWindows` scope rule (Req 4.5)
- Validation notes: R7 — `ownerRelation` returns `unknown` whenever either kind is `unknown`, even with equal keys; fixtures F2, F3, F4, F11, F22, F25 and an `ownerRelation` truth table
- Implementation details: `classifyWindow`, `classifyOwnerEvidence`, `classifyLaneState`, `groupAlternatives`, `ownerRelation`, `applicableWindows`

### Task 3.2: `plan-limit-format.ts` — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\plan-limit-format.ts` (CREATE, + spec)
- Plan reference: Component 2 `:538-542`; design-spec.md §0.4 and §1 (T1, T2)
- Quality requirements: time zone is a parameter; deterministic specs (fixed tz, injected now)
- Implementation details: local absolute ("today 15:10 CEST"), relative ("in 3h 10m"/"22m ago"), tool UTC (`YYYY-MM-DD HH:MM UTC (in …)`), short source labels, tool source text

### Batch 3 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared`
- Phase 1 review requested on the combined diff of Batches 1-3

Result (team-leader, Mode 2): `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared
--skip-nx-cache` passed (3/3 targets). The committed diff has exactly 8 files: the 6 new
`plan-limits/` files (3 modules, each with its spec), `plan-limits/index.ts` and `utils/index.ts`. No
TODO, stub or `Date.now` appears in `plan-limits/`, and no "Never touch" file is in the diff. The chat-ui
Context rename and `.ptah/specs` are still unstaged. Batch 3 report: `batch-3-report.md`.

Executor deviations, judged against the plan:
- `utils/index.ts` edited — ACCEPTED. Plan Component 2 (`implementation-plan.md:561`) lists it as MODIFY.
  The batch's file list left it out. The edit only adds named re-exports.
- `status` lives on `ApplicableLimits`, not in the lane context — ACCEPTED. `classifyWindow` keeps
  Decision 1's `ctx` exactly. Status stays tied to the owner snapshot it belongs to.
  `ProviderAccountUsageStatus` has no lookup-failure member, so `lookupFailure` comes in from the
  context instead.
- Extra exported helpers — ACCEPTED. Each one encodes one design rule, so Batches 14 and 18-21 call it
  instead of re-deriving the rule.

Open decisions, judged:
- An active estimated limit hit makes the lane `unknown` (reason `estimated-limit`), not
  `confirmed-room` — ACCEPTED. Req 5 (`task-description.md:371-383`) requires "no active exhaustion" for
  confirmed room, without restricting it to non-estimated sources, and lists "estimated-only evidence"
  as unknown. Estimated evidence never makes a lane `at-limit` (`isActiveLimitEvidence`). Non-blocking:
  the engine is pure and gates nothing; `unknown` raises no warning; spawns are never blocked (D2).
- A lane with an unknown model scope sees only all-model windows — ACCEPTED for this engine. Req 4.5
  (`task-description.md:356-358`) shows a scoped window exhausted only for lanes using that scope. This
  also matches the prototype `laneState`. Non-blocking: the rule removes windows; it never adds a block.
  Residual risk: such a lane can reach `confirmed-room` while a scoped window it might actually use is
  exhausted. This is a Phase 1 review focus item.

Carry-forward:
- Batch 13 (lane lookup/discovery) and Batch 18 (lane tiles): pass the lane's resolved model scope
  whenever it is known. Pass `null` only when the scope truly cannot be resolved. If the Phase 1
  review asks for it, unknown scope + scoped windows present should give `unknown`, not room.
- Batch 14 (tool text): the `estimated-limit` reason must render as an informational note labelled as
  an estimate. It must never be a WARNING (Req 5.5, `implementation-plan.md:1076`). Only `at-limit` and
  `near-limit` warn.
- Batches 13 and 14: a lookup timeout or failure passes `ctx.lookupFailure` and `limits: undefined`.
  Never pass another owner's snapshot (R7).
- Batch 8 (ledger): exhaustion with an unknown reset stays active in the engine. Clearing it is the
  ledger's job (Decision 4). Stale data keeps its original `observedAt` / `usedObservedAt`.
- Batches 18-21: pass the time zone and `zoneNameLocale` explicitly (`LocalTimeOptions`). The zone
  abbreviation follows the locale ("CEST" under en-GB, "GMT+2" under en-US).

Phase 1 review: **APPROVED 8/10** (`phase-1-code-review.md`, codex lane). The first verdict on
`5bb19f9fb..698f8497c` was REVISE 6/10 with one Serious finding: a lane of unknown model scope could
reach `confirmed-room` while a model-scoped window was exhausted. Fix round 1 (`phase-1-fix-report.md`)
adds `ApplicableLimits.modelScopeUnresolved` and a new unknown reason, `model-scope-unknown`. Fix commit
**d6c20cc20**, which touches only `lane-state.ts` and `lane-state.spec.ts`. Before that commit,
`npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared --skip-nx-cache` passed all 3 targets.
The re-review, scoped to the fix, found nothing further. Phase 1 is closed.

Carry-forward from the Phase 1 fix:
- Batches 14, 18, 19, 20 and 21 (tool text and UI): `LaneStateReason` has a new member,
  `{ kind: 'model-scope-unknown' }`. Each of these batches must give it wording, for example "model not
  known yet; model-specific limits not checked". It is informational and never a WARNING. Any exhaustive
  switch over the reasons must handle it.
- Batches 13 and 18: passing a resolved model scope now matters more. With `null`, any owner that has a
  model-scoped window or evidence makes the lane `unknown`.

---

## Phase 2 — Claude SDK capture (Batches 4-5)

Phase review: code-logic plus style (new tokens and exports), one CLI-lane review.

## Batch 4: Rate-limit mapper, signal registry and stream branch — COMPLETE (commit a18be04bd)

- Recommended executor: backend-developer
- Fallback executor: backend-developer (fresh instance)
- Execution mode: sequential
- Rationale: coupled edits in the stream loop plus DI wiring in one lib. G1 approved, so unblocked
- Tasks: 3 | Depends on: Batch 3
- Phase: 2 | Phase review: deferred to Batch 5

### Task 4.1: `claude-rate-limit.mapper.ts` and signal registry — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\lib\helpers\plan-limits\claude-rate-limit.mapper.ts` (CREATE, + spec), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\lib\helpers\plan-limits\session-plan-limit-callback-registry.ts` (CREATE, + spec)
- Plan reference: Component 4 `:587-592`; Req 2.1 amendment `:133-155` (approved, G1)
- Pattern to follow: `session-mcp-status-callback-registry.ts:77`, `callback-registry.base.ts:12-52`
- Quality requirements: **`utilization` is never ingested** (F13a); `retry_delay_ms` is cooldown, never a reset
- Validation notes: fixtures F13, F13a, F14, F15, F16. Signal union includes `turn-start` (for G2/AS1), `evidence`, `success`
- Implementation details: map `rateLimitType` to window keys per `:589`; `status==='rejected'` → exhaustion; `isUsingOverage`/`overageInUse` passed through for billing

### Task 4.2: `StreamTransformer` branch and per-turn S1 state — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts` (+ spec)
- Depends on: Task 4.1
- Plan reference: Component 4 `:593, 603-606`; Decision 4 S1 row `:355`
- Pattern to follow: existing root-stream discriminator `stream-transformer.ts:418-429`; MCP status notify `:503`; result branch `:513`
- Quality requirements: one early branch for `isRateLimitEvent`, `isAPIRetryMessage` (rate_limit/429) and assistant `error==='rate_limit'`; all other forwarding unchanged; mapper errors caught, debug log, no payload
- Validation notes: S1 scope = main-loop `message_start` models of this turn only (exclude `parent_tool_use_id`), never `result.modelUsage`; overage state reset per turn; emit `turn-start` at the first SDK message after the previous `result` (AS1). Fixtures: rate_limit_event → one registry notification and no forwarded flat event; F62 (signal side), F75, F76
- Implementation details: use guards from `claude-sdk.types.ts:400, 410, 344`

### Task 4.3: DI tokens, registration, exports — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\lib\di\tokens.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\lib\di\register.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\index.ts`
- Plan reference: Component 4 files `:642-644`
- Quality requirements: `SDK_SESSION_PLAN_LIMIT_REGISTRY: Symbol.for('SdkSessionPlanLimitRegistry')`; minimal barrel additions (R2)

### Batch 4 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk`
- `grep -n utilization` in the mapper shows no assignment to a used value

### Batch 4 verification result

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk --skip-nx-cache`: all 3 targets passed (clean run)
- G1: `utilization` appears in `claude-rate-limit.mapper.ts` only in doc comments (:12, :128); the mapper destructures `status` and `rateLimitType` and reads `resetsAt`, `isUsingOverage` and `overageInUse`. The specs assert there is no `utilization` or `used` property on the evidence (F13a)
- Diff: only the 5 modified agent-sdk files plus `helpers/plan-limits/` (4 files) and `stream-transformer.plan-limits.spec.ts`. No never-touch file changed; the chat-ui Context rename files and `.ptah/specs` were left unstaged
- (a) Narrowed AS1 trigger, ACCEPTED: `opensClaudeTurn` skips `result`, `prompt_suggestion`, `system/task_notification` and any `session_state_changed` whose state is not `running`. These are the post-`result` trailers documented in `sdk.d.ts`. Firing on them would refresh the G2 account read before the user's next prompt and could miss an account switch. Per-turn state still resets at `result`, so only the signal's timing changes, and it fires once per turn. A `rate_limit_event` that arrives between turns counts as turn-opening and goes to the next turn, which is correct
- (b) R2, ACCEPTED: the barrel grew by 10 lines to 387. It exports the registry class and the types the ledger consumes; the mapper functions are deferred to 5.3
- (c) ACCEPTED: `billingFromRateLimitInfo` returns `unknown` for `rejected` without an overage flag. Under "latest event wins", that turn's success clears nothing, consistent with Decision 4 S1 (only `plan` clears)
- Deviations recorded: `ClaudeTurnBilling` has no `fallback` (fallback billing belongs to the ledger); the registry is the last `StreamTransformer` constructor parameter

### Carry-forward to Batch 5

- Task 5.1: subscribe to `SDK_TOKENS.SDK_SESSION_PLAN_LIMIT_REGISTRY` and drop the per-session `readAccount` cache on `signal.kind === 'turn-start'`. The trigger skips post-result trailers, so the drop happens at the next turn's first real message. Signals carry the tabId until the real session id resolves (`SessionPlanLimitEvent.sessionId` doc), so key the cache the same way as the registry, or re-key on `SessionIdResolvedCallbackRegistry`
- Task 5.3: also export the mapper functions auth-providers / cli-agent-runtime need (`mapClaudePlanLimitMessage`, `claudeModelFamily`, `billingFromRateLimitInfo` as needed) from `./lib/helpers/plan-limits/claude-rate-limit.mapper`. Keep the barrel minimal (R2). Do not route through `helpers/index.ts` (never-touch)

## Batch 5: Session quota probe and restore validation — COMPLETE (commit 3d8b0d5d3; Phase 2 fix badcec203; review phase-2-code-review.md APPROVED 9/10)

- Recommended executor: backend-developer
- Fallback executor: backend-developer (fresh instance)
- Execution mode: sequential
- Rationale: probe and the G3 restore seam are both agent-sdk; shares DI files with Batch 4
- Tasks: 3 | Depends on: Batch 4
- Phase: 2 | Phase review: **due after this batch** — code-logic + style, CLI lane

### Task 5.1: `SessionQuotaProbeService` with per-turn account re-read (G2) — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\lib\helpers\plan-limits\session-quota-probe.service.ts` (CREATE, + spec)
- Plan reference: Component 4 `:594-602`; **G2 `:12-18` overrides** Decision 10 `:446-452` and `:623`
- Pattern to follow: `SessionRegistry.find` usage at `session-control.service.ts:422, 467`
- Quality requirements: 3 s timeout on every call, `null` on timeout/rejection/missing query; `accountInfo` never logged except presence flags; `usage_EXPERIMENTAL` only on demand
- Validation notes: D4 — do **not** subscribe to `authFileChanged`/`configChanged` for Claude. AS1 — `readAccount(sessionId)` caches per (session, Query instance, turn generation); the cache is dropped on `turn-start`, on query replacement (`setSessionQuery`, `session-registry.service.ts:395`) and on assistant `authentication_failed`/`oauth_org_not_allowed`/`account_on_hold`. Report the turn trigger chosen. F77 rewritten: two consecutive turns with different `accountInfo()` results yield two different reads; query replacement and auth error also drop the cache. Plus null query, timeout, API key (`rate_limits_available=false`)
- Implementation details: `readAccount`, `readPlanUsage(sessionId?)`, `sessionRoute(sessionId)` → `{providerId, routeKind}` from `capacityRoute` (read-only; do not edit `session-query-executor.service.ts`)

### Task 5.2: Validate `quotaOwner` on restore (G3) — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\lib\helpers\plan-limits\quota-owner-ref.schema.ts` (CREATE, + spec), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\lib\session-metadata-store.ts` (+ spec)
- Plan reference: G3 `:19-25`; D5
- Pattern to follow: zod usage in `libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract.schema.ts`; seam `session-metadata-store.ts:869-874`
- Quality requirements: a malformed or legacy `quotaOwner` (wrong type, unknown `identityKind`, extra secret-looking fields, or a stray `quotaOwnerKey` string) is dropped to `undefined` so it renders "Unknown owner"; never replaced by the current owner; never throws
- Validation notes: `getCliSessionsForRestore` is the only restore seam for both RPC paths (D5)
- Implementation details: strict object schema `{providerId, identityKind, key, label}`; key format `<providerId>#<kind>:<hex>`

### Task 5.3: DI and exports for the probe — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\lib\di\tokens.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\lib\di\register.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\index.ts`
- Quality requirements: `SDK_SESSION_QUOTA_PROBE: Symbol.for('SdkSessionQuotaProbe')`; export the probe interface, mapper and schema needed by auth-providers / cli-agent-runtime only (R2)

### Batch 5 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk`
- Phase 2 review requested on the combined diff of Batches 4-5

### Batch 5 result

Verified on disk against `batch-5-report.md`. `npx nx run-many -t typecheck,test,lint -p
@ptah-extension/agent-sdk --skip-nx-cache`: 3/3 succeeded. The diff is the 9 reported files only.
No never-touch file changed (`session-query-executor.service.ts`, `sdk-adapter-events.service.ts`,
`helpers/index.ts`, `stream-transformer.ts`, compaction). No TODO/stub markers. The chat-ui Context
rename files and `.ptah/specs` were left unstaged.

Executor decisions, all accepted:

- (a) The cache is a `WeakMap` keyed by the `Query` object, and lookup goes through
  `SessionLifecycleManager.find`. That resolves the tabId and the real id to the same record, so no
  re-keying on `SessionIdResolvedCallbackRegistry` is needed. A replaced query is a new key, which
  meets AS1's "per Query instance". F77 covers the tabId-then-real-id path.
- (b) Auth errors drop the cache through the existing `SdkAdapterEvents.onTurnFailed` (the
  `StopFailure` hook, with the same `SDKAssistantMessageError` type). The adapter-events file is only
  subscribed to, and `stream-transformer.ts` is untouched. This is not a D4-forbidden event.
- (c) Failed reads are not cached: the `.then` deletes the entry only while it is still the same
  promise. Concurrent reads share one promise. A read dropped mid-flight is not re-inserted, because
  the entry is set synchronously before the promise resolves.
- (d) `readPlanUsage` returns `null` on proxy and unknown routes. A `direct-key` route passes
  `rate_limits_available=false` through. Nothing per turn calls it.
- (e) R2: the barrel is 397 lines (+10). All additions are direct named exports from
  `plan-limits/*`.

Review focus for Phase 2:

- the eager fire-and-forget read on `turn-start` (one control request per native turn, R6)
- the timeout race leaving no unhandled rejection
- `restoreQuotaOwner` stripping a stray `quotaOwnerKey` and never substituting the current owner
- `session-metadata-store.ts` was already over `max-lines` (warning only, out of scope)

Carry-forward to Batch 6 (Task 6.1, owner resolver):

- The resolver's key must be exactly `<providerId>#<identityKind>:` followed by **16 lowercase hex
  characters** (the first 16 of a SHA-256, Decision 3). Anything else restores as "Unknown owner"
  through `parseQuotaOwnerRef`.
- The resolver spec must assert that every `QuotaOwnerRef` it produces passes `parseQuotaOwnerRef`
  (exported from `@ptah-extension/agent-sdk`). Cover all four `identityKind` values.
- `providerId` must match `/^[a-z0-9][a-z0-9._-]{0,63}$/`, so normalise ids when building keys.
- `label` must be 1-64 characters after trimming and contain no `@`.

### Phase 2 review record

Phase 2 review: **APPROVED 9/10** (`phase-2-code-review.md`, opencode lane, combined diff of
Batches 4-5, `698f8497c..3d8b0d5d3` plus the fix). The first verdict was APPROVED 8/10 with
1 Moderate and 3 Minor findings.

- Moderate (finding 1), fixed in fix round 1 (`phase-2-fix-report.md`), commit **badcec203**:
  `restoreQuotaOwner` threw a TypeError on a non-object `cliSessions` entry, because it ran `in`
  checks on `null` or a primitive. A guard now returns such an entry unchanged, so array length
  and order are kept. `it.each` covers `null`, a string and a number between two valid runs.
  Re-verified by the team-leader: `npx nx run-many -t typecheck,test,lint -p
  @ptah-extension/agent-sdk --skip-nx-cache` passed 3/3. Only the 2 fix files were committed.
- Re-review of the fix: APPROVED 9/10, with one new Minor (item 4 below).

Named follow-up, **TASK-596-FU-PHASE2** (not fixed now; Minor only, under the risk-based rule).
Pick it up after Phase 7, or fold it into a later agent-sdk batch if that batch touches these files:

1. `void readAccount` on `turn-start` is fire-and-forget. If `logger.debug` throws inside the
   chain, the promise could reject unhandled (`session-quota-probe.service.ts:221`).
2. `ACCOUNT_INVALIDATING_ERRORS` leaves out `cloud_credential_error`, so that error does not drop
   the account cache (`session-quota-probe.service.ts:108-113`).
3. The registry doc comment says to re-key on `SessionIdResolvedCallbackRegistry`. `find()`
   already resolves both the tabId and the real id, so the comment is stale
   (`session-plan-limit-signal.registry.ts:61-64`).
4. Pre-existing, outside the restore seam: `countReferencesWithBulk` and the `cliSessions` loops
   in `session-metadata-store.ts:303-307`, `:1046` and `:1234` throw on a persisted `null` entry.
   Validate entries once at the storage read boundary rather than adding a guard to each loop.

---

## Phase 3 — Owner identity, ledger and readers (auth-providers, Batches 6-10)

Phase review: code-logic plus style (new public API) with security focus (R4), one CLI-lane review.

## Batch 6: Owner resolver and Codex reader hardening — COMPLETE (commit 89eddce53)

- Recommended executor: backend-developer
- Fallback executor: backend-developer (fresh instance)
- Execution mode: sequential
- Rationale: resolver pure functions and Codex `currentOwnerKey` depend on each other (D7); includes an offline local command
- Tasks: 3 | Depends on: Batch 5
- Phase: 3 | Phase review: deferred to Batch 10

Executor must read the "Carry-forward to Batch 6" list at the end of Batch 5. In short: the key
is `<providerId>#<identityKind>:` plus exactly **16 lowercase hex** characters, and the resolver
spec asserts that every produced `QuotaOwnerRef` passes `parseQuotaOwnerRef` for all four
`identityKind` values.

**R3:** Task 6.2 is the Codex protocol re-pin. If the regenerated types are incompatible (not
unchanged and not additive), the executor must STOP and report without bumping
`CODEX_ACCOUNT_PROTOCOL_VERSION` or editing the Codex files. Tasks 6.1 and 6.3 may still land.

### Task 6.1: `provider-owner.resolver.ts` — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\provider-owner.resolver.ts` (CREATE, + spec)
- Plan reference: Decision 3 `:280-336`; D6, D8
- Quality requirements: the **only** fingerprint/credential-parsing implementation; never logs material
- Validation notes: F78 (header cases incl. `Bearer Bearer K` → `Bearer K`), F67b resolver side (stored `K` equals `Bearer K` and mixed-case `X-Api-Key: K`). `ownerForSession(sessionId)` maps `probe.sessionRoute` → owner (native → `ownerForClaudeAccount(probe.readAccount)`, proxy → `ownerForProviderKey(route.providerId)`, direct-key → credential, else unknown). Every method returns a full `QuotaOwnerRef` with a generic label ("Claude account", "Codex account", …) per G3
- Implementation details: module-level `ownerFingerprint`, `credentialFromHeaders`, `credentialOwnerKey`, `accountOwnerKey`, `cliStoreOwnerKey`, `unknownOwnerKey`; DI class `ProviderOwnerResolver`

### Task 6.2: Codex protocol re-pin and owner key — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\providers\codex\codex-account-usage.service.ts` (+ spec), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\providers\codex\codex-provider.types.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\providers\codex\codex-account.schemas.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\providers\codex\protocol\codex-account.generated.ts` (regenerate)
- Depends on: Task 6.1
- Plan reference: Decision 9 `:433-440`, Component 7 `:760-778`
- Quality requirements: RUN FIRST (offline): `node node_modules/@openai/codex/bin/codex.js --version` and `… app-server generate-ts`; diff the selected types. Bump `CODEX_ACCOUNT_PROTOCOL_VERSION` only if unchanged/additive (AS3, AS4). **If incompatible: stop and report (R3).** No account call
- Validation notes: `currentOwnerKey()` null before first read and after `clearCache` (`:89-91`); `rateLimitReachedType` passed through; spec version mock updated from `'0.147.0'` (spec `:67`); new cases A→B, sign-out, same-account transient → stale (F30 partial)

### Task 6.3: Auth-providers tokens — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers-tokens\src\lib\tokens.ts`
- Plan reference: `:702`; D9
- Implementation details: add `PROVIDER_OWNER_RESOLVER`, `PLAN_LIMIT_LEDGER`, `PLAN_USAGE_SERVICE`, `PLAN_CREDENTIAL_SOURCE`, all `Symbol.for(...)`; registrations land in Batches 8-9

### Batch 6 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/auth-providers @ptah-extension/auth-providers-tokens`
- Executor report includes the `--version` output and the selected-type diff verdict

### Batch 6 verification result (team-leader)

- typecheck and lint passed for both projects (`--skip-nx-cache`). `test`: 53/54 suites passed, 1364/1368 tests passed.
  The 4 failures are all in `translation-proxy.sdk.integration.spec.ts`, from `EPERM` in that
  spec's own `rmSync` teardown of `%TEMP%\ptah-sdk-int-*\scenario-*`.
- **Known environment item (pre-existing, not caused by Batch 6):** run alone in this worktree, the
  spec gives 4 failed and 5 passed, all EPERM. Run alone in the main checkout (`main` @ 77f99a687,
  which has no Batch 6 code), the same spec gives 5 failed and 4 passed, with the same EPERM
  teardown errors. This is a Windows temp-dir file-handle problem in the test harness. Later
  batches that run `auth-providers:test` should treat exactly this spec failing EPERM as known,
  and any other failure as real.
- R3 confirmed: `codex.js --version` prints `codex-cli 0.155.1`. The `codex-account.generated.ts`
  diff only adds fields or narrows types (`edu_plus`/`edu_pro`, `RateLimitReachedType` union,
  `normalModelSlug`, `ordinaryUsageAllowed`, `accountId`, `rateLimitUpsell`, `threadUsage?`).
- Resolver spec `owner keys` (`provider-owner.resolver.spec.ts:104-118`) runs `parseQuotaOwnerRef`
  on all four identity kinds through `expectRestorable`.
- Deviations accepted:
  - (1) The owner key stays off `CodexAccountUsageResult`, because that result goes over RPC.
  - (2) The new narrow `ICodexOwnerKeySource` avoids breaking the rpc-handlers mocks.
  - (3) `ownerForClaudeAccount(account, routeMaterial)` gets a second argument so the unknown owner
    has route material, per Decision 3.
  - (4) A Codex proxy route goes to `ownerForCodexHome()`, matching Decision 3's identity table.
  - (5) A `clearCache` generation guard drops in-flight reads, closing the A→B window.
  - (6) Placeholder keys map to an unknown owner.
  - (7) A local `'ptahCli'` literal mirrors `PTAH_CLI_KEY_PREFIX`.
- `ProviderOwnerResolver` is not yet DI-registered under `PROVIDER_OWNER_RESOLVER`; that lands in
  Batches 8-9.

## Batch 7: Proxy owner key and quota store observers — COMPLETE (commit 7943af1e4)

Carry-forward from Batch 6:

- Task 7.2: `CodexTranslationProxy` reads the owner key through `ICodexOwnerKeySource`
  (`codex-provider.types.ts`), injected via `AUTH_PROVIDERS_TOKENS.SDK_CODEX_ACCOUNT_USAGE`.
  Do NOT add `currentOwnerKey` to `ICodexAccountUsageService`. A null `currentOwnerKey()` means a
  null owner key (F68). If a non-null fallback is needed, use the resolver's `ownerForCodexHome()`
  semantics (`unknownOwnerKey('openai-codex', codexHome.path)`), and do not hash anything locally.
- Task 7.1: the default `resolveQuotaOwnerKey(headers)` must use the module-level
  `credentialFromHeaders` / `credentialOwnerKey` from `quota/provider-owner.resolver.ts`. No second
  parsing or hashing site. Placeholder tokens already resolve to unknown there.
- `auth-providers:test` has the known EPERM failure in `translation-proxy.sdk.integration.spec.ts`
  (see the Batch 6 result). Because Task 7.1 edits `translation-proxy-base.ts`, the executor must
  show that the spec's non-EPERM scenarios (the 5 that pass in this worktree) still pass.

- Recommended executor: backend-developer
- Fallback executor: backend-developer (fresh instance)
- Execution mode: sequential
- Rationale: one request path across three coupled files
- Tasks: 2 | Depends on: Batch 6
- Phase: 3 | Phase review: deferred to Batch 10

### Batch 7 verification record (attempt 1) — NOT ACCEPTED

- Scoped run (`typecheck,test,lint -p @ptah-extension/auth-providers --skip-nx-cache`): typecheck
  and lint pass. test: 1 suite failed, 53 passed; 5 failed, 1389 passed out of 1394. All 5 are
  teardown `removeTree` errors in `translation-proxy.sdk.integration.spec.ts:177` (4 × EPERM for
  S1-S4, plus 1 × ENOTEMPTY for S6b). This is the known Windows temp-handle family, not assertion
  failures. The re-run must show this family only.
- R5: `translation-proxy-base.ts` hunks are at original 70, 262+, 273-281, 991+, 1124 and 1179.
  The 966-976 region is untouched. The store diff leaves the gate, the clamp, `cooldownFor` and
  `parseRetryAfterMs` unchanged.
- Deviation 1 (`di/register.spec.ts`, +6 test-only stub lines) is ACCEPTED inside Batch 7: the
  batch's own DI change requires it.
- Deviation 2 is REJECTED. `ProviderProxyPool` (`auth/provider-proxy-pool.ts:270`) is the
  production path for per-workspace Codex overrides, and it builds
  `new CodexTranslationProxy(this.logger, this.codexAuth)` with no owner source. Every 429 from a
  pool-built Codex proxy would be unattributed. The pool is `@injectable` in auth-providers and
  can inject `AUTH_PROVIDERS_TOKENS.SDK_CODEX_ACCOUNT_USAGE` itself. Batch 13 (cli-agent-runtime)
  does not own this file.
  Required fix:
  - (a) add a constructor param to `ProviderProxyPool` (`provider-proxy-pool.ts:124-136`):
    `@inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_ACCOUNT_USAGE) private readonly codexOwnerKeys: ICodexOwnerKeySource`;
  - (b) pass it as the third argument at `:270`;
  - (c) update `provider-proxy-pool.spec.ts:277` to pass a stub, and add one case where a
    pool-built Codex proxy reports the stub's `currentOwnerKey()`.

### Batch 7 verification record (attempt 2, rework) — ACCEPTED

- Pool diff verified on disk: `provider-proxy-pool.ts` adds a type-only import of
  `ICodexOwnerKeySource` from `codex-provider.types.ts`, a 7th constructor param
  `@inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_ACCOUNT_USAGE) codexOwnerKeys`, and passes it as the
  third `CodexTranslationProxy` argument (`:273-277`). DI: the token is registered in
  `register-providers.ts:94`, before the pool. No other production constructor call site.
- New spec case `ProviderProxyPool Codex quota owner (TASK_2026_596 Task 7.2)`: a real
  pool-built `CodexTranslationProxy` hits a local 429 upstream, and
  `providerQuotaStore.onRateLimit` fires once with `{providerId:'openai-codex', ownerKey: CODEX_ACCOUNT_OWNER}`.
  This closes Deviation 2.
- Scoped run (`typecheck,test,lint -p @ptah-extension/auth-providers --skip-nx-cache`): typecheck
  and lint pass. test: 53/54 suites; 1389 passed, 6 failed (1395). All 6 failures are in
  `translation-proxy.sdk.integration.spec.ts` teardown, EPERM under `%TEMP%\ptah-sdk-int-*`
  (S1, S2, S3, S4, S6a, S6b). There are no assertion failures. The executor's own run got 5,
  with S6b ENOTEMPTY. Which scenarios fail varies between runs, but the error family is the same.
- **Known environment item, updated:** treat EPERM or ENOTEMPTY `removeTree` teardown errors in
  this spec as known, whichever S-scenarios they land on (S6a/S6b included). S6b ENOTEMPTY is part
  of that family. Any assertion failure, or a failure in any other spec, counts as real.

### Task 7.1: `ProviderQuotaStore` observers and proxy-base hook — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\auth\provider-quota.store.ts` (+ spec), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\translation\translation-proxy-base.ts` (+ spec)
- Plan reference: Component 9 `:826-863`
- Pattern to follow: `noteUpstreamQuota` `translation-proxy-base.ts:271-290`; call sites `:1124, :1179`; `getHeaders()` `:979`
- Quality requirements: minimal edit (597 Task 12.3 edits `:966-976` — do not touch that region, R5); gate semantics, clamp and `cooldownFor` unchanged; ledger success only when `200 <= status < 300`; hook/listener failure never affects the response
- Validation notes: F67, F67b (proxy side), F80 (2xx, 3xx, null owner); existing proxy/store specs stay green
- Implementation details: protected `resolveQuotaOwnerKey(headers)` defaulting to `credentialOwnerKey(getProviderId(), credentialFromHeaders(headers))`; `onRateLimit`/`onSuccess` returning unsubscribe; ctx `{ownerKey, model, statusCode}`

### Task 7.2: `CodexTranslationProxy` owner hook — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\providers\codex\codex-translation-proxy.ts` (+ spec)
- Depends on: Task 7.1
- Plan reference: Component 9 `:847-854`
- Validation notes: inject `AUTH_PROVIDERS_TOKENS.SDK_CODEX_ACCOUNT_USAGE`; null `currentOwnerKey()` → null (F68)
- Rework (attempt 2): the owner source must also reach pool-built proxies. Add
  `provider-proxy-pool.ts` and its spec to this task. See the verification record above.

### Batch 7 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/auth-providers`

## Batch 8: Plan-limit ledger, credential source and quota barrel — COMPLETE (commit baa044f18)

Carry-forward from Batch 7:

- F80 is ledger-side. Batch 7 emits `onSuccess` only for `200 <= status < 300`, but a success
  carries no billing context. A credit or fallback success (anything other than `billing:'plan'`)
  must NEVER clear an exhaustion. Task 8.1's `recordSuccess` enforces this per `:376-381`, and the
  spec must cover credit and fallback successes that leave the exhaustion active.
- Proxy events with `ownerKey: null` (unattributed, F68 included) must not be dropped or merged
  across proxies. The ledger files each one under `unknownOwnerKey(providerId, proxy instance id)`.
  The ledger must get a stable per-proxy instance id from the observer ctx/source. If Batch 7's ctx
  does not expose one, extend it inside Batch 8's files, or report that it needs to be added. Do
  not hash credentials locally.
- Observer API from Batch 7: `providerQuotaStore.onRateLimit(fn)` / `onSuccess(fn)`, each
  returning an unsubscribe function. ctx is `{ownerKey, model, statusCode}`. The ledger's
  `dispose()` must call all of these unsubscribes synchronously and idempotently.
- Pool-built Codex proxies now report the account owner (`provider-proxy-pool.ts:273-277`), so
  per-workspace overrides attribute the same way as the default proxy.
- Known environment item: EPERM/ENOTEMPTY teardown errors in
  `translation-proxy.sdk.integration.spec.ts` (any S-scenario, including S6a/S6b) are known.
  Anything else counts as real.

- Recommended executor: backend-developer
- Fallback executor: backend-developer (fresh instance)
- Execution mode: sequential
- Rationale: the core state machine plus its DI and barrel; highest logic risk of the run
- Tasks: 4 | Depends on: Batch 7
- Phase: 3 | Phase review: deferred to Batch 10

### Task 8.1: `PlanLimitLedgerService` — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\plan-limit-ledger.service.ts` (CREATE, + spec)
- Plan reference: Component 5 `:646-695`; Decision 4 `:338-387`; Decision 10 `:442-466` (as amended by G2/G3)
- Pattern to follow: subscription in `codex-account-usage.service.ts:89`; `IStateStorage` under `PLATFORM_TOKENS.STATE_STORAGE`
- Quality requirements: no timers; sync idempotent `dispose()` removing all three subscriptions; listener isolation; debug-only logs; persisted key `ptah.planLimits.exhaustion.v1`
- Validation notes: G2 wiring — on a registry `turn-start` signal, call `probe.readAccount(sessionId)` → `resolver.ownerForClaudeAccount` → `setSessionOwner`; earlier runs keep their owners. Unattributed proxy events go under `unknownOwnerKey(providerId, proxy instance id)`. Fixtures F17-F20, F21 (ledger), F23, F24 (P6), F62-F66 ledger side, F74 (100 active owners survive), F79
- Implementation details: writes/reads per Component 5; `recordSuccess` clears only on `billing:'plan'` per the rules at `:376-381`

### Task 8.2: Reader types — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\readers\plan-usage-reader.types.ts` (CREATE)
- Plan reference: Component 6 `:710-726`
- Implementation details: `PlanOwnerTarget {providerId, ownerRef, credentialRef?, sessionHandle?}`, `PlanCredentialRef`, `PlanUsageReader`

### Task 8.3: `PlanCredentialSource` — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\plan-credential.source.ts` (CREATE, + spec)
- Plan reference: Component 6 `:713-720`
- Validation notes: AS7 check first (`api-key.strategy.ts:356`, `local-native.strategy.ts`). Secret returned in memory only; never cached, logged or serialized; F71 (credential part)

### Task 8.4: DI registration and barrels — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\index.ts` (CREATE), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\di\register.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\index.ts`
- Validation notes: R1 — root barrel must stay ≤150 lines with explicit named exports; register resolver, ledger, credential source in `registerAuthProvidersServices`

### Batch 8 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/auth-providers`
- `libs/backend/auth-providers/src/index.ts` ≤150 lines

Verification record (team-leader, commit baa044f18):

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/auth-providers --skip-nx-cache`:
  typecheck and lint pass. Tests: 1439 passed and 6 failed of 1445. Every failure is pre-existing
  or environmental:
  - Four EPERM `removeTree` teardown errors (S1-S4) in `translation-proxy.sdk.integration.spec.ts`.
    These are the known item.
  - One failure in the same spec, "the timeout kill ends the whole child tree", was a
    `Get-CimInstance` PowerShell failure under load. The command succeeds when run alone, and
    Batch 8 touches no process-tree code.
  - One failure in `translation-proxy-base.spec.ts:2258`, "does not fire the header deadline once
    output has started", is a timing test (50 ms deadline, 10 ms pings) that predates this task
    (f4a1222fb). It fails the same way with Batch 8's proxy-base files reverted to HEAD, and on
    the main checkout. It is not caused by Batch 8. From Batch 9 on, it is a **known environment
    item**, like the EPERM teardowns.
- Root barrel: 149 lines.
- Departures, all accepted:
  - optional `sourceId`, as four additive hunks in `translation-proxy-base.ts`. The gate, the clamp,
    `cooldownFor` and `:966-976` are untouched;
  - resolver exports `isPlaceholderCredential` and `ptahCliKeySlot` (reused, not copied);
  - the ledger split into service, rules and persistence files (`max-lines`);
  - `ownerForSession` at turn-start;
  - owner evidence kept one entry per model scope;
  - `recordSuccess` takes `modelScopes[]`;
  - storage failures logged at debug level.
- F71: `PlanCredentialSource` holds no secret field. It reads the store on every call and logs
  only `{refKind, id}`. `PlanSecret` keeps the value in a `#private` field, and its
  JSON/string/inspect forms are `[redacted]`. The ledger and its persistence never see credentials.
- **Binding carry-forward (ledger activation) → Task 15.2.** Nothing resolves `PLAN_LIMIT_LEDGER` at
  host startup yet, so until something does, it records nothing. This is assigned to Task 15.2 (see
  that task).
  - Batches 11-13 resolve the ledger lazily as a writer. That instantiates it, but not at startup,
    so it does not discharge this item.

## Batch 9: Plan usage service with Claude and Codex readers — COMPLETE (commit 48ddcb9f9)

Carry-forward from Batch 8:

- Codex reader: pass each window's position (1 = primary, 2 = secondary) to
  `windowKindFromDuration`, so that an unknown duration is labelled by position (accepted in
  Batch 2/3). Keep `quota.primary/secondary` semantics (Req 2.10).
- Stale data: a cached or stale re-serve goes to `ledger.recordWindowEvidence(owner, window,
  {stale:true})` with the window's ORIGINAL source observation time. Never re-stamp `observedAt`
  to now. Batch 8's ledger pins this, and the service must not defeat it.
- AS5 check comes before the session-owner path, as in Task 9.1 (record the evidence in the report).
- Credentials: take secrets only through `PlanCredentialSource.resolve(ref)`. Pass `PlanSecret`
  straight through and call `reveal()` only at the request. Map an `unavailable` resolution's
  `status` directly. Never cache, log or serialize the secret (F71).
- The ledger API is `recordSuccess({ownerKey, modelScopes[], billing, observedAt})`. Owner
  evidence is one entry per model scope.
- Known environment items: EPERM/ENOTEMPTY teardowns and the `Get-CimInstance` failure in
  `translation-proxy.sdk.integration.spec.ts`, and the `translation-proxy-base.spec.ts`
  "header deadline once output has started" timing test (pre-existing on main). Anything else
  counts as real.
- Run the verification command without `-- --maxWorkers`, because the flag leaks into `tsc`.

- Recommended executor: backend-developer
- Fallback executor: backend-developer (fresh instance)
- Execution mode: sequential
- Rationale: dispatcher and its two core readers share the reader contract
- Tasks: 2 | Depends on: Batch 8
- Phase: 3 | Phase review: deferred to Batch 10

### Task 9.1: `PlanUsageService` — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\plan-usage.service.ts` (CREATE, + spec), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\di\register.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\index.ts`
- Plan reference: Component 6 `:706-752`
- Pattern to follow: single-flight `codex-account-usage.service.ts:106-111`
- Quality requirements: 30 s per-owner cache keyed by owner key; single flight; honours `AbortSignal`; one provider's failure never affects another; stale only for an unchanged owner on transient failure (Req 2.9)
- Validation notes: AS5 check before the session-owner path; opencode → `no-usage-source`; unknown providers → `provider-unsupported`; F30, F31, F32

### Task 9.2: Claude and Codex readers — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\readers\claude-plan-usage.reader.ts` (CREATE, + spec), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\readers\codex-plan-usage.reader.ts` (CREATE, + spec)
- Plan reference: Component 6 `:727-735`; `sdk.d.ts:4012-4104`
- Validation notes: F26, F27, F28, F29; Codex keeps `quota.primary/secondary` semantics (Req 2.10)

### Batch 9 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/auth-providers`

Verification record (team-leader, commit 48ddcb9f9):

- Files checked on disk. `plan-usage.service.ts` (365 lines) has a real dispatcher, cache, single flight,
  stale rule and ledger merge. The Claude reader is zod-validated and maps the full `/usage` table. The Codex
  reader keeps the primary/secondary positions. No TODO, stub or `eslint-disable` markers. `register.ts`
  adds `PLAN_USAGE_SERVICE` as a lazy `instanceCachingFactory`. The quota barrel adds 6 lines. The root
  barrel is unchanged at **149 lines**.
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/auth-providers --skip-nx-cache`: typecheck
  and lint pass. Tests: 1478 passed and 7 failed of 1485 (3 suites). Every failure is environmental:
  - Five EPERM `removeTree` teardown errors in `translation-proxy.sdk.integration.spec.ts:177` (S1-S4,
    S6b). These are the known item.
  - `translation-proxy-base.spec.ts` "does not fire the header deadline once output has started". This
    is the known timing item.
  - **New, judged environmental:** `opencode-translation-proxy.spec.ts:654` "times out native upstream
    requests without retrying" failed under full-suite load (`requests` length 0: the deadline fired
    before the mocked upstream saw the request). Run alone in this worktree with Batch 9 present, the
    spec passed 28/28 three times in a row. Batch 9 touches no proxy code, and no opencode file imports
    `quota/` or `di/register`. From Batch 10 on, it is a **known timing item** in the same family as the
    header-deadline test. A failure of that test when it runs alone counts as real.
- Deviations, all accepted:
  - (1) The service keeps its own 30 s per-owner cache, keyed by owner key. The Req 2.9 stale and owner
    rules need per-owner state that the Codex service's cache cannot hold. The Codex cache and single
    flight still sit underneath, so there is no extra App Server spawn.
  - (2) `no-open-session` is never stale and never cached, and a probe timeout (the probe returns
    `null`) is treated the same way. This matches Req 2.2: fall back to event data, with ledger evidence
    still attached (F27 service spec). The next read retries.
  - (3) OpenCode credential refs are never resolved. Plan `:994` puts the key there "for the owner
    only", and resolving it would wrongly turn `no-usage-source` into `unsupported-config`. F31 asserts
    `resolve` is not called.
  - (4) The `register.spec.ts` edit is the colocated spec of the assigned `register.ts` (same precedent
    as Batch 7 Deviation 1).
  - (5) Codex `stale` uses the service's `staleSince`, and windows keep Codex's original `fetchedAt`.
- `credentials.resolve` sits outside the reader `try`, but `PlanCredentialSource.resolve` is documented
  and implemented as never throwing (`plan-credential.source.ts:90-99`). That keeps the "never rejects"
  contract.
- AS5 found FALSE (see Assumptions). This becomes Task 10.3.
- Out-of-scope notes carried to the Phase 3 review:
  - the per-owner maps are not evicted (they are bounded by the configured owners);
  - Codex `rateLimitReachedType` is not yet turned into window exhaustion. The ledger evidence covers
    that.

## Batch 10: Unofficial readers (Ollama Cloud, Antigravity) and Ollama Cloud session owner — COMPLETE (50cd859af; Phase 3 fix 02bc5b502; reviews phase-3-code-review.md APPROVED 8/10, phase-3-batch-10-review.md REVISE 7/10, phase-3-fix-review.md 8/10 — fix round accepted)

- Recommended executor: codex CLI lane (user rule: codex/opencode may author; discover with
  `ptah_agent_list`). The lane gets a self-contained prompt with absolute paths and never runs git.
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential (one lane, Tasks 10.1 → 10.2 → 10.3)
- Rationale: isolated provisional adapters; mandatory (plan `:1569`). Task 10.3 closes the AS5 gap in the
  resolver that this phase owns.
- Tasks: 3 | Depends on: Batch 9 (met, 48ddcb9f9) | Concurrent-safe with: Batch 11 (file-disjoint: Batch
  10 writes only `libs\backend\auth-providers\**`, plus, if Task 10.3 needs it,
  `libs\backend\agent-sdk\src\lib\helpers\plan-limits\session-quota-probe.service.ts` and its spec. Batch
  11 writes only `libs\backend\cli-agent-runtime\**`. Neither batch writes the other's files.)
- Phase: 3 | Phase review: **due after this batch** — code-logic + style + security, CLI lane

Carry-forward from Batch 9:

- Add `ollama-cloud` and `antigravity` to the `readers` record in `plan-usage.service.ts:142-145`. Do not
  change the cache, flight or stale logic. A reader throws or returns `service-unavailable` for transient
  failures. It returns `unsupported-config`/`unsupported-auth` for eligibility.
- Reader credentials arrive as `request.credential` (a `PlanSecret`). Call `reveal()` only when building
  the request, and never log it.
- Known environment items: EPERM/ENOTEMPTY teardowns and the `Get-CimInstance` failure in
  `translation-proxy.sdk.integration.spec.ts`; the `translation-proxy-base.spec.ts` header-deadline timing
  test; the `opencode-translation-proxy.spec.ts` "times out native upstream requests" timing test under
  full-suite load. Anything else counts as real.
- Batch 10 runs at the same time as Batch 11. Whichever commits second re-runs its scoped verification
  after the first commit lands.

### Task 10.1: Ollama Cloud reader — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\readers\ollama-cloud-plan-usage.reader.ts` (CREATE, + spec)
- Plan reference: Component 8 `:784-791`
- Pattern to follow: `ollama-cloud-metadata.service.ts:61-65`
- Quality requirements: one GET, 5 s timeout, no retry, zod-validated; no key → `unsupported-config`; placeholder key → `unsupported-auth`; neither calls the network; specs mock fetch only (no live call)
- Validation notes: F33 (valid, missing reset, mismatch, timeout) with payloads labelled provisional

### Task 10.2: Antigravity reader and provisional constants; register both readers — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\readers\antigravity-plan-usage.reader.ts` (CREATE, + spec), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\readers\antigravity-ls.provisional.ts` (CREATE), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\plan-usage.service.ts`
- Plan reference: Component 8 `:792-798`
- Pattern to follow: `ProbeCommandRunner` in `process-start-time.probe.ts:75-80`
- Quality requirements: constant argument arrays; TLS bypass scoped to the single `127.0.0.1` request; CSRF token never logged; no process / mismatch → `service-unavailable`
- Implementation details: add `ollama-cloud` and `antigravity` to the reader map in `plan-usage.service.ts`

### Task 10.3: Resolve Ollama Cloud main sessions to the `ollama-cloud` owner (AS5 = false) — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\provider-owner.resolver.ts` (+ `provider-owner.resolver.spec.ts`).
  Only if the route lacks the data:
  `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\agent-sdk\src\lib\helpers\plan-limits\session-quota-probe.service.ts`
  (+ its spec). Prefer auth-providers.
- Depends on: none inside the batch. Do it after 10.2 so the lane edits one file at a time.
- Plan reference: Decision 3 `:280-336`, `implementation-plan.md:995` (discovery builds
  `ownerForProviderKey('ollama-cloud')`); AS5 evidence in the Assumptions list
- Pattern to follow: `ownerForSession` `provider-owner.resolver.ts:354-375`; `sessionRoute`
  `session-quota-probe.service.ts:193-209` (it reads `record.capacityRoute` and `record.accountingAuthEnv`)
- **Never touch**: `session-query-executor.service.ts` (597-deferred). Do not change `resolveCapacityRoute`.
  Read-only evidence only. No new route inference that could misattribute another provider.
- Requirement: in `ownerForSession`, an Ollama Cloud main session must resolve to
  `ownerForProviderKey('ollama-cloud')`, using evidence that already exists:
  - **Cloud-direct (must resolve):** the session's base URL host is `ollama.com`
    (`OLLAMA_CLOUD_DIRECT_BASE_URL`, `local-provider-entry.ts:17`). Compare against that constant or its
    host, not a hand-typed string. Only a `proxy` route with `providerId: null` is eligible.
  - **Daemon (`127.0.0.1:11434`, ambiguous):** find the real source that tells `ollama` from
    `ollama-cloud` for that session (for example the session's selected/configured provider id or auth
    method in the session record or its auth env) and **cite file:line** in the report. If the session
    cannot be told apart without guessing, it stays the unknown owner. Document that in the report and
    in a code comment at the branch. Never default it to `ollama-cloud`.
  - If `sessionRoute` must expose more data (for example the base URL host, or the record's selected
    provider id), add one optional, non-secret field to `SessionQuotaRoute`. Never expose the auth token
    or the full auth env. Keep existing `sessionRoute` callers and specs green.
- Spec cases (resolver spec, plus the probe spec if `sessionRoute` changes):
  - cloud-direct `https://ollama.com` proxy route with null provider gives the `ownerForProviderKey('ollama-cloud')` key;
  - daemon `127.0.0.1:11434` ambiguous gives `ollama-cloud` only when the cited evidence names it;
    otherwise the unknown owner, keyed by the session;
  - plain local `ollama` (daemon, no cloud evidence) **never** resolves to `ollama-cloud`;
  - an unrelated proxy with a null provider stays unknown (regression).
- Quality requirements: no credential material in the route or in logs (R4); `parseQuotaOwnerRef` passes
  on every produced ref.

### Batch 10 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/auth-providers` (add
  `@ptah-extension/agent-sdk` to `-p` if Task 10.3 edits the probe). Do not pass `-- --maxWorkers`.
- Root barrel `libs/backend/auth-providers/src/index.ts` ≤150 lines; agent-sdk barrel does not grow (R2)
- `grep -rn "rejectUnauthorized" libs/backend/auth-providers/src/lib/quota` shows only the loopback request
- Phase 3 review requested on the combined diff of Batches 6-10

Verification record, attempt 1 (team-leader, codex lane output). **NOT ACCEPTED**, batch stays IN_PROGRESS:

- The lane did not finish verification. The team-leader ran `npx nx run-many -t typecheck,test,lint -p
  @ptah-extension/auth-providers @ptah-extension/agent-sdk --skip-nx-cache`. Results: agent-sdk typecheck,
  test and lint pass, and auth-providers lint passes. **auth-providers typecheck fails.** Tests: 1461 passed
  and 5 failed of 1466. The 3 suites that failed to compile (`antigravity-plan-usage.reader.spec.ts`,
  `plan-usage.service.spec.ts`, `di/register.spec.ts`) are real. The rest are the known EPERM teardown
  item and the known header-deadline item.
- Passed: `rejectUnauthorized` appears only at `antigravity-plan-usage.reader.ts:163`, the literal
  127.0.0.1 request. The root barrel has 149 lines. Neither barrel changed. There are no TODO, stub or
  eslint-disable markers. A placeholder key gives `unsupported-auth` before any reader is called
  (`plan-credential.source.ts:114-116`). AS5 cloud-direct matches the parsed host of
  `OLLAMA_CLOUD_DIRECT_BASE_URL` on a proxy route with a null provider. The daemon stays unknown and the
  code comment says so. The new route field is a host only, with no secret.
- Defects to fix (same lane, resume):
  1. **Blocking.** `antigravity-plan-usage.reader.ts:8` imports `ProbeCommandRunner` from
     `@ptah-extension/agent-sdk`. The root barrel does not export it (TS2305). Declare a local
     `(command, args: readonly string[]) => Promise<string>` type in the reader. Do not grow the agent-sdk
     barrel (R2).
  2. **Serious.** On Windows, `antigravity-ls.provisional.ts:14` runs `Select-Object
     ProcessId,CommandLine`. PowerShell prints that as a table and cuts long command lines to the host
     width, so the token and port are lost or partly captured. Emit raw lines instead, for example
     `... | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }`, and add a parser spec with a long
     Windows line.
  3. **Serious, misattribution.** `ANTIGRAVITY_PROCESS_MARKER = 'language_server'`
     (`antigravity-ls.provisional.ts:2`) also matches the Windsurf/Codeium language server, which takes
     the same `--csrf_token`/`--port`. That would report another product's quota under the antigravity
     owner. Require an Antigravity-specific marker on the same line (for example `antigravity` in the
     path, case-insensitive) as a provisional constant. Add a spec: a non-Antigravity `language_server`
     line gives `service-unavailable` and no request.
  4. **Serious, R4 evidence is vacuous.** `antigravity-plan-usage.reader.spec.ts:31`
     `JSON.stringify(logger)` serialises the mock object, and that drops the jest.fn calls. The assertion
     can never fail. Serialise every logger method's `mock.calls` on the success path and on the mismatch
     path. Do the same in the Ollama spec for the secret.
  5. **Moderate.** The reader ignores the caller's `AbortSignal`. In `ollama-cloud-plan-usage.reader.ts:42`
     a signal that is already aborted never fires the listener. In `antigravity-plan-usage.reader.ts:45` the
     request `signal` is never read. Return early when `signal?.aborted`, and link the signal into the
     Antigravity controller.
  6. **Minor.** Specs: add a non-ok HTTP status case (Ollama) and a request-rejects case (Antigravity).
     Restore real timers in a `finally`/`afterEach` (`ollama-cloud-plan-usage.reader.spec.ts:114`).
- Accepted as is: the `provider-owner.resolver(.spec).ts` hunks that only reformat with prettier (they
  are formatter output on files this batch owns). The `baseUrlHost` field on `SessionQuotaRoute` (one
  optional, non-secret field, with a probe spec asserting there is no secret).

Verification record, rework round 1 of 2 (team-leader). **ACCEPTED**, committed 50cd859af:

- Defect 1 fixed: local `ProbeCommandRunner` type at `antigravity-plan-usage.reader.ts:40-43`, with no
  agent-sdk import. Defect 2 fixed: `antigravity-ls.provisional.ts:16` uses `ForEach-Object` raw lines,
  and the spec has a 12,000-character line fixture (`antigravity-plan-usage.reader.spec.ts:43-61`).
  Defect 3 fixed: `ANTIGRAVITY_PRODUCT_MARKER` (`antigravity-ls.provisional.ts:4`) is required on the same
  line, case-insensitive (`reader.ts:113-117`), and a codeium spec asserts no request (`spec.ts:63-79`).
  Defect 4 fixed: `loggerCalls` serialises `mock.calls` for every jest.fn method on the success,
  rejection and mismatch paths of both specs. `createMockLogger` returns `jest.fn` methods
  (`libs/shared/src/testing/mock-logger.ts:30-35`). Defect 5 fixed: there is an early return for an
  already-aborted signal (`ollama…reader.ts:36`, `antigravity…reader.ts:53,61`), and the caller's signal
  is linked into the Antigravity controller (`:62-64,100`). Defect 6 fixed: a non-ok 503 spec, a
  rejected-request spec, and `useRealTimers` in `finally`.
- Scoped run (`--skip-nx-cache`; a concurrent run was rerun with `--parallel=1` because of load from
  Batch 11): typecheck passes for both projects and lint passes for both (warnings only, in files Batch 10
  does not touch). agent-sdk tests: 2642 of 2645 pass, 3 skipped. auth-providers tests: 1498 of 1502 pass.
  The 4 failures are the known EPERM `removeTree` teardown item in
  `translation-proxy.sdk.integration.spec.ts`. In the first, overloaded run, agent-sdk
  `off-thread-process-spawner.spec.ts:545` (`.cmd` wrapper) failed once. It passed on the rerun, nx
  flags it as flaky, and Batch 10 does not touch that file.
- `rejectUnauthorized` appears only at `antigravity-plan-usage.reader.ts:178` (the literal `127.0.0.1`
  request). The root barrel has 149 lines. `git diff HEAD -- libs/backend/agent-sdk/src/index.ts` is
  empty.
- Phase 3 review is due on badcec203..50cd859af (requested as NEEDS REVIEW).

### Phase 3 review record — ACCEPTED (fix commit 02bc5b502)

Verdict history:

| Review | Scope | Reviewer | Verdict | Findings |
| ------ | ----- | -------- | ------- | -------- |
| `phase-3-code-review.md` | Batches 6-9 | opencode lane | APPROVED 8/10 | A1-A3 Moderate, A4-A6 Minor |
| `phase-3-batch-10-review.md` | Batch 10 (48ddcb9f9..50cd859af) | code-logic-reviewer | REVISE 7/10 | B1 Serious, B2-B5 Moderate, B6-B8 Minor |
| `phase-3-fix-review.md` | fix round (A1-A3, B1-B5) | codex lane re-review | REVISE 8/10 | 7 of 8 fully fixed; B1 partial = Minor test gap only |

- Fix round (one round, per the run rules): Moderate A1-A3 and Serious/Moderate B1-B5 fixed
  (`phase-3-fix-report.md`). Orchestrator decision: the fix round is **accepted**. The one remaining
  item is Minor and is recorded below, not fixed.
- Team-leader verification of the fix files: B1 settlement is on disk
  (`antigravity-plan-usage.reader.ts:287-335`; `request.on('error')` and the pre-response `close`
  handler at `:330-333`). `rejectUnauthorized` appears only at `antigravity-plan-usage.reader.ts:272`
  (the literal `127.0.0.1` request). No TODO/PLACEHOLDER/STUB/eslint-disable markers in the diff. Root
  barrel `libs/backend/auth-providers/src/index.ts` is 149 lines (≤150).
- Scoped run: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/auth-providers --skip-nx-cache
  --parallel=1`. Typecheck and lint pass. Tests: 1525 of 1529 pass. The 4 failures are the known EPERM
  `removeTree` teardown item in `translation-proxy.sdk.integration.spec.ts` (S1-S4). Reruns of the suite
  (5 more full runs) show only known items: the EPERM item (sometimes S6b too) and the known
  header-deadline item in `translation-proxy-base.spec.ts:2258`.
- Observation, not reproduced: in 1 of 6 full runs `plan-usage.service.spec.ts` was listed FAIL under
  load. That run's failure text was not captured. The spec is not in the fix diff and uses an injected
  clock. It then passed 24/24 three times on its own, 3 times as part of the quota folder while the
  translation suites ran concurrently, and in every later full run. Carried to TASK-596-FU-PHASE3 as a
  watch item.
- Commit `02bc5b502` contains exactly the 8 `libs/backend/auth-providers/src/lib/quota/**` fix files.
  The chat-ui files and `.ptah/specs` were not staged.

Named follow-up **TASK-596-FU-PHASE3** (Minor items, recorded, not fixed):

1. A4 — `provider-owner.resolver.ts:131-150`: the default proxy hook does not check
   `isPlaceholderCredential` on the header path, so a forwarded placeholder would become a stable fake
   credential owner. Latent; no production `getHeaders()` sends one today. Return `null` for a
   placeholder and add a spec.
2. A5 — `plan-limit-ledger.service.ts` `proxyOwner`: an observation without `sourceId` falls back to
   `proxy:unidentified`, which merges per provider (F68). Make `sourceId` required on
   `ProviderQuotaContext`/`ProviderQuotaObservation`, or use a fresh id per observation.
3. A6 — `plan-usage.service.ts:127-129`: the `cache` and `failingSince` maps are never evicted. Use lazy
   TTL eviction on access.
4. B6 — `antigravity-plan-usage.reader.ts` `defaultRequest`: a new `Agent` per call that is never
   destroyed. The POST has no body or `Content-Type`; note this in the provisional constants file.
5. B7 — the Ollama Cloud reader relies on `plan-credential.source.ts:114-116` for placeholder keys; add a
   reader spec comment that says so.
6. B8 — `provider-owner.resolver.ts:366` parses `new URL(OLLAMA_CLOUD_DIRECT_BASE_URL)` on every call;
   hoist it to a module constant.
7. B1 test gap — no test directly produces the request `'error'` path of `readJsonResponse` or asserts
   listener cleanup. The code handles it at `antigravity-plan-usage.reader.ts:330-333`. Add a loopback
   fixture for both.
8. Watch item — the one unreproduced `plan-usage.service.spec.ts` failure under load (above).

---

## Phase 4 — Lane runtime (cli-agent-runtime, Batches 11-13)

Phase review: code-logic plus style (new tokens/exports), one CLI-lane review.

## Batch 11: Lane classifier, exit handling, lane owner and persistence — COMPLETE (commit b60f572a9)

- Recommended executor: backend-developer
- Fallback executor: backend-developer (fresh instance)
- Execution mode: sequential
- Rationale: exit path and persistence of the same `AgentProcessInfo` fields
- Tasks: 3 | Depends on: Batch 9 (ledger, resolver, PlanUsageService API) — **met** (48ddcb9f9;
  `PLAN_USAGE_SERVICE`, `PLAN_LIMIT_LEDGER`, `PROVIDER_OWNER_RESOLVER` are all registered in auth-providers)
  | Concurrent-safe with: Batch 10. They stay file-disjoint with Task 10.3: Batch 10 writes only
  auth-providers (plus, optionally, agent-sdk `session-quota-probe.service.ts`), and Batch 11 writes only
  cli-agent-runtime. Task 11.2 delegates to `ProviderOwnerResolver` but does not edit it. Any later
  Task 10.3 change to `ownerForSession` reaches lanes through that delegation, so no rework is needed.
- Phase: 4 | Phase review: deferred to Batch 13

### Task 11.1: `lane-limit-classifier.ts` and error summary reuse — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\lane-limit-classifier.ts` (CREATE, + spec), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\sdk-error-summary.ts`
- Plan reference: Component 10 `:904-911`
- Quality requirements: `summarizeCliSdkError` output unchanged (existing spec green); one pattern per wording; debug-only match logs
- Validation notes: F34-F40; `MODEL_CAPACITY_EXHAUSTED`, timeout, auth → `null`

### Task 11.2: `lane-owner.resolver.ts` — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\lane-owner.resolver.ts` (CREATE, + spec)
- Plan reference: Component 10 `:918-924`; G3
- Validation notes: delegates hashing to `ProviderOwnerResolver`; produces full `QuotaOwnerRef`; only upgrade unknown → known, never overwrite

### Task 11.3: `handleExit` classification, S3 success and owner persistence — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts` (+ spec), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\wiring\agent-events.ts` (+ spec)
- Depends on: Tasks 11.1, 11.2
- Plan reference: Component 10 `:912-917`; Decision 4 S3 `:357`; G3 + non-blocking note `:26-28`
- Pattern to follow: `handleExit` `agent-process-manager.service.ts:1654-1710`; `persistCliSessionReference` `agent-events.ts:309-445`
- Quality requirements: classify before `outputBuffer.discard`, last 16 KB plus error segments; timeouts never classified; ledger failure never alters exit handling; touch only the exit/spawn regions (597 edits `doSpawnSdk` and resume entry, R5)
- Validation notes: set `info.quotaOwner` at spawn; persist `CliSessionReference.quotaOwner`; **when a running lane's owner upgrades unknown → known, persist immediately** (extra `persistCliSessionReference` call). S3: antigravity `'plan'`, codex/opencode `'unknown'`, skipped for unknown owner (F65)

### Batch 11 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime`

### Batch 11 verification record (team-leader)

- Report: `batch-11-report.md`. Files verified on disk: `limits/lane-limit-classifier.ts` (+ spec),
  `limits/lane-owner.resolver.ts` (+ spec), `sdk-error-summary.ts` (imports the two regexes; body
  unchanged), `agent-process-manager.service.ts` (+ spec, restore spec, workspace-scope spec),
  `wiring/agent-events.ts` (+ spec), `wiring/sdk-callbacks.spec.ts`, `di/register.agent-process-manager.smoke.spec.ts`.
- Re-run after Batch 10 landed (50cd859af): `npx nx run-many -t typecheck,test,lint -p
  @ptah-extension/cli-agent-runtime --skip-nx-cache --parallel=1` passed ("Successfully ran targets
  typecheck, test, lint"). The executor's unidentified early flake did not reproduce.
- App DI smoke specs: `apps/ptah-electron/src/di/container.smoke.spec.ts` 18/18 and
  `apps/ptah-cli/src/di/container.smoke.spec.ts` 10/10 pass. The ptah-cli and VS Code specs stub
  `AGENT_PROCESS_MANAGER`, so they do not prove that a real host resolves the manager with the ledger.
- The diff stays inside `libs/backend/cli-agent-runtime/**`. The manager hunks are imports, the
  constructor, `trackSdkHandle` (:583), the new `recordQuotaOwner`, `handleExit` and the new private
  helpers. `doSpawnSdk` (:331) and the resume entry are untouched (R5). No never-touch file changed.
  `info.quotaOwner` and `CliSessionReference.quotaOwner` hold the full `QuotaOwnerRef`, and
  `quotaOwnerKey` appears nowhere. The chat-ui files and `.ptah/specs` were left unstaged.
- Accepted notes: (a) the manager grew from 1219 to 1361 lines. The `max-lines` warning was already
  there, and this is a warning, not an error. A later humanize pass may move the exit helpers into
  `limits/`. This is not tracked as a fix. (b) and (d) are binding for Batch 12 below. (c) is binding
  for Batch 15 below.

Carry-forward to Batch 12 (binding):

1. **Owner for ptah-cli lanes.** ptah-cli lanes start with no owner, because `ownerForLane('ptah-cli')`
   is `undefined`. Task 12.2 MUST call `AgentProcessManager.recordQuotaOwner(agentId, owner)` with
   `LaneOwnerResolver.ownerForClaudeLane(account, agentId)` (after `accountInfo()`) or
   `ownerForPtahCliKey(id, provider)`. The call must happen before the lane can exit, so the
   `agent:quota-owner` persist and the exit persist carry it. A spec must assert that a ptah-cli lane
   gets a known owner through this path, and that a failed `accountInfo()` leaves the owner unknown
   without throwing. Until this lands, `recordLaneLimits` writes nothing for ptah-cli lanes
   (`if (!owner) return`).
2. **Ollama false positive on ptah-cli (fix in Batch 12).** `handleExit` passes
   `cliOrProvider: tracked.info.cli`. For `'ptah-cli'`, the classifier tries both the Claude and the
   Ollama wordings (`lane-limit-classifier.ts:148`). A ptah-cli Claude lane that fails with a 429
   "Too Many Requests" therefore gets `failureKind: 'quota'` and Ollama-shaped evidence.
   `AgentProcessInfo` carries `ptahCliId` but no provider id, and the manager has no ptah-cli
   registry, so this cannot be fixed inside Batch 11. Batch 12 MUST fix it:
   `classifyLaneFailure` must use the lane's provider when it is known. That is
   `tracked.info.quotaOwner.providerId`, mapped to `'anthropic'` or `'ollama-cloud'`, or a provider
   id that Task 12.2 records on the run. With no provider known, ptah-cli must not match the Ollama
   wording. Add a spec: a ptah-cli lane whose provider is Anthropic and that fails with a
   "429 Too Many Requests" rate-limit line is not classified as quota. The F38 Ollama case must still
   match when the provider is `ollama-cloud`. This edit to `agent-process-manager.service.ts` is
   limited to `classifyLaneFailure` and is in scope for Batch 12.
3. **Antigravity owner upgrade.** `recordQuotaOwner` supports the upgrade from `cli-store` to
   `account`, but nothing calls it yet. Record whichever batch wires the Batch 10 Antigravity reader to
   it. If no batch does, raise it in the Phase 4 review rather than leaving it silently unwired.

Carry-forward to Batch 15 (binding, joins the existing Task 15.2 ledger-activation item):

- The manager now injects `AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER`, which needs
  `PLATFORM_TOKENS.STATE_STORAGE`. The Electron smoke spec resolves it. The ptah-cli and VS Code
  smoke specs stub `AGENT_PROCESS_MANAGER`. Batch 15 must prove that the real manager resolves in the
  VS Code and ptah-cli hosts, either with an unstubbed resolve in their smoke specs or with a
  host-level check, and must record the result.

Out-of-scope observations, routed:

- `restoreAgents` does not copy `ref.quotaOwner` into restored manager records → Batch 13 (owner
  lifecycle) or Batch 17 (agent-monitor restore). It must be checked in the Phase 4 review.
- `LaneOwnerResolver` is resolved by class, with no explicit registration → Task 13.3 (tokens and
  registration).

## Batch 12: Ptah-CLI lane stream signals — COMPLETE (commit 836140bb1)

- Recommended executor: backend-developer
- Fallback executor: backend-developer (fresh instance)
- Execution mode: sequential
- Rationale: stream loop and its registry wiring are coupled
- Tasks: 2 | Depends on: Batch 11
- Phase: 4 | Phase review: deferred to Batch 13

### Task 12.1: `PtahCliStreamLoop` usage segment and plan-limit signals — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\ptah-cli\helpers\ptah-cli-stream-loop.service.ts` (+ spec)
- Plan reference: Component 10 `:925-929`; Decision 8 `:427`; Decision 4 S2 `:356`
- Pattern to follow: result branch `:473-490`; `isSystemInit` `:325`
- Quality requirements: the existing `info` text line is unchanged; `usage` attached to it; mapper reused from agent-sdk
- Validation notes: F63 (overage → `'overage'`, clears nothing); same per-turn main-loop scope rule as S1; `ollama-cloud` lanes billing `'plan'`

### Task 12.2: Registry wiring for lane owner and signals — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\ptah-cli\ptah-cli-registry.ts`
- Depends on: Task 12.1
- Plan reference: Component 10 `:928-929`; `ptah-cli-registry.ts:875-896`
- Validation notes: after `isSystemInit`, one `sdkQuery.accountInfo()` with 3 s timeout → lane owner via `lane-owner.resolver`; failure leaves owner unknown; `onPlanLimitSignal` → ledger with the lane's recorded owner

### Batch 12 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime`

### Batch 12 record

- Verified on disk by team-leader. `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime
  --skip-nx-cache --parallel=1` returned "Successfully ran targets typecheck, test, lint" (exit 0).
- Commit `836140bb1` contains 10 files, all under `libs/backend/cli-agent-runtime/**`. The concurrent
  Phase 3 fix round (`auth-providers/**`) and the chat-ui files were not staged.
- R5 holds. In `agent-process-manager.service.ts` the diff is the `laneLimitWording` import and the
  `classifyLaneFailure` body; `doSpawnSdk` and the resume entry are untouched.
- Batch 11 carry-forward 1 (owner before exit) and carry-forward 2 (Ollama false positive) are closed.
  Specs cover both.

Deviations judged:

1. **Accepted: extra files** `helpers/ptah-cli-lane-plan-limits.ts` (+ spec) and
   `ptah-cli-registry-plan-limits.spec.ts`. They stay inside the lib and inside the task scope, and
   they keep the 1.6k-line registry from growing by about 250 lines. **Accepted: the
   `lane-limit-classifier.ts` edit.** Carry-forward 2 required it, because the rule "never match
   Ollama on an unknown provider" lives in its `MATCHERS` table.
2. **Accepted, with a binding carry-forward to Batch 13: the duplicate Claude-window conversion.**
   `laneWindowFromEvidence` copies `windowFromClaudeEvidence` from `plan-limit-ledger.rules.ts:267`.
   That function is not exported, and Batch 12 could not edit auth-providers. Task 13.3 must close
   this (see the Batch 13 carry-forwards below).
3. **Recorded: the Antigravity owner upgrade is still unwired** (Batch 11 carry-forward 3). It goes
   to Batch 13 and the Phase 4 review.
4. **Checked: provider coverage.**
   - A Glm lane is a ptah-cli lane on the `ollama-cloud` provider (plan `:178`, `:299`). It gets the
     `stored-key` owner rule (`ptah-cli-lane-plan-limits.ts:83-86`), so its S2 signals reach the
     ledger.
   - `z-ai`, `moonshot`, `openrouter` and custom providers get no owner, so their signals are
     dropped. This matches the Component 10 owner rules, which name only Claude and Ollama Cloud.
   - Not a defect. It is a Phase 4 review confirmation item.
5. **Confirmed: the owner-read bound.**
   - `within(read(), LANE_OWNER_READ_TIMEOUT_MS = 3_000)` (`ptah-cli-lane-plan-limits.ts:40, 189`)
     rejects at 3 s. The catch maps the rejection to `null`, and `finishRead` resolves `settled`.
   - Providers with no owner rule settle synchronously in the constructor.
   - A Claude lane whose system init never arrives settles on `end()`.
   - So a turn release or exit waits at most 3 s after the read starts. The timer is unref'd and
     cleared in `finally`.

Minor issue, recorded and not fixed: `ptah-cli-registry.ts:~990-1021`. The new `createLanePlanLimits`
JSDoc was inserted below the existing `lookupOptional` JSDoc, so that block now sits above the wrong
method. This is a Phase 4 review item. Fix it if Batch 13 or the Phase 4 fix round touches the
registry.

## Batch 13: Lane limit lookup, owner discovery and owner-lifecycle integration — COMPLETE (commit bcfe47a8a; Phase 4 fix 190954cbd; review phase-4-code-review.md APPROVED 8/10, re-review APPROVED 9/10)

**Start gate: LIFTED.** The Phase 3 fix commit `02bc5b502` (`auth-providers/**`) landed and the
fix round was accepted (Phase 3 review record above). Batch 13 may start. It builds on `02bc5b502`.

Carry-forwards from Batch 12 (binding):

1. **Task 13.3: remove the duplicate window conversion.**
   - Export `windowFromClaudeEvidence` from the `@ptah-extension/auth-providers` quota barrel. This is
     a one-line barrel edit in a second lib, which the 2-lib cap allows.
   - Delete `laneWindowFromEvidence` from `ptah-cli-lane-plan-limits.ts:283-309` and call the exported
     function instead.
   - Keep `laneWindowDescriptor`, because the classifier still uses it.
   - Batch verification adds `-p @ptah-extension/auth-providers`.
2. **Task 13.3: register `LaneOwnerResolver` under a token.**
   - `createLanePlanLimits` (`ptah-cli-registry.ts`) then looks the token up instead of building
     `new LaneOwnerResolver(logger, source)`.
   - This also closes the Batch 11 observation "resolved by class, with no explicit registration".
3. **Antigravity owner upgrade (Batch 11 carry-forward 3).**
   - Wire the Batch 10 Antigravity reader to `recordQuotaOwner` for the `cli-store` → `account`
     upgrade, in Task 13.2 (discovery) or Task 13.4, whichever holds the reader.
   - If Batch 13 does not wire it, the executor must say so explicitly, and the Phase 4 review must
     raise it.
4. **Task 13.4: copy `ref.quotaOwner` on restore.** `restoreAgents` must copy `ref.quotaOwner` into
   restored records (Batch 11 observation). Task 13.4's G3 restart leg covers this.

Phase 4 review focus (Batches 11-13), added from Batch 12:

- Confirm that dropping S2 signals for `z-ai`, `moonshot`, `openrouter` and custom ptah-cli providers
  is intended. Glm (`ollama-cloud`) is covered.
- Check the order of the owner recording against the turn release. `settled` can resolve before
  `attach()` when the read finishes before the manager tracks the run. `recordQuotaOwner` then runs
  one microtask after `attach`. Confirm that no exit is ever classified or persisted before that.
- Check the misplaced `lookupOptional` JSDoc in `ptah-cli-registry.ts` (Minor).

- Recommended executor: backend-developer
- Fallback executor: backend-developer (fresh instance)
- Execution mode: sequential
- Rationale: lookup and discovery share DI wiring; the backend A→B integration spec needs both
- Tasks: 4 | Depends on: Batches 10, 12
- Phase: 4 | Phase review: **due after this batch** — code-logic + style, CLI lane

### Task 13.1: `LaneLimitLookupService` — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\lane-limit-lookup.service.ts` (CREATE, + spec)
- Plan reference: Component 10 `:930-933`
- Pattern to follow: `settledWithin` `protocol-dispatcher.ts:2901-2916`
- Validation notes: F41; never rejects; per-lane race; `{lookup:'timeout'|'failed'}`

### Task 13.2: `PlanLimitOwnerDiscoveryService` (10b) — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\plan-limit-owner-discovery.service.ts` (CREATE, + spec)
- Plan reference: Component 10b `:972-1039`; non-blocking note `:26-27`
- Pattern to follow: `resolveEffectiveAuthRoute` (`effective-route.ts:36-58`, exported from the auth-providers barrel); detection/registry sources `agent-namespace.builder.ts:355-411`
- Validation notes: explicitly assemble the provider snapshot `resolveEffectiveAuthRoute` needs; F69, F70, F72, F81, F82, F83; `ownerKeys` → ledger-only snapshots using the run's persisted `QuotaOwnerRef`; a throwing source drops only that source

### Task 13.3: DI tokens, registration, exports — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\di\tokens.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\di\register.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\index.ts`
- Validation notes: D9 — `LANE_LIMIT_LOOKUP` and `PLAN_LIMIT_OWNER_DISCOVERY` with `Symbol.for`; existing register smoke specs green

### Task 13.4: Backend owner-lifecycle integration spec (F55 backend legs + G3 restart) — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\owner-lifecycle.integration.spec.ts` (CREATE)
- Depends on: Tasks 13.1-13.3
- Plan reference: F55 `:1429-1434` as amended by G2/G3; F77
- Validation notes: probe returns account A on turn 1 and B on turn 2 (no synthetic event) → session owner moves to B; run 1 keeps A and persists `quotaOwner` A; run 2 records B. G3 restart: run A with **no ledger evidence**, reload via `getCliSessionsForRestore` (fake store) → still A → `ownerRelation` vs B = `different`. Malformed/legacy value → `undefined`, never B

### Batch 13 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime,@ptah-extension/auth-providers`
  (auth-providers is added for the `windowFromClaudeEvidence` barrel export, Batch 12 carry-forward 1)
- Phase 4 review requested on the combined diff of Batches 11-13

### Batch 13 record

- Verified on disk by team-leader (report `batch-13-report.md`). No TODO/STUB markers under `limits/`.
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime @ptah-extension/auth-providers
  --skip-nx-cache --parallel=1`: cli-agent-runtime typecheck, test, lint pass (exit 0 on a scoped
  re-run); auth-providers typecheck and lint pass (exit 0); auth-providers test 59/61 suites,
  1524 passed, 5 failed — all 5 are the recorded environment items
  (`translation-proxy.sdk.integration.spec.ts` S1-S4 `EPERM` in temp teardown;
  `translation-proxy-base.spec.ts` header-deadline timing). None touches this batch's one barrel line.
- Commit `bcfe47a8a`: 17 files, 16 under `libs/backend/cli-agent-runtime/**` plus
  `auth-providers/src/lib/quota/index.ts` (+1 line). Root barrel `auth-providers/src/index.ts`
  untouched at 149 lines. Chat-ui files and `.ptah/specs` not staged.
- R5 holds: manager hunks are the import, the constructor inject token (`:218`) and
  `restoreAgents` (`:819`). `doSpawnSdk` and the resume entry are untouched.
- Batch 12 carry-forwards 1, 2 and 4 closed (barrel export + `laneWindowFromEvidence` deleted;
  `LANE_OWNER_RESOLVER` token used by manager and registry; `restoreAgents` copies `quotaOwner`,
  covered by the restore spec and the G3 leg). The misplaced `lookupOptional` JSDoc is fixed.

Deviations judged:

1. **Accepted, recorded for the Phase 4 review: Antigravity owner upgrade not wired.** Plan `:302`
   and `:922` make the upgrade conditional ("`account`, else `cli-store`"; "upgrades to `account`
   when its reader returned one"). The Batch 10 reader returns no account
   (`antigravity-plan-usage.reader.ts:46-54, 113-124` parse only `models`), so `cli-store` is the
   plan's own fallback, and every consumer keys on `ownerForCliStore('antigravity')` consistently.
   Exact gap for the reviewer: plan `:302` names "the account field from a validated
   `GetUserStatus` payload" as the source, and the Batch 10 reader does not extract it. Closing it
   needs an auth-providers reader change (provisional LS payload, AS8) plus a `recordQuotaOwner`
   call site. Not a Batch 13 defect; the Phase 4 review decides whether it is a fix-round item or a
   named later task.
2. **Accepted: discovery returns `DiscoveredPlanOwner[]` (`{kind:'read', target}` |
   `{kind:'known', snapshot}`).** `PlanOwnerTarget` alone cannot express F82 or a ledger-only
   snapshot. **Binding carry-forward to Batch 15 (Task 15.1):** the `provider:getPlanLimits`
   handler calls `PlanUsageService.getOwnerSnapshot` only for `kind:'read'` entries and passes
   `kind:'known'` snapshots through unchanged — never reads a `known` owner; a spec asserts no
   reader call for a `known` entry.
3. **Accepted, recorded for the Phase 4 review: ledger-only snapshots use `status:'service-unavailable'`
   with no `unavailableReason`.** A dedicated status (or an `unavailableReason` such as `ledger-only`)
   would be cleaner, because the frontend must otherwise infer "no current read" from owner
   comparison, and a recorded Claude owner without a session already uses the same status with
   `no-open-session`. Both options change `ProviderAccountUsageStatus` /
   `PlanLimitUnavailableReason` in `@ptah-extension/shared`, so not changed now. **Binding
   carry-forward to Batch 18:** a ledger-only snapshot (`service-unavailable`, no
   `unavailableReason`, owner not the current owner) is shown by owner comparison as a past
   owner's last-known evidence, never as a live read failure or error state.
4. **Accepted: recorded Claude owners with no open session read ledger-only as
   `no-open-session`** (`plan-owner-read.ts:81-94`). Reading through the probe without the owner's
   own session could answer with another account (R7). Correct per R7.
5. **Accepted: extra file `limits/plan-owner-read.ts`.** Inside the lib and the `limits/` folder; it
   is the single owner-to-read rule both the lookup and discovery use, which avoids duplication.
6. **Binding carry-forward to Batch 14 (Task 14.2):** `agent-namespace.builder.ts:377-385` builds
   ptah-cli rows without `providerId`. Task 14.2 must add `providerId: a.providerId` to those rows,
   so `LaneLimitLookupService.ownerOf` applies the Ollama Cloud key rule to Glm lanes; without it they
   read `no-owner`. A spec asserts a ptah-cli `ollama-cloud` row resolves an owner.

Phase 4 review request:

- Commits: `b60f572a9` (Batch 11), `836140bb1` (Batch 12), `bcfe47a8a` (Batch 13). Excluded:
  `50cd859af` and `02bc5b502` (Phase 3; `02bc5b502` touches no cli-agent-runtime file).
- Diff: `git diff 50cd859af bcfe47a8a -- libs/backend/cli-agent-runtime
  libs/backend/auth-providers/src/lib/quota/index.ts` (29 files, +5411/-27).
- Open items for the reviewer: deviations 1 and 3 above; S2 signal drop for `z-ai`, `moonshot`,
  `openrouter` and custom ptah-cli providers; owner-recording order versus `attach()`/exit.

### Phase 4 review record

Review: `phase-4-code-review.md` (opencode CLI lane). Fix report: `phase-4-fix-report.md`.

Verdict history:

1. Round 0, Batches 11-13 combined diff (`50cd859af..bcfe47a8a`): **APPROVED 8/10**. No Blocking or
   Serious findings; 3 Moderate.
   - Finding 1 (Antigravity account identity unwired): ruled a **named later task** (Ruling 1), see
     TASK-596-FU-PHASE4 below.
   - Finding 2 (`ledgerOnly` discarded the status `planOwnerRead` already knew; an Anthropic
     `credential` owner was `service-unavailable` with ledger windows instead of `unsupported-auth`
     with none): fix round.
   - Finding 3 (`discoverTargets` had no deadline; one hung source hung the whole call): fix round.
   - Rulings 3 and 4 accepted Batch 13 deviation 2 (`DiscoveredPlanOwner` read/known union, ledger-only
     listed after live sources) and the S2 drop for providers without an owner rule as intended.
2. Fix round 1 (backend-developer, `plan-limit-owner-discovery.service.ts` + spec only): findings 2 and 3
   fixed. Re-review scoped to the fix diff: **APPROVED 9/10**, no new findings; finding 1 remains open
   as the recorded deferral.

Fix commit **`190954cbd`** `fix(cli-agent-runtime): keep known owner status for ledger-only owners and
bound discovery sources` — 2 files, both under `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/`.
Team-leader verification before commit: `npx nx run-many -t typecheck,test,lint -p
@ptah-extension/cli-agent-runtime --skip-nx-cache --parallel=1` — typecheck, test, lint all pass
(run 2m 2s). Reviewer's own run: limits suites 5/5, 93 passed. Chat-ui files and `.ptah/specs` not
staged. `doSpawnSdk`, the resume entry and the never-touch files are untouched.

**Named follow-up TASK-596-FU-PHASE4 (open; must not stay silently unwired).**

1. **Moderate — Antigravity account identity (review finding 1, Ruling 1).** Today every Antigravity
   lane keys on the plan's fallback `ownerForCliStore('antigravity')` (`lane-owner.resolver.ts:76-77`);
   the plan's primary identity (`implementation-plan.md:302`, `:922`) is unreachable. Two Google
   accounts sharing one `~/.gemini` root get one merged owner key (cross-account evidence
   misattribution). Required work:
   - `libs/backend/auth-providers/src/lib/quota/readers/antigravity-plan-usage.reader.ts:46-54`: extend
     `StatusSchema` with the account field from a validated `GetUserStatus` payload, once the
     provisional LS payload (AS8) is confirmed; return it from the reader.
   - Add the one `recordQuotaOwner` call site (`agent-process-manager.service.ts:718-731`) for the
     `cli-store` → `account` upgrade, with a spec proving the upgrade fires and that two accounts on
     one root get distinct owner keys.
   - Until it lands, the behaviour is "fallback everywhere", consistent across discovery, lookup and the
     manager. Mode 3 must list this item as open in the completion summary; it is not closed by any
     batch in this run.
2. **Minor — jest "worker process failed to exit gracefully"** in the 5-suite `limits/` run. Not
   reproduced by `plan-limit-owner-discovery.service.spec.ts` alone; pre-existing in another limits
   suite. Find the leaked handle (likely an un-unref'd timer or open promise in a spec).
3. **Minor (record) — wording regexes provisional** for OpenCode, Ollama and Antigravity lane
   classification (review Q3); revisit when real fixtures exist (no live checks in this run).

**Carry-forwards from Phase 4 (binding):**

- **Batch 18 (Task 18.1), Ruling 2:** the ledger-only status overload stays in `@ptah-extension/shared`
  unchanged. Two ledger-only shapes now reach the frontend: `service-unavailable` with **no**
  `unavailableReason` (owner needs a live read) and, for a recorded Claude account owner,
  `service-unavailable` **with** `no-open-session` — the same answer a live no-session owner gives. Only
  owner comparison distinguishes them: a snapshot whose owner is not the current owner is shown as a
  past owner's last-known evidence, never as a live read failure or error state. Batch 18 must land that
  comparison with a spec for both shapes. A ledger-only `unsupported-auth` owner carries no windows.
- **Batch 15 (Task 15.1), finding 3 closed:** discovery is now bounded **per source** — every source
  (and the shared `detection` read) races its own `LIMIT_LOOKUP_DEADLINE_MS` (3 s) timer, all start
  together, a timed-out source is dropped alone, and duplicate-owner precedence still follows the fixed
  source order. `discoverTargets` therefore resolves in about one deadline and never rejects. The
  `provider:getPlanLimits` handler does not need its own discovery deadline, but its worst case is
  discovery (~3 s) then the per-owner reads (3 s each, in parallel), ~6 s total; Task 15.1 must keep the
  per-owner reads parallel and bounded and must not serialise them after discovery per owner.

---

## Phase 5 — Tool and RPC surfaces (Batches 14-15)

Phase review: code-logic plus style (new RPC method and tool output), one CLI-lane review.

## Batch 14: MCP agent tool limit output — COMPLETE (commit 164848d93; Phase 5 review requested on 190954cbd..164848d93)

- Recommended executor: codex CLI lane (one lane, sequential; self-contained prompt with absolute paths,
  no git). Updated at Phase 4 close.
- Fallback executor: backend-developer sub-agent
- Execution mode: sequential
- Rationale: formatter plus both transports must change together for the parity guard spec. The work is
  spec-driven text output (verbatim design §5 sentences, F42-F52 snapshot specs, byte-identical output
  with no `limits`) inside one lib, so it fits a self-contained lane prompt; the integration-heavy,
  higher-risk DI/activation work is Batch 15's.
- Tasks: 2 | Depends on: Batch 13 (met, bcfe47a8a + 190954cbd) | Concurrent-safe with: Batch 15 —
  **confirmed file-disjoint at Phase 4 close**: Batch 14 writes only `libs/backend/vscode-lm-tools/**`,
  Batch 15 only `libs/backend/rpc-handlers/**`; no shared registry, barrel or config file. Per the run
  rules, whichever commits second re-runs its verification after the first commit lands.
- Phase: 5 | Phase review: deferred to Batch 15

### Task 14.1: `agent-limit.formatter.ts` and response formatter — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\agent-limit.formatter.ts` (CREATE, + spec), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\mcp-response-formatter.ts` (+ spec)
- Plan reference: Component 11 `:1043-1058`; design-spec.md §5
- Quality requirements: sentences verbatim from design §5; `Limit state` column appended last; output byte-identical with no `limits` argument; no vendor brand in static strings (R8); estimates never produce `WARNING`
- Validation notes: F42-F51 snapshot specs

### Task 14.2: Namespace dependency and both handlers — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-stdio\agent-tool.dispatcher.ts`
- Depends on: Task 14.1
- Plan reference: Component 11 `:1059-1063`
- Quality requirements: lookup runs only **after** `agent.spawn` settles; limit block appended on success and on every error branch; a lookup failure never changes the outcome
- Validation notes: F52; optional inject `CLI_AGENT_RUNTIME_TOKENS.LANE_LIMIT_LOOKUP` `{isOptional:true}`; guard specs `vendor-roster-drift`, `lane-rule-single-home`, `agent-spawn-surface-parity` green
- **Binding (carried from Batch 13):** `agent-namespace.builder.ts:377-385` maps ptah-cli rows without
  `providerId`. Add `providerId: a.providerId` so `LaneLimitLookupService` applies the Ollama Cloud
  key rule to Glm lanes (otherwise `no-owner`). Spec: a ptah-cli `ollama-cloud` row gets an owner.

### Batch 14 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools`

### Batch 14 review round 1 (2026-10-05) — NOT ACCEPTED, batch stays IN_PROGRESS

Scoped run (`--skip-nx-cache --parallel=1`) passed 3/3, but on-disk code fails the task contract and
design §5 (D1-D11 handed to the codex lane; revise cap 2 rounds). Main gaps: no new specs at all
(F42-F52, the `providerId` binding spec); spawn target matched by `cli` only; list branch drops
existing column content; a generic `ptah_agent_spawn` error that used to be thrown now returns a
tool error; §5 limit-state/warning/alternatives text not verbatim; no cooldown line.

### Batch 14 review, rework round 1 return (2026-10-05) — NOT ACCEPTED, batch stays IN_PROGRESS

Scoped run by team-leader (`npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools
--skip-nx-cache --parallel=1`, foreground): typecheck PASS, lint PASS, **test FAIL** (82 suites, 1 failed;
2688 tests, 2 failed). Guard specs (`tool-description.builder.spec.ts`: vendor-roster-drift,
lane-rule-single-home, agent-spawn-surface-parity) green. Fixed since round 1: `agent-limit.formatter.ts`
created with F42-F51 named specs (they exist), cli+ptahCliId row key, list keeps legacy column content,
protocol transport re-throws the generic spawn error (`protocol-dispatcher.ts:1146`), cooldown line, the
four §5 sentences verbatim, no brand in new static strings (R8), no-`limits` list/spawn paths return the
pre-change output. Remaining defects for round 2 of 2 (last lane round):

1. Test failure, malformed fixture: `agent-limit.formatter.spec.ts:11-17` builds `WINDOW` with
   `used: { percent: 94 }` (no `kind`) and `sources: {...}` instead of `usedSource`/`resetSource`/`kind`/
   `observedAt`; the `as unknown as AgentLimit` cast at `:18-29` hides it. F42 (`:41`) and F48 (`:110`)
   fail ("5-hour session unknown", source `[-]`). Build a typed `PlanLimitWindow`; no `unknown` cast.
2. Dead duplicate code: `mcp-response-formatter.ts:1748-1955` (`legacyLimitReason`,
   `legacyFormatLimitColumn`, `legacyMarkdownTable`, `rowName`, `legacyFormatPlanLimitsSection`,
   `alternativeLine`, `legacyFormatAlternatives`, `legacyFormatSpawnLimitBlock`) has zero callers and
   restates `agent-limit.formatter.ts`. Delete it and its now-unused imports (`:22-28`).
3. Failed spawn ignores the target lane: `protocol-dispatcher.ts:1132` and
   `mcp-stdio/agent-tool.dispatcher.ts:408` always pass `undefined` to `formatSpawnLimitBlock`, so an
   unsuccessful spawn always prints "unknown (limit lookup failed)" even when the lane's state is known.
   Design §5.2: "the identical `Limit state` and alternatives still follow". Use
   `findAgentLimit(limits, target)`.
4. §5 text still not verbatim: (a) owner-level list column `agent-limit.formatter.ts:72` prints
   `AT LIMIT (owner level, window unknown)`; §5.1 list sample is
   `AT LIMIT (window unknown, reset unknown) [error-derived] · no usage source` (the Plan-limits State
   cell keeps the owner-level wording); (b) window state `limit-reached` renders lowercase
   `limit reached` (`:111`), §5.1 shows `LIMIT REACHED`; `not-confirmed` lacks `(last reset unknown)`;
   (c) reason labels `:48` `aged` and `:54` `windows not confirmed` differ from §2.2's
   `aged value` / `window set not established`; (d) alternatives lines (`:119-130`) drop the unknown
   reason prefix (§5.1 `- Glm: limit lookup timed out; no windows known`, gemini line opens with its
   reason) and the owner-level at-limit wording (`at limit, window unknown, reset unknown [error-derived]
   · no usage source`); (e) owner-level Plan-limits row `:97-106` prints Used `unknown`/Source `-`
   where §5.1 shows `no usage source`/the evidence source.
5. Estimate note unreachable in practice: `agent-limit.formatter.ts:203` checks only `reasons[0]`;
   `classifyLaneState` pushes `estimated-limit` after lookup/status/window-set/scope/cooldown reasons
   (`lane-state.ts:266-290`), so a typical estimated lane never shows the Note. Test `reasons.some(...)`.
6. Missing specs the contract names: (a) the Batch 13 binding — no spec asserts
   `agent-namespace.builder.ts:394` passes `providerId` for a ptah-cli `ollama-cloud` row (the F52 test
   at `mcp-response-formatter.spec.ts:1802` uses `providerName` and the formatter, not the builder);
   (b) the `limits` failure fallback (`agent-namespace.builder.ts:424-443`) — lookup throw yields
   per-row `unknown`, no borrowed owner; (c) transport F52 — limit block appended on success and on the
   role / command-line-too-long branches, generic error still thrown (protocol) / still `agent_spawn
   failed` (stdio), lookup throw never changes the outcome. F52 as written compares
   `formatAgentList(a, r)` with `formatAgentList(a, r, undefined)`, which is the same call path and
   proves nothing; assert against a literal pre-change string instead.

### Batch 14 review, rework round 2 return (2026-10-05) — ACCEPTED, committed as 164848d93

Executor: backend-developer sub-agent (round 2 of 2; batch-14-rework-2-report.md). Scoped run by
team-leader (`npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools --skip-nx-cache
--parallel=1`, foreground): typecheck, test and lint PASS (exit 0). Round-1 defects re-checked on disk
(paths under `libs/backend/vscode-lm-tools/src/lib/code-execution/`):

1. Fixed. `mcp-core/agent-limit.formatter.spec.ts` uses typed fixtures classified by the real
   `classifyLaneState`; no `as unknown as` in any new spec; F42 `:207`, F48 `:352`/`:365` pass.
2. Fixed. The `legacy*`, `rowName`, `alternativeLine` duplicates are gone from
   `mcp-core/mcp-response-formatter.ts`; `formatAgentList` is one path (`agentListRow` + optional
   `Limit state` column and sections).
3. Fixed. `spawnRequestTarget` (`agent-limit.formatter.ts:49`, `ptahCliId` wins over `cli`);
   `formatSpawnLimitBlock` resolves the row with `findAgentLimit` (`:408-418`); used by
   `protocol-dispatcher.ts:1149` and `mcp-stdio/agent-tool.dispatcher.ts:411`. Success resolves from
   `result.cli`/`result.ptahCliId` (`mcp-response-formatter.ts:1868`).
4. Fixed. (a) list owner-level cell `agent-limit.formatter.ts:153`; (b) `WINDOW_STATE_CELL` `:69-78`;
   (c) `reasonText`/`WINDOW_STATE_REASON` `:60-112` (`aged value`, `window set not established, partial
   data`); (d) `alternativeLine`/`noWindowsDetail` `:266-306`; (e) owner-level Plan-limits row `:200-212`.
5. Fixed. `estimateNote` `:387-401` scans every window and reason; reached only for lanes that are
   neither at nor near limit, so an estimate never yields `WARNING`.
6. Fixed. Specs exist: `namespace-builders/agent-namespace.limits.spec.ts` (providerId binding with the
   real `LaneLimitLookupService`, no-providerId → no owner, throw → per-row `failed`, unwired →
   `undefined`); `mcp-core/agent-spawn-limits.transport.spec.ts` (protocol + stdio, success/role/
   command-line-too-long/ptahCliId/lookup-throw, generic error); F52 literal strings in
   `mcp-response-formatter.spec.ts:1803-1855`. The no-`limits` paths keep the pre-change json2md
   structure (same blocks, same row builder), so the stored strings match the pre-change output.

Deviations accepted:
- `formatSpawnLimitBlock(limits, target, attempted, now)` and removal of the `limitTarget` option: all
  three callers are in this lib; success keys on the lane that actually ran, failure on the lane the
  request named, which is the same row for an explicit request.
- List `AT LIMIT (<window>, resets <time>)` cell without relative time (F43 updated): matches the §5.1
  sample and prototype `stateCell`; table, alternatives and warnings keep the relative time.
- Cooldown line wording from the prototype (design cites the prototype as the source for every variant);
  no source tag because `PlanLimitCooldown` carries none.
- stdio generic error: pre-batch it returned `toolError('agent_spawn failed: <msg>', 'mcp_tool_failed',
  {tool})`; it still does, with the same code and details, and the limit block is appended (the task's
  "every error branch" requirement). A lookup throw leaves the text byte-identical (transport spec).
  Protocol keeps re-throwing the generic error with no lookup, as before.
- `**Limit state:**` after a blank line rather than adjacent to `**CLI Session ID:**`: needed to keep
  the pre-change json2md paragraph byte-identical.

Recorded for the Phase 5 review (not blocking): `ptah_agent_list` calls `agent.limits` outside a
try in `protocol-dispatcher.ts:1318`, relying on the namespace fallback (`agent-namespace.builder.ts:424-443`)
never throwing; the spawn path re-runs `agent.list()` for the lookup.

## Batch 15: Plan-limits RPC and push broadcaster — COMPLETE (commit a90f7594f; Phase 5 review APPROVED 9/10, phase-5-code-review.md; fix commit 670c74a72)

- Recommended executor: backend-developer sub-agent (Claude)
- Fallback executor: backend-developer (fresh instance)
- Execution mode: sequential
- Rationale: RPC, schema, broadcaster and shared activation in one lib. This batch carries the most
  binding risk in Phase 5 (eager ledger activation on three hosts, F71 secret walk, the read/known split,
  the `provider:getPlanLimits` registration drift, the discovery-deadline arithmetic below), which needs
  DI judgement mid-flight; keep it on the sub-agent.
- Tasks: 2 | Depends on: Batch 13 (met, bcfe47a8a + 190954cbd) | Concurrent-safe with: Batch 14
  (confirmed file-disjoint, see Batch 14)
- **Phase 4 note (finding 3 closed in 190954cbd):** `PlanLimitOwnerDiscoveryService.discoverTargets`
  is now bounded per source (each source races its own 3 s `LIMIT_LOOKUP_DEADLINE_MS`, all in
  parallel, a timed-out source dropped alone, never rejects). The handler need not wrap discovery in
  another deadline; it must keep the per-owner reads parallel with their own 3 s deadline so the call
  stays near ~6 s worst case. Record the measured bound in the batch report.
- Phase: 5 | Phase review: **due after this batch** (covers 14 + 15) — code-logic + style, CLI lane
- Carried from Batch 1 (tracked item): `provider:getPlanLimits` has been registered since commit 977b5aad4
  but has no handler. This batch must close that `verifyAndReportRpcRegistration` drift, and its
  verification must show that the drift is gone.
- **Verification round 1 (team-leader, 2026-10-05): NOT ACCEPTED. One fix is required, in Task 15.1.**
  - Scoped checks: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers --skip-nx-cache --parallel=1`
    passed with exit 0, including after the vscode-lm-tools edits that were in flight.
  - Carry-forwards verified on disk:
    - `provider:getPlanLimits` is in `METHODS`, and the manifest `provider` entry is `requires: []`.
    - `rpc-allowlist.spec` is green.
    - The ledger is activated through `PlanLimitsBroadcaster` in `activateSessionLifecycleNotifier`. The activation spec covers this, including the real `AgentProcessManager`.
    - Only read owners are read (`plan-limits-snapshot.service.ts:142-149`).
    - F71: the result carries owner refs only, and a failed read logs only the error name.
  - Deviations accepted:
    - (1) The snapshot service, with the RPC handler and the push as its two consumers.
    - (2) The push repeats the last request's full scope, without `refresh`.
    - (4) If activation fails, the error is logged and startup continues. The turn listeners still fail loudly.
  - **Deviation 3 rejected.** `provider:getAccountUsage` now reads through
    `PlanLimitsSnapshotService.ownerSnapshotForProvider`, which leads to `readOwner`
    (`plan-limits-snapshot.service.ts:155-186`). `readOwner` aborts the read after `LIMIT_LOOKUP_DEADLINE_MS` (3 s).
    - The Codex reader forwards that signal (`codex-plan-usage.reader.ts:57`) into `CodexAccountUsageService.performRead`.
    - The abort kills the `codex --version` / app-server read (`codex-account-usage.service.ts:272,315`), so the cache is never filled.
    - That service budgets `REQUEST_TIMEOUT_MS` = 10 s per step (`:19`), so cold starts are expected to take longer than 3 s.
    - Before this batch, the handler waited for the service's own bounds.
    - Result: when a cold Codex read takes 3-10 s, the dashboard card now shows "Account usage unavailable: service-unavailable"
      (`provider-account-card.component.ts:36`) on every attempt. This breaks Req 2.10 and the compatibility NFR.
  - **Fix:**
    - `provider:getAccountUsage` must read the selected owner without the 3 s per-owner abort.
    - Pass no deadline signal, so the reader's own bounds apply. One option is a `deadline: false` / unbounded variant of `readOwner` used only by `ownerSnapshotForProvider`.
    - Keep the 3 s deadline for `provider:getPlanLimits` and the push.
    - Add a spec: a Codex read that resolves after more than 3 s (fake timers) still returns `available`, with `quota.primary/secondary`, `account` and `activity`.
  - Not required: the case where the selected-provider discovery source times out and the method answers `provider-unsupported`. The Codex branch of that source is synchronous (`plan-limit-owner-discovery.service.ts:250-251`), so it does not affect Codex.
- **Verification round 2 (team-leader, 2026-10-05): ACCEPTED. Committed as a90f7594f.**
  - Fix verified on disk (`plan-limits-snapshot.service.ts:120-197`):
    - `readOwner` takes a `withDeadline` flag.
    - `assemble` passes `true`, so `provider:getPlanLimits` and the push keep the 3 s `AbortController` deadline.
    - `ownerSnapshotForProvider` passes `false`, which means no controller, no timer and no `signal` key.
  - Unsignalled-read side effect checked: it cannot leak or hang.
    - Every `CodexAccountUsageService` step has its own `REQUEST_TIMEOUT_MS` (10 s) timer: `readProcessOutput` `:255` and each RPC `request` `:319-321`. Both reject and clear their timers.
    - So a read with no signal always settles within the reader's own bounds.
    - The pinned shared flight (`plan-usage.service.ts:203-205`) is therefore bounded too.
  - New specs present:
    - `provider-rpc.handlers.spec.ts:498`: a 5 s cold start is still pending at 3.5 s, then returns `available` with no signal.
    - `plan-limits-snapshot.service.spec.ts:144`, the `read deadline` block: a provider lookup is not cut, while the snapshot and the push are cut at 3 s.
  - Checks:
    - `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers --skip-nx-cache --parallel=1` passed.
    - The host check `npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron ptah-cli` passed.
  - Staged by explicit path, `libs/backend/rpc-handlers/**` only (12 files). Nothing from vscode-lm-tools, chat-ui or .ptah/specs was staged.

### Task 15.1: Provider RPC handlers and schema — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\handlers\provider-rpc.handlers.ts` (+ spec), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\handlers\provider-rpc.schema.ts`
- Plan reference: Component 12 `:1094-1095`
- Quality requirements: `provider:getAccountUsage` keeps every field (Codex `quota.primary/secondary` populated); `provider:getPlanLimits` zod-validated, added to `METHODS`; 3 s per-owner deadline in parallel
- Validation notes: F71 — walk the serialized JSON for fake secrets (provider key, ptah-cli key, CSRF token); non-Codex provider no longer `provider-unsupported` when a reader exists; `rpc-allowlist.spec.ts` green
- **Binding (carried from Batch 13):** discovery returns `DiscoveredPlanOwner[]`. Read only
  `kind:'read'` entries via `PlanUsageService.getOwnerSnapshot` (3 s per-owner deadline); pass
  `kind:'known'` snapshots through unchanged and never read them. Spec: no reader call for a `known` entry.

### Task 15.2: `PlanLimitsBroadcaster` and activation — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\handlers\plan-limits-broadcaster.ts` (CREATE, + spec), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\register-shared-rpc-handlers.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\rpc-handlers\src\lib\handlers\index.ts`
- Plan reference: Component 12 `:1096-1101`
- Pattern to follow: `session-lifecycle-notifier.ts:43-80`; activation `register-shared-rpc-handlers.ts:49-80`
- Quality requirements: single 500 ms debounce timer; sync idempotent `dispose()`; broadcast failure debug-logged, not retried; no app file edits
- **Binding (carried from Batch 8): eager ledger activation.**
  - `activateSessionLifecycleNotifier` (`register-shared-rpc-handlers.ts`) must resolve
    `AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER` eagerly. It may do this directly or by resolving
    `PlanLimitsBroadcaster`, which injects the ledger.
  - That function is the shared startup hook on all three hosts: `apps/ptah-extension-vscode/src/di/phase-3-handlers.ts:93`,
    `apps/ptah-electron/src/activation/bootstrap.ts:415` and `libs/backend/cli-engine/src/lib/container.ts:840`.
    It runs after `registerSdkServices`, so the plan-limit registry, the probe and `STATE_STORAGE` are
    registered by then. No app edits are needed.
  - Verification must show that the ledger is constructed by activation on each host: a spec that
    calls `activateSessionLifecycleNotifier` and asserts the ledger singleton was constructed and
    subscribed, plus the Batch 15 host typecheck.
  - If this is not done, the ledger never subscribes, and native-session and proxy evidence is lost.

### Batch 15 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers`
- Host activation check (no app edits expected): `npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron ptah-cli`
- Phase 5 review requested on the combined diff of Batches 14-15

### Phase 5 review record — CLOSED

- Review: `phase-5-code-review.md` (CLI lane, code-logic + style), on `190954cbd..164848d93`
  (Batches 14-15, `libs/backend/rpc-handlers` + `libs/backend/vscode-lm-tools`, 23 files).
- Verdict history:
  - Round 0: **APPROVED 7/10**. 0 Blocking, 0 Serious, 2 Moderate, 3 Minor.
    - Moderate 1: an empty roster with the lookup wired appended a row-less `### Plan limits` table
      that design §5.1 does not specify (`mcp-response-formatter.ts` `formatAgentList`).
    - Moderate 2: `ptah_agent_list` called `agent.limits` outside any guard on both transports
      (`protocol-dispatcher.ts:1318`, `agent-tool.dispatcher.ts:714`), so Req 5.4/5.7 was not
      enforced on the list path. This closes the item recorded under Batch 14.
  - Fix round 1 (`phase-5-fix-report.md`): both Moderate items fixed. Moderate is fixed here, not
    deferred, because a list-tool failure would break every lane config that relies on the agent roster.
  - Re-review (scoped to the fix): **APPROVED 9/10**, no new findings.
- Fix commit **670c74a72** `fix(vscode-lm-tools): drop the empty plan-limits table and guard the agent
  list limit lookup`. 5 files, all under `libs/backend/vscode-lm-tools/src/lib/code-execution/`:
  `mcp-core/mcp-response-formatter.ts` (+ spec), `mcp-core/protocol-dispatcher.ts`,
  `mcp-stdio/agent-tool.dispatcher.ts`, `mcp-core/agent-spawn-limits.transport.spec.ts`.
  - Verified on disk (team-leader, 2026-10-05): `formatAgentList` returns the listed text plus the
    alternatives only when `agents.length === 0`. Both list call sites now go through
    `lookupAgentLimits(…, agents)`. The spawn path calls the same helper with no rows.
  - Scoped checks before commit: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=1`
    passed (all 3 targets).
  - Staged by explicit path. No chat-ui (Batch 19 in flight) and no `.ptah/specs` files were staged.
- **Named follow-up TASK-596-FU-PHASE5** (Minor items, recorded, not fixed):
  1. The P5 3 s bound covers only the lookup, not the `agent.list()` roster fetch the spawn path adds
     when `agent.limits` is wired (`protocol-dispatcher.ts:219-227`, `agent-tool.dispatcher.ts:243-250`).
     Either document the bound as "detection (first call only) + ≤3 s" or pass the caller's signal into
     `agent.list()` for the spawn path.
  2. Under a sustained ledger-change stream the broadcaster runs assembles and then discards them
     (`plan-limits-broadcaster.ts:84-99`). Fix: re-arm the 500 ms timer while an assemble is in
     flight, so only one runs at a time.
  3. `provider:getAccountUsage` answers `provider-unsupported` when the selected-provider discovery
     source times out or is dropped (`plan-limits-snapshot.service.ts:124-130`). This was already
     accepted as deviation 3 (no Codex impact). Fix: surface it as the retryable `service-unavailable`.
- **Backend Phases 1-5 are closed.** Every backend phase review has an accepting verdict on record.

---

## Phase 6 — Webview (Batches 16-21)

Phase review: code-logic plus style (new components/store), one CLI-lane review, **plus** visual-reviewer
(dark and light, 280/360/440 px) against the approved prototype as overridden by design §3.3 A1-A3.

## Batch 16: `PlanLimitsStore` and the Context rename commit — COMPLETE (commit c1ee76c22; Phase 6 review deferred to Batch 21)

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer (fresh instance)
- Execution mode: sequential
- Rationale: root store and its router registration; designated first frontend batch, so it also carries the uncommitted rename
- Tasks: 2 | Depends on: Batch 15 | Concurrent-safe with: Batch 17
- Phase: 6 | Phase review: deferred to Batch 21

### Task 16.1: `PlanLimitsStore` — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\core\src\lib\services\plan-limits.store.ts` (CREATE, + spec), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\core\src\index.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\apps\ptah-extension-webview\src\app\app.config.ts`
- Plan reference: Component 13 `:1122-1143`
- Pattern to follow: generation guard `provider-account-state.service.ts:27-43`; `MESSAGE_HANDLERS` `useExisting` at `app.config.ts:173-229`
- Quality requirements: one 30 s interval started on first `load`, cleared via `DestroyRef`; RPC failure → empty snapshot ("Usage / Unavailable", never 0); malformed push ignored and logged
- Validation notes: spec covers push replacement, generation guard, interval cleared on destroy; `load` accepts `ownerKeys`

### Task 16.2: Commit the "Context" rename — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.spec.ts`
- Plan reference: `implementation-plan.md:252-253`; context.md:138-139
- Validation notes: executor makes **no edit** here; verify the on-disk rename (labels + tooltip) and that the spec passes 11/11. Team-leader stages these two files with Batch 16

### Batch 16 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core @ptah-extension/chat-ui ptah-extension-webview`
- Result (team-leader, `--skip-nx-cache --parallel=1`): 9/9 targets passed. Report: `batch-16-report.md`.

### Batch 16 acceptance notes (two behaviours added beyond the plan, both accepted)

- **(a) Older snapshots ignored.** `apply()` (`plan-limits.store.ts:143-148`) compares `next.generatedAt < current.generatedAt`, both stamped by the host's
  `PlanLimitsSnapshotService.assemble()` (`plan-limits-snapshot.service.ts:144`, `Date.now()` at assembly). That is the producer's time, not arrival time.
  Equal stamps apply. The stamp is taken when assembly finishes, not when the reads start. Recorded for the Phase 6 review, no fix needed.
- **(b) Retained scope.** Each `load` overwrites only the fields it names (`definedFields`). Host discovery sources are a union
  (`plan-limit-owner-discovery.service.ts:175-206`), so a kept `providerId` only adds the selected-provider owner. It never filters chat owners. Ledger-known
  sessions are always returned (`plan-limits-snapshot.service.ts:216-225`). `sessionIds` and `ownerKeys` are replaced, never accumulated, and `[]` clears them.
  They go stale only if no later load names them. Batch 20 carries the obligation below. The zod `max(PLAN_LIMITS_MAX_IDS)` cannot be crossed by
  accumulation. The store holds no expansion state, so A3 (Batch 18.2) is unaffected.
- **Residual for the Phase 6 review (Moderate, not fixed):** `applyEmpty()` on a failed pull bypasses the `generatedAt` guard. It replaces a good pushed
  snapshot with an empty one stamped with the webview's `Date.now()`, so a push assembled just before the failure is dropped as older. The next successful
  load or push recovers. The plan requires that a failure gives an empty snapshot.

## Batch 17: Lane run accounting in `AgentMonitorStore` — COMPLETE (commit a9ab741fc; Phase 6 review deferred to Batch 21)

- Carry-forwards from Batch 16 (c1ee76c22):
  - The Context rename is committed. Do not touch `session-stats-summary.component.*`.
  - `PlanLimitsStore` is exported from `@ptah-extension/core`. Batch 17 does not consume it, and `chat-streaming` must not import it.
  - Unknown is never 0. A restored run has `usageTotals: null`, not a zeroed total.
  - R5: touch only `MonitoredAgent` (`:86-161`), the fold, `capSegments` (`:839-867`) and the restore path. Task 597 also edits `MonitoredAgent`.
  - `quotaOwner` keeps the G3 `QuotaOwnerRef` shape, not a key string. Batch 20 derives `ownerKeys` from `quotaOwner.key`.
  - No settings paths, no zod, and chat-streaming may import from shared only.
- Concurrency: file-disjoint from Batch 21 (dashboard), which may run at the same time. Batch 18 waits for this batch.

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer (fresh instance)
- Execution mode: sequential
- Rationale: single store file plus specs
- Tasks: 1 | Depends on: Batch 2 (`addCliUsage`), Batch 1 (fields) | Concurrent-safe with: Batch 16
- Phase: 6 | Phase review: deferred to Batch 21

### Task 17.1: Fold usage before the segment cap; carry lane quota fields — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-streaming\src\lib\agent-monitor.store.ts` (+ spec, + `agent-monitor.retention.spec.ts`)
- Plan reference: Component 14 `:1145-1161`; G3
- Pattern to follow: `MonitoredAgent` `agent-monitor.store.ts:86-161`; `capSegments` `:839-867`
- Quality requirements: `usageTotals` folded with `addCliUsage` **before** `capSegments`; restored runs `usageTotals:null`
- Validation notes: add `usageTotals`, `role?`, `failureKind?`, `quotaOwner?` (G3 shape, not a key); copy `ref.quotaOwner` on restore (may be absent); >600 segments with usage sum exactly; touch only these regions (597 edits `MonitoredAgent` too, R5)

### Batch 17 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-streaming`

### Batch 17 verification record (team-leader, Mode 2)

- Verified on disk: `agent-monitor.store.ts` (fold over raw `delta.segments` before the text merge and
  `capSegments`; `usageTotals:null` at fresh, replacement and restore; `quotaOwner: ref.quotaOwner` on
  restore), `agent-monitor.store.spec.ts` (6 cases), `agent-monitor.retention.spec.ts` (800-segment exact
  total; no-usage stays `null`). R5 held: hunks only in the `MonitoredAgent` tail, the three spawn sites,
  the output fold, exit and restore; `capSegments` unchanged; no 597 behaviour; no `PlanLimitsStore` import.
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-streaming @ptah-extension/chat
  @ptah-extension/tribunal-panel --skip-nx-cache --parallel=1`: 9/9 targets passed (the two consumer libs
  were not run by the executor; they pass). Dashboard files (Batch 21, in progress) were not staged.
- Rulings:
  - (a) `usageTotals?: CliUsageTotals | null` (optional, plan said required) — **accepted**. A required
    field would break `MonitoredAgent` literals in 10 spec files of chat and tribunal-panel outside this
    batch; every store writer sets it explicitly.
  - (b) A same-id re-open of a card rebuilt by `loadCliSessions` (e.g. webview reload while the backend
    still tracks the run, then `continue`) folds the new turn onto `null` and shows a partial total as
    known — **Minor, recorded for the Phase 6 review, not fixed**. Backend resumes use a new `agentId`
    (replacement card with `usageTotals:null`).
  - (c) `failureKind` not carried forward — **no loss, accepted**. Every `agent:exited` payload is the
    backend's full `tracked.info` (`agent-process-manager.service.ts:1761-1767, 1381-1396, 1783-1795`);
    `handleExit` is guarded by `hasExited`, the stop path emits nothing for a non-running run (`:1370-1372`),
    and the delayed exit emit re-sends the same `tracked.info`. A quota classification is only replaced by
    a new turn (`continue` resets `hasExited`, `:1282`), which is a new attempt and should clear it. Restored
    cards never had `failureKind` (`CliSessionReference` does not carry it) — plan scope, not a regression.
- **Binding carry-forward for Batches 18-20:** treat `usageTotals === null` and `usageTotals === undefined`
  alike as "unknown" (use `== null`), never 0. A non-null total can still carry `undefined` token, cost or
  model fields; each of those also reads "unknown". Batch 20 derives `ownerKeys` from
  `agent.quotaOwner?.key`; a run with no owner contributes no key and renders as an unknown owner, never
  the current one. Specs in 18/19 must cover both `null` and absent `usageTotals`.

## Batch 18: Stats limit view model and expansion state — COMPLETE (commit 0099a3c58; Phase 6 review deferred to Batch 21)

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer (fresh instance)
- Execution mode: sequential
- Rationale: pure view model plus view-scoped state; carries the A1-A3 logic
- Tasks: 2 | Depends on: Batches 16, 17
- Phase: 6 | Phase review: deferred to Batch 21

### Task 18.1: `stats-limit-view-model.ts` — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\stats-limit-view-model.ts` (CREATE, + spec), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\index.ts`
- Plan reference: Component 15 `:1167-1177`; design-spec.md §3, §3.3 A1, A2
- Quality requirements: pure, `now` parameter; unknown never 0; lane usage never enters session totals (Req 8.5)
- Validation notes: F53, F54, F56, F58, F59, F60; frontend F55 legs — restored run with `quotaOwner` A vs session B → "Different owner"; absent/invalid → "Limit unknown · owner not recorded", never current owner; subgroups by owner key + model scope; "see plan tiles" only when the same window is rendered (A2)
- **Binding (carried from Batch 13):** a ledger-only snapshot arrives as `status:'service-unavailable'`
  with no `unavailableReason`. Show it by owner comparison (a past or other owner's last-known
  evidence), never as a live read failure or error state. `service-unavailable` +
  `no-open-session` means a Claude owner with no open session. Spec covers both. If the Phase 4
  review adds a dedicated status or reason in `@ptah-extension/shared`, use it instead.
- **Confirmed at Phase 4 close (Ruling 2, fix 190954cbd):** no dedicated status was added; the overload
  stands and this comparison is mandatory. Since the fix, a ledger-only Claude *account* owner also
  carries `no-open-session`, so `no-open-session` alone no longer proves a live owner — the owner
  comparison decides; and a ledger-only Anthropic `credential` owner arrives as `unsupported-auth` with
  no windows (render it as unsupported, not as a past owner's windows). Specs cover all three shapes.

### Task 18.2: `StatsTileExpansionState` — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\stats-tile-expansion.state.ts` (CREATE, + spec)
- Plan reference: Component 15 `:1178-1185`; A3
- Quality requirements: not `providedIn: 'root'`; keyed `${sessionId}::${tileId}`; no cap, no eviction; never reset by refresh/push/re-render
- Validation notes: F57 (state level), F73

### Batch 18 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui`
- Verification (team-leader, Mode 2): ACCEPTED. `nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui
  --skip-nx-cache --parallel=1` passed 3/3. The commit holds 8 chat-ui files only. The new files import only
  `@ptah-extension/shared` and `@angular/core`; no orchestrator lib is imported.
- **Deviation 1, accepted (max-lines):** the view model is split into four files in `plan-limits/`:
  `stats-limit-view-model.ts` (63 lines, the entry point), `.types.ts` (221), `plan-limit-tiles.ts` (493) and
  `lane-tiles.ts` (612). All are under the 700-line rule.
- **Deviation 2, accepted (plan `:1172` reading):** a lane's own owner can be known while the session owner is
  unresolved, or while the two owners cannot be compared. In that case `ownerRelation` gives `unknown`.
  The subgroup (`lane-tiles.ts:209-266`) is labelled "Unknown owner" and reads "this session's account is not
  resolved; showing <owner> only". It gets no "see plan tiles" chips, because `same` is false. It is evaluated only
  against the snapshot keyed by its own recorded owner, so nothing is borrowed.
  - This matches A1 ("Unknown owner" when either side is unknown) and R7 (never borrow, never substitute the
    current owner).
  - The text "quota owner cannot be determined" in `:1172` and design §3.3 describes a lane whose own account
    cannot be determined (example: the Claude research lane). That case (`identityKind:'unknown'`,
    `:186-206`) and an unrecorded owner both read "Limit unknown" with no windows.
  - The strict reading would hide valid evidence about the lane's own account, so it is not required.
  - Flagged for the Phase 6 review.
- Phase 4 carry-forward: all three cases have specs (`stats-limit-view-model.spec.ts:603-669`), and none
  renders as a failure.
  - (i) `service-unavailable` with no reason gives an info note "No current read … last-known evidence". The
    windows stay and the lane tone is neutral.
  - (ii) `no-open-session` gives the info note only.
  - (iii) `unsupported-auth` gives a neutral "not reported for this sign-in method" with no windows.
- Other checks:
  - A null or absent `usageTotals` reads unknown, never 0 (spec `it.each`).
  - The time zone is passed explicitly (`time` input; UTC and `Europe/Berlin` specs).
  - A3 is keyed `${sessionId}::${tileId}`, with `@Injectable()` and no root provider. F57 and F73 have specs.
  - Cooldown tiles carry no source chip, because `PlanLimitCooldown` has no source field. Recorded for Phase 6.
  - `ownerStatusNote` has a `default` branch over snapshot status that falls back to "Usage unavailable · <status>".
    Minor, recorded.
- **Binding carry-forward to Batch 20 (Task 20.1):** map each `MonitoredAgent` run of the session to
  `StatsLimitLaneRun` explicitly. Do not guess any field.
  - `restored`: the store has no flag for it. Derive it from the restore path: cards built by `loadCliSessions`
    from `CliSessionReference` are `true`, and live-spawned cards are `false`. Add the flag where the card is
    created, or keep a set of restored ids. Never infer it from status. A spec covers a restored run and a live
    run.
  - `cliLabel`: the existing display name of the CLI used by the agent card. Do not derive it from the id
    string.
  - `modelScope`: no model-to-family resolver exists on the frontend or in `@ptah-extension/shared`. Model
    scope is resolved in the backend (`lane-limit-lookup.service.ts`, the `claude-rate-limit.mapper.ts` family).
    Pass the scope only when the run record carries a backend-resolved scope. Otherwise pass `null`, which
    yields `model-scope-unknown` (info) when the owner has model-scoped limits.
  - `sessionModelScope` follows the same rule. Do not apply string matching on the model id in the UI.
  - `quotaOwner`: the recorded `agent.quotaOwner`. Absent stays absent and reads "owner not recorded".
  - `usageTotals`: passed through as is, null or absent.
  - `owners`: the `PlanLimitsStore` snapshot owners. `sessionOwnerKey`: `snapshot.sessionOwners[sessionId] ?? null`.
  - `now`: comes from the existing tick. Add no new timer.
  - `time`: an explicit zone and locale.
  - F58 at store level: pass only the runs from `agentsForSession(sessionId)`.

## Batch 19: Stats tiles and stats summary integration — COMPLETE (commit f6189781d; Phase 6 review deferred to Batch 21)

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer (fresh instance)
- Execution mode: sequential
- Rationale: four presentational components plus their host in one lib
- Tasks: 2 | Depends on: Batch 18
- Phase: 6 | Phase review: deferred to Batch 21

### Task 19.1: Tile and alert components — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\plan-limit-tile.component.ts` (CREATE, + spec), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\lane-usage-tile.component.ts` (CREATE, + spec), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\lane-subtotal-tile.component.ts` (CREATE), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\limits-alert.component.ts` (CREATE)
- Plan reference: Component 15 `:1186-1188`; design-spec.md §3.1-3.3, §8
- Quality requirements: standalone, OnPush, signal inputs; `<button type="button" aria-expanded aria-controls>` with panel as next sibling; `role="status"` alert; `role="meter"` bars; 2px info focus ring; Enter/Space toggle; `text-base-content/70` secondary text; no semantic colour as text colour; tiles start closed; dashed lane border and "lane · not in totals" caption

### Task 19.2: `SessionStatsSummaryComponent` inputs and slots — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.ts` (+ spec)
- Depends on: Task 19.1 and Batch 16 commit (the rename is already committed; build on it)
- Plan reference: Component 15 `:1189-1194`
- Quality requirements: inputs `limits` and `sessionId` default `null`; with `limits` null the output equals today's (harness-builder host unaffected); alert above the strip (variant A); "LANES n" pill after Cost; tiles appended after existing cards; no `grid-auto-flow: dense`; inject `StatsTileExpansionState` `{optional:true}` else local instance; keep "Context"
- Validation notes: existing 11 spec cases green; new: tile toggling, an open tile survives a re-render and a `limits` push (F57 component level)

### Batch 19 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui`
- Verification (team-leader, Mode 2): ACCEPTED. `nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui
  ptah-extension-webview --skip-nx-cache --parallel=1` passed 6/6, and the no-alpha guard is green. The commit holds
  10 files, all under chat-ui `molecules/session/**`. `.ptah/specs` was not staged.
- `max-lines` warning on `session-stats-summary.component.ts`: it predates this batch. At HEAD the file had 874 raw
  lines and 758 lines that are neither blank nor comments, above the 700 limit. The rule is warn-level. Splitting
  the per-model table is a named later item.
- Checks against the files on disk:
  - The tile face is a `<button type="button">` with `aria-expanded` and `aria-controls`. The panel is its
    `nextElementSibling`, with `[hidden]` while closed.
  - Panel ids are unique across the document. Enter and Space work through the native button.
  - Expansion state is signal-backed (`StatsTileExpansionState.isOpen` reads a signal), so OnPush hosts update.
  - Req 8: lane totals never enter the Tokens or Cost cards (spec `:528`). The face carries three cues: the
    caption "lane · not in totals", a dashed border with `bg-base-300/40`, and the subtotal tile.
  - Harness-builder host (no `limits`): every new markup block sits behind `@if (limits())` or
    `@if (lanesCount())`. The spec checks that collapsed `innerHTML` is the same with the inputs unset or null,
    and that the expanded order is unchanged.
- **Deviation 1, accepted:** two internal helpers, `plan-window-detail.component.ts` and `stats-tile.styles.ts`.
  Neither is exported from the barrel. They remove three copies of the meter and tone-map markup.
- **Deviation 2, accepted:** the subtotal tile is not expandable. This matches the prototype
  (`prototype/index.html:93` `.tile.sub{cursor:default}`) and design §3.3 cue 3, where everything is on the face.
  The plan's `lanes-subtotal` id stays unused.
- **Deviation 3, accepted (visual review to confirm):** the tiles come after every session card but before the
  "Collapse stats" button card. Design §3.2 lists the order up to the subtotal and is silent about the collapse
  control. Keeping it last matches today's behaviour.
- **Deviation 4, carried to the Phase 6 visual review:** the design asks for `text-base-content/70` and `/80`;
  the batch uses `text-base-content-muted` and `text-base-content`, as the guard requires. Check light-theme
  contrast of the muted text on `bg-base-200/50` and on the lane fill `bg-base-300/40`. This is the same concern
  as Batch 21 (4.46:1).
- **Item 5 (alert time text): no defect in Batch 18.** The view model formats with the `time` it is given. "UTC"
  shows only because the specs inject `timeZone:'UTC'`; the code has no UTC default (grep finds no `UTC` or
  `timeZone` outside the specs). T1 requires the local zone plus its abbreviation ("today 15:10 CEST", plan
  `:539`). That supersedes the bare "resets 15:10" example in design §3.1.
  - **Binding carry-forward to Batch 20 (Task 20.1):** pass
    `time = {timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, zoneNameLocale: inject(LOCALE_ID)}`,
    the same pattern as Batch 21 `:342`. Never hard-code `'UTC'`.
  - If the chat view shows UTC on a non-UTC machine, that is a Phase 6 fix-round item in `chat-view.component.ts`.
- Recorded, Minor: `lanesTooltip` text is set as the `title` only. The pill has no `aria-label`. The design asks
  for a title only.

## Batch 20: Chat-view wiring and agent-card fold delegation — COMPLETE (commit 46ba54af7; Phase 6 review now due)

- Verification (team-leader, Mode 2): ACCEPTED. `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat @ptah-extension/chat-streaming ptah-extension-webview --skip-nx-cache --parallel=1` passed 9/9. R5 holds: chat-view edits are limited to imports, the module-level mapper, `providers`, the view-model region after `resolvedCompactionCount`, one constructor effect (`:1060-1069`) and the host binding. `stats-bar.utils.ts` is a pure delegation and its spec is unchanged. No 597 behaviour and no settings path. The commit holds 6 files; `.ptah/specs` is not staged.
- Rulings on the deviations:
  1. **Accepted.** The two `chat-streaming` files outside the list (`agent-monitor.store.ts:184-189` adds `restored?`; `:1206` sets `restored: true` in `loadCliSessions` only) are the only place a restore flag can be set from the creation site, as Batch 18 requires. Both regions are R5-allowed from Batch 17, and a store spec case covers them.
  2. **Accepted, with a gap recorded for Phase 6.** The session scope comes from `PlanLimitSessionOwner.modelScope`.
     - Its contract is `libs/shared/src/lib/types/plan-limit.types.ts:163`.
     - It is populated by `plan-limit-ledger.service.ts:409-411`, which calls `setSessionOwner(sessionId, owner, lastScope)` after each successful turn, using `turnScopes` from `stream-transformer.ts:457, 592`.
     - It is emitted by `plan-limit-ledger.service.ts:330-339`.
     - It is `null` before the session's first successful turn in this host process, which includes a restored session with no new turn. The snapshot service also seeds unseen sessions as null (`plan-limits-snapshot.service.ts:222`).
     - So the scope is not always null. The `model-scope-unknown` note shows only in that window, and only for owners with model-scoped windows (`lane-state.ts:149-150`). That is honest "unknown" behaviour and is preferable to UI string matching.
     - Lane runs always get `modelScope: null` (`chat-view.component.ts:103`). A lane on an owner with `weekly_model:*` windows will therefore always show the info note. This is a Moderate review item, not a fix: the run record carries no backend-resolved scope.
  3. **Accepted.** The load also fires when the recorded owner set changes (`chat-view.component.ts:869-872, 1060-1069`). Without this, restored runs never get their owners. Structural `equal` stops streaming deltas from re-triggering it.
  4. **Grid-mode scope collision: Serious, a binding Phase 6 fix-round item.**
     - `PlanLimitsStore.load` replaces `sessionIds` and `ownerKeys` with the last caller's values (`libs/frontend/core/src/lib/services/plan-limits.store.ts:78, 98-101`). The host push then repeats only the last request (`plan-limits-snapshot.service.ts:81-82, 102-108`). Every `ChatViewComponent` calls `load` (`chat-view.component.ts:1064`), including a pane or main panel with no session, which sends `[]`.
     - The result: with two visible panes, pane A loses its requested session entry and its run owner keys. A restored session with no turn in this process then shows owner "not resolved", and a lane whose owner is only ledger-known shows as unavailable. Which pane loses depends on load order.
     - Required fix, in the store, not in chat-view: per-surface scope registration in `PlanLimitsStore`, for example `register(token, scope)` and `release(token)` released through `DestroyRef`. Each `load` sends the union of every registered surface's `sessionIds` and `ownerKeys`, plus the latest `providerId`. Chat-view keeps its effect but registers under a per-instance token. A spec must cover two surfaces with disjoint sessions: both stay in the request after either reloads, and one is dropped after it is destroyed.
- Minor, recorded only: an unattributed run (whose `parentSessionId` has not resolved) briefly shows in every session's lane tiles through `agentVisibleInSession`. `chat-view.component.ts` is past the warn-level `max-lines` limit, with 121 more lines than before.

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer (fresh instance)
- Execution mode: sequential
- Rationale: the chat lib host plus the one-line usage delegation in the same lib
- Tasks: 2 | Depends on: Batch 19
- Phase: 6 | Phase review: deferred to Batch 21

### Task 20.1: Chat-view builds `limits` — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`, `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat\src\lib\components\templates\chat-view.component.html`
- Plan reference: Component 15 `:1195-1198`
- Pattern to follow: host binding `chat-view.component.html:27-31`; view models `chat-view.component.ts:773-792`
- Quality requirements: `providers: [StatsTileExpansionState]` on `ChatViewComponent`; `planLimits.load({sessionIds:[id], ownerKeys})` on session change, with `ownerKeys` from the session's runs' recorded `quotaOwner.key`; model scope from `resolvedLiveModelStats().model`; no new timers; no settings files
- **Carry-forward from Batch 16 (retained scope):** `PlanLimitsStore.load` keeps any field a call leaves out. On every session change, including when the
  session closes and when no session is open, pass both `sessionIds` and `ownerKeys`, using `[]` when there are none. Never omit them, or a closed
  session's ids stay in the host's push scope. A spec must cover the transition from session A to no session, sending `sessionIds: []`.

### Task 20.2: `extractCliAgentStats` delegates to `addCliUsage` — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat\src\lib\components\molecules\agent-card\stats-bar.utils.ts`
- Plan reference: Component 3 `:568, 577`; 597 seam `:1345-1349`
- Quality requirements: behaviour preserved; the existing `stats-bar.utils` spec passes **unchanged**

### Batch 20 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat`

## Batch 21: Dashboard provider account card — COMPLETE (commit b1d53356f; Phase 6 fix e61eaeeec, harness f077277fd; reviews phase-6-code-review.md APPROVED 8/10, visual-review.md APPROVED 8/10)

- Verification attempt 2 (team-leader, Mode 2, fix round 1): ACCEPTED. The seven text classes at `provider-account-card.component.ts:148, 175, 238, 251, 260, 279, 326` are now `text-base-content-muted`. No `text-base-content/NN` remains. The only remaining alpha classes are border and background classes, which the guard allows. The file is still 657 lines, and no guard exception was added. `nx run-many -t typecheck,test,lint -p @ptah-extension/dashboard ptah-extension-webview --skip-nx-cache --parallel=1` passed 6/6. `grep -rn ProviderAccountStateService libs apps` is empty. The commit includes both deletions.
- **Carry to the Phase 6 visual review:** check light-theme contrast of the card's secondary text (`text-base-content-muted` on base-200). design-spec §8 measured it at 4.46:1, below 4.5:1. That deviation was forced by the `no-alpha-base-content.spec.ts:198` guard.

- Verification attempt 1 (team-leader, Mode 2): NOT ACCEPTED. `nx run-many -t typecheck,test,lint -p @ptah-extension/dashboard ptah-extension-webview --skip-nx-cache`: dashboard typecheck, test and lint pass; webview typecheck and lint pass; **`ptah-extension-webview:test` fails** in the `apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts:198` ratchet. It flags `text-base-content/70` x5 and `text-base-content/80` x2 in `provider-account-card.component.ts` at lines 148, 175, 238, 251, 260, 279 and 326. Fix: use the registered `text-base-content-muted` token (as the kept Activity disclaimer at `:303` already does). Do not add a guard exception. The rest was verified on disk: the parity inventory against the `HEAD` service and card (rows 1-8 kept; row 9 "no blank on switch" is acceptable because every section carries its owner label; rows 10-11 are plan removals under Component 16); the four new status sentences follow the prototype's tone (`prototype/index.html:281-282`) and contain no brand names or secrets; the glyphs are the design §4 text glyphs and are `aria-hidden`, not icons; 657 lines is under `max-lines` 700 (warn, blank and comment lines skipped); session and lane owners follow per the plan; `grep -rn ProviderAccountStateService libs apps` is empty.

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer (fresh instance)
- Execution mode: sequential
- Rationale: rewrite plus deletion in one lib
- Tasks: 1 | Depends on: Batch 16 | Concurrent-safe with: Batches 17-20
- Phase: 6 | Phase review: **due after the last of Batches 16-21 commits** — code-logic + style (CLI lane) and visual-reviewer

### Task 21.1: Card for every owner; delete the Codex-only state service — COMPLETE

- Files: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\dashboard\src\lib\components\provider-account-card\provider-account-card.component.ts` (REWRITE, + spec), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\dashboard\src\lib\services\provider-account-state.service.ts` (DELETE), `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\dashboard\src\index.ts`
- Plan reference: Component 16 `:1226-1245`; design-spec.md §4
- Quality requirements: one `<section>` per owner, selected provider first; selection from `AuthStateService.persistedProviderId()` (`libs/frontend/core/src/lib/services/auth-state.service.ts:310`) with an effect calling `load({providerId})`; Refresh → `load({providerId, refresh:true})`; Codex Activity block unchanged; empty snapshot → "Account usage unavailable"; `Used: unknown` never 0
- Validation notes: F61 (16 design states). Only consumers of the deleted service are the card, its spec and the dashboard barrel (verified by grep)

### Batch 21 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/dashboard`
- `grep -rn ProviderAccountStateService libs apps` returns nothing

### Phase 6 review record (Batches 16-21, range c1ee76c22^..46ba54af7)

- Verdict history, code review (`phase-6-code-review.md`, codex CLI lane):
  1. REVISE 4/10. Findings: 1 Serious grid-pane scope collision (`plan-limits.store.ts`); 2 Serious failed pull
     erases a newer pushed snapshot (`applyEmpty` bypasses the `generatedAt` guard); 3 Serious unresolved lane
     shown in every session's tiles; 4 Moderate lane model scope always unknown.
  2. Fix round 1 (`phase-6-grid-scope-fix-report.md`): REVISE 6/10. Findings 1 and 3 resolved (per-surface
     registration released by `DestroyRef` with a unioned request; exact-parent accessor
     `AgentMonitorStore.agentsOwnedBySession`). Finding 2 now retains held data, but raised a new Moderate: the
     failed refresh was silent (`loadError` not read by any surface).
  3. Bounded correction (`phase-6-load-error-report.md`): APPROVED 8/10. A neutral `role="status"`
     "refresh failed, showing last observed data" notice in the chat strip and the dashboard card; `apply()`
     clears the error; the empty first-read placeholder is stamped `generatedAt: 0`.
  4. Visual fix round (`phase-6-visual-fix-report.md`): APPROVED 8/10, no findings.
  Finding 4 was left as a named follow-up (below), within the fix-round rule (Moderate, cannot break a lane
  config or lose data).
- Verdict history, visual review (`visual-review.md`, visual-reviewer sub-agent, harness scenario
  `plan-limits-visual`, 280/360/440 px, `anubis` and `anubis-light`, `visual-harness-report.md`):
  1. REVISE 7/10. Visual breaking: dashboard status chip overlaps the owner title at 280 px. Serious: light-theme
     tile focus ring under 3:1. Moderate: 3, 4, 5, 6. Minor: 7 (existing), 8 (= code finding 4), 9.
  2. Re-check after the visual fix round: APPROVED 8/10. Finding 1 fixed (header wraps, chip `whitespace-nowrap`),
     finding 2 fixed (`outline-base-content`, about 14.7:1 light), finding 5 fixed (restored lane face reads
     "Ptah CLI" with "Last known · Weekly 60% used" from its own recorded owner only).
- Verification (team-leader, Mode 2 step 6): `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core
  @ptah-extension/chat @ptah-extension/chat-streaming @ptah-extension/chat-ui @ptah-extension/dashboard
  ptah-extension-webview @ptah-extension/webview-e2e-harness --skip-nx-cache --parallel=1`: all 7 projects passed
  (exit 0, 2m 53s). `git status`: no settings path and no other harness scenario changed. No new TODO, PLACEHOLDER
  or STUB marker in the diff (the one `TODO` in `agent-monitor.store.ts:47` predates this task). Screenshots
  stay under `.ptah/specs/.../screenshots/` and were not staged.
- Commits:
  - `e61eaeeec` fix(webview): isolate plan-limit scopes per surface, keep held data on failed refresh and fix
    tile focus and lane labels — 17 files in core, chat, chat-streaming, chat-ui and dashboard.
  - `f077277fd` test(webview-e2e-harness): add plan-limits visual capture scenario — 2 new files in
    `libs/frontend/webview-e2e-harness/src/lib/scenarios/plan-limits/` only.
- Batch 20 Minor (unattributed run shown in every session) is resolved by code finding 3.

#### Named follow-up TASK-596-FU-PHASE6 (not fixed in this task)

- Code review finding 4 (Moderate): lane runs carry no backend-resolved model scope (`chat-view.component.ts`
  `toStatsLimitLaneRun` sends `modelScope: null`), so a lane on an owner with `weekly_model:*` windows always
  shows `model-scope-unknown`. Fix: persist the backend-resolved scope on the run record and pass it; never infer
  it from the display model string. Spec: an Opus lane in a Sonnet session evaluates the model window once the
  scope arrives. (Also visual finding 8.)
- Visual finding 3 (Moderate): an opened plan tile repeats its own face in the panel (label, value, reset, chips);
  the panel adds only the bar.
- Visual finding 4 (Moderate): two owners in the dashboard card are both headed "Claude account" /
  "Subscription quota". **Needs a user design decision under G3** (which owner identity may be shown) before any
  code change.
- Visual finding 6 (Moderate): at 280 px tile captions wrap to 3-4 lines and reset lines to 4-5; consider a
  short caption (for example "Claude plan").
- Visual finding 7 (Minor, pre-existing): light-theme Model `text-purple-400` (1.86:1) and Context
  `text-cyan-400` (1.34-1.57:1), and dark-theme Cost `badge-success` (2.64:1), fail contrast in the existing
  cards.
- Visual finding 9 (Minor): the opened tile/panel squared-corner join is not visible in `anubis-light`.
- Visual re-check note: the focus-ring fix is confirmed by source and computed contrast only; the probe crops
  clip the 2 px offset ring. Take one padded screenshot of a focused tile in `anubis-light`.
- Batch 17 Minor (ruling b): a same-id re-open of a card rebuilt by `loadCliSessions` folds the new turn onto
  `null` and shows a partial total as known.
- Batch 18 Minors: cooldown tiles carry no source chip (`PlanLimitCooldown` has no source field);
  `ownerStatusNote` falls back to "Usage unavailable · <status>" through a `default` branch; Deviation 2 (lane
  owner known while the session owner is unresolved renders "Unknown owner" with the lane's own evidence) stays
  as accepted, no reviewer objected.
- Batch 19 Minors: the "LANES n" pill has `title` only, no `aria-label`; `session-stats-summary.component.ts` is
  over the warn-level `max-lines` (split the per-model table).
- Batch 20 Minor: `chat-view.component.ts` is over the warn-level `max-lines`.

---

## Phase 7 — Fixture sweep (Batch 22)

Phase review: none (tests and test report only).

## Batch 22: Fixture coverage sweep F1-F83 plus G-amendment fixtures — COMPLETE (commit dd500c95a; Phase 7 review: none — tests only)

- Verification (team-leader, Mode 2): ACCEPTED. `git status` / `git diff --stat`: exactly 6 modified `*.spec.ts`
  files (+220/-0), no production file, no settings path, no 597-deferred file; no `.only`, `.skip`, `xit`,
  `TODO` or `PLACEHOLDER` in the added lines. Files: `libs/shared/src/lib/utils/plan-limits/instants.spec.ts`
  (F10), `libs/backend/auth-providers/src/lib/quota/plan-limit-ledger.service.spec.ts` (F23, F67, F68),
  `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.spec.ts` (F42-F44, F47,
  F51), `.../mcp-core/agent-spawn-limits.transport.spec.ts` (F52 on both transports),
  `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.spec.ts` (F59 Cost),
  `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.spec.ts`
  (F61 case 16c).
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/auth-providers
  @ptah-extension/vscode-lm-tools @ptah-extension/chat-ui @ptah-extension/dashboard --skip-nx-cache
  --parallel=1`: 14 of 15 tasks pass. The one failed task is `@ptah-extension/auth-providers:test`: 4 failed /
  1527 passed, all 4 in `translation-proxy.sdk.integration.spec.ts` S1-S4 with `EPERM, Permission denied`
  on the Windows temp-dir `removeTree` teardown — the recorded known environment item, not a new failure.
- Test report: `test-report.md` (fixture map F1-F83, F13a, F67b, G3 restart). No defects; residual risks F55
  (no single chained test) and F80 (no credit-provider proxy case) recorded below.

- Recommended executor: senior-tester
- Fallback executor: backend-developer (tests only)
- Execution mode: sequential
- Rationale: one owner audits fixture coverage across all libs and fills gaps with specs only
- Tasks: 2 | Depends on: Batches 1-21
- Phase: 7 | Phase review: none — tests only

### Task 22.1: Coverage map and gap specs — COMPLETE

- Files: spec files only, beside the components listed above (no production edits); `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\.ptah\specs\TASK_2026_596_0a19\test-report.md` (CREATE)
- Plan reference: "Test fixtures" `:1364-1484`; G2 (F55/F77 per-turn path), G3 (restart fixture)
- Quality requirements: every fixture F1-F83 (incl. F13a, F67b) and the G3 restart fixture mapped to `spec file:line`; missing ones added; no live call, no forced 429, no rollout read
- Validation notes: any fixture that cannot pass without a production change is reported as a defect, not patched

### Task 22.2: Full verification run — COMPLETE

- Depends on: Task 22.1
- Quality requirements: record tailed results in test-report.md

### Batch 22 verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/agent-sdk @ptah-extension/auth-providers @ptah-extension/auth-providers-tokens @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers @ptah-extension/core @ptah-extension/chat-streaming @ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/dashboard`
- `npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron ptah-cli ptah-extension-webview`
- Guard specs green: `vendor-roster-drift.spec.ts`, `lane-rule-single-home.spec.ts`, `agent-spawn-surface-parity.spec.ts`, `rpc-allowlist.spec.ts`, `session-stats-summary.component.spec.ts`

---

## Dependency summary

| Batch | Depends on | Concurrent-safe with | Phase |
| --- | --- | --- | --- |
| 1 | — | — | 1 |
| 2 | 1 | — | 1 |
| 3 | 2 | — | 1 (review) |
| 4 | 3 | — | 2 |
| 5 | 4 | — | 2 (review) |
| 6 | 5 | — | 3 |
| 7 | 6 | — | 3 |
| 8 | 7 | — | 3 |
| 9 | 8 | — | 3 |
| 10 | 9 | 11 | 3 (review) |
| 11 | 9 | 10 | 4 |
| 12 | 11 | — | 4 |
| 13 | 10, 12 | — | 4 (review) |
| 14 | 13 | 15 | 5 |
| 15 | 13 | 14 | 5 (review) |
| 16 | 15 | 17 | 6 |
| 17 | 1, 2 | 16, 21 | 6 |
| 18 | 16, 17 | 21 | 6 |
| 19 | 18 | 21 | 6 |
| 20 | 19 | 21 | 6 |
| 21 | 16 | 17-20 | 6 (review + visual) |
| 22 | 1-21 | — | 7 (no review) |

Note on Phase 6 timing: Batch 17 depends only on Batches 1-2, but runs in Phase 6 so the webview diff stays
one review unit.

---

## Completion summary (team-leader, Mode 3, 2026-10-05) — TASK COMPLETE

Branch `feat/task-596-quota-resets`, base `5bb19f9fb`. 22 of 22 batches and 53 of 53 tasks COMPLETE.
`git log --oneline 5bb19f9fb..HEAD | wc -l` = **29** (22 batch commits, 6 phase fix commits, 1 harness
commit). Each of the 29 SHAs below was checked with `git merge-base --is-ancestor` against both `5bb19f9fb`
and `HEAD`: 29/29 are on the branch. `git status` after the Batch 22 commit is clean except the untracked
`.ptah/specs/TASK_2026_596_0a19/`. Nothing was pushed.

### Batches and commits

| Batch | Name | Commit | Fix / extra commits |
| --- | --- | --- | --- |
| 1 | Plan-limit contract types | 977b5aad4 | — |
| 2 | Instants, precedence and CLI usage fold | a78c4a55a | — |
| 3 | Window/lane state engine and formatting | 698f8497c | Phase 1 fix d6c20cc20 |
| 4 | Rate-limit mapper, signal registry and stream branch | a18be04bd | — |
| 5 | Session quota probe and restore validation | 3d8b0d5d3 | Phase 2 fix badcec203 |
| 6 | Owner resolver and Codex reader hardening | 89eddce53 | — |
| 7 | Proxy owner key and quota store observers | 7943af1e4 | — |
| 8 | Plan-limit ledger, credential source and quota barrel | baa044f18 | — |
| 9 | Plan usage service with Claude and Codex readers | 48ddcb9f9 | — |
| 10 | Unofficial readers and Ollama Cloud session owner | 50cd859af | Phase 3 fix 02bc5b502 |
| 11 | Lane classifier, exit handling, lane owner and persistence | b60f572a9 | — |
| 12 | Ptah-CLI lane stream signals | 836140bb1 | — |
| 13 | Lane limit lookup, owner discovery, owner-lifecycle integration | bcfe47a8a | Phase 4 fix 190954cbd |
| 14 | MCP agent tool limit output | 164848d93 | — |
| 15 | Plan-limits RPC and push broadcaster | a90f7594f | Phase 5 fix 670c74a72 |
| 16 | `PlanLimitsStore` and the Context rename | c1ee76c22 | — |
| 17 | Lane run accounting in `AgentMonitorStore` | a9ab741fc | — |
| 18 | Stats limit view model and expansion state | 0099a3c58 | — |
| 19 | Stats tiles and stats summary integration | f6189781d | — |
| 20 | Chat-view wiring and agent-card fold delegation | 46ba54af7 | — |
| 21 | Dashboard provider account card | b1d53356f | Phase 6 fix e61eaeeec; harness f077277fd |
| 22 | Fixture coverage sweep F1-F83 + G fixtures | dd500c95a | — |

Every batch passed its scoped typecheck, lint and test run before its commit (recorded per batch above). The
only accepted failures were the known environment items listed below.

### Phase review verdicts

| Phase | Batches | Review(s) | Final verdict |
| --- | --- | --- | --- |
| 1 Shared foundation | 1-3 | `phase-1-code-review.md` (codex lane) | APPROVED 8/10 after fix d6c20cc20 |
| 2 Claude SDK capture | 4-5 | `phase-2-code-review.md` (opencode lane) | APPROVED 9/10 after fix badcec203 |
| 3 Owner identity, ledger, readers | 6-10 | `phase-3-code-review.md` APPROVED 8/10; `phase-3-batch-10-review.md` REVISE 7/10; `phase-3-fix-review.md` 8/10 | Fix round accepted, fix 02bc5b502 |
| 4 Lane runtime | 11-13 | `phase-4-code-review.md` (opencode lane) | APPROVED 8/10; re-review APPROVED 9/10 after fix 190954cbd |
| 5 Tool and RPC surfaces | 14-15 | `phase-5-code-review.md` (CLI lane) | APPROVED 7/10; re-review APPROVED 9/10 after fix 670c74a72 |
| 6 Webview | 16-21 | `phase-6-code-review.md` (codex lane); `visual-review.md` (visual-reviewer) | Code APPROVED 8/10; visual APPROVED 8/10 after fix e61eaeeec |
| 7 Fixture sweep | 22 | none (tests only, per run rules) | n/a |

### Mandatory completion checks

1. **Parity.** One surface was rebuilt: the dashboard provider account card (Batch 21, plan Component 16).
   There is no standalone `parity-inventory.md` (`design-spec.md:5` says none was produced). The old surface
   was inventoried against `HEAD` at Batch 21 attempt 1. Here it was re-checked against the base commit
   (`git show 5bb19f9fb:` of the card and `provider-account-state.service.ts`):

   | Old capability (5bb19f9fb) | Build | Test |
   | --- | --- | --- |
   | Selected provider from `AuthStateService.persistedProviderId()` drives the load | `provider-account-card.component.ts:371, :395` | "puts the selected provider first and follows a selection change"; "the effect requests provider:getPlanLimits for the selected provider" |
   | Refresh button, disabled while loading, reloads with `refresh: true` | `:177-181`, `:331-334`, `:401-402` | "Refresh reloads the selected provider with refresh:true and is disabled while loading" |
   | Codex primary/secondary used percentages, in order | owner window rows | case 3 "primary/secondary order kept" |
   | Activity block and its disclaimer | `:317` | case 3 "activity block unchanged" |
   | Stale notice "Showing cached account data; refresh failed at …" | `:546-550` | case 11 "existing stale notice kept" |
   | "Account usage unavailable: <status>" | `:341`; raw status chips | cases 16 and 16c; "an empty snapshot shows Account usage unavailable" |
   | Provider-switch generation guard | moved into the `PlanLimitsStore` load generation | `plan-limits.store.spec.ts` (Batch 16) |
   | Card shown only for Codex (`isCodex` gate) | widened to every owner (a superset, Req 6) | cases 1-16 |

   Removed: the internal `ProviderAccountStateService`, which had no user-facing capability. Its selection
   behaviour moved into the card effect. The removal is plan Component 16, which the user approved at Gate 2
   (`context.md:136`). `provider:getAccountUsage` is kept (Req 2.10). No capability is missing without
   approval.
2. **Rendered visual evidence.** `visual-review.md` is APPROVED 8/10 against `prototype/index.html`.
   `screenshots/` has `anubis` (dark) and `anubis-light` captures at 280, 360 and 440 px of: the chat tile
   collapsed at its limit, the plan tile open at its limit, the lane tile open with a different owner, the
   dashboard card owners, the dashboard card after a failed refresh, and focus probes. One note is open: a
   padded `anubis-light` screenshot of a focused tile. The focus-ring fix is confirmed only by source and
   computed contrast. This note is listed under FU-PHASE6.
3. **Write-path trace.** No settings path changed: nothing in `git diff --name-only 5bb19f9fb HEAD` matches
   a never-touch path. The task adds two persisted writes:
   - Ledger. `PlanLimitLedgerService.persist()` writes `ptah.planLimits.exhaustion.v1`
     (`plan-limit-ledger.persistence.ts:22`) through the injected storage at
     `plan-limit-ledger.service.ts:565`. The only reader is `load()` at `:583`, on the same storage and key.
     It uses `restoreLedger` to restore only evidence whose reset is still ahead. The key is new, so no
     existing reader changes. If a write fails, memory stays authoritative and the failure is logged at debug
     level only. No environment variables or other side effects.
   - Lane owner. `persistCliSessionReference` in
     `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts` writes `CliSessionReference.quotaOwner`.
     The only read path is `SessionMetadataStore.getCliSessionsForRestore`
     (`session-metadata-store.ts:310-325, :890`). It validates with `parseQuotaOwnerRef` and drops malformed
     values and legacy `quotaOwnerKey` values, which restore as "Unknown owner" (G3). Covered by
     `quota-owner-ref.schema.spec.ts`, `session-metadata-store.spec.ts` and
     `agent-process-manager.restore.spec.ts`.
4. **Final cross-project check.** After dd500c95a,
   `npx nx run-many -t typecheck -p ptah-extension-vscode ptah-electron ptah-cli ptah-extension-webview --parallel=1`
   passed 4/4.

### Validation risk resolutions

| Risk | Resolution |
| --- | --- |
| R1 auth-providers barrel ≤150 | Quota sub-barrel (Task 8.4); root barrel 149 lines (Phase 3 record) |
| R2 agent-sdk barrel growth | Minimal named exports only (Batches 4-5) |
| R3 Codex re-pin incompatibility | Task 6.2 offline diff found the shapes compatible; no stop (Batch 6) |
| R4 Credential leakage | The resolver is the only hashing site; F71 serialization specs; `[redacted]` forms; Phase 3 and 5 reviews |
| R5 597 hotspots | Only the named regions were edited; the never-touch list is clean across the whole diff |
| R6 Per-turn `accountInfo()` cost | 3 s timeout, off the stream path (Batch 5); FU-PHASE2 items 1-2 remain Minor |
| R7 Unknown-owner leakage | `ownerRelation` is never `same` for unknown; F54, F67 and F68 specs (F67 and F68 extended in Batch 22) |
| R8 Brand strings in tool text | Guard specs green in Batches 14, 15 and 22 |
| R9 Expansion reset by pushes | View-scoped `${sessionId}::${tileId}` state; F57 and F73 |
| R10 Batch 1 over 6 files | Accepted exception; committed as one type-only batch |

### Named follow-ups (open, not fixed in this task)

- **TASK-596-FU-PHASE2** (Minor, agent-sdk):
  1. `void readAccount` on `turn-start` can reject unhandled (`session-quota-probe.service.ts:221`).
  2. `ACCOUNT_INVALIDATING_ERRORS` omits `cloud_credential_error` (`:108-113`).
  3. A doc comment still says to re-key the registry (`session-plan-limit-signal.registry.ts:61-64`), which
     is stale.
  4. Pre-existing: `session-metadata-store.ts:303-307`, `:1046` and `:1234` throw on a persisted `null`
     entry. Validate at the storage read boundary.
- **TASK-596-FU-PHASE3** (Minor, auth-providers):
  - A4: a placeholder credential on the proxy header path (`provider-owner.resolver.ts:131-150`) becomes a
    fake owner.
  - A5: observations without a `sourceId` merge under `proxy:unidentified`.
  - A6: the maps at `plan-usage.service.ts:127-129` are never evicted.
  - B6: the Antigravity reader creates an `Agent` per call and never destroys it.
  - B7: the Ollama reader spec needs a comment that `plan-credential.source.ts` handles placeholder keys.
  - B8: hoist the Ollama Cloud URL parse (`provider-owner.resolver.ts:366`) to a module constant.
  - B1 test gap: no test drives the request `'error'` path or asserts listener cleanup.
  - Watch item: one unreproduced `plan-usage.service.spec.ts` failure under load.
- **TASK-596-FU-PHASE4** (cli-agent-runtime):
  1. **Moderate, open: Antigravity account identity is not wired.** Every Antigravity lane keys on
     `ownerForCliStore('antigravity')` (`lane-owner.resolver.ts:76-77`), so two Google accounts on one
     `~/.gemini` root share one owner key. The fix needs:
     - the `GetUserStatus` account field in `antigravity-plan-usage.reader.ts:46-54`, once the provisional
       payload (AS8) is confirmed;
     - the `recordQuotaOwner` upgrade call (`agent-process-manager.service.ts:718-731`);
     - a spec that two accounts on one root get distinct owner keys.
  2. Minor: jest reports "worker process failed to exit gracefully" in the `limits/` run (a leaked handle).
  3. Minor: the lane wording regexes for OpenCode, Ollama and Antigravity are provisional.
- **TASK-596-FU-PHASE5** (Minor, vscode-lm-tools and rpc-handlers):
  1. The 3 s bound excludes the `agent.list()` roster fetch on the spawn path.
  2. Under a sustained change stream the broadcaster runs assembles and then discards them
     (`plan-limits-broadcaster.ts:84-99`). Re-arm the timer while one is in flight.
  3. `provider:getAccountUsage` answers `provider-unsupported` instead of the retryable
     `service-unavailable` when discovery times out (`plan-limits-snapshot.service.ts:124-130`).
- **TASK-596-FU-PHASE6** (webview):
  - **Moderate, needs a user design decision under G3:** two owners in the dashboard card are both headed
    "Claude account" / "Subscription quota". The user must decide which owner identity may be shown before
    any code change.
  - Moderate: lane runs send `modelScope: null`, so model windows show `model-scope-unknown`. Persist the
    backend-resolved scope.
  - Moderate: an opened plan tile repeats its own face.
  - Moderate: captions wrap at 280 px.
  - Minor, pre-existing: contrast fails for Model and Context in the light theme and for Cost in the dark
    theme.
  - Minor: the tile/panel corner join is not visible in `anubis-light`.
  - Take one padded screenshot of a focused tile in `anubis-light`.
  - Batch 17 Minor: a same-id re-open folds onto `null`.
  - Batch 18 Minors: cooldowns have no source chip; `ownerStatusNote` falls through a `default` branch;
    Deviation 2 stays accepted.
  - Batch 19 Minors: the LANES pill has no `aria-label`; `session-stats-summary.component.ts` is over the
    warn-level `max-lines`.
  - Batch 20 Minor: `chat-view.component.ts` is over the warn-level `max-lines`.

### Known environment test items (not regressions)

- `translation-proxy.sdk.integration.spec.ts`: the EPERM/ENOTEMPTY `removeTree` teardown in the Windows temp
  dir fails S1-S4 (sometimes S5 or S6b). It appears in every full `auth-providers:test` run, including Batch
  22's.
- Timing items that did not fail in the Batch 22 run: the header-deadline test at
  `translation-proxy-base.spec.ts:2258`, `opencode-translation-proxy.spec.ts:654`, the PowerShell "timeout
  kill" case, and the `plan-usage.service.spec.ts` watch item.
- Nx Cloud returns 401 and is disabled. Local execution is unaffected.

### Residual test risks (documented, not defects)

- **F55:** the account-change chain is proven only in pieces. Backend: `owner-lifecycle.integration.spec.ts:310,
  :365` and `session-quota-probe.service.spec.ts:170, :212`. Frontend: the view model and `AgentMonitorStore`.
  No single chained test runs probe → ledger → resolver → `agent-events` → `AgentMonitorStore` → view model.
- **F80:** 2xx, 3xx and unknown-owner proxy outcomes are covered. There is no credit-provider case at the
  proxy boundary.
- F68 is proven at the ledger and `ownerRelation` level. `LaneLimitLookupService` is mocked at the snapshot
  seam.
- The tester's mapping passes supplied the fixture map's line numbers. Not all of them were re-read.
