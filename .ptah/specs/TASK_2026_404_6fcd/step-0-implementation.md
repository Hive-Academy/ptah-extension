# Step 0 implementation — session identity revision

## Outcome

Revised TASK_2026_404_6fcd step 0 in place after both logic-review rounds.
The approved persisted-origin mechanism and Nx boundary remain unchanged. No
canvas code was touched, and no commit or push was made.

The current behavior is:

- A recognized untouched default tab derives one bounded title from its first
  user message and persists `titleOrigin: 'auto'` atomically with that message.
- User/custom and historical names remain authoritative for both the visible
  tab and the `chat:start.name` RPC field.
- Legacy tabs migrate to `default` only when they have no session, no messages,
  and both name/title are recognized defaults (`New Chat` or the timestamp
  format). Unknown legacy names migrate conservatively to `history`.
- Markdown cleanup preserves TypeScript generics, comparison operators, and
  underscores inside identifiers. Paired `__emphasis__` markers are removed.
- Non-empty content that cleans to an empty string, such as `***`, uses the
  normalized bounded raw content as its title. This gives the visible tab and
  backend the same stable name even when the first `chat:start` fails and the
  user retries.
- Session colors continue to use the existing UI-side hash, and workspace
  labels remain a pure path derivation. Their visible consumers are later-step
  scope.

## Second logic-review fixes

| Finding                                                             | Implementation                                                                                                                                                                                                                                                                       | Regression evidence                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Legacy custom unsent names were classified as default            | `legacyTitleOrigin` now requires no session/messages and recognized default values for both `name` and `title`. A custom legacy value becomes `history`, which both sender and tab-state ownership rules preserve.                                                                   | `message-sender.session-identity.spec.ts` writes a real version-2 localStorage blob named `Release investigation`, restores it through the real workspace partition and tab manager, sends through the real sender, and asserts the RPC and visible tab both retain the name. |
| 2. HTML-shaped regex deleted TypeScript generics                    | Removed HTML-like stripping entirely. Session titles are text values, so angle-bracket syntax is preserved rather than guessed to be HTML.                                                                                                                                           | Pure regressions cover `Fix Map<string, TabState>`, `Keep <T extends Node> intact`, and `if a < b and b > c`.                                                                                                                                                                 |
| 3. Markdown-only first send diverged after failure/retry            | `deriveSessionTitle` now falls back to normalized, input-bounded raw content when cleanup produces nothing. Both sender and tab state already use this one derivation function; the first `***` attempt therefore stamps and sends `***`, and retry reuses the persisted auto title. | A real sender + real tab-manager integration test rejects the first `chat:start`, retries with different content, and asserts both RPC names and the visible title remain `***`.                                                                                              |
| 4. Paired underscores were left behind and the predicate was public | Added boundary-aware removal for paired `__...__` emphasis while leaving `snake_case` intact. Removed `isGenuinelyNewFirstMessage` from the package barrel; it remains an internal pure function with direct unit coverage.                                                          | `Fix __parser__ today for user_id` derives to `Fix parser today for user_id`; `user_id` and `file_reader` remain unchanged.                                                                                                                                                   |

## Earlier review-item mapping retained

### Correctness

| Item | Current resolution                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1   | Legacy restore distinguishes recognized untouched defaults from custom names, sessions, and transcripts.                                                                              |
| C2   | Sender uses the current tab name for every non-`default` origin. The real persistence/sender integration covers the legacy custom case.                                               |
| C3   | Input is bounded before regex work and truncation cuts an array of Unicode code points; emoji tests reject lone surrogates.                                                           |
| C4   | Angle-bracket content is never treated as HTML, covering comparisons and TypeScript generics without another sanitizer.                                                               |
| C5   | Non-empty markdown-only input gets a bounded raw fallback and stamps a real auto title. Truly empty input does not stamp `auto`; replay remains blocked by the existing user message. |
| C6   | `duplicateTab` copies the source `titleOrigin`.                                                                                                                                       |
| C7   | Regex work is limited to the first 500 UTF-16 code units, a trailing high surrogate is removed before cleanup, and identifier underscores are preserved.                              |

### Structure

| Item | Current resolution                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| S1   | `applyNewConversationStreaming` no longer accepts/discards a name. `autoName` remains live only for `chat:start`.                             |
| S2   | `TitleOrigin` is a named exported union used by `TabState`, `TabManagerService`, and the app shell.                                           |
| S3   | A cross-library chat spec pins `DEFAULT_SESSION_NAME_PATTERN` to `defaultSessionName(new Date())`.                                            |
| S4   | Removed unused `TabLookupResult.workspaceLabel` and session-color aliases. Kept `workspaceLabelFromPath` and the UI-boundary color rationale. |
| S5   | Removed both redundant active-tab lookup fallbacks.                                                                                           |
| S6   | The first-message predicate is a pure internal function with direct coverage and is no longer in the public barrel.                           |
| S7   | The draft mutator follows the same ownership rule: only `default` may derive, and only a non-empty bounded title stamps `auto`.               |

## Files changed by the combined step-0 revision

- `libs/frontend/chat-types/src/lib/chat-types.ts`
- `libs/frontend/chat-state/src/index.ts`
- `libs/frontend/chat-state/src/lib/session-identity.ts`
- `libs/frontend/chat-state/src/lib/session-identity.spec.ts`
- `libs/frontend/chat-state/src/lib/tab-manager.service.ts`
- `libs/frontend/chat-state/src/lib/tab-manager.intent-mutators.spec.ts`
- `libs/frontend/chat-state/src/lib/tab-manager.lifecycle.spec.ts`
- `libs/frontend/chat-state/src/lib/tab-persistence.ts`
- `libs/frontend/chat/src/lib/services/message-sender.service.ts`
- `libs/frontend/chat/src/lib/services/message-sender.service.spec.ts`
- `libs/frontend/chat/src/lib/services/message-sender.session-identity.spec.ts`
- `libs/frontend/chat/src/lib/services/session-identity.contract.spec.ts`
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`
- `libs/frontend/chat-ui/src/lib/utils/agent-color.utils.ts`
- `.ptah/specs/TASK_2026_404_6fcd/step-0-implementation.md`
- `.ptah/specs/TASK_2026_404_6fcd/agent-output-root.md`

## Fresh verification

All commands below were run from the worktree root with `--skip-nx-cache` after
the second-review changes. No project configuration changed, so `nx reset` was
not run.

### Tests — 3 projects

```text
$ npx nx run-many -t test -p @ptah-extension/chat-state @ptah-extension/chat-ui @ptah-extension/chat --skip-nx-cache

NX   Running target test for 3 projects:
- @ptah-extension/chat-state
- @ptah-extension/chat-ui
- @ptah-extension/chat

@ptah-extension/chat-state
Test Suites: 16 passed, 16 total
Tests:       356 passed, 356 total

@ptah-extension/chat-ui
Test Suites: 25 passed, 25 total
Tests:       152 passed, 152 total

@ptah-extension/chat
Test Suites: 67 passed, 67 total
Tests:       2 skipped, 1033 passed, 1035 total

NX   Successfully ran target test for 3 projects
```

Exit code 0. Node printed repeated warnings that `NO_COLOR` is ignored because
`FORCE_COLOR` is set, followed by the repository's existing outdated AI-agent
configuration notice. No test suite failed.

### Typecheck — 3 projects

```text
$ npx nx run-many -t typecheck -p @ptah-extension/chat-state @ptah-extension/chat-ui @ptah-extension/chat --skip-nx-cache

NX   Running target typecheck for 3 projects:
- @ptah-extension/chat-state
- @ptah-extension/chat-ui
- @ptah-extension/chat

> npx ngc --noEmit --project libs/frontend/chat-state/tsconfig.lib.json
> npx ngc --noEmit --project libs/frontend/chat-ui/tsconfig.lib.json
> npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json

NX   Successfully ran target typecheck for 3 projects
```

Exit code 0. The same `NO_COLOR`/`FORCE_COLOR` and outdated AI-agent notices
were printed.

### Lint — 4 projects

```text
$ npx nx run-many -t lint -p @ptah-extension/chat-state @ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/chat-types --skip-nx-cache

NX   Running target lint for 4 projects:
- @ptah-extension/chat-state
- @ptah-extension/chat-ui
- @ptah-extension/chat
- @ptah-extension/chat-types

@ptah-extension/chat-types: All files pass linting
@ptah-extension/chat-state: 2 problems (0 errors, 2 warnings)
@ptah-extension/chat-ui: 6 problems (0 errors, 6 warnings)
@ptah-extension/chat: 17 problems (0 errors, 17 warnings)

NX   Successfully ran target lint for 4 projects
```

Exit code 0. The warnings are existing max-lines, non-null assertion, unused
declaration, empty-function, and unused-disable warnings. The run was fresh;
none of the four tasks used cached output.

## Remaining gaps

- Stable session color and workspace-label rendering remain explicitly deferred
  to later Track R steps. Step 0 retains the required stable identity and pure
  derivation points without adding unused public aliases or hot-path fields.
- Actual HTML-looking text is intentionally preserved in titles because these
  values are rendered through text bindings. No HTML interpretation or second
  sanitizer was introduced.

No known step-0 correctness gap remains from either logic review. The batch is
ready for the requested independent review.
