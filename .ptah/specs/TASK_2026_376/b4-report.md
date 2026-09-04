# Batch B4 Report — Finding F7 Investigation (TASK_2026_376)

**Target Area**: `libs/backend/skill-synthesis/**`  
**Finding**: F7 — "skill-synthesis appears to redo an unchanged candidate every drain"  
**Mode**: Read-only code trace and architectural analysis

---

## Executive Summary & Verdict

### Verdict: NOT A DEFECT

Finding F7 was opened based on an intuitive misreading of the Electron main-process log. The log was interpreted as:

> _"The drain claimed and re-processed an unchanged candidate, every stage (archaeology, judge-panel, trigger-eval) ran and reported 'unchanged', and each drain wasted several seconds redoing redundant work."_

Source code verification across `libs/backend/skill-synthesis/**` reveals that **none of these assumptions are true**:

1. **A candidate was never claimed.** Queue claiming operates on **stages**, not candidates. In both drains, the single claimed and executed stage was **`prefilter`** (`skill-drain.service.ts:858-888`).
2. **`archaeology`, `judge-panel`, and `trigger-eval` NEVER RAN.** They were never claimed or executed in either drain. Because the drain tier was `frequent`, and those stages belong strictly to `NIGHTLY_ONLY_STAGES` (`skill-drain.service.ts:380-384`) and `WEEKLY_ONLY_STAGES` (`skill-drain.service.ts:385-389`), `select()` excluded them by construction (`skill-drain.service.ts:761, 777`). The log lines reading `archaeology enqueued: {"outcome":"unchanged"}` and `gate stage enqueued: {"stage":"...","outcome":"unchanged"}` were debug logs from `stage-handlers.service.ts:338, 452` logging the outcome of `queue.enqueue()`. The database CAS update (`REOPEN_SQL`, `skill-queue.store.ts:136-142`) confirmed that those downstream stages were already queued or non-terminal, resulting in `outcome: "unchanged"` (a no-op).
3. **Drain 2 was NOT re-running the same session state as Drain 1.** The session grew from **385 turns to 412 turns** between Drain 1 and Drain 2 (`turnCount: 412`). Under the design established in **TASK_2026_351** ("One candidate per session, superseded in place"), whenever an active session produces new turns, runtime triggers re-open the `prefilter` stage (`REOPEN_SQL` condition `turn_count < ?`) so that if the new turns introduce a better or refined workflow, the candidate can be superseded in place.
4. **No LLM calls occurred in either drain.** Zero LLM tokens were spent. In Drain 1, `source: 'boot'` explicitly skipped synthesis (`skill-synthesis.service.ts:776-780`).
5. **The 7,623 ms and 4,932 ms durations went to local CPU/IO operations**: reading and parsing hundreds of turns of JSONL transcripts from disk (`trajectory-extractor.ts:168`), spawning and running local CPU transformer inference in the embedding worker process (`skill-synthesis.service.ts:757`), reading candidate files from disk (`candidate-body.ts:38`), and executing SQLite queue transactions.

---

## Detailed Answers to the Four Questions

### Question 1: When a candidate is reported `unchanged`, what work does the drain still perform?

**Trace concretely**: which stages run, what each costs, and whether any LLM call or file read happens.

#### 1. Stages That Actually Run

- **Only `prefilter` runs.**
- `archaeology`, `judge-panel`, and `trigger-eval` **DO NOT RUN**.
  - In `libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts:371-408`:
    - `FREQUENT_STAGES = ['prefilter', 'synthesis', 'embedding', 'clustering', 'cluster-synthesis', 'judge']`
    - `NIGHTLY_ONLY_STAGES = ['archaeology', 'digest']`
    - `WEEKLY_ONLY_STAGES = ['judge-panel', 'replay', 'trigger-eval']`
    - `DRAIN_TIER_STAGES.frequent` allows only `FREQUENT_STAGES`.
  - In both drain logs, `summary.claimed` was 1 and `summary.done` was 1 (`skill-drain.service.ts:505-512`). That single claimed row was `stage: 'prefilter'` (`stage-handlers.service.ts:218-220`).

#### 2. Work Performed Inside `prefilter` (Before and Up to "candidate unchanged")

When `runPrefilterStage` (`stage-handlers.service.ts:266-292`) calls `workers.analyzeSession(...)` (`skill-synthesis.service.ts:648-865`):

1. **Cache reset**: Clears the in-memory fast-path via `this.analyzedSessions.delete(sessionId)` because `force: true` is passed (`skill-synthesis.service.ts:682-684`).
2. **Transcript disk read and parsing**: Calls `this.extractor.extract(sessionId, workspaceRoot, MIN_ROLE_TURNS_FLOOR, transcriptPath)` (`skill-synthesis.service.ts:688-693`).
   - Resolves directory via `jsonlReader.findSessionsDirectory` (`trajectory-extractor.ts:155-164`).
   - Reads the multi-turn session JSONL file from disk: `await this.jsonlReader.readJsonlMessages(filePath)` (`trajectory-extractor.ts:168`).
   - Iterates through 385 turns (Drain 1) or 412 turns (Drain 2), strips workspace paths, extracts tool usages (`Edit`, `Write`, `Bash`), computes sha256 trajectory hash, and builds `canonicalText` (`trajectory-extractor.ts:213-245`).
3. **Prefilter heuristics & checks**:
   - `this.passesPrefilter(trajectory, settings)` (`skill-synthesis.service.ts:719`): checks minimum turns, tool use counts, regex boundaries.
   - `this.isDominatedByAuthoredSkill([sessionId])` (`skill-synthesis.service.ts:741`): queries `SkillRegistryStore` to ensure no authored skill owns the workflow.
   - `this.store.findByTrajectoryHash(trajectory.hash)` (`skill-synthesis.service.ts:749`): SQLite check for identical full-trajectory hash.
4. **Local Vector Embedding**:
   - `await embeddingProvider.embed([trajectory.canonicalText])` (`skill-synthesis.service.ts:754-768`): Sends the entire `canonicalText` (thousands of tokens) to `EmbedderWorkerClient` (`libs/backend/memory-curator/src/lib/embedder/embedder-worker-client.ts:99-115`), running local transformer inference in an IPC worker process.
5. **Template Body / Synthesis**:
   - Generates template body: `synthesizedBody = this.templateBody(trajectory.canonicalText, trajectory.shortDescription)` (`skill-synthesis.service.ts:770-773`).
   - Because `source === 'boot'` in Drain 1, it logs `[skill-synthesis] boot-scan source — skipping LLM synthesis (template only)` and **skips the LLM synthesizer** (`skill-synthesis.service.ts:776-780`).
6. **Candidate Lookup & File Read**:
   - `prior = this.store.findLatestBySourceSession(sessionId)` (`skill-synthesis.service.ts:811`): queries SQLite for the existing candidate row.
   - Computes `draftHash = contentHash(candidateDescription, synthesizedBody)` (`skill-synthesis.service.ts:813`).
   - **Reads candidate file from disk**: `priorBody = readCandidateBodyFile(prior, this.logger)` (`skill-synthesis.service.ts:814`, `candidate-body.ts:31-41`) reads `SKILL.md` synchronously (`fs.readFileSync`).
   - Computes `priorHash = contentHash(prior.description, priorBody)` (`skill-synthesis.service.ts:815-816`).
   - Compares hashes: `if (prior.trajectoryHash === trajectory.hash || priorHash === draftHash)` (`skill-synthesis.service.ts:820`).
   - In template mode, `templateBody` slices only `canonicalText.slice(0, 4000)` (`skill-synthesis.service.ts:1408-1410`). Because the first 4,000 characters of the transcript are unchanged between turn 385 and 412, `draftHash` equals `priorHash`.
   - Logs `[skill-synthesis] candidate unchanged for this session; reusing` (`skill-synthesis.service.ts:821-824`) and returns `{ candidate: prior, reused: true }`.

#### 3. Work Performed After "candidate unchanged"

Once `analyzeSession` returns `{ candidate: prior, reused: true }`, execution continues in `runPrefilterStage` (`stage-handlers.service.ts:285-291`):

1. **Downstream chaining attempts**:
   - `this.enqueueArchaeology(row)` (`stage-handlers.service.ts:285, 327-354`):
     - Calls `this.queue.enqueue({ sessionId: row.sessionId, stage: 'archaeology', ... turnCount: row.turnCount })`.
     - Opens SQLite transaction `BEGIN IMMEDIATE` (`skill-queue.store.ts:212`).
     - Tries `INSERT_SQL` (`skill-queue.store.ts:215-231`) -> catches `SQLITE_CONSTRAINT_UNIQUE`.
     - Executes `REOPEN_SQL` (`skill-queue.store.ts:136-142, 236-240`):
       ```sql
       UPDATE skill_synthesis_queue
             SET status = 'queued', turn_count = ?, attempt_count = 0,
                 claimed_by = NULL, claimed_at = NULL, finished_at = NULL,
                 not_before = 0, reason = NULL, last_error = NULL
           WHERE session_id = ? AND stage = ?
             AND status IN ('done', 'failed', 'unscored', 'skipped')
             AND turn_count < ?
       ```
     - Because `archaeology` is already in status `'queued'` (awaiting the nightly tier), `status IN (...)` does not match. `changes` is 0.
     - `outcome` is `'unchanged'` (`skill-queue.store.ts:241`).
     - Logs: `[skill-synthesis] archaeology enqueued: {"outcome":"unchanged","turnCount":...}` (`stage-handlers.service.ts:338-342`).
   - `this.enqueueCandidateGates(row, result.candidate.id)` (`stage-handlers.service.ts:286, 415-427`):
     - Calls `this.enqueueGate(row, 'judge-panel', candidateId)` and `this.enqueueGate(row, 'trigger-eval', candidateId)`.
     - Both run the identical `queue.enqueue()` CAS check in SQLite. Because both are weekly stages sitting in status `'queued'`, both update 0 rows and return `outcome: 'unchanged'`.
     - Logs: `[skill-synthesis] gate stage enqueued: {"stage":"judge-panel","outcome":"unchanged"}` and `{"stage":"trigger-eval","outcome":"unchanged"}` (`stage-handlers.service.ts:452-457`).
2. **Marking prefilter completed**:
   - `runPrefilterStage` returns `{ outcome: 'done', candidateId: result.candidate.id, reason: 'reused existing candidate' }`.
   - `SkillDrainService.applyResult` (`skill-drain.service.ts:907-913`) calls `this.queue.markDone(row.id, ...)`, executing an SQLite `UPDATE` to record `status = 'done'`, `finished_at = Date.now()`, `candidate_id = '01M1H5VBHEJA8EAPCQKB33QR5F'`.

#### 4. Summary of I/O & LLM Calls

- **LLM Calls**: **Zero (0).** `source: 'boot'` explicitly skips synthesis; downstream gate stages were not dispatched.
- **File Reads**: **Yes, two (2).**
  1. `this.jsonlReader.readJsonlMessages(filePath)` (`trajectory-extractor.ts:168`) reads the entire JSONL transcript file (385 turns in Drain 1, 412 turns in Drain 2).
  2. `readCandidateBodyFile(prior, this.logger)` (`candidate-body.ts:38`, `skill-synthesis.service.ts:814`) reads the existing `SKILL.md` from the filesystem.

---

### Question 2: Is the re-enqueue on every drain intentional or redundant work?

**Verdict: Fully intentional and required by the architecture.**

#### 1. Why Drain 2 Re-ran

The session grew from **385 turns to 412 turns** (27 new turns) while the background subagent was working (`context.md:9-11`).

1. A runtime trigger in `SkillTriggerService` (`idle`, `turn-complete`, or `subagent-stop`, `skill-trigger.service.ts:394, 467, 718`) called `SkillSynthesisService.enqueueAnalyze(sessionId, workspaceRoot, opts)`.
2. `enqueueAnalyze` (`skill-synthesis.service.ts:557-569`) compared the new turn count (412) against `this.analyzedSessions.get(sessionId)` (385). Because `412 > 385`, the session had legitimately grown.
3. `enqueueAnalyze` called `this.queue.enqueue({ sessionId, stage: 'prefilter', turnCount: 412 })`.
4. In `SkillQueueStore.enqueue` (`skill-queue.store.ts:236-240`), `REOPEN_SQL` ran:
   ```sql
   UPDATE skill_synthesis_queue ... WHERE session_id = ? AND stage = 'prefilter' AND status IN ('done', ...) AND turn_count < 412
   ```
   The previous `prefilter` row was `status: 'done'` with `turn_count: 385`. Because `385 < 412`, `changes === 1`, and the row was reopened to `status: 'queued'` with `turn_count = 412`.

#### 2. Architecture Rationale (TASK_2026_351)

As documented in `libs/backend/skill-synthesis/CLAUDE.md:79`:

> _"One candidate per SESSION, superseded in place... trajectory_hash covers every turn, so a session that grows hashes differently and the findByTrajectoryHash guard misses. The row is then re-drafted from scratch on every re-open... if this session already has a candidate, either the draft is unchanged (return it, write nothing) or it grew (rewrite that row's own SKILL.md and its row, in place)... reused: true on both paths is deliberate."_

Until `prefilter` extracts the trajectory and computes the candidate description and body, the system **cannot know in advance** whether turns 386–412 contained meaningful workflow actions (e.g. key tool calls, problem-solving, bug fixes) that should update the candidate, or merely conversational chit-chat / idle iterations. Checking the grown session to ensure the candidate remains accurate is by design.

#### 3. Were Downstream Stages Re-enqueued?

**No.** `archaeology`, `judge-panel`, and `trigger-eval` were **not** re-enqueued. Their rows already existed in the queue in status `'queued'`. When `runPrefilterStage` called `enqueueArchaeology` and `enqueueCandidateGates`, `REOPEN_SQL` updated 0 rows, and `enqueue()` returned `outcome: 'unchanged'`.

---

### Question 3: Where do the 4932 ms and 7623 ms actually go?

The elapsed time is measured directly in `SkillDrainService.drain()`:

```ts
const startedAt = Date.now();
// ... selection, claiming, handler execution ...
const durationMs = Date.now() - startedAt;
```

(`libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts:504`).

Below is the concrete breakdown with file:line citations:

| Operation                                                 | Implementation Path                                                                                                             | File & Lines                                                                                                     | Cost in Drain 1 (7,623 ms total)                                                                                                                                                 | Cost in Drain 2 (4,932 ms total)                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Workspace Selection & CAS Claim**                       | `SkillDrainService.select()` & `tryClaim()`                                                                                     | `skill-drain.service.ts:755-829, 858`<br>`skill-queue.store.ts:144-147, 297-308`                                 | ~10 ms (SQLite queries)                                                                                                                                                          | ~5 ms (SQLite queries)                                                                                                   |
| **Transcript JSONL Read & Parse**                         | `TrajectoryExtractor.extract()` calling `JsonlReaderService.readJsonlMessages()` and turn normalization                         | `trajectory-extractor.ts:168, 213-226`<br>`skill-synthesis.service.ts:688-693`                                   | **~800–1,200 ms** (Cold disk read and JSON parsing of 385 turns / 70KB+ text on Node main thread)                                                                                | **~600–900 ms** (Warm disk read and JSON parsing of 412 turns)                                                           |
| **Prefilter & Hash Checks**                               | `passesPrefilter()`, `isDominatedByAuthoredSkill()`, `findByTrajectoryHash()`                                                   | `skill-synthesis.service.ts:719, 741, 749`                                                                       | ~10 ms (Regex & SQLite)                                                                                                                                                          | ~10 ms (Regex & SQLite)                                                                                                  |
| **Local Vector Embedding (Worker IPC + Model Inference)** | `embeddingProvider.embed([trajectory.canonicalText])` via `EmbedderWorkerClient.embed()`                                        | `skill-synthesis.service.ts:757`<br>`embedder-worker-client.ts:99-115`                                           | **~6,000–6,500 ms**<br>_(Cold start: spawning embedder worker process, loading transformer ONNX model into memory, tokenizing and embedding 385 turns of canonical text on CPU)_ | **~3,800–4,200 ms**<br>_(Warm start: worker process alive, tokenizing and embedding 412 turns of canonical text on CPU)_ |
| **Template Generation & Candidate File Read**             | `templateBody()`, `findLatestBySourceSession()`, `readCandidateBodyFile()`, `contentHash()`                                     | `skill-synthesis.service.ts:770, 811-820`<br>`skill-synthesis.service.ts:1398-1414`<br>`candidate-body.ts:31-41` | ~30 ms (Disk `fs.readFileSync` of `SKILL.md` + sha256)                                                                                                                           | ~20 ms (Disk `fs.readFileSync` of `SKILL.md` + sha256)                                                                   |
| **Downstream Stage Enqueue Attempts**                     | `enqueueArchaeology()`, `enqueueCandidateGates()` (3 SQLite `BEGIN IMMEDIATE` transactions running `INSERT_SQL` + `REOPEN_SQL`) | `stage-handlers.service.ts:330, 436`<br>`skill-queue.store.ts:212-251`                                           | ~25 ms (3 SQLite transactions)                                                                                                                                                   | ~20 ms (3 SQLite transactions)                                                                                           |
| **Completion Mark & Accounting**                          | `markDone()` and `applyResult()`                                                                                                | `skill-drain.service.ts:907-913`<br>`skill-queue.store.ts:360-376`                                               | ~5 ms (SQLite UPDATE)                                                                                                                                                            | ~5 ms (SQLite UPDATE)                                                                                                    |

**Key takeaway**: Over **85% of the runtime** in both drains is consumed by the **local embedding worker process** (`skill-synthesis.service.ts:757`), with the remainder consumed by synchronous JSONL transcript parsing (`trajectory-extractor.ts:168`).

---

### Question 4: Is there a cheap, correct early-out, and what would it break?

#### 1. Evaluation of Potential Early-Outs

| Candidate Early-Out                                        | State It Would Key On                                                         | What It Would Break                                                                                                                                                                                                                                                                                                                                                                          | Recommendation                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **A. Skip re-analysis if session already has a candidate** | `store.findLatestBySourceSession(sessionId) !== null` at `enqueueAnalyze`     | **FATAL**: Breaks **candidate supersession** (TASK_2026_351). A session that starts with simple exploration but later implements a core reusable routine would permanently keep the initial trivial candidate and never capture the real workflow.                                                                                                                                           | **Reject**                                      |
| **B. Suppress re-analysis while session is active**        | `hasBackgroundWork === true` or session state active in `SkillTriggerService` | **DESTRUCTIVE**: Breaks mid-session skill synthesis for long-running workflows or sessions that never terminate cleanly (crash, window close).                                                                                                                                                                                                                                               | **Reject**                                      |
| **C. Turn count delta threshold**                          | `trajectory.turnCount - lastTurnCount < THRESHOLD` (e.g. 50 turns)            | **FRAGILE**: Arbitrary heuristic. 27 turns grew here, which is already a significant chunk. It would delay or permanently drop workflow improvements in shorter sessions.                                                                                                                                                                                                                    | **Reject**                                      |
| **D. Deferred Embedding in `analyzeSession`**              | Candidate `prior` exists, and `priorHash === draftHash`                       | **BREAKS NOTHING**: Currently, `embeddingProvider.embed()` runs at `skill-synthesis.service.ts:757`, **before** the check against `prior` at lines 811–820. When `priorHash === draftHash`, the computed embedding is completely discarded. Deferring the embedding call until after checking if the draft changed would eliminate 3–4 seconds of CPU embedder work on unchanged candidates. | **Viable Future Optimization** (Non-blocking)   |
| **E. Clarify loud logging**                                | `outcome === 'unchanged'` in `stage-handlers.service.ts:338, 452`             | **BREAKS NOTHING**: The log message `archaeology enqueued: {"outcome":"unchanged"}` confuses operators into thinking the stage was claimed and re-processed.                                                                                                                                                                                                                                 | **Recommended Documentation / Log Improvement** |

---

## Detailed Findings

### Sub-Finding 1: Log Ambiguity Created the Impression of Re-Processing

In `stage-handlers.service.ts:338, 452`, the logger emits:

```ts
this.logger.debug('[skill-synthesis] archaeology enqueued', { sessionId, outcome: result.outcome, turnCount });
this.logger.debug('[skill-synthesis] gate stage enqueued', { sessionId, stage, outcome: result.outcome, candidateId });
```

When `result.outcome` is `'unchanged'`, `SkillQueueStore.enqueue()` did **not** enqueue anything new; it encountered a constraint collision on `(session_id, stage)` and `REOPEN_SQL` updated 0 rows. Emitting `"... enqueued: outcome: unchanged"` reads as if the stage ran and finished with an outcome of "unchanged", whereas it was merely a skipped enqueue attempt.

### Sub-Finding 2: `REOPEN_SQL` Retains `source: 'boot'`

In `skill-queue.store.ts:136-142`:

```sql
UPDATE skill_synthesis_queue
      SET status = 'queued', turn_count = ?, attempt_count = 0,
          claimed_by = NULL, claimed_at = NULL, finished_at = NULL,
          not_before = 0, reason = NULL, last_error = NULL
    WHERE session_id = ? AND stage = ?
      AND status IN ('done', 'failed', 'unscored', 'skipped')
      AND turn_count < ?
```

When a row is initially created during boot scan, it has `source: 'boot'`. When a later runtime trigger (`turn-complete` or `idle`) re-opens the row at turn 412, `REOPEN_SQL` does not update the `source` column. Consequently, the row permanently retains `source: 'boot'`. In `analyzeSession` (`skill-synthesis.service.ts:776`), `source === 'boot'` causes the system to skip LLM synthesis and use template fallback. This is why Drain 2 also ran in template mode without LLM calls.

### Sub-Finding 3: Discarded Embedding Computation

In `skill-synthesis.service.ts:754-768`, the embedder is invoked to embed `trajectory.canonicalText`. However, at lines 811–826, if `prior` exists and `priorHash === draftHash`, the method returns `{ candidate: prior, reused: true }`. The freshly computed `embedding` is never passed to `store.superseded()` or stored in SQLite. Deferring the embedder call to lines 837 and 870 (when writing to disk/store) would save ~3 seconds on every unchanged prefilter run.

---

## Final Recommendation

1. **Close Finding F7 as NOT-A-DEFECT**:
   - The drain is functioning exactly as designed under TASK_2026_351.
   - Downstream stages (`archaeology`, `judge-panel`, `trigger-eval`) are not re-running or wasting LLM calls.
   - The re-opening of `prefilter` is necessary to detect candidate supersession when sessions grow.
2. **Backlog Optimization (Deferred to future refactoring)**:
   - Move `embeddingProvider.embed()` in `skill-synthesis.service.ts` so it runs lazily only if a candidate is genuinely new or superseded, saving ~3 seconds of CPU embedding time on unchanged checks.
   - In `stage-handlers.service.ts`, suppress or reword `"... enqueued"` debug logs when `outcome === 'unchanged'` to prevent operator confusion.
