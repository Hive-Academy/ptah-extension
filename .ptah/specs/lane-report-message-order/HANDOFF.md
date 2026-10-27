# HANDOFF: lane reports break the chat message order

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/lane-report-message-order`
- Branch: `fix/lane-report-message-order` (from `main` at `0e17912e3`)
- Task folder: `.ptah/specs/lane-report-message-order/` (untracked)
- State: all changes are UNCOMMITTED. No commit, no push, no PR yet.
- Do not touch `.claude-worktrees/chat-layout-declutter` (separate task).
- The worktree has a `node_modules` junction to the main checkout. Never run `npm install` in it.

## Goal

When CLI lanes send `<agent-report>` (from `ptah_agent_report`) or `<agent-lane-completed>` into the
parent Claude session, each injected turn must:

1. Show at its correct position in the live view as a separate turn, with a compact peer label.
2. Look the same after a reload, a resync and a hidden-tab reveal.
3. Not release a queued user message before the true end of a turn.
4. Never stamp its uuid onto a user bubble.
5. Get its own "Working / Worked" collapse and its own final message.

## Verified causes (all checked in code)

- H1: the live webview never added the peer user message to `tab.messages`, so every reply joined
  the original prompt's turn.
- User hypothesis (confirmed): `splitTurnMessage` (`chat/.../utils/turn-answer-split.utils.ts:108-110`)
  puts all children of a non-last assistant message into the collapsed log, so only the last reply
  showed. A test covers this.
- H2: the JSONL has no peer `origin`. Replay emitted the envelope as a plain "You" bubble.
- H3: queued content was released on the peer echo `message_complete`.
- H4: the peer echo ran `reconcileUserMessageNativeUuid`.
- H5: `--replay-user-messages` depends on checkpointing. NO CHANGE: no code in `libs` or `apps`
  sets `enableFileCheckpointing`, so the default `true` always applies. The unconditional change
  was reverted. Codex accepted this ("resolved by revert").
- New fact: `JsonlReaderService.convertToSessionHistoryMessage` maps a fixed list of fields. Before
  this fix, `isSidechain`, `origin` and `turnOrigin` never reached replay.
- New fact: a human prompt record has `origin:{kind:'human'}` and `turnOrigin:'human'`. An
  injected lane envelope has no `origin` and `turnOrigin:'sdk'`.

## Done (uncommitted)

Shared:
- `libs/shared/src/lib/utils/lane-envelope.ts` (+spec, export in `utils/index.ts`):
  `parseLaneEnvelope`, `laneEnvelopePeerLabel`. The label equals the live `origin.name`.

Backend (`libs/backend/agent-sdk/src/lib/helpers/history/`):
- `history-event-factory.ts`: optional `inboundPeer` on `createMessageStart`.
- `history.types.ts`: `isSidechain`, `origin`, `turnOrigin` on `JsonlMessageLine` (unknown) and
  `SessionHistoryMessage` (narrowed).
- `jsonl-reader.service.ts`: maps the three fields with narrowing (`isOriginRecord`).
- `session-replay.service.ts`: labels a root user record as a peer only if its text is an
  envelope AND the record is not marked human (`origin.kind`/`turnOrigin` = `human`). This fixes
  Codex finding 2 (human-typed envelope relabeled on reload).
- Specs in the matching `.spec.ts` files.

Frontend (`libs/frontend/chat-streaming/src/lib/`):
- `history-message-builder.service.ts`: exported `buildUserMessageFromStart`, used by live and
  replay (parity).
- `streaming-handler.service.ts`: inserts the peer message on the root user `message_complete`
  (active and background tabs, live only), skips uuid stamping for peers, releases queued content
  only on a non-user root `message_complete`.
- `inbound-peer-message.ts`: insertion rule. The peer goes above a tail prompt only if that prompt
  was sent while a turn was running.
- `queued-prompt-record.service.ts` (new, untracked): per-tab ids of prompts sent mid-turn.
  `recordUserPromptBoundary` adds, `removeUserPromptBoundary` removes, aborted finalize clears.
  This fixes Codex finding 1.
- `message-finalization.service.ts`: clears the record on `finalizeCurrentMessage(…, true)`.
- `streaming-handler.inbound-peer.spec.ts`: parity, queued release, uuid stamping, ordering,
  interrupted turn, failed send, abort, background tab, no insert on replay.

Frontend (`libs/frontend/chat/`):
- `message-bubble.component.{ts,html}`: envelope peer bubble shows `<agent> · report` or
  `<agent> · completed · <verdict>`, the first body line, and an accessible Show more/less toggle.
- `transcript/transcript-turns.inbound-peer.spec.ts`: one turn per peer message; each reply is the
  last assistant of its turn.

## Verification results (latest)

- `npm run verify -- -t test,typecheck -p @ptah-extension/agent-sdk,@ptah-extension/shared`:
  pass. shared 3774/3774 tests. agent-sdk 3958 passed, 3 skipped.
- `npm run verify -- -p @ptah-extension/chat-streaming,@ptah-extension/chat`: tests and typecheck
  pass (chat-streaming 702 passed, 1 skipped; chat 4683 passed, 2 skipped). `chat` lint fails
  with 141 errors that also exist on `main` ("static imports of lazy-loaded libraries"). CI does
  not run project lint (`.github/workflows/ci.yml` runs only di-lint and degradation-audit).
- `chat-state` was not changed in the end (no file in `libs/frontend/chat-state`).
- `agent-sdk` lint has 2 errors on `main` in `session-query-executor.accounts.spec.ts:174,183`
  (`no-unexpected-multiline`). Not changed by this task.

## Review state

- Codex (`code-logic-reviewer`) wrote `code-review.md`: REVISE 6/10 with 2 major findings.
  Both are now fixed (finding 1 frontend, finding 2 backend), but NOT re-reviewed yet.
- The Codex CLI Session ID for a resume: `01a17916-6b8b-7252-86c6-27dcc9a13eb6`.
- `task.diff` in the task folder is STALE. Regenerate it before a re-review (the Codex role
  cannot run git).

## Open problems and decisions

1. Electron screenshots are NOT done. Blockers found in the dev profile
   (`NODE_ENV=development`, `dist/apps/ptah-electron` built in the worktree):
   - A live session fails with "The session account could not be verified"
     (`provider:listAccounts refused: unavailable-storage`). This is the account-admission feature,
     not this task.
   - The app refuses a workspace that contains its own build (`D:/projects/ptah-extension`), so a
     scratch workspace `D:/scratch/lane-report-demo` was used. Its main agent was switched to
     "Claude (Subscription)" in Settings.
   - "Previous sessions" lists only the dev profile's sessions; `chat:resume` of
     `f40a8592…` returned no events (the session moved to another worktree cwd).
   - Do not run the dev build on the real production profile (data migration risk).
   - Decision for the user: accept tests as evidence, or fix the dev-profile account storage, or
     run a manual check in a packaged build.
2. Known limit (not a regression): a prompt sent by a mid-turn "steer" splits the running turn, so
   it is not at the tail. A peer turn held ahead of it is then appended after it.
3. Known limit: `ptah_session_send` parent → child messages carry no envelope; a reload cannot
   label them.
4. The dev Electron build in `dist/` was built before the H5 revert and before the two review
   fixes. Rebuild before any screenshot.

## Next steps

1. `cd D:/projects/ptah-extension/.claude-worktrees/lane-report-message-order`
2. Read `git diff main` and `git status`. Note the untracked
   `libs/frontend/chat-streaming/src/lib/queued-prompt-record.service.ts`.
3. Regenerate the review diff:
   `git add -N <untracked source files>` then `git diff main -- libs > .ptah/specs/lane-report-message-order/task.diff`.
4. Re-review with a non-Claude model: resume the Codex lane
   (`ptah_agent_spawn { cli: "codex", resume_session_id: "01a17916-6b8b-7252-86c6-27dcc9a13eb6", … }`)
   or spawn a new `codex` `code-logic-reviewer` lane on `task.diff`. Ask it to confirm the two
   findings are fixed. Address any new confirmed finding.
5. Final verification (memory-safe, foreground, filtered):
   - `npm run verify -- -t test,typecheck -p @ptah-extension/agent-sdk,@ptah-extension/shared,@ptah-extension/chat-streaming,@ptah-extension/chat -- --output-style=static`
   - Confirm the header says "for 4 projects".
6. Decide the screenshot blocker with the user (see open problem 1).
7. Read `.commitlintrc.json`. Commit in the foreground, staging files by explicit path (not the
   `.ptah/specs` folder unless the repository tracks task specs). Suggested subject:
   `fix(agent-sdk,chat): keep lane report turns in order live and on reload`.
8. Push and open the PR against `main` in one background command:
   `git push -u origin fix/lane-report-message-order && gh pr create --base main --title "fix(chat): keep lane report turns in order" --body-file <file>`
   with `## Summary` and `## Test plan` (real results, the screenshot status, the pre-existing
   lint failures).
9. Watch CI and reviews with `gh pr checks` / `gh pr view --comments`, fix confirmed findings.
10. Keep the worktree and branch. After merge and user approval, remove the junction first
    (`cmd /c rmdir <worktree>\node_modules`), then `git worktree remove`.
11. Optional cleanup: `D:/scratch/lane-report-demo` was created for the screenshot attempt.
