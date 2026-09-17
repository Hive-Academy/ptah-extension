# Code Style Review — `TASK_2026_453_1eb4` Batch 10

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 9/10                                 |
| Assessment      | APPROVED                             |
| Blocking issues | 0                                    |
| Serious issues  | 0                                    |
| Minor issues    | 2                                    |
| Files reviewed  | 17 (7 modified product, 3 created product, 7 spec)  |

## Five style questions

### 1. What breaks in six months?

Nothing structural. `ChatHistoryReadService` owns exactly one question ("which
transcript, how much of it") per the plan's own framing
(`implementation-plan.md:1016`), and `resolveResumeWorkingDirectory` now has a
single home (`chat-history-read.service.ts:127-163`). The one thing to watch:
`readForResume` and `readPage` each call `resolveResumeWorkingDirectory`
independently (`:55`, `:100`) — a future third caller would be the third
duplicate call site to this method, still fine as a private method on the one
owning class, but a fourth consumer of "resolve then read" is the signal to
extract a smaller pure helper.

### 2. What would a new team member misread?

`ChatSessionService.resumeSession` builds `fullEvents` from
`historyRead.readForResume(...)` (`chat-session.service.ts:806-816`) and later
computes `page` only `if (params.historyPage)` (`:929`) — a reader must trace
that `registerFromHistoryEvents` (`:846`) and `stats`/`eventCount` logging
(`:887`) all run on `fullEvents`, never the sliced page, before reaching the
`return`. This is exactly what C8 asked for (P6/P7), but nothing in the method
marks `fullEvents` as "never slice this above the return" — a future edit
adding a new use of the event list mid-method could slice it by copy-paste
habit. Not a defect today; a comment at the `fullEvents` declaration would
close the gap cheaply.

### 3. What does this cost to maintain?

Low. The collaborator is a straight move (no duplicated logic), and both new
schemas reuse the exact `.strict()` idiom from
`session-rpc.schema.ts:61-71` (`chat-rpc.schema.ts:82-95`). The only new
concept, `HistoryPageSizeSchema`, is a two-line, nameable extraction (not a
`helpers`/`utils` dump) that removes duplication between the resume-nested and
top-level schemas.

### 4. Where is this inconsistent with the rest of the repository?

It is not. `wire('chat:history-page', 'registerChatHistoryPage', …)`
(`chat-rpc.handlers.ts:253`) matches the `register<PascalMethod>` tag
convention used by every sibling call (`registerChatStart`,
`registerChatContinue`, `registerChatResume`). `CHAT_TOKENS.HISTORY_READ`
follows the existing `Symbol.for('Chat<Name>Service')` idiom
(`chat/tokens.ts:14`) and its registration comment in `di.ts:19` places it
correctly in the dependency list ("no chat deps", alongside `MCP_STATUS`) —
verified true: `ChatHistoryReadService`'s constructor injects only
`agent-sdk`, `platform-core`, `vscode-core` and `shared` (`chat-history-read.service.ts:1-28`).
Dual RPC registration is complete and correct in all three required places
(`chat-rpc.handlers.ts:98` METHODS, `rpc.types.ts:648` registry,
`rpc.types.ts:3380` `RPC_METHOD_ENTRIES`); `ALLOWED_METHOD_PREFIXES` is
untouched, correctly, since `chat:` is already an allowed prefix.

### 5. What would you have done differently, and why is that better rather than merely other?

Add the one-line "never slice `fullEvents`" comment named in Q2. Otherwise
nothing — the batch is a clean facade extraction that does exactly what C7/C8
specified and no more.

## Blocking issues

None.

## Serious issues

None.

## Minor issues

- `chat-session.service.ts:806-940` — `fullEvents` is never annotated as the
  full-history invariant that `registerFromHistoryEvents` and `stats`/logging
  depend on; a doc comment at the declaration would prevent an accidental
  slice-before-registration regression later. See Q2.
- `session-history-reader.service.ts:289-345` — `loadSessionEventData`'s
  `readMainMessages` callback parameter takes a `Promise<{ messages;
  staleSnapshot? }>` shape duplicated at both call sites
  (`readSessionHistory`'s closure at `:213-221` and `readSessionEvents`'s
  inline arrow at `:294-296`); a named type alias for that return shape (it is
  currently structurally inferred, not exported) would make the shared-step
  contract self-documenting without adding a file. Cosmetic; not a functional
  gap since both call sites already type-check against it.

## File-by-file

### `session-history-reader.service.ts`

9/10 — 0B/0S/1M. The `loadSessionEventData` extraction is exactly the facade
the plan asked for (`readSessionHistory` and `readSessionEvents` share one
private load step, `:207-345`); growth is +39 lines against the "~40" cap
(`b10-codex-report.md` line count 1125 vs 1086 baseline, confirmed:
`wc -l` reports 1125). `resolveAnchorByPromptText`'s `occurrenceFromEnd` branch
(`:793-800`) is additive and does not disturb the legacy `occurrence` path
below it.

### `chat-history-read.service.ts` (new)

9/10 — 0B/0S/1M. Single responsibility, matches its plan description exactly:
`readForResume` wraps `readSessionHistory` (`:50-66`), `readPage` authorizes →
resolves dir → `readSessionEvents` → decodes cursor → `selectHistoryPage` →
`getResumableBySession` (`:68-120`), in that literal order from the plan
(`implementation-plan.md:997-998`). `resolveResumeWorkingDirectory` is an
unmodified move of the old `chat-session.service.ts` private method (diff
confirms byte-for-byte body). No platform import violation — only
`platform-core` ports via DI.

### `chat-session.service.ts`

9/10 — 0B/0S/1M. File shrank 1419 → 1371 (-48 lines), satisfying "must shrink
or stay flat" (`implementation-plan.md:1015`); the facade rule holds — the
class keeps its name, its DI token (`CHAT_TOKENS.SESSION`, unchanged), and its
public method signatures (`resumeSession`, etc.), while the moved concern
becomes an injected collaborator (`CHAT_TOKENS.HISTORY_READ`). No dead
references remain to the old `SessionHistoryReaderService` field or
`FILE_SYSTEM_PROVIDER` injection (grep-verified). Minor note above about
`fullEvents` labeling.

### `chat/tokens.ts`, `chat/di.ts`, `chat/session/index.ts`

10/10 — 0B/0S/0M. `HISTORY_READ` token, `registerSingleton` call, and barrel
export are each one line in the right place, correctly ordered against the
dependency comment in `di.ts:16-19`.

### `chat-rpc.schema.ts`

10/10 — 0B/0S/0M. `HistoryPageSizeSchema` and `ChatHistoryPageParamsSchema`
both use `.strict()`, matching `session-rpc.schema.ts:61-71`'s pattern
exactly. `historyPage` nested onto `ChatResumeParamsSchema` is also
`.strict()` internally while the outer schema stays `.passthrough()` — that
asymmetry is pre-existing (the outer schema was already permissive) and the
new field does not loosen it.

### `chat-rpc.handlers.ts`

10/10 — 0B/0S/0M. `wire<ChatHistoryPageParams, ChatHistoryPageResult>` follows
the same three-argument shape and tag convention as every sibling
registration; the cursor-error mapping (`HistoryCursorStaleError` →
`HISTORY_CURSOR_STALE`, `HistoryCursorInvalidError` → `INVALID_PARAMS`) sits
inside the handler body ahead of `runRpc`'s generic catch, so `RpcUserError`
bypasses Sentry the same way `ModelNotAvailableError` does two cases below it
(`:181-184`). Attachment guard correctly not applied (verified no
`attachmentGuard` reference in the new `wire` call).

### `session-rpc.handlers.ts`

10/10 — 0B/0S/0M. `sanitizeAnchorHint`'s `occurrenceFromEnd` addition
(`:253-270`) mirrors the existing `occurrence` sanitization pattern exactly
(same integer/non-negative guard), and the spread-if-defined idiom keeps the
returned object free of an `undefined` key when the field is absent.

### `rpc.types.ts`

10/10 — 0B/0S/0M. Both dual-registration sites (`RpcMethodRegistry` at `:648`
and `RPC_METHOD_ENTRIES` at `:3380`) are updated together; type import added
alongside its siblings.

### `apps/ptah-cli/docs/jsonrpc-schema.md`

9/10 — 0B/0S/1M (folded into the count above as a documentation completeness
note, not a separate deduction). New §3.1 matches the surrounding doc's
style: prose + fenced `rpc.call` JSON examples, same as the rest of §3. It
states cursor opacity, whole-turn pages, the compaction-boundary stop, and the
stale-cursor reopen path exactly as C9/decision 4 asked, and explicitly notes
no new CLI verb and `session resume`/`session.history` are unchanged.

### Spec files (7 modified/created)

9/10 — 0B/0S/0M. The four "injection-only" specs
(`chat-continue-slash-before-resume.spec.ts`, `chat-session-auth.spec.ts`,
`chat-session-mcp-status.spec.ts`, `chat-session-resume-activate.spec.ts`) are
genuinely injection-only: three drop the now-removed `fileSystemProvider` arg
or swap `readSessionHistory` for `readForResume`, and
`chat-session-resume-activate.spec.ts` constructs a real
`ChatHistoryReadService` instance to preserve its existing fixture behavior
rather than adding new assertions — a legitimate adaptation to the changed
constructor arity, not scope creep. The three new spec files
(`session-history-reader.events-read.spec.ts`,
`chat-history-read.service.spec.ts`, `chat-session-history-page.spec.ts`) each
follow the harness-factory-plus-`describe` shape used throughout this
lib and cover every acceptance criterion named in the plan (parity, no
side-effect collaborators called, occurrenceFromEnd 0/1 and legacy occurrence,
resolution fallback matrix, page-never-calls-full-read, cursor-error mapping
without raw-message leakage, attachment-guard bypass, and schema rejection of
`maxEvents` 0/2001, unknown keys, and a 4,097-char cursor).

## Pattern compliance

| Repository rule or nearby convention                                   | Status | Evidence |
| ------------------------------------------------------------------------ | ------ | -------- |
| Facade rule: public class keeps name/token/signatures, moved concern is an injected collaborator | PASS | `chat-session.service.ts` unchanged public surface + `chat-history-read.service.ts:1-164` |
| RPC dual-registration (compile-time + manifest/registry) | PASS | `rpc.types.ts:648`, `:3380`; `chat-rpc.handlers.ts:98` |
| `ALLOWED_METHOD_PREFIXES` untouched when prefix already allowed | PASS | no diff to `vscode-core/rpc-handler.ts` (chat: already allowed) |
| DI token naming `Symbol.for('Chat<Name>Service')`, `UPPER_SNAKE` key | PASS | `chat/tokens.ts:14` |
| Zod `.strict()` schema idiom for new namespaced params | PASS | `chat-rpc.schema.ts:82-95` vs `session-rpc.schema.ts:61-71` |
| `catch (error: unknown)` / narrow before use | PASS | `chat-rpc.handlers.ts:189` (`error instanceof Error`) |
| File size soft ceiling / facade guardrails (no `helpers`/`utils` extraction, ≥150 lines) | PASS | `chat-history-read.service.ts` 164 lines, nameable, single concern |
| `session-history-reader.service.ts` growth bound (~40 lines) | PASS | +39 lines (1086 → 1125) |
| No raw `error.message` to client | PASS | `chat-rpc.handlers.ts:257-268` maps to fixed user-safe strings |
| Platform-agnostic imports only in `rpc-handlers`/`agent-sdk` | PASS | no `vscode`/electron import in touched files |

## Maintenance debt

- Introduced: one small collaborator (`ChatHistoryReadService`, 164 lines)
  with a clear, narrow name; one new RPC method with full dual registration;
  one schema constant (`HistoryPageSizeSchema`) removing duplication between
  two schemas that both cap page size.
- Retired: the private `resolveResumeWorkingDirectory` copy that used to live
  inside `chat-session.service.ts` (deleted, not duplicated); the direct
  `SDK_SESSION_HISTORY_READER` / `FILE_SYSTEM_PROVIDER` injections that
  `ChatSessionService` no longer needs.
- Net: negative line count in the file that was over the soft ceiling
  (`chat-session.service.ts` 1419 → 1371), positive but bounded growth in the
  library file that owns the shared read step (+39), and no new indirection
  that isn't pulling its weight.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none blocking; the only note is documentation-level (label
  `fullEvents` as the full-history invariant `resumeSession` depends on).
- What a 10/10 version would do differently: add the one-line comment at
  `chat-session.service.ts`'s `fullEvents` declaration, and give the
  `loadSessionEventData` callback parameter a named type alias instead of an
  inline structural type, purely for self-documentation — neither changes
  behavior or structure.
