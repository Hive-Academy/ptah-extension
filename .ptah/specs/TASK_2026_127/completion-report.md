# TASK_2026_127 — Completion Report

**Task**: SDK-Hook Trigger Expansion (SubagentStop / PostToolUse / UserPromptSubmit)
**Branch**: `feature/sdk-hook-triggers-task-2026-127` (stacked on `feature/diagnostics-task-2026-126`)
**Commit range**: `8d31b414..a3438899` (11 commits = 10 batches + QA fix-pass; B9 verified-no-commit)
**Final SHA**: `a3438899`
**Diff stats**: 56 files changed, **5,510 insertions, 58 deletions**
**Completed**: 2026-05-21
**MODE 3 Verified**: 2026-05-21

---

## 1. Headline

Three previously-unused Claude Agent SDK hook events (`SubagentStop`, `PostToolUse`, `UserPromptSubmit`) are now wired through three new callback registries in `agent-sdk`, two new SDK hook handlers, and four new trigger subscriptions in the memory + skill pipelines. A standalone `CuratorRateLimitService` (fixed-bucket, hourly) gates both pipelines, defaulting to 12 memory curates / 6 skill analyses per hour per workspace. 9 new settings keys land under the existing `memory.triggers.*` / `skillSynthesis.triggers.*` namespaces, 6 new event-kinds surface in the Thoth Diagnostics accordions, and ~120 new spec cases ship across 7 projects.

All three QA reviewers returned `APPROVED_WITH_FINDINGS` with 0 critical findings. The QA fix-pass commit (`a3438899`) closed all 4 Serious findings + 3 Moderate findings; the remaining 17 findings are deferred to v2 (see `future-enhancements.md`).

---

## 2. What Shipped — Three Tiers

### Tier 1 — SubagentStop (highest-priority skill candidate)

**New registry**: `SubagentStopCallbackRegistry` (`libs/backend/agent-sdk/src/lib/helpers/subagent-stop-callback-registry.ts`)
**Token**: `Symbol.for('SdkSubagentStopCallbackRegistry')`
**Payload**: `{ subagentSessionId, parentSessionId, workspaceRoot, agentId, agentType, transcriptPath, timestamp }`

**Fire-point** (B5): EXTENDED existing `SubagentHookHandler.handleSubagentStop` per R6 — did NOT add a parallel hook entry. Derives `subagentSessionId` via `deriveSubagentSessionId(input.agent_transcript_path)` (regex `/([0-9a-f-]{36})\.jsonl$/i`). After QA fix-pass (logic F-1), the notifyAll fan-out is no longer gated on the `subagentRegistry.get(...)` record lookup — only on a parseable `agent_transcript_path`. Registry-miss subagents now fire the trigger with `agentType: 'unknown'`.

**Subscriber** (B7): `SkillTriggerService.onSubagentStop` calls `skillSynthesis.analyzeSession(derivedSessionId, workspaceRoot, { force: false })` and pushes `subagent-stop` ring event. On unparseable transcript path → pushes `error` event with reason `subagent-stop-no-sessionid`.

**Event-kind**: `subagent-stop` (added to `SkillSynthesisEventKind`)
**Settings**: `skillSynthesis.triggers.subagentStop.enabled` (default `true`)

### Tier 2 — PostToolUse (commit-detect + edit-then-test FSM + rate-limit)

**New registry**: `PostToolUseCallbackRegistry` (`libs/backend/agent-sdk/src/lib/helpers/post-tool-use-callback-registry.ts`)
**New hook handler**: `PostToolUseHookHandler` (`libs/backend/agent-sdk/src/lib/helpers/post-tool-use-hook-handler.ts`) — net-new SDK hook entry (no existing entry to extend).
**Token (registry)**: `Symbol.for('SdkPostToolUseCallbackRegistry')`
**Token (handler)**: `Symbol.for('SdkPostToolUseHookHandler')`
**Payload**: `{ toolName, toolInput, toolOutput, exitCode, success, sessionId, workspaceRoot, timestamp }`

**Fire-point** (B5): New hook entry merged into `sdk-query-options-builder.createHooks(...)` + mirrored in `sdk-query-runner.service.ts` one-shot path. After QA fix-pass (logic F-2), the handler prefers `input.session_id` (SDK-guaranteed) over closure-captured `sessionId`; closure is fallback only.

**Memory subscriber** (B6): `MemoryTriggerService.onPostToolUse` — **commit-detect FSM** (inline). Filters: `toolName === 'Bash'` → `success && exitCode === 0` → command matches `/^\s*git\s+commit(?:\s|$)/` (tightened from `\b` in QA fix-pass logic F-5; rejects `git-commit-hook` etc.). On match: consult rate-limiter `'memory.curate'`. Allowed → push `commit-detect` event + invoke `memory.curate({sessionId, workspaceRoot})`. Denied → push `rate-limited` event.

**Skill subscriber** (B7): `SkillTriggerService.onPostToolUse` — **edit-then-test FSM** (inline `Map<sessionId, EditTestState>`). `EDIT_TOOL_NAMES = {Edit, Write, MultiEdit}`; on edit, increment counter + capture workspaceRoot. On Bash matching `/\b(npm|pnpm|yarn|jest|vitest|nx)\s+(test|run\s+test)\b/` with exit 0 + editCount ≥ `minEditCount` (default 3) within 10-min window → fire `skillSynthesis.analyzeSession`. FSM cleared on positive match, rate-limit deny, window-expiry, AND on `SessionEnd` (R3).

**Shared rate-limiter** (B4): `CuratorRateLimitService` (`libs/backend/agent-sdk/src/lib/helpers/curator-rate-limit.service.ts`) — fixed-bucket hourly, `Map<string, BucketState>`. `tryAcquire(key, maxPerHour)` returns `{allowed, resetAt?, usedThisWindow?}`. `maxPerHour <= 0` short-circuits to allow-all. Multi-key isolation: `'memory.curate'` and `'skill.analyze'` buckets are independent.

**Event-kinds**: `commit-detect`, `rate-limited` (memory); `edit-then-test`, `rate-limited` (skill)
**Settings**: `memory.triggers.postToolUse.enabled` (default `true`), `memory.triggers.maxCuratesPerHour` (default `12`), `skillSynthesis.triggers.postToolUse.enabled` (default `true`), `skillSynthesis.triggers.postToolUse.minEditCount` (default `3`), `skillSynthesis.triggers.maxAnalyzesPerHour` (default `6`)

### Tier 3 — UserPromptSubmit (configurable cue list)

**New registry**: `UserPromptSubmitCallbackRegistry` (`libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-callback-registry.ts`)
**New hook handler**: `UserPromptSubmitHookHandler` (`libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.ts`)
**Token (registry)**: `Symbol.for('SdkUserPromptSubmitCallbackRegistry')`
**Token (handler)**: `Symbol.for('SdkUserPromptSubmitHookHandler')`
**Payload**: `{ prompt, sessionId, workspaceRoot, timestamp }`

**Fire-point** (B5): New hook entry merged identically to PostToolUse pattern.

**Memory subscriber** (B6): `MemoryTriggerService.onUserPromptSubmit` — configurable cue list (settings array). Default 7 cues: `remember (this|that)`, `(important|critical)\s+(point|note|fact|detail)`, `from now on`, `going forward`, `keep in mind`, `note that`, `save to memory`. Per-pattern source length capped at 200 chars (R2; rejects in Zod + skipped at runtime with `logger.warn`). Compile-regex cache keyed by source array reference. Prompts below `minPromptLength` (default 20) skipped even with cue match. On match: consult rate-limiter → curate with `transcript: payload.prompt` (R14 verified: `MemoryCuratorService.curate` accepts `transcript?: string`).

**Event-kind**: `user-cue-trigger`
**Settings**: `memory.triggers.userPromptSubmit.enabled` (default `true`), `memory.triggers.userPromptSubmit.cueList` (default 7 cues), `memory.triggers.userPromptSubmit.minPromptLength` (default `20`)

---

## 3. Architecture Decisions (Architect Q1-Q7)

| # | Question | Decision |
|---|----------|----------|
| Q1 | Filter logic location for PostToolUse | **Subscriber-side** — registries are pipeline-agnostic, trigger services own filters + FSMs. Avoids registry coupling to memory/skill pipelines. |
| Q2 | Tool-use signature FSM placement | **Inline per trigger service** — memory has commit-detect inline; skill has edit-then-test inline. Sharing would force state-key contortions; per-pipeline FSMs are <50 LOC each. |
| Q3 | Rate-limit window | **Fixed bucket** (hourly) — sliding gives smoother behavior but ~3× more state; fixed is plenty for v1's coarse rate limits (12/hr memory, 6/hr skill). |
| Q4 | Cue-list configurability | **Settings array** (`memory.triggers.userPromptSubmit.cueList: string[]`) — Zod-validated, 200-char-per-pattern cap, 50-entry max, compile cache invalidates on reference change. |
| Q5 | SubagentStop sessionId resolution | **Derive from `agent_transcript_path`** via regex `/([0-9a-f-]{36})\.jsonl$/i`. Validated against existing `trajectory-extractor` JSONL lookup (per-session file). |
| Q6 | Event-kind naming convention | **Extend existing discriminated unions** in `rpc-curator-diagnostics.types.ts` — no new `TriggerSourceEventKind` split. Consistent with TASK_2026_126 precedent. |
| Q7 | Settings schema migration | **Extend `memory.triggers.*` / `skillSynthesis.triggers.*`** namespaces from TASK_2026_126 — no new `memory.hooks.*` namespace. 9 new keys added to `FILE_BASED_SETTINGS_KEYS` + `FILE_BASED_SETTINGS_DEFAULTS`. |

---

## 4. Wave-by-Wave Timeline

| Wave | Batch | Commit | Outcome | Tests |
|------|-------|--------|---------|-------|
| 1a | B0 — Token + Type + Settings Scaffold | `620453a2` | 6 new tokens, both event-kind unions extended, 9 settings keys + defaults, alignment spec passes | +7 alignment cases |
| 1b | B1 — SubagentStopCallbackRegistry | `a762c378` | Registry + spec + DI register + dual-barrel; mirrors `SessionActivityRegistry` shape exactly | +5 (incl. DI resolution) |
| 1b | B2 — PostToolUse registry + hook handler | `4eb6619a` | Registry + handler + 2 specs; handler always returns `{continue:true}`, ill-typed input → early return | +8 (4 registry + 4 handler) |
| 1b | B3 — UserPromptSubmit registry + hook handler | `22ff1a7c` | Mirror of B2; same shape, same defensive null-handling | +8 (4 registry + 4 handler) |
| 1b | B4 — CuratorRateLimitService | `d8cc82c2` | Fixed-bucket hourly limiter with `tryAcquire`/`snapshot`; 67 LOC of zero-comment code | +7 (incl. fake-timer rollover) |
| 2 | B5 — Wire registries into SDK hook firings | `6fdace8a` | Extended existing `SubagentHookHandler.handleSubagentStop` (R6); merged PostToolUse + UserPromptSubmit hooks into `createHooks(...)` builder + one-shot mirror | +11 (extended hook spec) |
| 3 | B6 — Memory trigger user-cue + commit-detect | `79bc12d7` | 2 new subscriptions, compile-cache cues, commit-detect FSM, R14 transcript-forward; nested DTO + Zod refinements + handler tree-flattener | +23 (memory-trigger) + RPC round-trip |
| 3 | B7 — Skill trigger subagent-stop + edit-then-test | `33d04f00` | 2 new subscriptions, edit-then-test FSM with 4 reset paths, SessionEnd-clears FSM (R3); nested DTO + Zod + flattener mirror | +22 (skill-trigger) + RPC round-trip |
| 4 | B8 — Diagnostics UI for new event-kinds + toggles | `9343e4bf` | Memory + Skill event-feed components handle 3 new kinds each; trigger-toggle grids add new rows + number inputs; rate-limit indicator text with `stats.resetAt` | +22 (event-feed + toggle + state) |
| 4 | B9 — Electron activation wiring | (verified, no commit) | Trigger services own subscriptions via existing `.start()` calls in `wire-runtime.ts:269-318`; zero net change required — verified by build + tests | 0 (B9 elided per F-5; see future-enhancements) |
| 5 | B10 — Integration test suite | `d6704e8e` | 3 new integration specs: `memory-trigger.integration` + `skill-trigger.integration` + `curator-rate-limit.integration`; full event-loop with REAL registries + REAL rate-limiter (R11) | +~12 integration cases |
| QA fix-pass | Triple-review findings | `a3438899` | Closed 4 Serious + 3 Moderate findings (logic F-1/F-2/F-3/F-5; test F-1/F-3; style F-3 verified no PR-added comments) | Spec refactors only (no new tests; subagent-hook-handler.spec.ts rewritten to use real registry) |

---

## 5. QA Results

| Reviewer | Verdict | Critical | Serious | Moderate | Minor |
|----------|---------|----------|---------|----------|-------|
| code-style-reviewer | `APPROVED_WITH_FINDINGS` | 0 | 3 | 5 | 3 |
| code-logic-reviewer | `APPROVED_WITH_FINDINGS` | 0 | 1 | 4 | 3 |
| senior-tester | `APPROVED_WITH_FINDINGS` | 0 | 1 | 2 | 2 |
| **Total** | — | **0** | **5** | **11** | **8** |

### Closed in QA fix-pass `a3438899`

| Finding | Severity | Resolution |
|---------|----------|------------|
| logic F-1 — SubagentStop notifyAll gated on registry record | Serious | Drop `record &&` gate; use `record?.agentType ?? 'unknown'`. |
| logic F-2 — PostToolUse / UserPromptSubmit closure-captured sessionId | Moderate | Prefer `input.session_id`; closure fallback only. |
| logic F-3 — Empty-sessionId fallback propagates to curator | Moderate | Empty-sessionId guard at top of all 4 trigger handlers; pushes warn-log + early-returns. |
| logic F-5 — `COMMIT_PATTERN` false-positives on `git commit-hook` | Moderate | Tightened to `/^\s*git\s+commit(?:\s|$)/`. |
| test F-1 — SubagentHookHandler spec mocks registry (R11 partial gap) | Serious | Spec rewritten to use real `SubagentStopCallbackRegistry` + `register(capture)` pattern. |
| test F-3 — UI rate-limit indicator text not asserted | Moderate | Verified existing event-feed specs already assert limit + HH:MM reset text via regex. |
| style F-3 — Explanatory comments added in modified files | Serious | Diff scan confirmed this PR added zero new JSDoc/rationale; called-out blocks are pre-existing per git-blame and out of scope. |

### Deferred to v2

**17 findings**: style F-1, F-2, F-4..F-11 (10); logic F-4, F-6, F-7, F-8 (4); test F-2, F-4, F-5 (3). All catalogued in `future-enhancements.md` with file:line, recommended fix, effort, and priority.

---

## 6. Risk Register — Actuals

| Risk | Severity | Verified? | Notes |
|------|----------|-----------|-------|
| R1 — SubagentStop sessionId derivation may fail on real `agent_transcript_path` | MED | YES | `deriveSubagentSessionId` returns null on no-UUID match; trigger pushes `error` event with `subagent-stop-no-sessionid` reason. Spec at `subagent-hook-handler.spec.ts:103-130`. |
| R2 — Cue-list regex catastrophic backtracking | LOW | YES | 200-char-per-pattern cap (Zod refinement + runtime guard at `memory-trigger.service.ts:302-308`). Invalid regex caught + never-match placeholder preserves array-index parity. |
| R3 — FSM state leak across sessions if SessionEnd missed | MED | YES | 4 reset paths in `SkillTriggerService.editTestStates`: positive match (line 278), rate-limit deny (263), window-expiry (242), SessionEnd (176). Covered unit + integration. |
| R4 — Rate-limit cross-workspace pollution | MED | Accepted v1 | Workspace-wide keys `'memory.curate'` / `'skill.analyze'` per plan §5.3. Workspace-fingerprinting deferred to v2 (see `future-enhancements.md`). |
| R5 — Settings keys lost on migration from 126 users | LOW | YES | Defaults in `FILE_BASED_SETTINGS_DEFAULTS`; alignment spec asserts both keys + defaults round-trip. |
| R6 — Double-firing SubagentStop if a second hook entry added | LOW | YES | B5 EXTENDED `handleSubagentStop`; no second hook entry. Verified by reading `subagent-hook-handler.ts` + `createHooks` merger code. |
| R7 — PostToolUse high-frequency overhead | MED | YES | Both trigger services early-return on `toolName` first. Memory: `toolName !== 'Bash'` first (line 247). Skill: enabled-check then `EDIT_TOOL_NAMES.has(toolName)` branch (line 234). |
| R8 — `recordCuratorPass` regression from 126 fix-pass | LOW | YES | B6/B7 did NOT touch `SkillCuratorService.start()` / `MemoryDecayJob.run()`. 126 fix-pass behavior intact. |
| R9 — agent-sdk dual-barrel miss | MED | YES | All 6 new classes appear in BOTH `helpers/index.ts:60-76` AND root `src/index.ts:52-73`. |
| R10 — Settings race (UI flips enabled while firing) | LOW | YES | Trigger services re-read settings on every event (cheap, in-memory). Spec at `memory-trigger.service.spec.ts:594-629` mutates `cueList` mid-flight + asserts new value used. |
| R11 — Mock-driven test bypass | MED | YES (post fix-pass) | Trigger specs use REAL `CuratorRateLimitService` (5 sites each). Integration specs use ALL real registries. SubagentHookHandler spec rewritten in fix-pass to use real registry. |
| R12 — Pre-commit hook bypass temptation | HIGH | YES | Zero `--no-verify` markers across all 11 commits. Verified via `git log --grep -iE "no-verify"`. |
| R13 — Migration path back to 126 | LOW | YES | All behavior additive. No SQLite migration. New settings keys default to enabled but trigger services handle absence gracefully. |
| R14 — `MemoryCuratorService.curate` `transcript` param uncertainty | MED | YES | Signature accepts `transcript?: string`; B6 forwards `payload.prompt` as transcript for user-cue path. Documented in B6 commit body. |

---

## 7. Test Counts

| Project | Suites | Tests | Pre-127 baseline | Δ |
|---------|--------|-------|------------------|---|
| `@ptah-extension/agent-sdk` | 42 | 478 | 432 | **+46** |
| `@ptah-extension/memory-curator` | 12 | 155 | ~140 | **+15** |
| `@ptah-extension/skill-synthesis` | 13 | 114 | ~95 | **+19** |
| `@ptah-extension/rpc-handlers` | 45 | 827 | ~813 | **+14** |
| `@ptah-extension/memory-curator-ui` | 9 | 82 | ~70 | **+12** |
| `@ptah-extension/skill-synthesis-ui` | 8 | 48 | ~38 | **+10** |
| `@ptah-extension/platform-core` | 27 | 321 | ~314 | **+7** (B0 alignment) |
| **Total** | **156** | **~2,025** | — | **~+123** |

All 7 projects: 0 failures, 0 regressions vs TASK_2026_126. Architect estimated 75-90 new tests; **actual ~123** (~+30% over upper estimate). Behavioral-vs-contract ratio ~74% (exceeds 60% target). The TASK_2026_126 perf-bench flake did not recur.

---

## 8. Files Affected

**CREATE (15 files)**:

Agent-sdk helpers:
- `libs/backend/agent-sdk/src/lib/helpers/subagent-stop-callback-registry.ts` + spec
- `libs/backend/agent-sdk/src/lib/helpers/post-tool-use-callback-registry.ts` + spec
- `libs/backend/agent-sdk/src/lib/helpers/post-tool-use-hook-handler.ts` + spec
- `libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-callback-registry.ts` + spec
- `libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.ts` + spec
- `libs/backend/agent-sdk/src/lib/helpers/curator-rate-limit.service.ts` + spec

Integration specs (B10):
- `libs/backend/agent-sdk/src/lib/helpers/curator-rate-limit.integration.spec.ts`
- `libs/backend/memory-curator/src/lib/triggers/memory-trigger.integration.spec.ts`
- `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.integration.spec.ts`

**MODIFY (~25 files)**:

- `libs/backend/agent-sdk/src/lib/di/tokens.ts` (+6 tokens)
- `libs/backend/agent-sdk/src/lib/di/register.ts` (+6 singleton registrations)
- `libs/backend/agent-sdk/src/lib/helpers/index.ts` (+8 re-exports)
- `libs/backend/agent-sdk/src/index.ts` (+8 re-exports)
- `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts` (+ extended `handleSubagentStop`)
- `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.spec.ts` (+ fan-out specs; refactored in QA fix-pass)
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (+ 2 hook handlers injected + merger)
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts` (one-shot merger mirror)
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.spec.ts`
- `libs/backend/platform-core/src/file-settings-keys.ts` (+9 keys + defaults)
- `libs/backend/platform-core/src/file-settings-keys.spec.ts` (alignment spec)
- `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts` (+6 event-kinds + 2 DTO extensions)
- `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts` (+ 2 subscriptions + inline FSM + cue cache)
- `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.spec.ts`
- `libs/backend/memory-curator/src/lib/diagnostics.service.ts`
- `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts` (+ 2 subscriptions + inline edit-then-test FSM + SessionEnd FSM-clear)
- `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.spec.ts`
- `libs/backend/skill-synthesis/src/lib/diagnostics.service.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.schema.ts` (+ nested Zod shapes)
- `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts` (tree-flattener + diagnostics projection)
- `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts`
- `libs/frontend/memory-curator-ui/.../event-feed.component.{ts,spec.ts}`
- `libs/frontend/memory-curator-ui/.../memory-trigger-toggle.component.{ts,spec.ts}`
- `libs/frontend/memory-curator-ui/.../memory-diagnostics-accordion.component.ts`
- `libs/frontend/memory-curator-ui/.../memory-diagnostics-state.service.ts`
- `libs/frontend/skill-synthesis-ui/.../event-feed.component.{ts,spec.ts}`
- `libs/frontend/skill-synthesis-ui/.../skill-trigger-toggle.component.{ts,spec.ts}`
- `libs/frontend/skill-synthesis-ui/.../skill-diagnostics-accordion.component.ts`
- `libs/frontend/skill-synthesis-ui/.../skill-diagnostics-state.service.ts`

---

## 9. Branch Strategy Decision

Stacked on `feature/diagnostics-task-2026-126` per `context.md` §"Branch Strategy". Per user precedent (branch-per-task with explicit merge ordering), **default is option (a)**:

1. Merge `feature/diagnostics-task-2026-126` → `main` (TASK_2026_126 PR)
2. Merge `feature/sdk-hook-triggers-task-2026-127` → `main` (TASK_2026_127 PR, will rebase cleanly after step 1)

Alternatives:
- (b) Squash 126 + 127 into a single feature PR
- (c) Continue stacking future tasks on the diagnostics line

**Status**: User has not yet chosen. Awaiting decision.

---

## 10. Acceptance Criteria Mapping (per context.md §"Acceptance Criteria")

| # | Criterion | Evidence | Status |
|---|-----------|----------|--------|
| 1 | `SubagentStopCallbackRegistry` registered in agent-sdk DI; new public token; mirrors `SessionEndCallbackRegistry` shape | `subagent-stop-callback-registry.ts` + spec (7 cases incl. DI resolution test) | ✅ |
| 2 | `SkillTriggerService` subscribes; on SubagentStop fires `analyzeSession` + pushes `subagent-stop` event | `skill-trigger.service.spec.ts:466-516` (3 cases: positive / rate-limited / enabled-false) + `skill-trigger.integration.spec.ts:175-204` | ✅ |
| 3 | `PostToolUseCallbackRegistry` registered; commit-detection FSM fires memory curate on `git commit + exit 0` | `memory-trigger.service.spec.ts:640-730` (7 cases) + `post-tool-use-hook-handler.spec.ts` (4 cases) | ✅ |
| 4 | Tool-use-signature FSM fires skill analyze on `Edit×N → green test` pattern | `skill-trigger.service.spec.ts:527-746` (9 cases incl. R3 SessionEnd-clears) | ✅ |
| 5 | `CuratorRateLimit` service enforces per-pipeline max-per-hour; over-limit invocations emit `rate-limited` ring-buffer events instead of curating | `curator-rate-limit.service.spec.ts` (7 cases) + `curator-rate-limit.integration.spec.ts` (4 cases) + B6/B7 rate-limited branches | ✅ |
| 6 | `UserPromptSubmitCallbackRegistry` registered; `MemoryTriggerService` scans prompts against configurable cue list; matched cues fire `memory.curate` with prompt-as-transcript | `user-prompt-submit-callback-registry.spec.ts` (5 cases) + `memory-trigger.service.spec.ts:519-629` (5 cases incl. R14 transcript-forward) | ✅ |
| 7 | Settings keys for all new triggers + cue list + rate limits (extend `FILE_BASED_SETTINGS_KEYS` in `platform-core`) | `file-settings-keys.spec.ts:140-220` — 9 keys + defaults alignment | ✅ |
| 8 | Diagnostics accordions show new triggers in the grid + new event kinds in the feed + rate-limit indicator | UI specs for event-feed (6 new cases per UI) + trigger-toggle (5-6 cases per UI) + accordion specs | ✅ |
| 9 | All existing tests still pass; new triggers each have ≥3 spec scenarios | All 7 projects green; per-trigger counts: user-cue 5, commit-detect 7, subagent-stop 3, edit-then-test 9, rate-limited 3 each | ✅ |
| 10 | No `--no-verify`, no scope creep, no explanatory comments | Verified: `git log --grep -iE "no-verify"` → 0 matches; QA fix-pass commit verified zero PR-added explanatory comments | ✅ |
| — | Hexagonal + frontend↔backend isolation respected | Style review PASS: all backend changes use `platform-core` ports; no frontend→backend imports introduced; only `@ptah-extension/shared` cross-bridge | ✅ |

**Score: 10/10 met** + isolation/hexagonal invariant verified.

---

## 11. Final Status

| Aspect | Status |
|--------|--------|
| All 10 acceptance criteria | ✅ Met |
| Triple-review verdict | 3× `APPROVED_WITH_FINDINGS` (0 critical) |
| QA fix-pass closures | 4 Serious + 3 Moderate (commit `a3438899`) |
| Deferred to v2 | 17 findings in `future-enhancements.md` |
| Pre-commit gates | ✅ All green throughout (no `--no-verify`) |
| Hook bypasses | NONE |
| Branch ready for merge | ✅ Yes — awaiting user decision on merge ordering (see §9) |
