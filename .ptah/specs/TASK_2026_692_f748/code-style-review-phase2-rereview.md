# Code Style Re-review (Phase 2, Batch 13F) - TASK_2026_692_f748

Scope: `git show a8842a8e4 -- libs/`. No heavy checks run; orchestrator reported specs and typechecks green.

## Verdict: APPROVED (score 8/10)

Blocking 0, Serious 0, Moderate 1, Minor 3. The Phase 2 Serious finding ("depend on concrete IdleCompactionService") is resolved.

## Previous findings

| Finding | Status | Evidence |
| --- | --- | --- |
| SessionLifecycleManager depends on concrete service | FIXED | `session-lifecycle-manager.ts:424` takes `IdleCompactionFacadePort \| null`; `:484,:722,:742-745,:822` use only port members. |
| CompactionHookHandler depends on concrete service | FIXED | `compaction-hook-handler.ts:43,164` use `Pick<IdleCompactionSignals,'rekey'>`; the import is type-only. |
| Factory size and SessionId cast | FIXED | The factory is now ~12 lines (`register.ts` SDK_IDLE_COMPACTION). The nested `Parameters<...>[0]` cast is gone. `sendIdleCompact(sessionId: string, ...)` matches `IdleCompactSender` (`idle-compaction.types.ts:258`). The single brand cast `sessionId as SessionId` now sits at the boundary where `_streamPump.sendMessage` needs it. |

## Checks asked for

1. **Port placement and direction: PASS.** `IdleCompactionFacadePort` is in `idle-compaction.types.ts:254`, next to `IdleCompactionSignals`, `IdleCompactSender` and `IdleBoundaryNotice`. Dependency direction is consumer -> types file, and the service implements the types. The `I*` prefix is not used by the sibling idle types (`IdleCompactionSignals`, `IdleCompactSender`), so `...Port` matches the local convention. The type is composed from `IdleCompactionSignals` rather than re-declared.
2. **`Pick<IdleCompactionSignals,'rekey'>`: PASS.** It mirrors `PostCompactRekeyTarget = Pick<IContextUsagePort,'rekey'>` at `compaction-hook-handler.ts:~46`, so it follows the nearest sibling. A named alias for it would be marginally nicer (Minor 1).
3. **Export surface.** The package public index exports no idle types (grep of `libs/backend/agent-sdk/src/index.ts` finds nothing). The internal barrel `compaction/idle/index.ts` exports `IdleCompactionSignals` but not the new `IdleCompactionFacadePort`. Consumers (`session-lifecycle-manager.ts`, `compaction-hook-handler.ts`, `session-query-executor.service.ts:58`) import straight from `idle-compaction.types`, so nothing is broken. Keeping it off the public index is correct because it is internal. See Minor 2 for the barrel.
4. **`createIdleCompactionService` in `register.ts`: acceptable.** It is a module-private function placed beside `noOpModelDispatchProvenanceTap` (`register.ts:~136`). It has one caller and builds on `c`, `SDK_TOKENS` and `PLATFORM_TOKENS`, which already live in this file. File length went from 926 to 939 non-comment-agnostic lines; it was already above the 700-line `max-lines` warn (`eslint.config.mjs:558`) before this commit, so this commit does not introduce the warning, it adds 13 lines to a pre-existing one. Extracting to `di/idle-compaction.factory.ts` would be cleaner but would be a first split of a file whose other registrations are the real size driver. Treat it as a later item (Moderate 1). It is not a blocker.
5. **`settled?` naming and doc: acceptable.** `rpc-chat.types.ts:172` follows the optional-flag style of `ChatContinueResult` and is additive, so the contract change is non-breaking. The doc is thin (Minor 3).
6. **`message-sender.service.ts:778-787` duplication.** The block repeats the `markLoaded` / `markTabIdle` / `setStatus('loaded')` triple already at `:530-533` (start failure), `:768-771` (continue failure) and `:801-804` (catch). `rollBackUnsentPrompt` (`:818`) already exists, but it also drops the bubble depending on `dropBubble`, which is wrong for a settled command (the user's `/compact` bubble stays), so reusing it would be incorrect. Calling `removeUserPromptBoundary` directly is therefore right. There is no existing helper for the idle triple. This is the fourth copy, so a small `private settleTabIdle(tabId)` would now pay off (Minor 4).

## Moderate

1. **`register.ts` stays over the `max-lines` warn (939 vs 700).** File: `libs/backend/agent-sdk/src/lib/di/register.ts`. The extra lines come from this commit's helper, but the root cause is pre-existing. Recommendation: schedule a split by registration domain (idle/compaction group first) and record it in `future-enhancements.md`. Do not block this batch on it.

## Minor

1. `compaction-hook-handler.ts:164`: inline `Pick<IdleCompactionSignals,'rekey'>`; a local alias beside `PostCompactRekeyTarget` (line ~46) would match that sibling.
2. `compaction/idle/index.ts`: add `IdleCompactionFacadePort` to the type exports so the internal barrel stays complete, or note why consumers bypass it.
3. `rpc-chat.types.ts:172`: the doc "The command completed without starting a stream." is ambiguous. Suggested wording: "True when the request was fully handled backend-side (e.g. a coalesced manual /compact); no stream or turn_state will follow, so the caller must return the tab to idle." Name `settled` is fine.
4. `message-sender.service.ts:778-787`: extract the idle-reset triple into a private helper shared by four sites (see check 6).

## Pattern compliance

| Rule | Status | Evidence |
| --- | --- | --- |
| Depend on ports, not concrete services | PASS | `session-lifecycle-manager.ts:424`, `compaction-hook-handler.ts:164` |
| Port types colocated with sibling idle types | PASS | `idle-compaction.types.ts:254` |
| Optional DI uses `isOptional` and fails open | PASS | `compaction-hook-handler.ts:163`, `register.ts` factory returns `undefined` after one logged error |
| No new `as any` / `@ts-ignore` | PASS | diff has only the single `as SessionId` brand cast |
| Shared RPC contract change is additive | PASS | `rpc-chat.types.ts:172` |
| File size limit | WARN (pre-existing) | `register.ts` 939 lines vs 700 |

## Answers to the five questions (brief)

1. Six months: a second consumer needing `rekey` plus another member will extend the `Pick` ad hoc; the named facade port makes that cheap.
2. Misread: `settled` could be taken as "the turn finished"; sharpen the doc.
3. Maintenance: the module-level `idleCompactionFailed` flag in `registerSdkServices` is cached per registration call, which is fine for a single container.
4. Inconsistent: only the barrel omission (Minor 2).
5. Different: move the factory to its own `di` file and add the idle-reset helper; neither is required now.
