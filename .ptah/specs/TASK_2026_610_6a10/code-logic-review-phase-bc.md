# Code Logic Review, Phase B+C — TASK_2026_610_6a10

Scope: B1-B10, B8a/b/c, C1-C4, B7+C2a (`f314a4f8a..HEAD`). Read in full: the `ptah-ui-*` pipeline in shared, the live window, the block and message-text components, execution-node, bubble, transcript snapshot code, the backend gate and flag forwarding.

| Metric   | Value                                                                                        |
| -------- | -------------------------------------------------------------------------------------------- |
| Score    | 7/10                                                                                         |
| Verdict  | **REVISE** (no security blocker; 1 major user-visible defect, 3 further majors/minors below) |
| Blocking | 0                                                                                            |
| Major    | 2                                                                                            |
| Minor    | 5                                                                                            |

Targeted runs, all green: shared `mcp-apps-contracts/` 20 suites / 576 tests; chat-ui `organisms/ptah-ui/` 2 / 33; chat `execution/` + `transcript/` 17 / 195.

## Trust boundary: held

- No agent text becomes HTML/CSS/script. The renderer has no `innerHTML`/`bypassSecurity`. Blocks are mounted by Angular control flow from raw text (`execution-node.component.ts` `@else if (ptahUiHost())`, `ptah-ui-message-text.component.ts:293`). Nothing scans the DOM, so forged `<ptah-ui-*>`/`data-ptah-ui-*` HTML is inert.
- `renderPtahUiBlock` (`ptah-ui-pipeline.ts:20-45`) always ends in `validateSurfaceDocument` and returns `validated.surface`. The whole body is in try/catch, and the block adds a second try/catch (`ptah-ui-block.component.ts:179`).
- Only `(renderFailed)` is bound (`:108`). Interaction state is a frozen read-only constant.
- The context is built for `role === 'assistant'` only (`message-bubble.component.ts` `ptahUiContext`). It is forwarded only in the `message` case of execution-node. Agent, tool and SendMessage recursions never pass it. The only other users of `ptah-execution-node` (`cli-agent-output`, `agent-execution`, `inline-agent-bubble`) do not pass `[ptahUi]`.
- Own-key lookups: `sourceName` uses `hasOwnProperty` (`ptah-ui-parser.ts:314`). The resolver uses `Object.hasOwn`. tsx repro, all clean fallbacks, none thrown: `$__proto__.x`, `$constructor.files`, `table $constructor`, `list $toString`, `$diff.hasOwnProperty`, a 400-digit chart number (Infinity is rejected by zod), >200 lines.

## Electron gate: held

- Hint: `hostKind === 'electron' && (profile ?? 'coding') === 'coding' && ptahUiFence === true` (`sdk-query-options-builder.ts` ~1710). `hostKind` is an optional DI token registered only in `apps/ptah-electron/src/di/phase-1-infra.ts`, so `ptahUiFence` cannot grant anything in VS Code.
- Fence flag sent on start and continue from Electron only (`message-sender.service.ts`).
- Forwarded at every site that forwards `mcpToolProfile` (start, launch, auto-resume continue, slash router).
- VS Code: `ptahUi` is `null`, so `hasPtahUiFenceLine` is never evaluated and the `@defer` is never entered. The lazy chunk is not requested, and the fence stays a code block.

## Defects

### 1. MAJOR: the newest turn's `$diff` stays "pending" forever when the turn changed no files

- File: `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:715` (`index === runs.length - 1 ? 'pending' : null`). The spec at `chat-transcript.ptah-ui.spec.ts:600` pins it.
- Cause: the recorder pushes `git:turnChangeSet` only for non-empty sets, and the store drops empty ones (`turn-change-set-recorder.service.ts:20`, `change-set.store.ts:88-103`, `files.length > 0`). A Q&A turn, a non-git workspace, or a reloaded session whose last turn had no edits never receives a push.
- Symptom: a `stats Files | $diff.files` block on the last turn reads "pending" until the user sends another message, then flips to "unavailable". Req 3.2/3.4 and plan A-6 ("after the turn ended, no covering set means unavailable") are not met.
- Repro: code-level (the branch is unconditional for the last run, whether or not the turn is finalized).
- Fix: pending only while the turn is unfinalized, or for a bounded grace (about 3-5 s) after finalization or until the store reports the session's sets loaded. After that the result is `null` (unavailable). Add a spec for finalized, no push, last turn.

### 2. MAJOR: one oversize host value fails the whole block

- File: `ptah-ui-resolver.ts:119-125` (`run.command` and `file.path` are copied verbatim into table cells).
- Repro: `table $tests` with a run whose command is 2,500 chars fails validation with `components.0.rows.1.0: Too big: expected string to have <=2000 characters`, so the whole block falls back to a code block (tsx run). Test commands with inline env or heredocs exceed 2,000 chars readily. The same applies to a very long path.
- Violates Req 3.4 ("the rest of the block renders") and the intent that host data never breaks the block. Also leaks a zod path in the reason line.
- Fix: clamp host strings to `SURFACE_LIMITS.maxStringLength` with an ellipsis in `rowValues`. Clamp `list $tests` text the same way. Also cap rows at `maxTableRows` and fold the remainder into the description.

### 3. MINOR: a live block is frozen with whatever snapshot it had, permanently

- File: `ptah-ui-block.component.ts:220-224, 244-249`.
- A block pushed outside the newest 8 freezes at its current result. With more than 8 fences in one turn (or across a turn still streaming), the earliest blocks of the current turn freeze at "pending" and never fill when the turn finalizes or the push arrives (their `snapshot` input is ignored once frozen). Remount re-reads the current snapshot, which hides it.
- Fix: while the owning snapshot is `state: 'pending'`, defer freezing (or resolve once at finalization), or document the limit. Low probability, so minor.

### 4. MINOR: `$usage` uses the turn-ending message, not the block's own (L-11 deviation)

- File: `chat-transcript.component.ts:746` (`blockMessage: endMessage`); one snapshot is shared by all of the turn's messages (`:722`).
- A block in an earlier assistant message of a multi-message turn shows the last message's cost, tokens and duration. L-11 says "`$usage` uses the block's own message". Either amend the plan (turn-end usage equals the footer) or make it per message.

### 5. MINOR: stale entries in `_turnSnapshotEntries`

- File: `chat-transcript.component.ts:751`. The cache is keyed by the turn-ending message id, which moves while a turn streams. It is cleared only on session change, so there is one stale entry per interim end message. Bounded by the message count, but prune to the ids present in `snapshots`.

### 6. MINOR: fence segmentation vs CommonMark closing indent

- File: `ptah-ui-fence.ts:116-122, 161-165`. The target closer must be at column 0, but markdown closes at 0-3 spaces of indent. A body line ` ```` ends the code block in markdown but not in the segmenter, so the fence swallows the following prose and the next closer (repro:`["fence","stats\n A | 1\n ```\nafter\n"]`). The result is a fallback block that is rendered as markdown anyway (so safe). Cosmetic. Accept 0-3 spaces of indent on the closer (CommonMark) so both parsers agree.

### 7. MINOR: fallback reason leaks internal paths

- File: `ptah-ui-pipeline.ts:26-32`. Only the `could not be validated` prefix is mapped to "internal error". Raw zod paths such as `components.0.series.0.points.0.y: ...` reach the user-visible reason line. Map non-grammar validator reasons to a short fixed reason.

## Verdicts on batches.md notes

| #    | Verdict                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1, 2 | Style, out of my scope.                                                                                                                          |
| 3    | Confirmed. `$5.00` rejects, `\$5.00` is literal, and the tsx/spec corpus agree.                                                                  |
| 4    | Confirmed, no `in` or index lookup on a plain object keyed by agent text. See the repro list above.                                              |
| 5    | Header still renders empty and takes a row gap (`surface-renderer.component.ts:191`). Visual review.                                             |
| 6, 9 | Hint states when to use a block and that the host fills `$` sources. Resolved. "in Ptah Electron" is redundant (nit).                            |
| 7    | Verified end to end (pending, unavailable and available tables all validate).                                                                    |
| 8    | Superseded: the B1-B3 commits are present.                                                                                                       |
| 10   | Accepted. The comment nodes are invisible.                                                                                                       |
| 11   | Not reproduced: the review-dock spec passed in my run (27 s for the suite). Still mock the lazy entry in that spec to remove the cold-load risk. |
| 12   | Not verified by me (no build). The gate with `--base` is for batch M.                                                                            |
| 13   | Agree. The backend spec asserts absence by construction. The frontend `message-sender.host-data.spec.ts` is the real boundary.                   |

## Other checks, no defect

- Zero model tokens: the segmenter only slices, the stored text is never mutated, resolved values live in the view only. The snapshot never reaches `message-sender` or the SDK builder.
- Live cap holds under virtualization and remount: unmounted blocks are released, a remount keeps its seq position, and `liveCount()` is at most 8. The 512-key bound keeps tracking memory finite. Frozen blocks run no pipeline and are detached after one render. Each still carries one cheap effect that re-evaluates per registration.
- Late push: `changeSet` identity changes, the snapshot is rebuilt, the block's `result` recomputes in place with no remount.
- Join: `changeSetForMessage` (window) then `anchoredChangeSetFor` (existing skew fallback) never maps another turn's set to a turn, since the anchors file places each set on one message. The caveat is defect 1.

---

## Re-review (round 1)

Scope: the BF1-BF3 fix diff (`git diff 1c462f2b9` plus the untracked `transcript-turn-snapshots.ts` and its spec). Read in full: the changed resolver, fence, pipeline and converter files; `change-set.store.ts` (settledThrough and grace); `transcript-turn-snapshots.ts`; `ptah-ui-block.component.ts`; the HOST_KIND relocation. Ran `nx test shared --testPathPattern=ptah-ui`: 95 suites / 2490 tests green. The chat project run (store, snapshots, transcript specs) completed but I did not capture pass counts, so I treat it as unverified by me.

| Metric  | Value |
| ------- | ----- |
| Score   | 8/10  |
| Verdict | **APPROVED** (no blocking findings; 3 moderate residuals, none a regression) |

### Per-finding status

| #   | Finding                                 | Status                              | Evidence |
| --- | --------------------------------------- | ----------------------------------- | -------- |
| 1   | Newest turn `$diff` pending forever     | Resolved, with residuals (M-A, M-B) | `transcript-turn-snapshots.ts` `resolveChangeSet` keeps `pending` only while `transcriptOrderKey(end) > settledThrough`. The store settles on a pushed set whose `turnEndedAt` reaches the grace (`change-set.store.ts` `onChangeSet`), on `session:turnEnded` or `session:turnFailed` after `TURN_CHANGE_SET_GRACE_MS` (`startGrace`), and on the first read (`load`). The payload `timestamp` is the value the recorder stamps as `turnEndedAt` (`turn-change-set-recorder.service.ts:242`, schema `sdk-hook.schemas.ts:85`), so both sides compare on one clock. `settledThrough` is a signal read inside the transcript computed, so a settle recomputes the snapshot. Older turns with no set are `null` at once. |
| 2   | Oversize host value fails the block     | Resolved                            | `ptah-ui-resolver.ts` `clampHostValue` is applied to `path`, `status`, `command`, `outcome` and the scalar `stat` value. `list` rows go through `rowValues`, so they are clamped too. Rows are capped at `maxTableRows` and the remainder is folded into the `+N more` note for diff and tests (`sourceDescription`). Residual: the cap is 1000 rows, so 1000 near-2000-char rows could still exceed `maxSurfaceBytes`; unreachable with real data (the backend truncates file lists) and it now degrades to a fixed reason. |
| 3   | Live block frozen at a pending snapshot | Resolved (narrowed, M-C)            | `ptah-ui-block.component.ts` `freeze()` sets `awaitingSettle` when `isSettled` is false. A second effect re-resolves exactly once on settle (inputs read inside `untracked`), clears the flag so the effect tracks nothing afterwards, then detaches after render. A block frozen on a settled snapshot (the common case) still detaches immediately. |
| 4   | `$usage` used the turn-ending message   | Resolved                            | `buildSnapshots` gives each non-end assistant message `{...turnSnapshot, usage: usageOf(message)}`; `usageOf` runs `buildTurnSourceSnapshot` on that message (L-11). The end message keeps the turn snapshot. `TranscriptTurn.assistants` added in `transcript-turns.ts`. |
| 5   | Stale `_turnSnapshotEntries`            | Resolved                            | `compute` builds a fresh `entries` map from the turns present on each pass and replaces `this.entries`; a session change starts from an empty `previous`. |
| 6   | Fence closer indent                     | Resolved                            | `isTargetClosingFence` delegates to `isClosingFence`, which uses `withoutCommonMarkIndent` (0-3 spaces). A new spec pins it. |
| 7   | Fallback reason leaked zod paths        | Resolved                            | `validationFailureReason` in `ptah-ui-pipeline.ts` returns only fixed strings. Cosmetic: the zod "Too big" text matches no keyword, so an over-length string reads "invalid display content" rather than "display limit"; after the clamp this no longer occurs for host data. |

BF3 (HOST_KIND): `PLATFORM_TOKENS.HOST_KIND = Symbol.for('HostKind')` is the same symbol the old `TOKENS.HOST_KIND` used, so resolution is unchanged. The only registration (`phase-1-infra.ts:92`) and the only consumer (`sdk-query-options-builder.ts:958`, still `isOptional`) both moved. No `HostKind` or `HOST_KIND` import from `vscode-core` remains (grep over apps and libs). VS Code and CLI register nothing, so the gate stays closed there. No defect.

BF1 converter: `sourceColumns` reads `PTAH_UI_SOURCES[source].columns`, so converter and parser share one column list. No defect.

### New findings (all moderate, none blocking)

- **M-A: first-read settle can mark a running turn settled too early.** `change-set.store.ts` `load` settles through `Date.now()` at read start, and `resolveChangeSet` compares that with `transcriptOrderKey(end)`, which is the message START time. If the user opens a session that is mid-turn (read starts after the running assistant message started), then at finalization `key(end) <= settledThrough` and the newest turn resolves `unavailable` at once, before the recorder's push arrives. `startGrace` still runs, but the snapshot is already `null`. The late push then flips it to `available`; live blocks update in place, but a block frozen outside the live cap on a settled `unavailable` snapshot is never re-resolved (`isSettled` is true). Effect: a transient wrong "unavailable". Fix: do not settle the first read through the read start while the session has an open turn, or compare against the turn end instead of the message start.
- **M-B: no settle when the Stop hook does not fire.** Settling is driven only by `session:turnEnded` / `session:turnFailed`, which come from the Stop and StopFailure hooks (`stop-hook-handler.ts:105`). If a user-interrupted turn fires neither, the newest turn stays `pending` until the next turn ends or the session is re-read. I could not confirm from the code whether an interrupt fires the Stop hook, so this is uncertain. It is the narrow remainder of former defect 1. Fix if confirmed: also start the grace from the frontend's turn-finalized signal.
- **M-C: a recorder slower than the 5 s grace.** Git status plus numstat can exceed the fixed `TURN_CHANGE_SET_GRACE_MS`. The late push flips `unavailable` to `available`; live blocks update in place, a frozen block that settled as `unavailable` stays so (same cause as M-A). Low probability. Document the bound, or let a late push re-resolve frozen blocks.

### Checked, no defect

- Grace timer: one per session, restarted by a newer turn end with `through = max(...)`. Cleared on a matching push, on session eviction (`clear`) and on `DestroyRef`. `settle` never moves backwards. A turn end for an unread, inactive session is ignored, which is safe because a later `load` settles it. `session:turnFailed` is registered in `handledMessageTypes`.
- Snapshot cache: finalized turns keep object identity (changeSet reference plus assistant identity). The open turn shares one frozen pending constant, so streaming deltas do not re-run the pipeline. The `pending` to `null` flip on settle rebuilds only that turn's entry.
- The `awaitingSettle` effect writes signals inside `untracked`, so there is no effect loop.

### Verdict

APPROVED, 8/10. All seven prior findings are resolved and the fixes introduce no regression. The residuals are narrow timing edges that give a transient or limited-scope wrong status, never a failed block or leaked data. Evidence gap: I did not capture the chat project's test pass counts.
