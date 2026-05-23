# Development Tasks — TASK_2026_127

**Feature**: SDK-Hook Trigger Expansion (SubagentStop / PostToolUse / UserPromptSubmit)
**Branch**: `feature/sdk-hook-triggers-task-2026-127` (stacked on `feature/diagnostics-task-2026-126`)
**Total Batches**: 11 (B0..B10) across 5 waves | **Status**: 11/11 complete (+ QA fix-pass)
**Architect Verdict**: APPROVED (implementation-plan.md §"Verdict")
**Test Estimate**: ~75-90 new test cases

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified by Architect (carried forward)

| # | Assumption | Source | Result |
|---|-----------|--------|--------|
| 1 | `ALLOWED_METHOD_PREFIXES` already contains `memory:` + `skillSynthesis:` (TASK_2026_126) | plan §2.2 | CONFIRMED — zero edits to `rpc-handler.ts:44` required |
| 2 | `SessionActivityRegistry` / `SessionEndCallbackRegistry` exist as canonical mirroring patterns | plan §3 | CONFIRMED — `libs/backend/agent-sdk/src/lib/helpers/session-activity-registry.ts` is the canonical post-126 pattern |
| 3 | `SubagentHookHandler.handleSubagentStop` exists at `subagent-hook-handler.ts:254-337` | plan §4.1 | CONFIRMED — EXTEND existing handler; do NOT add second hook entry (R6) |
| 4 | `isPostToolUseHook` type guard exists at `claude-sdk.types.ts:518-522` | plan §4.2 | CONFIRMED |
| 5 | TASK_2026_126 settings keys live at `file-settings-keys.ts:238-244` under `memory.triggers.*` / `skillSynthesis.triggers.*` | plan §1 Q7 | CONFIRMED — extend same namespace; do NOT introduce `*.hooks.*` |

### B0 Barrel-Scaffold Decision (architect §9 "Wave 1 Refined")

The architect's plan presented two options:

- (a) Strict B1→B2→B3 serialization (avoids shared-file conflicts via ordering)
- (b) **B0-first barrel batch** that scaffolds `tokens.ts`, both barrels, settings keys, and shared union extensions; then B1/B2/B3/B4 fan out in parallel

**Decision**: Adopt option (b) — B0-first. ~30% wall-clock saving via Wave 1 parallelism, file-disjoint enforcement is cleaner, and pre-declared tokens compile standalone (Symbol values need no class import).

**Critical scope clarification for B0**: B0 owns ONLY token symbols, shared event-kind union extensions, settings-keys + defaults, and the alignment spec. B0 does NOT register classes in `register.ts` and does NOT add re-exports to barrels — those edits live in the owning batches (B1 owns the SubagentStop registry's barrel export + DI registration; B2 owns PostToolUse's; B3 owns UserPromptSubmit's; B4 owns CuratorRateLimit's). This keeps every barrel/register edit single-owner within Wave 1.

### Risks Identified (from plan §12)

| Risk | Severity | Mitigation | Verified in |
|------|----------|------------|-------------|
| R1 — SubagentStop sessionId derivation may fail on real-world `agent_transcript_path` | MED | `deriveSubagentSessionId` returns null on no-match; error event pushed | B5 spec, B7 spec, B10 integration |
| R2 — Cue-list regex catastrophic backtracking | LOW | Per-pattern source length capped at 200 chars; Zod refinement rejects oversize | B0 schema, B6 spec |
| R3 — FSM state leak across sessions if SessionEnd missed | MED | 10-min window TTL; B7 extends `onSessionEnd` to clear FSM | B7 spec |
| R4 — Rate-limit cross-workspace pollution | MED | Workspace-wide key for v1; document for v2 fingerprinting | B4 spec |
| R5 — Settings keys lost on migration from 126 users | LOW | Defaults in `FILE_BASED_SETTINGS_DEFAULTS`; alignment spec | B0 spec |
| R6 — Double-firing SubagentStop if a second hook entry is added | LOW | EXTEND existing handler; do NOT register a second SDK hook | B5 task description |
| R7 — PostToolUse high-frequency overhead | MED | Early-return on `toolName` string-equality FIRST in every subscriber | B6/B7 specs |
| R8 — `recordCuratorPass` regression from 126 fix-pass | LOW | B6/B7 must NOT touch `SkillCuratorService.start()` / `MemoryDecayJob.run()` | Allow-list discipline |
| R9 — agent-sdk dual-barrel miss | MED | Grep for ClassName in BOTH `helpers/index.ts` AND `src/index.ts` before commit | Every B1..B4 batch |
| R10 — Settings race (UI flips enabled while firing) | LOW | Trigger services re-read settings on every event (cheap, in-memory) | B6/B7 specs |
| R11 — Mock-driven test bypass | MED | Specs use REAL `CuratorRateLimitService` (not mock) | B6/B7 specs |
| R12 — Pre-commit hook bypass temptation | HIGH | Hard stop-and-report rule echoed per batch | Every batch |
| R13 — Migration path back to 126 | LOW | All behavior additive; no SQLite migration | — |
| R14 — `MemoryCuratorService.curate` `transcript` param uncertainty | MED | B6 sub-agent reads `memory-curator.service.ts` signature before forwarding; document choice in commit body | B6 task description |

### Edge Cases To Handle

- [ ] SubagentStop with unparseable `agent_transcript_path` (no UUID) → error event, no analyze call (B5 + B7)
- [ ] User prompt below `memory.triggers.userPromptSubmit.minPromptLength` (default 20) → skip even with cue match (B6)
- [ ] Edit-then-test FSM 10-min window expiry → state dropped on next event for session (B7)
- [ ] Edit-then-test FSM cleared on SessionEnd (B7 — R3)
- [ ] `maxCuratesPerHour: 0` / `maxAnalyzesPerHour: 0` → limiter short-circuits to allow-all (B4)
- [ ] Hour-boundary rollover resets fixed-bucket counter (B4)
- [ ] Settings race: `enabled: false` flipped while registry firing → next event sees new value (B6/B7)

### Blockers Found

None.

---

## Wave Summary

| Wave | Batches | Mode | Concurrency | Depends On |
|------|---------|------|-------------|------------|
| W1a — Scaffold | B0 | sequential (single agent) | 1 | — |
| W1b — Foundations | B1, B2, B3, B4 | parallel | 4 | B0 |
| W2 — SDK Fire-Point | B5 | sequential | 1 | B1, B2, B3 |
| W3 — Trigger Subscriptions | B6, B7 | parallel | 2 | B0, B5 (+ B4 for rate-limiter) |
| W4 — UI + Activation | B8, B9 | parallel | 2 | B6, B7 |
| W5 — Integration + QA | B10 | sequential | 1 | ALL prior |

**Maximum concurrency**: 4 agents (Wave 1b: B1+B2+B3+B4 file-disjoint after B0 lands).

```
B0
  ├─→ B1 ┐
  ├─→ B2 ├─→ B5 ─┐
  ├─→ B3 ┘       ├─→ B6 ┐
  └─→ B4 ────────┘      ├─→ B8 ┐
                  ├─→ B7 ┘     ├─→ B10
                                └─→ B9 ┘
```

---

## Global Quality Gates (apply to EVERY batch — the seven hard rules)

1. **No `--no-verify` on commits.** Per `feedback_agents_bypass_hooks_when_blocked.md`. If pre-commit hook fails: STOP, report failure with hook output, DO NOT bypass. (R12)
2. **No explanatory comments.** Per `feedback_no_explanatory_comments.md`. Zero comments in new code. Only public-API JSDoc on re-exported types/services. Type/method names + describe/it blocks carry semantics.
3. **No scope creep beyond Files Owned.** Per `feedback_scope_creep_subagent_pattern.md`. If you encounter a lint/typecheck error OUTSIDE your allow-list, STOP and report — do NOT fix.
4. **agent-sdk dual-barrel verified.** Per `project_agent_sdk_dual_barrel_exports.md`. Every new helper class MUST appear in BOTH `libs/backend/agent-sdk/src/lib/helpers/index.ts` AND `libs/backend/agent-sdk/src/index.ts` — grep both files for the class name before commit. (R9)
5. **Concurrent agents on shared checkout.** Per `feedback_concurrent_agents_shared_checkout.md`. Run `git status --porcelain` before staging. Stage ONLY allow-list files. NEVER `git stash` / `git checkout --` sibling-agent WIP. If unstaged files outside your batch exist, leave them alone.
6. **Hexagonal + frontend↔backend isolation.** Backend depends on `platform-core` ports (never adapters). Frontend libs MUST NOT import backend libs and vice versa. `libs/shared` is the one bridge. New event-kind union extensions only flow frontend-ward via shared.
7. **Pre-commit hook must pass.** `nx affected -t typecheck` + `nx affected -t lint` + relevant Jest specs. If it fails, fix the underlying issue; do NOT bypass.

Additional invariants:

- **`catch (error: unknown)` everywhere.** Narrow with `instanceof Error` before `.message`.
- **Memory + Skills are Electron-only.** Per `project_thoth_electron_only.md`. NO additions to `apps/ptah-extension-vscode` or `apps/ptah-cli`.
- **DI cycles forbidden.** Trigger services depend on registries; registries NEVER depend on triggers. New tokens are `Symbol.for(...)`.
- **RPC dual-registration.** Already satisfied for `memory:` and `skillSynthesis:` prefixes. Zero new namespaces. Zero edits to `rpc-handler.ts:44`'s `ALLOWED_METHOD_PREFIXES`.
- **Commitlint scopes.** Backend = `electron`; frontend = `webview`; CI = `ci`; docs = no scope. Per `project_commitlint_scope_mapping.md`.

---

## Wave 1a — Scaffold

### Batch 0 — Token + Type + Settings Scaffold ✅ COMPLETE (620453a2)

**Wave**: 1a
**Recommended Executor**: backend-developer
**Fallback Executor**: backend-developer (re-spawn with detailed errors if rejected)
**Execution Mode**: sequential (single agent; 4 files; gates all of W1b)
**Rationale**: Cross-cutting scaffold that eliminates inter-batch merge conflicts in Wave 1b. Tokens stand alone as `Symbol.for(...)` values — no class import needed yet. Shared event-kind union extensions and 9 new settings keys all consolidate here so B1/B2/B3/B4 can fan out file-disjoint after this lands.
**Commit Scope**: `feat(electron): batch 0 - sdk-hook trigger expansion scaffold`
**Dependencies**: NONE
**Estimated Test Count**: 5+ (settings-keys alignment) + compile-time guards via existing union-coverage assertions

**Files Owned** (EDIT-only, no new files):

- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/di/tokens.ts` — add 6 token symbols:
  - `SDK_SUBAGENT_STOP_CALLBACK_REGISTRY = Symbol.for('SdkSubagentStopCallbackRegistry')`
  - `SDK_POST_TOOL_USE_CALLBACK_REGISTRY = Symbol.for('SdkPostToolUseCallbackRegistry')`
  - `SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY = Symbol.for('SdkUserPromptSubmitCallbackRegistry')`
  - `SDK_POST_TOOL_USE_HOOK_HANDLER = Symbol.for('SdkPostToolUseHookHandler')`
  - `SDK_USER_PROMPT_SUBMIT_HOOK_HANDLER = Symbol.for('SdkUserPromptSubmitHookHandler')`
  - `SDK_CURATOR_RATE_LIMIT = Symbol.for('SdkCuratorRateLimit')`
- `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts` — extend (UNION-ONLY):
  - `MemoryCuratorEventKind` add: `'user-cue-trigger'`, `'commit-detect'`, `'rate-limited'`
  - `SkillSynthesisEventKind` add: `'subagent-stop'`, `'edit-then-test'`, `'rate-limited'`
  - **DEFERRED to B6/B7**: `MemoryTriggersDto` and `SkillTriggersDto` field additions move to B6 / B7 along with their consumer wiring (Zod schemas, set/get handlers, diagnostics projections, upstream snapshot shapes). Reason: nested optional DTO additions cascade through 5+ consumer files (memory-rpc.schema.ts, skills-synthesis-rpc.schema.ts, memory-rpc.handlers.ts setTriggers/readMemoryTriggers/diagnostics projection, skills-synthesis-rpc.handlers.ts mirror, and the upstream MemoryDiagnosticsSnapshot / SkillSynthesisDiagnosticsSnapshot types in libs/backend/memory-curator + libs/backend/skill-synthesis). Landing the DTO without the consumers leaves half-finished pipes.
- `D:/projects/ptah-extension/libs/backend/platform-core/src/file-settings-keys.ts` — add 9 keys + defaults per plan §8.1:

  | Key | Type | Default |
  |-----|------|---------|
  | `memory.triggers.userPromptSubmit.enabled` | boolean | `true` |
  | `memory.triggers.userPromptSubmit.cueList` | string[] | the 7 default cues from plan §1 Q4 |
  | `memory.triggers.userPromptSubmit.minPromptLength` | number | `20` |
  | `memory.triggers.postToolUse.enabled` | boolean | `true` |
  | `memory.triggers.maxCuratesPerHour` | number | `12` |
  | `skillSynthesis.triggers.subagentStop.enabled` | boolean | `true` |
  | `skillSynthesis.triggers.postToolUse.enabled` | boolean | `true` |
  | `skillSynthesis.triggers.postToolUse.minEditCount` | number | `3` |
  | `skillSynthesis.triggers.maxAnalyzesPerHour` | number | `6` |

- `D:/projects/ptah-extension/libs/backend/platform-core/src/file-settings-keys.spec.ts` — extend alignment spec to cover all 9 new keys appear in both `FILE_BASED_SETTINGS_KEYS` and `FILE_BASED_SETTINGS_DEFAULTS` with matching default values

**STRICT scope-creep rule**: Do NOT create `register.ts` edits, barrel re-exports, or any helper file in this batch. Those edits belong to B1/B2/B3/B4. If you touch them, STOP and report.

**Acceptance Criteria**:

- [ ] All 6 new tokens compile standalone (no class imports — Symbol values stand alone)
- [ ] Both event-kind unions cover the 6 new variants
- [ ] Both DTO extensions compile against existing 126 setTriggers/getTriggers handlers (optional/Partial keys)
- [ ] `file-settings-keys.spec.ts` asserts all 9 new keys + matching defaults
- [ ] `npx nx typecheck @ptah-extension/agent-sdk @ptah-extension/shared @ptah-extension/platform-core` passes
- [ ] `npx nx test @ptah-extension/platform-core` passes (alignment spec)
- [ ] `git status --porcelain` shows ONLY allow-list files

**Atomic Task — Hard Rules Echo**: No `--no-verify`. No explanatory comments. No scope creep. agent-sdk dual-barrel N/A in this batch (no helper exports). Concurrent-agent discipline. Hexagonal isolation. Pre-commit must pass.

---

## Wave 1b — Foundations (parallel: B1 + B2 + B3 + B4, file-disjoint after B0)

### Batch 1 — SubagentStopCallbackRegistry ✅ COMPLETE (a762c378)

**Wave**: 1b
**Recommended Executor**: backend-developer
**Fallback Executor**: backend-developer
**Execution Mode**: parallel with B2, B3, B4
**Rationale**: One new registry + spec + DI registration + dual-barrel re-export. Smallest of the four Wave 1b registries; mirrors `SessionActivityRegistry` exactly per plan §3.1.
**Commit Scope**: `feat(electron): batch 1 - subagent-stop callback registry`
**Dependencies**: B0 (token already declared)
**Estimated Test Count**: 5 (register/dispose, notifyAll fan-out, async-throw isolation, capacity invariants, DI resolution)

**Files Owned**:

- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/subagent-stop-callback-registry.ts` (NEW)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/subagent-stop-callback-registry.spec.ts` (NEW)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/di/register.ts` (EDIT — register THIS registry only; touch ONLY the new block, do not modify B2/B3/B4 registrations)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/index.ts` (EDIT — re-export `SubagentStopCallbackRegistry`, `SubagentStopCallback`, `SubagentStopPayload` only)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/index.ts` (EDIT — re-export same 3 symbols only)

**Pre-Read**:
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/session-activity-registry.ts` (canonical mirror)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/session-activity-registry.spec.ts`

**Public surface** (per plan §3.1):

```typescript
export interface SubagentStopPayload {
  readonly subagentSessionId: string;
  readonly parentSessionId: string;
  readonly workspaceRoot: string;
  readonly agentId: string;
  readonly agentType: string;
  readonly transcriptPath: string;
  readonly timestamp: number;
}
export type SubagentStopCallback = (payload: SubagentStopPayload) => void | Promise<void>;
@injectable()
export class SubagentStopCallbackRegistry { /* mirror SessionActivityRegistry */ }
```

**STRICT scope-creep rule**: `di/register.ts`, `helpers/index.ts`, `src/index.ts` are SHARED EDIT files within Wave 1b — touch ONLY the new block for THIS registry. Each B1/B2/B3/B4 owns exactly one block per file. If your line-range overlaps with sibling-agent edits, STOP and report (do NOT merge their changes).

**Acceptance Criteria**:

- [ ] Class mirrors `SessionActivityRegistry` shape (eventemitter3, error-wrapped fan-out, `size` getter)
- [ ] Spec ≥3 cases: register/dispose lifecycle, notifyAll fan-out, async-throw isolation
- [ ] DI test resolves token via `container.resolve(SDK_TOKENS.SDK_SUBAGENT_STOP_CALLBACK_REGISTRY)` successfully
- [ ] Grep verifies `SubagentStopCallbackRegistry` appears in BOTH `helpers/index.ts` AND `src/index.ts` (R9)
- [ ] `npx nx test @ptah-extension/agent-sdk` passes
- [ ] Coverage ≥80% on new file

**Atomic Task — Hard Rules Echo**: No `--no-verify`. No explanatory comments. No scope creep. **agent-sdk dual-barrel re-exports verified — grep BOTH `helpers/index.ts` AND `src/index.ts` before commit (R9)**. Concurrent-agent discipline — your edits to `register.ts`, `helpers/index.ts`, `src/index.ts` are surgical-block-only; if a sibling agent's block is also present, leave it alone. Hexagonal isolation. Pre-commit must pass.

---

### Batch 2 — PostToolUseCallbackRegistry + PostToolUseHookHandler ✅ COMPLETE (4eb6619a)

**Wave**: 1b
**Recommended Executor**: backend-developer
**Fallback Executor**: backend-developer
**Execution Mode**: parallel with B1, B3, B4
**Rationale**: One new registry + one new hook handler + spec. The hook handler is a brand-new SDK hook entry (PostToolUse has no existing handler). Mirrors `CompactionHookHandler` shape per plan §4.2.
**Commit Scope**: `feat(electron): batch 2 - post-tool-use callback registry + hook handler`
**Dependencies**: B0 (tokens already declared)
**Estimated Test Count**: 8 (4 registry + 4 hook handler)

**Files Owned**:

- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/post-tool-use-callback-registry.ts` (NEW)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/post-tool-use-callback-registry.spec.ts` (NEW)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/post-tool-use-hook-handler.ts` (NEW)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/post-tool-use-hook-handler.spec.ts` (NEW)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/di/register.ts` (EDIT — register 2 singletons in their own block)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/index.ts` (EDIT — re-export 5 symbols: class + payload + callback for registry; class for hook handler)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/index.ts` (EDIT — re-export same 5 symbols)

**Pre-Read**:
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts` (canonical hook handler mirror, lines 123-230)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/session-activity-registry.ts` (registry mirror)
- `claude-sdk.types.ts:518-522` — `isPostToolUseHook` type guard

**Public surfaces** (per plan §3.2 + §4.2):

```typescript
export interface PostToolUsePayload {
  readonly toolName: string;
  readonly toolInput: unknown;
  readonly toolOutput: unknown;
  readonly exitCode: number | null;
  readonly success: boolean;
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly timestamp: number;
}
```

Hook handler `createHooks(sessionId, cwd)` returns `{ PostToolUse: [{ hooks: [...] }] }`. Inner hook ALWAYS returns `{ continue: true }`; type-guards input via `isPostToolUseHook`; on valid input calls `this.callbackRegistry.notifyAll({...})` wrapped in `try/catch (error: unknown)`.

**STRICT scope-creep rule**: Surgical-block-only edits to `register.ts`, both barrels. Do NOT touch `sdk-query-options-builder.ts` or `sdk-query-runner.service.ts` — those edits belong to B5. Do NOT modify other hook handlers.

**Acceptance Criteria**:

- [ ] Registry mirrors `SessionActivityRegistry` shape per plan §3.2
- [ ] Hook handler mirrors `CompactionHookHandler.createHooks(...)` shape; ALWAYS returns `{continue:true}`; never throws
- [ ] Registry spec ≥3 cases (register/dispose, notifyAll fan-out, async-throw isolation)
- [ ] Hook handler spec ≥4 cases: happy path notifies registry, ill-typed input early-return, registry-throw swallowed, returns `{continue:true}` on all paths
- [ ] Grep verifies both classes appear in BOTH barrels (R9)
- [ ] `npx nx test @ptah-extension/agent-sdk` passes
- [ ] Coverage ≥80% on each new file

**Atomic Task — Hard Rules Echo**: No `--no-verify`. No explanatory comments. No scope creep — do NOT wire into `sdk-query-options-builder.ts` (that's B5's job). **agent-sdk dual-barrel verified for BOTH new classes (R9)**. Concurrent-agent surgical-block discipline. Hexagonal isolation. Pre-commit must pass.

---

### Batch 3 — UserPromptSubmitCallbackRegistry + UserPromptSubmitHookHandler ✅ COMPLETE (22ff1a7c)

**Wave**: 1b
**Recommended Executor**: backend-developer
**Fallback Executor**: backend-developer
**Execution Mode**: parallel with B1, B2, B4
**Rationale**: Mirror of B2 for the UserPromptSubmit SDK hook. Same shape, same mirror patterns, same registration pattern. File-disjoint from B2 except for the shared register/barrel files (surgical-block-only).
**Commit Scope**: `feat(electron): batch 3 - user-prompt-submit callback registry + hook handler`
**Dependencies**: B0
**Estimated Test Count**: 8 (4 registry + 4 hook handler)

**Files Owned**:

- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-callback-registry.ts` (NEW)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-callback-registry.spec.ts` (NEW)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.ts` (NEW)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.spec.ts` (NEW)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/di/register.ts` (EDIT — register 2 singletons in own block)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/index.ts` (EDIT — re-export 5 symbols)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/index.ts` (EDIT — re-export 5 symbols)

**Pre-Read**: Same as B2 (`compaction-hook-handler.ts`, `session-activity-registry.ts`). Verify `isUserPromptSubmitHook` type guard exists in `claude-sdk.types.ts`; if missing, add per the `isPostToolUseHook` pattern (within this batch's allow-list scope only if it's a small additive type guard).

**Public surface** (per plan §3.3 + §4.3):

```typescript
export interface UserPromptSubmitPayload {
  readonly prompt: string;
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly timestamp: number;
}
```

Hook handler payload extraction: `{ prompt: input.prompt, sessionId, workspaceRoot: cwd, timestamp: Date.now() }`. Always `{continue:true}`.

**STRICT scope-creep rule**: Same as B2. Do NOT touch `sdk-query-options-builder.ts` / `sdk-query-runner.service.ts` (B5).

**Acceptance Criteria**:

- [ ] Mirror of B2 acceptance for UserPromptSubmit
- [ ] Both classes appear in BOTH barrels (grep verified — R9)
- [ ] Coverage ≥80% on each new file

**Atomic Task — Hard Rules Echo**: No `--no-verify`. No explanatory comments. No scope creep. **agent-sdk dual-barrel verified (R9)**. Concurrent-agent surgical-block discipline. Hexagonal isolation. Pre-commit must pass.

---

### Batch 4 — CuratorRateLimitService ✅ COMPLETE (d8cc82c2)

**Wave**: 1b
**Recommended Executor**: backend-developer
**Fallback Executor**: backend-developer
**Execution Mode**: parallel with B1, B2, B3
**Rationale**: Standalone fixed-bucket rate-limiter shared across memory + skill pipelines. No SDK dependencies; pure `Map<string, BucketState>`. Lives in `agent-sdk` because both consumer libs already import from agent-sdk. Plan §5.
**Commit Scope**: `feat(electron): batch 4 - curator rate-limit service`
**Dependencies**: B0 (token already declared)
**Estimated Test Count**: 6 (allow-first-N, block-N+1, hour-rollover, zero-maxPerHour, multi-key isolation, snapshot)

**Files Owned**:

- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/curator-rate-limit.service.ts` (NEW)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/curator-rate-limit.service.spec.ts` (NEW)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/di/register.ts` (EDIT — register 1 singleton in own block)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/index.ts` (EDIT — re-export `CuratorRateLimitService`)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/index.ts` (EDIT — re-export `CuratorRateLimitService`)

**Algorithm** (plan §5.2): `tryAcquire(key, maxPerHour)` → `{allowed:true}` or `{allowed:false, resetAt, usedThisWindow}`. Fixed-bucket: `windowStartMs = Math.floor(now / HOUR_MS) * HOUR_MS`; reset counter when window rolls. `maxPerHour <= 0` short-circuits to allow-all. Also expose `snapshot(key): {windowStartMs, count} | null`.

**Spec must use `jest.useFakeTimers()`** for hour-rollover assertion.

**STRICT scope-creep rule**: Do NOT consume the service from `memory-trigger.service.ts` or `skill-trigger.service.ts` (B6/B7). Do NOT add settings reads (the limit value is passed by the caller).

**Acceptance Criteria**:

- [ ] `tryAcquire(key, maxPerHour)` first N calls return `{allowed:true}`; (N+1)th returns `{allowed:false, resetAt, usedThisWindow}`
- [ ] Hour-boundary rollover resets counter (fake-timer test)
- [ ] `maxPerHour <= 0` returns `{allowed:true}` always
- [ ] Multi-key isolation: `'memory.curate'` and `'skill.analyze'` buckets are independent
- [ ] `snapshot(key)` returns `null` for unknown keys
- [ ] Class appears in BOTH barrels (R9)
- [ ] Coverage ≥80%

**Atomic Task — Hard Rules Echo**: No `--no-verify`. No explanatory comments. No scope creep — do NOT consume the service from trigger services (B6/B7). **agent-sdk dual-barrel verified (R9)**. Concurrent-agent surgical-block discipline (your `register.ts` / barrel block is one of four in Wave 1b — sibling agents own the others). Hexagonal isolation. Pre-commit must pass.

---

## Wave 2 — SDK Fire-Point Integration

### Batch 5 — Wire registries into SDK hook firings ✅ COMPLETE (6fdace8a)

**Wave**: 2
**Recommended Executor**: backend-developer
**Fallback Executor**: backend-developer
**Execution Mode**: sequential (single batch, multi-file but tightly coupled — splitting risks merger drift)
**Rationale**: Three SDK fire-points (extend existing `SubagentHookHandler.handleSubagentStop`; merge new PostToolUse hook into `sdk-query-options-builder.createHooks`; same for UserPromptSubmit; mirror the merger addition in `sdk-query-runner.service.ts` one-shot path). Single agent owns the merger consistency.
**Commit Scope**: `feat(electron): batch 5 - wire subagent-stop / post-tool-use / user-prompt-submit hook firings`
**Dependencies**: B1 (SubagentStopCallbackRegistry), B2 (PostToolUseHookHandler), B3 (UserPromptSubmitHookHandler)
**Estimated Test Count**: 12 (3 per hook × 3 hooks + 3 for the merger)

**Files Owned**:

- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts` (EDIT — extend `handleSubagentStop` per plan §4.1: inject `SubagentStopCallbackRegistry`, derive `subagentSessionId` via `deriveSubagentSessionId(input.agent_transcript_path)`, call `notifyAll` wrapped in try/catch; never throw from hook)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.spec.ts` (EDIT — add ≥3 specs: positive notifyAll, null-derive logged-and-skipped, registry-throw swallowed)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (EDIT — wire new hooks per plan §4.2 / §4.3: inject `PostToolUseHookHandler` + `UserPromptSubmitHookHandler`; add their `createHooks(...)` to the merger array at line ~986)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts` (EDIT — mock the new hook handlers; assert `createHooks` invoked; snapshot `Object.keys(mergedHooks)` includes `PostToolUse` and `UserPromptSubmit`)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts` (EDIT — mirror merger addition in one-shot path at lines 438-440)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.spec.ts` (EDIT — assertions for new hook handlers in one-shot path)

**Critical guidance** (R6): EXTEND the existing `SubagentHookHandler.handleSubagentStop` — do NOT add a second SDK hook entry for SubagentStop. PostToolUse and UserPromptSubmit get new handler entries (no existing entry); SubagentStop already has one.

**`deriveSubagentSessionId` helper** (per plan §1 Q5):

```typescript
function deriveSubagentSessionId(agentTranscriptPath: string): string | null {
  const match = /([0-9a-f-]{36})\.jsonl$/i.exec(agentTranscriptPath);
  return match ? match[1] : null;
}
```

**STRICT scope-creep rule**: Do NOT modify other SDK hook handlers (CompactionHookHandler, WorktreeHookHandler). Do NOT touch trigger services in `memory-curator` / `skill-synthesis` (B6/B7). Do NOT register new tokens (already done in B0; classes registered in B1/B2/B3). Do NOT bypass pre-commit if dependent typecheck warnings surface from B1/B2/B3 sibling-agent WIP — STOP and report.

**Acceptance Criteria**:

- [ ] SubagentStop: `handleSubagentStop` calls `SubagentStopCallbackRegistry.notifyAll(...)` with derived subagent sessionId; null-derive logs warn and skips notifyAll; throws are swallowed
- [ ] PostToolUse: hook registered via new handler; fires `PostToolUseCallbackRegistry.notifyAll(...)` with full payload; always returns `{continue:true}`
- [ ] UserPromptSubmit: identical pattern
- [ ] `createHooks` merged output includes the new hook entries (assertion via `Object.keys(mergedHooks)` snapshot)
- [ ] `sdk-query-runner.service.ts` one-shot path mirrors the merger addition
- [ ] `npx nx test @ptah-extension/agent-sdk` passes
- [ ] Coverage ≥80% on edited files

**Atomic Task — Hard Rules Echo**: No `--no-verify`. No explanatory comments. No scope creep — EXTEND existing `handleSubagentStop`, do NOT add a second hook entry (R6). agent-sdk dual-barrel unaffected (no new helper classes in this batch). Concurrent-agent discipline (Wave 2 is sequential — should be sole agent in agent-sdk). Hexagonal isolation. Pre-commit must pass.

---

## Wave 3 — Trigger Service Subscriptions (parallel: B6 + B7)

### Batch 6 — Memory trigger expansion ✅ COMPLETE (79bc12d7)

**Wave**: 3
**Recommended Executor**: backend-developer
**Fallback Executor**: backend-developer
**Execution Mode**: parallel with B7 (file-disjoint: memory-curator vs skill-synthesis libs; rpc-handlers schema/handler files are pipeline-specific — `memory-rpc.*` here, `skills-synthesis-rpc.*` in B7)
**Rationale**: Extend `MemoryTriggerService` with 2 new subscriptions (UserPromptSubmit + PostToolUse), inline commit-detect handler, inline cue-list compile-cache, rate-limiter consultation. Plus RPC schema/handler extensions for new settings keys.
**Commit Scope**: `feat(electron): batch 6 - memory trigger user-prompt-submit + post-tool-use subscriptions`
**Dependencies**: B0 (types + settings keys), B1 (SubagentStopCallbackRegistry — not consumed but ensures token exists), B2 (PostToolUseCallbackRegistry), B3 (UserPromptSubmitCallbackRegistry), B4 (CuratorRateLimitService), B5 (fire-points wired)
**Estimated Test Count**: 12+ (9 trigger specs + 3 lifecycle)

**Files Owned**:

- `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts` (EDIT — extend `MemoryTriggersDto` with new optional nested fields: `userPromptSubmit?`, `postToolUse?`, `maxCuratesPerHour?` per plan §8.1)
- `D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts` (EDIT — inject `UserPromptSubmitCallbackRegistry`, `PostToolUseCallbackRegistry`, `CuratorRateLimitService`; add `onUserPromptSubmit`, `onPostToolUse` handlers per plan §6.1 + §7; subscribe/unsubscribe disposers; extend `start()/stop()`)
- `D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.spec.ts` (EDIT — ≥9 new specs)
- `D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/diagnostics.service.ts` (EDIT — extend `MemoryDiagnosticsSnapshot.triggers` to include the new nested fields surfaced in the DTO)
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.schema.ts` (EDIT — extend `MemoryTriggersSchema` per plan §8.2: nested optional shapes mirroring DTO, with Zod refinements: cueList max 50 entries of strings min 1 max 200 chars; minPromptLength int 0..10000; maxCuratesPerHour int 0..1000; enabled booleans)
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts` (EDIT — rewrite `setTriggers` iteration to walk nested values and emit one `setConfiguration(...)` per flat dotted leaf; extend `readMemoryTriggers` to read the new flat keys and reconstruct nested DTO; extend `MEMORY_TRIGGER_KEYS` const or replace with a tree-flattener helper; extend diagnostics projection to include new nested triggers)
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.spec.ts` (EDIT — round-trip tests for new fields, including nested-object persistence + reconstruction)

**R14 verification step**: B6 sub-agent MUST read `D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/memory-curator.service.ts` and verify whether `curate(...)` accepts a `transcript` param. If YES, forward `payload.prompt` as `transcript` for higher fidelity. If NO, plain `curate({sessionId, workspaceRoot})` still works. Document the choice in the commit body.

**Commit-detect FSM** (plan §6.1, inline in service):
```typescript
private onPostToolUse(payload: PostToolUsePayload): void {
  if (payload.toolName !== 'Bash') return;
  if (!payload.success || payload.exitCode !== 0) return;
  const command = this.extractBashCommand(payload.toolInput);
  if (!command || !/^\s*git\s+commit\b/.test(command)) return;
  if (!this.readPostToolUseEnabledFlag()) return;
  const decision = this.rateLimiter.tryAcquire('memory.curate', this.readMaxCuratesPerHour());
  if (!decision.allowed) { /* push rate-limited event, return */ }
  this.curator.pushEvent({ kind: 'commit-detect', timestamp: Date.now(), sessionId: payload.sessionId });
  void this.invokeCurate(payload.sessionId, payload.workspaceRoot, 'commit-detect');
}
```

**User-cue handler** (plan §7, inline in service) with compile-regex cache. Uses 7 default cues from B0 settings. Skip prompts shorter than `memory.triggers.userPromptSubmit.minPromptLength`.

**STRICT scope-creep rule**: Do NOT touch `skill-synthesis` lib (B7's territory — even though both touch rpc-handlers, the schema/handler files are pipeline-specific: B6 owns `memory-rpc.*`, B7 owns `skills-synthesis-rpc.*`). Do NOT touch UI libs (B8). Do NOT touch wire-runtime.ts (B9). Do NOT modify `MemoryCuratorService.curate(...)` signature — only consume it.

**Acceptance Criteria** (≥9 spec scenarios per plan §10):

- [ ] user-cue: cue match in prompt of length ≥minPromptLength fires `memory.curate` and pushes `'user-cue-trigger'` event with `stats.cue`
- [ ] user-cue: same cue when rate-limit exhausted → pushes `'rate-limited'` event with `stats.limit`, `stats.resetAt`; no curate call
- [ ] user-cue: prompt of length <minPromptLength skipped even with cue match
- [ ] commit-detect: `Bash` with `git commit -m "x"` + exitCode 0 + success → fires curate + `'commit-detect'` event
- [ ] commit-detect: same command with exitCode !== 0 → no fire
- [ ] commit-detect: non-Bash tool (e.g. `Edit`) ignored entirely
- [ ] rate-limited (memory): 13th curate call within hour pushes `'rate-limited'`
- [ ] rate-limited (memory): hour rollover allows again
- [ ] rate-limited (memory): `maxCuratesPerHour: 0` short-circuits to allow-all
- [ ] postToolUse `enabled: false` flag short-circuits handler
- [ ] Lifecycle: start/stop disposers attach + detach the 2 new subscriptions
- [ ] Settings race (R10): flip cueList while service running → next event uses new compiled cues
- [ ] RPC round-trip: new MemoryTriggersDto fields persist through setTriggers + getTriggers
- [ ] Trigger service uses REAL `CuratorRateLimitService` instance (NOT a mock) per R11

**Atomic Task — Hard Rules Echo**: No `--no-verify`. No explanatory comments — type/method names + describe/it blocks carry semantics. No scope creep — do NOT modify `MemoryCuratorService.curate(...)` signature; do NOT touch skill-synthesis lib; do NOT touch `skills-synthesis-rpc.*`. agent-sdk dual-barrel N/A (no new helper exports). Concurrent-agent discipline — B7 is running in parallel; both touch `rpc-handlers` lib but DIFFERENT files (B6 = `memory-rpc.*`; B7 = `skills-synthesis-rpc.*`). Hexagonal isolation (use real `CuratorRateLimitService` from `@ptah-extension/agent-sdk`, NOT a stub). Pre-commit must pass.

---

### Batch 7 — Skill trigger expansion ✅ COMPLETE (33d04f00)

**Wave**: 3
**Recommended Executor**: backend-developer
**Fallback Executor**: backend-developer
**Execution Mode**: parallel with B6 (file-disjoint)
**Rationale**: Extend `SkillTriggerService` with 2 new subscriptions (SubagentStop + PostToolUse), inline edit-then-test FSM, rate-limiter consultation. Plus RPC schema/handler extensions.
**Commit Scope**: `feat(electron): batch 7 - skill trigger subagent-stop + post-tool-use subscriptions`
**Dependencies**: B0, B1, B2, B4, B5
**Estimated Test Count**: 12+

**Files Owned**:

- `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts` (EDIT — extend `SkillTriggersDto` with new optional nested fields: `subagentStop?`, `postToolUse?`, `maxAnalyzesPerHour?` per plan §8.1) **SHARED FILE w/ B6 — both add to disjoint DTOs (Memory vs Skill); team-leader must coordinate ordering or run B7 after B6's DTO addition lands. Recommended: run B6 first, then B7 picks up B6's commit as base.**
- `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts` (EDIT — inject `SubagentStopCallbackRegistry`, `PostToolUseCallbackRegistry`, `CuratorRateLimitService`; add `onSubagentStop`, `onPostToolUse` handlers per plan §4.1 + §6.2; subscribe/unsubscribe disposers; extend `start()/stop()`; extend existing `onSessionEnd` to clear FSM state per R3)
- `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.spec.ts` (EDIT — ≥9 new specs)
- `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/diagnostics.service.ts` (EDIT — extend `SkillSynthesisDiagnosticsSnapshot.triggers` to include the new nested fields)
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts` (EDIT — extend `SkillTriggersSchema` per plan §8.2: nested optional shapes mirroring DTO, with Zod refinements; minEditCount int 1..20; maxAnalyzesPerHour int 0..1000)
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts` (EDIT — mirror B6's `setTriggers`/`readSkillTriggers` rewrite for skill side; extend `SKILL_TRIGGER_KEYS` flattener; extend diagnostics projection)
- `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts` (EDIT)

**Edit-then-test FSM** (plan §6.2, inline in service):
- `Map<sessionId, EditTestState>` with `{ workspaceRoot, editCount, lastEditAt, windowStartAt }`
- `EDIT_TOOL_NAMES = new Set(['Edit', 'Write', 'MultiEdit'])`
- `TEST_PATTERN = /\b(npm|pnpm|yarn|jest|vitest|nx)\s+(test|run\s+test)\b/`
- `EDIT_WINDOW_MS = 10 * 60 * 1000`
- Reset on positive match, on `SessionEnd`, or on next event after TTL expiry
- Min edit count from `skillSynthesis.triggers.postToolUse.minEditCount` (default 3)

**SubagentStop handler** (plan §4.1): on callback, derive `subagentSessionId` via `deriveSubagentSessionId(transcriptPath)`. On null, push `{kind: 'error', error: 'subagent-stop-no-sessionid'}` event and skip. On non-null, consult rate-limiter and call `skillSynthesis.analyzeSession(derivedId, workspaceRoot, { force: false })`. Push `'subagent-stop'` ring event.

**STRICT scope-creep rule**: Do NOT touch memory-curator lib (B6's territory). Do NOT touch UI libs (B8). Do NOT touch wire-runtime.ts (B9). Do NOT touch `memory-rpc.*` handler/schema. Do NOT modify `SkillSynthesisService.analyzeSession(...)` signature — only consume it. Do NOT touch `MemoryCuratorService.curate(...)`.

**Acceptance Criteria** (≥9 spec scenarios per plan §10):

- [ ] subagent-stop: callback with parseable `agent_transcript_path` derives subagent sessionId, calls `analyzeSession(derivedId, workspaceRoot, { force: false })`, pushes `'subagent-stop'` event
- [ ] subagent-stop: unparseable `agent_transcript_path` (no UUID) → no analyze call, pushes `'error'` event with `'subagent-stop-no-sessionid'`
- [ ] subagent-stop: rate-limited path → pushes `'rate-limited'` instead of analyze
- [ ] edit-then-test: 3 Edit events + 1 Bash with `npm test` exit 0 → fires analyze, pushes `'edit-then-test'` event with `stats.editCount`
- [ ] edit-then-test: only 2 Edits + same test → no fire (below minEditCount)
- [ ] edit-then-test: 3 Edits + Bash with `git status` → no fire (not a test command)
- [ ] edit-then-test: 3 Edits + 11 minutes later + Bash test → no fire (window expired)
- [ ] edit-then-test: SessionEnd between Edits and test → state cleared, no fire (R3)
- [ ] rate-limited (skill): 7th analyze call within hour pushes `'rate-limited'`
- [ ] rate-limited (skill): hour rollover allows again
- [ ] rate-limited (skill): `maxAnalyzesPerHour: 0` short-circuits to allow-all
- [ ] postToolUse `enabled: false` flag short-circuits handler
- [ ] Lifecycle: start/stop disposers attach + detach the 2 new subscriptions
- [ ] RPC round-trip: new SkillTriggersDto fields persist through setTriggers + getTriggers
- [ ] Trigger service uses REAL `CuratorRateLimitService` instance (R11)

**Atomic Task — Hard Rules Echo**: No `--no-verify`. No explanatory comments. No scope creep — do NOT touch memory-curator, do NOT touch `memory-rpc.*`. agent-sdk dual-barrel N/A. Concurrent-agent discipline (B6 running parallel; pipeline-specific file-disjoint). Hexagonal isolation. Pre-commit must pass.

---

## Wave 4 — UI + Activation Wiring (parallel: B8 + B9)

### Batch 8 — Memory + Skill diagnostics UI extension ✅ COMPLETE (9343e4bf)

**Wave**: 4
**Recommended Executor**: frontend-developer
**Fallback Executor**: frontend-developer
**Execution Mode**: parallel with B9 (file-disjoint: B8 = frontend libs, B9 = electron app)
**Rationale**: UI extension to render the 3 new event-kinds per pipeline + new toggle/number-input rows for the 9 new settings keys. Two parallel UI libs (memory + skill) but single agent to ensure visual consistency across both tabs.
**Commit Scope**: `feat(webview): batch 8 - diagnostics ui for new event-kinds + trigger toggles`
**Dependencies**: B0 (DTO + event-kind types in shared), B6 (memory server-side fields), B7 (skill server-side fields)
**Estimated Test Count**: 10+ (component renders + state-service DTO widening + toggle persistence)

**Files Owned**:

- `D:/projects/ptah-extension/libs/frontend/memory-curator-ui/src/lib/components/diagnostics/event-feed.component.ts` (EDIT — add cases for `'user-cue-trigger'`, `'commit-detect'`, `'rate-limited'`)
- `D:/projects/ptah-extension/libs/frontend/memory-curator-ui/src/lib/components/diagnostics/event-feed.component.spec.ts` (EDIT — render-test new cases)
- `D:/projects/ptah-extension/libs/frontend/memory-curator-ui/src/lib/components/diagnostics/memory-trigger-toggle.component.ts` (EDIT — new toggle rows: postToolUse, userPromptSubmit; new number inputs: maxCuratesPerHour, minPromptLength)
- `D:/projects/ptah-extension/libs/frontend/memory-curator-ui/src/lib/components/diagnostics/memory-trigger-toggle.component.spec.ts` (EDIT)
- `D:/projects/ptah-extension/libs/frontend/memory-curator-ui/src/lib/components/diagnostics/memory-diagnostics-accordion.component.ts` (EDIT — template wiring through toggle component if needed)
- `D:/projects/ptah-extension/libs/frontend/memory-curator-ui/src/lib/services/memory-diagnostics-state.service.ts` (EDIT — widen DTO type to accept new MemoryTriggersDto fields)
- `D:/projects/ptah-extension/libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/event-feed.component.ts` (EDIT — cases for `'subagent-stop'`, `'edit-then-test'`, `'rate-limited'`)
- `D:/projects/ptah-extension/libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/event-feed.component.spec.ts` (EDIT)
- `D:/projects/ptah-extension/libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-trigger-toggle.component.ts` (EDIT — new toggles: subagentStop, postToolUse; new number inputs: maxAnalyzesPerHour, minEditCount)
- `D:/projects/ptah-extension/libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-trigger-toggle.component.spec.ts` (EDIT)
- `D:/projects/ptah-extension/libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-state.service.ts` (EDIT)

**STRICT scope-creep rule**: Frontend libs MUST NOT import backend libs (hex isolation). Use ONLY `@ptah-extension/shared` for types. Do NOT touch backend service files. Do NOT touch RPC handler files. Do NOT touch wire-runtime.ts (B9).

**Acceptance Criteria**:

- [ ] Memory event-feed renders the 3 new kinds with distinct icons + messages
- [ ] Skill event-feed renders the 3 new kinds
- [ ] Trigger-toggle grids include new rows; clicking persists via existing `setTriggers` round-trip pattern (already proven by 126)
- [ ] Rate-limited rows show "Limit X/hour reached, resets at HH:MM" using `stats.resetAt`
- [ ] State services accept widened DTOs without runtime errors
- [ ] OnPush change-detection mandatory on all edited components (Angular signals)
- [ ] `[innerHTML]` NEVER used on AI-derived strings — if any string display, route through `libs/frontend/markdown`

**Atomic Task — Hard Rules Echo**: No `--no-verify`. No explanatory comments. No scope creep — frontend→backend isolation strict (use `@ptah-extension/shared` only). agent-sdk dual-barrel N/A (frontend batch). Concurrent-agent discipline (B9 running parallel; B9 = apps, B8 = libs/frontend; disjoint). Hexagonal + frontend↔backend isolation. Pre-commit must pass.

---

### Batch 9 — Electron activation wiring ✅ COMPLETE (verified, no commit)

**Wave**: 4
**Recommended Executor**: backend-developer
**Fallback Executor**: backend-developer
**Execution Mode**: parallel with B8
**Rationale**: Minimal verification batch — the registries are singleton-resolved on-demand by trigger services; the trigger services already call `.start()` from 126's `wire-runtime.ts` lines 274-280 / 306-312, which now extends to subscribing to the new registries automatically. Verify clean boot + clean shutdown.
**Commit Scope**: `feat(electron): batch 9 - verify activation wiring for new trigger subscriptions`
**Dependencies**: B6, B7
**Estimated Test Count**: 2 (activation log assertion + clean shutdown spec)

**Files Owned**:

- `D:/projects/ptah-extension/apps/ptah-electron/src/activation/wire-runtime.ts` (EDIT — likely zero net change; confirm trigger-service `.start()` calls fan out to new subscriptions; LIFO cleanup unchanged)
- Optionally: a small integration spec adjacent to `wire-runtime.ts` if log-assertion is needed

**STRICT scope-creep rule**: Do NOT add any new explicit `.start()` calls — the trigger services own their own subscriptions. Do NOT touch any backend service. Do NOT touch any UI lib (B8).

**Acceptance Criteria**:

- [ ] Electron boots cleanly with 5 subscriptions per trigger service active (verify via log assertion or boot-time spec)
- [ ] LIFO cleanup unchanged: existing `stop()` calls fan out to the new disposers
- [ ] NO VS Code or CLI wiring added (Memory + Skills are Electron-only per `project_thoth_electron_only.md`)
- [ ] `npx nx typecheck @ptah-extension/ptah-electron` passes
- [ ] `npx nx test @ptah-extension/ptah-electron` passes (if applicable specs exist)

**Atomic Task — Hard Rules Echo**: No `--no-verify`. No explanatory comments. No scope creep — do NOT add VS Code / CLI wiring; do NOT touch backend services or UI. agent-sdk dual-barrel N/A. Concurrent-agent discipline (B8 running parallel; disjoint scopes). Hexagonal isolation. Pre-commit must pass.

---

## Wave 5 — Integration Tests + QA

### Batch 10 — End-to-end integration tests ✅ COMPLETE (d6704e8e)

**Wave**: 5
**Recommended Executor**: backend-developer
**Fallback Executor**: backend-developer
**Execution Mode**: sequential (single batch)
**Rationale**: Three new integration specs that exercise the full event-loop end-to-end with mocked registries and real services. Joint memory+skill stress test under shared rate-limiter. Senior-tester reviews in QA phase.
**Commit Scope**: `test(electron): batch 10 - sdk-hook trigger integration suite`
**Dependencies**: ALL prior batches (B0..B9)
**Estimated Test Count**: 9+

**Files Owned**:

- `D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/triggers/memory-trigger.integration.spec.ts` (NEW — synthetic UserPromptSubmit + PostToolUse + SessionEnd full-loop tests using mocked registries + real `CuratorRateLimitService`)
- `D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.integration.spec.ts` (NEW — synthetic SubagentStop + PostToolUse FSM full-loop tests)
- `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/curator-rate-limit.integration.spec.ts` (NEW — joint memory+skill stress under shared rate-limiter)

**STRICT scope-creep rule**: Do NOT modify production code — these are spec-only files. If integration tests reveal bugs in production code, STOP and report to team-leader for a follow-up fix batch (do NOT patch silently). Do NOT bypass pre-commit if tests fail.

**Acceptance Criteria** (per plan §9 B10):

- [ ] Full scenario: user submits prompt with cue → `memory.curate` fires once → rate-limited at 13th call → next hour fires again
- [ ] Full scenario: subagent completes → `skillSynthesis.analyzeSession` fires with derived subagent sessionId
- [ ] Full scenario: Edit×3 + green test → analyze fires once → FSM resets → next Edit×2 + test does not fire
- [ ] Joint stress: 12 memory.curate + 6 skill.analyze in one hour → all allowed; 13th memory or 7th skill → blocked independently
- [ ] All existing 126 + 127 unit specs still pass (no regressions)
- [ ] Coverage report shows ≥80% across all new files from B1..B7

**Atomic Task — Hard Rules Echo**: No `--no-verify` (especially tempting at the end of a long task — STOP and report if anything fails). No explanatory comments. No scope creep — spec-only batch; production-code bugs go to follow-up fix batch. agent-sdk dual-barrel N/A. Concurrent-agent discipline (sole agent in Wave 5). Hexagonal isolation. Pre-commit must pass.

---

## Orchestrator Notes

### Execution Sequence

The orchestrator should drive these phases in order, spawning agents per the modes recommended in each batch:

1. **Wave 1a** — Spawn ONE backend-developer for B0. Wait for COMPLETE.
2. **Wave 1b** — Spawn FOUR backend-developers in parallel for B1, B2, B3, B4. They share `register.ts`, `helpers/index.ts`, `src/index.ts` for surgical-block edits — instruct each agent to touch ONLY their block per the per-batch allow-lists. Wait for all four COMPLETE.
3. **Wave 2** — Spawn ONE backend-developer for B5. Wait for COMPLETE.
4. **Wave 3** — Spawn TWO backend-developers in parallel for B6 and B7. They share `rpc-handlers` lib but DIFFERENT files (B6 owns `memory-rpc.*`; B7 owns `skills-synthesis-rpc.*`). Wait for both COMPLETE.
5. **Wave 4** — Spawn ONE frontend-developer for B8 + ONE backend-developer for B9 in parallel. Disjoint scopes (libs/frontend vs apps/ptah-electron). Wait for both COMPLETE.
6. **Wave 5** — Spawn ONE backend-developer for B10. Wait for COMPLETE.

### Parallel-Eligible Batches (file-disjoint within wave)

- Wave 1b: **B1 + B2 + B3 + B4** (4 concurrent agents) — surgical-block discipline on `register.ts` + both barrels; new helper files entirely disjoint
- Wave 3: **B6 + B7** (2 concurrent agents) — memory-curator vs skill-synthesis libs disjoint; rpc-handlers schema/handler files pipeline-specific
- Wave 4: **B8 + B9** (2 concurrent agents) — libs/frontend vs apps/ptah-electron disjoint

### Per-Batch Closeout (universal — applies to every batch)

For each batch, after the developer agent returns "BATCH N IMPLEMENTATION COMPLETE":

1. Verify all files in Files Owned exist with real code (no stubs, no `// TODO`)
2. Run `npx nx affected -t typecheck` and `npx nx affected -t lint`
3. Run `npx nx test <affected-projects>` — all specs must pass
4. Return `## NEEDS REVIEW — TASK_2026_127 Batch N` to orchestrator with file list + rejection criteria
5. On reviewer APPROVED verdict: discover ALL changed files via `git status --short` + `git diff --name-only` (include files the developer touched but didn't report — barrel exports, generated typecheck artifacts, etc.); stage explicit allow-list paths; commit with the batch's Commit Scope; never `--no-verify`
6. Update tasks.md: mark batch + tasks ✅ COMPLETE; record commit SHA
7. Advise orchestrator on next batch executor

### QA Phase (after B10 completes)

After Wave 5 finishes and B10's integration suite is green, the orchestrator should run a triple-review in parallel:

1. **code-style-reviewer** — file-by-file review across all 11 batches for style consistency, naming, comment-free invariant, OnPush + signals discipline (B8)
2. **code-logic-reviewer** — verify the 9 atomic event-loops + rate-limiter + FSMs do what specs claim; spot mocks-bypass-production-code patterns (R11); spot dual-barrel misses (R9)
3. **senior-tester** — verify test plan from plan §10 is fully realized; spot missing edge cases; spot mock-driven test bypasses (R11); verify integration specs in B10 use REAL `CuratorRateLimitService` instance

If any reviewer flags issues, spawn ONE **QA-fix-pass batch** (single backend-developer, sequential) scoped strictly to the reviewer findings. Allow-list = the union of flagged file paths. Do NOT broaden scope. Loop reviewer-fix-loop until all three reviewers return APPROVED.

After QA APPROVED: orchestrator invokes team-leader MODE 3 for completion handoff.

### Critical Verification Points (architect §15)

The orchestrator + team-leader must verify at each batch:

1. **agent-sdk dual-barrel** — grep for the new class name in BOTH `helpers/index.ts` AND `src/index.ts` before commit (R9). Lint will not catch this; downstream typecheck failure in B6/B7 is the only signal.
2. **No `--no-verify`** — hard stop-and-report rule echoed in every batch's atomic task description (R12).
3. **B5 extends existing `SubagentHookHandler`** — does NOT add a parallel hook entry (R6).
4. **R14 verification in B6** — sub-agent must read `memory-curator.service.ts` and document the `transcript` param choice in the commit body.
5. **Rate-limit specs use REAL `CuratorRateLimitService` instance**, not a mock (R11). Both B6 and B7 specs must instantiate the real class.
6. **FSM state cleared on SessionEnd in B7** (R3) — extend existing `onSessionEnd` to delete edit-test state.

### Files Affected Summary (architect §15 inventory)

- **CREATE**: 6 helper classes + 6 spec siblings + 3 integration specs in B10 = 15 new files
- **MODIFY**: ~20 files across agent-sdk + memory-curator + skill-synthesis + rpc-handlers + platform-core + shared + frontend libs + electron app

### Completion Criteria

All 11 batches ✅ COMPLETE + 11 commits on `feature/sdk-hook-triggers-task-2026-127` + triple-review APPROVED + integration suite green = ready for team-leader MODE 3 handoff.

---

## QA Phase

After Wave 5 completed, the orchestrator spawned three reviewers in parallel against the 10-commit range `620453a2..d6704e8e`. All three returned `APPROVED_WITH_FINDINGS` with zero Critical findings.

| Reviewer | Report | Verdict | Critical / Serious / Moderate / Minor |
|----------|--------|---------|----------------------------------------|
| code-style-reviewer | `.ptah/specs/TASK_2026_127/code-style-review.md` | APPROVED_WITH_FINDINGS | 0 / 3 / 5 / 3 |
| code-logic-reviewer | `.ptah/specs/TASK_2026_127/code-logic-review.md` | APPROVED_WITH_FINDINGS | 0 / 1 / 4 / 3 |
| senior-tester | `.ptah/specs/TASK_2026_127/test-report.md` | APPROVED_WITH_FINDINGS | 0 / 1 / 2 / 2 |
| **Total** | — | — | **0 / 5 / 11 / 8** |

A single QA fix-pass batch followed:

**QA Fix-Pass — `a3438899` `fix(electron): qa fix-pass - address triple-review findings`**

Closed findings:

- **logic F-1 (Serious)** — SubagentStop notifyAll gating relaxed; fans out whenever `agent_transcript_path` is parseable; `agentType: 'unknown'` fallback for registry-miss case.
- **logic F-2 (Moderate)** — PostToolUse + UserPromptSubmit hook handlers prefer `input.session_id` (SDK-guaranteed) over closure-captured value.
- **logic F-3 (Moderate)** — Empty-sessionId guard added at top of all 4 trigger handlers; pushes warn-log + early-returns before consuming rate-limit budget.
- **logic F-5 (Moderate)** — `COMMIT_PATTERN` tightened from `\b` to `(?:\s|$)` ; rejects `git-commit-hook` / `git-commit-tree` etc.
- **style F-3 (Serious)** — Diff scan verified this PR added zero new JSDoc/rationale blocks; the style-reviewer-flagged blocks at `di/tokens.ts`, `subagent-hook-handler.ts`, `sdk-query-options-builder.ts`, `memory-rpc.handlers.ts` are pre-existing per git-blame and out of scope per the strip-only-PR-added rule.
- **test F-1 (Serious)** — `subagent-hook-handler.spec.ts` refactored to use real `SubagentStopCallbackRegistry` + `register(capture)` pattern, mirroring `post-tool-use-hook-handler.spec.ts`. Closes R11 partial gap.
- **test F-3 (Moderate)** — Verified memory + skill event-feed UI specs already assert rate-limit indicator text contains limit value + HH:MM reset time; no edits needed.

Deferred findings (17 total) catalogued in `.ptah/specs/TASK_2026_127/future-enhancements.md`.

---

## MODE 3 — Completion

All 11 batches verified ✅ COMPLETE on `feature/sdk-hook-triggers-task-2026-127`. 10 batch commits + 1 QA fix-pass commit on the branch; B9 verified-no-commit (wire-runtime already covers new subscriptions via existing `.start()` calls). All 10 acceptance criteria from `context.md` met; triple-review approved; ~123 new spec cases added across 7 projects (vs architect's 75-90 estimate, ~+30% over). Zero `--no-verify` bypasses. No regressions vs TASK_2026_126. Branch is stacked on `feature/diagnostics-task-2026-126`; merge ordering (option a: separate PRs in sequence) awaits user decision.

See `.ptah/specs/TASK_2026_127/completion-report.md` for the full handoff summary and `.ptah/specs/TASK_2026_127/future-enhancements.md` for v2 follow-ups.
