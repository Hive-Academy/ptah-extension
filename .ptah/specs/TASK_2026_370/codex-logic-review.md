# Business-logic review — commit b41c4f453 (six-task fix)

**Reviewer vendor**: `claude-fallback`. Codex (`codex` CLI, agent `5e26de2f-cac2-44c7-b9b8-a58fc668acaa`, CLI session `01a07e1a-35dc-7d53-afe9-18064669c667`) was spawned with the full rubric and was still mid-investigation (reading `session-importer.service.spec.ts`, `skill-synthesis/CLAUDE.md`, `agent-sdk/CLAUDE.md`) when the orchestration forced completion at ~10 min of its 40 min budget. It produced no review text, so every issue below was raised and verified by Claude directly against the working tree. Resume with `resume_session_id` if a Codex pass is still wanted.

**Range**: `2977dfa41..b41c4f453`
**Tasks**: TASK_2026_370, TASK_2026_374, TASK_2026_336, TASK_2026_337, TASK_2026_356, TASK_2026_340
**Shared review**: this file. The other five task folders carry a one-line pointer here.

---

## 🧠 BUSINESS LOGIC REVIEW RESULTS

**Project Domain**: AI coding assistant (VS Code extension + Electron desktop + headless CLI) — chat streaming pipeline, per-session turn-state registry, execution-tree render cache, skill-synthesis token-budget drain, session importer
**Score**: 7.8/10
**Weight**: 35%
**Files Analyzed**: 13 (6 production, 7 spec) + 2 lib `CLAUDE.md` files for doc drift

### 📋 Business Context Analysis

- **Domain**: Developer tooling — multi-session AI chat over the Claude Agent SDK, with background skill-synthesis pipelines spending a daily token budget.
- **Core Entities**: chat session (SDK UUID / tabId alias), `TurnRecord` + revision floor, `StreamingState` / `ExecutionNode` tree, skill queue row + stage, `SessionMetadata` row + backing JSONL.
- **Primary Workflows**: concurrent interactive streaming (SDK message → flat event → webview); turn-state publication and teardown on clean exit / abort / replacement; incremental execution-tree rebuild per animation frame; budget-gated background drain; import + prune of `~/.claude/projects/*.jsonl` into the session list.
- **Implementation Stage**: production, shipping (Electron + VS Code + CLI); this commit is a deploy-blocker fix batch.
- **Business Dependencies**: `@anthropic-ai/claude-agent-sdk` (stream shape, JSONL sidecar formats), local SQLite (`SkillBudgetStore`, queue), `SessionMetadataStore`.

### ✅ Business Value Delivered

- **TASK_2026_370** — `StreamTransformer.transform()` takes `createIsolated()` per stream (`stream-transformer.ts:276`); the DI singleton is now only a factory for all three consumers (`harness-stream-broadcaster.service.ts:49`, `ptah-cli-registry.ts:103`, `stream-transformer.ts:221`). Cross-session slot collision, misattributed token usage and cross-session `clearStreamingState()` are closed. Pinned by two transformer specs and three isolation specs in `sdk-message-transformer.spec.ts`, including the negative case (single instance serving two sessions stamps the wrong id).
- **TASK_2026_374** — `records` is LRU-bounded at `TURN_RECORD_MAP_LIMIT` (256) with the victim's revision folded into `revisionFloors` before drop (`session-turn-state.registry.ts:430-455`), so the TASK_2026_371 F1 counter-restart hazard is not reintroduced. `ChatStreamBroadcaster` now separates "replaced" from "nothing registered" via a second `getSessionToken` read (`chat-stream-broadcaster.service.ts:409-411`); a re-registration between the two reads can only produce the *correct* outcome (a newer record owns the id → leave it alone). Both abort specs assert non-vacuity and the post-abort revision stays above the last emitted one.
- **TASK_2026_336** — `sameStateObject` gates both the whole-tree fast path and per-root reuse (`execution-tree-builder.service.ts:309-311`, `:338-341`), and `indexState` is refreshed on every cache write (`:414`), so ordinary in-place mutation still reuses. The equivalence oracle gained the fresh-state-under-same-key case.
- **TASK_2026_337** — `summaryContent` and `toolCount` folded (`:683`, `:694`); timestamps and view state documented as deliberate exclusions with four spec cases pinning each direction.
- **TASK_2026_356** — `prefilter` in `TOKEN_SPENDING_STAGES` (`skill-drain.service.ts:557`) and ranked 5 in `STAGE_COST_RANK` (`:598`). The `source === 'boot'` template-only prefilter path is now also budget-deferred; the code comment (`:518-524`) states this is deliberate (a per-source exemption would re-open the hole for the boot backlog that produced the $0.077 measurement). The pin is behavioural, not table-equals-itself: `skill-drain.budget.spec.ts:615-720` drives the real drain per stage and enforces a total classification of `SKILL_QUEUE_STAGES`.
- **TASK_2026_340** — `isContentlessSessionFile` adds shape 2 (whole file in hand, no non-whitespace byte) keyed on bytes, not parse successes (`session-importer.service.ts:397-400`); missing file is kept by decision (`:338-340`); the "real session named `Session <date>`" and "corrupt but non-empty" cases are pinned.

### ⚠️ Business Logic Issues

**Issue 1: Incomplete Implementation — prune shape 1 still narrower than the producer rule (K1)** — TASK_2026_340

- **Location**: `libs/backend/agent-sdk/src/lib/session-importer.service.ts:404-416`
- **Finding**: Shape 1 of `isContentlessSessionFile` returns `true` only when `sawAiTitle` is set (`:413`, `:416`). The producer guard it claims to mirror (`extractMetadata`, `:817-819`) refuses on `!sawSessionContent && parsedRecords > 0` — i.e. *any* parsed record that is not `system`/`user`. Commit `c38ea669f` names four sidecar shapes the CLI writes (`ai-title`, `queue-operation`, `permission-mode`, `file-history-snapshot`). Phantom rows minted before that commit for the latter three parse fine, never set `sawAiTitle`, and so are never pruned — exactly the "survives every scan" defect this task exists to close, for three of the four shapes. The method comment at `:366-369` says the discriminators are "read off that guard rather than restated — they must not drift apart"; they have drifted.
- **Business Impact**: Users who hit the pre-`c38ea669f` importer still see un-clearable phantom `Session <date>` rows for any non-`ai-title` sidecar. User-visible; no affordance to remove.
- **Domain Context**: The session list is the primary navigation surface of the product; stale rows that open to nothing erode trust in history.
- **Action Required**: Widen shape 1 to the producer rule: count `parsedRecords` in the loop and return `parsedRecords > 0 && !sawSessionContent` (`system`/`user` still short-circuits `false`). Safety holds: a truncated or BOM-corrupted real-session prefix yields `parsedRecords === 0` and falls to `false`; shape 2 is unchanged. Add spec cases for a `queue-operation`-only and a `permission-mode`-only backing file (pruned) and keep the corrupt/truncated keep-cases.
- **Also (same location, `:397-400`)**: the removed `bytesRead === 0` early return makes a zero-byte file prunable. A LIVE session whose JSONL exists but is momentarily empty (file created, first record not yet flushed) is a stored row the sweep can now delete; `pruneTitleOnlySessions` walks every stored entry for the workspace, live ones included, on boot and on every `workspace:switch`. The window is narrow (the SDK `fork()` writes a transcript before `SessionForkService` creates the row, and the new-session row is created at `init` after the CLI has started writing), but it is not pinned either way. Decide and pin: either skip entries whose session id is currently active in `SessionLifecycle`, or document that a zero-byte backing file is contentless by definition and accept the re-import on the next scan.
- **Priority**: High
- **Effort Estimate**: 1h (predicate + 3 spec cases + one decision on the live-session case)
- **Adjudication**: CONFIRMED by Claude. Read `:404-416` and `:817-819` side by side; the asymmetry is exactly as described. Known from the lane reviews; recorded here so the repair stage picks it up.

**Issue 2: Documentation Drift — `skill-synthesis/CLAUDE.md` still lists prefilter as a free stage (K2)** — TASK_2026_356

- **Location**: `libs/backend/skill-synthesis/CLAUDE.md:69` and `:73`
- **Finding**: Line 69 states "`TOKEN_SPENDING_STAGES`'s complement is exactly THREE stages — `prefilter`, `embedding`, `clustering`" and later "the claim is true of those three". Line 73 calls it "the cheap regex prefilter". The code now says the complement is exactly TWO (`skill-drain.service.ts:37-43`, `:497-505`) and that prefilter drafts a candidate with a model.
- **Business Impact**: The lib's own guidance contradicts the guard it documents; the next reader re-files or "fixes" the set back. Same defect class the bullet warns about for `trigger-eval`.
- **Domain Context**: `CLAUDE.md` files are the operating rules for every agent working this repo; a stale rule is a regression vector.
- **Action Required**: Rewrite the two sentences to name two free stages and describe prefilter as an LLM-drafting stage whose regex is only the eligibility test; add the TASK_2026_356 pointer beside TASK_2026_253.
- **Priority**: Low
- **Effort Estimate**: 15 min
- **Adjudication**: CONFIRMED by Claude. Read both lines in the working tree.

**Issue 3: Documentation Drift — `agent-sdk/CLAUDE.md` turn-state bullet predates TASK_2026_374** — TASK_2026_374

- **Location**: `libs/backend/agent-sdk/CLAUDE.md:85`
- **Finding**: The bullet says "the control case in the same log is an abort, where `clear` is skipped and the next turn updated the UI normally" and "the map is bounded by `REVISION_FLOOR_MAP_LIMIT` (256 …)". After this commit the abort path DOES clear (`chat-stream-broadcaster.service.ts:409-411`, `:430-433`), and the record map is bounded too (`TURN_RECORD_MAP_LIMIT`, `session-turn-state.registry.ts:163`). The bullet also never mentions the eviction-writes-floor-first invariant that makes the record bound safe.
- **Business Impact**: The stated control case is now false, which is the kind of thing that sends the next log audit down the wrong path.
- **Domain Context**: This bullet is the canonical explanation of the D1/F1 revision hazard; it must describe the current teardown.
- **Action Required**: Update the abort sentence, name both bounds, and state the "victim floor is written before drop" rule with the TASK_2026_374 pointer.
- **Priority**: Low
- **Effort Estimate**: 20 min
- **Adjudication**: CONFIRMED by Claude. Read the line; the abort sentence and the single-bound claim are both stale.

**Issue 4: Edge Case — LRU eviction of a mid-turn record drops its snapshots** — TASK_2026_374

- **Location**: `libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.ts:443-455`
- **Finding**: `evictOldestRecord` preserves only `state.revision` (via the floor). A record that is `generating` with a `stopSnapshot` / `failure` already recorded, and `generatingEmitted = true`, loses all three if 256 other sessions are `ensure`d before its `result` arrives. On re-seed, `settleTurn` then reports `idle` instead of `awaiting-background` / `sleeping` / `failed`, `applySnapshot` returns `null` (no record), and `session:status` answers "no turn state" for a session that is mid-turn.
- **Business Impact**: Latent. Reaching it needs 256 distinct session ids touched inside one turn of a live session — hooks and the Ptah-CLI stream loop do create records for ids the chat never streams, but 256 in one turn is not an ordinary load. Consequence when hit is a wrong terminal phase for one turn, self-healing on the next.
- **Domain Context**: The registry is the single source of truth for "is this session busy"; a wrong terminal phase is a stuck or missing Stop button.
- **Action Required**: Either (a) skip eviction candidates whose phase is `generating` (walk to the next LRU key; evict nothing if all 256 are generating, which is itself the signal that the bound is too small), or (b) document that the bound is sized for the record-creating paths and accept the residue. Pin whichever with one spec.
- **Priority**: Low
- **Effort Estimate**: 45 min
- **Adjudication**: CONFIRMED by Claude as code behaviour (the drop is unconditional); reachability rated low. Not a blocker.

### 📝 Generated Subtasks

#### High Priority (Must Fix Before Production)

1. **Widen `isContentlessSessionFile` shape 1 to the producer rule** (High Priority - 1h) — TASK_2026_340
   - Return `parsedRecords > 0 && !sawSessionContent`; keep the `system`/`user` short-circuit and shape 2 unchanged.
   - Add prune specs for `queue-operation`-only and `permission-mode`-only backing files; keep the corrupt / truncated / BOM keep-cases green.
   - Decide and pin the zero-byte live-session case (skip active ids, or document acceptance).
   - Closes the phantom-row defect for all four sidecar shapes instead of one.

#### Medium Priority (Business Value Enhancement)

2. **Pin or guard mid-turn eviction in `SessionTurnStateRegistry`** (Medium Priority - 45m) — TASK_2026_374
   - Skip `generating` records when choosing the LRU victim, or document the residue; one spec either way.

#### Low Priority (Technical Debt)

3. **Refresh `skill-synthesis/CLAUDE.md:69,73`** (Low Priority - 15m) — TASK_2026_356
4. **Refresh `agent-sdk/CLAUDE.md:85` turn-state bullet** (Low Priority - 20m) — TASK_2026_374

### 📊 Business Logic Metrics

- **Implementation Completeness**: 7/10 — five of six fixes complete; 340 closes one of four sidecar shapes.
- **Configuration Flexibility**: 8/10 — the two new bounds are exported constants with reasoned sizing; the budget gate stays keyed on stage by deliberate choice.
- **Business Rule Enforcement**: 9/10 — every rule is pinned behaviourally (isolation, LRU + floor, state identity, fingerprint folds, per-stage budget, prune keep-cases).
- **Error Handling**: 8/10 — prune swallows to debug log by design; broadcaster teardown paths are exhaustively branched and logged.
- **Integration Quality**: 8/10 — SDK sidecar shapes are the one external contract not fully mirrored.
- **Production Readiness**: 8/10 — deployable; Issue 1 should ship in the same window.

### 🎯 Domain-Specific Recommendations

- Extract the producer/prune discriminator into one shared predicate (`classifySessionPrefix(content, bytesRead) → 'session' | 'sidecar' | 'empty' | 'unknown'`) so the two call sites cannot drift again; the comment at `:366-369` already asks for this property.
- When the budget gate defers boot-source prefilter rows, log the count once per tick at `info` so the accepted trade is visible in the next log audit rather than reading as a stalled backlog.
- Consider sizing `TURN_RECORD_MAP_LIMIT` from the record-creating paths (hooks + CLI loop + result ids) rather than mirroring the floor bound; the two maps have different fan-in.

### 🚀 Production Deployment Assessment

- **Ready for Production**: PARTIAL
- **Blocking Issues**: 1 (Issue 1 — user-visible phantom rows remain for three of four sidecar shapes; scope of TASK_2026_340 not fully met)
- **Business Risk Level**: LOW
- **Recommended Timeline**: Ship after Issue 1 lands (≈1h); Issues 2–4 can ride the same commit or the next.

---

## Adjudication summary

| # | Task | Severity | Location | Verdict |
|---|------|----------|----------|---------|
| 1 (K1) | TASK_2026_340 | major | `session-importer.service.ts:404-416` (+ `:397-400`) | CONFIRMED — prune shape 1 requires `sawAiTitle`; producer refuses on any parsed non-session record; zero-byte live-session case unpinned |
| 2 (K2) | TASK_2026_356 | minor | `skill-synthesis/CLAUDE.md:69`, `:73` | CONFIRMED — still says three free stages incl. prefilter / "cheap regex prefilter" |
| 3 | TASK_2026_374 | minor | `agent-sdk/CLAUDE.md:85` | CONFIRMED — abort "skips clear" and single-bound claims are stale |
| 4 | TASK_2026_374 | minor | `session-turn-state.registry.ts:443-455` | CONFIRMED (latent) — mid-turn eviction drops snapshots and `generatingEmitted` |

Areas checked and found sound (no finding): per-stream isolation seam and singleton-as-factory (370); second-token-read race in the broadcaster (374); `sameStateObject` gating of per-root reuse and `indexState` refresh (336); fingerprint folds and exclusions (337); behavioural (non-tautological) budget spec and boot-source trade (356); name-blind prune, missing-file keep, truncated/corrupt keep (340).
