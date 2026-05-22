# TASK_2026_127 — Future Enhancements (v2 Follow-Ups)

This document captures every finding deferred by the QA fix-pass for TASK_2026_127 plus the original-spec items the architect placed in §"Out of Scope (v2+)". Items are grouped by category and ranked by priority. Effort estimates: **S** = <1 day, **M** = 1-3 days, **L** = >3 days.

---

## Architectural Refactors

### v2-1 — Extract generic `CallbackRegistry<TPayload>` base

- **Source**: code-style-review F-1 (Serious)
- **Files**:
  - `libs/backend/agent-sdk/src/lib/helpers/subagent-stop-callback-registry.ts`
  - `libs/backend/agent-sdk/src/lib/helpers/post-tool-use-callback-registry.ts`
  - `libs/backend/agent-sdk/src/lib/helpers/user-prompt-submit-callback-registry.ts`
- **Issue**: Three byte-near-identical registries; combined with `SessionEndCallbackRegistry`, `SessionActivityRegistry`, `CompactionCallbackRegistry`, `SubagentMessageDispatcher` the codebase now has 7-8 near-duplicate registries. The pattern is clearly a class template.
- **Recommended fix**: Extract `helpers/callback-registry.base.ts` with `CallbackRegistry<TPayload>` (or a factory `createCallbackRegistry<TPayload>(eventName, logScope)`). Three new classes shrink to ~10 LOC each declaring payload type + event name. Cuts ~180 LOC, removes 3× drift risk on error-handling semantics.
- **Effort**: M
- **Priority**: P1 — Will compound on the next hook (PreToolUse, Notification, SessionStart).

### v2-2 — Hoist trigger-config read ladder into per-pipeline `*-config.ts`

- **Source**: code-style-review F-2 (Serious)
- **Files**:
  - `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:28-62, 411-481`
  - `libs/backend/memory-curator/src/lib/diagnostics.service.ts:22-55, 93-161`
  - `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:69-101, 652-720`
  - Skill mirrors at `skill-trigger.service.ts:31-49, 373-425`, `diagnostics.service.ts:13-31, 84-138`, `skills-synthesis-rpc.handlers.ts:88-104, 645-699`
- **Issue**: Same 9 memory-trigger keys + 9 defaults + 9 `getConfiguration<T>(...) ?? DEFAULTS.X` reads reproduced 3× per pipeline. `DEFAULT_CUE_LIST` literally exists in two files. Adding one trigger key requires 6 edits in lockstep across 2 libs.
- **Recommended fix**: Move key constants + defaults + a pure function `readMemoryTriggers(ws: IWorkspaceProvider): MemoryTriggersDto` into `libs/backend/memory-curator/src/lib/triggers/memory-trigger-config.ts` (and skill equivalent). Trigger service, diagnostics, and RPC handler all call the same reader. Same for `MEMORY_TRIGGER_PREFIXES` / `SKILL_TRIGGER_PREFIXES` flattener-maps.
- **Effort**: M
- **Priority**: P1 — Three sites reading the same 9 keys is the kind of debt that bites a maintainer in 6 months.

### v2-3 — Workspace fingerprinting for rate-limiter keys

- **Source**: implementation-plan.md §"R4 mitigation deferred"
- **Files**: `libs/backend/agent-sdk/src/lib/helpers/curator-rate-limit.service.ts`, both trigger services
- **Issue**: v1 uses workspace-wide keys (`'memory.curate'` / `'skill.analyze'`). Two workspaces sharing one Electron instance share the bucket → one workspace can starve the other.
- **Recommended fix**: Include workspace fingerprint (hash of workspaceRoot) in the rate-limit key: `'memory.curate::<wsHash>'`.
- **Effort**: S
- **Priority**: P2 — Only matters for multi-workspace power users; documented limitation in plan.

---

## Helper Extractions

### v2-4 — Hoist `extractBashCommand` into shared `agent-sdk` helper

- **Source**: code-style-review F-4 (Moderate)
- **Files**: `memory-trigger.service.ts:284-294`, `skill-trigger.service.ts:281-291`
- **Issue**: Identical private helpers in both trigger services. Will drift the moment one side wants to handle a new shell-input shape.
- **Recommended fix**: Export `extractBashCommand(toolInput: unknown): string | null` from `agent-sdk` (e.g. `helpers/post-tool-use-helpers.ts`). Both trigger services import it.
- **Effort**: S
- **Priority**: P2

### v2-5 — Hoist `flattenTrigger` / `flattenSkillTrigger` into shared utility

- **Source**: code-style-review F-5 (Moderate)
- **Files**: `memory-rpc.handlers.ts:103-115`, `skills-synthesis-rpc.handlers.ts:106-118`
- **Issue**: Identical recursive flattener with pipeline-specific naming. The map of prefixes differs structurally; the flattener does not.
- **Recommended fix**: Hoist to `libs/backend/rpc-handlers/src/lib/utils/flatten-config.ts` (or `libs/shared/src/lib/utils/flatten-object.ts` if a frontend caller ever needs it).
- **Effort**: S
- **Priority**: P2

### v2-6 — Hoist `buildRateLimitedStats(source, decision)` helper

- **Source**: code-style-review F-7 (Moderate)
- **Files**: `memory-trigger.service.ts` (2 sites), `skill-trigger.service.ts` (2 sites)
- **Issue**: The rate-limit-decision-to-event-stat shape (`{source, limit, resetAt, usedThisWindow}`) is duplicated 4× across two trigger services.
- **Recommended fix**: Hoist `buildRateLimitedStats(source: string, decision: RateLimitDecision & {allowed: false})` next to `CuratorRateLimitService` in agent-sdk. Cuts ~30 LOC and removes drift risk on stat-key naming.
- **Effort**: S
- **Priority**: P2

### v2-7 — Export `EDIT_TOOL_NAMES` and `TEST_PATTERN` from agent-sdk

- **Source**: code-style-review F-10 (Minor)
- **File**: `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:52`
- **Issue**: Canonical list of "edit tools" + test-command regex hard-coded in a private trigger service. Other callers (quality-assessment, diagnostics filters) cannot reuse.
- **Recommended fix**: Move to `libs/backend/agent-sdk/src/lib/helpers/edit-tool-names.ts` + `test-command-pattern.ts`. Export through both barrels.
- **Effort**: S
- **Priority**: P3

### v2-8 — Add `unbrandMemoryId`/`unbrandChunkId` helpers

- **Source**: code-style-review F-9 (Minor)
- **File**: `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:124-143`
- **Issue**: `id: m.id as unknown as string` double-cast pattern flagged by repo guidelines. Branded IDs should have explicit unbrand helpers.
- **Recommended fix**: Add `unbrandMemoryId(id: MemoryId): string`, `unbrandChunkId(id: ChunkId): string` (and skill `CandidateId`). Replace casts.
- **Effort**: S
- **Priority**: P3 — Predates this PR but is re-applied in new RPC fields.

---

## Component Harmonization

### v2-9 — Harmonize `SkillTriggerToggleComponent` output shape with memory variant

- **Source**: code-style-review F-6 (Moderate)
- **Files**:
  - `libs/frontend/memory-curator-ui/.../memory-trigger-toggle.component.ts:9-12`
  - `libs/frontend/skill-synthesis-ui/.../skill-trigger-toggle.component.ts:17-20`
- **Issue**: Two sibling toggle components with the same purpose chose two different output protocols. Memory emits `{enabled, value?}` (per-callback). Skill emits `{key: SkillTriggerKey, value: boolean | number}` (single handler with 7-branch ladder).
- **Recommended fix**: Refactor `SkillTriggerToggleComponent` to drop the `key` input and emit `TriggerToggleChange` per-row. Mirror memory accordion's per-toggle handlers in skill accordion.
- **Effort**: M
- **Priority**: P2

### v2-10 — Centralize `RESERVED_SESSION_IDS` constant

- **Source**: code-style-review F-8 (Moderate)
- **Files**: `memory-rpc.schema.ts:34-42`, `skills-synthesis-rpc.schema.ts:63-72`
- **Issue**: Both schemas reserve `'manual'` sessionId via `.refine((v) => v !== 'manual', ...)`. No single source of truth declares the reservation, but `kind: 'manual-run'` event-kind references it.
- **Recommended fix**: Add `const RESERVED_SESSION_IDS = ['manual'] as const;` in `libs/shared` alongside `MemoryCuratorEventKind`. Both schemas use `.refine((v) => !RESERVED_SESSION_IDS.includes(v))`. Trigger services use the same set when pushing `manual-run` events.
- **Effort**: S
- **Priority**: P2

---

## Logic Enhancements

### v2-11 — Document registry idempotency narrative (or enforce it)

- **Source**: code-logic-review F-4 (Moderate)
- **Files**: `subagent-stop-callback-registry.ts`, `post-tool-use-callback-registry.ts`, `user-prompt-submit-callback-registry.ts`
- **Issue**: Plan §10 narrative claims registries are idempotent on re-register, but implementation wraps the callback into a fresh closure each call. Double-register fires the callback twice. Non-issue in production (trigger services register once at `start()`), but spec narrative drifts from reality.
- **Recommended fix**: Either (a) update plan §10 narrative to drop "idempotent" claim and document double-register as undefined behavior (matches `SessionActivityRegistry` canonical pattern), OR (b) maintain a `Set<callback>` per registry that skips re-subscribe on collision. Option (a) is consistent with existing codebase.
- **Effort**: S
- **Priority**: P3

### v2-12 — Reorder enabled-flag check before regex in memory `onPostToolUse`

- **Source**: code-logic-review F-6 (Minor)
- **File**: `memory-trigger.service.ts:246-251`
- **Issue**: Memory `onPostToolUse` reads `enabled` flag AFTER regex test on Bash command. Skill side checks enabled-flag FIRST. Microsecond-scale waste when disabled.
- **Recommended fix**: Move `readPostToolUseEnabled()` right after `toolName !== 'Bash'` early-return to match skill side.
- **Effort**: S
- **Priority**: P3

### v2-13 — Failed-commit observability

- **Source**: code-logic-review F-7 (Minor)
- **File**: `memory-trigger.service.ts:246-282`
- **Issue**: Memory `onPostToolUse` pushes no event when `git commit` exits non-zero. User attempted to commit but it failed — operator has no diagnostics signal.
- **Recommended fix**: Optionally push `commit-detect` event with `stats.success: false` for failed commits (no curate invocation). Diagnostics accordion gains a "tried-but-failed" indicator.
- **Effort**: S
- **Priority**: P3

### v2-14 — Preserve edit-then-test FSM state on rate-limit denial

- **Source**: code-logic-review F-8 (Minor)
- **File**: `skill-trigger.service.ts:251-265`
- **Issue**: On rate-limit denial of a positive edit-then-test FSM match, the handler deletes `editTestStates` entry. User's accumulated edits are thrown away. After rate-limit window resets, they need to re-accumulate.
- **Recommended fix**: Preserve `editTestStates` on rate-limit denial. User retries with same accumulated edits gets a second chance after rate-limit window resets.
- **Effort**: S
- **Priority**: P2 — UX friction in the highest-value skill trigger.

---

## Test Improvements

### v2-15 — Remove tautological asserts in skill rate-limited spec

- **Source**: test-report F-2 (Moderate)
- **File**: `skill-trigger.service.spec.ts:669-671`
- **Issue**: Three `expect(X).toBeDefined()` assertions on construction-defined values. Zero behavioral coverage.
- **Recommended fix**: Remove the 3 lines OR replace with a meaningful assertion like `expect((syn2.pushEvent as jest.Mock).mock.calls.filter(c => c[0].kind === 'edit-then-test')).toHaveLength(0)` to prove FSM did not re-fire after rate-limited path.
- **Effort**: S
- **Priority**: P3

### v2-16 — Specs for over-length cue + invalid regex runtime rejection

- **Source**: test-report F-4 (Minor)
- **File**: `memory-trigger.service.spec.ts`
- **Issue**: Plan §1 Q4 requires runtime rejection of cues exceeding 200 chars and `new RegExp(source)` throw cases. Zod side covers the input gate but the runtime path has no spec.
- **Recommended fix**: Add 2 specs to user-cue describe block: (a) cue > 200 chars in-memory → no fire + `logger.warn` called; (b) cue is `'['` → no fire + `logger.warn` called.
- **Effort**: S
- **Priority**: P3 — Defense-in-depth where Zod already gates.

### v2-17 — Add `wire-runtime` boot-time DI-resolution spec

- **Source**: test-report F-5 (Minor)
- **File**: (new) `apps/ptah-electron/src/activation/wire-runtime.spec.ts`
- **Issue**: B9 was elided (verified by build only, no commit). No spec asserts that `wire-runtime.ts` resolves the 3 new registries from DI under their `SDK_TOKENS` symbols at boot. DI-resolution per-registry is tested in isolation; only the orchestration is unverified.
- **Recommended fix**: Add minimal `wire-runtime.spec.ts` that resolves all 3 new registries from a fresh DI container and asserts `registerSdkServices` registered them as singletons under correct tokens. Alternatively, mark B9 as intentionally elided with justification.
- **Effort**: S
- **Priority**: P2 — Low risk of regression but the architect explicitly called this out.

---

## Out-of-Scope Items from Original Spec

(Carried from `context.md` §"Out of Scope (v2+)" and architect's `implementation-plan.md` §"Out of Scope".)

### v2-18 — Ptah-exposed user hooks (settings.json `ptah.hooks`)

- **Source**: context.md §"Out of Scope (v2+)"
- **Issue**: Claude Code-style shell-command hooks (`pre-tool-use`, `post-tool-use`, `user-prompt-submit`) configurable via `~/.ptah/settings.json`. User explicitly deferred for this task — wanted SDK-internal trigger expansion first.
- **Recommended fix**: New `libs/backend/ptah-hooks` lib with a `UserHookRunner` consuming the existing callback registries this PR added. Settings: `ptah.hooks.<event>: { command, timeout, blocking }[]`. Composes on top of v1.
- **Effort**: L
- **Priority**: P1 — Major user-visible feature deferred only because of v1 scope.

### v2-19 — Tier 4+ SDK hooks (Stop, SessionStart, PreToolUse, Notification)

- **Source**: context.md §"Problem Statement" table — 4 of 9 SDK hooks still unused
- **Files**: New registries + hook handlers in `agent-sdk`
- **Issue**: Remaining hooks each have a use case:
  - **Stop** — more reliable turn-boundary than B2's `wrapResultStatsForActivity`
  - **SessionStart** — mini boot-scan: pick up where prior session in this workspace left off
  - **PreToolUse** — gate blocking (out of scope for v1) OR observability-only
  - **Notification** — permission-request decisions are semantically rich for skill candidates
- **Recommended fix**: 4 more registries following v2-1 generic base. Subscribers in trigger services per-pipeline.
- **Effort**: M
- **Priority**: P2 — Easier after v2-1 base extraction lands.

### v2-20 — Cross-session pattern miner (background trajectory clustering)

- **Source**: context.md §"Out of Scope (v2+)"
- **Issue**: Mine recurring tool-use signatures across many sessions to surface skill candidates the per-session FSM cannot catch. Background-job style.
- **Recommended fix**: New `libs/backend/skill-mining` lib with a `TrajectoryClusterer`. SQLite read-only over `agent_sessions` + per-event JSONL. Cron-scheduled via `cron-scheduler`. Surfaces candidates in skill-synthesis-ui Schedules tab.
- **Effort**: L
- **Priority**: P3

### v2-21 — ML/heuristic topic-shift detection

- **Source**: context.md §"Out of Scope (v2+)"
- **Issue**: Current memory triggers fire on explicit cues + timer-based heuristics. A semantic topic-shift detector (e.g. embeddings cosine drop between rolling windows) would surface implicit memory candidates.
- **Recommended fix**: Off-the-shelf embedder (already in `persistence-sqlite`'s `IEmbedder`); rolling-window cosine; threshold tuned per workspace.
- **Effort**: L
- **Priority**: P3

### v2-22 — Persist the ring buffer

- **Source**: context.md §"Out of Scope (v2+)"
- **Issue**: 200-entry in-memory ring buffer is lost on Electron restart. Diagnostics history starts empty.
- **Recommended fix**: New SQLite table `curator_events` (memory + skill); write on every `pushEvent`; cap rows per pipeline; read on boot to seed the ring.
- **Effort**: M
- **Priority**: P3

### v2-23 — VS Code parity for memory + skill

- **Source**: context.md §"Out of Scope (v2+)" + `project_thoth_electron_only.md` memory
- **Issue**: Memory + Skills are Electron-only by design (better-sqlite3 + embedder worker). VS Code parity would require swapping the persistence backend.
- **Recommended fix**: NOT RECOMMENDED — explicitly documented in user memory as a non-goal. If pursued, would need a new `persistence-vscode` adapter using IndexedDB or similar.
- **Effort**: L
- **Priority**: P4 (do-not-do unless requirements change)

---

## Priority Summary

| Priority | Count | Categories |
|----------|-------|-----------|
| P1 | 3 | v2-1 (CallbackRegistry base), v2-2 (trigger-config hoist), v2-18 (Ptah user hooks) |
| P2 | 7 | v2-3, v2-4, v2-5, v2-6, v2-9, v2-10, v2-14, v2-17, v2-19 |
| P3 | 9 | v2-7, v2-8, v2-11, v2-12, v2-13, v2-15, v2-16, v2-20, v2-21, v2-22 |
| P4 | 1 | v2-23 (VS Code parity — do-not-do) |

**Recommended next sprint**: v2-1 + v2-2 together (eliminates the duplication that blocks the next hook expansion cleanly) + v2-17 (closes the only Minor finding the architect specifically flagged).
