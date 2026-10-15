# Mode 2 — Wave 2b (R9e, R9n) — TASK_2026_629_c0b3

Team-leader verify-and-commit for batches R9e and R9n (chat project only). Base HEAD df3b88e8d.
No canvas file was staged or touched. Wave 3 lanes (R9p, R9j, R9q) were running at the same time.

## Verification on disk

- R9e (`agent-monitor-panel.component.ts`): `strictSessionScope = !!inject(SESSION_CONTEXT, { optional: true })`.
  A scoped host with a null or empty `sessionId` returns `[]` from `effectiveAgents`,
  `effectiveWorkflowSubagents` and `effectiveSessionSubagents`. Its retained selection is not visible, so
  `effectivePermissions` is empty too. `onClearCompleted` returns before the global `clearCompleted()`.
  A resolved scoped host filters strictly with `parentSessionId === sid`. A host without `SESSION_CONTEXT`
  keeps the tolerant branches unchanged. This matches review finding 1.
- R9e finding 2 (dock badge, count and auto-open) is not in this batch. It moved to R9h (decision 89) and
  stays latent while `HIDE_AGENT_SIDEBAR: true` remains.
- R9n, Escape guard: `single-chat-subagent-view.component.ts` `onEscape` ignores an Escape that is
  `defaultPrevented` or comes from an `input`, `textarea`, `select` or contenteditable element.
- R9n, auto-close: `chat-transcript.component.ts:801-822` `syncOpenSubagent`.
  - A tab or session switch discards the view.
  - An agent that disappears from an active conversation closes the view like Back and posts an
    announcement.
  - A hidden transcript keeps its frozen view.
- R9n, overlay and inert: both derive from `subagentOpen = openSubagent() !== null`
  (`chat-transcript.component.ts:720`, `.html:12`, `.html:175`).
- R9n, provider: `SESSION_CARD_ACTIONS` is provided on the transcript. It returns the `skipSelf` parent
  when one exists, otherwise the local in-place handler. `HIDE_AGENT_SIDEBAR` is not set anywhere.
- R9n, harness: `testing/transcript-spec-harness.ts` adds one stub input, `agentTileMode`
  (decision 87).

## Checks (serial, lock runner, from W)

| Label | Command | Result |
| --- | --- | --- |
| m2w2b-chat-full | `nx test @ptah-extension/chat --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | Test Suites: 1 failed, 201 passed, 202 total; Tests: 1 failed, 2 skipped, 3691 passed |
| m2w2b-chat-keepalive | same, `--testFile=chat-view.keepalive.spec.ts`, after the fix | Test Suites: 1 passed; Tests: 1 passed, 1 total |
| m2w2b-chat-tc | `nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache` | Successfully ran target typecheck (exit 0) |
| m2w2b-chat-lint | `nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache` | 0 errors, 40 warnings (exit 0) |

### The one FULL failure

- Spec: `libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts`.
- Error: NG0303, "Can't bind to 'agentTileMode' since it isn't a known property of 'ptah-message-bubble'".
- Cause: R9n binds `[agentTileMode]="true"` in the transcript template. The spec's local `MessageBubbleStub`
  (around line 81) did not declare that input.
- Fix: the team-leader added `@Input() agentTileMode = false;` to that stub. This is a one-line test-only
  change and the same fix decision 87 made in the harness. The file is committed with R9n and listed in
  the R9n files in `batches-rail-r9.md`.
- The other 201 suites passed on the first run. That includes every transcript spec that uses the harness:
  ptah-ui, change-set, older-history, replay-mount, replay-motion and transcript-render-window.

### Lint warnings in batch files

These are warnings only, and none is new in kind:

- `max-lines` on `agent-monitor-panel.component.ts` (1081 lines). It was already 1060 at HEAD.
- `max-lines` on `chat-transcript.component.ts` (839 lines). It was already 1021 raw lines at HEAD, so it was
  over the limit before.
- An unused `h` at `chat-transcript.component.spec.ts:469`. It predates this wave (commit 3b10d7420).
- Non-null assertions in `chat-view.keepalive.spec.ts` that were already there.

## Batches

| Batch | Verdict | Commit |
| --- | --- | --- |
| R9e | COMPLETE. Review APPROVE-WITH-FIXES 6/10: finding 1 fixed, finding 2 moved to R9h | df4e9977b `fix(chat): batch R9e - strict Agents scope, tolerant main panel` |
| R9n | COMPLETE. Review REVISE 6/10: both Serious findings fixed and verified on disk | 7ef8d53d3 `feat(chat): batch R9n - single-chat sub-agent full view` |

Docs commit: see the `docs(canvas)` commit that records this report. Its SHA is given in the team-leader
reply, because a commit cannot contain its own hash.

`batches-rail-r9.md` now reads "Complete: 9/24". R9e and R9n are marked COMPLETE with their SHAs.

### Next action: Wave 2 is fully committed (R9o, R9i, R9e, R9n). Run Mode 2 for Wave 3 (R9p, R9j, R9q) once those lanes return.
