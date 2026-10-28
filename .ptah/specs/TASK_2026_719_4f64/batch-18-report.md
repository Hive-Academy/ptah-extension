## Backend implementation — `TASK_2026_719_4f64`, batch 18 (+ 18b)

**Verdict**: complete. A named account is allowed for `cli: 'claude'` only; every other CLI still refuses it. No tool or help text says "release" any more. Over the 8 changed files: tsc (lib + spec) exit 0, eslint 0 errors, prettier clean, and the scoped jest run passes 62/62 suites and 2511/2511 tests.

**Tasks completed**:
- Task 18.1: schema and namespace builder text.
- Batch 18b, approved by the coordinator: the surface-parity spec and the two copy files.

**Files** (root `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/vscode-lm-tools/src/lib/code-execution/`):

Batch 18:

- MODIFIED `mcp-core/agent-spawn-args.schema.ts`
  - `:26-40` (doc comment): the release-held (D7) bullet is gone. Ambient and omitted keep the existing login. A named selection on a fresh `claude` spawn is admitted by the runtime (`AgentProcessManager`, B14), and the runtime refuses the spawn when it cannot prove the account.
  - `:51-53`: a named selection is refused only when it comes with a non-empty resume id. The "keeps the account stored" text is unchanged.
  - `:54-55` is the new text: `// Ambient, omitted, or named on a fresh claude spawn: the runtime admits it.` followed by `return undefined;`.
  - Unchanged: the claude-only check (`:48-50`) and the Zod boundary (`ProviderAccountSelectionSchema` strict + `superRefine`, `:107-123`).
- MODIFIED `namespace-builders/agent-namespace.builder.ts`
  - `:184-191`: the `assertAccountSelection` doc names the accepted selections: ambient, omitted, or named on a fresh spawn.
  - `:457-462`: the forward comment says the same.
  - `:210`: formatting only (prettier collapsed the `throw`).
  - The boundary still parses `unknown` with `readProviderAccountSelectionField`.
- MODIFIED `mcp-core/agent-spawn-args.schema.spec.ts`
  - Header: the release wording is removed.
  - New: "accepts a named account on a fresh claude spawn and carries it through", including a JSON round-trip.
  - New: "refuses a named account for cli %s" (every non-claude CLI).
  - New: "refuses a named account on a Ptah CLI agent or an auto-detected lane".
  - The shared-rule test now expects:

    | Input | Result |
    | --- | --- |
    | named, fresh spawn | `undefined` |
    | named, empty resume id | `undefined` |
    | named, real resume id | "keeps the account stored" |
    | named on codex | "applies only to cli claude" |

  - The description pin now checks `only with cli "claude"` and `"kind":"named"`. It also checks that the text does not match `/profile-\d|@|[/\\]/` or `/release/i`.
- MODIFIED `mcp-core/agent-spawn-accounts.spec.ts`
  - The release-held test now expects a named claude selection to reach the process manager, over HTTP and stdio.
  - New: "refuses a named selection on cli %s before spawn" (`ORIGINAL_SEVEN`).
  - The resume refusal test is unchanged.
- MODIFIED `namespace-builders/agent-namespace.builder.spec.ts`
  - Header: the release wording is removed.
  - The release-held test now expects "forwards a named claude account on a fresh spawn".
  - New: "refuses a named account for %s": codex, an auto-detected lane, and claude with a `ptahCliId`.

Batch 18b:

- MODIFIED `mcp-core/agent-spawn-surface-parity.spec.ts`
  - The forward `it.each` (`:194-213`) gains a `named` case `{kind:'named',profileId:'profile-0001'}` for `cli: 'claude'`. HTTP and stdio must forward the same request.
  - The refusal `it.each` drops "a named claude selection" and gains "a named selection on another CLI" (`cli: 'codex'`).
  - "a named claude selection on resume" stays a refusal.
- MODIFIED `mcp-core/tool-description.builder.ts:731-738`
  - The `accountSelection` description now reads: `{"kind":"named","profileId":"<id>"}` runs a fresh claude lane on that named Claude account; the spawn is refused when the account cannot be proved. A resume never takes a named account: it keeps the account stored with its session. Takes no path, environment, token or owner.
- MODIFIED `namespace-builders/system-namespace.builders.ts:486-489`
  - The `ptah.agent.spawn` help now reads: a named account runs a fresh claude lane on that account (refused when the account cannot be proved), and a resume keeps the account stored with its session.

**Specs that pin the changed copy or member** (rule 5):
- `agentSpawnAccountRefusal`: the three Batch 18 specs and `agent-spawn-surface-parity.spec.ts`, all updated as listed above.
- `tool-description.builder.ts` accountSelection text: only `agent-spawn-args.schema.spec.ts` ("advertises accountSelection…") pins it, and it was updated. `tool-description.builder.spec.ts` has no pin on it; a grep for `accountSelection`, "refused before spawn" and "in this release" found nothing.
- `system-namespace.builders.ts` help text: `system-namespace.builders.spec.ts:458` pins only the type signature line `accountSelection?: { kind: 'omitted'|'ambient'|'named', profileId?: string }`. That line is unchanged, so the spec was not edited.
- No ambient-path pin changed.

**Acceptance evidence**

| Criterion | Evidence |
| --- | --- |
| Named allowed for `cli: 'claude'` only | schema `:48-55`; the named forward tests in the schema, accounts, builder and parity specs |
| Other CLIs keep refusing | schema spec "refuses a named account for cli %s"; accounts spec `ORIGINAL_SEVEN` refusal; builder spec "refuses a named account for %s"; parity "a named selection on another CLI" |
| New text at ~:55 | schema `:54-55` |
| Namespace builder text updated | `agent-namespace.builder.ts:184-191, :457-462`; `system-namespace.builders.ts:486-489` |
| No "release" hold wording | none of the edited specs pins "release"; the tool description is pinned with `not.toMatch(/release/i)`; a grep finds no "in this release" or "refused before spawn" left in vscode-lm-tools |
| Zod still validates at the boundary | schema `:107-123` unchanged; the "rejects %s" cases pass (null, path, env, token, owner, malformed id, named without id) |
| No profile id, email or path in tool text | the new copy uses the placeholder `<id>` only; pin `not.toMatch(/profile-\d|@|[/\\]/)` |

**Stack observed**:
- Zod strict schema with `superRefine` (`agent-spawn-args.schema.ts`).
- The shared reader `readProviderAccountSelectionField` from `@ptah-extension/shared/schemas` at the `execute_code` boundary.
- Jest, with `reflect-metadata` imported first in `agent-spawn-accounts.spec.ts:14`.
- No DI changes.

**Verification** (run from the worktree, over all 8 files):
- `npx prettier --check`: all files formatted.
- `npx eslint <8 files>`: exit 0. 0 errors and 3 warnings, none of them on changed lines:
  - `tool-description.builder.ts:825` max-lines, 1759 lines (the file was already that long);
  - `system-namespace.builders.ts:697,699` preserve-caught-error.
- `npx tsc --noEmit -p libs/backend/vscode-lm-tools/tsconfig.lib.json`: exit 0.
- `npx tsc --noEmit -p libs/backend/vscode-lm-tools/tsconfig.spec.json`: exit 0.
- `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts …/code-execution/mcp-core …/code-execution/namespace-builders --maxWorkers=2`: **Test Suites 62 passed / 62; Tests 2511 passed / 2511.** This run includes `tool-description.builder.spec.ts` and `system-namespace.builders.spec.ts`.
- `ptah_get_diagnostics`: not run; the scoped tsc and eslint runs cover the same check.

**Plan deviations**: Batch 18 needed three more files than the plan listed: the parity spec and two copy files. The coordinator approved them as Batch 18b.

## Decisions

- **A named selection with a resume id is still refused at the boundary.**
  - Options: (a) keep the refusal; (b) forward it to the runtime. D27 notes the runtime forwards an explicit named selection on resume.
  - Evidence: plan lines 856-857 cover fresh `claude` spawns only. The published copy says a resume keeps the account stored with its session. The parity spec keeps the resume refusal.
  - Chosen: (a), the smaller change.
  - Reversible: delete the `resumeSessionId` branch at schema `:51-53` and update the copy.

**Out-of-scope observations**: none.
