# Batch 9 report — TASK_2026_402_a5c7 (Requirement 9)

Executor: `backend-developer`.
Worktree: `D:\projects\ptah-extension\.claude-worktrees\agent-messaging` (branch
`feat/agent-two-way-messaging`, HEAD `b521a92ba` at start). Nothing committed, stashed or
checked out; `npx nx reset` was never run.

Tasks 9.1, 9.2, 9.3 and 9.4 are implemented. The batch touches BOTH name surfaces, and
every change below says which one it is.

## The two surfaces, restated so the next reader cannot confuse them

| | REGISTRY NAME | SESSION TITLE |
| --- | --- | --- |
| Where it lives | `name` / `nameSource` in `~/.claude/sessions/<pid>.json` | the JSONL, surfaced as `SDKSessionInfo.customTitle` |
| Who reads it | a PEER session browsing the registry | a human |
| How it is set | the `--name` extraArg, composed by `buildSessionName` | `Options.title` at spawn |
| Form | slugified | RAW |
| Changeable later | **NO** — fixed at spawn, no documented API | yes — `renameSession(sessionId, title, options?)` |

## Files

### CREATED

- `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\backend\agent-sdk\src\lib\helpers\session-title.service.ts`
  — `SessionTitleService.retitle(sessionId, title)`. **TITLE surface only.** Dynamically
  imports the SDK's `renameSession`, pins `dir` to the session's own workspace, logs and
  swallows every failure. Modelled on `SessionForkService`, the existing precedent for an
  agent-sdk service that calls an SDK session-mutation function.
- `...\libs\backend\agent-sdk\src\lib\helpers\session-title.service.spec.ts` — 7 cases:
  raw title forwarded, `dir` from the session's metadata, `dir` fallback to the active
  workspace, `dir` omitted when neither is known, a rejected `renameSession` swallowed at
  `warn`, a non-`Error` rejection narrowed, a missing SDK export reported not thrown.

### MODIFIED

- `...\libs\shared\src\lib\types\ai-provider.types.ts` — **Task 9.1.** `AISessionConfig`
  gains `readonly sessionName?: string`, documented as the user-facing name, as feeding
  BOTH surfaces, and as optional because a new tab has none yet. The doc explicitly
  forbids substituting `tabId`.
- `...\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts` — **Tasks 9.2
  and 9.3.** `buildExtraArgs` takes `sessionName` and uses it as the `role`
  (REGISTRY surface); `options.title` carries the raw name for a NEW session only
  (TITLE surface).
- `...\libs\backend\agent-sdk\src\lib\helpers\session-name.builder.ts` — **Task 9.4's doc
  half.** The "registry name does not follow a rename" limit is written onto
  `buildSessionName`'s doc comment, plus a note on `SessionNameInput.role` that it may now
  be the user's own name and that `slugify` is the ONE sanitiser.
- `...\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts` — the producer seam (see
  Deviation 1). `startChatSession`'s existing `config.name` is carried onto
  `sessionConfig.sessionName` so the builder can reach both surfaces.
- `...\libs\backend\agent-sdk\src\lib\di\tokens.ts`, `...\di\register.ts`,
  `...\helpers\index.ts`, `...\src\index.ts` — `SDK_SESSION_TITLE_SERVICE` token,
  singleton registration beside `SessionForkService`, barrel exports.
- `...\libs\backend\rpc-handlers\src\lib\handlers\session-rpc.handlers.ts` — **Task 9.4.**
  `session:rename` calls `sessionTitle.retitle(...)` after `metadataStore.rename(...)`.
  The store was NOT touched: it stays a metadata store with no SDK dependency.
- `...\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.spec.ts` — the
  three required 9.2 rows plus three 9.3 rows (see Verification).
- `...\libs\backend\rpc-handlers\src\lib\handlers\session-rpc.handlers.spec.ts` — the
  harness gains the `SessionTitleService` mock; three new `session:rename` cases.

No other file was opened for edit.

## Task 9.1 — `AISessionConfig.sessionName`

Optional, `readonly`, documented. `tabId` was not reused: it is a UUID v4 and identifies
nothing to a human reading a session list.

## Task 9.2 — the registry name uses it

```ts
let composedName = sessionName
  ? buildSessionName({ role: sessionName, workspaceLabel, uniqueSuffix })
  : undefined;
if (sessionName && !composedName) { /* warn */ }
composedName ??= buildSessionName({ role: 'chat', workspaceLabel, uniqueSuffix });
```

- **No new sanitising.** The user's name is handed to `buildSessionName` raw; `slugify`
  there is the only sanitiser and the head cap there is the only cap.
- **The uniqueness suffix stays LAST.** Pinned by the truncation row below: a 120-character
  name produces a 64-character result that still ends `-tab-fi`.
- **The fallback is to the `chat` role, not to no name at all.** The batch text says
  "falls back, session still starts, `warn` logged". Dropping `--name` when the user's name
  slugifies to nothing would hand that session back to the CLI's DERIVED naming — the exact
  defect Requirement 2 fixed — so a name that does not survive slugification falls through
  to today's behaviour and logs at `warn`. The pre-existing "no name at all" warn path is
  untouched and still covers the case where even the `chat` composition fails.

## Task 9.3 — the title carries the raw name

`title` is set only when `!resumeSessionId && sessionConfig.sessionName`. The comment at the
site states why: `sdk.d.ts`'s `Options.title` says the resumed session's PERSISTED title
takes precedence, so setting it on a resume is a silent no-op. Nothing in this batch
pretends otherwise, and `SessionTitleService` is named in that comment as the path that
does change an existing session's title.

Note recorded rather than assumed: the registry `--name` DOES still ride along on a resume,
because a resume is a new process and therefore a new `~/.claude/sessions/<pid>.json`
record. That asymmetry is pinned by a test.

## Task 9.4 — a UI rename follows through

- `renameSession` is called from `SessionRpcHandlers.registerSessionRename`, the path that
  owns the rename — **not** from `SessionMetadataStore`, which keeps zero SDK dependency.
- `SessionTitleService.retitle` logs at `warn` and returns `false` on every failure; the
  handler ignores the boolean. A rename the user performed has already succeeded in Ptah's
  own metadata by then, so failing the RPC afterwards would undo nothing and report an
  error that is not one. Pinned by `still succeeds when the SDK retitle fails`.
- The limit — **the registry name does not follow a rename** — is written into
  `buildSessionName`'s doc comment, where the next reader meets it, in the terms the batch
  asked for (fixed at spawn, no documented API, rename moves the TITLE).

## Verification

All commands run in the worktree, `--parallel=1`, output redirected to a file and the exit
code read directly (never through a pipe).

### Tests — the required two projects

```
$ npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/shared --parallel=1 --skip-nx-cache
EXIT=0
 NX   Running target test for 2 projects:
Test Suites: 57 passed, 57 total            # @ptah-extension/shared
Tests:       1381 passed, 1381 total
Test Suites: 1 skipped, 95 passed, 95 of 96 total     # @ptah-extension/agent-sdk
Tests:       2 skipped, 1685 passed, 1687 total
 NX   Successfully ran target test for 2 projects
```

The header reads **2 projects**. The 1 skipped suite / 2 skipped tests are the pre-existing
`describe.skip` behind `PTAH_PERF_SPECS=1`; nothing was skipped by this batch.

New rows inside `sdk-query-options-builder.spec.ts`, all green:

| Row | Surface | Asserts |
| --- | --- | --- |
| spaces and punctuation | REGISTRY | `'Fix the Billing Bug!'` → `ptah-ws-fix-the-billing-bug-tab-fi` |
| slugifies to nothing | REGISTRY | `'!!! ***'` → `ptah-ws-chat-tab-fi` **and** a `warn` carrying `sessionNameLength: 7` |
| head truncation | REGISTRY | 120 `a`s → ends `-tab-fi`, length ≤ 64, starts `ptah-ws-aaa` |
| raw title | TITLE | `options.title === 'Fix the Billing Bug!'` |
| no name | TITLE | `options.title` undefined |
| resume | TITLE + REGISTRY | `options.title` undefined, `extraArgs['name']` still composed |

### Tests — `rpc-handlers` (edited, so run even though the batch lists two projects)

```
$ npx nx run-many -t test -p @ptah-extension/rpc-handlers --parallel=1 --skip-nx-cache
EXIT=0
Test Suites: 94 passed, 94 total
Tests:       31 skipped, 2728 passed, 2759 total
 NX   Successfully ran target test for project @ptah-extension/rpc-handlers
```

Disclosed honestly: the FIRST run of this target exited 1 with one failure —
`skills-sh-source-root.service.spec.ts › writes every slug of a whole-repo install…`
exceeded the 5000 ms per-test timeout inside a suite that took 86.4 s. It is a real-filesystem
suite unrelated to anything in this batch (no Batch 9 file is in its import graph), and it
passed on the immediate re-run above with no code change. Recorded as a timing flake, not as
a pass I engineered.

`nx test ptah-cli` was NOT attempted — TASK_2026_427_f669. Raw `jest` was never invoked.

### Typecheck — clean

```
$ npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1
EXIT=0
 NX   Successfully ran target typecheck for 3 projects
```

### Lint — one PRE-EXISTING error, nothing new

```
$ npx nx run-many -t lint -p @ptah-extension/agent-sdk @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1
EXIT=1
✖ 2 problems (0 errors, 2 warnings)     # shared
✖ 41 problems (1 error, 40 warnings)    # agent-sdk
✖ 19 problems (0 errors, 19 warnings)   # rpc-handlers
```

The single error is:

```
libs\backend\agent-sdk\src\lib\di\register.compaction-boundary-registry.smoke.spec.ts
  37:1  error  Projects should use relative imports … @nx/enforce-module-boundaries
```

That file is **not modified by this batch** (`git status` confirms) and the offending import
arrived in commit `9c63dc009`. Every warning is pre-existing (`max-lines`,
`no-non-null-assertion`, `no-empty-function`). `npx prettier --write` was run over the
touched files so the format hook has nothing to reformat later.

### The live registry check — NOT performed

Batch 9's verification also asks for a real session followed by a read of
`~/.claude/sessions/<pid>.json` asserting `nameSource !== 'derived'`. This session is
headless — no Electron or VS Code host was launched — so that check was not run and no
result for it is claimed. It carries forward to Batch 8 acceptance beside A0's spawn-log
grep.

## Plan deviations

1. **`sdk-agent-adapter.ts` was edited, and it is not in the batch's owned-files list.**
   Without one line there, `sessionName` has no producer and the whole requirement is dead
   code. The name already existed on the interactive start path: `ChatStartParams.name` →
   `ChatSessionService.startSession` → `sdkAdapter.startChatSession({ name })`, where it is
   used for the metadata record. The adapter now also carries it onto
   `sessionConfig.sessionName`, so the builder sees it. The alternative was editing
   `chat-session.service.ts`, which belongs to no batch either and sits further from the
   two surfaces. The change is additive and one object literal wide.
2. **`session-rpc.handlers.ts` + its spec were edited.** Batch 9 owns "the `rename` call
   path that reaches it", and this is that path. `SessionRpcHandlers`'s constructor gains
   one required injected dependency before the trailing optional one, so the spec harness
   was updated to match.
3. **The empty-slug fallback goes to `chat`, not to no name.** Reasoning under Task 9.2.
4. **A new DI token and registration were added** (`SDK_SESSION_TITLE_SERVICE`). The batch
   did not ask for one, but the SDK call cannot live in `SessionMetadataStore` (the batch
   forbids it) and `rpc-handlers` must not import `@anthropic-ai/claude-agent-sdk` directly
   — agent-sdk is the lib that wraps the SDK. A registered service in agent-sdk is the only
   placement that satisfies both.

## Out-of-scope observations (seen, not touched)

- **The resume path supplies no `sessionName`.** `SdkAgentAdapter.resumeSession`'s config
  has no `name` field and `ChatSessionService`'s resume/auto-resume call sites do not set
  one, so a resumed session's registry name falls back to `ptah-<ws>-chat-<suffix>` even
  though its metadata record holds the user's name. Fixing it is one read of
  `metadataStore.get(sessionId).name` at the resume call site, in a file this batch does not
  own. Requirement 9's acceptance criteria are all written about a session that STARTS with
  a user-chosen name, so this is a gap in reach, not a failed criterion — but a peer
  browsing the registry will see `chat` for every resumed session until it is closed.
- **A brand-new tab genuinely has no name**, which is why 9.1 made the field optional. The
  auto-title that arrives later reaches the TITLE (through `session:rename` → `retitle`) and
  can never reach the registry name, by the limit documented on `buildSessionName`.
- The Ptah-CLI spawn path (`ptah-cli-registry.ts`, Batch 4's file) composes its own
  `--name` from the agent role and is unaffected by this batch.
