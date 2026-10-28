# Implementation Plan - TASK_2026_719 Phase P5 (Accounts tab in the Claude (Subscription) drawer)

## Revision 1

Gate 2 review round 1 (`implementation-plan-p5-review.md`, codex, REVISE 6/10). Each finding and the section changed:

1. Blocking - badge partial count during ambient load/failure: §7 `connectedAccountCount` now requires a ready,
   non-stale account snapshot and a ready, non-failed ambient result whose state is `connected` (+1) or
   `signed-out` (+0); idle, checking, local failure and host `unknown` hide the badge. Tests added to §7 and §14
   (positive named count with each ambient state, recovery, pushed account change). Decision P5-D13.
2. Moderate - verify lists: every batch `-p` list in "Batches" re-derived from the dependency graph (derivation note
   added under "Batches"): ptah-tui added to B1-B3, ptah-extension-webview to the shared-type batches B1 and B3,
   ptah-extension-vscode to F1-F7; N corrected for each.
3. Moderate - probe concurrency: §4 now specifies a serial single-child slot (same-key join, one queued follow-up for
   refresh, abort-and-await of a different-key active probe, retained receipts block spawning). The "started at most
   milliseconds before" claim is removed; the refresh-while-running policy is explicit. Deferred-command tests added
   to §4. Decision P5-D14.
4. Moderate - `checkedAt` provenance: §1 type is `checkedAt: string | null`; §4 blocked reads return the earlier
   completed attempt unchanged (or `null`); §6 transport failure sets `result: null` + `localFailure` with no
   timestamp; §7 ambient row shows no age without a host `checkedAt`. Tests added to §4 and §6. Decision P5-D15.

## Revision 2

Gate 2 re-review (`implementation-plan-p5-review-r1.md`, codex, REVISE 8/10; findings 1-4 closed). New Moderate
item: a queued read could outlast the 30 s webview RPC timeout. Fix: §4 step 7a adds a queue-inclusive per-read host
deadline of 25 s (answer `unknown/timeout/checkedAt: null`, active child and receipts untouched), §4 verification
seam adds the deferred-clock regression test, §6 states the 25 s < 30 s relation. Decision P5-D16. Nothing else
changed.

Worktree (the only place to read, edit and verify): `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts`
(branch `feat/claude-named-accounts`). All paths below are relative to it unless absolute.

## Inputs and constraints

- Requirements used: `context.md`, `decisions.md` D38-D41 (D41 user decision: card badge), `design-spec-p5.md`
  (revision 2, Decision 14), `prototype/p5/index.html` (behaviour reference only; the written spec wins),
  `design-spec-p5-review-r1.md` (R1-R5, backend contract assessment), `design-spec-p5-review-r2.md` (two binding
  rules relayed by the coordinator), `parity-inventory-p5.md` (74 rows, numbered as in design-spec §6).
- Corrections applied:
  - D41 replaces design-spec Decision 9 and the §2 sentence "Nothing loads before the drawer opens": the
    Providers page now makes one `provider:listAccounts` read and one cached ambient read for the card badge.
  - R1: omitted and explicit ambient selections show "Existing Claude login"; only a named selection whose
    account is absent is "unavailable".
  - R2: an unconfirmed write never changes the displayed selection or chips; the existing automatic re-read
    reconciles them.
  - R3 / design-spec §3.7 busy rule is the controlling rule. design-spec §5 line 99 "Select write -> focus stays
    on that select" and parity row 25 "focus stays on select" are superseded by binding rule B-2 below.
  - Binding rule B-1 (review r2, coordinator): account removal never assigns a selection locally. The last
    authoritative snapshot stays until the host returns its committed snapshot
    (`libs/frontend/core/src/lib/services/provider-accounts-state.service.ts:274-285` delegates to `write`, which
    applies only the host snapshot at `:619`). A host-confirmed omitted/ambient result is valid; a hard-coded one is
    not. Any absent named target is handled by the general "named target not in `accounts`" rule, never by fixture.
  - Binding rule B-2 (review r2, coordinator): after an async operation completes, focus returns to the
    operation's waiting target only if `document.activeElement` is still that waiting target and the originating
    view (same Accounts list or same account detail) is still active. Otherwise the user's current focus is kept and
    the completion is announced in the polite live region.
  - The design's unsafe-label wording ("up to 40 ... no slashes") is a stand-in that contradicts the real validator
    (`libs/shared/src/lib/types/provider-account.types.ts:139-148`: 1-64 characters, no leading/trailing space, no
    control character). No validator message exists today; Decision P5-D7 fixes the copy.
- Design handoff used: `design-spec-p5.md`, `prototype/p5/index.html`.
- Missing decision-critical input: none. The parallel codex re-review of the design may add small copy or layout
  corrections; they apply to the frontend batches without changing component boundaries.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `status()` refuses unless the reserved route holds, guards spawn with the route identity and revalidates after close | `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:322-337` | The ambient probe must be a separate method; `status()` stays untouched (named-route guard intact) |
| `run()` is the single child owner: limit timer, output cap, tree kill, close receipt when the child outlives the grace | `claude-account-command.ts:303-391`; limits `CLAUDE_ACCOUNT_CHILD_LIMITS` `:45-54` (status 10 s, 16 KiB, grace 2 s) | The ambient probe reuses `run()` inside the same class; bounded by construction |
| `certifyExecutable()` discovers and version-certifies the CLI, cached by path + fingerprint; `unsupported-store` when no CLI / WSL / too old | `claude-account-command.ts:248-315` | Ambient probe gets its executable from here; `unsupported-store` maps to `unknown` + `cli-missing` |
| `parseClaudeAccountStatus` returns `null` when the output proves no state; `{loggedIn:false}` only when `authMethod === 'none'` and exit 1 | `libs/backend/auth-providers/src/lib/accounts/claude-account-status.ts:88-123` | Reused as the parser; `null` maps to `unknown` (`unreadable`), never to signed-out. Class, identity reference and directory match are dropped |
| Ambient SDK runs inherit `process.env` (plus auth env) | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1445-1460` | The effective ambient login directory is the host env's `CLAUDE_CONFIG_DIR` or the CLI default |
| Certified env allowlist and digest are exported from agent-sdk | `libs/backend/agent-sdk/src/index.ts:455-467` (`CLAUDE_CERTIFIED_ENV_KEYS`, `certifiedEnvDigest`, `isCertifiedClaudeEnvKey`); allowlist `claude-certified-launch.ts:14-62`; digest `:231` | Probe env = allowlisted keys + the two Claude directory keys when present; cache key = its digest |
| `ClaudeAccountCommand` registered by factory; account services registered in `registerProviderAccountServices` | `libs/backend/auth-providers/src/lib/di/register.ts:162-226` | The ambient reader is registered there by factory (same pattern, every host) |
| Status receipts of unproved children are kept and disposed by the owner | `libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts:226-250` | The reader keeps its own receipt set and refuses a new spawn while one is unclosed |
| Account RPC handler: `on()` parses with Zod before `run`; `METHODS = PROVIDER_ACCOUNT_RPC_METHOD_NAMES` | `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts:202`, `:236-304`, `:313-332` | New method goes into the same handler and the same `providerAccounts` capability (Electron-only) |
| Handler constructor injects `ProviderAccountService` by class and the actions port by token | `provider-account-rpc.handlers.ts:223-234` | The reader is injected by class with a local structural type (no new token) |
| Schemas map every method name; strict objects | `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.schema.ts:51-145` | A new name in the tuple fails to compile without its schema: tuple, schema, handler, record ship together |
| Method tuple + registry slice + in-sync proof | `libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts:35-46`, `:258-326` | Contract edits go here; registry merged into `RpcMethodRegistry` by `extends` (`libs/shared/src/lib/types/rpc.types.ts:785`) |
| `RPC_METHOD_ENTRIES` lists every account method | `libs/shared/src/lib/types/rpc.types.ts:3193-3205`; `RPC_METHOD_NAMES` derived at `:3538` | Add `'provider:getAmbientClaudeStatus': true` there |
| `provider:` is already an allowed prefix | comment `rpc.types.ts:3193-3195`; allowlist spec reads the tuple `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts:38`, `:156` | No allowlist change needed; spec covers the new name automatically |
| Manifest entry `providerAccounts` requires the `providerAccounts` capability | `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:513-519` | VS Code and CLI exclude the new method automatically |
| VS Code and CLI absent lists are filtered by live names | `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:116-127`, `:181-183`; `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts:50-61`, `:70-72` | Add the new name to both absent lists; safe before the name is live |
| Electron smoke resolves the handler and asserts its registered names | `apps/ptah-electron/src/di/container.smoke.spec.ts:342-380` ("ten methods") | Must register a stub reader and say eleven methods |
| `expected-resolvable.ts` lists handler classes only; `ProviderAccountRpcHandlers` is not in it | `apps/ptah-electron/src/di/expected-resolvable.ts:14-25`; VS Code lists it as absent `apps/ptah-extension-vscode/src/di/expected-absent.ts:61`, `:84-86` | No change to `expected-resolvable.ts` (any host) or `expected-absent.ts`; no `surface-composition.spec.ts` change (no account entries there) |
| Add/rename validate only `isSafeProviderAccountLabel`; no uniqueness anywhere | `libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts:192-227`; `provider-account.store.ts:301-333`, `:586-588` | D40 host-side unique-name enforcement is missing: add it in the store transaction |
| Store errors carry a safe sentence that reaches the UI | `libs/backend/auth-providers/src/lib/accounts/provider-account-route.ts:16-22`; duplicate-route precedent `provider-account.store.ts:309-312`; pass-through `provider-account-rpc.handlers.ts:713-720`, `:784-794` | Duplicate name = `ProviderAccountStoreError('conflict', PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY)` |
| Safe summary forbids `/ \ : = $ % @` etc. | `libs/shared/src/lib/types/provider-account.types.ts:83-100`, `:151` | "That name is already used. Names must be different." passes |
| State service: root-provided, inert off Electron, `MESSAGE_HANDLERS` push, revision-ordered `apply`, unconfirmed write re-reads | `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts:155-185`, `:225-247`, `:500-531`, `:609-612` | Host pushes already live for the app lifetime (design §2 "drawer lifetime" holds); R2 reconciliation already exists |
| `setDefault` and kind `'default'` exist only for the removed action | `provider-accounts-state.service.ts:52-60`, `:397-424`; only caller `accounts-section.component.ts:670-678` | Delete with the old section (D40.2) |
| State service public entry is re-exported from the settings state file | `libs/frontend/core/src/lib/services/providers-settings-state.service.ts:85-94` | New ambient service is re-exported there |
| Drawer tabs by kind; `SETUP_COPY` typed over every non-overview tab id; tab reset effect | `libs/frontend/chat/src/lib/settings/providers/connection-drawer/connection-kind.ts:11-29`, `:50-52`; `connection-detail-drawer.component.ts:41-45`, `:178-186`, `:250-256` | Add `accounts` id; `SETUP_COPY` excludes it; Accounts tab filtered by an `accountsAvailable` input |
| Tab strip is `flex` without wrap; drawer host adds `whitespace-nowrap` | `libs/frontend/ui/src/lib/native/tab-group/native-tab-group.component.ts` template (`role="tablist"`, `class="flex items-center gap-1 ..."`); `connection-detail-drawer.component.ts:80` | Wrapping is set from the drawer host (Decision P5-D6), the ui lib stays unchanged |
| Native modal on `<dialog>` with trap and focus restore | `libs/frontend/ui/src/lib/native/modal/native-modal.component.ts:1-40`, `:107-129` | Remove confirmation uses `ptah-native-modal` (design Decision 12) |
| Base-page mount and Electron gate | `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts:356-362`, `:562-563` | Removed from the page; the gate moves to the drawer input |
| Drawer open/close owners | `providers-settings.component.ts:447-486`, `:1134-1146` | Badge refresh hooks into `closeDrawer()` |
| Card shows a `Used by N` text badge | `libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.ts:116-126`, `:181` | Badge "N connected" uses the same slot and style |
| Relative-age helper | `libs/frontend/chat/src/lib/settings/providers/connection-drawer/overview-tab.component.ts:111-120` (`checkedAgo`) | Same banding rules for "Last checked ..." (separate copy, see P5-D9) |
| Project tags | `libs/frontend/chat/project.json:7` (`scope:webview`, `type:feature`); `libs/frontend/core/project.json:7` (`scope:webview`, `type:core`) | No new project; chat may import core (existing direction) |

## Architecture decision

- Chosen approach:
  1. Backend: a read-only ambient probe method on `ClaudeAccountCommand` (no route, no launch guard, allowlisted env),
     wrapped by a new `ClaudeAmbientLoginStatusReader` (timeout budget, single flight, short cache keyed to the probe
     env digest, receipt ownership, failure -> `unknown`). Exposed as `provider:getAmbientClaudeStatus` on the
     existing `ProviderAccountRpcHandlers` behind the existing Electron-only `providerAccounts` capability.
  2. Host-side unique names in the store transaction (insert and rename), with one shared label-key helper and a
     reserved name.
  3. Frontend: a root `ClaudeAmbientStatusService` in core; in chat a pure presentation module plus five small
     standalone OnPush components (`accounts-tab`, `account-use-for`, `ambient-account-row`, `add-account-form`,
     `account-detail-view`) mounted as the `accounts` tab of the connection drawer; the base-page section and the
     four old components are deleted; the card gets a display-only "N connected" badge.
- Rationale: design-spec §2/§8 and D40/D41; every reused pattern is cited above. Putting the method in the existing
  handler keeps the capability gate, DI census and allowlist unchanged except for name lists.
- Rejected alternatives:
  - Call `ClaudeAccountCommand.status()` with a synthetic route: forbidden by design §8.1 and would weaken the route
    guard.
  - Inferring status from `auth:checkConnection` / CLI detection: forbidden (design §3.2; detection only,
    `parity-inventory-p5.md:137-139`).
  - A separate `ClaudeAmbientRpcHandlers` class: adds a manifest entry, a DI census row on three hosts and a
    capability decision, for one method.
  - A unique index migration: existing rows may already share a label; a migration would fail or need a data fix.
    The store already serialises writes in `atomic()`, so an in-transaction check is race-free.
  - Adding a `wrap` input to `NativeTabGroupComponent`: touches a lib used by every host for one consumer.
- Assumptions (implementer must resolve, each with its check):
  - A1: the `claude-cli` (subscription) connection passes no `CLAUDE_CONFIG_DIR`/credential override through its auth
    env, so the host env decides the ambient login directory. Check: grep the `AuthEnv` producer for `authMode`
    `cli` in `libs/backend/auth-providers/src/lib/auth/` and `sdk-query-options-builder.ts:1440-1450`. If an override
    exists, include it in `ambientProbeEnv` and in the cache key.
  - A2: `claude auth status --json` signed-in output for a non-personal login still parses (class O) - true by
    `claude-account-status.ts:113-122`; connected = `loggedIn: true` of any class.
  - A3: `commit()` turns a thrown `ProviderAccountStoreError` into `refusalFrom` (seen at
    `provider-account-rpc.handlers.ts:605-606`, `:613`). Check by the new handler spec case.
  - A4: the order of `surface.excluded` in both rpc-surface specs is the registry order; place the new name where
    the spec run puts it.
- Effect on existing code: `ClaudeAccountCommand.status()` and `logout()` unchanged; `provider:setAccountDefault` RPC
  kept on the host (Decision P5-D3); frontend `setDefault` deleted; `accounts-section`, `account-chooser`,
  `add-account-dialog`, `account-details-drawer` (and specs) deleted; lane header / session labels untouched
  (inventory §9).

## Component specifications

### 1. Shared account-name rule and ambient status types

- Purpose: one definition of name uniqueness and of the ambient status value, used by host and UI.
- Responsibilities (in `libs/shared/src/lib/types/provider-account.types.ts`):
  - `PROVIDER_ACCOUNT_RESERVED_LABEL = 'Existing Claude login'`.
  - `providerAccountLabelKey(label: string): string` = `label.trim().toLowerCase()`.
  - `isProviderAccountLabelTaken(label, existingLabels: readonly string[]): boolean` - true when the key equals the
    reserved label key or any existing label key. Callers pass the labels to compare (excluding the renamed one).
  - `PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY = 'That name is already used. Names must be different.'` (must pass
    `isSafeProviderAccountSummary`).
  - `PROVIDER_AMBIENT_CLAUDE_STATES = ['connected', 'signed-out', 'unknown'] as const`,
    `PROVIDER_AMBIENT_CLAUDE_REASONS = ['cli-missing', 'timeout', 'unreadable'] as const`,
    `interface ProviderAmbientClaudeStatus { state; checkedAt: string | null; reason?: ... }` (`reason` only with
    `unknown`). `checkedAt` is the ISO time at which a host probe attempt for the current ambient environment
    completed; it is `null` when no attempt for that environment has completed (Revision 1, finding 4). It is never
    minted by a read that did not run a probe.
- Verified contracts: `isSafeProviderAccountLabel` `provider-account.types.ts:139-148`; `isSafeProviderAccountSummary`
  `:151`; selection union `:217-220`.
- Dependencies: none (zod-free shared barrel).
- Failure behaviour: pure functions.
- Verification seam: new spec `libs/shared/src/lib/types/provider-account-label.spec.ts` (trim/case, reserved name,
  renamed-row exclusion done by caller, summary passes the safe check, tuple constants).
- Files: MODIFY `libs/shared/src/lib/types/provider-account.types.ts`; CREATE
  `libs/shared/src/lib/types/provider-account-label.spec.ts`.

### 2. Host-side unique names (store)

- Purpose: D40 enforcement independent of the UI.
- Responsibilities: inside the existing `atomic()` transaction of `insert` (`provider-account.store.ts:306-321`) and
  `rename` (`:323-333`) read live labels (`SELECT profile_id, label FROM provider_account_profiles WHERE provider =
  'claude' AND removed_at IS NULL`, parameterised), exclude the renamed `profile_id`, and throw
  `ProviderAccountStoreError('conflict', PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY)` when
  `isProviderAccountLabelTaken` is true. Renaming an account to its own name with different case is allowed
  (excluded row). Rows that already share a label are left as they are; only new writes are checked.
- Verified contracts: `ProviderAccountStoreError` `provider-account-route.ts:16-22`; live-row filter precedent
  `provider-account.store.ts:162`; replay path in `provider-account.service.ts:201-205` returns the prior row before
  `insert` runs, so an idempotent replay is not refused.
- Failure behaviour: `conflict` with the safe sentence -> handler `refusalFrom` -> UI shows it in the form's alert
  slot (rows 40, 42, 65).
- Verification seam: `provider-account.store.spec.ts` cases: add duplicate (case/space variants), add reserved
  name, rename to another account's name, rename to own name in other case, removed account's name reusable,
  same-request replay still returns the stored account (service path if the spec covers it).
- Files: MODIFY `libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts`, MODIFY
  `libs/backend/auth-providers/src/lib/accounts/provider-account.store.spec.ts`.

### 3. Ambient probe on `ClaudeAccountCommand`

- Purpose: run `claude auth status --json` once for the ambient login, with the same child limits.
- Responsibilities: new public method
  `ambientStatus(request: { executable: ClaudeCertifiedExecutable; env: Readonly<Record<string,string>>; signal: AbortSignal }): Promise<ClaudeAmbientStatusProbeOutcome>`
  where the outcome is `{ status: ClaudeAccountStatus | null; terminated: boolean; timedOut: boolean; closeReceipt?: ClaudeChildCloseReceipt }`.
  Uses `this.run()` with `cwd: this.host.tempDir()`, `limitMs: CLAUDE_ACCOUNT_CHILD_LIMITS.statusMs`,
  `outputBytes: statusOutputBytes`, no `launchGuard`; parses with `parseClaudeAccountStatus(stdout, exitCode,
  env.CLAUDE_CONFIG_DIR ?? '', host.platform)` only when the child closed on its own (same rule as `status()` line
  333-335). Does not touch `status()`, `logout()` or `ClaudeCliProbe`.
- Dependencies: existing private `run()`; no new imports beyond types.
- Failure behaviour: stop/overflow/error -> `status: null`; `stopped === 'timeout'` -> `timedOut: true`.
- Security: stdout is never returned, logged or stored; only the parsed union leaves the method (class comment
  `:233-238`).
- Verification seam: CREATE `claude-account-command.ambient.spec.ts` with a fake `IProcessSpawner` and fake host:
  signed-in (exit 0) -> loggedIn true; signed-out (exit 1, authMethod none) -> false; garbage -> null; timeout
  (fake timers) -> `timedOut`; asserts argv `[...prefixArgs, 'auth', 'status', '--json']`, no `launchGuard`, the
  passed env object, and that `status()` still refuses without a route.
- Files: MODIFY `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts`; CREATE
  `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ambient.spec.ts`.

### 4. `ClaudeAmbientLoginStatusReader`

- Purpose: the host's single, bounded, cached ambient status read.
- Responsibilities (`libs/backend/auth-providers/src/lib/accounts/claude-ambient-login-status.ts`):
  - `ambientProbeEnv(hostEnv)`: copy entries whose key passes `isCertifiedClaudeEnvKey` (agent-sdk export) and the
    keys `CLAUDE_CONFIG_DIR` / `CLAUDE_SECURESTORAGE_CONFIG_DIR` only when present; skip values with a line break. No
    `ANTHROPIC_*`, API key or cloud selector reaches the child (an API key is not "the Claude login").
  - Child bound (Revision 1, finding 3): the reader owns a single serial slot. At any moment at most one ambient
    child can exist: either the one active probe or one retained, unclosed receipt of an earlier probe, never both,
    never two of either. State: `active: { key; generation; controller; done: Promise<ProbeAttempt> } | null`,
    `followUp: { key; waiters } | null` (at most one queued attempt), `retained: Set<ClaudeChildCloseReceipt>`,
    `lastAttempt: Map<key, ProviderAmbientClaudeStatus>` (only the current key is kept; a key change clears the
    others).
  - `read({ refresh }): Promise<ProviderAmbientClaudeStatus>`:
    1. key = `certifiedEnvDigest(ambientProbeEnv(host.env()))`, computed at call time.
    2. Without `refresh`, return `lastAttempt` for the key when it completed less than
       `AMBIENT_STATUS_FRESH_MS = 60_000` ago.
    3. Active probe with the same key: a non-refresh read joins it. A refresh read does not join it (the active
       probe may have started seconds earlier, before the user's state change): it is queued as the single
       `followUp` for that key; further refresh reads while a follow-up is queued join that follow-up. When the
       active probe finishes (its `run()` returned), the follow-up starts as the next attempt.
    4. Active probe with a different key (environment changed): abort its controller and await its `done` (the
       command resolves after close, or after the kill grace with a close receipt -
       `claude-account-command.ts:338-360`). Its result is obsolete: it is not written to `lastAttempt`, not
       returned to the new caller; waiters of the obsolete attempt receive the result of the attempt that runs for
       the current key. Then continue with step 5 for the current key. Any receipt it returned is moved into
       `retained` before step 5 runs.
    5. Blocked spawn: if `retained` holds an unclosed receipt, do not spawn. Return `lastAttempt` for the current
       key unchanged (its own `checkedAt`, which is the completion time of that earlier failed attempt); if there is
       none for this key, return `{ state: 'unknown', reason: 'timeout', checkedAt: null }`. Repeated blocked reads
       return the same object and never mint a timestamp. When the receipt reports close (`onClosed`), it leaves
       `retained`; the next read may spawn.
    6. Otherwise start an attempt: `AbortController` aborted after `AMBIENT_STATUS_BUDGET_MS = 20_000` (version 10 s
       + status 10 s); `certifyExecutable(signal)` -> not ok: `unsupported-store` => `unknown/cli-missing`,
       `timeout` or `cancelled` => `unknown/timeout`, else `unknown/unreadable`; then `ambientStatus(...)`:
       `timedOut` or aborted => `unknown/timeout`; `status === null` => `unknown/unreadable`; `loggedIn:false` =>
       `signed-out`; `loggedIn:true` => `connected`.
    7. `checkedAt = new Date(host.now()).toISOString()` taken when that attempt's `run()` returned (a completed
       attempt, success or failure). The result is written to `lastAttempt` only when the attempt's key is still the
       current key and its generation is the newest started for that key; an obsolete or out-of-order completion is
       dropped.
    7a. Queue-inclusive caller deadline (Revision 2): every `read()` call answers within
       `AMBIENT_READ_DEADLINE_MS = 25_000`, measured from the call, whatever it waits for (a joined attempt, the
       abort-and-await of an obsolete attempt, a queued follow-up, its own attempt). One timer per pending caller,
       cleared when the caller is answered. If the deadline fires first, that caller alone is answered with
       `{ state: 'unknown', reason: 'timeout', checkedAt: null }` (no attempt completed for it, so no timestamp).
       The active attempt, the queued follow-up, `retained` receipts and close handling are not touched: the attempt
       still completes, writes `lastAttempt` under step 7 and serves later reads; no extra child is started.
       Numbers: one attempt is bounded by the 20 s budget plus the 2 s kill grace = 22 s, below 25 s, so an
       unqueued read is normally answered by its own attempt; a queued read (worst case about 44 s) is cut at 25 s.
       25 s is strictly below the webview RPC timeout of 30 s (§6), leaving 5 s for transport.
    8. Never throws: an unexpected error inside a started attempt -> `unknown/unreadable` with that attempt's
       completion time. A previous `connected` is never returned with a new `checkedAt` and never returned for a
       key it was not probed under.
  - Receipt ownership: a `terminated: false` outcome's `closeReceipt` (from the certification child or the status
    child, including an aborted/timed-out obsolete attempt) is kept in `retained` until `onClosed`; `dispose()`
    aborts the active probe, drops the follow-up (its waiters get the blocked result of step 5) and disposes all
    receipts (mirrors `provider-account-actions.service.ts:226-250`).
  - Constructor `(commands: Pick<ClaudeAccountCommand,'certifyExecutable'|'ambientStatus'>, host: { env(): ...; now(): number })`; not decorated; production host = `process.env` + `Date.now`.
- Dependencies: `ClaudeAccountCommand` (same lib), `@ptah-extension/agent-sdk` env helpers (already a dependency,
  `claude-account-status.ts:1`).
- Integration: registered in `registerProviderAccountServices` by `instanceCachingFactory` next to
  `ClaudeAccountCommand` (`register.ts:163-167`); exported from `libs/backend/auth-providers/src/index.ts` (class
  only, like `ProviderAccountService` at `:3`).
- Failure behaviour: as step 5-7; logs (if any) carry only `state`/`reason`.
- Quality: at most one ambient child exists at any time (active probe or one retained unclosed receipt); at most one
  attempt per 60 s per key without `refresh`; at most one queued follow-up; worst case per attempt 20 s + 2 s grace.
- Verification seam: CREATE `claude-ambient-login-status.spec.ts` with a deferred fake command (each
  `certifyExecutable`/`ambientStatus` call returns a promise the test resolves; the fake counts live children =
  started minus resolved-with-close) and a fake clock: each mapping row; cache hit / expiry / refresh bypass;
  non-refresh read joins the active probe (one child); refresh during an active same-key probe queues exactly one
  follow-up that starts only after the first resolves, and two refreshes share it; environment change during an
  active probe: the active one is aborted and awaited before the new key's probe starts, max live children is 1
  throughout, the new caller gets the new key's result, the obsolete completion is not cached and not returned;
  aborted attempt that returns an unclosed receipt blocks the next spawn; repeated blocked reads return the same
  earlier attempt's `checkedAt` (clock advanced between reads, value unchanged) or `checkedAt: null` when no attempt
  for the key completed; receipt close releases the block; budget abort -> timeout; a stored `connected` is never
  returned for a different key; probe env excludes `ANTHROPIC_API_KEY` and keeps `CLAUDE_CONFIG_DIR`; no field
  other than state/checkedAt/reason. Regression (Revision 2), deferred command + fake timers: a slow active attempt
  (never resolving within the test window) plus a queued refresh read -> the queued caller is answered at
  25 000 ms with `unknown/timeout/checkedAt: null`, before 30 000 ms; live children stay at 1 throughout (the
  follow-up has not spawned); when the slow attempt later resolves, the follow-up starts, its result is cached and
  served to the next read, and the timed-out caller's promise is not settled twice. No `process.cwd()`, no
  `jest.spyOn` on module namespaces (inject fakes).
- Files: CREATE `libs/backend/auth-providers/src/lib/accounts/claude-ambient-login-status.ts`, CREATE
  `.../claude-ambient-login-status.spec.ts`, MODIFY `libs/backend/auth-providers/src/lib/di/register.ts`, MODIFY
  `libs/backend/auth-providers/src/index.ts`.

### 5. RPC `provider:getAmbientClaudeStatus`

- Purpose: expose component 4 to the webview, Electron only.
- Contract (`rpc-provider-accounts.types.ts`): `ProviderGetAmbientClaudeStatusParams { provider: ProviderAccountProvider; refresh?: boolean }`;
  `ProviderGetAmbientClaudeStatusResult = ProviderAccountRpcResult<{ readonly status: ProviderAmbientClaudeStatus }>`
  (same envelope as every account method; Decision P5-D2). Append the name to `PROVIDER_ACCOUNT_RPC_METHOD_NAMES`
  and the registry slice; add `'provider:getAmbientClaudeStatus': true` to `RPC_METHOD_ENTRIES`
  (`rpc.types.ts:3193-3205`).
- Boundary (`provider-account-rpc.schema.ts`): `z.object({ provider: ProviderSchema, refresh: z.boolean().optional() }).strict()`.
- Handler: inject `@inject(ClaudeAmbientLoginStatusReader) ambient: Pick<ClaudeAmbientLoginStatusReader,'read'>`;
  register `this.on('provider:getAmbientClaudeStatus', (p) => this.ambientStatus(p))`: wrong provider ->
  `refusal('wrong-provider')`; else `{ ok: true, status: await this.ambient.read({ refresh: p.refresh === true }) }`.
  No workspace check (the ambient login is host-wide), no ledger (read-only), no broadcast.
- Guard updates (all hosts that list provider methods): Electron `container.smoke.spec.ts:343-380` registers a stub
  for `ClaudeAmbientLoginStatusReader` and its title says eleven methods; VS Code `rpc-surface.spec.ts` and CLI
  `rpc-surface.spec.ts` absent lists gain the name (done in batch B1, filtered until live). Unchanged and verified:
  `rpc-allowlist.spec.ts` (reads the tuple), `manifest.spec.ts:40` (spreads the tuple), `expected-resolvable.ts`
  (Electron, VS Code, CLI: no account entries), `expected-absent.ts` (class-level), `surface-composition.spec.ts`
  (Electron, VS Code, cli-engine: no account entries).
- Failure behaviour: invalid params -> `RpcUserError('INVALID_PARAMS')` (`handlers.ts:328-330`); reader never throws.
- Security: result carries only the three fields; no identity, class, path, output.
- Verification seam: `provider-account-rpc.handlers.spec.ts` cases: refresh flag forwarded; default false; strict
  params reject extras (`{ provider:'claude', env:{} }`); wrong provider; the result object has exactly
  `state/checkedAt/reason`; plus one case for a duplicate-name store refusal on add and rename showing
  `PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY` (A3). `rpc-provider-accounts.spec.ts:174-185` tuple expectation
  updated.
- Files: MODIFY `libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts`, `libs/shared/src/lib/types/rpc.types.ts`,
  `libs/shared/src/lib/types/rpc/rpc-provider-accounts.spec.ts`, `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.schema.ts`,
  `.../provider-account-rpc.handlers.ts`, `.../provider-account-rpc.handlers.spec.ts`,
  `apps/ptah-electron/src/di/container.smoke.spec.ts`; (B1) `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`,
  `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`.

### 6. `ClaudeAmbientStatusService` (frontend core)

- Purpose: the webview's single owner of the ambient status read.
- Responsibilities: `@Injectable({ providedIn: 'root' })`; `inject(ClaudeRpcService)`, `inject(VSCodeService).isElectron`
  (pattern `provider-accounts-state.service.ts:157-159`); inert (no RPC) when not Electron.
  `view: Signal<{ status: 'inert'|'idle'|'checking'|'ready'; result: ProviderAmbientClaudeStatus | null; localFailure: boolean }>`;
  `read(refresh: boolean): Promise<void>` with a monotonically increasing `seq`; only the latest reply is applied
  (stale/out-of-order replies ignored). `checking` while the latest request is in flight; consumers must not show
  Connected, a count or an age while checking. A host reply sets `{ status:'ready', result: <host value>,
  localFailure: false }`. Transport failure or a refusal sets `{ status:'ready', result: null, localFailure: true }`:
  the earlier host result is dropped (an older `connected` is never kept visible after a failed read) and no
  host-shaped `checkedAt` is created on the webview side (Revision 1, finding 4). The row renders this as "Could not
  check" with no "Last check ..." line. RPC timeout 30 s, strictly above the host's queue-inclusive per-read
  deadline of 25 s (§4 step 7a), so the host answer arrives before `ClaudeRpcService` drops the pending call.
- Dependencies: core only; re-exported through `providers-settings-state.service.ts:85-94` beside
  `ProviderAccountsStateService`.
- Failure behaviour: never throws to the caller.
- Verification seam: CREATE spec: inert on non-Electron (no call); refresh flag passed; out-of-order replies ignored;
  checking flag lifecycle; transport failure after an earlier `connected` reply -> `result: null`,
  `localFailure: true`, no `checkedAt` anywhere in the view, `connected` no longer readable; recovery: a later host
  reply clears `localFailure`.
- Files: CREATE `libs/frontend/core/src/lib/services/claude-ambient-status.service.ts` + `.spec.ts`; MODIFY
  `libs/frontend/core/src/lib/services/providers-settings-state.service.ts`.

### 7. Account presentation module (pure)

- Purpose: every derived value the Accounts UI and the card show, testable without DOM.
- Responsibilities (`accounts/account-presentation.ts`):
  - `STATE_LABEL` (Not signed in, Signing in, Sign-in cancelled, Sign-in failed, Disconnected, Signed in, Signed out;
    from `accounts-section.component.ts:38-46`), `ATTENTION_STATES` (`failed`, `disconnected`), `accountInitial(label)`.
  - `useForModel(snapshot, ambient)`: per scope `{ value: 'ambient' | 'named:<id>' | 'unavailable'; options[] }`.
    Options: "Existing Claude login" first, always enabled, suffix " (not signed in)" for `signed-out`, " (status
    unknown)" for `unknown`, none for connected or no result; then signed-in named accounts; then other named
    accounts disabled with " (sign in first)"; plus, only when the stored selection is a named id absent from
    `accounts`, a disabled selected placeholder "Unavailable account - choose another". `omitted` and `ambient`
    both map to `'ambient'` (R1). The unavailable rule is the general "named target not in snapshot.accounts" test
    (binding rule B-1), never fixture-specific.
  - `assignmentChips(snapshot)`: map rowKey (`'ambient'` or profileId) -> chips "Used for: New chats" / "Used for:
    Claude lanes", derived only from the snapshot selections (never from a pending or attempted value - R2).
  - `orderedAccounts(snapshot)`: signed-in first, then host order.
  - `validateAccountName(raw, accounts, excludeProfileId?)`: trims, then `isSafeProviderAccountLabel` (message P5-D7),
    then `isProviderAccountLabelTaken` against other labels (duplicate copy from shared summary); returns
    `{ ok: true, label }` or `{ ok: false, message }`.
  - `ambientRowModel(view, now)`: status text/dot/extra text per design §3.2 table; `connected` is never returned
    while `checking`; "Last checked <age>" / "Last check failed <age>" using the same banding as `checkedAgo`
    (`overview-tab.component.ts:111-120`), only from a host `checkedAt`; no age line when `checkedAt` is `null` or
    `localFailure` is true (Revision 1, finding 4).
  - `connectedAccountCount(accountsView, ambientView): number | null` (D41, Revision 1 finding 1). Returns a number
    only when BOTH reads are usable:
    - accounts: `status === 'ready'`, `stale === false`, `snapshot !== null`;
    - ambient: `status === 'ready'`, `localFailure === false`, `result !== null`, `result.state` is `connected` or
      `signed-out`.
    Otherwise `null` (accounts loading/error/stale; ambient `idle`, `checking`, `inert`, local failure, or host
    `unknown`). Value = signed-in named accounts + 1 when ambient is `connected` (+0 for `signed-out`). The badge is
    hidden for `null` and `0`.
- Verification seam: CREATE `account-presentation.spec.ts` covering every branch above, including omitted vs
  ambient vs missing-named, unconfirmed (snapshot unchanged => chips unchanged), removal of a selected account where
  the host snapshot returns omitted (shows Existing Claude login) and where it still names the removed id (shows
  unavailable). Badge table with two signed-in named accounts: ambient `idle` -> null, `checking` -> null, local
  transport failure -> null, host `unknown` -> null, `signed-out` -> 2, `connected` -> 3; accounts `loading`,
  `error`, or `stale` with ambient `connected` -> null; zero signed-in + `signed-out` -> 0 (hidden); recovery
  (ambient failure then `connected`) -> 3; a pushed snapshot that signs one account out -> 2. Ambient row: no age
  line for `checkedAt: null` or local failure.
- Files: CREATE `libs/frontend/chat/src/lib/settings/providers/accounts/account-presentation.ts` + `.spec.ts`.

### 8. `AmbientAccountRowComponent` (`ptah-ambient-account-row`)

- Purpose: the "Existing Claude login" row (design §3.2).
- Contract: `input.required<ClaudeAmbientView>() ambient`, `input<readonly string[]>() chips`, `output<void>() checkRequested`.
  Avatar "E", name, explainer, status line (`role="status"` for Checking, spinner `aria-hidden`, stops under
  `prefers-reduced-motion`), extra text, chips, "Check again" button (`aria-label="Check the existing Claude login
  again"`, disabled while checking). No other action. One 30 s interval to refresh the age text while mounted,
  cleared in `DestroyRef` (single timer, not per row).
- Focus: when Check again is pressed, the button becomes disabled; focus moves to the row's status element
  (`tabindex="-1"`) and, on completion, returns to Check again only under rule B-2; otherwise the result is announced
  in the row's polite status.
- Verification seam: CREATE spec: all four states' text, never "Connected" while checking, disabled while
  checking, emits once, focus rule B-2 both branches, text-node rendering.
- Files: CREATE `accounts/ambient-account-row.component.ts` + `.spec.ts`.

### 9. `AddAccountFormComponent` (`ptah-add-account-form`)

- Purpose: inline add (design §3.5), replaces `add-account-dialog`.
- Contract: inputs `accounts`, `pending`, `refusal: string | null`; outputs `submitted: string` (trimmed label),
  `cancelled: void`. Label "Name this account", hint copy, `maxlength = PROVIDER_ACCOUNT_LABEL_MAX_LENGTH`,
  `aria-invalid`/`aria-describedby`, alert slot `role="alert"` shared by validation and host refusal; "Add account"
  disabled until `validateAccountName` passes; pending: "Adding...", inputs disabled, `aria-busy`. Escape/Cancel
  emit `cancelled`. Focus moves to the input when created; each open starts empty (the parent destroys it on
  close). Value is re-read and re-validated at submit (R4).
- Verification seam: CREATE spec (duplicate, reserved name, unsafe, trim, refusal keeps value, Escape, pending).
- Files: CREATE `accounts/add-account-form.component.ts` + `.spec.ts`.

### 10. `AccountUseForComponent` (`ptah-account-use-for`)

- Purpose: the "Use for" block with two native selects (design §3.1, §3.7), replaces `account-chooser`.
- Contract: inputs `model` (from `useForModel`), `pendingScope: ProviderAccountScope | null` (one per scope via a
  `ReadonlySet`), `messages: Record<scope, string | null>`, `alerts: Record<scope, string | null>`; output
  `selectionRequested: { scope; choice: ProviderAccountChoice }`. Heading `h3` "Use for" (id used by the tab's
  `aria-labelledby`), the two muted lines (row 13 note in plain words), each select with label and hint, a status
  line `tabindex="-1"` per select.
- Behaviour: the select's value is always the authoritative `model.value`; on `change` it emits and the parent
  writes. Busy rule (a): only that scope's select is disabled with `aria-busy` and "Saving..."; before disabling,
  focus moves to that select's status line. On completion (saved, refused, unconfirmed) the component re-asserts the
  DOM value from the model (a refused or unconfirmed choice must not stay shown - R2) and restores focus to the
  select only under rule B-2. Selecting the already-selected value emits nothing.
- Verification seam: CREATE spec: option order/disabled/suffixes; omitted shows Existing Claude login selected;
  missing named shows the disabled placeholder; change emits only for a different value; pending disables only one
  select; DOM value reverts after refused/unconfirmed; B-2 both branches.
- Files: CREATE `accounts/account-use-for.component.ts` + `.spec.ts`.

### 11. `AccountDetailViewComponent` (`ptah-account-detail-view`)

- Purpose: in-drawer account detail (design §3.6), reworked from `account-details-drawer` without its
  `ptah-native-drawer` wrapper.
- Contract: inputs `account: ProviderAccountSummary`, `accounts` (for rename validation), `operation`, `fallback`,
  `busy: ProviderAccountActionKind | null`, `refusal`, `feedback`, `initialTab: 'overview'|'access'|'profile'`;
  outputs `back`, `signIn`, `cancelSignIn`, `signOut`, `checkStatus`, `rename: { profileId; label }`, `remove`.
- Behaviour kept from AD (cite AD lines in the inventory rows 44-70): roving tablist "Account sections"
  (`AD:136-154`, `:472-493`), Access copy per state (`AD:62-88`), pending copy, fallback script block only when
  `fallback` is set (rendered as text in a focusable `pre`, Copy script via `@angular/cdk/clipboard` as today),
  Check status on every Access state, release-held neutral block, pending lock text, rename form (now with
  `validateAccountName`, "Save name" disabled until valid and changed; "Name saved."), run binding text, resume
  notice only for bound runs on a non-signed-in account (R5). Removed: profile ID row, owner block, "Set as default"
  (D39.4, D40.2, D40.3).
- New: header with "All accounts" back button and `h3` name (`tabindex="-1"`, focused on open); initial tab from
  input (Access unless `signed-in`, D39.3); remove uses `ptah-native-modal` (`native-modal.component.ts:107-129`)
  labelled by its title, Cancel focused first, Escape returns focus to "Remove account".
- Busy rule (b): while `busy` is set, every action of this account is disabled; focus moves first to the detail's
  live status (`tabindex="-1"`, "Working..."); on completion focus returns to the originating control or its
  replacement only under rule B-2.
- Verification seam: CREATE spec (port the still-valid cases from `account-details-drawer.component.spec.ts`;
  add: initial tab by state, back emits, heading focus, no UUID/owner/default text, modal confirm/cancel/Escape,
  busy disables all actions, B-2 both branches, resume notice condition).
- Files: CREATE `accounts/account-detail-view.component.ts` + `.spec.ts`.

### 12. `AccountsTabComponent` (`ptah-accounts-tab`)

- Purpose: the drawer's Accounts tab; owns load, view switching, writes and feedback. Reworked from
  `accounts-section.component.ts` (its write/outcome logic at `:584-710` is the source).
- Responsibilities:
  - `ngOnInit`: `accounts.open('claude')` and `ambient.read(true)` in parallel (design §2 "on opening the tab").
  - Region: `role="region"`, `aria-labelledby` the Use-for heading, `aria-busy` while the list or ambient read is
    in flight.
  - Layout per design §3.1: `ptah-account-use-for`, stale/error notices with Try again (existing copy, rows 6-8),
    polite toast region, `h3` "Accounts" (`tabindex="-1"`), `role="list"` "Claude accounts" with the ambient row
    first then named rows (avatar text, name, dot + state, run count, chips, `role="button"` row body with
    Enter/Space, Sign in for not-signed-in/failed/cancelled, Manage `aria-label="Manage <name>"`, attention spine),
    then "Add another account" / `ptah-add-account-form`. Add disabled until a snapshot exists.
  - View state `list | { detail: profileId, initialTab }` (one signal). Manage / row open -> detail with
    `initialTab = signed-in ? 'overview' : 'access'`. Add success -> detail on Access, toast "Account added. It is not
    selected for any new chat or lane.", focus heading. "All accounts" -> list, focus that account's Manage button.
    When the detail's account disappears from the snapshot (removal, push) -> list, focus the "Accounts" heading
    only under rule B-2, toast from the removal result.
  - Writes: `setSelection` per scope (busy rule a), detail actions per account (busy rule b), `addAccount`,
    `renameAccount`, `removeAccount`. Outcomes: saved -> toast ("<New chats | Claude lanes> will use <name> for new
    sessions.", "Name saved.", removal sentence); failed -> safe sentence or fixed fallback in the relevant alert slot;
    unconfirmed -> "This action may not have completed. Accounts were reloaded." and nothing else changes (ST
    re-reads, `provider-accounts-state.service.ts:609-612`). Removal never assigns a selection (B-1).
  - Pending focus bookkeeping: each operation records `{ waitingTarget: HTMLElement, viewKey }`; completion applies
    rule B-2 via one helper.
  - Closing the drawer or leaving the tab never cancels a sign-in (ST owns operations).
- Dependencies: `ProviderAccountsStateService`, `ClaudeAmbientStatusService` (core), components 7-11.
- Verification seam: CREATE spec (port valid cases of `accounts-section.component.spec.ts`; add: load on init
  calls both reads; S1 shows ambient row + add; unconfirmed keeps select and chips; removal with host snapshot
  omitted vs removed-id-still-selected; per-scope busy; detail open tab by state; push removing the open account;
  no `[innerHTML]`).
- Files: CREATE `accounts/accounts-tab.component.ts` + `.spec.ts`.

### 13. Connection drawer: Accounts tab

- `connection-kind.ts`: `ConnectionDrawerTabId` gains `'accounts'`; `ACCOUNTS = { id: 'accounts', label: 'Accounts' }`;
  `claude-cli: [OVERVIEW, ACCOUNTS, CREDENTIALS, MODELS]`.
- `connection-detail-drawer.component.ts`: new `accountsAvailable = input(false)`; `tabs` filters out `accounts`
  when false; `SETUP_COPY` typed over `Exclude<ConnectionDrawerTabId, 'overview' | 'accounts'>`; `setupFallback`
  false for accounts; `@case ('accounts') { <ptah-accounts-tab /> }`; tab strip wraps: drop `whitespace-nowrap`
  from the host and add the arbitrary variant `[&_[role=tablist]]:flex-wrap` (P5-D6). The reset-to-Overview effect
  (`:250-256`) is unchanged.
- Verification seam: `connection-kind.spec.ts` (claude-cli order), `connection-detail-drawer.component.spec.ts`
  (tab absent when `accountsAvailable` false, present and second when true, reset to Overview on connection change,
  no setup copy on Accounts).
- Files: MODIFY `connection-drawer/connection-kind.ts` + `.spec.ts`, `connection-detail-drawer.component.ts` + `.spec.ts`.

### 14. Providers page and card badge

- `providers-settings.component.ts`: delete the `<ptah-accounts-section>` block (`:356-362`) and its import
  (`:50`, `:89`); pass `[accountsAvailable]="accountsAvailable"` to the drawer; when `accountsAvailable`, on init
  call `accounts.open('claude')` and `ambient.read(false)` (cached, D41); in `closeDrawer()` call
  `accounts.refresh('claude')` and `ambient.read(false)`; pass `[connectedAccounts]` to the card only for the
  connection whose `connectionKind(...) === 'claude-cli'`, value `connectedAccountCount(...)`.
- `provider-connection-card.component.ts`: `connectedAccounts = input<number | null>(null)`; when > 0 render
  `<span class="badge badge-ghost badge-sm" data-testid="connected-accounts-badge">{{ n }} connected</span>` in
  the right-hand group (`:116-126`). Display only; no link, no label text, no error.
- Verification seam: card spec (hidden for null/0, text for 2); page spec (no `ptah-accounts-section`; drawer gets
  `accountsAvailable`; badge input only on the Claude CLI card; close triggers refresh; inert host makes no reads).
  Page badge cases (Revision 1, finding 1), with fake state services holding two signed-in named accounts: ambient
  idle, checking, transport failure and host `unknown` each render no badge; `signed-out` renders "2 connected";
  `connected` renders "3 connected"; after ambient failure a successful `connected` reply restores "3 connected"; a
  pushed accounts snapshot that signs one account out updates to "2 connected"; accounts refresh in flight hides it.
- Files: MODIFY `providers-settings.component.ts` + `.spec.ts`, `provider-connection-card.component.ts` + `.spec.ts`.

### 15. Deletions and state-service cleanup

- DELETE `accounts/accounts-section.component.ts` + spec, `accounts/account-details-drawer.component.ts` + spec,
  `accounts/account-chooser.component.ts` + spec, `accounts/add-account-dialog.component.ts` + spec.
- `provider-accounts-state.service.ts`: delete `setDefault` (`:397-424`) and kind `'default'` (`:60`); adjust
  `selectionWrite` return type to `RpcMethodParams<'provider:setAccountSelection'>['selection']` (`:560`). Spec:
  delete the setDefault cases (around `provider-accounts-state.service.spec.ts:740-781`).
- Verification: chat and core lint/test/typecheck green with no reference left (`grep` for the four selectors and
  `setDefault`).

## Integration architecture

- Data flow (ambient): Accounts tab init / Check again / page init / drawer close -> `ClaudeAmbientStatusService.read`
  -> `provider:getAmbientClaudeStatus` -> Zod -> `ProviderAccountRpcHandlers` -> `ClaudeAmbientLoginStatusReader.read`
  -> (cache | single flight | `certifyExecutable` + `ambientStatus`) -> `{state, checkedAt, reason}` -> view signal ->
  ambient row, select suffix, card badge.
- Data flow (accounts): unchanged RPCs through `ProviderAccountsStateService`; add/rename now refused by the store
  on duplicate names.
- State: host cache lives in the reader singleton (process lifetime, 60 s freshness); webview ambient view lives in
  the root service; account snapshot ownership unchanged.
- External boundaries: Zod strict params; child env allowlisted; child output parsed only into a closed union.
- Failure and rollback: every ambient failure is `unknown` ("Could not check"), never signed-out; account write
  failures keep the last authoritative snapshot; unconfirmed writes trigger the existing re-read; a failed re-read
  shows the stale note with Try again.
- Observability: reader logs nothing from the child; handler refusals log the code only (`handlers.ts:713-720`).

## Architecture-level quality requirements

- Functional: rows of the Parity map below; D41 badge rule; R1-R5 and B-1/B-2.
- Performance: one ambient child at a time, cached 60 s; no timer per row (one 30 s timer in the ambient row only);
  no polling.
- Security: no identity, email, organisation, class, path or credential in any new result, log or DOM; text bindings
  only, no `[innerHTML]`; API-key env never passed to the probe.
- Maintainability: Electron-first; `providerAccounts` capability stays the only gate; standalone, OnPush, `inject()`,
  `input()`/`output()`, signals; no new project or tag.
- Testability: each component has its own spec; no `process.cwd()`; no `jest.spyOn` on module namespaces (inject
  fakes through constructors/DI).

## Parity map

Rows numbered as in `design-spec-p5.md` §6 (74 rows of `parity-inventory-p5.md`). "Removed" only where D39/D40
approve it.

| # | Capability | Disposition |
| --- | --- | --- |
| 1 | Base-page mount | F4 (tab) + F5 (page mount removed) |
| 2 | Electron-only gate | F1 (inert service) + F4 (`accountsAvailable` filter) + F5 |
| 3 | First-render load | F4 (tab init) + F5 (D41 page read for badge) |
| 4 | Host-pushed snapshots | unchanged (`provider-accounts-state.service.ts:225-247`) |
| 5 | Heading and intro | F3 (Use-for lines) + F4 (Accounts heading) |
| 6 | Loading copy; Add disabled | F4 |
| 7 | First-read failure + Retry | F4 |
| 8 | Stale snapshot + Retry | F4 |
| 9 | aria-busy, labelled region | F4 |
| 10 | Toast region | F4 (default toast removed with the action, D40.2) |
| 11 | Two scope cards | F3 (selects) + F2 (chips model) |
| 12 | Duplicate ambient card copy | approved removal D39.2/D40.1; replaced by F2 ambient row |
| 13 | Main API-route note | F3 |
| 14 | Routing UUID suffix | approved removal D40.3 |
| 15 | Unavailable named / omitted as existing login | F2 (`useForModel`) + F3 |
| 16 | Per-scope Change buttons | F3 |
| 17 | Chooser modal sentence | F3 (hint) |
| 18 | Ambient option always available | F2 + F3 |
| 19 | Signed-in first, disabled unsigned | F2 + F3 |
| 20 | Chooser UUID suffix | approved removal D40.3 |
| 21 | Current selection, nothing implicit | F2 + F3 (+ B-1) |
| 22 | Chooser empty copy | F4 (S1: ambient row + add) |
| 23 | One-scope write, pending, refusal, unconfirmed | F3 + F4 (ST unchanged) |
| 24 | Selection toast | F4 |
| 25 | Chooser keyboard/focus | F3 (native select; focus rule B-2) |
| 26 | Empty-list explanation | approved removal D39.2 |
| 27 | Labelled list | F4 |
| 28 | Ambient row with real status | B1 + B2 + B3 + F1 + F2 |
| 29 | Initials avatar | F2 + F4 |
| 30 | Label | F4 |
| 31 | Full card UUID | approved removal D39.4 |
| 32 | State dot + text | F2 + F4 |
| 33 | Attention spine | F2 + F4 |
| 34 | Owner badge | approved removal D39.4/D40.3 |
| 35 | Next main / next lane badges | F2 + F4 ("Used for" chips) |
| 36 | Run count on list | F4 |
| 37 | Whole-row keyboard button | F4 |
| 38 | Manage button | F4 |
| 39 | Add button | F4 (no count cap, D40) |
| 40 | Add validation + uniqueness | B1 (host) + F2 (form, presentation) |
| 41 | Add writes label only | F2 + F4 (ST unchanged) |
| 42 | Add pending / refusal | F2 |
| 43 | Add focus / empty on open / close | F2 + F4 |
| 44 | Account detail surface | F3 (detail view) + F4 (in drawer) |
| 45 | Account tabs keyboard | F3 |
| 46 | Initial tab | F3 + F4 (Access unless signed in, D39.3) |
| 47 | Return focus / Escape / close does not cancel | F3 + F4 |
| 48 | Polite feedback | F3 + F4 |
| 49 | Safe refusal alert | F2 + F3 + F4 |
| 50 | Neutral unavailable result | F3 |
| 51 | Overview UUID | approved removal D39.4 |
| 52 | Overview state row | F3 |
| 53 | Owner block / explainer | approved removal D39.4/D40.3 |
| 54 | Run count + note | F3 |
| 55 | Resume-unavailable notice | F3 (non-signed-in bound runs only) |
| 56 | No-bound-runs notice | F3 |
| 57 | Access state copy | F3 |
| 58 | Sign in / again / retry | F3 + F4 |
| 59 | Pending window copy | F3 |
| 60 | Cancel sign-in | F3 |
| 61 | Sign out | F3 |
| 62 | Check status | F3 |
| 63 | Fallback script | F3 |
| 64 | Pending profile lock | F3 |
| 65 | Rename + result | F3 + B1 (host uniqueness) |
| 66 | "Set as default" | approved removal D40.2: not ported (F3), deleted in F6 (AD) and F7 (ST); host RPC kept (P5-D3) |
| 67 | Remove with confirmation | F3 (native modal) + F4 (B-1) |
| 68 | Busy rule | F3 + F4 (design §3.7) |
| 69 | No identity or secrets | F3 + B2/B3 (ambient result fields) |
| 70 | Unconfirmed write warning | F3 + F4 (ST re-read unchanged) |
| 71 | Connection tabs by kind | F4 |
| 72 | Reset connection tab on change | unchanged (`connection-detail-drawer.component.ts:250-256`), asserted in F4 spec |
| 73 | CLI detection / Check again on Credentials | unchanged |
| 74 | Open drawer from Providers | unchanged; card badge added in F5 (D41) |

Inventory §8 (e2e harness fixtures/reachability): unchanged (design-spec §6 footnote). Inventory §9 (lane header,
session labels, RPC contracts): unchanged; no RPC removed.

## Batches

Executor note for every lane prompt: work only in the worktree above; do not run `npm ci`/`npm install`, builds or
`npm run verify` (the team-leader runs the batch's one command); Electron first; no TUI/VS Code feature work; no
`process.cwd()` and no `jest.spyOn` on module namespaces in specs. Each verify must print "Running target ... for N
projects" with N equal to the listed count.

Verify-list derivation (Revision 1, finding 2; verification only, no TUI or VS Code feature work). Direct imports
in `apps/*/src` (grep of `from '@ptah-extension/<lib>'`): `shared` -> ptah-electron, ptah-extension-vscode,
ptah-cli, ptah-tui, ptah-extension-webview; `auth-providers` -> ptah-electron, ptah-extension-vscode, ptah-cli;
`rpc-handlers` -> ptah-electron, ptah-extension-vscode (also `implicitDependencies`, `apps/ptah-extension-vscode/project.json:7`),
ptah-cli; `cli-engine` -> ptah-cli, ptah-tui (`apps/ptah-tui/src/transport/tui-webview-manager-adapter.ts:1`), and
cli-engine imports auth-providers (`libs/backend/cli-engine/src/lib/container.ts:107`), so ptah-tui depends on
auth-providers and rpc-handlers transitively; `core`, `chat` -> ptah-extension-webview, which ptah-electron
(`apps/ptah-electron/project.json:7`) and ptah-extension-vscode (`apps/ptah-extension-vscode/project.json:101`)
package. Rule applied: backend/shared batches list every lib changed or depending on a changed lib among
auth-providers, rpc-handlers, cli-engine, plus ptah-electron, ptah-extension-vscode, ptah-cli, ptah-tui; batches
that change `shared` types also list ptah-extension-webview (and `core` where RPC contracts change); webview
batches list core/chat as changed plus ptah-extension-webview, ptah-electron, ptah-extension-vscode. If a
batch adds an import to a lib not listed here, the team-leader re-applies this rule before running its verify.

### B1 - Shared name rule, ambient types, host uniqueness, absent-list names (backend-developer)
Files (6): MODIFY `libs/shared/src/lib/types/provider-account.types.ts`; CREATE
`libs/shared/src/lib/types/provider-account-label.spec.ts`; MODIFY
`libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts`, `.../provider-account.store.spec.ts`;
MODIFY `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`, `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`
(add `'provider:getAmbientClaudeStatus'` to the provider-account absent group; filtered until live).
Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/shared,@ptah-extension/auth-providers,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview` (N = 9)

### B2 - Ambient probe and reader (backend-developer; after B1)
Files (6): MODIFY `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts`; CREATE
`.../claude-account-command.ambient.spec.ts`; CREATE `.../claude-ambient-login-status.ts`, `.../claude-ambient-login-status.spec.ts`;
MODIFY `libs/backend/auth-providers/src/lib/di/register.ts`, `libs/backend/auth-providers/src/index.ts`.
Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/auth-providers,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui` (N = 7)

### B3 - RPC wiring (backend-developer; after B2). Batch-cap exception per D8 (D-M): 7 files, one commit, one verify
WP-a (shared, 3): MODIFY `libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts`, `libs/shared/src/lib/types/rpc.types.ts`,
`libs/shared/src/lib/types/rpc/rpc-provider-accounts.spec.ts`.
WP-b (4): MODIFY `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.schema.ts`, `.../provider-account-rpc.handlers.ts`,
`.../provider-account-rpc.handlers.spec.ts`, `apps/ptah-electron/src/di/container.smoke.spec.ts`.
Reason: the tuple drives the mapped schema type (`schema.ts:130-145`), the handler's `METHODS` and the Electron smoke
assertion; any split leaves a red state.
Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/shared,@ptah-extension/auth-providers,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,@ptah-extension/core,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview` (N = 10)

### F1 - Webview ambient status service (frontend-developer; after B3)
Files (3): CREATE `libs/frontend/core/src/lib/services/claude-ambient-status.service.ts` + `.spec.ts`; MODIFY
`libs/frontend/core/src/lib/services/providers-settings-state.service.ts`.
Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/core,@ptah-extension/chat,ptah-extension-webview,ptah-electron,ptah-extension-vscode` (N = 5)

### F2 - Presentation, ambient row, add form (frontend-developer; after F1)
Files (6, all CREATE under `libs/frontend/chat/src/lib/settings/providers/accounts/`): `account-presentation.ts` + spec,
`ambient-account-row.component.ts` + spec, `add-account-form.component.ts` + spec.
Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/chat,ptah-extension-webview,ptah-electron,ptah-extension-vscode` (N = 4)

### F3 - Use-for selects and detail view (frontend-developer; after F2; may run parallel to nothing else in `accounts/`)
Files (4, CREATE): `accounts/account-use-for.component.ts` + spec, `accounts/account-detail-view.component.ts` + spec.
Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/chat,ptah-extension-webview,ptah-electron,ptah-extension-vscode` (N = 4)

### F4 - Accounts tab and drawer tab (frontend-developer; after F3)
Files (6): CREATE `accounts/accounts-tab.component.ts` + spec; MODIFY `connection-drawer/connection-kind.ts` + spec,
`connection-detail-drawer.component.ts` + spec.
Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/chat,ptah-extension-webview,ptah-electron,ptah-extension-vscode` (N = 4)

### F5 - Page swap and card badge (frontend-developer; after F4)
Files (4): MODIFY `providers-settings.component.ts` + spec, `provider-connection-card.component.ts` + spec.
Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/chat,ptah-extension-webview,ptah-electron,ptah-extension-vscode` (N = 4)

### F6 - Delete old section, detail drawer and chooser (frontend-developer; after F5)
Files (6, DELETE): `accounts/accounts-section.component.ts` + spec, `accounts/account-details-drawer.component.ts` + spec,
`accounts/account-chooser.component.ts` + spec.
Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/chat,ptah-extension-webview,ptah-electron,ptah-extension-vscode` (N = 4)

### F7 - Delete add dialog; remove frontend setDefault (frontend-developer; after F6)
Files (4): DELETE `accounts/add-account-dialog.component.ts` + spec; MODIFY
`libs/frontend/core/src/lib/services/provider-accounts-state.service.ts` + `.spec.ts`.
Verify: `npm run verify -- -t lint,test,typecheck -p @ptah-extension/core,@ptah-extension/chat,ptah-extension-webview,ptah-electron,ptah-extension-vscode` (N = 5)

After F7: visual review in Electron (dark + light; 520/360/320/245 px; 200% zoom; native select, nested modal trap,
screen-reader order per design §5 "Not verified"), then the live test resumes (D41 order).

## Team-leader handoff

- Recommended executors: backend-developer for B1-B3 (store, child process, DI, RPC); frontend-developer for F1-F7
  (Angular components, signals, specs). Cross-side review: codex lane without a role (D1 practice).
- Complexity: HIGH - a new child-process read with cache/single-flight/receipts, an RPC surface change across three
  host guard specs, and a UI move that deletes ~2,300 lines and adds five components with strict focus rules.
- Dependencies and ordering: B1 -> B2 -> B3 -> F1 -> F2 -> F3 -> F4 -> F5 -> F6 -> F7 (each needs the previous
  batch's exports or removes a caller first).
- Parallel-safe work: none recommended (each batch consumes the previous one's exports; the verify lock serialises
  checks anyway).
- Files affected:
  - CREATE: `libs/shared/src/lib/types/provider-account-label.spec.ts`; `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ambient.spec.ts`,
    `claude-ambient-login-status.ts`, `claude-ambient-login-status.spec.ts`; `libs/frontend/core/src/lib/services/claude-ambient-status.service.ts` + spec;
    under `libs/frontend/chat/src/lib/settings/providers/accounts/`: `account-presentation.ts`, `ambient-account-row.component.ts`,
    `add-account-form.component.ts`, `account-use-for.component.ts`, `account-detail-view.component.ts`, `accounts-tab.component.ts`
    (each + spec).
  - MODIFY: `libs/shared/src/lib/types/provider-account.types.ts`, `rpc/rpc-provider-accounts.types.ts`, `rpc.types.ts`,
    `rpc/rpc-provider-accounts.spec.ts`; `libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts` + spec,
    `claude-account-command.ts`, `di/register.ts`, `src/index.ts`; `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.schema.ts`,
    `provider-account-rpc.handlers.ts` + spec; `apps/ptah-electron/src/di/container.smoke.spec.ts`;
    `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`; `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`;
    `libs/frontend/core/src/lib/services/providers-settings-state.service.ts`, `provider-accounts-state.service.ts` + spec;
    `libs/frontend/chat/src/lib/settings/providers/connection-drawer/connection-kind.ts` + spec,
    `connection-detail-drawer.component.ts` + spec, `providers-settings.component.ts` + spec,
    `provider-connection-card.component.ts` + spec.
  - DELETE: `accounts/accounts-section.component.ts`, `account-details-drawer.component.ts`, `account-chooser.component.ts`,
    `add-account-dialog.component.ts` (each + spec).
- Verification points: `status()` and `logout()` diff-free; the ambient result has exactly three keys; probe env has
  no `ANTHROPIC_*`; tuple/registry in-sync type (`rpc-provider-accounts.types.ts:313-326`) compiles; Electron smoke
  "eleven methods"; VS Code and CLI surfaces exclude the new method; no `[innerHTML]` in `accounts/`; grep finds no
  `setDefault`/`ptah-accounts-section`/`ptah-account-chooser`/`ptah-add-account-dialog`/`ptah-account-details-drawer`
  in `libs/frontend`; the scoped verify commands above.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| P5-D1 | Ambient probe = new `ClaudeAccountCommand.ambientStatus()` + `ClaudeAmbientLoginStatusReader`; `status()` untouched | reuse `status()` with a synthetic route; infer from CLI detection; new method | design §8.1; `claude-account-command.ts:322-337`; inventory §7 | yes |
| P5-D2 | Result uses the account envelope `{ ok, status }` instead of the bare object in design §8.1 | bare object; envelope | every account method returns `ProviderAccountRpcResult` (`rpc-provider-accounts.types.ts:130-133`); review r1 leaves transport shape to backend | yes |
| P5-D3 | Keep host `provider:setAccountDefault` this phase; delete only the frontend caller | delete host RPC + service + specs now; keep | design §8.4 allows either; inventory §9 "No RPC is removed"; host removal would add ~8 files to B3 | yes (follow-up task) |
| P5-D4 | Same handler, same `providerAccounts` capability | new handler class; same handler | `manifest.ts:513-519`; DI census untouched | yes |
| P5-D5 | Probe env = certified allowlist + Claude directory keys when present; cache key = its digest; fresh 60 s; budget 20 s | full `process.env`; allowlist | `claude-certified-launch.ts:14-62`, `:231`; child limits `claude-account-command.ts:45-54`; A1 | yes |
| P5-D6 | Tab wrap via `[&_[role=tablist]]:flex-wrap` on the drawer host, not a ui-lib input | ui `wrap` input; host variant | `native-tab-group.component.ts` tablist classes; single consumer | yes |
| P5-D7 | Unsafe-name message: "Use 1 to 64 characters, with no line breaks and no spaces at the start or end." | design stand-in (40, slashes); message matching the validator | `provider-account.types.ts:67`, `:139-148`; design §3.5 says reuse the real rule | yes |
| P5-D8 | Uniqueness in the store transaction, no unique index | DB index migration; in-transaction check | `provider-account.store.ts:306-333` `atomic()`; legacy duplicates possible | yes |
| P5-D9 | "Last checked" age uses `checkedAgo` banding with its own copy; one 30 s timer in the ambient row | reuse `checkedAgo` text verbatim; no timer | `overview-tab.component.ts:111-123` (one timer while shown) | yes |
| P5-D10 | Page-show ambient read uses `refresh:false`; the host may probe once when its cache is empty or older than 60 s | `refresh:false`; a cache-only flag | D41 "cached ambient read (no forced probe from the card)" | yes |
| P5-D11 | After the open account disappears (removal or push), the tab returns to the list and focuses the "Accounts" heading under B-2 | focus Add; heading | design §5 names no target for this case | yes |
| P5-D12 | Ambient view kept in a new core service, not inside `ProviderAccountsStateService` | extend ST; new service | ST is workspace-scoped (`:441-453`); ambient login is host-wide | yes |
| P5-D13 | Badge needs both reads usable; `signed-out` adds 0; `unknown`, checking, idle, local failure hide it | count named only when ambient is not ready; require both | D41 "hidden while loading and when the read fails" (`decisions.md:251-253`); review finding 1 | yes |
| P5-D14 | Reader is a serial single-child slot: same-key non-refresh joins; refresh queues one follow-up; key change aborts and awaits the active probe; a retained unclosed receipt blocks spawning | per-key single flight; global serialization | `claude-account-command.ts:286`, `:325`, `:338-360` (per-call child owner, close receipt after grace); review finding 3 | yes |
| P5-D15 | `checkedAt` is `string | null`, set only from a completed attempt for the current key; blocked reads reuse it; webview transport failure carries no `checkedAt` (`localFailure`) | mint a timestamp per read; provenance-only | design-spec §8.1 (`design-spec-p5.md:199`); `design-spec-p5-review-r1.md:44`; review finding 4 | yes |
| P5-D16 | Queue-inclusive per-read host deadline 25 s, answering `unknown/timeout/checkedAt: null`; webview RPC timeout stays 30 s | raise the RPC timeout to cover the queue (about 44 s); bound the host wait | `ClaudeRpcService` starts its timer before posting and drops the call on timeout (re-review r1); 20 s budget + 2 s grace (`claude-account-command.ts:45-54`) | yes |

## Lane-introduced constraints

All tagged `[lane-proposed]`; none is a user decision.

1. P5-D2 envelope shape, P5-D5 env allowlist / 60 s / 20 s values, P5-D6 Tailwind variant, P5-D7 copy, P5-D9 30 s
   timer, P5-D10 page-show cached read may probe, P5-D11 focus target after removal.
2. A duplicate name already stored before P5 is left as is; only new add/rename writes are refused.
3. An older Claude CLI (below `MIN_VERSION`, `claude-account-command.ts:57`) shows "Could not check" for the ambient
   login, because the probe reuses the certified executable.
