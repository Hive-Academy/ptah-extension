# Batch 3 report: carry-over route, transcript renderer and refusal pins

Executor: backend-developer subagent. Worktree:
`/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765`.
No git commands were run. `batches.md` and `task.md` were not edited.

## Verification status: NOT CONFIRMED (check moved to CI by the user)

- The user stopped local `npm run verify` and made CI on a draft PR the heavy gate. I killed my
  queued or running verify and did not start another.
- First (complete) run: `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers`.
  Its summary line was `NX 6 tasks: 5 succeeded, 1 failed`, so 6 tasks means 2 projects x
  3 targets. The verify script printed exit 0. My output filter dropped the per-task lines, so
  **I do not know which task failed (lint, test or typecheck, and in which project).** That failure
  is unresolved and may come from this batch.
- Second run: it got the lock and then released it after 3.9 s with `exit code 1`. It printed no
  Nx task output, so it tells us nothing more. I did not start a third run.
- `ptah_get_diagnostics` with the 6 changed files returned "Unavailable" three times. The first
  two said "TypeScript check still running after 45s". The last said "diagnostics worker was
  terminated because another run on it timed out". No diagnostics were produced, clean or
  otherwise.
- **Action for the coordinator:** read the CI log for the agent-sdk and rpc-handlers lint, test
  and typecheck jobs, find the 1 failing task, and send any defect in these files back to an
  executor. Do not call this batch verified until CI is green.

## Files

- MODIFIED `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts`: adds
  `readCarryOverTranscript` and adds the reader to the `getLegacy` `Pick`.
- MODIFIED `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.spec.ts`: the
  legacy fake gains `readCarryOverTranscript`; adds 4 cases.
- CREATED `libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over-transcript.ts`:
  constants, `redactKnownSecrets` and `renderCarryOverPrompt`.
- CREATED `libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over-transcript.spec.ts`.
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts`: 1 pin.
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.native.spec.ts`:
  2 pins.

No production edits to `continueSession`, `autoResumeIfInactive`,
`chat-slash-command-router.service.ts` or `workspace-provider-profile-resolver.ts`. No registration
edit (`register.ts` already passes the full reader). No `libs/frontend` files touched.

## Task 3.1: `SessionHistoryRouter.readCarryOverTranscript`

- Signature: `readCarryOverTranscript(sessionId, workspacePath, options: CarryOverReadOptions):
  Promise<CarryOverTranscript>`. Both types are type-only imports from the reader service and
  `helpers/history/history.types`.
- A session that is not native goes to `getLegacy().readCarryOverTranscript`, with the same
  options object. A native session throws `SessionHistoryRouteError('nativePortUnavailable')` and
  calls neither `getNative()` nor `getLegacy()` (Decision T2). `invalidNativeIdentity` from
  `nativeSession` propagates unchanged.
- Spec cases:
  - A Claude session goes to the legacy reader with `tailBytes` and `signal` passed by identity
    (AC 3.10, Claude half).
  - A missing metadata row also goes to the legacy reader.
  - A native session gets `nativePortUnavailable`. `readHistory` is called 0 times, and
    `getNative`, `getLegacy` and the legacy reader are not called.
  - An invalid native identity propagates.

  The existing cases are unchanged.

## Task 3.2: transcript renderer and redaction

- Exports:
  - `CARRY_OVER_READ_TAIL_BYTES = 2 * 1024 * 1024`
  - `CARRY_OVER_TEXT_BUDGET_CHARS = 48_000`
  - `CARRY_OVER_READ_TIMEOUT_MS = 20_000` (Decision T3)
  - `CARRY_OVER_INSTRUCTION`, which does not start with `/`
  - `redactKnownSecrets`
  - `renderCarryOverPrompt(transcript, budget = CARRY_OVER_TEXT_BUDGET_CHARS)`
  - the `CarryOverPrompt` and `CarryOverTranscript` types. The transcript type is
    `Awaited<ReturnType<SessionHistoryRouter['readCarryOverTranscript']>>`, imported as a type
    from `@ptah-extension/agent-sdk`.

  There are no native constants (Decision T4) and no `cli-agent-runtime` import.
- Redaction uses the plan's list: an `Authorization:` line, `Bearer`, `sk-`, `AKIA`,
  `gh[pousr]_`, `github_pat_`, `xox[abprs]-`, `AIza`, JWT, PEM private key (an unterminated block
  is redacted to the end of the text) and `api_key/token/secret/password` key=value, including
  prefixed keys such as `access_token`. There is no generic base64 rule. Each turn is redacted
  before it is measured.
- Rendering:
  - Labels are `User:`, `Assistant:` and `Summary of the earlier conversation:`, with
    `\n\n` between turns. Blank turns are skipped, and a transcript with no text gives `null`.
  - Whole turns are kept newest first. The omission line counts toward the budget.
  - An oversize newest turn keeps its end after `[start of this message omitted] `.
  - A final cut enforces the budget for budgets smaller than the fixed text.
  - The prompt wrapper is exactly the plan's
    `INSTRUCTION\n\n<previous-conversation>\n…\n</previous-conversation>`.
- Spec coverage, by AC:

  | AC | What the spec checks |
  | -- | -- |
  | 3.1 | All turns in order with no omission line. |
  | 3.2 | Exact count for 1 and 2 dropped turns when the window covers the whole history. |
  | 3.2, 3.8 | A count when the window starts at a summary, and no line when it fits. |
  | 3.2, 3.8 | The no-count line when the window holds neither the whole history nor a summary (summary outside the window, turns before it, native shape), with or without drops. |
  | 3.3 | An oversize newest turn keeps its end, with the marker. |
  | 3.4 | 40 seeded random transcripts at least 10x the budget always stay within it, and kept + omitted equals the turn count. The default 48k budget holds for a roughly 480k input. A tiny budget also holds. |
  | 8.2, 8.3 | 14 secret shapes are absent from `prompt`, both in prose and in a summary. |

  Other spec cases:
  - Hashes, paths and "token budget" prose are not redacted.
  - A secret cut by truncation leaves no tail.
  - Empty and blank input gives `null`.
  - The constants are pinned.

## Task 3.3: refusal pins (specs only)

- `chat-session.native.spec.ts` drives `continueSession` from start to finish (the harness reaches
  it). It uses a real `ChatRuntimeProfileService` and `WorkspaceProviderProfileResolver`, with a
  stored `anthropic` session and the active provider set to `openai-codex`. The case asserts
  `toStrictEqual({ success:false, sessionId, error:<exact resolver text from
  workspace-provider-profile-resolver.ts:547>, errorCode:'AUTH_REQUIRED', providerId:'anthropic' })`
  and the five sorted keys. A second continue refuses identically, and `resumeSession` is not
  called (AC 1.5, 5.5, 6.3).
- `chat-slash-command-router.native.spec.ts` adds two cases:
  - The same strict shape and sorted keys for `/compact`. Neither `compact` nor
    `executeSlashCommand` is called.
  - A native identity with an `activeProvider` fake that reports `anthropic` still calls
    `runtimeControls.compact(sessionId)` once and returns `toStrictEqual({ success:true,
    sessionId, settled:true })`.
- These pins have not been run (see Verification). If CI shows a pin failing on unchanged
  production code, the batch rule applies: it is a plan BLOCKER (the shape differs from E6).
  Report it, and do not change production code.

## Decisions

| Decision | Options | Evidence | Reversible |
| -------- | ------- | -------- | ---------- |
| The omission count uses the singular "turn" for 1: `Earlier conversation omitted (1 turn).` | The plan's literal `(N turns)` for every N. | Host-only prompt text, never shown in the UI. No later batch asserts on it (Batches 4-8 sections). | Yes |
| Blank turns (whitespace only after redaction) are skipped and not counted. | Render empty labelled turns. | The plan says to return `null` "when there are no text turns". | Yes |
| The renderer re-exports `CarryOverTranscript` as a type alias. | Each consumer re-derives it. | Component 4 (Batch 4) consumes it. agent-sdk does not export the type from its barrel. | Yes |
| The native `/compact` pin keeps `prepare` mocked to the native execution and adds an `activeProvider` fake that reports `anthropic`. | Use a real profile service with a full Codex seed. | The router consults `activeProvider` only for the account gate, and only when `accounts` exists (`chat-slash-command-router.service.ts:138-143`). The pin proves the host path does not redirect. | Yes |

## Plan deviations

None in scope or contracts. Verification is incomplete for the reasons above.

## Out-of-scope observations

- `ptah_get_diagnostics` cannot finish a scoped check on this machine under the current load.
