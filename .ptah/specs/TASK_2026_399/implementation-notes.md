## Git history finding

`git log -L` and `git blame` assign the canned resume prompt to commit
`2b537f44c02e6bea7b1ce4618c8176c8ebdbeb8f`, whose message is
`"chore(release): extension v0.2.32 (#290)"`. The file was introduced in that
release commit with the substitution already present; neither the commit
message nor the line history gives a behavioral reason for replacing a
non-empty caller-provided task. Commit `e2986660c6` later moved the code into
`cli-agent-runtime` without changing the substitution. The history therefore
does not refute the planned fix.

## Changes

- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:684` — pass `task` directly to `createPromptMailbox`, removing the resume-only canned prompt and its now-unused local variables.
- `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.ts:102` — render the follow-up input when the agent supports in-process continuation or has a CLI session ID that can be resumed.
- `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.ts:135` — classify resume-only and expired-continuation agents as resuming instead.
- `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.ts:226` — route `unsupported`, as well as `not_found` and `released`, through the existing session-resume fallback.

## resumesInstead

The predicate is:

```ts
!!this.agent().cliSessionId &&
  (this.agent().continuationExpired === true ||
    this.agent().supportsContinuation !== true)
```

A session ID is mandatory because it is the actual resume path. With one
present, an expired continuation record must resume, as before, and an agent
that never advertised in-process continuation must also resume. Agents that do
advertise continuation and have not expired still use the direct continuation
path. This also makes the subtitle accurate and lets resume-only adapters skip
a guaranteed `unsupported` response.

## Tests needing update

None. No existing test pins the canned resume prompt. The existing visibility
tests at
`libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.spec.ts:52`
and `:57` use agents without a `cliSessionId`, so they still correctly assert
that no input is rendered.

## Suite result

Command:

```text
npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/chat --skip-nx-cache
```

Header:

```text
NX   Running target test for 2 projects:
```

- `@ptah-extension/cli-agent-runtime`: 51 suites passed; 661 tests passed, 1 skipped, 662 total.
- `@ptah-extension/chat`: 64 suites passed; 1,010 tests passed, 2 skipped, 1,012 total.
- Combined: 115 suites passed; 1,671 tests passed, 3 skipped, 1,674 total.
- Failures: None. The command exited with code 0.
