# Requirements - TASK_2026_864_1376

## Context

Today the onboarding "Get ready" flow checks Claude Code only. `deriveClaudeReadiness`
(`libs/frontend/onboarding/src/lib/ready/claude-readiness.store.ts:56-89`) reads the
`cli === 'claude'` row of `agent:detectClis` (via `ProvidersSettingsStateService.redetectClis`,
`libs/frontend/core/src/lib/services/providers-settings-state.service.ts:836-850`) and the
`provider:getAmbientClaudeStatus` reply (via `ClaudeAmbientStatusService.read`,
`libs/frontend/core/src/lib/services/claude-ambient-status.service.ts:71-109`). The result feeds
three surfaces: the non-dismissible warning banner (`claude-readiness-banner.component.ts:30-131`),
the three-item progress strip whose item 1 is "Claude Code" (`ready-strip.component.ts:32-177`),
and stage 1 "Check Claude Code" at `/onboarding/ready` (`ready-claude-step.page.ts:109-547`). Home
re-reads readiness on every visit (`home/onboarding-home.component.ts:419-421`) and shows the
strip and banner (`onboarding-home.component.ts:76-117`). The first-run guard sends a new user to
stage 1 until `claudeAt` or `skippedAt` is written (`first-run/onboarding-first-run.guard.ts:33-36`).
Nothing in this chain knows which provider the user actually uses. A user whose main provider is
OpenAI Codex still sees "Claude Code is not installed / not signed in / could not be checked" as a
warning on every onboarding screen.

The user ran Codex as the main provider, saved an AI team builder run as a draft, returned to the
first page, and saw "Ptah could not check Claude Code." Evidence (context.md): the Electron main
process logged `[event-loop] lag maxMs 5578`, then `agent:detectClis` took 6.0 s and
`provider:getAmbientClaudeStatus` 10.2 s. The host probe
(`libs/backend/auth-providers/src/lib/accounts/claude-ambient-login-status.ts`) runs
`claude --version` with a 10 s limit, then `claude auth status` with 10 s
(`claude-account-command.ts:46-47`), a 20 s attempt budget (`claude-ambient-login-status.ts:9`)
and a 25 s per-read deadline (`:11`, timer at `:69`). A certify timeout or cancellation maps to
`unknown/timeout` (`certifyFailure`, `:96-99`, used at `:215`; aborted or timed-out status
probe at `:217-220`), and a read that finds an unclosed earlier child is answered at once with
the previous result for that key or `unknown/timeout` (`:179-182`, `:251-253`). The store turns
every `unknown/timeout` into the `error` state (`claude-readiness.store.ts:81-87`), which the
banner shows as a warning (`claude-readiness-banner.component.ts:41-45`).

Cause of the observed message — hypothesis, not established: the log does not record the
`reason` the host returned, and the source of the 5.6 s block is unknown (context.md:35-41).
The most probable chain is that the main-process block delayed the probe so that a limit expired
(the 10.2 s duration is close to the 10 s `--version` limit) and the read ended in
`unknown/timeout`, shown as `error`. Other readings fit the same log (an unclosed-child answer,
or an `unreadable`/`local` result). From a shell `claude auth status` takes 0.55 s. AC 5.8
makes the next occurrence diagnosable; the requirements in section 5 hold whichever reading is
true.

What already exists for Codex: `agent:detectClis` returns a `codex` row from
`CodexAppServerLaneAdapter.detect` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:156-175`)
with `path`, `version`, `codexSource: 'installed' | 'bundled'` and `codexReason`
(`libs/shared/src/lib/types/agent-process.types.ts:418-424`). Ptah ships a bundled Codex and falls
back to it when no supported installed Codex exists
(`libs/backend/codex-runtime/src/lib/select-codex-executable.ts:10-15,62,84-87`). The row's
`installed` is a binary fact for lanes: it is `false` only when no binary resolves (`:160`) or
detection throws (`:165-174`), and `true` whenever a binary resolves, even when the credential
check reports `missing`, `stale` or `unreadable`, because `detect` awaits `ensureTokensFresh()`
and discards its boolean (`:161`, `:177-182`; statuses at
`codex-app-server-lane-auth.ts:14,21-52`). An ordinary fresh install without a sign-in is
therefore already reported as installed. The one special case is an explicitly empty home
environment: the cli-engine home resolver throws `Codex home is empty` when `CODEX_HOME` is the
empty string, or when `CODEX_HOME` is unset and `HOME` is empty with no `USERPROFILE`
(`libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts:119-127`); `detect` turns that
throw into `installed: false` (`codex-app-server-lane.adapter.ts:166-168`) although a binary
resolved. The gap is not in the lane row; it is that onboarding reads no Codex fact at all, and
the lane row carries no sign-in fact. The Codex sign-in state is exposed separately:
`auth:getAuthStatus` returns `codexAuthenticated` and `codexTokenStale`
(`libs/shared/src/lib/types/rpc/rpc-auth.types.ts:309-312`), produced by
`AuthStatusProbes.probeCodex` (`libs/backend/rpc-handlers/src/lib/handlers/auth/auth-status-probes.ts:140-168`)
from `CodexHomeAuthService.getTokenStatus` (`libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts:521-535`).
That reply cannot tell a failed check from a signed-out user: a 5 s probe timeout
(`probe-timeout.ts:18,37-50`) and a thrown error both answer
`{ codexAuthenticated: false, codexTokenStale: false }` (`auth-status-probes.ts:141-151,160-167`),
and an auth file that exists but cannot be read or parsed is read as absent
(`codex-home-auth.service.ts:862-871`), the same answer as no sign-in (`:523-525`). The reply is
consumed by `ProvidersSettingsStateService` (`providers-settings-state.service.ts:466`),
`AuthStateService.codexAuthenticated` (`libs/frontend/core/src/lib/services/auth-state.service.ts:323`)
and `auth:checkConnection` (`connection-check.ts:200-206`). An in-app Codex sign-in exists:
`auth:codexLogin` runs `codex login --device-auth` in-process in Electron
(`libs/backend/rpc-handlers/src/lib/handlers/auth/interactive-login-methods.ts:201-240`).
`auth:checkConnection` already checks a saved Codex connection
(`libs/backend/rpc-handlers/src/lib/handlers/connection-check.ts:200-206`).

The user's saved main connection is persisted in two settings, `authMethod` and
`anthropicProviderId` (scoped keys, global / app / workspace,
`libs/shared/src/lib/types/rpc/rpc-auth.types.ts:484-498`). Activating a connection writes
`authMethod: 'claudeCli'` for Claude Code and `authMethod: 'thirdParty'` with
`anthropicProviderId` set to the connection id for Codex
(`providers-connection-setup.service.ts:683-700`). The reader is `auth:getAuthStatus`
(`authMethod`, `anthropicProviderId`, `rpc-auth.types.ts:290-302`), held by `AuthStateService`
as `_persistedAuthMethod` / `_persistedProviderId`, set only on load or a successful save
(`auth-state.service.ts:205-215,1355-1356`), with `isLoading` / `isLoaded` (`:138,266,299,351`).
`AuthStateService.activeProviderId` maps both `claudeCli` and `apiKey` to `anthropic`
(`:391-396`), so it cannot tell Claude Code from an Anthropic API key. The Providers page's
"active" badge is a different fact: `ProvidersSettingsStateService.activeProviderId`
(`providers-settings-state.service.ts:183-204`) is health-gated. It is `null` while the
`auth:getEffectiveRoute` read is not ready, while a save is in flight, when the route is not
ready or `unresolved`, when there is no `driverProviderId`, or when the driver's status is
failing. It is therefore not the saved choice, and it is `null` in exactly the signed-out and
unavailable cases this task targets. Claude Code is provider id `claude-cli` (`nativeAuth: true`,
`libs/shared/src/lib/providers/entries/claude-cli-provider-entry.ts:29`) and Codex is
`openai-codex` (`libs/shared/src/lib/providers/entries/codex-provider-entry.ts:35`). A main chat
on `openai-codex` runs on the native Codex runtime when the host has the `nativeCodex` capability
(`libs/shared/src/lib/types/session-runtime.types.ts:5,37-44`).

How the Providers page saves a main connection today: the main-agent popover calls
`ProvidersSettingsStateService.activateConnection(id, target, context)` through `runDrawerWrite`
(`libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.ts:624-645`;
`connection-drawer/drawer-write.ts:23-45`). Its default `target` is the user's "Save to" choice,
else `workspace` when a workspace is open, else the scope the main-agent model is stored in, else
the first offered target, and `null` (no write) while the model and effort sources are not
loaded (`main-agent-reassign-popover.component.ts:345-364`); the provider write also requires
`writeScopes('authMethod')` to offer that target (`:341,382`). Its confirm copy says that the
change ends running chat sessions in this workspace or in every workspace (`:379-384`).
`activateConnection` resolves `false` only when another save is in flight, and resolves `true`
both after a real save and after it blocks a missing or unloaded connection without writing
(`providers-connection-setup.service.ts:648-664`); the real outcome is `commit().status` after it
resolves (`saved`, `blocked`, `failed`, `partial`, `unconfirmed`;
`providers-commit.service.ts:334-413`). The auth write has no read-back
(`providers-commit.service.ts:87-95`); a thrown RPC is `unconfirmed` ("may have written",
`:420-434`); every run ends with a refresh of the Providers sections, including the effective
route, and reports `refreshFailed` when a section did not reload (`:380-411`, hooks at
`providers-settings-state.service.ts:992-1020`). After `saved`, `activateConnection` also
re-reads `auth:getAuthStatus` (`providers-connection-setup.service.ts:677-679`), but the outcome
of that re-read is invisible: `AuthStateService.refreshAuthStatus(): Promise<void>` discards the
boolean its internal read returns (`libs/frontend/core/src/lib/services/auth-state.service.ts:662-664,1273-1317`),
and a failed read leaves `persistedAuthMethod` / `persistedProviderId` at their old values
(signals are populated only on success, `:1290-1294`). `refreshFailed` is computed before this
re-read from the Providers-section refreshes only (`providers-commit.service.ts:380-385`), so
today a save can report `saved` while the saved selection still shows the previous choice. On the host,
`auth:saveSettings` defaults `applyTo` to `global`; a `workspace` write runs through
`sdkAdapter.applyWorkspaceAuthChange` (ends that workspace's sessions), any other write persists
the settings first and then runs `sdkAdapter.reset()` (ends sessions in every workspace); a
failure after the settings write still rejects the RPC although the settings changed
(`libs/backend/rpc-handlers/src/lib/handlers/auth/connection-settings-methods.ts:111-151`).

The user asked for three things: an explanation and fix for the false "cannot check" message;
Codex install and sign-in detection on the first page, the same way Claude Code is detected, with
install help; and the freedom to choose which connection to use, without being warned about the
one they did not choose.

## Classification

- Type: FEATURE — new provider-aware readiness for two providers, with an embedded BUGFIX (a
  single slow or timed-out mount read is shown as a failure; cause per Context is a hypothesis).
- Estimate: L — crosses the onboarding library, core frontend services, the provider settings
  state and backend probes (auth-providers, cli-agent-runtime, rpc-handlers); three existing UI
  surfaces are redesigned and a parity inventory is required.
- Priority: not defined here.

## Scope

In scope:

- Readiness for two providers, Claude Code and Codex, each reported as installed or not, signed
  in or not, and checking or not checkable, on the surfaces that show readiness today: the
  onboarding Home banner, the progress strip on Home and both Get ready stages, and Get ready
  stage 1.
- Install help and sign-in help for Codex on stage 1, equivalent to what Claude Code has today
  (copyable commands, a link to the official guide, Re-check).
- Letting the user choose, on stage 1, which of the two connections is their main connection,
  using the same setting the Providers page saves.
- Warnings that follow the chosen connection: the connection not chosen is never shown as a
  problem.
- Making a slow check that is caused by host lag stop showing as a "could not check" failure.
- Giving onboarding two separate Codex facts, binary installed and signed in, without changing
  what the lane-facing `codex` detection row reports to existing callers.
- A Codex sign-in check whose result tells timeout, unreadable sign-in data, signed out, stale
  and signed in apart, while the existing `codexAuthenticated` / `codexTokenStale` consumers keep
  their current meaning.
- Updating wording that today assumes Claude Code is the only basis of Ptah (stage 1 lead, the
  stage 2 lead "besides Claude Code", the Home footer link "Review Claude Code and settings",
  the first-run progress record).
- Unit tests and the existing onboarding-ready visual scenarios updated for the new states,
  Electron only.

Out of scope:

- Readiness checks for other main providers (API key, OpenRouter, Copilot, Kimi Code, custom,
  local). When one of them is the main connection, readiness shows it as chosen and links to
  Providers; it does not probe it. Those already have `auth:checkConnection` on the Providers page.
- Finding and fixing the cause of the 5.6 s Electron main-process block that coincided with the
  draft save. This task makes readiness tolerate it; a separate task should profile it
  (orchestrator to open one).
- Changing how chat, lanes or the Codex runtime select or launch a binary, and changing the
  bundled-Codex fallback.
- Named Claude accounts and the Accounts drawer behaviour (kept as is; only the link to it stays).
- The VS Code host. Get ready stays Electron-only (guard and `available` flag), as today.
- Stage 2 content (embedded Providers page and CLI tools matrix), apart from its strip, banner and
  lead wording.
- Files owned by TASK_2026_863_3855 (proposal/*, analyze/*). Edits to
  `onboarding-home.component.ts` must be coordinated with that task.

## Requirements

### 1. Detect both providers the same way

Requirement: Electron onboarding — reports, for Claude Code and for Codex, whether each is
installed and whether each is signed in — so the user sees the real state of both before choosing.

Acceptance criteria:

1. When stage 1 opens in Electron, the system shall show one status area for Claude Code and one
   for Codex, each with an installed fact (path and version when installed) and a signed-in fact.
2. When Codex is available only as Ptah's bundled copy, the system shall report Codex as
   installed and say that the bundled copy is used; it shall not show Codex install help as a
   required step.
3. When a usable Codex binary resolves and the Codex home has no `auth.json` or no token, the
   system shall report Codex as installed and not signed in, with the installed fact taken from
   the binary resolution and the signed-in fact taken from the sign-in check, as two separate
   facts.
4. When the Codex sign-in is present but stale, the system shall report Codex as needing sign-in
   again.
5. When `auth:codexLogin` or an external `codex login` completes and the user presses Re-check,
   the system shall report Codex as signed in without restarting Ptah.
6. When Claude Code is checked, the system shall report the same states it reports today
   (checking, ready, not installed, not signed in, could not check) with the same facts.
7. When either probe fails for a local reason (transport failure, refusal, malformed reply), the
   system shall show "could not check" for that provider only, and the other provider's state
   shall be unaffected.
8. When onboarding gains the Codex facts, the `codex` row of `agent:detectClis` and
   `CodexAppServerLaneAdapter.detect` shall return, for every existing caller, the same
   `installed`, `path`, `version`, `codexSource`, `codexReason` and `messagingMode` values as
   before for the same machine state: `installed: true` when a binary resolves whatever the
   credential status, `installed: false` when none resolves or detection throws. Existing
   cli-agent-runtime and cli-engine detection tests shall pass unchanged.
9. When the home environment is explicitly empty (`CODEX_HOME=''`, or `CODEX_HOME` unset with
   `HOME=''` and no `USERPROFILE`) and a binary resolves, the lane `detect` shall still return
   `installed: false` as today, and onboarding shall report Codex as installed with the sign-in
   fact "could not check" (reason `unreadable`), not as not installed. A test shall cover both
   halves of this case.

Codex sign-in check contract (for AC 1.3, 1.4, 1.7, 1.9 and 5.8). The check onboarding reads
shall return exactly one of these outcomes, each with no token, auth file content, path content
or environment value:

| Outcome | When | Onboarding shows |
| ------- | ---- | ---------------- |
| `signed-in` | API key or a non-stale access token present | Signed in |
| `stale` | access token present and stale under the shared rule (`isCodexAccessTokenStale`) | Needs sign-in again |
| `signed-out` | `auth.json` absent (`ENOENT`/`ENOTDIR`) or has no key and no access token | Not signed in |
| `unreadable` | `auth.json` exists but cannot be read, parsed or validated, or the home is unusable | Could not check (sign-in data unreadable) |
| `timeout` | the check did not answer within its time limit | Could not check (timed out), subject to section 5 |

10. When the sign-in check times out, the system shall report `timeout`, not `signed-out`.
11. When `auth.json` exists but is not valid JSON, is unreadable (for example `EACCES`) or fails
    validation, the system shall report `unreadable`, not `signed-out`.
12. When `auth.json` is absent, the system shall report `signed-out`; tests shall cover
    `timeout`, `unreadable`, `signed-out`, `stale` and `signed-in` as five separate cases.
13. When the new outcome is added, the existing `auth:getAuthStatus` fields `codexAuthenticated`
    and `codexTokenStale` shall keep their current values for every existing consumer
    (`providers-settings-state.service.ts:466`, `auth-state.service.ts:323`,
    `connection-check.ts:200-206`), and no webview payload or log line shall contain a token,
    auth file content or environment value.

### 2. Install and sign-in help for Codex

Requirement: a user without a working Codex — gets install and sign-in steps for Codex next to
the Claude Code steps — so they can set up the connection they want from the first page.

Acceptance criteria:

1. When no usable Codex exists, the system shall show copyable install command rows for Codex with
   the same row behaviour as Claude Code (copy, "Copied" feedback, inline fallback when the
   clipboard rejects, announced to screen readers) and a link to the official Codex install guide
   that opens in the system browser.
2. When Codex is installed but not signed in, the system shall offer a sign-in action that runs
   the existing in-app Codex sign-in, and a copyable `codex login` command as the manual route.
3. When the in-app Codex sign-in fails or is cancelled, the system shall keep the not-signed-in
   state, show that the sign-in did not complete, and keep Re-check available.
4. When a provider is ready, the system shall not show its install or sign-in help.
5. The Codex commands and docs URL shall come from one shared source, as the Claude Code commands
   do (`libs/frontend/core/src/lib/services/claude-code-commands.ts`), and match the official
   Codex documentation at the time of implementation.

### 3. Choose the connection

Requirement: the user — chooses on stage 1 whether Claude Code or Codex is their main connection
— so that onboarding, chat and the Providers page agree on one choice.

Acceptance criteria:

Selection source. The saved choice is the persisted `authMethod` / `anthropicProviderId` pair
as `auth:getAuthStatus` reports it (Context): `claudeCli` is Claude Code; `thirdParty` with
`openai-codex` is Codex; `apiKey` and any other `thirdParty` id are another main connection
(AC 3.15). The health-gated `ProvidersSettingsStateService.activeProviderId` and the effective
route are not the selection source; they are health facts about the saved choice.

1. When stage 1 opens and the saved selection has loaded, the system shall preselect the saved
   connection from the selection source, whatever the effective route reports (unresolved, not
   ready, failing driver, or still loading).
2. When the saved selection has not loaded yet, the system shall show the choice as loading,
   preselect nothing, offer no confirm action, and show no Claude Code or Codex warning on the
   banner or strip as a consequence of the choice.
3. When the saved selection cannot be read (`auth:getAuthStatus` fails), the system shall say on
   stage 1 that Ptah could not read the saved connection, offer a retry, preselect nothing, and
   shall label strip item 1 with the neutral "Connection" label without a Claude Code or Codex
   warning; it shall not write any setting.
4. When the saved choice is Codex, Codex is not signed in and the effective route is
   `unresolved`, the system shall preselect Codex, show Codex as not signed in, show the banner
   naming Codex, and write nothing. A test shall cover this case.
5. When the effective route is not ready or its driver is failing, the system shall show that as
   the state of the saved connection only; it shall not change the preselection.
6. When the user does not change the choice, the system shall not write any provider setting.

Saving a changed choice:

7. When the user chooses the other connection on stage 1 and confirms, the system shall save it
   through the same state service and the same write target the Providers page main-agent popover
   would use with no "Save to" change (see `## Decisions`), and shall state before the confirm
   which sessions the change ends ("in this workspace" or "in every workspace"), as the popover
   does.
8. When no write target is available (sources not loaded, or `authMethod` / `anthropicProviderId`
   not writable at that target), the system shall keep the confirm action unavailable, say why,
   and write nothing.
9. When the save request returns, the system shall treat the choice as saved only when the
   request resolved `true` and the commit status for that request is `saved`. A `false`
   resolution shall show "another save is in progress"; `blocked`, `failed` or `partial` shall
   show that the change was not saved.
10. When the choice is saved and the post-save re-read of the saved selection succeeded
    (AC 3.18), the stage 1 preselection, the banner and the strip shall follow the new choice, and the Providers page shall show the same main connection, without a restart.
    A test shall open the Providers page after a stage 1 save and assert the saved connection.
11. When a chat session was active and the choice is saved, the next main-agent message from chat
    shall run on the new connection (the host's session reset applies, as for a Providers page
    save). A test shall start a chat, switch on stage 1, send a message and assert the new
    connection serves it.
12. When a save fails (`blocked`, `failed`, `partial`, or refused), the system shall keep the
    previous choice, the persisted `authMethod` / `anthropicProviderId` values shall be unchanged,
    the stage shall say that the change was not saved, and the stage shall stay usable. A test
    shall assert the persisted values after a failed save.
13. When the save status is `unconfirmed` (the request threw, for example because the settings
    were written and the host session reset then failed), the system shall not claim either
    success or rollback; it shall re-read the saved selection, show the connection that is
    actually persisted as the preselection, say that the change may not be in effect yet, and
    link to Providers. A test shall simulate a settings write that succeeds followed by a failing
    reset.
14. When the save is `saved` but a following refresh failed (`refreshFailed`), the system shall
    show the new choice as saved, say that some settings could not be refreshed, and keep
    Re-check available; readiness shall be read again by the next Re-check or mount read.
    `refreshFailed` covers the Providers-section refreshes only; a failed re-read of the saved
    selection after the save is AC 3.19, and when both fail AC 3.19 governs stage 1.

Other rules:

15. When the saved main connection is neither Claude Code nor Codex, the system shall show it as
    the chosen connection by name, link to Providers to manage it, and show no Claude Code or
    Codex warning.
16. The system shall not change the main connection on its own (for example because only one
    provider is ready); on a fresh install with neither provider ready it shall preselect the
    saved connection and write nothing (decisions.md decision 5).
17. When the user chooses a connection that is not ready, the system shall allow continuing, as
    "Continue anyway" does today, and keep the warning for that connection on later screens.

Reading back a saved choice (applies to AC 3.10, 3.13 and 3.14):

18. When a stage 1 save reaches `saved`, the system shall re-read the saved selection
    (`auth:getAuthStatus`) and the stage 1 flow shall be able to tell whether that re-read
    succeeded, failed, or was superseded by a newer read (in which case the newer read's outcome
    counts). Whether the refresh reports the outcome or exposes it as state is the architect's
    choice. A failed re-read shall not be reported as a failed or reverted save.
19. When the save is `saved` but the re-read of the saved selection failed, stage 1 shall show
    "saved, status not confirmed": it shall say that the change was saved but Ptah could not
    confirm the saved connection, offer a retry that re-reads the saved selection without writing
    any setting, and link to Providers. Until a re-read succeeds it shall preselect nothing (it
    shall not preselect the previous connection as if the new choice had failed), shall label
    strip item 1 with the neutral "Connection" label, and shall show no warning on the banner,
    strip or stage 1 for the connection the user did not choose. When the retry succeeds, the
    system shall apply AC 3.10 (or AC 3.15 if the persisted value is another connection) from the
    values read; when it fails again, the state shall stay as described here and the retry shall
    stay available. A test shall make `auth:saveSettings` succeed, the Providers-section refresh
    succeed (`refreshFailed` false, status `saved`), and the following `auth:getAuthStatus` fail;
    it shall assert the "saved, status not confirmed" message, no preselection, no warning
    for the previous connection, that the retry calls `auth:getAuthStatus` and not
    `auth:saveSettings`, and that a successful retry preselects the new connection.
20. When the outcome of the re-read becomes detectable (AC 3.18), every existing caller of
    `AuthStateService.refreshAuthStatus` shall keep its current behaviour and need no change
    unless listed here as changing:
    - `providers-connection-setup.service.ts:678` (`activateConnection`, via the hook typed at
      `:90` and bound at `providers-settings-state.service.ts:1019`) — changes: it is the read
      AC 3.18 makes detectable to stage 1; the Providers page popover's displayed outcome stays
      as today.
    - `providers-connection-setup.service.ts:639` (provider setup with "use as main agent") and
      `:418` (Kimi sign-in follow-up) — unchanged.
    - `auth-state.service.ts:789` (`saveAndTest`), `:832` (`deleteApiKey`), `:873`
      (`deleteProviderKey`), `:1109` (`reloadAfterCustomMutation`), `:1256`
      (`clearWorkspaceOverride`) — unchanged.
    - `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts:289`
      (`refreshWorkspaceProviderState`) — unchanged.
    The existing specs that mock `refreshAuthStatus` as resolving nothing
    (`workspace-coordinator.service.spec.ts:216,1010`; `providers-connection-setup.service.spec.ts:124,184`)
    shall pass, changed only where a mock must now report the read outcome for the
    `activateConnection` path.

### 4. Warnings follow the chosen connection

Requirement: banner and strip — reflect the chosen connection — so a user is never told that a
provider they do not use is a problem.

Acceptance criteria:

1. When the chosen connection is Codex and Codex is ready, the system shall show no warning banner
   on Home or stage 2, whatever the Claude Code state is.
2. When the chosen connection is Claude Code and Claude Code is ready, the system shall show no
   warning banner, whatever the Codex state is.
3. When the chosen connection is not installed, not signed in or could not be checked, the system
   shall show the banner naming that provider, with one action that opens stage 1.
4. When the strip renders, item 1 shall name the chosen connection (or a neutral "Connection"
   label) and carry the chosen connection's state word; the provider not chosen shall not set the
   item's "need" marker.
5. When the provider not chosen is not ready, the system may show its state on stage 1 as
   information, without the warning tone or icon used for the chosen connection.
6. When the first-run guard decides whether to send a new user to stage 1, the system shall treat
   leaving stage 1 with the chosen connection ready the same way `claudeAt` is treated today; an
   existing record with `claudeAt` shall keep the user out of the forced redirect.

### 5. A slow check is not a failed check

Requirement: readiness — tolerates a slow Electron main process — so a single slow or timed-out
mount read does not show as "Ptah could not check", and a check that keeps timing out reaches a
bounded terminal state instead of "checking" forever.

Acceptance criteria:

1. When a mount read (Home, stage 1 or stage 2) of a provider ends in a timeout outcome, the
   system shall not show the "could not check" banner or the strip's "Could not check" word for
   it from that read alone; it shall show a non-warning "taking longer than usual" state and
   start an automatic follow-up check without user action.
2. The automatic follow-up checks for one mount read shall be bounded: at most two follow-up
   checks per provider after the first timeout, each bounded by the existing per-read deadline
   (25 s for Claude Code, `claude-ambient-login-status.ts:11`; the Codex check's own limit), so
   that the terminal state is reached no later than 90 s after the mount read started. The
   architect may lower the count to one; raising it needs this document amended.
3. When every automatic follow-up check also ends in a timeout, the system shall settle to the
   terminal "could not check" state with the timeout explanation, show the banner and strip word
   for the chosen connection as today, and start no further automatic check until the next mount
   read or a user Re-check. A test shall drive all follow-ups to timeout and assert the terminal
   state and that no further check starts.
4. When a follow-up check returns a non-timeout result (ready, not installed, not signed in,
   unreadable, local failure), the system shall show that result at once and stop the follow-ups.
5. When a probe is delayed by a main-process block like the one observed (about 6 s, from the
   5578 ms lag in the dev log) and the provider is actually installed and signed in, the system
   shall settle to ready. A test shall simulate this delay.
6. When a user-started Re-check ends in a timeout, the system shall show "could not check" with
   the timeout explanation at once, as stage 1 does today, without automatic follow-ups.
7. When a read is answered at once because an earlier probe child has not closed, the system shall
   not show that answer as a failure while that child is still running; it shall count as a
   timeout outcome under AC 5.1-5.3.
8. When the host log records a readiness result, it shall record the provider, the outcome and
   its reason (`timeout`, `unreadable`, `cli-missing`, `local` for Claude Code; the Codex outcomes
   of section 1) and whether it was a mount read, a follow-up or a Re-check, without any
   credential, so a future false result can be diagnosed from the log.
9. When the user returns to Home repeatedly, the system shall not start more than one probe per
   provider at a time, and a new mount read shall not add follow-ups beyond the bound of AC 5.2.

### 6. Existing capabilities are kept

Requirement: every readiness capability listed in `parity-inventory.md` — keeps working or is
moved as recorded there.

Acceptance criteria:

1. When the task is complete, every row in `parity-inventory.md` marked keep or move shall be
   proven by the test named in that row.
2. When the host is not Electron, the system shall render no strip, banner, Get ready link or
   provider choice, make no readiness RPC, and redirect `/onboarding/ready*` to Home, as today.

## Non-functional requirements

- Compatibility: Electron first; the renderer stays in `apps/ptah-extension-webview`. Provider CLI
  lanes (including the `codex` lane) and the benchmark's `platform-cli` and `cli-engine` libraries
  shall keep working; any change to `CliDetectionResult` or `CodexAppServerLaneAdapter.detect`
  shall keep current lane detection results for existing callers. Scoped checks shall cover every
  changed project and the affected Electron and renderer projects.
- Accessibility: status shall not rely on colour alone (as the strip does today); each provider
  status is announced; Re-check results are announced per provider; tab lists keep arrow-key
  wrapping; the provider choice is operable by keyboard and exposes its selected state to
  assistive technology; focus moves as stage 1 does today when a check settles ready.
- Theming: all new and changed surfaces pass the existing onboarding-ready contrast sweep in dark
  and light themes and in reduced transparency (`onboarding-ready-visual.e2e.spec.ts:418-502`).
- Layout: the existing 400 px narrow scenarios keep working for stage 1 with two providers.
- Security: no Codex or Claude token, auth file content or environment value reaches the webview
  or the log; the webview receives states and reasons only, as `ClaudeAmbientStatusService`
  already enforces (`claude-ambient-status.service.ts:95-101`).

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| ----------- | ------------------------------- | ---------------------- |
| Codex-first user (the requester) | Not to be warned about Claude Code; see Codex status and help | Home shows no warning when Codex is chosen and ready |
| New Electron user without either CLI | Clear install and sign-in steps for the provider they pick | Can reach a ready state from stage 1 alone |
| Claude Code user | Nothing they rely on today lost | Stage 1, banner and strip behave as before for Claude Code |
| Lane and benchmark maintainers | Lane detection and `platform-cli`/`cli-engine` unchanged in behaviour | Existing lane and cli-engine tests pass |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Giving onboarding separate Codex installed and signed-in facts changes what lanes see from `detect` (including the empty-home `installed: false` case) | MEDIUM | HIGH | Architect sources the onboarding facts without changing the lane row (AC 1.8, 1.9); developer runs the cli-agent-runtime and cli-engine detection tests unchanged |
| Splitting the Codex sign-in outcome changes `codexAuthenticated` / `codexTokenStale` for Providers, chat and `auth:checkConnection` | MEDIUM | HIGH | Architect adds the outcome beside the existing fields (AC 1.13); tester asserts the existing fields per case |
| A workspace-scoped save from onboarding surprises a user who expected every workspace to change | MEDIUM | MEDIUM | Stage 1 states the save target and which sessions end before the confirm (AC 3.7); ui-ux-designer places that copy |
| Saving the main connection from onboarding diverges from the Providers page save path | MEDIUM | HIGH | Architect routes the choice through the existing provider settings save; tester checks AC 3.7, 3.9-3.13 and 3.18-3.20 against the Providers page and the persisted settings |
| Tolerating timeouts hides a real hang | MEDIUM | MEDIUM | AC 5.2-5.3 bound the automatic follow-ups and end in a visible failure, AC 5.6 keeps it after a user Re-check; developer logs the reason (AC 5.8) |
| Parallel edits with TASK_2026_863_3855 on `onboarding-home.component.ts` | HIGH | MEDIUM | Orchestrator sequences the merge and rebases this branch before review |
| Codex install commands go stale | LOW | MEDIUM | Single command source (AC 2.5); developer checks the official guide at implementation |

## Open questions

- Which onboarding flows (workspace analysis, agent generation) need Claude Code even when Codex is
  the main connection? The requester saved an AI team builder draft on Codex, so at least that
  path runs without it. Software architect to confirm from `agent-generation` and
  `workspace-intelligence`; the banner wording depends on it.
- Should the first-run record rename `claudeAt`, or keep it and add a provider-neutral field?
  Software architect; AC 4.6 requires old records to keep working either way.

## Decisions

| Decision | Options | Evidence | Reversible |
| -------- | ------- | -------- | ---------- |
| "Choose a connection" means the existing persisted main-connection settings `authMethod` / `anthropicProviderId`, not a new onboarding preference and not the health-gated `activeProviderId` | New preference / persisted settings / effective-route `activeProviderId` | The pair is what the Providers page writes (`providers-connection-setup.service.ts:683-700`) and `auth:getAuthStatus` reads (`auth-state.service.ts:1355-1356`); `activeProviderId` is `null` when the route is unresolved, not ready, saving or failing (`providers-settings-state.service.ts:183-204`) | Yes |
| Bundled Codex counts as installed | Require user install / accept bundled | Ptah selects bundled Codex when no supported install exists (`select-codex-executable.ts:62,84-87`) | Yes |
| Codex sign-in uses the existing in-app `auth:codexLogin` plus a manual command | New flow / existing RPC | `interactive-login-methods.ts:201-240` runs it in-process in Electron | Yes |
| Other main providers are shown, not probed | Probe all / show only | Request names Claude Code and Codex; Providers page already checks others | Yes |
| Get ready stays Electron-only | Extend to VS Code / keep | `onboarding-ready-host.guard.ts:9-11`, `ClaudeAmbientStatusService` inert outside Electron (`:52-55`); CLAUDE.md Electron first | Yes |
| The main-process lag source is a separate task | Fix here / separate | Its cause is unknown (context.md); the user-visible defect is the false error | Yes |
| Stage 1 writes the main connection through `ProvidersSettingsStateService.activateConnection` at the target the Providers page main-agent popover preselects with no "Save to" change (workspace when one is open, else the main-agent model's source scope, else the first offered target) | Always global (the `auth:saveSettings` default) / popover default / a new onboarding "Save to" control | The popover is the Providers page's main-connection switch (`main-agent-reassign-popover.component.ts:345-364,624-645`); the request asks that onboarding, chat and Providers agree on one choice; a different default would make the two surfaces write different scopes for the same action | Yes — the target rule is one input to the stage 1 save |
| A stage 1 save counts as committed only when `activateConnection` resolves `true` and `commit().status` is `saved` | Trust the boolean / read the commit status / add a read-back | `activateConnection` returns `true` after blocking without a write (`providers-connection-setup.service.ts:654-664`); `commit()` is the only per-request outcome (`providers-commit.service.ts:334-413`) | Yes |
| Automatic follow-ups after a mount-read timeout are bounded at two per provider, terminal state "could not check" within 90 s | Unbounded / one / two / none | The finding requires a terminal state; 90 s is three reads at the existing 25 s deadline plus spacing (`claude-ambient-login-status.ts:11`); the count may only go down without returning here | Yes |
| The Codex sign-in check reports five outcomes (signed-in, stale, signed-out, unreadable, timeout) beside the existing booleans | Change the booleans / add an outcome / keep as is | Today timeout and exceptions answer as signed-out (`auth-status-probes.ts:141-167`) and an unreadable file reads as absent (`codex-home-auth.service.ts:862-871`); existing consumers read the booleans (`providers-settings-state.service.ts:466`) | Yes |
| The Codex lane `detect` result is not changed; onboarding takes its Codex facts beside it | Change `installed` / add fields / leave the row as is | CLAUDE.md requires provider CLI lanes and `cli-engine` to keep working; `installed` is already a binary fact except the empty-home case (`codex-app-server-lane.adapter.ts:156-175`) | Yes |

## Handoff

- Next specialist: ui-ux-designer, then software-architect.
- Why: the three readiness surfaces are redesigned for two providers and a choice, so the visual
  specification comes first; the architect then settles how onboarding sources the Codex facts
  beside the unchanged lane row, the Codex sign-in outcome, the stage 1 save and the bounded
  follow-ups, which cross backend and frontend.

## Revision 1

Response to `task-description-review.md` (Verdict REVISE). Each finding was checked in the cited
code before the document changed.

1. Codex detection account (Serious). Confirmed: `detect` returns `installed: true` whenever a
   binary resolves and discards the credential result (`codex-app-server-lane.adapter.ts:156-182`);
   `installed: false` with "Codex home is empty" comes only from an explicitly empty home
   environment (`codex-lane-runtime-composition.ts:119-127`). Context rewritten; scope item now
   asks for separate binary and sign-in facts for onboarding without changing the lane row.
   AC 1.3 reworded; AC 1.8 pins lane-facing detection values for existing callers; AC 1.9 keeps a
   test for the empty-home case (lane still `installed: false`, onboarding installed with sign-in
   "could not check"). Risk row and decision added.
2. `activeProviderId` is health-gated (Serious). Confirmed (`providers-settings-state.service.ts:183-204`).
   Named the persisted source: settings `authMethod` / `anthropicProviderId`
   (`rpc-auth.types.ts:484-498`), written per `providers-connection-setup.service.ts:683-700`,
   read by `auth:getAuthStatus` into `AuthStateService._persistedAuthMethod` /
   `_persistedProviderId` (`auth-state.service.ts:205-215,1355-1356`). Noted that
   `AuthStateService.activeProviderId` cannot tell Claude Code from an API key (`:391-396`).
   AC 3.1-3.5 specify preselection, loading and read-error behaviour separately from route
   health; AC 3.4 is the test for a saved Codex choice, not signed in, unresolved route.
   Decision 5 kept as AC 3.16. Decisions table row corrected.
3. Codex auth failure collapse (Serious). Confirmed: timeout and thrown errors answer
   `{ codexAuthenticated: false, codexTokenStale: false }` (`auth-status-probes.ts:140-168`), and an
   unreadable auth file reads as absent (`codex-home-auth.service.ts:862-871`). Added the Codex
   sign-in check contract (signed-in, stale, signed-out, unreadable, timeout) with AC 1.10-1.13,
   five test cases, unchanged existing booleans and the token-free webview and log rule.
4. Stage 1 write unspecified (Serious). Confirmed `activateConnection` returns `true` after a
   block without a write (`providers-connection-setup.service.ts:648-680`) and the host's
   global-default, reset-or-workspace-change behaviour (`connection-settings-methods.ts:111-151`).
   Context now describes the Providers page save path. AC 3.7-3.14 specify the write target
   (popover default, logged under `## Decisions`), committed-save detection (`true` plus
   `commit().status === 'saved'`), refresh of the route, banner, strip and Providers page, the
   next chat message on the new connection, and the `unconfirmed` and `refreshFailed` cases.
   Tests added: saved choice shown on the Providers page (AC 3.10), active chat after the switch
   (AC 3.11), persisted selection unchanged after a failed save (AC 3.12), settings written then
   reset failing (AC 3.13).
5. Lag cause stated as fact (Minor). The Context now labels the cause a hypothesis and lists the
   other readings the log allows (context.md:35-41). AC 5.2-5.4 add a bounded automatic
   follow-up (at most two per provider, terminal "could not check" within 90 s, nothing further
   until the next mount read or Re-check). Reason logging kept and widened to name the provider
   and read kind (AC 5.8); the simulated-lag test kept (AC 5.5). Section 5 renumbered; risk and
   handoff text updated. The context paragraph's probe line references were also corrected
   (`certifyFailure` is `:96-99`, the unclosed-child answer `:179-182`).
6. Stale inventory lines (Minor). Corrected rows for stage 1 (constructor mount read
   `:521-523`, Re-check and focus `:543-554`, Continue / Continue anyway `:556-564`, and the class
   members of rows 37-47 that pointed 20-25 lines early). Row 39 now cites the install block and tablist
   template `:259-294`, `osTab` `:516-519` and `onOsTabKey` `:531-541`. Every other row was re-checked with
   `ptah_ast_analyze` and a direct read; the visual spec range now ends at `:502`. New rows cover
   the lane `detect` result, the Codex sign-in booleans and the Providers page main-connection
   save, which this task must keep.

No point needed a user-only decision, so there is no `## Clarifications Needed` section. The
write-target choice (finding 4) is reversible, consistent with the Providers page, and logged
under `## Decisions`.

## Revision 2

Response to the remaining Serious finding in `task-description-review.md` (finding 1, post-save
auth-status re-read). Checked in the code before the document changed.

1. Post-save re-read invisible (Serious). Confirmed: `activateConnection` calls
   `hooks.refreshAuthStatus()` only after `commit().status === 'saved'`
   (`providers-connection-setup.service.ts:677-679`); `refreshAuthStatus(): Promise<void>`
   discards the boolean from `fetchAndPopulateAuthStatus` / `readAuthStatus`
   (`auth-state.service.ts:662-664,1273-1317`); the persisted signals are populated only on a
   successful read (`:1290-1294`); `refreshFailed` is computed earlier from
   `hooks.sectionsReady()` (`providers-commit.service.ts:380-385`). Context paragraph extended
   with this gap. New AC 3.18 makes the re-read's outcome (success, failure, superseded)
   detectable to the stage 1 flow, leaving the mechanism to the architect; new AC 3.19 defines
   the "saved, status not confirmed" stage 1 state (no preselection, neutral strip label, no
   warning for the connection not chosen, read-only retry, Providers link) and its test
   (`auth:saveSettings` succeeds, Providers-section refresh succeeds, `auth:getAuthStatus`
   fails); new AC 3.20 lists every existing `refreshAuthStatus` caller with file:line and states
   that only the `activateConnection` path changes. AC 3.10 now requires a successful re-read;
   AC 3.14 states that `refreshFailed` does not cover this read and that AC 3.19 governs when
   both fail. The save-path risk row and the parity inventory row for the Providers page main-connection
   switch cite the new criteria. The new criteria
   are numbered after AC 3.17 so that earlier references (AC 3.15, 3.16) keep their meaning.
