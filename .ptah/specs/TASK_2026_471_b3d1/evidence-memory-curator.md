# Evidence map — memory-curator decision points

TASK_2026_471_b3d1. Research only; no code changed.

Scope read: `libs/backend/memory-curator` (source), `libs/backend/memory-contracts`
(port), the retrieval/similarity code in `libs/backend/persistence-sqlite`, plus the
one prompt-and-parse implementation that the curator port resolves to
(`libs/backend/agent-sdk/src/lib/curator-llm-adapter`, which is where the port is
implemented — `libs/backend/memory-curator/CLAUDE.md` "Does NOT belong: LLM calls").

Each row below is a point where the system makes a *judgment* — something that could
in principle be a typed decision primitive rather than the mechanism it uses today.
Every claim carries `file:line`.

---

## 1. Decision points that are today prompt-and-parse (free-text LLM)

These are the direct candidates for a System One / Jev-style typed judgment.

### 1.1 Extraction — "is anything in this transcript worth remembering?"

- Prompt: `libs/backend/memory-curator/src/lib/curator-llm/extract-prompt.ts:9-29`.
  One system prompt asks for a JSON object `{ memories: [...] }` and carries FIVE
  separate judgments in one call:
  - classification into `fact | preference | event | entity`
    (`extract-prompt.ts:14`, taxonomy mirrored at
    `libs/backend/memory-contracts/src/lib/curator-llm.port.ts:17`),
  - subject normalisation to "a normalized lowercase key"
    (`extract-prompt.ts:25`),
  - content rewriting to "one or two short sentences, self-contained"
    (`extract-prompt.ts:26`),
  - a **`salienceHint` in [0,1]** described literally as "your subjective
    importance" (`extract-prompt.ts:27`),
  - a durability filter — "Skip transient chit-chat, code that is already in the
    repo, and anything private to a single message" (`extract-prompt.ts:28-29`).
- The prompt's own comment states the design constraint that motivates the whole
  Jev question: "The schema is intentionally narrow so a small model (Haiku/8B-class)
  can comply reliably" (`extract-prompt.ts:5-6`).
- User prompt is a raw transcript splice:
  `buildExtractUserPrompt` at `extract-prompt.ts:31-33`.

### 1.2 Resolution — "is this new draft the same subject as an existing memory?"

- Prompt: `libs/backend/memory-curator/src/lib/curator-llm/resolve-prompt.ts:6-19`.
  The judgment is entity/identity matching: "decide for each candidate whether it
  refers to the same subject as one of the existing memories", answered as
  `mergeTargetId: string | null` (`resolve-prompt.ts:15`).
- The instruction is a lexical heuristic dressed as a judgment: "Prefer
  mergeTargetId when subjects match (case-insensitive). If unsure, set null."
  (`resolve-prompt.ts:19`). There is no confidence value anywhere in the contract —
  uncertainty collapses to `null`.
- Candidate set is built by JSON-stringifying both lists into the user prompt
  (`resolve-prompt.ts:21-31`), so cost scales with draft count × related count.

### 1.3 The parse layer — where the typed decision is *recovered* from text

- `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:533-546`
  (`parseDrafts`): extract the first balanced `{...}` (`extractJsonObject`,
  `:569`), `ExtractedResponseSchema.safeParse` (`:536`), then per-item
  `ExtractedDraftSchema.safeParse` with **silent `continue` on failure** (`:540-541`).
  A malformed item is dropped with no record.
- `parseResolved` (`:548-567`) has the same shape but degrades losslessly: an
  unparseable resolve answer falls back to every draft with `mergeTargetId: null`
  (`:553`, `:556`, `:564-566`). That fallback is contractual — the port documents
  that `resolve` deliberately has no stalled arm because its degradation is already
  lossless (`memory-contracts/src/lib/curator-llm.port.ts:133-141`).
- The failure taxonomy the parse layer must maintain by hand is large and was built
  incident-by-incident: `CuratorExtraction` is a three-arm union of
  `extracted | stalled | no-output`
  (`memory-contracts/src/lib/curator-llm.port.ts:94-111`), with a long comment
  explaining that "a stall consumed and permanently discarded the very episodes it
  was gated from curating. Observed 15 times in a few hundred log lines on one cold
  start" (`:62-65`) and that a tool-only run returning `[]` was byte-identical to an
  honest empty extraction (`:77-84`).
- Reading the *last* assistant message rather than a concatenation is itself a fix
  for a prompt-and-parse failure mode:
  `sdk-internal-query.curator-llm.ts:444-463` — at six turns the model's
  thinking-out-loud preceded its answer, so `extractJsonObject` parsed the wrong
  brace and the session's drafts were lost forever.

### 1.4 Cost envelope of these two calls

- Model: no pinned id; the curator rides the `haiku` tier alias of the resolved
  provider (`sdk-internal-query.curator-llm.ts:161`, `:274-285`).
- Turn budget: `CURATOR_MAX_TURNS = 6` (`sdk-internal-query.curator-llm.ts:204`);
  an exhausted budget arrives as a *result* (`error_max_turns`), not a throw
  (`:486-492`).
- Calls per pass: up to 8 extract windows + 1 resolve, narrowed to 1 + 1 on a
  manual PreCompact (`memory-curator/CLAUDE.md`, "the ceiling is 9 calls per pass";
  window planning at `memory-curator.service.ts:502-508`,
  `:549-562`).
- Measured cost of that fan-out (from `memory-curator/CLAUDE.md`, TASK_2026_374):
  a 372-event session spent eight windows at 24 s, 37 s and 27 s apiece — roughly
  four minutes of background model time on the same quota as the user's own turn.

---

## 2. Decision points that are today pure heuristics (no model)

These are the inverse candidates: places where a cheap typed judgment could *replace
a hand-tuned constant*, or where a model answer is currently faked by a regex.

### 2.1 "Did the user just say something worth remembering?" — a regex list

- `libs/backend/memory-curator/src/lib/triggers/memory-trigger-config.ts:64-72`:
  `DEFAULT_CUE_LIST` is seven regexes — `remember (this|that)`,
  `(important|critical)\s+(point|note|fact|detail)`, `from now on`,
  `going forward`, `keep in mind`, `note that`, `save to memory`.
- Compiled case-insensitively and cached by joined list
  (`triggers/memory-trigger.service.ts:631-656`), each pattern capped at
  `MAX_CUE_PATTERN_LENGTH = 200` (`:58`) with invalid patterns skipped and warned
  (`:646-655`). Gated by `minPromptLength: 20`
  (`memory-trigger-config.ts:99`).
- This is intent classification implemented as literal string matching: "note that"
  fires on a casual aside, and "I'd rather we always used tabs" fires on nothing.

### 2.2 Salience — a hint from the model, then a fixed algebraic ranking

- Stored salience is the model's `salienceHint` clamped to `[0,1]` plus an optional
  caller boost: `baseSalience` at
  `libs/backend/memory-curator/src/lib/salience-ranking.ts:13-16`, applied at
  `memory-curator.service.ts:665-668`.
- Everything after insert is a fixed formula, never a model:
  `rankSalience` at `salience-ranking.ts:18-28` = stored salience × a 7-day
  half-life decay (`SALIENCE_RANK_HALF_LIFE_MS = 604_800_000`, `:1`) + a saturating
  use term (`SALIENCE_USE_WEIGHT = 0.3`, `SALIENCE_USE_SATURATION = 3`, `:2-3`) +
  `SALIENCE_PIN_BONUS = 1` (`:4`).
- The same expression is duplicated as raw SQL text for the ORDER BY
  (`salience-ranking.ts:30-37`) — the constants are inlined as literals
  (`604800000.0`, `0.3`, `3.0`), so the TypeScript and SQL copies can drift.
- Invariant recorded in `memory-curator/CLAUDE.md`: "Stored salience is written
  only on insert; all recency and reuse effects belong to the query-time ranking
  expression."

### 2.3 Related-memory retrieval for the resolve call — exact string equality

- `memory-curator.service.ts:603-612`: the candidate set handed to the resolve
  prompt is built by collecting draft subjects into a `Set` (`:603-605`), listing
  at most **200** memories (`:609`), and filtering with
  `m.subject && subjects.has(m.subject)` (`:610`) — an exact, case-sensitive
  string match, despite the prompt itself asking for case-insensitive matching
  (`resolve-prompt.ts:19`).
- Consequence: the model can only merge into memories whose subject string already
  matches byte-for-byte. Neither embeddings nor FTS are used on this path, even
  though both exist in the same lib.

### 2.4 Merge application — trusts `mergeTargetId` with one existence check

- `memory-curator.service.ts:649-664`: if `mergeTargetId` is set and
  `store.getById` finds the row, the draft's content is appended as a chunk
  (`:654-660`) — no similarity check, no threshold, no confidence gate. A wrong
  merge target is silently accepted as long as the id exists.
- Dedup elsewhere is content-identity, not semantic: `MemoryWriterAdapter.upsert`
  keys on `sha256(subject + ' ' + content)` embedded in a seed prefix comment
  (`memory-writer.adapter.ts:29`, `:31-33`, `:54`, `:63`). Note this contradicts
  `memory-curator/CLAUDE.md`'s claim that "dedup happens via cosine similarity" —
  no cosine dedup exists in this lib (grep for `cosine` across
  `memory-curator/src` returns no implementation).

### 2.5 Corpus suggestion — clustering by fixed counts

- `knowledge-agents/corpus-suggestion.service.ts:56-66`: `MIN_CLUSTER_SIZE = 5`,
  `MAX_SUGGESTIONS = 6`, `TOP_CONCEPTS = 3`, `TYPE_MIN_CLUSTER_SIZE = 12`,
  `BOARD_LIMIT = 100`. Grouping is by concept string, and dedupe against existing
  corpora is "by concept and by name" (`:8-13`, `:135`, `:218`) — lexical again.

---

## 3. Retrieval and similarity (what already exists, so Jev would not duplicate it)

### 3.1 Hybrid search: BM25 + vector, fused by RRF

- `memory-search.service.ts:291-310`: BM25 over FTS5 (`bm25Search`, SQL at
  `:398-409`) and a sqlite-vec nearest-neighbour search (`vecSearchInner`,
  `:424-463`) are run for `limit * 4` candidates each, then fused.
- **The only adaptive weighting in the system is a token count**:
  `const bm25Weight = tokenCount < 4 ? 0.6 : 0.3;`
  (`memory-search.service.ts:307-309`). Short query → trust lexical; long query →
  trust vectors. That is a two-branch proxy for "what kind of query is this",
  which is exactly a classification judgment.
- RRF: `rrfFuse` at `:474-520`, `RRF_K_DEFAULT = 25` with the comment "lowered from
  60 to 25 for tighter ranking at memory scales of 100-5000 chunks" (`:159-160`);
  `searchRich` passes `k: 25` explicitly (`:310`).

### 3.2 A cross-encoder reranker already sits after fusion

- `memory-search.service.ts:311-340`: when `fused.length >= 5` and a worker client
  exists, the top `limit * 4` candidates are truncated to
  `MAX_CANDIDATE_CHARS = 512` (`:315`) and reranked by
  `workerClient.rerank(trimmed, rerankInput, limit)` (`:323`); failure falls back to
  RRF order with a warn (`:331-338`).
- This is the closest existing analogue to a Jev-style judgment: a small local model
  answering a bounded relevance question. Any proposal should account for it rather
  than re-invent it.

### 3.3 The embedding contract and its degrade path

- `libs/backend/persistence-sqlite/src/lib/embedder/embedder.interface.ts:13-33`:
  `IEmbedder` is `{ dim, modelId, embed(texts): Float32Array[], dispose, warmup? }`.
  Deliberately minimal (`:9-12`); `dim` MUST equal the `FLOAT[N]` of the vec0 table
  (`:14`).
- Vector search is a `MATCH` against `memory_chunks_vec` ordered by `distance ASC`
  (`memory-search.service.ts:432-437`); the returned `distance` is used only for
  *rank order* in RRF (`:506-517`), never as a threshold — nothing in the retrieval
  path ever compares a similarity value to a cutoff.
- Degrade: no embedder registered (VS Code / CLI hosts) → `bm25Only`
  (`memory-search.service.ts:293-306`), and vec failure warns and falls back
  (`:297-305`). Any Jev integration must survive the same host matrix —
  `memory-curator/CLAUDE.md`: "On VS Code / CLI no factory is registered → the
  embedder is unavailable and search falls back to BM25-only".

---

## 4. Constraints any replacement must respect

1. **The port, not the implementation, is the seam.** `ICuratorLLM`
   (`memory-contracts/src/lib/curator-llm.port.ts:126-148`) is the only contract
   `memory-curator` knows; a Jev-backed implementation would be a sibling of
   `SdkInternalQueryCuratorLlm`, registered in the host. `memory-curator` must not
   gain an LLM dependency (`memory-curator/CLAUDE.md`, Boundaries).
2. **`memory-contracts` is zero-dep** (`memory-contracts/CLAUDE.md`, Guidelines:
   "adding runtime deps here forces them on every consumer"). A typed-judgment SDK
   type may not appear in the port signature.
3. **The stall/no-output distinction must survive.** Callers key input retention on
   it (`curator-llm.port.ts:56-92`; consumption at
   `memory-curator.service.ts:564-594`). A provider that cannot distinguish
   "answered nothing" from "never answered" would re-open the defect that silently
   consumed sessions' observations.
4. **Network-class failure is reported, never parsed as text.**
   `sdk-internal-query.curator-llm.ts:495-502` and `:513-522` classify unreachable
   providers before any parse; the curator backs off on it
   (`memory-curator.service.ts:539-547`, `:563`).
5. **Every pass is abortable and queue-deferrable**, and a deferral must not consume
   input: `memory-curator.service.ts:521-526` (pre-work abort),
   `:564-572` (extract slot timeout), `:623-637` (resolve slot timeout).
6. **Cost is stated in LLM calls, not characters** (`memory-curator/CLAUDE.md`) —
   so any evaluation of a replacement should be measured in calls per pass and
   wall-clock per call, against the 24-37 s/window figure above.

---

## 5. Ranked candidate list for a typed-judgment primitive

| # | Decision | Today | Location |
|---|---|---|---|
| 1 | Is this draft the same subject as memory X? | free-text `mergeTargetId`, no confidence | `resolve-prompt.ts:15,19`; applied `memory-curator.service.ts:649-664` |
| 2 | How important is this, 0..1? | model's self-reported `salienceHint` | `extract-prompt.ts:27`; `salience-ranking.ts:13-16` |
| 3 | Did the user signal "remember this"? | 7 regexes | `memory-trigger-config.ts:64-72` |
| 4 | Is this durable knowledge or chit-chat? | one prompt clause | `extract-prompt.ts:28-29` |
| 5 | Which of fact/preference/event/entity? | prompt enum | `extract-prompt.ts:14`; `curator-llm.port.ts:17` |
| 6 | Lexical or semantic query? | `tokenCount < 4 ? 0.6 : 0.3` | `memory-search.service.ts:307-309` |
| 7 | Which candidates actually answer the query? | already a cross-encoder rerank | `memory-search.service.ts:311-340` |

Items 1-5 are prompt-and-parse or regex and are the real targets. Item 6 is a
two-line constant standing in for a classification. Item 7 is already solved locally
and is a *comparison baseline*, not a target.

---

## Read coverage

No file read was declined; nothing is recorded UNREAD. Files read in full:
`extract-prompt.ts`, `resolve-prompt.ts`, `curator-llm.port.ts`,
`salience-ranking.ts`, `embedder.interface.ts`, plus targeted ranges of
`memory-curator.service.ts` (500-680), `memory-search.service.ts` (270-360,
398-520), `memory-trigger-config.ts` (58-88) and
`sdk-internal-query.curator-llm.ts` (440-570). Remaining files were surveyed by
grep for the specific symbols cited above. The 13 task specs were not read —
out of the narrowed scope for this deliverable.
