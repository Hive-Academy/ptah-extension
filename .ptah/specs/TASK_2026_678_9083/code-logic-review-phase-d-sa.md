# Code Logic Review - TASK_2026_678_9083 - Phase D fix S-A

## Summary

| Metric | Value |
| --- | --- |
| Range | `c005c7a7a^..c005c7a7a` |
| Reviewer | Anthropic (in-process) |
| Implementer | codex |
| Overall score | 5/10 |
| S-A status | PARTIAL (persona/format CLOSED; guard over-reaches and introduces new defects) |
| Blocking | 0 |
| Serious | 3 |
| Moderate | 3 |
| Minor | 3 |

Scope read in full: the commit diff (persona, index export, controller, both specs, parser), the controller file
after the commit, `command-pending-input.component.ts`, `command-center-page.component.ts:127-139`,
`command-voice-loop.ts:349-381`, `command-center-tribunal.transport.ts:77-95`, the parser, A1.1-A1.3 and the
implementer report. Nothing was executed (memory-safe rule). The orchestrator's green runs are not evidence for the
defects below: no spec covers an ordinary Confirm question outside a Tribunal request, a typed "yes" in the card, or a
second question after the Tribunal request finished.

## S-A status

### Check 1 - persona states a parseable format: CLOSED

- Exact tag: persona interpolates `TRIBUNAL_ROSTER_PROPOSAL_TAG` (`libs/frontend/chat-state/src/lib/command-center-persona.ts:7`)
  and the parser regex is built from the same constant (`tribunal-roster-proposal.ts:107-109`). The tag moved to
  `chat-state` and `command-center` imports it (`tribunal-roster-proposal.ts:2`, controller `:11`); `chat-state` imports
  nothing from `command-center` (grep over `chat-state/src` is empty). No cycle, no drift.
- Required keys: the persona names `proposalId, nonce, rootSessionId, move, options, objective, rounds, lanes` and
  `laneId, family, displayName, cli, role` (all keys of the zod schema at `tribunal-roster-proposal.ts:14-31`; `model` is
  optional and omitted from the prose, harmless).
- Allowed values: moves, `cli` (`SYSTEM_CLI_TYPES` plus `ptah-cli`, same expression as the schema) and roles are listed;
  `options` is `["Decline","Confirm"]`, so `options[0] === 'Decline'` (`:122`) holds. Rounds: 1 except crucible, matching `:125`.
- Length: 2,355 characters against the 16,384 RPC bound (implementer figure; the example and lists are fixed text, so the
  length is bounded and the existing persona bound spec still applies).
- Contract spec (`tribunal-roster-proposal.contract.spec.ts:15`) parses the exported example with the real
  `parseRosterProposal` and asserts the persona contains that exact string, so the example cannot drift from the parser.
  The second test (`:32`) compares the moves, CLI and role lists to `TRIBUNAL_MOVES`, `SYSTEM_CLI_TYPES`, `RELAY_ROLES`,
  `CRUCIBLE_ROLES`, so an enum change fails the build. The key-name `toContain` checks are weak (see Minor 1) but the
  parse test backs them. The persona itself is not parsed and the model's output is of course not tested; that is the
  inherent limit.

### Check 2 - no affirmative reaches the model while a Tribunal request is outstanding: PARTIAL

- Card buttons: with a matching `expectedRequest`, an untagged question with a `/confirm/i` option on the marked tab is
  removed from `ordinaryQuestion` (`controller:102-118`), auto-answered `Decline` once (`:115-132`, via
  `transport.answer`, which additionally rewrites any `\bconfirm\b` answer to `Decline`, `transport.ts:89`), and the
  card is not rendered. Click path closed for that case.
- Free-text box and speech: the card is hidden, and `answerOrdinaryQuestion` (`:403-417`) rejects `^(confirm|yes|approve|go ahead)`
  for any question with a confirm option. Voice returns false, and the voice loop shows "Answer the pending question on
  the page" and stays inside the question branch (`command-voice-loop.ts:362-372`), so there is no fall-through to
  `sendTranscript`. Decline still works (`answerOrdinaryQuestion(..., 'Decline')` returns true; spec `:513`).
- Residuals: label-based heuristic (Moderate 1), and the guard is not scoped to "a request is outstanding" (Serious 1-2).
  Decline path itself is sound.

### Check 3 - new defects: see below.

## New findings

### Serious

**N-1. The answer guard and the choice filter apply to every ordinary question, not only while a Tribunal request is
outstanding; an ordinary question with a Confirm option can no longer be answered affirmatively.**

- Files: `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:119-128` (`ordinaryChoices`),
  `:403-417` (`answerOrdinaryQuestion`), spec `command-center-page.controller.spec.ts:513` (which asserts this behaviour
  with no `sendCommand`, i.e. no Tribunal request).
- Scenario: the model asks a normal AskUserQuestion, "Delete the stale branch?" with options "Confirm deletion" and
  "Cancel", with no Tribunal request in the session (`expectedRequest` is null). `hasConfirm` is true, so the
  "Confirm deletion" button is filtered out (`:121-126`), leaving Cancel only. Typed "yes", "yes, go ahead" or voice
  "approve" returns false (`:407-411`). The question is unanswerable except negatively. The task asked for the block only
  "while a Tribunal request is outstanding" (review item 2, and the original fix text, step 3: "for such a question").
- Impact: a functional regression on a plausible path of the main chat surface of the Command Center. The model waits on
  a question that cannot be answered affirmatively; the user has to cancel or abandon the turn.
- Fix: gate both `ordinaryChoices` and `answerOrdinaryQuestion` on the same predicate used by `invalidRosterQuestion`
  (an outstanding, current-session `expectedRequest`) and apply it to a question only in that state. Add a spec with an
  ordinary Confirm question and no `sendCommand` that asserts the Confirm button and a typed "yes" both work.

**N-2. `expectedRequest` is never cleared, so after one Tribunal request every later "Confirm" question in the same
session is auto-declined as an "invalid Tribunal proposal".**

- Files: `controller:57-60` (declared), `:251` (the only write; `grep` finds no `.set(null)` in `confirmProposal`,
  `declineProposal`, `timeoutProposal`, `exit`), consumed by `invalidRosterQuestion` at `:81-101`.
- Scenario: the user runs a council, confirms (or declines or times out). Later in the same session, in the launch turn or
  in ordinary work, the model asks "Overwrite config? Cancel / Confirm". `expected.rootSessionId === store.sessionId()`
  still holds, so the effect at `:115-132` answers `Decline` to the model and shows the toast "Invalid Tribunal
  proposal. It was declined." The user never sees the question.
- Impact: silent wrong answer to the model (it receives a "Decline" the user never gave) plus a misleading toast. This
  is the "ordinary question wrongly blocked" failure in its worst form: the user is not even asked. It also fires during
  the page-controlled launch turn, where a follow-up question is plausible.
- Fix: clear (or mark consumed) `expectedRequest` when the proposal resolves (confirm result, decline, timeout, invalid
  decline, `exit`) and when the discovery turn ends (terminal pulse for the root tab). Alternatively store a `resolved`
  flag. Add a spec: send a council request, resolve it, then offer an ordinary Confirm question and assert it is shown and
  never auto-answered.

**N-3. A blocked card answer permanently disables the card with no feedback.**

- Files: `command-pending-input.component.ts:208-217` (`respond` adds the id to `respondedIds` before emitting and never
  learns the result), `command-center-page.component.ts:134-138` (the handler ignores the boolean from
  `answerOrdinaryQuestion`), template `:95,112,118`.
- Scenario (reachable through N-1, or via the tab/session mismatch in Moderate 1): the user types "yes" into the answer
  box on an ordinary question that has a Confirm option and presses "Send answer". The controller returns false
  (`:407-411`), but `respondedIds` already contains the id, so the choice buttons, the input and "Send answer" are all
  disabled. Decline can no longer be chosen either. No toast, nothing sent.
- Impact: dead card and a stalled turn; before this commit the false path was a rare stale-id case, the commit adds a
  guard that a normal keystroke can trip.
- Fix: have `respond` take the result (make the output callback return, or have the page report a rejection through the
  store toast and re-enable), or keep the id in `respondedIds` only after `answerOrdinaryQuestion` returns true. At minimum
  toast "That answer is not accepted here. Choose Decline." on a rejected answer. Add a component spec for the false path.

### Moderate

**M-1. The invalid-proposal detector is a label heuristic with narrower scope than `ordinaryQuestion`.**
`invalidRosterQuestion` matches only `request.tabId === tabId` (`controller:91`) while `ordinaryQuestion` also matches
`request.sessionId === sessionId` (`:110`). A question carrying only the session id (or an untagged proposal with
options such as "Approve", "Proceed", "Launch council", "Yes") is not intercepted; it shows as an ordinary question with
the card, and the guard at `:407-411` only trips when some option contains "confirm", and only for four answer prefixes
("sure", "ok", "do it", "proceed" pass). The persona makes "Confirm" the second option, so the common case is covered, but
the claim "no affirmative answer can reach the model" is not met for deviating model output. Fix: while a request is
outstanding, treat every untagged question on the root tab or session as invalid (the discovery turn permits only the
tagged proposal), instead of keying on a label.

**M-2. The auto-Decline is fire-and-forget.** The effect (`:115-132`) adds the id to `invalidRosterQuestionIds` and calls
`transport.answer(...)` without reading its boolean (`transport.ts:77-95` returns false without a tab id and after a
caught failure). On failure the question stays hidden (the computed still excludes it), is never retried, and the model
turn waits forever while the toast claims "It was declined." Fix: add the id to the set only after `answer` returns true;
otherwise show the failure and keep it retryable.

**M-3. Regex false positives.** `/^(confirm|yes|approve|go ahead)/i` has no word boundary (`:125`, `:409`): "yesterday's
build", "approved-branch", "confirmation-service", "Yes-man" are filtered or blocked on a question that has a confirm
option. Use `\b` and, ideally, the exact-answer forms.

### Minor

1. The contract spec's key-name `toContain` assertions (`contract.spec.ts:48-62`) are trivially satisfied by the example
   string itself; they would not notice a key dropped from the prose list. Compare the prose key list as its own constant.
2. Persona wording keeps the older sentence "containing the nonce and root ID ..., mode, lane IDs" next to the new "move"
   key (`command-center-persona.ts`, persona line 2), a "mode" versus "move" ambiguity. It also does not say which roles belong to
   relay or crucible, nor the crucible round cap, so a model can produce an unlaunchable roster (fails safe: invalid card,
   Decline).
3. The typed command box (`sendCommand`, `controller:229-257`) is not guarded: a typed "Confirm" while a question is
   outstanding goes to `coordinator.send`. Pre-existing and a different surface from A1.1's "answer", noted for
   completeness.

## Decisions

- Treated S-A as split: the format half (persona, shared tag, contract) is closed; the guard half is judged by whether
  it is correctly scoped. It is not, so S-A is PARTIAL. Evidence: controller `:119-128`, `:403-417` are unconditional on
  the Tribunal state. Reversible.
- Did not count the persona's hard-coded move/role lists in `chat-state` as a finding: the implementer's decision
  (circular lint rule) is sound and the contract spec fails on drift.
- Did not require a `voice-loop` change: voice goes through the same controller callback and the loop's question branch
  does not fall through to `sendTranscript` on false (`command-voice-loop.ts:362-372`).
- Scored 5/10: the format fix is clean and well tested, but the guard introduces two likely-path regressions (N-1, N-2)
  and a dead-card path (N-3) that no existing spec covers.

Verdict: NEEDS_REVISION
