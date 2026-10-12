# Record/replay cassettes for an LLM-backed benchmark

> **Status:** neither Ptah benchmark (the MCP tool benchmark, TASK_2026_619, and the memory/skills benchmark, TASK_2026_620) has produced a valid scored result yet. This post describes mechanism and design decisions only. It makes no accuracy or quality claim about Ptah or any model.

The memory/skills benchmark exercises code paths that call a language model: the curator that extracts memory drafts from a transcript, and the skill lanes. A benchmark that calls a live model on every run is slow, costs money, and is not repeatable. So the benchmark records model calls once into a *cassette* and replays them in CI. This post covers how the cassette is shaped, and one decision we have not made yet.

## One JSONL line per call

A cassette is a single JSONL file. Each line is one entry with the fields `{key, method, model, promptSha, response, usage?}`. <!-- source: tools/mcp-bench/src/memory-skills/doubles/cassette-store.ts:5-8 -->

```json
{"key":"<sha256>","method":"extract","model":"<model id>","promptSha":"<sha256 of transcript>","response":{}}
```

The key is `sha256(method + canonical JSON of the inputs)`. <!-- source: tools/mcp-bench/src/memory-skills/doubles/cassette-store.ts:138-141 --> The canonical form sorts object keys recursively, so the key does not depend on property order. The code comment states the intent: the key stays stable between win32 (where recording happens) and linux (CI replay). <!-- source: tools/mcp-bench/src/memory-skills/doubles/cassette-store.ts:16-18 --> `signal` and `options` are excluded before hashing, because an `AbortSignal` is not serialisable and `options` carries host call context, not model inputs. <!-- source: tools/mcp-bench/src/memory-skills/doubles/cassette-store.ts:111-116 -->

For extraction, the entry's `promptSha` is the sha256 of the transcript. <!-- source: tools/mcp-bench/src/memory-skills/doubles/recorded-curator-llm.ts:178-184 -->

## Replay never falls through to a live call

A replay lookup with no matching entry throws `CassetteMissError`. The suite maps that to a case-level `na: cassette-miss`, and the design rule (R-M5) is that a suite with any miss cannot pass. <!-- source: tools/mcp-bench/src/memory-skills/doubles/cassette-store.ts:10-14 -->

The double enforces this structurally rather than by convention. In replay mode the constructor refuses an `inner` (live) adapter, with the message that a miss must surface as `CassetteMissError`, never as a live model call. Record mode, in turn, requires an `inner`. <!-- source: tools/mcp-bench/src/memory-skills/doubles/recorded-curator-llm.ts:106-115 --> A cassette holding two different responses for one key is treated as corrupt and fails to load with `CassetteDuplicateError`, so replay stays deterministic. <!-- source: tools/mcp-bench/src/memory-skills/doubles/cassette-store.ts:69-84 -->

## Do not record a transient failure forever

Record mode refuses to persist a stalled extraction. Replaying a provider hiccup indefinitely would turn a transient failure into a permanent test fixture, so the double throws `CassetteRecordRefusalError` unless `recordFailures: true` is set. <!-- source: tools/mcp-bench/src/memory-skills/doubles/recorded-curator-llm.ts:171-177 --> <!-- source: tools/mcp-bench/src/memory-skills/doubles/cassette-store.ts:86-90 -->

## Re-recording replaces, atomically

`CassetteStore.record` writes one entry and replaces any existing entry with the same key: "a re-record must never leave a stale entry that replay serves first". It rewrites the file through a temp file and a rename, so a crash cannot leave a half-written cassette. <!-- source: tools/mcp-bench/src/memory-skills/doubles/cassette-store.ts:165-190 -->

The cost of that simplicity is visible in `extract`: record mode always calls the live model and then records. It does not check whether the key is already in the cassette. <!-- source: tools/mcp-bench/src/memory-skills/doubles/recorded-curator-llm.ts:168-185 --> So **record mode does not resume**. A second run re-records every call, even those already on disk. <!-- source: .ptah/specs/TASK_2026_620_a13e/follow-up-recordings.md:51-54 -->

## Provenance lives in a sidecar

A cassette entry records a `model` string, but the benchmark also wants evidence of which provider and model actually served each call. That evidence is a sidecar, `<cassette>.provenance.json`, written only after every dispatch matches the entries. The design note explains why a sidecar: the cassette doubles write JSONL straight to the plan path and have no staging directory. <!-- source: tools/mcp-bench/src/memory-skills/recorder/provider-provenance.ts:1-12 -->

The sidecar's schema id is `620.cassette-provenance.v1`. Per cassette key it lists the resolved provider id, resolved model id and lane id. <!-- source: tools/mcp-bench/src/memory-skills/recorder/provider-provenance.ts:262-284 --> The gate checks dispatch counts against entry counts: at least one dispatch per entry, and at most one per entry for the curator (a skill lane may record one structured-output retry, so up to two). A mismatch deletes the unaccepted cassette and the sidecar. <!-- source: tools/mcp-bench/src/memory-skills/recorder/provider-provenance.ts:236-250 --> <!-- source: tools/mcp-bench/src/memory-skills/recorder/provider-provenance.ts:9-12 -->

That gate has a known weakness, recorded in the follow-up brief: it counts dispatches in aggregate, so a retry dispatch can cover an entry that made no call. The planned fix correlates per call, by snapshotting the collector's dispatch count around each inner call and rejecting an entry with zero dispatches. <!-- source: .ptah/specs/TASK_2026_620_a13e/follow-up-recordings.md:22-27 -->

## The open decision: a record-missing mode

Because record mode does not resume, a long recording that ends early wastes its finished entries (post 3 covers a real case). The obvious remedy is a `record-missing` mode: serve keys already in the cassette and call the model only for missing keys. The follow-up notes are explicit that this "changes cassette provenance (entries from two runs), so it needs a design decision first". <!-- source: .ptah/specs/TASK_2026_620_a13e/follow-up-recordings.md:54-56 -->

The tension is concrete. The sidecar attests one run's dispatches against one cassette's entries. A merged cassette would have entries from two runs, and the sidecar and its count rule would have to say so. The mode does not exist in the code we read; it is a proposal.

## Takeaways

- Key on a canonical hash of the inputs, and exclude call context that is not a model input.
- Make "replay never goes live" a constructor-level refusal, not a convention.
- Refuse to record failures by default.
- Write "replace on re-record" down, and also write down what that implies: no resume.
- Keep provenance outside the data file, and decide deliberately before any feature lets one cassette span two runs.
