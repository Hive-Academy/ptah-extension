# Fix round for the B1-B5 code-logic review (`TASK_2026_655_handoff`)

Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-session-handoff-skill`
(branch `feat/session-handoff-skill`). Review: `code-logic-review-B1-B5.md`.

Status: all six findings fixed. Commit `cd4abbdc2`, "fix(cli-agent-runtime,vscode): harden session
handoff guard and skill". Not pushed.

Paths below are relative to the worktree. `svc` means
`libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff.service.ts` and `spec`
means its `.spec.ts`. `SKILL.md` means
`apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/session-handoff/SKILL.md`.

## 1. BLOCKING: in-flight guard keyed by the raw caller

- Change: `svc:163-179`. After the record is resolved, `const key = record.tabId` keys
  `findHandedOff`, the `inFlight` check and the reservation. The success history was already
  `remember(record.tabId, ...)`.
- Test: `spec:458` "already-handed-off: a concurrent call by the SDK id while the tab id call
  starts". The first call uses `CALLER` (the tab id) with a deferred host promise. The second
  call uses `CALLER_SDK` while the first is pending and is refused with "already in progress".
  The host is called once.

## 2. SERIOUS: a host start that never settles

- Change: `svc:53` adds `SESSION_HANDOFF_START_TIMEOUT_MS = 30_000`. `svc:58` adds
  `SESSION_HANDOFF_START_TIMEOUT_DETAIL`, which says the session "may still open late" and asks
  the user to look in the sessions panel. In `svc:180-203`, `start()` is wrapped into an
  `attempt` that never rejects, and its `.finally` releases `inFlight`. The attempt races
  `withDeadline` (`svc:401`). The timer is always cleared. On timeout the service returns
  `session-start-failed` with the fixed detail. The reservation stays until the late start
  settles. A late success runs the normal success path in `start()`, so `remember` and the log
  both happen. The header comment (`svc:11-14`) now describes the timer.
- Tests (`spec:500`, describe "a host start that does not settle in time"). These use Jest fake
  timers with `setImmediate`/`nextTick` left real.
  - `spec:531`: the deadline returns the timeout refusal, and `jest.getTimerCount()` is 0.
  - `spec:547`: during the late window, a retry by SDK id is refused as in progress. After a
    late success, the next call is refused with "already handed off to tab <late tab>". The host
    is called once.
  - `spec:571`: after a late failure, the caller can hand off again.

## 3. SERIOUS: host error text could carry the prompt

- Change: host throw (`svc:241-251`) and `started: false` (`svc:252-259`) now return the fixed
  `SESSION_HANDOFF_START_FAILED_DETAIL` (`svc:56`). Logs carry only `errorKind(error)`
  (`svc:425`), which is the name plus a string or number `code` and never the message. For
  `started: false`, a fixed line is logged and `outcome.error` is dropped. The outer
  unexpected-fault catch (`svc:113-120`) and the `start()` fault catch (`svc:183-190`) follow
  the same rule.
- Test: `spec:381`, `it.each`. The host throws a `TypeError` whose message contains `PROMPT`,
  or it reports `started: false` with `PROMPT` in its error. The test asserts the exact fixed
  result, that `JSON.stringify(result)` has no prompt, and that no `appendLine` call has the
  prompt or the message text. The two older failure tests now expect the fixed detail.

## 4. MODERATE: a throwing logger broke never-throw

- Change: `svc:389-397`. `log()` wraps `appendLine` in `try/catch` with a degradation-audit
  comment. `refuse()` and every log go through it, so the result already decided is returned.
- Tests (describe "an output channel that throws", `spec:585`): `spec:590` checks that a
  successful start still resolves `ok: true, tabOpened: true`. `spec:601` checks that a refusal
  still resolves `handoff-file-missing`.

## 5. MODERATE: the skill ignored `tabOpened: false`

- Change: `SKILL.md:51-57` now branches on `tabOpened`.
  - `true`: the skill reports that the new session is open and asks the user to close this one.
  - `false`: the skill says the session started but no tab appeared. The user can find it in
    the session list in the Ptah sessions panel. The skill asks them to close this one only
    after they have found it.
- `SKILL.md:64-66` (Fallback) adds the late-open refusal: the user looks in the sessions panel
  first and pastes the prompt only if the session does not appear.

## 6. MODERATE: the skill could wait forever

- Change: `SKILL.md:15-23`.
  - Every subagent, lane and child session is checked once.
  - The skill waits for the rest at most 5 minutes in total, and never indefinitely.
  - Record and continue: work waiting on a permission or other outside input (for example
    `awaiting-permission`), or still unsettled after the wait, is recorded under
    **Background work** in HANDOFF.md with its id, state and how to check it. Then the skill
    goes on.

Mirror and manifest: `.claude/skills/session-handoff/SKILL.md` was copied from the bundled
skill (`cmp` clean). `npm run manifest:generate` was run, as in B5, and `content-manifest.json`
changed its hash and stayed at 231 files.

## Checks (cwd = worktree)

- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts <spec> --coverage=false --maxWorkers=2`:
  1 suite, 34 tests passed. With `--detectOpenHandles` it reported no open handles.
- `npx nx test @ptah-extension/cli-agent-runtime --parallel=1`: 105 of 106 suites passed. The
  one failure was `claude-approval.reader.spec.ts`, with 3 tests timing out after 37 s. This is
  the known flake. Run alone it passed 21 of 21. The other 2245 tests passed and 1 was skipped.
- `npx nx typecheck @ptah-extension/cli-agent-runtime --parallel=1`: Successfully ran target.
- `npx nx lint @ptah-extension/cli-agent-runtime --parallel=1`: Successfully ran target, with
  0 errors and 46 warnings. All warnings are in files this round did not touch. `npx eslint` on
  the two changed files was clean.
- `npm run manifest:check`: "content-manifest.json is up to date (sha256:ff0c4a98..., 231 files)".
- The 3 skill-scanning specs from B5 in vscode-lm-tools (`vendor-roster-drift`,
  `lane-rule-single-home`, `skill-description-shape`) passed: 3 suites, 71 tests.
- rpc-handlers was not typechecked. B2 owns it.

## Decisions

- The timeout uses a module constant and Jest fake timers, not a constructor parameter. A
  non-injected constructor parameter is awkward under tsyringe, and fake timers test the real
  constant.
- The deadline covers the whole `start()`, not only the host call. The reservation is released
  in a `.finally` on that attempt, so the guard always reflects whether a start can still
  create a session. A late success records history through the normal success path, with no
  separate late-reconciliation code.
- `started: false` error text is dropped completely, not logged, because it is host text that
  could quote the prompt. The host side owns its own diagnostics.
- The outer unexpected-fault catch also uses a fixed detail and logs `errorKind`. This keeps one
  rule for every error that may hold request data. Path-based details (handoff file, workspace)
  are unchanged because they cannot hold the prompt.
- The skill's bounded wait is "at most 5 minutes in total". The review asked for a short bounded
  wait and gave no number.
- Unfinished lanes and child sessions are recorded and left running, not stopped. Stopping one
  would lose its work, and the next session can check it from HANDOFF.md.
- The commit scopes `cli-agent-runtime` and `vscode` were both checked in `.commitlintrc.json`.
