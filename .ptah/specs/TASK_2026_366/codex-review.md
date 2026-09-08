# TASK_2026_366 — Review gate: Suppress empty assistant message envelopes

Reviewed 2026-09-08 against the working tree at `2977dfa41` (branch `fix/empty-assistant-bubbles`).
Implementing commit: `a4dcc9d9e`, with follow-ups `3ec94740a` (keep every SDK field), `a2071b763`,
`d5dca6ca7`, `eca2c155b` touching the same file. The review is of the CURRENT code on disk.

Working tree was clean before and after the Codex run — the review changed no file.

## Acceptance criteria

Criteria extracted from `task.md`, `context.md`, `implementation-notes.md` and the commit body of
`a4dcc9d9e`.

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| AC1 | An assistant message whose only content is a signature-only (empty) thinking block emits NO `message_start` and NO `message_complete` | SATISFIED | `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:344-350` returns early when `events.length === 0`; `…/assistant-message.transformer.spec.ts:141` asserts `events` is `[]` for `{ type: 'thinking', thinking: '', signature: 'sig' }` |
| AC2 | The root `turn_state` transition is still emitted when the envelope is suppressed, and precedes `message_start` when it is not | SATISFIED | `assistant-message.transformer.ts:337-342` computes the turn before the emptiness check; `:349` returns `[turnStateEvent]`; `:395-400` prepends it ahead of `messageStartEvent`. Pinned by `…spec.ts:165` (suppressed case, `['turn_state']`) and `…spec.ts:792` (envelope case, `turn_state` first) |
| AC3 | Every content block is narrowed through the `ContentBlock` guards; malformed blocks, `tool_use` with non-object `input`, and unsupported types are dropped with a logged warning | SATISFIED (untested — see B2) | `assistant-message.transformer.ts:38-40` (`hasContentBlockType`), `:55-61` (malformed → `logger.warn`, `continue`), `:69-75` (non-object `input` → warn, `continue`), `:79-84` (unsupported type → warn, dropped) |
| AC4 | `ThinkingBlock` carries the optional `signature` the SDK sends, pinned by a contract spec | SATISFIED | `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts:222-227`; `…/content-block-contract.spec.ts:117-126` (fixtures) and the `DECLARED_FIELDS` set including `signature` |
| AC5 | `user-layer-agents.ts` reads `process.platform` off `globalThis` so the shared barrel compiles under the webview tsconfig | SATISFIED | `libs/shared/src/lib/types/user-layer-agents.ts:53-54`. `grep -n "process"` in that file returns only lines 43/46 (comment prose) and 53/54 (the `globalThis` read). No bare `process.` expression remains |
| AC6 | Unit coverage for signature-only empty thinking, retained root turn state, mixed thinking+text, tool-use-only | SATISFIED | `…spec.ts:141`, `:165`, `:246`, `:274`. `npx jest --config libs/backend/agent-sdk/jest.config.ts …/assistant-message.transformer.spec.ts --runInBand` → **26 passed, 26 total**. `content-block-contract.spec.ts` → 1 passed, 1 skipped (the opt-in corpus). `npx tsc -p libs/backend/agent-sdk/tsconfig.lib.json --noEmit` → clean |

## Codex raw verdict

Agent `b8797d4a-8af5-44f2-8c6e-a89a533f5a1f` (codex, exit 0, session `01a07da0-dda2-71e0-a772-7e5e59cbe7d7`):

```
AC1: PARTIAL — assistant-message.transformer.ts:120 and :344 — Empty thinking is suppressed, but
     whitespace-only thinking is truthy and produces thinking_delta, message_start, message_complete.
AC2: SATISFIED    AC3: SATISFIED    AC4: SATISFIED    AC5: SATISFIED    AC6: SATISFIED (26/26)

RISKS
- Blocking: whitespace-only thinking remains renderable (line 121 checks truthiness, not trimmed
  content). No whitespace regression test; the present test uses only thinking: ''.
- Guard depth: the four predicates only check the discriminator (claude-sdk.types.ts:480-509). Tests
  for missing/non-string type, unsupported types, and invalid tool_use.input are absent.
- SDK fields ARE preserved during narrowing (lines 64-78 push the original block object). No
  downstream consumer uses `caller`; no required SDK field loss found.
- No downstream stranding. Streaming envelopes are independently closed by message_stop
  (stream-event.transformer.ts:306-334); terminal turn handling finalizes or clears an empty tree
  (turn-state-applier.service.ts:115-139, message-finalization.service.ts:111-143).
- The `never` fallback at :325-334 is statically unreachable — defensive dead code, not a failure path.
- The opt-in corpus test silently skips parse/read failures (content-block-contract.spec.ts:75-85,
  97-101, 133-138).

VERDICT: NEEDS_WORK
```

## My adjudication

Everything Codex reported was opened and checked at the line it named.

**Confirmed, and carried forward as non-blocking notes:**

- `assistant-message.transformer.ts:121` is indeed `if (block.thinking)` — truthiness, not a trim.
  `:136` is `if (block.text)`, the same shape. Whitespace-only content therefore is renderable.
- No spec anywhere in `assistant-message.transformer.spec.ts` exercises the three
  drop-with-warning branches. `grep` for `hasContentBlockType|malformed content block|non-object
  input|unsupported content block` in that spec returns nothing. AC3 is implemented and correct by
  inspection but is not pinned by a test.
- The `const unhandled: never` branch at `:325-334` is unreachable: `content` is built exclusively
  from the four accepted branches at `:64-78`, so the second loop's exhaustiveness `else` can never
  execute. Dead code, harmless.
- Field preservation after `3ec94740a` is real. `:65`, `:67`, `:76`, `:78` push `block` itself, not
  a reconstructed literal — the field loss introduced by `a4dcc9d9e` is fully repaired, not partly.
- No stranding. `stream-event.transformer.ts:306-334` emits `message_complete` from `message_stop`
  on the `'stream'` source independently of the complete-assistant path, so suppressing the
  `'complete'` envelope cannot leave a streaming envelope open. On the consumer side
  `accumulator-core.service.ts:521-528` treats `message_complete` as token bookkeeping only — it
  opens and closes nothing — and `message-finalization.service.ts:110-125` carries a second,
  independent empty-bubble guard for `finalTree.length === 0`.

**Rejected:**

- **Codex's blocker (AC1 PARTIAL, whitespace-only thinking) does not gate this task.** The word
  "whitespace" is in the Codex prompt because I put it there when paraphrasing; it is not in the
  task. `task.md`, `context.md`, `implementation-notes.md` and the `a4dcc9d9e` commit body all state
  the defect as a *signature-only* thinking block, i.e. `thinking: ''`, which is exactly what the
  shipped code suppresses and what `…spec.ts:141` pins. Codex graded against my paraphrase, not the
  contract. A whitespace-only thinking block is a hypothetical the review produced no evidence the
  SDK ever emits, and it is a pre-existing property of the truthiness checks rather than something
  this change introduced. It is worth a follow-up, not a gate.

**Missed by Codex, added by me:** nothing that rises to a blocker. The token usage and cost of a
suppressed message are discarded with its `message_complete`, but session totals arrive separately
through `ResultMessageTransformer`, so no accounting is lost at the turn level.

## Blockers

None.

## Non-blocking follow-ups (do not gate `done`)

- **N1** `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:121`
  and `:136` — `if (block.thinking)` / `if (block.text)` are truthiness checks. A whitespace-only
  block would still mint an envelope and a near-empty bubble. Unobserved in practice; a `.trim()`
  plus one spec would close it.
- **N2** `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.spec.ts` —
  the three AC3 drop paths (`:55`, `:69`, `:79` of the transformer) have no test. Three short cases
  asserting the warning and the dropped block would pin behaviour the commit message explicitly
  claims.
- **N3** `assistant-message.transformer.ts:325-334` — statically unreachable `never` branch; safe to
  delete when the file is next touched.

## Final verdict

**READY FOR DONE.** All six acceptance criteria are satisfied in the code on disk, the named test
command passes 26/26, the scoped typecheck is clean, and the consumer trace shows no stranded
downstream state. The single Codex blocker was graded against a criterion the task never made and is
recorded here as follow-up N1.
