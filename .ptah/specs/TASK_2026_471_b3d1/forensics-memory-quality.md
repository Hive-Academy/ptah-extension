# Memory Quality Forensics & Evaluation Report

## Verdict
The memory system is worth elevating, but the existing 36,252-row corpus is severely polluted (~55% ephemeral sediment) and retrieval is crippled by query expansion defects. The write path routinely captures temporary worktrees, dead branches, and agent timeouts alongside genuine architectural decisions. The merge path is dead—98.3% of rows are singletons because merge candidate resolution is artificially capped to the top 200 recency-decayed memories and filtered by exact string equality. BM25 retrieval currently drowns in noise because conversational stopwords are joined with `OR`. With two targeted surgical code fixes (`fts-query.util.ts` and `memory-curator.service.ts`) plus an automated purge of event sediment, the system becomes highly performant.

## Write quality

Across the database's 36,252 rows, the write path operates without an effective durability filter. A stratified random sample of 60 memories (15 from each kind: `fact`, `event`, `preference`, `entity`) reveals a **50% overall sediment ratio** (30 durable knowledge vs. 30 ephemeral sediment). Because `fact` (72.0%) and `event` (15.7%) comprise 87.7% of all rows, and `event` is virtually 100% sediment, the corpus-wide volume of sediment is estimated at **~55% (~20,000 rows)**.

### Strata Breakdown
- **Fact** (15 sampled): 8 Knowledge (53.3%), 7 Sediment (46.7%)
- **Event** (15 sampled): 0 Knowledge (0%), 15 Sediment (100%)
- **Preference** (15 sampled): 11 Knowledge (73.3%), 4 Sediment (26.7%)
- **Entity** (15 sampled): 11 Knowledge (73.3%), 4 Sediment (26.7%)

### Quoted Samples: Durable Knowledge (Signal)
These memories provide durable, reusable invariants that prevent regression across future sessions:

- **`01KTH0R3RQFFEBQ2XVQ6WJMB0G`** (Kind: `fact`, Subject: `jest-preset-angular-peer-deps`):
  > *"jest-preset-angular@16.1.1 declares peer deps on @angular/platform-browser-dynamic, jsdom, and jest. Initial audit marked @angular/platform-browser-dynamic and jest-environment-jsdom as unused, but test suite failed with 'testEnvironment jsdom cannot be found'. Both are peer deps required by the preset."*
  > *Verdict*: Reusable dependency gotcha saving hours of re-debugging.

- **`01M2P3R4VT8VCYS9Q25ZSSSH6H`** (Kind: `preference`, Subject: `nx-test-invocation`):
  > *"This repository requires using `npx nx run-many -t test -p ...` for multiple projects; `nx test projA projB` can run only the first project while silently treating later names as Jest filters."*
  > *Verdict*: Critical repository command execution trap.

- **`01KV8DYKPYRYY5GHYZNXHQJZBJ`** (Kind: `preference`, Subject: `follow-conductor-model`):
  > *"User (Abdallah) wants Ptah Electron to follow Conductor's thin-orchestrator shape, not VS Code's thick editor. Rationale: we're paying for Monaco/vim/terminal stack we'll never ship better than existing editors; the moat is multi-agent orchestration (Electron + VS Code + CLI from same hexagonal core), not syntax UX."*
  > *Verdict*: Foundational architectural mandate directly from project owner.

- **`01KXEVEVH57BDW2T8G9MG59EGJ`** (Kind: `preference`, Subject: `ptah-di-dual-literal-convention`):
  > *"The dual-literal convention in Ptah DI: a port token file (memory-contracts) and its adapter token file (memory-curator) both declare the same Symbol.for() string literal independently (not by reference) so the static di-lint alias resolver can trace both sides. This requires whitelisting the description in tokens-uniqueness.spec.ts INTENTIONAL_CROSS_LIB_MIRRORS."*
  > *Verdict*: Essential project-specific DI compiler invariant.

- **`01M128QR4JF757QY2V6R6QZ9D4`** (Kind: `fact`, Subject: `ptah-electron-logs`):
  > *"Ptah Electron logs live at C:/Users/abdal/AppData/Roaming/Ptah/logs/ with filename 'Ptah Electron-YYYY-MM-DD.log' (not 'ptah-YYYY-MM-DD.log' as docs claim). The Windows username is 'abdal', not 'Abdallah'. Entries are tagged [main]/[renderer]; the current day's log is the one to grep for RPC/button activity."*
  > *Verdict*: High-value operational host debugging fact.

### Quoted Samples: Ephemeral Sediment (Noise)
These memories capture scratchpad status, temporary task worktrees, agent rate-limit aborts, and ephemeral git commits that will never be useful again:

- **`01M2NY5Q2BG1VRMZYHADJG57Y6`** (Kind: `event`, Subject: `batch-6-review-roster`):
  > *"The planned Ollama Cloud Batch 6 reviewer exited with code 0 without producing a review because the account hit a 429 session usage limit. Review was reassigned to a Claude code-logic-reviewer subagent, while antigravity remained reserved for Gate 3."*
  > *Verdict*: Transient 429 error and subagent re-dispatch from a dead session.

- **`01M28Z4APEXE95S1765T1J4CH6`** (Kind: `event`, Subject: `task-2026-413-commit-gate`):
  > *"TASK_2026_413 is being developed in D:/projects/ptah-extension/.claude/worktrees/git-review-controls on branch fix/git-review-controls. The work remains uncommitted and unrebasable until Batch 6R passes and the user authorizes a local commit; no push or PR is authorized."*
  > *Verdict*: Ephemeral worktree path and local commit gate status.

- **`01M291N21FR7GNERFX92ZSFTH2`** (Kind: `event`, Subject: `pr-493-task-411`):
  > *"Several parallel workstreams were active: a senior tester was fixing the PR #493 DI test; Stream C was addressing PR #493 gaps G1–G5 and B8; a reviewer and frontend developer were handling TASK 411 B4/B5; and a Codex CLI agent was working on TASK 411 B7 before fixing four B6 timing defects."*
  > *Verdict*: Work diary tracking which subagents were assigned to which stream.

- **`01M2GKGP1W4D6033N0W5RS4DCG`** (Kind: `preference`, Subject: `task-2026-440-batch-6-constraints`):
  > *"For Batch 6, edit only files under libs/frontend/memory-curator-ui/src/lib in the task worktree, use absolute Windows paths for file operations, do not edit batches.md, commit, push, run history-changing git commands, or run nx reset. Frontend libraries may import only shared types and existing frontend libraries, never backend libraries."*
  > *Verdict*: Single-turn prompt instructions for an agent executing Batch 6 of Task 440.

- **`01KV8ZRX5FGCWDSV1MRESX13RN`** (Kind: `fact`, Subject: `auto-updater-activation-timing`):
  > *"UpdateManager startup (post-window.ts:200) is sequentially blocked by awaited messagingGateway.start() (line 158), causing the UpdateManager log to land outside the test's 2.5s window under forced NODE_ENV=production."*
  > *Verdict*: Hyper-specific timeout investigation of a single Jest test under synthetic env flags.

## Subject collapse

The `subject` column does not act as an index key. Instead, it has collapsed into a combination of repository/directory buckets and fragmented one-shot phrases.

### Data Evidence
- **27,354 distinct subjects** across **36,252 rows**.
- **23,723 subjects (86.7%) appear exactly once.**
- The most frequent subjects are monorepo applications or libraries, not concepts:
  - `ptah-video-studio`: 246 rows
  - `ptah-extension`: 165 rows
  - `skill-synthesis`: 111 rows
  - `tribunal-panel`: 98 rows
  - `ptah`: 73 rows
  - `ptah-landing-page`: 62 rows
  - `ptah-electron`: 58 rows
  - `commitlint-scope-enum`: 50 rows
  - `agent-sdk`: 49 rows

### Root Cause in Code
In [`libs/backend/memory-curator/src/lib/curator-llm/extract-prompt.ts:25`](file:///D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/curator-llm/extract-prompt.ts#L25):
```typescript
- "subject": a normalized lowercase key (e.g., "auth-service", "ptah") or null.
```
The extraction system prompt explicitly instructs the LLM with few-shot examples that are repository/service names (`"auth-service"`, `"ptah"`). The model followed this instruction literally: whenever an agent ran inside `apps/ptah-video-studio`, it classified almost every extracted memory under the subject `ptah-video-studio`.

### Case Study: Three Quoted Examples Under `ptah-video-studio`
Under `ptah-video-studio` (246 rows), totally unrelated technical domains are lumped together:

1. **Row `01KWF7T1YZ5A14XYYCCBZD7JZ4`**
   - *Current Subject*: `ptah-video-studio`
   - *Content*: `"Disabling SAC (Server-side Accounting or similar compile flag) unlocks Remotion's native compositor, enabling full end-to-end video rendering pipeline. Local file assets must use --public-dir + staticFile() instead of file:// paths."`
   - *What the subject should have been*: `remotion-windows-sac-and-asset-serving` or `windows-smart-app-control-remotion`

2. **Row `01KWN2G6TQ2BZD6FX94FKAEAWG`**
   - *Current Subject*: `ptah-video-studio`
   - *Content*: `"Showcase launcher now records deterministically at full 1440p resolution. Enumerates all displays, selects one that can host the CSS window (recordSize / scaleFactor), sizes the viewport correctly, and anchors at work-area origin so device backing buffer equals record size exactly (e.g., 1708×960 CSS at 150% = 2560×1440 device). Falls back with warning to best on-screen option when no display fits target."`
   - *What the subject should have been*: `electron-showcase-display-scaling` or `showcase-launcher-1440p-resolution`

3. **Row `01KXBN9DC7JM7BR7JNPFD6T5PK`**
   - *Current Subject*: `ptah-video-studio`
   - *Content*: `"The Electron showcase capture has a 113px solid gray (RGB 128,128,128) dead-band at the bottom of every 1920x1080 recording. Real content is the top 967px. render-all.mjs auto-detects this with sharp and passes contentHeight in the source prop."`
   - *What the subject should have been*: `electron-capture-viewport-deadband` or `showcase-recording-gray-deadband`
   *(Note: An unmerged near-duplicate of this exact row exists as `01KXKAVFPBQ8DQC61S35C2PY22` under the same subject).*

## The merge that never fires

The merge pipeline is almost entirely inert. Out of 36,252 rows, **only 620 memories (1.71%) have ever received a merge** (`chunk_count > 1`). Exactly 35,632 memories (98.29%) remain singletons.

### Root Cause 1: The 200-Memory Recency Window Trap
In [`libs/backend/memory-curator/src/lib/memory-curator.service.ts:608-612`](file:///D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/memory-curator.service.ts#L608-L612):
```typescript
    const related =
      subjects.size > 0
        ? this.store
            .list({ workspaceRoot: input.workspaceRoot ?? null, limit: 200 })
            .memories.filter((m) => m.subject && subjects.has(m.subject))
            .map((m) => ({ id: m.id, subject: m.subject, content: m.content }))
        : [];
```
`this.store.list({ limit: 200 })` is defined in [`libs/backend/memory-curator/src/lib/memory.store.ts:366-367`](file:///D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/memory.store.ts#L366-L367) as:
```typescript
SELECT m.* FROM memories m ${whereSql} ${salienceRankOrderBy('@rankNow')} LIMIT @__limit OFFSET @__offset
```
`salienceRankOrderBy` decays score exponentially by age: `604800000 / (604800000 + ageMs)` ([`libs/backend/memory-curator/src/lib/salience-ranking.ts:34-36`](file:///D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/salience-ranking.ts#L34-L36)). Consequently:
1. `store.list({ limit: 200 })` retrieves only the **top 200 most recent rows** in the workspace.
2. In a workspace with ~36,000 memories, **99.45% of existing memories are never fetched**.
3. If an existing memory with subject `commitlint-scope-enum` is older than a few days, it is completely absent from the 200 rows fetched.
4. `related` evaluates to `[]`. The LLM receives `Existing: []` in [`libs/backend/memory-curator/src/lib/curator-llm/resolve-prompt.ts:30`](file:///D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/curator-llm/resolve-prompt.ts#L30) and cannot merge.

### Root Cause 2: Exact String Matching vs Case-Insensitive Prompt
In [`memory-curator.service.ts:610`](file:///D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/memory-curator.service.ts#L610):
```typescript
.filter((m) => m.subject && subjects.has(m.subject))
```
`subjects.has()` is an exact, case-sensitive JavaScript `Set` lookup. Yet the curator prompt in [`resolve-prompt.ts:19`](file:///D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/curator-llm/resolve-prompt.ts#L19) states:
> *"Prefer mergeTargetId when subjects match (case-insensitive). If unsure, set null."*
Any minor variation in casing, hyphens, or terminology blocks the candidate in TypeScript before the LLM ever sees it.

### Root Cause 3: Subject Synonyms
Because extraction has no canonical vocabulary, topics fracture into dozens of near-identical subjects:
- **81 distinct subjects** exist solely for commitlint rules:
  - `commitlint-scope-enum` (50 rows)
  - `commitlint-scopes` (37 rows)
  - `ptah-commitlint` (26 rows)
  - `ptah-commitlint-scopes` (16 rows)
  - `commitlint-scope-mapping` (9 rows)
  - `commitlint-scope-rules` (7 rows)
  - `commitlint-scope-enum-restriction` (7 rows)
- Because their subjects do not match byte-for-byte, they are never considered candidates for merging.

### Quantification of Duplicates in Substance
- **Exact duplicate contents**: 10 distinct content strings are repeated byte-for-byte across 23 rows.
- **Verbatim scope enumeration**: **222 rows** contain the exact string `"webview, vscode"` repeating the 13 commitlint scopes.
- **Commitlint references**: **599 memories** describe commitlint hooks, rejections, or scope rules.
- **Trigram Jaccard similarity (>0.4)**: Among subjects with multiple rows, **3,631 subjects** hold 12,494 rows; hundreds of rows share near-identical content within their own subject without being merged (e.g. 50 single-chunk rows under `commitlint-scope-enum`).

## Retrieval, judged

The retrieval engine is implemented in [`libs/backend/memory-curator/src/lib/memory-search.service.ts:280-366`](file:///D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/memory-search.service.ts#L280-L366). In the CLI and VS Code extension runtimes, `workerClient` is null ([`memory-search.service.ts:374-376`](file:///D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/memory-search.service.ts#L374-L376); [`libs/backend/memory-curator/src/lib/di/register.ts:58`](file:///D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/di/register.ts#L58)), degrading search to BM25-only.

BM25 query generation in [`libs/backend/memory-curator/src/lib/fts-query.util.ts:26-38`](file:///D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/fts-query.util.ts#L26-L38):
1. Does not strip common English stopwords (`what`, `did`, `we`, `do`, `how`, `why`, `the`, `about`).
2. Joins all tokens with `OR`: `tokens.map(...).join(' OR ')`.
3. In a 38,952-chunk FTS index, virtually every chunk matches `"the"`, `"we"`, or `"what"`.
4. High-frequency stopword collisions dominate the BM25 score, causing catastrophic ranking degradation.

Below are realistic queries executed against the live database using the system's exact BM25 algorithm, with top 5 hits judged:

---

### Query 1: *"what did we decide about the judge threshold"*
- **FTS Expression**: `"what" OR "did" OR "we" OR "decide" OR "about" OR "the" OR "judge" OR "threshold"*`
- **Result Quality**: **0 / 5 relevant (Total Failure)**
  - **Rank 1** (`01KV6483...`, Subj: `video-narration-tone`, Score: -17.44):
    > *"Plain, conversational, first-person. Show the work; let viewers decide. No hype words (production-grade, airtight, seamless, watch this, the whole game). Don't tell viewers how to feel. Cost mentioned factually once (E12), not as recurring slogan..."*
    > *Judgment*: **Irrelevant**. Matched "what", "decide", "the".
  - **Rank 2** (`01KV7344...`, Subj: `video-narration-style`, Score: -14.07):
    > *"Voice is conversational first-person, honest about limits and trade-offs, zero superlatives. No: production-grade, airtight, bulletproof, seamless, game-changing, magic. State what happens; let the viewer judge..."*
    > *Judgment*: **Irrelevant**. Matched "judge" as a verb describing video viewers.
  - **Rank 3** (`01M03NC29B9NXXB5GB6JARE6C5`, Subj: `skill-demotion-ordering`, Score: -14.01):
    > *"Dormancy demotion orders by win rate ASCENDING with NULLS LAST. Unmeasured skills sort after measured losers—we know the least about unmeasured, so demoting it first is the largest risk."*
    > *Judgment*: **Irrelevant**. Matched "we", "the".
  - **Rank 4** (`01M2KPB0HTACX3BQ82KVTN13RZ`, Subj: `stuck-nx-test-process`, Score: -13.95):
    > *"A likely orphaned Nx test process (PID 36040) was found running `run-executor.js` for `@ptah-extension/memory-curator --testPathPatterns memory-lifecycle.service`... Another session confirmed they did not own it and judged it stuck rather than progressing."*
    > *Judgment*: **Irrelevant**. Matched "judged" in an incident report.
  - **Rank 5** (`01KV3YBRQSVKRP7KER820RX95K`, Subj: `video-narration-style`, Score: -13.88):
    > *"Plain, first-person, conversational tone: 'show the work and let viewers decide.' Avoid rhetorical hooks, superlatives, declarations of superiority..."*
    > *Judgment*: **Irrelevant**. Duplicate video narration note matching "decide".
- **Drowned Signal**: The database contains **22 memories** explicitly defining judge thresholds (e.g. `01M016SMXX42W45RPW7S09CJ8G` defining `skillSynthesis.judgePanel.disagreementThreshold` = 3, and `01KVX3H2MVAWZBG75XFH6M96GK` defining `minJudgeScore` composite averaging). **Zero of the 22 surfaced in the top 5.**

---

### Query 2: *"how do we name DI tokens"*
- **FTS Expression**: `"how" OR "do" OR "we" OR "name" OR "di" OR "tokens"*`
- **Result Quality**: **0.5 / 5 relevant**
  - **Rank 1** (`01KV6271QS58NEADTB4AQKG2M6`, Subj: `ptah-electron-product-direction`, Score: -13.88):
    > *"User directly challenged the 'be like VS Code' trajectory: 'do you think we can rely and follow competitor like conductor... they don't provide heavy ui component like what we are doing...'"*
    > *Judgment*: **Irrelevant**. Matched "do", "we".
  - **Rank 2** (`01M1XHJR23JE8Z1A7DMZ2DMZ8N`, Subj: `sonarqube-facade-rule`, Score: -13.76):
    > *"When refactoring duplicated factories: keep public class name, DI token, and method signatures unchanged. Extract shared logic as collaborator or base class injected into factory..."*
    > *Judgment*: **Poor**. Mentions "DI token" in passing; does not specify naming conventions.
  - **Rank 3** (`01KXBGBTPSQJ76P25YXWG9FC1Q`, Subj: `memory-store`, Score: -13.10):
    > *"MemoryStore.recordHit() at line 507 of memory.store.ts increments hits+1 and updates last_used_at on every memory access/search. The hits counter is the 'how many times we hold this memory' signal..."*
    > *Judgment*: **Irrelevant**.
  - **Rank 4** (`01KWMG3G17110M3X6DD27KDAPT`, Subj: `di-smoke-tests`, Score: -12.12):
    > *"The smoke tests (ptah-extension-vscode and ptah-electron) build minimal hand-crafted DI containers that register only the tokens the shared RPC handlers @inject. They catch token-slot drift..."*
    > *Judgment*: **Poor**. Describes smoke testing token registration slots, not naming rules.
  - **Rank 5** (`01KVTQ0JRK249ZWWSS4J50C919`, Subj: `workspace-intelligence-tokens`, Score: -11.67):
    > *"DI token names for workspace-intelligence services: DEPENDENCY_GRAPH_SERVICE, AST_ANALYSIS_SERVICE, TREE_SITTER_PARSER_SERVICE (defined in libs/backend/vscode-core/src/di/tokens.ts lines 77–84, 207–212)..."*
    > *Judgment*: **Partially relevant**. Gives 3 concrete examples in `UPPER_SNAKE`, but misses the general rule.
- **Drowned Signal**: The database contains exact answers explaining the `Symbol.for` dual-literal convention (`01KXEVEVH57BDW2T8G9MG59EGJ`) and `tools/di-lint` token requirements (`01KXCACXQP04RWFHJY6CPF7GG3`), none of which ranked.

---

### Query 3: *"why did the release branch drift"*
- **FTS Expression**: `"why" OR "did" OR "the" OR "release" OR "branch" OR "drift"*`
- **Result Quality**: **3 / 5 relevant (Usable, but dominated by unmerged duplicates)**
  - **Rank 1** (`01M1JHQ2ZX974E7W48EMNT6HJG`, Subj: `release-branch-policy`, Score: -14.23):
    > *"Never merge into release branches (release/electron, release/landing, release/docs) and never open PRs against them. They are deploy triggers that mirror main. Use 'Sync Release Branch' workflow (workflow_dispatch) to fast-forward and dispatch pipeline. Prevents merge-commit drift and pre-commit hook side effects."*
    > *Judgment*: **Highly relevant**. Explains how drift happens and the policy banning direct merges.
  - **Rank 2** (`01M1CW1PEZ96929CWN94GER54D`, Subj: `ptah-release-branches`, Score: -13.78):
    > *"Never merge into release branches (`release/electron`, `release/landing`, `release/docs`), and never open PRs against them. They are deploy triggers that mirror `main`, not work branches. Use 'Sync Release Branch' workflow (workflow_dispatch) which fast-forwards and dispatches pipeline. Ban exists because local merges trigger husky, format files nobody edited, and create conflicts that hand-resolve into drifted state."*
    > *Judgment*: **Highly relevant, but an unmerged duplicate of Rank 1**.
  - **Rank 3** (`01KTH364B7C6B8S29PB55TK9KT`, Subj: `v0.1.49-release`, Score: -13.54):
    > *"v0.1.49 released from release/electron branch, which did not include commits 30724532 or 0ccc9815. The release shipped with the Nx cache bug still active and no post-pack gate, resulting in app.asar with zero wasm/ entries..."*
    > *Judgment*: **Relevant historical instance** of release branch drift.
  - **Rank 4** (`01KTH10JAVY9S7FQBEDFSXFGJT`, Subj: `pr-284-merge-conflict-resolution`, Score: -12.82):
    > *"PR #284 (main → release/extension) had package-lock.json conflict due to dependency drift between branches. Resolved by accepting main's lockfile (checkout --theirs) since main carries the canonical merged tree. Merge committed 63639f8c to release/extension."*
    > *Judgment*: **Specific incident** of branch drift.
  - **Rank 5** (`01M1YSJGCVEFC1W2EXAWT6ZXNZ`, Subj: `task-2026-383-open-questions`, Score: -12.26):
    > *"Two open questions remain on TASK_2026_383: (1) Why did config:models-list regress from 1175 ms to 2039 ms? (2) What is the session:list count issue?"*
    > *Judgment*: **Irrelevant**. Matched "why", "did".

---

### Query 4: *"what is the user's preference for commit messages"*
- **FTS Expression**: `"what" OR "is" OR "the" OR "user's" OR "preference" OR "for" OR "commit" OR "messages"*`
- **Result Quality**: **1 / 5 relevant**
  - **Rank 1** (`01KV60ZM1ZQNQJGDR4XCZJ0314`, Subj: `di-refactor-commit-message-accuracy`, Score: -15.95):
    > *"Commit d5c42b88 ('consolidate shared RPC handlers') has a minor message inaccuracy: claims LlmRpcHandlers decorator added was `@inject(SETTINGS_TOKENS.MODEL_SETTINGS)` when it was actually `@inject(PLATFORM_TOKENS.DI_CONTAINER)`. Code is correct, only message is wrong. Not amended per user's CLAUDE.md preference for new commits over amends."*
    > *Judgment*: **Poor**. Describes a single commit message typo from one session.
  - **Rank 2** (`01KTK9ZY51KYDTXT3ST736ZVNT`, Subj: `pr-284-merge-conflict-resolution`, Score: -12.68):
    > *"PR #284 (main → release/extension merge) conflicted on package-lock.json. Resolved by taking main's version (theirs) per the user's preference for latest changes from main. Merge commit 63639f8c pushed to release/extension."*
    > *Judgment*: **Irrelevant**. Matched "user's preference" on git merge conflicts.
  - **Rank 3** (`01KX2Y7FXQTZKG0BQ1KWWQJ7HQ`, Subj: `ptah-commit-style`, Score: -12.38):
    > *"Commit messages follow pattern `type(scope): title` (e.g., `test(electron): ...`, `fix(electron): ...`); body explains why not what; include detailed context for subtle fixes."*
    > *Judgment*: **Highly relevant (Gold hit)**. Exactly what was requested.
  - **Rank 4** (`01KTRVZGTVJZ31JCQ8SF45GAZK`, Subj: `user-communication-transparency`, Score: -12.20):
    > *"User (architect) expects clear status updates on time spent and what was actually accomplished, not layers of agent spawning without visible progress..."*
    > *Judgment*: **Irrelevant**. Noise on "user" + "preference".
  - **Rank 5** (`01KWJHE4HK283ZVNDSVJHFQA0T`, Subj: `ptah-codebase`, Score: -11.84):
    > *"Minimal comments preferred in repo. Only add one-line comments when the WHY is non-obvious (hidden constraint, subtle invariant, workaround for bug)..."*
    > *Judgment*: **Irrelevant**. Noise on "preferred".

---

### Retrieval Summary
Out of 20 top-5 results across the 4 queries, **only 4.5 hits were relevant (22.5% precision)**. The 36,252 rows are **heavily drowning the signal**. BM25 `OR` queries on unstemmed, stopword-laden input cause sediment rows with accidental word co-occurrences to outscore genuine answers.

## Salience distribution

`salience` is written once on insert from the LLM's `salienceHint` ([`extract-prompt.ts:27`](file:///D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/curator-llm/extract-prompt.ts#L27); [`memory-curator.service.ts:665-668`](file:///D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/memory-curator.service.ts#L665-L668)).

### Measured Distribution
- **Total rows**: 36,252
- **Minimum**: 0.10
- **Maximum**: 1.00
- **Mean**: 0.8124
- **Distinct values**: 67
- **Clustering**: The top 5 values represent **58.65% (21,261 rows)** of the entire database:
  1. `0.80`: 5,118 rows (14.12%)
  2. `0.85`: 4,330 rows (11.94%)
  3. `0.70`: 4,320 rows (11.92%)
  4. `0.90`: 3,878 rows (10.70%)
  5. `1.00`: 3,615 rows (9.97%)
- **High-salience skew**: **85.54% of all rows (31,010)** have `salience >= 0.70`. Only 3.66% (1,326 rows) have `salience < 0.50`.

### Mathematical Impact on Ranking
In [`libs/backend/memory-curator/src/lib/salience-ranking.ts:21-27, 34-36`](file:///D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/salience-ranking.ts#L21-L27):
```sql
ORDER BY (m.salience * (604800000.0 / (604800000.0 + MAX(0, ? - m.last_used_at))) + 0.3 * m.hits / (m.hits + 3.0) + m.pinned) DESC, m.id DESC
```
Because `m.salience` is clustered tightly between 0.70 and 0.90 across 85% of rows, the `salience` multiplier carries negligible discriminatory variance. The ranking expression is effectively dominated by:
$$\text{Age Decay} = \frac{604,800,000}{604,800,000 + \text{ageMs}}$$
The ranking expression built on `salience` is **decorative**. It functions almost entirely as a pure recency filter, decaying durable 30-day-old facts down to ~0.15 while promoting ephemeral 1-day-old sediment up to ~0.80.

## Smallest change with the largest effect

### The Single Smallest Change with Largest Effect: Stopword Pruning & AND-Joined FTS Query
**File**: [`libs/backend/memory-curator/src/lib/fts-query.util.ts:26-38`](file:///D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/fts-query.util.ts#L26-L38)

Currently, `escapeFtsQuery` splits the query, leaves conversational filler (`what`, `did`, `we`, `do`, `how`, `why`, `the`, `is`, `about`), and joins all tokens with `OR`:
```typescript
  const tokens = rawQuery
    .toLowerCase()
    .replace(/["*()^:+\-~]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .filter((t) => !FTS5_KEYWORDS.has(t));

  return tokens
    .map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`))
    .join(' OR ');
```

#### The Fix:
1. Filter out common English stopwords (`Set(['what', 'did', 'we', 'how', 'do', 'why', 'the', 'is', 'for', 'about', 'to', 'in', 'on', 'of', 'and', 'or'])`).
2. Join content terms with `AND` (with fallback to `OR` only if `AND` yields zero rows).

#### Proof of Impact on Live Data:
Running Query 1 with this fix (`"judge" AND "threshold"*`) against the exact same uncleaned live database transforms the results from 0% relevance to **5/5 pure signal**:
1. **Rank 1** (`skill-promotion-threshold`): *"Skill promotion uses the configured successesToPromote threshold unless a candidate has at least generalizationContextThreshold distinct contexts..."*
2. **Rank 2** (`skill-synthesis`): *"Industry consensus (ACE 2025, SkillTTA, Trace2Skill, Voyager) is to cluster trajectories and use LLM-driven incremental curation — NOT heuristic/arithmetic gating. Single-session judging in isolation causes 'sequential overfitting'..."*
3. **Rank 3** (`p3-batch-1-committed`): *"Includes enhance() pipeline: collect signal → generate candidate → judge gate... 24h per-slug cooldown + 5-invocation min threshold."*
4. **Rank 4** (`p3-enhancer-architecture`): *"Judge-gated (fail-open if judge unavailable) auto-enhancement triggered inside curator pass or invocation-threshold..."*
5. **Rank 5** (`p3_auto_enhance`): *"gates on judge... 24h cooldown + invocation threshold + CuratorRateLimitService cap..."*

### The Write-Side Fix: Uncapping Merge Candidate Retrieval
**File**: [`libs/backend/memory-curator/src/lib/memory-curator.service.ts:608-612`](file:///D:/projects/ptah-extension/libs/backend/memory-curator/src/lib/memory-curator.service.ts#L608-L612)

Replace the in-memory `store.list({ limit: 200 }).filter(...)` with a targeted SQL query:
```typescript
// Replace store.list({ limit: 200 }) with indexed subject search:
SELECT id, subject, content FROM memories
WHERE workspace_root IS ? AND LOWER(subject) IN (...)
```
This single change eliminates the 200-row recency horizon and allows newly extracted drafts to find and merge into their existing subject counterparts across all 36,252 rows.

### The Corpus Cleanup Prerequisite
Code fixes alone will not resolve the storage bloat:
1. **Purge all 5,691 rows of `kind = 'event'`**: Events are 100% ephemeral work logs, dead PR states, and subagent rosters.
2. **Purge task worktree rows**: Query `WHERE subject LIKE 'task-2026-%' OR content LIKE '%worktrees%'`.
3. **Deduplicate commitlint scopes**: Deduplicate the 222 verbatim copies of `.commitlintrc.json` scopes into a single canonical architectural memory.

## Queries used

All queries were executed read-only against `%USERPROFILE%\.ptah\state\ptah.sqlite` via `better-sqlite3`:

1. **Total row counts and schema inspection**:
   ```sql
   PRAGMA table_info(memories);
   SELECT count(*) as count FROM memories;
   SELECT kind, count(*) as count FROM memories GROUP BY kind;
   ```

2. **Salience distribution and clustering**:
   ```sql
   SELECT salience, count(*) as cnt, round(count(*) * 100.0 / 36252, 2) as pct
   FROM memories
   GROUP BY salience
   ORDER BY cnt DESC;

   SELECT min(salience) as min, max(salience) as max, avg(salience) as avg, count(DISTINCT salience) as distinct_salience
   FROM memories;
   ```

3. **Merge frequency and chunk count distribution**:
   ```sql
   SELECT chunk_count, count(*) as memory_count
   FROM (SELECT memory_id, count(*) as chunk_count FROM memory_chunks GROUP BY memory_id)
   GROUP BY chunk_count ORDER BY chunk_count DESC;

   SELECT count(*) as cnt FROM memories WHERE updated_at != created_at;
   ```

4. **Subject casing and distinctness**:
   ```sql
   SELECT count(subject) as total_with_subject, count(DISTINCT subject) as distinct_subjects, count(DISTINCT lower(subject)) as distinct_lower_subjects
   FROM memories WHERE subject IS NOT NULL;
   ```

5. **Subject duplication and repository collapse**:
   ```sql
   SELECT subject, count(*) as cnt
   FROM memories WHERE subject IS NOT NULL
   GROUP BY subject HAVING count(*) > 1
   ORDER BY cnt DESC;

   SELECT id, session_id, kind, content, salience, created_at
   FROM memories WHERE subject = 'ptah-video-studio'
   ORDER BY created_at ASC;
   ```

6. **Content duplicate detection**:
   ```sql
   SELECT content, count(*) as cnt, count(DISTINCT subject) as distinct_subj
   FROM memories GROUP BY content HAVING count(*) > 1 ORDER BY cnt DESC;

   SELECT count(*) as cnt FROM memories WHERE content LIKE '%commitlint%';
   SELECT count(*) as cnt FROM memories WHERE content LIKE '%webview, vscode%';
   ```

7. **BM25 retrieval tests**:
   ```sql
   SELECT mc.rowid, mc.memory_id, mc.text, bm25(memory_chunks_fts) as score, m.subject, m.kind
   FROM memory_chunks_fts fts
   JOIN memory_chunks mc ON mc.rowid = fts.rowid
   JOIN memories m ON m.id = mc.memory_id
   WHERE memory_chunks_fts MATCH ?
   ORDER BY bm25(memory_chunks_fts) ASC
   LIMIT 5;
   ```

8. **Ground truth verification for judge threshold**:
   ```sql
   SELECT id, subject, kind, content
   FROM memories
   WHERE content LIKE '%judge%' AND content LIKE '%threshold%';
   ```

## Post-fix measurement — TASK_2026_473 Track A, 2026-09-19

The two code fixes this report recommended are implemented. Both measurements below were taken
read-only against the same live database, `%USERPROFILE%\.ptah\state\ptah.sqlite`, with the same
BM25 SQL and the same relevance judgement rules used above. Detail lives in
`.ptah/specs/TASK_2026_473_c9f4/`: `track-a-retrieval-measurement.md`,
`track-a-retrieval-review.md`, `track-a-merge-measurement.md` and `track-a-merge-fairness.md`.

### Retrieval, re-judged

`fts-query.util.ts` now drops common English stopwords, joins the remaining content terms with
`AND`, and treats the apostrophe as a token separator. `buildFtsQueryPlan` returns the `OR` form
beside the `AND` form, and `executeFtsQueryPlan` tops up an under-filled page with de-duplicated
`OR` rows. Precise rows stay at the head of the page. All three BM25 call sites use it.

| Query | FTS5 expression that produced the page | Before | After |
| --- | --- | ---: | ---: |
| what did we decide about the judge threshold | `"decide" OR "judge" OR "threshold"*` (top-up; `AND` returned 0) | 0 / 5 | 4 / 5 |
| how do we name DI tokens | `"name" AND "di" AND "tokens"*` | 0.5 / 5 | 4 / 5 |
| why did the release branch drift | `"release" AND "branch" AND "drift"*` | 3 / 5 | 5 / 5 |
| what is the user's preference for commit messages | `"user" AND "preference" AND "commit" AND "messages"*` | 1 / 5 | 3 / 5 |
| **Total** | | **4.5 / 20** | **16 / 20** |

Every query reaches the acceptance bar of at least 3 relevant results of 5. The corpus was not
cleaned before this measurement. It is the same 36,252-row database this report judged.

Query 4 needed the apostrophe rule as well as the stopword rule. `"user's"` as one token matched a
single chunk, and one row is not zero rows, so the widening never fired. Split into `user`, the
same query returns five precise rows.

### Merge candidate supply

`memory-curator.service.ts` no longer reads the 200 highest-ranked rows and filters them by exact,
case-sensitive subject equality. It calls `MemoryStore.findMergeCandidates`, one window-function
query over the whole workspace that matches on `LOWER(subject)` and gives each subject its own
quota of 5 through `ROW_NUMBER() OVER (PARTITION BY LOWER(subject) ...)`, capped at 50 rows.

| Population | Old candidates | New candidates |
| --- | ---: | ---: |
| 10 largest subjects (958 rows) | 4 | 50 |
| Random sample of 20 subjects older than 14 days (23 rows) | 0 | 23 |

Seven of the ten largest subjects had ZERO possible merge target under the old path and have at
least one now. This measures candidate SUPPLY only. It does not measure how often the curator
chooses to merge, which would require running the curator.

An intermediate version of the query applied the per-subject cap in TypeScript over one shared
200-row scan. Measured on this database, nine busy subjects took 198 of the 200 positions and
`ptah-tui` received 2 candidates instead of 5, although it holds 46 matching rows. The cap is now
part of the query, and every one of the ten subjects receives its full 5.

Cost, measured over 30 warm iterations in one process against the 35,255-row workspace: the new
query has a median of 89 ms and returns 50 rows, the old `list({ limit: 200 })` query a median of
77 ms for its 200 rows. The new path therefore costs about 12 ms more than the path it replaces.
Neither can use an index for its work: `LOWER(subject)` has no index, and the ranking expression is
computed per row, so both plans search `idx_memories_workspace` and then build a temporary B-tree.
The first call in a cold process took 6.9 s, which is the operating system reading a large database
file into its page cache; that figure was measured for the new query only.

A functional index on `(workspace_root, LOWER(subject))` would remove the scan. It needs a
migration, so it is not part of this task.

### What these fixes do NOT repair

- **Subject fragmentation.** The new merge query matches case-folded EQUALITY. A draft with the
  subject `commitlint-scope-enum` reaches the 50 rows under that spelling and cannot reach the
  other 80 commitlint subjects. The family still holds 81 distinct subjects over 284 rows.
- **Corpus sediment.** No row was purged. The roughly 55 percent of ephemeral rows this report
  measured is still present.
- **Salience.** The stored value is unchanged, and the ranking expression still behaves largely as
  a recency filter.
