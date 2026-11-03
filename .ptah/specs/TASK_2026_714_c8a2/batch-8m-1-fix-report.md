# Batch 8m-1 review fix report

Scope of this fix: the two defects from the team-leader's scoped verify on the
Round 8m Wave 1 working tree. No production code changed; every edit is in the
harness type surface, the evidence specs, or the native contract spec.

## Defect 1 — typecheck TS2322 in the evidence harness

### Root cause

`tools/evidence-harness.ts:998-1008` (pre-edit) declared the harness-local
`ApprovalPolicy` as `'on-request' | { granular: {...} }`. The 8m-1 rewrite of
`policy()` (`evidence-harness.ts:1015-1018` pre-edit) returns `'untrusted'` for
`ask` / `auto-edit` / `undefined`, a value the union did not contain, so
`const approvalPolicy: ApprovalPolicy = ...` failed with TS2322.

The compile error stopped `evidence-harness.spec.ts`, `evidence-cases-round.spec.ts`
and `src/lib/codex-execution-profile.spec.ts` from running, which hid several
stale expectations that were written against the old ask mapping
(ask = granular + read-only + reviewer only for ask).

### Exact lines changed

1. `tools/evidence-harness.ts:998-1009` — added `| 'untrusted'` to the
   `ApprovalPolicy` union (now at :1000). The `granular` branch stays.
2. `tools/evidence-harness.spec.ts:951-958` — the level loop now expects
   `approvalPolicy` `'on-request'` for plan/yolo and `'untrusted'` for
   ask/auto-edit; `sandbox` is `'read-only'` only for plan, else
   `'workspace-write'` (was: on-request for everything but ask; read-only for
   ask/plan).
3. `tools/evidence-harness.spec.ts:1295` — describe renamed
   `'granular ask approval policy'` → `'bounded approval policy profile'`
   (ask is no longer a granular policy).
4. `tools/evidence-harness.spec.ts:1296-1313` — initializeParams test: every
   `policy()` level now yields a string policy, so `experimentalApi` is
   `false` for all levels; the `true` case is pinned with a direct granular
   value so the "only for granular" claim stays proven.
5. `tools/evidence-harness.spec.ts:1315-1327` — structural echo test: the
   expected policy changed from `policy('ask').approvalPolicy` (now
   `'untrusted'`, which has no key order) to a direct `{ granular }`.
6. `tools/evidence-harness.spec.ts:1396-1403` — `'uses granular approvals for
   ask and the default read-only profile'` → `'uses untrusted approvals for ask
   and the default profile'`: ask/undefined now equal
   `{ sandbox: 'workspace-write', approvalPolicy: 'untrusted', approvalsReviewer: 'user' }`.
7. `tools/evidence-harness.spec.ts:1404-1418` — TOML test: ask-family serializes
   `approval_policy="untrusted"`, plan/yolo keep `"on-request"`, a direct
   granular value keeps the granular TOML branch covered, and the stale
   `not.toHaveProperty('approvalsReviewer')` became
   `approvalsReviewer` toBe `'user'` (the reviewer is now always present).
8. `tools/evidence-harness.spec.ts:1419-1420` — comparison test: expected
   changed to a direct `{ granular }` so the structural (key-order, missing,
   extra) comparisons stay meaningful.
9. `tools/evidence-cases-round.spec.ts:178` — the fake `config/read` response
   hardcoded `sandbox_mode: 'read-only'`. `runCase`
   (`evidence-harness.ts:2027-2029` post-edit) throws
   `'Effective config differs from bounded profile'` when `sandbox_mode` differs
   from `policy(item.level).sandbox`; the round cases carry no level, so
   `policy(undefined).sandbox` is `'workspace-write'` now and every `exercise()`
   in that spec would have failed. The fake now echoes `policy('ask').sandbox`,
   the same dynamic style as the `approval_policy` line below it.

### Left unchanged on purpose

- `'rejects missing or different thread approval policy and reviewer'`
  (:1329) and `'reports an allowlisted approval-policy mismatch'` (:1371)
  still use `policy('ask').approvalPolicy` as the expected value; with
  `'untrusted'` every listed response still fails the check, so they pass and
  keep proving the rejection contract.
- The `shouldNoteMissingApproval` tests (:1356-1369) are level-logic only.
- `src/lib/codex-execution-profile.spec.ts` needed no change: it already pins
  the new mapping (`'untrusted'` / read-only only for plan /
  `approvalsReviewer` `'user'`, :44-55) and cross-checks the lib against the
  harness `policy()`; it had only failed to compile-run.

## Defect 2 — four 5000 ms timeouts in `codex-chat-native-contract.spec.ts`

Test: `'presents exactly one pre-start %s approval and honors %s'`
(`:806-901` post-edit), all four cases (fileChange/commandExecution × allow/deny).

### Root cause A — the hang (all four cases)

The test waited for a `message_start` chunk after `onTurnStart` had notified
only `turn/started`:

- `codex-event-translator.ts:107-118` returns `[]` for `turn/started` — it
  produces no runtime event at all;
- `message_start` is synthesized lazily by `CodexChatEvents.map`
  (`agent-sdk/src/lib/codex-app-server/codex-chat-events.ts:102-112`) when the
  first event of the turn is mapped — i.e. when the first item event arrives —
  and the `turn_state` generating event is yielded together with it
  (`codex-chat-turn-stream.ts:211-213`).

So with no item notified yet (which is the pre-start situation by design),
`message_start` can never appear. The 400 × 5 ms `eventually` loop polled until
Jest killed the test at 5000 ms; no assertion ever ran, which matches the
reported "timeout, no assertion failure".

### Root cause B — latent deny mismatch (would surface as an assertion diff once A is fixed)

The test answered `decision: 'deny'` and expected the bridge reply
`'decline'`. Under the 8m-3 wire mapping
(`rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:509-514`, pinned
by `codex-chat-host-ports.spec.ts:733-736`):

- plain `'deny'` → Codex decision `'cancel'` (deny and stop);
- `'deny_with_message'` → `'decline'` (deny but continue,
  `shared/src/lib/types/permission.types.ts:97`).

The scripted refusal flow — the server reports the item `declined` and the turn
continues — is the decline flow.

### Exact lines changed (`codex-chat-native-contract.spec.ts`)

1. `:815-822` — `onTurnStart` now sets a `turnBegun` flag after notifying
   `turnStarted()`, with a comment explaining why no view event can exist yet.
2. `:841` — the unsatisfiable `message_start` wait became
   `await eventually(() => turnBegun, 'turn started before approval')`. This
   also guarantees the runtime has opened before `bridge.handle` (the approval
   sink the bridge needs is captured during open; `h.bridge()` throws without
   it), which is what the old wait was really for.
3. `:867-873` — the deny cases answer `decision: 'deny_with_message'` (comment
   included); the allow case still answers `'allow'`.

No assertion was weakened or deleted: exactly one `PermissionRequest` that
passes the real `parsePermissionRequest`; no `tool_start` before the decision;
allow → bridge reply `'accept'`, then the item runs and completes as a
non-error `tool_result`; deny → reply `'decline'` and the item completes
`declined` → `tool_result` with `isError: true` and no success result.

### Verified against production code (read-only)

- The bridge accepts both methods and echoes the decision
  (`codex-approval-bridge.ts:22-24`, `:357-359`); a live `'decline'` sink reply
  becomes response `{ decision: 'decline' }` (`:222-234`).
- The sink presents regardless of turn state, so a pre-item request works
  (`codex-chat-approval-sink.ts:87-150`).
- Item statuses `inProgress`/`completed`/`declined` are schema-valid for both
  kinds (`codex-protocol-schemas.ts:163`, `:242`, `:261`); `'declined'` maps to
  a cancelled, `isError` tool result (`codex-event-translator.ts:53-57`,
  `:334-411`).
- A completed commandExecution without `aggregatedOutput` yields a null-output,
  non-error result (`boundJson` passes null through, `:70-79`).
- After the decision the first item event synthesizes `message_start` before
  the projected chunk, and `turn/completed` ends the turn stream
  (`codex-chat-turn-stream.ts:191-222`), so `await streaming` settles.

## Decisions

- The `granular` branch of `ApprovalPolicy` stays in the type: the harness
  still contains granular-handling code (`approvalPolicyOverride`'s TOML
  branch `:1029-1040`, `initializeParams`' `experimentalApi` toggle `:1049-1054`,
  and the `runCase` branches at `:1973-1977` / `:2046-2051`), so the branch is
  not dead; the spec keeps direct-value coverage of that machinery while the
  `policy()` expectations pin the new `'untrusted'` mapping.
- The round-spec fake echoes `policy('ask').sandbox` dynamically instead of
  hardcoding `'workspace-write'`; the mapping itself stays pinned by
  `evidence-harness.spec.ts` and `codex-execution-profile.spec.ts`.
- The deny case answers `'deny_with_message'` rather than plain `'deny'`:
  plain deny is deny-and-stop (Codex `'cancel'`, turn interruption — already
  covered by the existing `'settles a stop during approval as a user abort'`
  test), while the contract under test is the refusal-then-continue flow the
  task specified ("deny -> reply 'decline'").

## Not done

- No verify/test/lint/typecheck run (lane rules); the team-leader's scoped
  verify must confirm both fixes.
- The literal note `'granular ask: no approval request observed'`
  (`evidence-harness.ts:2180`, asserted at `evidence-harness.spec.ts:1930` and
  `:1952` post-edit) still says "granular" although ask now maps to
  `'untrusted'`. It is a report note string shared by code and spec, not a
  policy expectation, so I left it. Optional follow-up: rename in both places.
- No production code changed; both defects were spec/type-surface defects.
## Team-leader check: Deny wire value and Codex mapping (2026-10-28)

The spec's deny cases now send `deny_with_message` instead of `deny`. Checked against the code; the host mapping is pre-existing and matches Claude, so no host fix:

- The permission card's Deny button sends `'deny'` (`libs/frontend/chat-ui/src/lib/molecules/permissions/permission-request-card.component.ts:128`); "Deny with message" sends `'deny_with_message'` (`:432`).
- Claude: `'deny_with_message'` -> `behavior 'deny'`, `interrupt: false`, the turn continues (`libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:1059-1073`); a user's plain `'deny'` -> hard deny with `interrupt: true`, the turn stops (`:1102-1114`).
- Codex host: `deny_with_message` -> `decline` (refuse the item, the turn continues); `deny` -> `cancel` (decline and interrupt the turn) (`libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts` ~:509-514). Same semantics on both runtimes.
- So the spec proves the decline flow with the wire value that produces it. Coverage gap (Minor, recorded): no pre-start case for a plain `deny` -> bridge `cancel` -> turn interrupted; batch 8m-5 (Stop/interrupt) owns the interrupt path.

## Review fix 2 — round tool still pinned the old ask sandbox

Every round-7a case in `tools/evidence-cases-round.spec.ts` failed with
`Error: Effective config differs from bounded profile`.

### Root cause

The defect-1 fix made the round spec's fake `config/read` echo
`policy('ask').sandbox` (`evidence-cases-round.spec.ts:178`), which is
`'workspace-write'` under the D14 mapping. `tools/evidence-cases-round.ts`
still hard-coded the old `'ask'` sandbox in two places:

- the process overrides pushed the literal `'sandbox_mode="read-only"'`
  (`evidence-cases-round.ts:173` pre-edit), and
- the effective-config gate threw unless
  `config['sandbox_mode'] === 'read-only'` (`:417-423` pre-edit), so every
  `exercise()` run aborted at the first `start()` before any turn ran —
  including the fault cases, which then surfaced the config error instead of
  their intended gate error (spec lines 395, 417, 478).

A third stale assumption sat in the turn driver: `turn/start` always sent
`sandboxPolicy: { type: 'readOnly', networkAccess: false }` (`:483`
pre-edit) although the selected profile is `workspace-write` now.

### Exact lines changed (`tools/evidence-cases-round.ts`)

1. `:173` — the override is now built from the selected profile:
   `` `sandbox_mode=${JSON.stringify(selected.sandbox)}` ``, the same style as
   `evidence-harness.ts:1433`.
2. `:418` — the gate now compares
   `config['sandbox_mode'] !== selected.sandbox`, mirroring
   `evidence-harness.ts:2027`.
3. `:483-490` — `turn/start` now derives `sandboxPolicy` from
   `selected.sandbox`, exactly like `evidence-harness.ts:2061-2069`:
   `'read-only'` keeps `{ type: 'readOnly', networkAccess: false }`; every
   other sandbox sends `{ type: 'workspaceWrite', writableRoots:
   [experiment.workspace], networkAccess: false }`. The thread `cwd` is
   `experiment.workspace` (`:439`), so `writableRoots` equals `[cwd]` as the
   D14 profile specifies.

`sandbox_workspace_write.network_access=false` and every other bound in the
overrides list are unchanged. No gate, bound, or assertion was weakened.

### Left unchanged on purpose

- `evidence-cases-round.spec.ts` needed no edit: its fake `config/read`
  (`:174-182`) and `thread/start` / `thread/resume` (`:183-199`) responses
  already derive from `policy('ask')`, so they stay consistent with the D14
  mapping, and no assertion in the spec pins a sandbox value or a `-c`
  override argument.
- The approval gates keep their strength: the `'untrusted'` policy still
  produces one `item/commandExecution/requestApproval` frame per command, and
  the round tool still requires the marker to appear only after the approval.
- The harness `granular` approval-policy machinery is untouched; ask maps to
  `'untrusted'` and the round tool already passed `selected.approvalPolicy`
  to `initialize`, `thread/start` and `turn/start`.
- MCP wiring (the `profile-inputs` probe server) is untouched.
- No verify/test run (lane rules); the team-leader's scoped verify must
  confirm the fix.

## Review fix 3 — tolerated marker read died with the read-only sandbox

Three failures in `tools/evidence-harness.spec.ts`, describe
`ask-command-edit evidence flow` (:1443): `continues the edit flow after
marker-read`, `continues the edit flow after read-approval` (both fail at
`expect(failure).toBeUndefined()`, spec :1968) and `records sanitised
approval evidence for read-approval without amendment content` (:2055).
All three reject `runCase` with `Error: Unexpected command`.

### Root cause

- Under D14, `policy('ask')` returns `approvalPolicy: 'untrusted'` and
  `sandbox: 'workspace-write'` (`evidence-harness.ts:1016-1021`); only
  `'plan'` keeps the read-only sandbox.
- The tolerated-marker-read gate (`:1814-1819`) required
  `selected.sandbox === 'read-only'` (pre-edit `:1817`). That condition came
  from the old profile (decisions.md:111, "in the read-only sandbox only").
  Under D14 it is permanently false for the ask edit case, so
  `toleratedReadId` was never set and the whole tolerance
  (item notification `:1814-1831`, read approval request `:1639-1657`)
  became dead code.
- The spec's fake child then sent the marker read as an `item/started`
  (`evidence-harness.spec.ts:1676`, command `Get-Content -LiteralPath
  '<original>'` / `cat '<original>'`), which does not match
  `expectedCommand` (the marker-write command). The identity gate
  (`:1833-1850`) recorded the shape and threw `Error: Unexpected command`
  (`:1849`). `onNotification` has no catch of its own, so the throw left
  through the `RpcChild` stdout-data handler (`receive` `:772`, catch
  `:624-644`), whose `failureMessages` set keeps the literal
  (`evidence-failure-notes.ts:58`); `fail()` then made the pending
  `turn/start` / `assertHealthy()` reject `runCase` with the same error.
  The read `item/started` arrives before any approval request, so the
  approval-side throw (`:1701`) never fired; the defect is the `:1817`
  gate, not the approval command choice.
- The approval identity selection is policy-independent and stays correct:
  `approvalCommand = editing && approvalRounds === 1 ? editedCommand :
  expectedCommand` (`:1659-1660`), and `markerApprovalDecision`
  (`:1212-1250`) accepts only the exact expected/edited command (or a
  validated file item) with matching thread and workspace. No stale choice
  for the old policy.

### Exact lines changed

1. `evidence-harness.ts:1817` — the gate is now
  `selected.approvalPolicy === 'untrusted'` instead of
  `selected.sandbox === 'read-only'`. The tolerance now keys on the D14 ask
  profile and keeps every bound: only the `ask-command-edit` edit flow, at
  most one read, only before the first approval, and only the
  `isToleratedMarkerRead` shapes (`:1115-1138`: Get-Content/Test-Path/
  Get-Item or cat/test -e with one quoted path, no shell metacharacters).
  The read's approval request keeps its own identity checks (`:1639-1657`:
  thread, itemId, cwd, command shape, before the first approval, once) and
  is always declined, never accepted.
2. `evidence-harness.ts:2180` — the missing-approval note is relabeled
  `untrusted ask: no approval request observed` (ask is no longer granular
  under D14). It still fires only for non-command ask-level cases with no
  approval request observed; `shouldNoteMissingApproval` (`:1079-1088`) is
  unchanged.
3. `evidence-harness.spec.ts:1938` and `:1960` — the two negative assertions
  now use the new label, so they still prove this note never fires for
  command cases.

### Decisions

- The spec's fake child needed no change, because it does not encode a
  behaviour that D14 forbids. Under `untrusted`, Codex asks for anything
  not on its known-safe list (research-t3code-approvals.md:29), so both wire
  forms are plausible live evidence: `read-approval` models a read that
  prompts (the harness declines it with the identity checks, then the edit
  flow continues; approvals `['decline','decline','accept']`), and
  `marker-read` models a read that the known-safe list runs unprompted
  (approvals `['decline','accept']`). The harness now tolerates both forms.
- No gate meaning changes. The approved-command identity gates stay exact
  (`expectedCommand` / `editedCommand`, marker absent before and during the
  approval); the tolerated read can never write (its shape allows only read
  commands with a single quoted path) and can never be accepted. The
  evidence the harness can prove is unchanged: ask-before-effect for the
  write commands, plus one bounded tolerated read in either prompted or
  unprompted form.
- `markerApprovalDecision` was rechecked as instructed: no branch on the
  granular policy or on a sandbox value; no change needed.
- Other D14-adjacent branches were rechecked: the `sandboxPolicy`
  derivation (`:2061-2070`) is generic (ask now sends `workspaceWrite`,
  plan keeps `readOnly`) and correct; the granular capability branches
  (`:1052`, `:1973-1977`, `:2046-2051`) are keyed on the approval-policy
  value, not on the level, and the spec still exercises the granular value
  directly (`initializeParams({ granular })` at spec `:1309`,
  `assertThreadApprovalPolicy` at spec `:1317`), so they stay.
- `second-read` and `late-read` still reject by design: a second read is
  not tolerated (`toleratedReadId` is already set, `:1822-1828`), and a read
  after the first approval fails `!approvalRequestObserved` (`:1824`);
  both keep throwing `Unexpected command`.

### Not done

- No test, lint or typecheck run (lane rules); the team-leader's scoped
  verify must confirm. The three failures were traced by hand against the
  fake child: with the gate change, `marker-read` tolerates the read, then
  declines the first approval, steers and accepts the edited command
  (`observed`); `read-approval` additionally records the declined read
  approval with its sanitised reason and amendment flag first.
- The tolerated read's completion shape stays unchecked on purpose
  (`:1829` tolerates any completion status): real codex may complete a
  declined read as `declined` without output, while the fake completes it
  with output. Both forms remain tolerated; no assertion depends on the
  status, and tightening it is not required by D14.