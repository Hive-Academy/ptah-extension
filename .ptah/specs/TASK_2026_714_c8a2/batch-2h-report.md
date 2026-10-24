# Batch 2h report

Implemented the isolated event translator. Production routing remains disabled; no barrel, registration, validator, runtime types, or parallel-batch files were changed.

## Files

- `libs/backend/codex-runtime/src/lib/codex-event-translator.ts` — pure, synchronous translator; constructor accepts context ID and process generation; `translate({ method, params })` returns ordered runtime events; `dispose()` releases retained turn state.
- `libs/backend/codex-runtime/src/lib/codex-event-translator.spec.ts` — 18 passing tests, including recorded-order replay from spike runs 6h/6i/6j.
- `.ptah/specs/TASK_2026_714_c8a2/batch-2h-report.md` — this report.

All paths are relative to `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat`.

## Mapping

Line references below are in `libs/backend/codex-runtime/src/lib/codex-event-translator.ts` after formatting.

| Codex method / item | Runtime event / behavior | File:line |
| --- | --- | --- |
| `item/agentMessage/delta` | `textDelta`, preserving item ID and delta | codex-event-translator.ts:64 |
| `item/completed` / `agentMessage` | `textFinal`, including final-only text | codex-event-translator.ts:187 |
| `item/completed` / `reasoning`, `plan` | final `reasoning` (summary preferred, otherwise content) | codex-event-translator.ts:191,205 |
| `item/started`, `item/completed` / `commandExecution` | `toolStarted`, `toolCompleted`; item ID is tool ID; declined maps to cancelled | codex-event-translator.ts:220 |
| Same / `mcpToolCall` | tool lifecycle; server/tool name; failure output is sanitized | codex-event-translator.ts:241 |
| Same / `fileChange` | tool lifecycle; successful completion also emits ordered `file` events | codex-event-translator.ts:262 |
| Same / `dynamicToolCall` | tool lifecycle; explicit unsuccessful result maps to failed | codex-event-translator.ts:292 |
| Same / `collabAgentToolCall` | tool lifecycle carrying receiver thread IDs; no invented subagent event variant | codex-event-translator.ts:314 |
| Same / `webSearch` | tool lifecycle | codex-event-translator.ts:332 |
| Same / `contextCompaction` | `compaction` started/completed | codex-event-translator.ts:216 |
| `thread/tokenUsage/updated` | `usage` from reported `last`, not cumulative `total`; no cost estimate | codex-event-translator.ts:92 |
| `error` | sanitized `error`, retryability from `willRetry`; never terminates turn | codex-event-translator.ts:115 |
| `turn/completed` | one `terminal` per thread/turn, with reported usage only if observed; duplicate/late events ignored | codex-event-translator.ts:125 |
| Unknown/malformed item or item unrepresentable by current union | safe `unsupportedItem` diagnostic; no raw type/payload retained | codex-event-translator.ts:75,183 |
| `initialized`, `turn/started`, `serverRequest/resolved`, userMessage items | no projected content; approval decisions belong to Batch 2g | codex-event-translator.ts:58,185 |

Sequence increases for every emitted event within the instance. Thread and turn IDs are combined without delimiter collisions. Terminal tombstones remain for the context lifetime and are released on dispose; usage entries are released at terminal.

## Specs

`codex-event-translator.spec.ts` covers:

- Ordered deltas/final-only text, event identity and monotonic sequence.
- Command start before approval and declined completion; resolution is not execution.
- MCP stable IDs and successful output.
- Reported usage, explicit zero, absent cost and no usage leakage into another turn.
- Completed/failed/interrupted terminal deduplication and suppression of late events (three cases).
- Cross-thread identity isolation and disposal.
- Sanitized retry, terminal, command and MCP errors.
- Unknown/unrepresentable item diagnostics without leaking paths or credentials.
- Malformed input without fabricated usage or terminal status.
- Reasoning, plan, compaction and successful/declined file changes.
- Dynamic tools, collaborative agent tools and web search (three cases).
- Recorded spike-run-6h/6i/6j event-order replay (three cases).

The transcripts contain sanitized method/item summaries, not full payloads. Tests read the real recordings and explicitly label their replacement IDs/text/arguments/counts as synthetic. They establish observed ordering, not new native capability evidence.

## Verification

Commands ran in the assigned worktree. PowerShell `Select-Object -Last` and `Select-String` implement the requested tail/grep filters; native exit codes were printed explicitly.

1. `npx jest -c libs/backend/codex-runtime/jest.config.ts libs/backend/codex-runtime/src/lib/codex-event-translator.spec.ts --coverage=false --maxWorkers=2`
   - Exit 0; **1 suite passed; 18 tests passed; 0 snapshots; 6.751 s**.
   - Node warned about loading the TypeScript Jest config as an ES module; the suite still passed.
2. `npx nx run-many -t typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static`
   - Initial exit 1: `49:7 error Expected a 'break' statement before 'case' no-fallthrough`; 1 error, 4 warnings.
   - Fixed the translator's comment-separated grouped cases with an explicit return; no behavior changed.
   - Rerun exit 0: `NX Successfully ran targets typecheck, lint for project @ptah-extension/codex-runtime`; **0 errors, 4 warnings**. Filtered output includes `1737:7 warning There is no cause attached to the symptom error being thrown preserve-caught-error`. No unrelated files were edited.
3. `npx prettier --write libs/backend/codex-runtime/src/lib/codex-event-translator.ts libs/backend/codex-runtime/src/lib/codex-event-translator.spec.ts`
   - Exit 0 after final Nx run.
4. Required scoped `ptah_get_diagnostics` after source edits: TypeScript compiler, clean coverage, **0 errors and 0 warnings**, including after the lint correction.

No build, workspace-wide verification, install, routing change or git operation was performed.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Reuse Batch 2b schemas at the translator boundary | Trust unknown payloads; revalidate using existing schemas | Existing validator exports notification schemas; source is strict-safe and imports rather than modifying 2b | Yes |
| Fixed safe error text rather than regex redaction | Regex removal; fixed message with stable local error code | Settled requirement forbids paths/home/tokens in errors; evidence frame helpers also avoid retaining raw failure data | Yes |
| Only turn/completed settles a turn | Error immediately terminates; terminal notification settles | Validator exposes retryable errors and definitive turn status; recorded order ends with turn/completed | Yes |
| Preserve only representable reported usage fields | Estimate omitted counters/cost; copy reported values | Runtime types mark counters optional; pinned validator requires five counters and permits no cost field. Incomplete wire usage is rejected safely, never filled with zero | Yes |
| Keep approval projection in 2g | Infer decisions from item events; leave approval bridge authoritative | Batch 2h scope is notifications, and recorded requestApproval/resolved precedes execution completion without proving a decision | Yes |
| Surface image/path-only, subAgentActivity and other unrepresentable items as safe diagnostics | Invent image media type/bytes or new union; emit diagnostic | Current image event requires bytes and media type; imageView only provides path; union has no subagent activity variant. C10 says subagent capability evidence remains unproved | Yes, when contracts/evidence support richer projection |
| Replay real recorded ordering with explicitly synthetic payloads | Claim recordings contain full payloads; label reconstruction accurately | spike-run-6h/6i/6j store method/itemType summaries | Yes |

## Limitations / integration notes

- Image content is not fabricated from a path or an encoding with no reported media type. Unsupported items remain visible as diagnostics.
- Reasoning/plan partial methods and additional protocol notifications are not in Batch 2b's notification schemas; this batch maps validated item completion, not an invented partial protocol.
- Unknown item fallback is safe if an item notification reaches this translator. The upstream strict validator may reject a future item first; no changes to that validator are authorized here.
- Context integration must instantiate one translator per context/generation and call dispose on context close. This batch does not connect or enable any runtime route.
