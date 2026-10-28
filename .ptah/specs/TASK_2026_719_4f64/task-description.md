# Requirements - TASK_2026_719_4f64

## Context

TASK_2026_712_5d7c (PRs #808 and #820, merged; base `396f0135b`) built named Claude accounts up to a
fail-closed hold. Ptah can add, rename, remove and select named Claude profiles in the Electron
Accounts section. Each profile has its own canonical directory. The registry, run bindings, lane
named-admission code (`ClaudeNamedLaneAdmission` in
`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:271-358`) and
the RPC methods `provider:getAccountStatus`, `provider:startAccountSignIn`,
`provider:cancelAccountSignIn` and `provider:signOutAccount`
(`libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts:260-296`) exist. But no named
account can sign in or run today. The release hold (decision D7) blocks every path:

- `claude-account-command.ts:109` `authorization()` always returns `release-held`, and
  `environment()` (`:114-116`) always throws `unsupported-source`. So status, sign-in and sign-out
  never start the Claude CLI.
- `certifyClaudeAccountEnvironment` (`claude-account-command.ts:51-77`) accepts only an empty
  effective-settings list, and no resolver supplies one. `parseClaudeAccountStatus` (`:86-100`)
  expects a `configDir` key and a small exact key set. `execute()` runs `claude auth <kind>` with
  no flags (`research-report.md`, evidence row for `claude-account-command.ts:47-145`).
- `provider-account.service.ts:76-78` `admitClaudeRoute` always refuses `release-held`.
  `releaseReservation` and `retainUnresolvedReservation` (`:84-90`) always refuse `conflict`. The
  fallback port for hosts without SQLite (`libs/backend/auth-providers/src/lib/di/register.ts:165-186`)
  refuses too.
- Main chat: `chat-slash-command-router.service.ts:120-155` reads the stored `main` selection and
  admits it. Then it releases the lease and refuses `release-held`.
  `sdk-agent-adapter.ts:1183,1653` refuses named selections. `SDK_NAMED_ACCOUNT_PERSISTENCE` is
  registered as `null` (`libs/backend/agent-sdk/src/lib/di/register.ts:220`). The chat RPC
  contract (`libs/shared/src/lib/types/rpc/rpc-chat.types.ts`,
  `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`) has no `accountSelection`
  (D22). But `chat-session.service.ts:595-1766` already forwards one internally.
- Lanes: `agent-process-manager.service.ts:725` calls `runSdk` without `accountAdmission`, so the
  stored Claude `lane` selection is never read at spawn (D37). `CLAUDE_LANE_ACCOUNT_PERSISTENCE` is
  unregistered on every host (D28; `libs/backend/cli-agent-runtime/src/lib/di/register.ts:205`).
  `agent-spawn-args.schema.ts:55` tells callers that named lanes are "not available in this
  release".

The user has two real Claude accounts. The user wants to add both in Electron and sign in to each.
Then the user wants to run the main chat on account 1 and a Claude CLI lane on account 2, both on
Haiku, and see that each run used its own account. The user signs in personally. The agent never
sees, types or stores credentials. User decision D41 (TASK_2026_712_5d7c `decisions.md:299`) lifts
the D7 hold fully, with no development flag. Ambient (default) Claude auth and every existing
integration must stay unchanged.

`research-report.md` already establishes these facts (assumptions A1-A3,
`TASK_2026_712_5d7c/implementation-plan.md:80-82`):

- The installed CLI is 2.1.310. The SDK (0.3.278) bundles CLI 2.1.278. The two can differ.
- A signed-out `claude auth status --json` (observed, 2.1.310) prints `loggedIn:false`,
  `authMethod:"none"`, `apiProvider:"firstParty"`, `analyticsDisabled`, `projectsDirectory` and
  `configDirectory`, and exits 1. The real key is `configDirectory`, not `configDir`.
- Signed-in output adds `email`, `orgId`, `orgName` and `subscriptionType` and exits 0. This comes
  from 2.1.278 binary text, not from a signed-in run.
- `auth login` has `--claudeai` and `--console`. The login screen is an Ink terminal UI, so it
  likely needs a TTY. This is not verified.
- The credential store follows `CLAUDE_SECURESTORAGE_CONFIG_DIR`, else `CLAUDE_CONFIG_DIR`
  (SDK source). Windows has a Credential Manager backend behind `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN`
  and the `tengu_windows_credman` flag. Nobody knows if that backend is per directory.
- The SDK exposes `accountInfo()` and the `init` message reports `claude_code_version`.

Decisions D2 and D3 (`decisions.md`) settle the sign-in handoff: a user-only authentication
terminal runs `['auth','login','--claudeai']`, and completion is detected only by sanitized status
polling.

These live facts are still unverified: signed-in status output, the login terminal behavior,
identity read before the first prompt, effective-source certification, and Windows Credential
Manager isolation.

## Classification

- Type: FEATURE. It adds new user-visible behavior: real named sign-in and per-account execution.
- Estimate: XL. The change crosses auth-providers, agent-sdk, cli-agent-runtime, rpc-handlers,
  shared contracts and vscode-lm-tools. It needs live evidence for the unknowns listed in
  Context. It touches security-sensitive environment construction. It ends with a live two-account test that needs the
  user.
- Priority: not defined here.

## Scope

In scope:

- Lift the D7 release hold in code for Electron (D41), with no flag, setting or environment switch.
- Real named `status`, `sign in`, `cancel sign in` and `sign out` through the official Claude CLI
  (`auth status --json`, `auth login --claudeai`, `auth logout`), each run with the profile's own
  `CLAUDE_CONFIG_DIR` and `CLAUDE_SECURESTORAGE_CONFIG_DIR`.
- The user-only authentication terminal for sign-in (D2, D3), with the external-terminal fallback.
- `environment()` and route certification bound to the Claude executable that actually runs the
  chat or the lane: A1 (status shape), A2 (account identity read before the first prompt) and A3
  (effective auth-source precedence from managed, user, project and local settings). Unknown,
  mismatched or unproved cases fail closed.
- A backend-only, non-secret account identity reference, compared with the runtime identity
  before any prompt.
- Real admission in `ProviderAccountService`, with working `releaseReservation` and
  `retainUnresolvedReservation`, and the F1 run lease per canonical route for both main chat and
  lanes.
- Main chat named execution: the stored `main` selection, plus an optional `accountSelection` on
  the chat start, continue and resume RPC contract (D22), with the SDK persistence and binding
  registrations it needs on Electron.
- Lane named execution: the stored `lane` selection read at spawn (D37), the explicit
  `accountSelection` on `SpawnAgentRequest` for `claude` lanes, and named lane continue and resume.
  This includes host registration of the persistence ports that named runs need.
- A non-secret, observable record of which account each chat run and lane run used.
- D28 refusal-code cleanup (`laneAccountRefusalCode` name match to `instanceof`, plus a dedicated
  `account_refused` code). It is on the path because named lane continue becomes reachable.
- The D39 test "list/message capabilities match handle" for the `claude` lane in
  `claude-cli.adapter.spec.ts`. It is on the path
  because the live test messages a Claude lane.
- Updates to caller-facing text that says named lanes are unavailable (for example
  `agent-spawn-args.schema.ts:55`, the MCP tool description and the `release-held` copy in
  `claude-account-command.ts:20`).
- Unit and integration tests for every requirement below, and the live Electron test.

Out of scope:

- TUI (`apps/ptah-tui`) and VS Code-only surfaces — Electron first (CLAUDE.md). These hosts must
  still compile and keep their current refusal of named selections.
- Codex multi-account — moved to TASK_2026_715_6cba (D12).
- Named-later items P1F-F2, P1F-F3, P1F-F4, P1F-S1, P1F-V1, P1F-V2, P1E-F3, P1E-F4 and P1E-S1 —
  UI and store hardening that does not block the live test. They stay as named later tasks unless
  the architect proves one is on the path. If so, record it as a decision.
- Imported ambient user approvals and MCP servers for named routes (the selected-directory
  `.claude.json` part of A3) — named routes keep excluding them, as the predecessor plan specifies
  (`implementation-plan.md:82`). Precedence detection for auth sources stays in scope.
- Automatic account rotation, credential copying, shadow home directories and cross-account resume
  (D6).
- Per-account quota and usage display beyond what already exists — it is not needed to prove which
  account ran.
- Automatic reclaim of crashed reservations by PID or by timeout (`implementation-plan.md:136`).
- API-key, Bedrock, Vertex, Foundry, gateway and Console-profile sources for named accounts —
  `claude.ai` subscription sign-in only (`implementation-plan.md:76,148`).

## Requirements

### 1. Release hold lifted (D41)

Requirement: auth-providers and every named-account consumer on Electron — admit certified named
routes instead of refusing `release-held` — so that named accounts can sign in and run.

Acceptance criteria:

1. When a signed-in named profile passes certification on Electron, `admitClaudeRoute` shall
   return `ok` with a reservation and named route resources, not `release-held`.
2. When the code is searched for a flag, setting or environment variable that switches named
   admission on or off, the search shall find none. The only gates shall be certification, profile
   state, route validation and storage availability.
3. When a host has no account storage (VS Code, TUI, CLI), named selections shall still be refused
   with a typed, safe code, and ambient behavior shall not change.
4. When `release-held` is no longer produced by any production path, the user-facing copy and the
   tool descriptions shall no longer say that named accounts await release.

### 2. Named sign-in, status and sign-out

Requirement: Electron user — signs in to, checks and signs out of each named profile through the
official Claude CLI flow, in that profile's own directory — so that two accounts can coexist on one
machine.

Acceptance criteria:

1. When the user starts sign-in for a named profile, the system shall launch the certified Claude
   executable with the argument array `['auth','login','--claudeai']`. `CLAUDE_CONFIG_DIR` and
   `CLAUDE_SECURESTORAGE_CONFIG_DIR` shall both name that profile's canonical directory. The child
   environment shall contain no foreign auth selector and no `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN`.
   The argument array shall never contain `--console`.
2. When sign-in starts on Electron, the login shall run in a user-only authentication terminal
   (D3): a dedicated session that only the user sees, separate from normal Ptah terminal tabs.
   Its bytes may cross the main-to-renderer terminal channel for display only. No agent tool, MCP
   terminal tool, terminal list, capture, replay, persistence, log or telemetry shall read or
   receive its input or output. A test shall show that the agent and MCP terminal tools cannot
   list, read or write this session.
3. When the authentication terminal cannot start, the system shall show the user the command and
   the profile directory to run in their own terminal, and a "Check status" action. The agent
   shall not run that command.
4. When the login flow asks for credentials, the user shall enter them only in the official
   Claude flow (browser or the authentication terminal). Outside the authentication terminal
   display path, no Ptah renderer field, RPC parameter or result, log line or database row shall
   carry a credential, token, authorization code or login URL.
5. When sign-in is pending, the system shall detect completion only by polling sanitized
   `auth status --json` with the same executable and environment. It shall not use terminal text
   or the login exit code as proof. When the status reports `loggedIn:true`,
   `authMethod:'claude.ai'`, `apiProvider:'firstParty'` and a normalized `configDirectory` equal
   to the profile directory, the profile state shall become `signed-in`, the system shall end the
   login process tree, and the Accounts UI shall show the state after a refresh or push.
6. When the user cancels a pending sign-in, the system shall end the owned process tree, set the
   state to `cancelled`, and then recheck status. A late success shall not overwrite the cancelled
   operation.
7. When sign-in exceeds the login deadline (5 min, inherited from
   `claude-account-command.ts:123`), the system shall return `timeout` with the fixed safe copy
   and shall end the child process tree.
8. When the user signs out of a profile with no active run, the system shall run `auth logout`
   with that profile's environment only. The state shall become `signed-out` only after a later
   `auth status --json` reports `loggedIn:false` for that directory. The sanitized status of the
   other profiles and of ambient auth shall be the same as before the sign-out.
9. When the user starts sign-in or sign-out on a route that holds an active or unresolved run
   lease (main chat or lane), the system shall return `busy` and shall not end or move the run.
10. When `auth status --json` exits 1 and its JSON is valid with `loggedIn:false`, the system
    shall report `signed-out`, not an error.
11. When status JSON is malformed or too large, lacks `configDirectory`, `loggedIn`, `authMethod`
    or `apiProvider`, has inconsistent fields (for example `loggedIn:true` with
    `authMethod:'none'`, or an exit code that disagrees with `loggedIn`), reports a different
    normalized directory, or reports another provider or method, the system shall return
    `unsupported-source` and shall not mark the profile signed in. Documented metadata fields
    (`analyticsDisabled`, `projectsDirectory`, identity fields, `apiKeySource`,
    `forcedLoginMethod`) shall be accepted, but their values shall not leave the backend parser.
12. When the status parser is tested, the fixtures shall be tagged with the CLI version and shall
    cover signed-in, signed-out (exit 1), foreign provider, inconsistent fields and Windows path
    normalization (back slash, forward slash, drive-letter case). The signed-in fixture shall be
    labeled "source-derived" until the live test (Requirement 8) verifies the real shape.

### 3. Environment and route certification for the installed CLI (A1-A3)

Requirement: auth-providers — builds the child environment for a named route only after it proves
the installed CLI version and the effective auth source — so that a named run can never borrow
ambient or foreign credentials.

Acceptance criteria:

1. When the Claude executable for a named route has a version in the certified set,
   `environment(route)` shall return a frozen environment with `CLAUDE_CONFIG_DIR` and
   `CLAUDE_SECURESTORAGE_CONFIG_DIR` set to the canonical route, the safe baseline keys kept, and
   every key in `CLAUDE_ACCOUNT_SELECTOR_KEYS`, `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN` and every
   unrecognized `CLAUDE*`/`ANTHROPIC*`/cloud key removed or refused.
2. When the version of the executable for a named route is unknown, below the certified minimum,
   or cannot be read, the system shall refuse named status, sign-in, sign-out and execution with a
   typed safe code, and ambient execution shall continue.
3. When a named route is certified, status, preflight and each named run (main chat and lane)
   shall use the same executable path, the same environment and the same working-directory and
   settings context. A test shall show that certification records the executable and version, and
   that a run with a different executable is refused. (Research shows the installed 2.1.310 and
   the SDK-bundled 2.1.278 can differ; the architect chooses which one runs.)
4. When a named run starts and the version that the runtime reports (for example the `init`
   message `claude_code_version`) is missing or differs from the certified version, the system
   shall close the run before any prompt or resume data is released, report a typed safe code,
   and not fall back to ambient auth.
5. When the effective settings for the route contain an auth override (API key, `apiKeyHelper`,
   OAuth-token variable, cloud backend, gateway, or Console profile) or the precedence cannot be
   determined, certification shall refuse. It shall not run an `apiKeyHelper` to find out, and it
   shall not suppress managed policy. Certification shall also require the status from
   criterion 3's context to report `loggedIn:true`, `authMethod:'claude.ai'` and
   `apiProvider:'firstParty'` (A1, A3).
6. When the status parser reads a signed-in status, it shall validate the normalized
   `configDirectory`, `loggedIn`, `authMethod` and `apiProvider` (Requirement 2 criteria 10-12).
   The backend shall derive a stable, non-secret identity reference from the validated identity
   fields with one defined normalization that the runtime account information (`accountInfo()`)
   can also produce. The backend shall then discard the raw identity values. The reference shall
   not be reversible to an email or organization name, and it shall stay in the backend except as
   the opaque value in Requirement 6.
7. When a named query starts (fresh, continue or resume), the system shall read the identity that
   the actual query reports, derive the reference with the same normalization, and compare it with
   the profile's certified reference before it opens the prompt gate (A2). When the runtime
   identity is missing, cannot be normalized, or does not match, the system shall close the run
   before any prompt or resume data is released, report a typed safe code, and not fall back to
   ambient auth. No path shall run a named query with an unknown owner.
8. When the canonical directory is replaced, re-pointed or aliased between admission and launch,
   the launch shall be refused with `route-changed`.
9. When certification is tested, the tests shall cover each selector key, each unsupported
   source, an unknown version, a runtime version mismatch, a different executable, missing and
   mismatched runtime identity, and two simultaneous canonical directories, and they shall assert
   that the host `process.env` is not mutated.

### 4. Main chat on a named account (D22)

Requirement: Electron user — runs the main chat on a chosen named account — so that the main
conversation bills and authenticates against that account.

Selection precedence (applies to main chat and to `claude` lanes, Requirement 5):

| Run | Explicit `accountSelection` | Stored selection (`main` or `lane`) | Account used |
| --- | --- | --- | --- |
| Fresh | Named profile | Any | The explicit named profile |
| Fresh | Ambient | Any | Ambient |
| Fresh | Omitted | Named profile | The stored named profile |
| Fresh | Omitted | None or ambient | Ambient |
| Bound continue or resume | Omitted | Any | The existing binding |
| Bound continue or resume | Same as the binding | Any | The existing binding |
| Bound continue or resume | Different from the binding (named or ambient) | Any | Refused with a typed safe code; the conversation stays |
| Any, non-Claude provider or non-`claude` CLI | Any | Any | Today's behavior; selections are bypassed (chat) or refused (other CLIs, Requirement 5 criterion 2) |

A bound session is a session that already has a run binding. Its binding is authoritative.

Acceptance criteria:

1. When Claude sign-in is the active auth method for the workspace and the selection resolves by
   the precedence table to a signed-in named profile, the chat turn shall run with that profile's
   certified environment. The run binding shall record that profile and its verified identity
   reference.
2. When the chat start, continue or resume RPC carries `accountSelection`, the shared RPC types
   and the strict chat schema shall accept it, and the backend shall apply the precedence table.
   An invalid shape shall be rejected with no side effect.
3. When a bound chat session is continued or resumed, the system shall use the account bound to
   that session. When the request omits `accountSelection` or repeats the binding, the binding
   shall apply. When the request names a different account or ambient, the system shall refuse
   with a typed safe code and keep the conversation.
4. When admission or certification fails for the main chat, the turn shall fail with a fixed safe
   message and a typed code, the conversation shall stay intact, and the system shall not retry on
   ambient auth.
5. When an API-key or other non-Claude provider is the active auth method, the stored `main`
   selection shall be ignored, and the chat shall behave exactly as it does today.
6. When the precedence table resolves a fresh chat turn to ambient (explicit ambient, or omitted
   with no stored named selection), the chat shall run with today's ambient environment and
   options. Existing chat specs shall pass unchanged.
7. When the precedence tests run, they shall cover each table row for main chat: omitted with a
   stored named selection, omitted with none, explicit ambient over a stored named selection,
   explicit named over a stored selection, a bound session with omission, and a bound session with
   a conflicting explicit selection.
8. When a named chat turn starts, the system shall acquire the run lease on the canonical route
   before preflight, transfer it to the live SDK query owner, and hold it for the whole run.
9. When the SDK query is proved terminated after normal completion, startup failure,
   cancellation, abort, timeout or disposal, the lease shall be released exactly once. Tests shall
   cover each of these six exits.
10. When the system cannot prove that the SDK query terminated, the reservation shall be retained
    as unresolved.
11. When a main-chat lease is active or unresolved, sign-in and sign-out on that route shall
    return `busy` (Requirement 2 criterion 9).
12. When Electron starts, `SDK_NAMED_ACCOUNT_PERSISTENCE` and the import-binding ports that named
    chat needs shall be registered with real implementations. When a host leaves them
    unavailable, a named chat selection shall be refused with a typed safe code, and ambient chat
    shall not change.

### 5. Claude CLI lane on a named account (D37, F1 lease)

Requirement: chat agent and Electron user — spawn a Claude CLI lane on a named account, either from
the stored `lane` selection or from an explicit `accountSelection` — so that lanes can use a
different account from the main chat.

Acceptance criteria:

1. When a fresh `claude` lane is spawned with no explicit `accountSelection` and the stored
   `lane` selection names a signed-in profile, the spawn shall admit that profile and run the lane
   with its certified environment (D37). Selection follows the precedence table in Requirement 4.
2. When a `claude` lane is spawned with `accountSelection: {kind: "named", profileId}` through
   MCP HTTP, MCP stdio or `execute_code`, the lane shall run on that profile. The validator shall
   no longer refuse named selections for `claude` lanes. Named selections for other CLIs shall
   still be refused.
3. When a named lane starts, it shall hold a run lease on its canonical route from before the
   preflight until the child closes, including on startup failure, cancel, abort, timeout and
   disposal (F1). The lease shall then be released exactly once.
4. When the child cannot be proved terminated, the reservation shall be retained as unresolved,
   and new sign-in or sign-out on that route shall return `busy`.
5. When a bound lane is continued or resumed, it shall use its bound account. When the request
   omits `accountSelection` or repeats the binding, the binding shall apply. When the request
   names a different account or ambient, the system shall refuse with the code in criterion 6. A
   bound session shall never fall back to ambient auth.
6. When a named lane is refused, `agent:continue` and `agent:resumeCliSession` shall report the
   dedicated `account_refused` code with fixed safe text, matched by `instanceof` (D28).
7. When the `claude` lane handle is listed or messaged, the reported capabilities shall match the
   handle (D39 test).
8. When the main chat runs on account 1 and a lane runs on account 2 at the same time, the two
   runs shall hold leases on two different routes, and neither shall see the other's
   `CLAUDE_CONFIG_DIR`.
9. When the precedence table resolves a fresh lane to ambient (explicit ambient, or omitted with
   no stored named selection), the lane shall spawn exactly as it does today. Existing lane specs
   shall pass unchanged.
10. When the lane precedence tests run, they shall cover omitted with a stored named selection,
    omitted with none, explicit ambient over a stored named selection, explicit named over a
    stored selection, a bound lane with omission, and a bound lane with a conflicting explicit
    selection.
11. When a named lane starts, the runtime identity check in Requirement 3 criterion 7 shall pass
    before the lane receives its task text.

### 6. Observable account per run

Requirement: Electron user and reviewer — see which account a chat run and a lane run used, without
secrets — so that the user can confirm correct routing.

Acceptance criteria:

1. When a named chat run or lane run passes the runtime identity check (Requirement 3
   criterion 7), the system shall persist a run binding that names the profile ID and the verified
   identity reference that the runtime reported. A run that fails the check shall persist no
   verified reference. A reviewer shall be able to read the binding from the registry.
2. When the user looks at a running or finished chat session or lane in Electron, the user shall
   be able to see the label of the account it ran on, or "Default" for ambient. The architect
   chooses where this appears. If it needs a new UI surface, a designer step (Gate 1.7) applies.
3. When account information is shown or logged, it shall contain only the profile label, the
   profile ID, the state and the opaque identity reference. It shall contain no email, organization name,
   token, credential path content or raw CLI output.

### 7. Ambient auth and existing integrations unchanged

Requirement: all hosts and integrations — keep today's behavior when no named account is chosen —
so that the change carries no regression.

Acceptance criteria:

1. When no named selection exists, the child environment, SDK options, model and effort of main
   chat and of every lane shall equal today's values. Existing snapshot and option-pinning specs
   shall pass without edits to their expectations.
2. When the scoped checks run for each changed project and each dependent host (`ptah-electron`,
   `ptah-extension-vscode`, `ptah-cli`, `ptah-tui` where it depends), typecheck and tests shall
   pass.
3. When a non-Claude CLI lane (Codex, Gemini, Copilot, Grok, Antigravity, Ptah CLI) is spawned,
   its behavior shall not change.

### 8. Live Electron acceptance test

Requirement: the user and the orchestrator — prove the feature end to end with two real accounts on
Haiku — so that the user accepts the task.

Acceptance criteria:

1. When the live test runs, the procedure shall be as follows, and each step shall pass:
   1. Record the sanitized ambient `auth status --json` result (`loggedIn`, `authMethod`,
      `apiProvider`, normalized `configDirectory`, and the identity reference if signed in). Ambient
      may be signed in or signed out; the test records the state and does not change it. If the
      reviewer needs a file check, the user (not the agent) checks whether
      `%USERPROFILE%\.claude\.credentials.json` exists and reports only "exists / absent" and the
      modification time. A Credential Manager check runs only under the conditional procedure in
      step 8. No agent reads credential bytes.
   2. In Electron, add two named Claude accounts ("Account 1", "Account 2").
   3. Start sign-in for Account 1. The user completes the official login personally in the
      authentication terminal (or the external-terminal fallback). Account 1 shows "Signed in".
      Repeat for Account 2. Record which path ran and how the terminal behaved, without its text.
   4. Confirm that the sanitized `auth status --json` for each profile reports `loggedIn:true`,
      `authMethod:'claude.ai'`, `apiProvider:'firstParty'` and its own normalized
      `configDirectory`, and that the two identity references differ. Record the real signed-in
      key set (names only) to verify the source-derived fixture.
   5. Set the main chat to Account 1 and the Claude lane selection to Account 2. Set Haiku as
      the main chat model and as the Claude lane model.
   6. Send one short main chat message. Ask the chat agent to spawn one Claude CLI lane with a
      short task. Both shall complete.
   7. Confirm that the chat shows Account 1 and the lane shows Account 2. Confirm that each run
      binding names its selected profile, that each binding's runtime-verified identity reference
      equals the reference from step 4 for that profile, and that the two runtime references
      differ. The user may also confirm through each account's own usage view.
   8. Sign out of Account 2. Confirm by sanitized status that Account 2 reports `loggedIn:false`,
      that Account 1 still reports `loggedIn:true` with its step 4 reference, and that the ambient
      status equals the step 1 record. If step 1 used the user-operated file check, the user
      repeats it and reports that existence and modification time are unchanged.
      Conditional Credential Manager check: before the live test, the architecture shall establish,
      without reading secrets, which storage backend the chosen executable uses with the named
      environment and how its storage targets are identified. If the file backend is active, this
      check is "not applicable". If Credential Manager is active, the user collects the relevant
      target identifiers and the available non-secret modification metadata before step 3, after
      step 3 and after this step, and the architecture supplies an evidenced mapping from targets
      to profiles (no name-substring assumption, no ownership inferred from names alone). The
      check fails when two named profiles share one target, or when an ambient target changes,
      disappears or is reused by a named profile. If the backend or the mapping cannot be
      established, the check is recorded as "unresolved" and is not reported as passed.
2. When the live test runs, the agent shall not see, type or store any credential, and it shall
   make no paid call beyond the Haiku messages in step 6.
3. When any step fails, the result shall be recorded in `test-report.md` with the step number and
   the safe error code, and the task shall not be reported as done.

## Non-functional requirements

- Security: no credential, token, authorization code, login URL, email, organization name or raw
  CLI output in logs, telemetry, renderer state, RPC payloads or the database. One scoped
  exception exists (D3): the user-only authentication terminal may carry login bytes over the
  main-to-renderer terminal channel for display to the user only, with no agent access, capture,
  replay, persistence, log or telemetry (Requirement 2 criterion 2). No agent reads credential
  files or credential store entries. Each profile uses
  only its own isolated directory. An unknown CLI version, a mismatched executable or runtime
  version, missing or mismatched runtime identity, an unknown auth source or an undeterminable
  precedence fails closed. The child environment is built per launch; the host
  `process.env` is never mutated. Commands use argument arrays, never shell strings.
- Compatibility: Electron on Windows is the live-test platform. Every host project still compiles
  and passes its scoped checks.

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| --- | --- | --- |
| The user (two Claude accounts) | Main chat on one account and a lane on another, without credential exposure | The live test in Requirement 8 passes |
| Users who use only the default login | No change | Ambient chat and lanes behave as before; existing specs pass |
| Agents that spawn lanes through MCP | A clear way to choose an account for a `claude` lane | Named selection works; refusals have a typed code and fixed text |
| Reviewers | Proof that no path leaks credentials or borrows ambient auth | Tests in Requirements 2, 3 and 6; no secrets in logs |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| The signed-in status shape differs from the source-derived fixture (keys or exit code), so signed-in profiles fail certification | MEDIUM | HIGH | The architect builds the parser from the observed signed-out output and the source-derived signed-in fixture (Requirement 2 criterion 12); the live test step 4 records the real key set, and the developer updates the fixture before the task is done |
| The login terminal does not behave as expected under node-pty/ConPTY (for example, it never exits after success) | MEDIUM | HIGH | Completion uses status polling only, and the system ends the process tree after success (Requirement 2 criterion 5); the external-terminal fallback covers a pty start failure; live test step 3 records the behavior |
| The Windows Credential Manager backend (`CLAUDE_CODE_FORCE_WINDOWS_CREDMAN`, `tengu_windows_credman`) uses one shared target for all directories, so two named accounts or a named account and ambient overwrite each other | MEDIUM | HIGH | The environment builder strips `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN` and sets `CLAUDE_SECURESTORAGE_CONFIG_DIR` (Requirement 3 criterion 1); live test steps 1, 4 and 8 prove isolation by sanitized status per profile and for ambient, plus the conditional Credential Manager check in step 8 (backend established first; "not applicable" for the file backend; "unresolved" is never reported as passed); if isolation fails, the orchestrator records the failure and the task is not reported as done |
| The installed CLI (2.1.310) and the SDK-bundled CLI (2.1.278) differ, so status certifies one binary and the run uses another | MEDIUM | HIGH | Requirement 3 criteria 3-4 bind status, preflight and run to one executable and check the runtime version; the architect names the executable in the plan |
| A2: the actual query cannot report account identity before the first prompt | MEDIUM | HIGH | The architect proves the pre-prompt `accountInfo()` sequence with the chosen executable before implementation; if it cannot be proved, named runs stay refused (Requirement 3 criterion 7) and the orchestrator reports the blocker to the user; there is no unknown-owner path |
| Effective-source certification (A3) refuses real users or misses a managed or project override | MEDIUM | HIGH | The architect defines the settings sources that certification reads with the same executable and working directory; tests in Requirement 3 criterion 9 cover each override; the live test confirms that a normal user passes |
| Lifting the hold changes ambient paths by accident | LOW | HIGH | Option-pinning and environment-snapshot specs stay unchanged; the code-logic review checks every ambient branch |
| A crashed run leaves a route reservation that blocks sign-out | LOW | MEDIUM | The architect documents the manual recovery; this task adds no automatic reclaim |

## Open questions

- None for the user. D2 and D3 settle the sign-in handoff. The remaining unknowns are technical
  and are listed under Handoff.

## Handoff

- Next specialist: software-architect.
- Why: research is done (`research-report.md`), so the shape of the design is now the question.
  The architect plans targeted evidence work for these live unknowns only:
  1. The signed-in `auth status --json` output (source-derived today).
  2. The login terminal behavior under node-pty/ConPTY on Windows.
  3. Reading account identity from the actual query before the first prompt (A2).
  4. Effective-source certification with the chosen executable and context (A3).
  5. Windows Credential Manager isolation between profiles and ambient.
