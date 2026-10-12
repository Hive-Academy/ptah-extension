# Epic: Memory reliability (P1)

Created 2026-10-12 by the memory and skills backlog triage. Evidence: code audit of every child against
`main` on 2026-10-12 (file:line references below), cross-reviewed by a codex lane.

Goal: the memory system never loses observations, never crashes the host, and never blocks the Electron
main thread.

## Children, in suggested order

| Pri | Task | Problem today (evidence) | Size |
|---|---|---|---|
| P1 | TASK_2026_391 | Malformed extraction JSON is treated as an honest empty result and the session observations are consumed (`sdk-internal-query.curator-llm.ts:617-621`, `memory-trigger.service.ts:1023`). | S |
| P1 | TASK_2026_622 | `SqliteConnectionService.close()` fails fast with 0xC0000409 in `wal_checkpoint(TRUNCATE)` after sqlite-vec writes (`sqlite-connection.service.ts:522-539`). Check database integrity risk. | L |
| P1 | TASK_2026_458 | The CLI crashes when memory registration fails early; the RPC handlers resolve memory tokens outside the try/catch (`register-thoth-libraries.ts:132`). | S |
| P1 | TASK_2026_579 | One curator provider only; a rate-limited or unreachable provider stalls curation (`sdk-internal-query.curator-llm.ts:248`, `:365`). | L |
| P1 | TASK_2026_311 | A stalled pass keeps its hourly rate-limit token; refund fires only for pre-dispatch network backoff (`memory-trigger.service.ts:904` vs `:981`). Decide with 579: a successful fallback consumes one slot. | S |
| P1 | TASK_2026_567 | The extract prompt over-suppresses durable content (`extract-prompt.ts:54-68`). Measure with the TASK_2026_620 suites. | M |
| P1 | TASK_2026_481 | Memory and vector search run synchronously on the Electron main thread (`memory-search.service.ts:323-331`); 300-1,672 ms statements and a 7,877 ms hang were measured. | XL |
| P2 | TASK_2026_447 | Contentless `memory_concepts_fts` drift leaves concept rows behind on delete (`0017_memory_schema_v2.ts:36,43`, `memory.store.ts:266,987`). | M |
| P3 | TASK_2026_455 | Profile retention archive/evict/delete batches on the Electron better-sqlite3 binding (`memory-retention-config.ts:70-83`). Feeds 481. | S |

Links: 391 and 567 are two different loss paths in one pipeline (link, do not merge). 579 and 311 share the
quota rule. 481 uses the 455 numbers and the 622 close-path findings.
