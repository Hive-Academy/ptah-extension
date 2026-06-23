# TASK_2026_136 — Memory Curator Feature Elevation (claude-mem parity)

> **Status:** 📋 Planned
> **Owner:** orchestrator
> **Branch:** `feature/curator-worker-task-2026-136`
> **Created:** 2026-05-29

## Why

Ptah's memory pipeline currently:

- Extracts nothing (`extracted=0, merged=0, created=0` on every `curator-run`) — the
  trigger paths never read the real session JSONL or full tool I/O. Buffer contains
  only assistant turn summaries + `tool=Bash`-style failure strings.
- Has no taxonomy, no concept tags, no structured summary schema.
- Returns full `Memory` objects on every search — token-expensive.
- Has no "knowledge agent" concept: no way to build a focused corpus from history
  and ask grounded questions against it.
- Has no context injection at session start.

Reference: [claude-mem](https://docs.claude-mem.ai/architecture/overview) ships
all of the above. This task lifts the strong ideas from their model and lands
them on Ptah's existing infrastructure (SQLite + FTS5 + sqlite-vec hybrid search,
push-event renderer bridges, agent-sdk hook registries, Claude Agent SDK).

## Architectural anchor

We adopt claude-mem's **capture/process decoupling via a SQLite queue**, but stay
in-process (Electron main + an optional `worker_threads` worker) — no separate
Bun process, no HTTP port allocation. Their out-of-process choice was forced by
CLI ephemerality; our main process is long-running and `MessagePort` beats HTTP
for IPC. Performance isolation is a side-benefit; the primary goal of this task
is **feature parity for memory curation, search, and knowledge retrieval.**

---

## Five feature groups, sequenced by dependency

### Group A — Capture & schema (foundation; unblocks everything downstream)

**A1. `observation_queue` table** — `persistence-sqlite` migration `0015`:

```sql
CREATE TABLE observation_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT    NOT NULL,
  workspace_root  TEXT,
  prompt_number   INTEGER,
  kind            TEXT    NOT NULL,           -- 'tool-use' | 'tool-failure' | 'assistant-turn' | 'user-prompt' | 'file-read' | 'commit'
  tool_name       TEXT,
  tool_input_json TEXT,                       -- raw input JSON, nullable
  tool_response_text TEXT,                    -- truncated to 16 kB, nullable
  assistant_message TEXT,                     -- carried by Stop hook
  user_prompt     TEXT,                       -- carried by UserPromptSubmit
  file_path       TEXT,                       -- for kind='file-read'
  captured_at     INTEGER NOT NULL,           -- ms epoch
  processed_at    INTEGER                     -- NULL until drained
);
CREATE INDEX idx_obs_queue_session ON observation_queue(session_id, processed_at, captured_at);
CREATE INDEX idx_obs_queue_drain ON observation_queue(processed_at, captured_at) WHERE processed_at IS NULL;
```

**A2. Hook handlers write to the queue.** Wire into existing
`libs/backend/agent-sdk/.../hooks/` registries (the pattern from TASK_2026_127):

- `UserPromptSubmitHookHandler` — INSERT `kind='user-prompt'` (raw prompt text).
- `PreToolUseHookHandler` (NEW; matcher `Read`) — INSERT `kind='file-read'` with `tool_input_json` carrying the file path. Replicates claude-mem's "file context capture."
- `PostToolUseHookHandler` (extend existing) — INSERT `kind='tool-use'` with `tool_name`, `tool_input_json`, `tool_response_text` (truncated).
- `PostToolUseFailureHookHandler` (extend existing) — INSERT `kind='tool-failure'`.
- `StopHookHandler` — INSERT `kind='assistant-turn'` with `assistant_message`.

`EpisodeTracker` stays as the *signal* side — drives episode boundaries (`commits`, `hasCriticalLearning`) and `salienceBoost`. It no longer feeds the curator transcript.

**A3. Real transcript in the trigger path.** `MemoryTriggerService.invokeCurate`
(`libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:463`) now:

1. Calls `transcriptReader.read(sessionId, workspaceRoot)` — same as the PreCompact path proved at `memory-curator.service.ts:70`.
2. Drains unprocessed `observation_queue` rows for the session via a new `ObservationQueueStore`.
3. Composes a combined transcript: JSONL excerpt + structured observation log + episode summary line.
4. Calls `curator.curate({ sessionId, workspaceRoot, transcript: combined })`.
5. Marks drained rows `processed_at = now` on success.

`TRANSCRIPT_PLACEHOLDER` becomes an error-event signal, not a default. New event kind `curator-skipped-no-data` pushed into the ring buffer when literally nothing is available.

**A4. Structured 5-field summary schema.** Extend the curator LLM prompt + `ExtractedMemoryDraft` (`libs/backend/memory-contracts`) to surface the claude-mem schema:

```ts
interface ExtractedMemoryDraft {
  subject: string;
  content: string;        // existing free-form fallback
  request?: string;       // what the user asked
  investigated?: string;  // what was examined
  learned?: string;       // key findings / facts
  completed?: string;     // delivered work
  nextSteps?: string;     // follow-up
  type: MemoryType;       // see A5
  concepts: string[];     // see A6
  files: string[];        // files touched/read
  salienceHint: number;
}
```

New columns on `memories`: `request`, `investigated`, `learned`, `completed`, `next_steps`, `type`, `concepts_json` (JSON array of strings), `files_json` (JSON array). Migration `0016`. Existing rows backfill with `type='discovery'`, `concepts_json='[]'`, `files_json='[]'`.

**A5. Type taxonomy.** New `MemoryType` enum mirrors claude-mem:
`'bugfix' | 'feature' | 'decision' | 'discovery' | 'refactor' | 'change'`.
Stored in the new `type` column. Curator LLM prompt asks for classification per draft. Fallback: `'discovery'`.

**A6. Concept tagging.** Free-form `concepts: string[]` per memory. Curator LLM extracts up to 5 concept tags per draft (e.g. `["sqlite-vec", "windows-asar", "migration-coupling"]`). FTS5-indexed via new `memory_concepts_fts` external-content table so concept filters are fast (cf. memory `[[project_fts5_external_content_column_mismatch]]` for the schema-mismatch gotcha to avoid).

---

### Group B — Progressive disclosure search

Claude-mem's "3-layer progressive disclosure" cuts retrieval token cost ~10x. Mirror it:

**B1. New RPC namespace `mem:`** (dual-registered per `[[project_rpc_registration_pattern]]`):

- `mem:searchIndex` → compact rows (id, subject, type, concepts[], files[], capturedAt, score) — ~50–100 tokens each, FTS5 + RRF as today but project + type + concept + dateRange + file filters layered in.
- `mem:timeline` → given an anchor memory id, return N before + N after by `captured_at` (same compact shape).
- `mem:getObservations` → given ids[], return full memories (content + 5-field summary + raw observation rows joined from `observation_queue`).

**B2. Extend `MemorySearchService`** to support the new filters (project, type, concepts, files, dateRange) via `(SELECT * FROM memories WHERE ...)` overlaid on FTS5 + vector recall. The hybrid path (FTS5 + sqlite-vec RRF) is already proven — we add WHERE clauses, not a new pipeline.

**B3. Update `memory:list`/`memory:search` callers in `MemoryRpcHandlers`** to use `mem:searchIndex` when only ids are needed (Thoth Memory tab list view). Existing thick API stays for backwards-compatibility with chat-input "save to memory" recall flows.

---

### Group C — Knowledge agents (headline new feature)

**C1. New `corpora` + `corpus_memories` tables** — migration `0017`:

```sql
CREATE TABLE corpora (
  id              TEXT    PRIMARY KEY,        -- e.g. 'corp-{nanoid}'
  name            TEXT    NOT NULL UNIQUE,    -- user-facing handle
  workspace_root  TEXT,
  query_json      TEXT    NOT NULL,           -- BuildCorpusParams snapshot for rebuild
  built_at        INTEGER NOT NULL,
  rebuilt_at      INTEGER,
  primed_session_ids_json TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE corpus_memories (
  corpus_id  TEXT NOT NULL REFERENCES corpora(id) ON DELETE CASCADE,
  memory_id  TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  ord        INTEGER NOT NULL,
  PRIMARY KEY (corpus_id, memory_id)
);
CREATE INDEX idx_corpus_mem_corpus ON corpus_memories(corpus_id, ord);
```

**C2. `KnowledgeAgentService`** (new lib *or* slice inside `memory-curator`, decided by the architect agent during planning):

- `buildCorpus(params: BuildCorpusParams): CorpusRef` — runs `mem:searchIndex` with the supplied filters, snapshots ids into `corpus_memories`, persists `query_json` for later rebuild.
- `primeCorpus(name: string): { sessionId: string }` — opens a new Claude Agent SDK session via existing `SessionLifecycleManager`, injects the corpus content as a system-prompt prefix (full 5-field summaries concatenated; budgets to a context-window limit, default 50k tokens). Returns the SDK session id so the renderer can route Q&A through the standard chat surface.
- `queryCorpus(name: string, question: string): { sessionId: string, answer: string }` — reuses the primed session if alive; otherwise auto-primes. Sends the question, returns the assistant reply.
- `repriromptCorpus(name: string): { sessionId: string }` — kills any existing primed session and primes fresh (claude-mem semantics: "fresh chat with the same brain").
- `rebuildCorpus(name: string): { added: number, removed: number }` — re-runs the persisted `query_json` filters, diffs against current `corpus_memories`, applies adds/removes. Triggered automatically by curator after extraction if any corpus was built within the workspace.

**C3. RPC surface** under new `corpus:` prefix:

- `corpus:list`, `corpus:get`, `corpus:build`, `corpus:prime`, `corpus:query`, `corpus:reprime`, `corpus:rebuild`, `corpus:delete`.

**C4. Settings.** `PtahFileSettingsManager` gains:
- `memory.corpus.primingTokenBudget` (default 50000)
- `memory.corpus.autoRebuildOnExtraction` (default true)

**C5. Acceptance: knowledge-agent worked example.**
```
> corpus:build { name: 'sqlite-vec', type: ['bugfix','decision'], concepts: ['sqlite-vec'] }
{ id: 'corp-...', count: 14 }
> corpus:prime { name: 'sqlite-vec' }
{ sessionId: 'sess-...' }
> corpus:query { name: 'sqlite-vec', question: 'why does Windows asar unpack the wrong directory?' }
{ answer: '...the binary unpacks as `sqlite-vec-windows-x86_64` instead of `-x64`...' }
```

---

### Group D — SessionStart context injection

**D1. New `SessionStartHookHandler`** in `libs/backend/agent-sdk/.../hooks/`.

On SessionStart for a workspace:
1. Pull last N (default 10) `memories` ordered by `salience DESC, captured_at DESC` with `workspace_root = current`.
2. Pull last M (default 5) corpora built in this workspace.
3. Compose a "context injection" block:
   ```
   ## Recent context from prior sessions in this workspace
   - [bugfix] sqlite-vec asar unpack: ...
   - [decision] DI architecture invariants: ...
   ## Available knowledge corpora
   - sqlite-vec (14 memories) — query via /corpus:query
   ```
4. Prepend to the first user-visible system prompt slot via `IPromptInjector` (new platform-core port, or extend existing `IUserInteraction` if it carries one).

**D2. Settings.** `memory.sessionStart.injectionEnabled` (default true),
`memory.sessionStart.observationCount` (default 10),
`memory.sessionStart.corpusCount` (default 5).

**D3. Privacy.** Injection block is markdown-only, no raw `tool_response_text` ever crosses the boundary into the new session (only the structured 5-field summary fields). Workspace-scoped — never cross workspaces.

---

### Group E — Skill + UI elevation

**E1. `mem-search` skill** bundled with `@hive-academy/ptah-cli`:

- New skill at `apps/ptah-cli/src/skills/mem-search/` (claude-mem ships theirs as a plugin skill — we ship as a CLI skill, surfaced via `/mem-search` in the chat input slash menu through the existing `SkillSynthesisService` discovery path).
- Skill prompt teaches the agent the 3-layer flow (searchIndex → timeline → getObservations).
- Token budget annotated in frontmatter; loaded on-demand per the existing skill-loader convention.

**E2. Thoth Memory tab — Viewer mode.** Extend
`libs/frontend/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts`:

- **Timeline view** — chronological list, infinite scroll, dedup by id, filterable by type / concept / file / dateRange / workspace via the new corpus-filter signal store.
- **Corpus panel** (new component `corpus-list.component.ts`) — list / build / prime / query corpora; "Prime in new chat" button opens a new tab routed to the SDK session id returned by `corpus:prime`.
- Real-time push event `mem:observationCaptured` from the renderer bridge flips an "X new since last view" badge. Reuses the push-event pattern from TASK_2026_132's vec/embedder bridges.

**E3. Optional Stage 0 worker (if time permits).**
Pure isolation, not a feature: introduce `CuratorWorkerClient` mirroring
`EmbedderWorkerClient` to move `llm.extract` + `store.upsert` off the main loop.
**Explicitly de-prioritised** in this task per user direction — feature parity comes first. If it lands, it lands at the end as polish.

---

## Cross-cutting infrastructure

| Concern | Plan |
|---|---|
| FTS5 schema mismatch risk | All new external-content FTS tables follow the explicit `INSERT FROM SELECT` shadow pattern from `[[project_fts5_external_content_column_mismatch]]`. No `'rebuild'` commands. |
| sqlite-vec rowid affinity | Any new vec table uses `CAST(? AS INTEGER)` per `[[project_sqlite_vec_rowid_affinity]]`. |
| RPC dual-registration | Every new prefix (`mem:`, `corpus:`) is added to BOTH `ALLOWED_METHOD_PREFIXES` (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:46`) AND the `RpcMethodRegistry` in `libs/shared/src/lib/types/rpc.types.ts`. Compile-time `RpcMethodName` union asserted in `register-all.ts`. |
| VS Code / CLI parity | All persistence + extraction stays under existing `[[project_thoth_electron_only]]` rule — Memory tab, corpus UI, hooks remain Electron-only. CLI gets corpus RPC but no UI. VS Code unchanged. |
| Migrations 0015/0016/0017 | Land in the order: 0015 (observation_queue) → 0016 (memories schema columns + backfill) → 0017 (corpora). Each is independent and reversible. |
| Backwards compatibility | Existing `memory:list`/`memory:search`/`memory:get` keep their current shapes; new fields are additive. Renderer code reading old shape continues to work. |

---

## Acceptance criteria

1. After ≥3 substantive turns, an idle trigger produces `extracted ≥ 1` with at least one memory carrying a populated `request`/`investigated`/`learned`/`completed` field and a `type` other than the fallback.
2. `mem:searchIndex` returns compact rows (no `content` field) and is reachable from the Thoth Timeline view.
3. `corpus:build` → `corpus:prime` → `corpus:query` round-trip produces a grounded answer drawn from the corpus, demoed on a real curated workspace.
4. Opening a new chat in a workspace with ≥1 prior memory shows the SessionStart context-injection block at the top of the first turn.
5. `PreToolUse Read` calls produce `kind='file-read'` rows in `observation_queue`.
6. VS Code extension host build (`apps/ptah-extension-vscode:build`) stays green — none of the new code is reachable from the VS Code adapter set.
7. Pre-commit electron-main build gate stays green across the full sequence of commits.
8. All new external-content FTS5 tables survive a curator pass (no "no such column" mismatches per the known gotcha).

## Explicitly out of scope

- Performance optimisation as a primary goal (user redirected; isolation worker is opt-in polish only).
- Skill synthesis pipeline (separate task; would benefit from the same observation_queue once it lands).
- Vector store provider swap (Chroma) — we keep sqlite-vec; it's already proven once it loads.
- Multi-workspace corpus federation — corpora are workspace-scoped for v1.
- License gating — all new methods are free tier; the architect agent should confirm against `LICENSE_FEATURES` during planning.

## Files of interest

- `libs/backend/memory-curator/src/lib/memory-curator.service.ts` — current `doCurate` + PreCompact path
- `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:463` — trigger callbacks; A3 lands here
- `libs/backend/memory-curator/src/lib/triggers/episode-tracker.ts:143` — `buildTranscript` demoted to signal-only
- `libs/backend/memory-contracts/src/lib/transcript-reader.interface.ts` — `ITranscriptReader` already provides the JSONL read
- `libs/backend/persistence-sqlite/src/lib/migrations/` — add `0015`/`0016`/`0017`
- `libs/backend/vscode-core/src/messaging/rpc-handler.ts:46` — add `'mem:'` + `'corpus:'` prefixes
- `libs/shared/src/lib/types/rpc.types.ts` — declare all new methods
- `libs/frontend/memory-curator-ui/src/lib/components/` — timeline + corpus components
- `apps/ptah-electron/src/activation/wire-runtime.ts` — wire new push-event bridges
- `apps/ptah-cli/src/skills/mem-search/` — new CLI skill
