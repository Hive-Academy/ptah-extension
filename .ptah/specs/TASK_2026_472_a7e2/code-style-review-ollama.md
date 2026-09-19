# Code Style Review — `TASK_2026_472_a7e2` (ollama)

Reviewed against the working tree as verified at 2026-09-19 17:25 local
(`git diff` over the five modified files plus the untracked spec). The tree was
being reworked by a concurrent session during the review; the executor file
briefly matched HEAD at 17:23 and was restored with two additional corrections
(the existing spec's comments and the lib `CLAUDE.md` watchdog bullet) by
17:25. This review is pinned to the final state.

## Verdict

**APPROVE WITH FINDINGS** — the structural change is clean and consistent with
the repository's conventions; three should-fix findings remain, all comment-
and type-hygiene, none of which break a boundary or an invariant.

## Stale comment sweep

Searched: every file under `libs/backend/agent-sdk/` (including `CLAUDE.md` and
all `.spec.ts`) for `slash`, `raw string`, `string prompt`, `only parses`,
`never goes through the pump`, `no idle hold`; then the two `rpc-handlers`
consumers and the one `frontend/chat` docblock that name the interceptor; then
repo-wide for the dead `promptMode` literals. Four stale sites in the
`agent-sdk` scope were already corrected by this diff itself
(`slash-command-interceptor.ts:11-19`,
`session-lifecycle-manager.ts:524-528`, the executor header and watchdog
comments, `session-query-executor.service.spec.ts:350-356` and `:388`, and
`agent-sdk/CLAUDE.md:91`). What remains:

| file:line | what it still claims | why it is now wrong |
| --- | --- | --- |
| `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:665-666` | "`SessionQueryExecutor` already serves 'slash command + resume' in ONE query (`isSlashCommand && isResume` → `string (slash command + resume)`)" | Both identifiers named in that comment were deleted by this change. `isSlashCommand` no longer exists in the executor, and the `promptMode` literal `string (slash command + resume)` is gone (`session-query-executor.service.ts:331` now produces only `idle+streamInput` or `iterable`). The "ONE query" claim survives; the mechanism description does not. |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:14` | The `interactive` mode gets "the iterable/string prompt" handed in | The interactive path can no longer receive a string: the only production caller is `SessionQueryExecutor`, which now passes `AsyncIterable<SDKUserMessage>` unconditionally (`session-query-executor.service.ts:328-331`). The string half of the union survives only in the runner's own unit specs. |
| `libs/backend/rpc-handlers/src/lib/chat/session/chat-continue-slash-before-resume.spec.ts:11` | Quotes `promptMode: "string (slash command + resume)"` | This is explicit pre-fix history narration for TASK_2026_350 ("Pre-fix ordering: … a SECOND query started with…"), so it is acceptable as written; listed for completeness because it is the only other place the dead literal appears. The current-behaviour sentence beside it (`:14`, "serves slash+resume in ONE query") remains true. |

Verified NOT stale (checked and cleared):

- `internal-query.types.ts:8` — "String prompt (not AsyncIterable)" describes
  the one-shot path, which is single-turn by design and does not go through
  `SessionQueryExecutor`.
- `session-lifecycle-manager.ts:217-221` — "always set internally for slash
  commands since they resume the existing session" is still true;
  `executeSlashCommandQuery` always passes `resumeSessionId`
  (`session-lifecycle-manager.ts:545`).
- `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts:23-25`
  — claims the interceptor routes `/orchestrate` to
  `executeSlashCommandQuery`; routing is unchanged, only the delivery mechanism
  moved. Still accurate.

## Findings

1. **Stale mechanism comment in `rpc-handlers` names deleted code** —
   `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:665-666`.
   Severity: **should-fix**. The comment cites `isSlashCommand` and the
   `string (slash command + resume)` mode string as the reason the
   slash-before-resume ordering works. Both are gone. This is precisely the
   acceptance-item-4 failure mode: the next reader who goes looking for that
   branch will find nothing. Fix: reword to "serves slash + resume in ONE
   streamed query (`idle+streamInput`, TASK_2026_472)". Comment-only change.

2. **The type narrowing stops at the executor and leaves a too-wide signature
   in the runner** —
   `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:150`
   (`InteractiveRunInput.prompt: string | AsyncIterable<SDKUserMessage>`) and
   `:318-321` (`invokeWithLoadedQuery(..., prompt: string |
   AsyncIterable<SDKUserMessage>, ...)`). Severity: **should-fix**. After this
   change the interactive path has exactly one production caller
   (`session-query-executor.service.ts:341-345`) and it now always passes an
   `AsyncIterable`; the one-shot path that legitimately uses strings has its own
   input type (`:129-132`) and calls `queryFn` directly (`:284-289`), not
   through `invokeWithLoadedQuery`. The string half of the interactive union is
   exercised only by the runner's own unit specs
   (`sdk-query-runner.service.spec.ts:369-371` passes `'prompt-z'`, `:467-468`
   passes `'interactive-prompt'`). This is the same union the diff narrowed in
   the executor — leaving it wide one file up re-opens the door the change just
   closed: a future caller could pass a string and reintroduce the
   single-turn kill without any type error. Fix: narrow both to
   `AsyncIterable<SDKUserMessage>` and update the two spec literals; also update
   the header comment at `:14` (see sweep table).

3. **The executor's new comment block duplicates the interceptor's history and
   documents a deleted mechanism** —
   `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:127-145`.
   Severity: **should-fix** (trim) / **note** (the register itself). The
   narrative register matches this lib's house style — postmortem comments
   citing task ids, versions and measured timings are the established idiom
   (compare `:158-165`, `:232-238`, the `CLAUDE.md` bullets). But two parts
   over-contribute:
   - `:127-141` repeats the interceptor header's story nearly verbatim
     (`slash-command-interceptor.ts:13-19`: same 0.2.140 → 0.3.150 claim, same
     2.8 s abort). One canonical telling exists; the executor's copy could end
     at "a string prompt is what sets `isSingleUserTurn` and closes the input on
     the first `result` — see the `slash-command-interceptor.ts` header
     (TASK_2026_472)".
   - `:143-145` explains the removed `hasAttachments` bypass ("it was only ever
     excluded from slash classification…"). That bypass exists nowhere now; the
     paragraph describes absent code, which is the comment form of the
     "// removed" pattern the repository forbids. A reader without the old diff
     has no referent. Delete it, or fold one sentence into the block above
     ("attachments ride the same queue — there is no separate path").
   The watchdog comment at `:243-251` is different: it guards a live invariant
   (a persistent slash session must re-take the idle hold or the watchdog kills
   it after 180 s). Keep it as is.

4. **No spec asserts the moved end of the watchdog accounting** —
   `session-query-executor.slash-persistence.spec.ts` (whole file) and
   `session-query-executor.service.spec.ts:387-398`. Severity: **note**. The
   executor comment at `:245-251` claims `markTurnEnded` now re-takes the idle
   hold after a slash `result` — the exact hazard `task.md` calls out ("A
   persistent slash session must take an idle hold after its last turn, or the
   watchdog aborts it after 180 seconds of healthy idle time"). The new spec's
   fake does call `registry.markTurnEnded` (`:209-212`), but nothing asserts
   `activityWatchdog.isHeld` afterwards; the existing spec pins only the
   registration-side branch (no hold taken). The mechanism the comment
   narrates is untested. Route to senior-tester; one assertion closes it.

5. **Concurrent-session churn on the review target** — worktree, 17:23-17:25.
   Severity: **note**. The executor file was reverted to HEAD mid-review and
   restored a minute later with two extra corrected files. This review is
   pinned to the 17:25 state; whoever commits should re-run `git diff` and
   confirm the five-file shape (executor, existing spec, interceptor, facade
   docblock, lib `CLAUDE.md`) is what lands.

## Questions answered

**1. Dead code.** `SlashCommandInterceptor` is not orphaned. It is
DI-registered (`di/register.ts:546-547`), exported from the public API
(`src/index.ts:287` — unchanged by this diff), and consumed by `rpc-handlers`
(`chat-session.service.ts:46,140` injects it; `chat-slash-command-router.service.ts:18,46`;
the static `isSlashCommand` is still called at `chat-session.service.ts:677`).
Inside the executor nothing is vestigial: `hasAttachments`, `isSlashCommand`,
the import, and the two `promptMode` literals were all removed with their
branch; no `_`-prefixed vars, no `// removed` comments in code form. The one
thing the change leaves unused is the string half of the runner's interactive
union (finding 2).

**2. Stale comments.** The sweep table above lists every survivor. Within
`libs/backend/agent-sdk/` the diff itself already corrected every stale site
the sweep found; the two remaining live claims sit in `rpc-handlers`
(`chat-session.service.ts:665-666`) and in the runner's header
(`sdk-query-runner.service.ts:14`).

**3. Comment density and register.** The register matches the surrounding
file: this lib documents mechanisms as cited postmortems (executor `:158-165`,
`:232-238`, `:257-262`, `:311-321` are the same style), so long comments here
are not automatically over-commenting. The over-commenting is localised:
`:127-141` duplicates the interceptor header verbatim, and `:143-145`
describes a deleted bypass (finding 3). The `:325-327` "Never a raw string"
note is short and states something the code cannot — keep.

**4. Spec placement and naming.** A separate file is the right call. The
precedent is `session-query-executor.harness-preflight.spec.ts` — the dotted
`<service>.<topic>.spec.ts` convention already exists in this directory, and
`slash-persistence` fits it. The new spec also brings its own fake-SDK harness
(the `createFakeSdk` block, `:81-135`); folding a second, structurally
different harness into the existing 450-line, four-describe
`session-query-executor.service.spec.ts` would have made both harder to read.

**5. Type precision.** The narrowing is honest. `SdkQueryOptionsBuilder`
returns `prompt: AsyncIterable<SDKUserMessage>`
(`sdk-query-options-builder.ts:626`, `:884`), so the non-resume arm always
holds an iterable; the resume arm is `createIdlePromptStream`. No caller of
`executeQuery` can reach the SDK with a string through this path. The gap is
upstream: `InteractiveRunInput.prompt` and `invokeWithLoadedQuery`
(`sdk-query-runner.service.ts:150`, `:318-321`) still accept `string` although
no production caller supplies one any more (finding 2).

**6. Boundaries.** Clean. The executor imports only
`@ptah-extension/vscode-core` and `@ptah-extension/shared` from outside the
lib — both in the lib's declared internal dependency list — plus intra-lib
modules. No `platform-{cli,electron,vscode}`, no `harness-sync`. `src/index.ts`
is untouched; the public API surface did not widen. The new spec imports only
intra-lib modules plus `vscode-core`/`shared` types, matching its siblings.

## Scoring detail

Score 8/10. The separation from 9-10 is finding 2 (the narrowed type was not
carried to the one signature that could re-open the defect) and finding 1
(the sweep stopped at the lib boundary while the dead literals it created are
named in a consumer). The separation from 5-7 is real: dead code removal is
complete, the spec placement and naming follow an in-directory precedent,
boundaries and the public API are untouched, and the stale-comment correction
— the task's stated highest-value item — was done thoroughly inside the lib,
including the existing spec and the lib `CLAUDE.md` bullet, which the original
diff did not yet contain.