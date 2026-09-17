# Tribunal Review: Thoth Subsystem (Panelist P2)

---

### Area A: Memory Lifecycle & Growth

## Position
Memory growth is unbounded because retention, decay, and garbage collection are completely non-functional at runtime: `MemoryDecayJob` is never scheduled or executed, the salience formula mathematically prevents memories from ever decaying to archival tier, and processed observation queue rows (accounting for ~80% of the database) have zero purge callers.

## Root causes
1. **`MemoryDecayJob` is dead code at runtime and never registered in the scheduler.**
   - *Evidence*: `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:373-427` registers `@ptah/daily-backup`, skill drain jobs, and `@ptah/db-integrity-check`, but completely omits `MemoryDecayJob`. Across the entire codebase, `MemoryDecayJob` is only resolved in `libs/backend/memory-curator/src/lib/diagnostics.service.ts:33` to report telemetry. There is no scheduled cron job, timer, or trigger that ever invokes `MemoryDecayJob.run()`.
   - *Brief number explained*: Explains Brief §1 (memory grows forever with no automated removal), §31 (`scheduled_jobs` has no memory decay/retention job), and §26 (33,413 recall rows, 0 archival rows).

2. **The salience scoring formula is mathematically incapable of decaying below the archival threshold.**
   - *Evidence*: `libs/backend/memory-curator/src/lib/salience-scorer.ts:44-51` computes:
     ```ts
     const raw = Math.max(0, Math.min(1, inputs.base)) + 0.4 * recency + 0.3 * logHits + 0.2 * pinned + 0.1 * tierBias;
     ```
     In `salience-scorer.ts:64`, `inputs.base` is passed as `memory.salience`. In `libs/backend/memory-curator/src/lib/memory-writer.adapter.ts:83`, unpinned memories are initialized with `salience: 0.6`. Because `base` is purely additive and never multiplied by recency decay, `raw` is bounded below by `0.6 + 0.1 * 0.5 = 0.65`. In `libs/backend/memory-curator/src/lib/memory-decay.job.ts:91-95`, demotion from `recall` to `archival` requires `newSalience < 0.1 AND ageMs > halflifeMs`. Because stored salience can never fall below 0.65, demotion to archival is impossible.
   - *Brief number explained*: Explains Brief §28-§29 (salience distribution min ≈ 0.6, bulk 1.1–1.4; threshold < 0.1 is never reached; 0 archival memories).

3. **`ObservationQueueStore.purgeOlderThan` has zero production callers, leaving 1 GB of processed observations permanent.**
   - *Evidence*: `libs/backend/memory-curator/src/lib/observation-queue.store.ts:648-654` implements `purgeOlderThan(thresholdMs)`. Searching the codebase confirms it is only referenced in test suites and in migration `libs/backend/persistence-sqlite/src/lib/migrations/0039_reap_orphaned_queue_rows.ts:61`, which explicitly documents: `purgeOlderThan has zero production callers`. Processed observations are marked with `processed_at` (`observation-queue.store.ts:569-578`), but never purged.
   - *Brief number explained*: Explains Brief §20-§22 (`observation_queue` table is 1,021 MB / ~80% of the DB, with 200,725 already processed rows dating back to 2026-06-01; processed `tool_response_text` alone accounts for 756 MB).

4. **Memory expiration (`expires_at`) is never populated at creation.**
   - *Evidence*: In `libs/backend/memory-curator/src/lib/memory-decay.job.ts:72-76`, expiration deletion only triggers when `m.expiresAt !== null && now > m.expiresAt`. However, `libs/backend/memory-curator/src/lib/memory-writer.adapter.ts:77-88` and `libs/backend/memory-curator/src/lib/curator-llm/extract-prompt.ts` never set `expiresAt` on extracted memories.
   - *Brief number explained*: Explains Brief §26 (`expires_at` set on 0 rows, 0 expired rows deleted).

5. **Bloated DB copies accumulate without holistic retention or reclamation.**
   - *Evidence*: In `libs/backend/persistence-sqlite/src/lib/backup.service.ts:107`, `'pre-migration'` backups retain 3 snapshots. Because the live database grew to 1.28 GB due to unpurged `observation_queue` rows, each pre-migration copy is 1.0–1.18 GB (~3.2 GB total). Additionally, `start-thoth-cron.ts:345` executes `incremental_vacuum(100)` after backup, which reclaims at most 100 pages (~400 KB) and cannot compact gigabytes of free space without an explicit full `VACUUM` after large deletions.
   - *Brief number explained*: Explains Brief §18-§19 (1.28 GB live DB + 3.2 GB in pre-migration and dev backups in `~/.ptah/state`).

## Systematic fix
- **What to delete**:
  - Delete the additive base term in `salience-scorer.ts:44-51`. Base importance must be subject to half-life recency decay:
    `raw = (inputs.base * recency) + 0.3 * logHits + 0.2 * pinned + 0.1 * tierBias`.
  - Delete the assumption that `MemoryDecayJob` is driven externally; remove its unused status.
  - Delete dead migration snapshot files (`ptah.pre-migration-*.sqlite`) via automated backup rotation cleanup.
- **What to add / redesign**:
  - **Daily Observation Queue Purge Job**:
    In `start-thoth-cron.ts`, register a daily cron handler `observation:purge` (ID `@ptah/observation-queue-purge`, scheduled daily at 02:00 UTC) calling `ObservationQueueStore.purgeOlderThan(Date.now() - 7 * 86_400_000)` (retaining 7 days of processed history). Also add a query to purge unprocessed rows older than 30 days that belong to closed sessions.
  - **Register Memory Decay Job**:
    In `start-thoth-cron.ts`, register `MemoryDecayJob` as `@ptah/memory-decay` running daily at 02:30 UTC.
  - **Archival Tier Eviction & Memory Caps**:
    Update `memory-decay.job.ts` to add a true retention policy:
    1. Demote `recall` to `archival` when `newSalience < 0.35` and age > halflife.
    2. Purge `archival` rows when `ageMs > 90 * MS_PER_DAY && !pinned`.
    3. Enforce a per-workspace cap (e.g. 5,000 active recall memories), evicting the lowest-salience memories first.
  - **One-time Compaction Migration (`0041_reap_observations_and_vacuum.ts`)**:
    Run a SQL migration that deletes processed `observation_queue` rows older than 7 days, deletes unprocessed rows older than 30 days, and runs `VACUUM` to immediately shrink the 1.28 GB DB down to ~60 MB.
  - **Pre-migration Snapshot Cleanup**:
    Update `backup.service.ts` to reduce `pre-migration` retention to 1 snapshot and delete legacy dev snapshots matching `ptah.*.sqlite` older than 7 days.

## Verification
- **Metrics**: Live DB size drops from 1.28 GB to < 100 MB. `observation_queue` row count drops from 205,828 to < 2,000. Disk space in `~/.ptah/state` reclaimed by > 3 GB.
- **UI Signal**: On the Memory tab (`ptah-memory-stats-strip`), "Archival" count increases from 0 to reflect decayed memories, and "Last curated / Last decay" shows daily execution timestamps.
- **Tests**:
  1. Unit test in `salience-scorer.spec.ts` verifying that after 30 days with 0 hits, salience drops below 0.2.
  2. Integration test verifying `@ptah/observation-queue-purge` and `@ptah/memory-decay` are registered in `JobStore` on `startThothCron`.
  3. E2E test confirming `purgeOlderThan` deletes processed observations older than 7 days while preserving unprocessed in-flight rows.

## Tradeoffs
- Multi-step vacuum on SQLite requires temporary disk space equal to the compacted database size during migration.
- Lowering salience floor means memories not accessed in 60–90 days will be permanently forgotten unless pinned by the user.

## Confidence
High. The bug mechanics (dead cron registration, additive scoring arithmetic, zero purge calls) are verified directly in the source code. Biggest risk: running full `VACUUM` on a live connection with concurrent lock contention, which must be executed safely during startup migration before handles open.

---

### Area B: Skill Synthesis Quality and Verifiability

## Position
Skill synthesis is an open-loop capture sink that produces unusable, repetitive artifacts: candidate generation bypasses the titling gate and defaults to raw prompt slugs, manual promotion is impossible due to an unbypassable invocation threshold check, auto-promotion is non-existent because real agent runs never record invocations, and the 2,432 recorded invocations are synthetic phantom records written at candidate insertion.

## Root causes
1. **Manual and automatic promotion are completely blocked (`0 promoted` ever).**
   - *Evidence*: `libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts:214-216` gates promotion on:
     ```ts
     if (candidate.successCount < effectiveSuccessThreshold) {
       return { promoted: false, reason: 'below-threshold', candidate };
     }
     ```
     where `effectiveSuccessThreshold` is at least 2 or 3. Candidates are registered with `success_count = 0` (`skill-candidate.store.ts:206`). `SkillInvocationTracker` is never hooked into the live agent tool execution loop (it has zero production call sites across all apps). When a user clicks "Promote" in the UI, `SkillSynthesisService.promote()` (`skill-synthesis.service.ts:1209-1213`) forwards to `SkillPromotionService.evaluate()` without any manual override flag. Every promotion attempt evaluates to `reason: 'below-threshold'` and fails.
   - *Brief number explained*: Explains Brief §34 (2,426 candidate, 6 rejected, **0 promoted — ever**).

2. **Synthetic phantom invocation rows are written at candidate creation time.**
   - *Evidence*: In `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:916-924`, immediately after `store.registerCandidate()`, the service executes:
     ```ts
     if (!result.reused && contextId) {
       this.store.recordInvocation({
         skillId: result.candidate.id,
         sessionId,
         succeeded: true,
         invokedAt: Date.now(),
         contextId,
       });
     }
     ```
     This writes a synthetic invocation row marking `succeeded = 1` for the candidate's creation session, not an actual usage invocation.
   - *Brief number explained*: Explains Brief §38 (`skill_invocations` has 2,432 rows, exactly one per candidate, 2,432/2,432 `succeeded=1`).

3. **Candidate names default to slugified first user prompts because `CandidateNamerService` is uncalled dead code.**
   - *Evidence*: `libs/backend/skill-synthesis/src/lib/trajectory-extractor.ts:230-233` builds slugs from `firstUser = turns.find((t) => t.role === 'user')?.text ?? ''`, truncating to 140 characters and slugifying. In `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:774-775`, `candidateName` defaults to `trajectory.slug`. Although `CandidateNamerService` was implemented in `libs/backend/skill-synthesis/src/lib/naming/candidate-namer.service.ts` to generate human-readable titles, it is NEVER injected or called in `SkillSynthesisService` or `SkillStageHandlersService`. It only appears in its own spec file.
   - *Brief number explained*: Explains Brief §35-§37 (candidates named after first user prompts like `do-you-have-access-to-the-hubspot-mcp-2` with duplicate `-2`/`-4` suffixes).

4. **Conversational non-coding sessions pass prefilter due to permissive `depthOk` branch.**
   - *Evidence*: In `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:1181-1198`, `passesPrefilter()` passes if `editOk || toolOk || testOk || depthOk`. The `depthOk` condition (`turnCount >= settings.eligibilityMinTurns && charLength >= settings.prefilterMinChars`) allows pure conversational sessions without edits or tool calls to be treated as candidates, capturing non-code sessions from foreign workspaces.
   - *Brief number explained*: Explains Brief §37 (non-code sessions like `based-on-this-attached-abdelrahaman-resume-...` included).

5. **Archaeology verdict failures and queue bottlenecks strand unjudged candidates.**
   - *Evidence*: In `libs/backend/skill-synthesis/src/lib/archaeology/session-archaeologist.service.ts:25-45`, multi-pass archaeology collapses into degraded status when lane tool-use is unsupported or token budgets expire. Because judge and trigger-eval stages are serial and token-budget constrained, only 105 out of 2,426 candidates were ever scored by the judge panel, leaving the rest in an unjudged, unverified backlog.
   - *Brief number explained*: Explains Brief §34 (judge scored only 105), §39-§41 (large queue backlog, 88 skipped, 8 prompt lane failures), and §42 (56 degraded session verdicts).

## Systematic fix
- **What to delete**:
  - Delete the creation-time synthetic invocation write in `skill-synthesis.service.ts:916-924`.
  - Delete the mandatory `successCount >= threshold` check for manual promotion in `SkillPromotionService.evaluate()` (support `manual: true` to bypass the invocation count check).
  - Delete `depthOk` without tools in `passesPrefilter` (`skill-synthesis.service.ts:1194`): require `(editOk || toolOk) && (testOk || depthOk)` so pure chat sessions are rejected before candidate generation.
  - Delete duplicate candidate suffixing (`-2`, `-3`) for re-opened sessions; update existing candidates in place.
- **What to add / redesign**:
  - **Wire `CandidateNamerService` into candidate creation**:
    In `SkillSynthesisService.analyzeSession` (or the synthesis stage handler), inject and await `CandidateNamerService.nameCandidate()`. Populate `display_name` and human description before calling `store.registerCandidate()`.
  - **Real Invocation Recording**:
    Hook `SkillInvocationTracker.recordInvocation()` into the agent prompt runner and skill tool execution interceptor when an active skill is injected into the context or executed.
  - **Cluster-First Synthesis ("Suggestions")**:
    Pivot candidate workflow away from single-session raw captures. Treat raw candidates as ephemeral scratch inputs for `SkillClusteringService` and `SkillSuggestionStore`. Only promote clustered, deduplicated skills that demonstrate repeated utility across multiple sessions.
  - **Workspace Boundary Enforcement**:
    In `trajectory-extractor.ts`, assert that transcripts belong to the active `workspaceRoot`. Refuse extraction for sessions originating in unrelated repositories or non-workspace windows.

## Verification
- **Metrics**: 0 synthetic invocations at creation. Candidate display names are title-cased workflow summaries (< 60 chars) instead of prompt slugs.
- **UI Signal**: In the Skills tab, candidate cards display human names (`display_name`). Clicking "Promote" successfully moves a candidate to Active Skills (`promoted_at IS NOT NULL`).
- **Tests**:
  1. Unit test asserting `SkillPromotionService.evaluate(id, settings, { manual: true })` succeeds even when `successCount === 0`.
  2. Integration test proving `analyzeSession` calls `CandidateNamerService` and sets `display_name`.
  3. E2E test verifying non-tool conversational sessions are rejected by `passesPrefilter`.

## Tradeoffs
- Disabling conversational `depthOk` prevents synthesizing pure "prompting instructions" that do not touch code or tools, focusing synthesis strictly on tool/code workflows.
- Requiring an LLM naming pass adds a small token cost (~150 tokens) on the judge lane per accepted candidate.

## Confidence
High. The blockers preventing promotion and clear naming are concrete code omissions (`evaluate()` blocking manual promotion, `CandidateNamerService` uncalled, synthetic invocations hardcoded in `analyzeSession`).

---

### Area C: Thoth UI Usability & Activity Log

## Position
The Thoth UI fails because it exposes internal developer debugging mechanisms rather than user value, while the "Activity" view is visually broken due to identical diagnostic components simultaneously rendering duplicate, competing cards, histograms, and event feeds on the same page.

## Root causes
1. **Severe component duplication in the Skill Activity subview template.**
   - *Evidence*: In `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts:476-491`, the `'activity'` subview renders `<ptah-skill-pipeline-status>` AND `<ptah-skill-diagnostics-accordion>` directly below it:
     - `<ptah-skill-pipeline-status>` renders: "Last analysis", "Accepted/ineligible today", "Drain runs", and "Stage cost" (`skill-pipeline-status.component.ts:125-250`).
     - `<ptah-skill-diagnostics-accordion>` immediately renders: "Last analyze run" (DUPLICATED), "Last curator pass", "Sessions analyzed today" with `<ptah-eligibility-histogram>` (DUPLICATED), "Candidates by status" (DUPLICATED with stats strip), "Recent events" with `<ptah-skill-event-feed>` (DUPLICATED), and "Triggers" (`skill-diagnostics-accordion.component.ts:28-115`).
     Users see duplicate headers, two different event lists, and two eligibility histograms stacked on top of each other.
   - *Brief number explained*: Explains Brief §13 ("The activity log looks broken or renders repeated components in a bad layout").

2. **Fragmented, disjoint activity logs across separate tabs with no cohesive narrative.**
   - *Evidence*:
     - Memory has its own `<ptah-event-feed>` in `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/event-feed.component.ts` (capped at 10 items, buried inside an accordion under maintenance).
     - Memory also has `<ptah-timeline-view>` in `libs/frontend/memory-curator-ui/src/lib/components/timeline-view.component.ts`.
     - Skills has its own `<ptah-skill-event-feed>` in `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/event-feed.component.ts`.
     - Electron shell renders a separate floating `<ptah-activity-ticker>` toast (`libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:265`).
     None of these talk to each other or provide a unified, chronological log of what Thoth has learned, scheduled, or cleaned up.
   - *Brief number explained*: Explains Brief §12-§13 ("Thoth UI is completely unusable — the user does not know how to get value from it").

3. **Inverted Information Architecture: Raw internal captures shown as the primary landing surface.**
   - *Evidence*: In `skill-synthesis-tab.component.ts:186-285`, the default subview is `'candidates'`, greeting the user with 2,426 rows of un-named prompt slugs, bulk rejection toolbars, and pattern regex inputs. The high-value views—`suggestions` (synthesized skills ready for review) and active skills—are secondary chips.
   - *Brief number explained*: Explains Brief §10, §12 (user feels pipeline does huge investigation and recording but produces poor session-based output that cannot be understood).

4. **Cryptic outcome formatting in event feeds.**
   - *Evidence*: In `event-feed.component.ts:94-123` and `skill-synthesis-ui/.../event-feed.component.ts:88-100`, event outcomes format to strings like `session=01J...` or raw key-value stats without session names, skill titles, or links to view what happened.
   - *Brief number explained*: Explains Brief §10, §13.

## Systematic fix
- **What to delete**:
  - Delete `<ptah-skill-diagnostics-accordion>` from the Activity subview in `skill-synthesis-tab.component.ts:490`. Consolidate all pipeline status telemetry into `<ptah-skill-pipeline-status>`.
  - Delete trigger toggle settings from the Activity subview; move them to the `'settings'` subview where they belong.
  - Delete the raw candidates table as the default landing view. Demote "Candidates" to an "All Captures (Advanced)" tab.
  - Delete obscure raw database metrics (vector table status, SQLite statement counters) from the user-facing view.
- **What to add / redesign**:
  - **Unified Thoth Activity Stream**:
    Create a centralized `ThothActivityLogComponent` accessible from the Thoth shell header or sidebar. Aggregate high-level events from Memory Curator, Skill Synthesis, and Cron Scheduler into a clean timeline:
    - *"Synthesized skill: 'Git Worktree Switcher' from 3 recent sessions"*
    - *"Decayed 14 inactive memories to archival tier"*
    - *"Completed scheduled backup (Database: 48 MB)"*
  - **Value-First Navigation & Landing Pages**:
    - **Skills Tab Landing View**: Default to **"Recommended Skills" (`suggestions`)** and **"Active Skills"**, highlighting skills the agent can immediately use.
    - **Memory Tab Landing View**: Default to **"Learned Concepts & Conventions"**, showing pinned core memories and project facts with instant "Forget" / "Pin" controls, rather than raw diagnostic stats.
  - **Human-Centric Candidate Cards**:
    Replace raw table rows with card components showing `display_name`, target workspace, and a one-click **"Promote to Project"** button with a readable preview of what the skill does.

## Verification
- **UI Signal**:
  1. In the Skills tab > Activity subview, the duplicate panels, duplicate histograms, and repeated event lists are completely gone. A single clean pipeline status card is rendered.
  2. The Skills tab opens to "Recommended Skills" or "Active Skills" by default.
  3. The Activity feed displays plain-English sentences linking to the affected skill or memory.
- **Tests**:
  1. Component test for `SkillSynthesisTabComponent` verifying that the activity subview contains exactly one pipeline status element and no accordion duplicates.
  2. Visual regression test checking layout responsiveness and lack of redundant scroll containers in `ThothShellComponent`.

## Tradeoffs
- Hiding raw candidates behind an "Advanced" toggle requires an extra click for power users who want to inspect raw session extracts before clustering.
- Centralizing activity events requires an aggregation query across memory and skill event stores.

## Confidence
High. The visual duplication is directly identified in lines 476–491 of `skill-synthesis-tab.component.ts`. The UI simplification directly addresses the user's confusion.

---

## Priority order

1. **[P0] Immediate DB Compaction & Observation Purge (Area A)**
   - *Why*: The database is currently 1.28 GB, 80% full of dead processed data, with 3.2 GB of backup snapshots consuming disk space on every user boot.
   - *Action*: Run migration to delete processed observations older than 7 days, execute `VACUUM`, and wire `ObservationQueueStore.purgeOlderThan` into a daily cron job.

2. **[P0] Unblock Skill Promotion & Real Naming (Area B)**
   - *Why*: 0 skills have ever been promoted across 2,426 captures, making the entire skill synthesis pipeline completely useless to the user.
   - *Action*: Enable manual promotion override in `SkillPromotionService.evaluate()` and wire `CandidateNamerService` into candidate creation so skills have readable names.

3. **[P1] Fix Repeating Activity Log & UI Layout in Thoth Shell (Area C)**
   - *Why*: The UI currently looks broken due to duplicated components rendering on top of each other, giving the user zero confidence in the system.
   - *Action*: Remove `<ptah-skill-diagnostics-accordion>` from the Activity view in `skill-synthesis-tab.component.ts`, move triggers to Settings, and make Suggestions/Active Skills the default landing view.

4. **[P1] Wire Memory Decay Job & Fix Salience Scoring (Area A)**
   - *Why*: 33,413 memories are stuck in recall tier forever because `MemoryDecayJob` is never run and the scoring formula cannot reach the demotion threshold.
   - *Action*: Register `MemoryDecayJob` in `startThothCron` and fix `salience-scorer.ts` to multiply base salience by recency decay.

5. **[P2] Connect Real Invocation Tracking & Cluster-First Skills (Area B)**
   - *Why*: Auto-promotion requires real invocation evidence rather than synthetic creation-time rows.
   - *Action*: Remove synthetic invocation creation in `analyzeSession`, hook `SkillInvocationTracker` into tool execution, and promote based on multi-session clusters.

6. **[P2] Unified Cross-Pillar Activity Stream (Area C)**
   - *Action*: Build a single unified user-facing activity log in the Thoth shell replacing the 4 fragmented diagnostic event feeds.
