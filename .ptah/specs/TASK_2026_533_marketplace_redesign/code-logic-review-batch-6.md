# Code Logic Review — Batch 6 (`ConnectorLinksStore`), `TASK_2026_533`

Scope: `libs/frontend/marketplace/src/lib/data/connector-links.store.ts` (899 raw
lines) and `connector-links.store.spec.ts` (1014 lines), in worktree
`D:\projects\ptah-extension\.claude-worktrees\agent-ad4a62254949b5037-cd7890913ad1`
(branch `agent-ad4a62254949b5037`, base `1d01377b8`). Compared against the old
`connectors-surface.component.ts` (+ spec, 898 lines) in the same worktree, and
against `implementation-plan.md` §C4/§D4 and `batches.md` Batch 6.

## Summary

| Metric              | Value             |
| ------------------- | ----------------- |
| Overall score       | 7/10              |
| Assessment          | CHANGES REQUESTED |
| Blocking issues     | 0                 |
| Serious issues      | 1                 |
| Moderate issues     | 3                 |
| Failure modes found | 5                 |

Verification run for this review (not part of the executor's own report):
`npx jest --config libs/frontend/marketplace/jest.config.ts connector-links.store.spec.ts --detectOpenHandles`
→ 53/53 pass, no leaked handles reported. `npx nx test @ptah-extension/marketplace`
(whole project, since `nx test`'s `--testPathPattern` was not honoured) → 464/464
pass across 17 suites; the "worker did not exit gracefully" warning it printed does
not reproduce when `connector-links.store.spec.ts` runs alone, so it is not
attributable to this file. `ptah_get_diagnostics` on the two batch files returns
type errors only in unrelated files (`mock-rpc-service.ts`,
`connected-surface.component.spec.ts` — Batch 5's file, `harness-health.store.spec.ts`)
— zero errors in `connector-links.store.ts`/`.spec.ts` themselves.

## Five logic questions

### 1. How does this fail silently?

- The 5-minute Smithery poll deadline (`connector-links.store.ts:640-644`) ends by
  calling `stopPolling` and `load()` with **no** `actionError` set and no distinct
  outcome — the caller already received `{kind:'awaiting-setup'}` at
  `openSmitherySetup` and is never told the wait timed out. The card just reverts to
  whatever `needs-auth`/`not-connected` the reload produces. Inherited unchanged
  from `connectors-surface.component.ts:611-617`, not a regression, but still a
  real silent-failure path (see Failure modes: "Silent poll timeout").
- `openSmitherySetup` returning `{ opened: false }` with `data.error === undefined`
  is reported as a generic failure (`:604-612`), even though
  `mcp-directory.types.ts:529-530` documents that `opened:false` can mean "already
  connected" — a non-failure. Also inherited unchanged from
  `connectors-surface.component.ts:560-568`. See Failure modes and the explicit
  rule below.
- `readOAuthState` (`:754-768`) and `readOAuthStates` inside `readOAuth`
  (`:735-752`) turn an unreadable per-record OAuth state into `'disconnected'`
  silently; the row then renders `needs-auth`, which is a reasonable UI choice
  documented in the code, but it means a transport hiccup for ONE record is
  indistinguishable from a genuinely disconnected server.

### 2. What user action produces unexpected behaviour?

- Clicking "Authorize" on a Smithery connector whose `openSmitherySetup` reply is
  `{opened:false}` with no error (the documented "already connected" case) shows a
  generic "Could not open the setup page for X" failure toast even though nothing
  is actually wrong — see Finding M-1.
- A user who lets a Smithery setup tab sit open past 5 minutes and then returns to
  it sees the card silently drop back to "needs-auth" (or whatever state the final
  reload produces) with no indication a timeout occurred — see Finding M-2.
- If a thrown RPC/transport exception's `.message` happens to include the request
  URL (common for `fetch`/`undici`-style network errors), the raw text is now
  shown verbatim in `actionError()` where the OLD component always substituted a
  generic string — see Finding S-1 (Serious).

### 3. What input data produces a wrong answer?

- None found that produces an incorrect (as opposed to incomplete) answer. The
  status merge (`links` computed, `:270-308`) correctly special-cases the
  Smithery `error` field as a state and not a load failure
  (`:726-731`), and `readSmithery`/`readOAuth` correctly distinguish "answered
  with an inline error field" from "the RPC call itself failed"
  (`:715-731`).
- The `serverActionId` keying (`:802-815`) that lets an installed row and its
  catalogue card share one busy/poll guard is correct as written, but it silently
  depends on catalogue URLs (`catalogueOAuthConnector`, `:817-827`) and
  `smitheryQualifiedName`s (`catalogueSmitheryConnector`, `:829-836`) being
  unique per connector. Nothing in this store or its spec proves that invariant —
  see Finding M-3.

### 4. What happens when a dependency fails?

- OAuth and Smithery load halves fail independently and only a joint failure sets
  `loadError`/`state:'error'` (`:697-733`) — matches plan C4 exactly and is
  well covered by tests (`connector-links.store.spec.ts:282-337`).
- A failing poll tick (thrown or `isSuccess()===false`) is retried, never treated
  as a verdict, until the deadline (`readSetupStatus`, `:652-666`; covered by
  spec `:953-977`).
- `DestroyRef.onDestroy` (`:208-213`) sets `destroyed = true` and calls
  `stopAllPolling()`, which clears every pending `setTimeout` and empties
  `pollingIds` synchronously (`:684-688`). A `tick()` in flight checks
  `this.destroyed` immediately after its own timer fires and before doing
  anything else (`:636`), so no tick can publish state after destroy. Confirmed
  by spec `:995-1012` (`jest.getTimerCount()` is 0 after destroy).

### 5. What is missing that the requirements never mentioned?

- A per-connector or per-action error channel. `actionError` is one global
  signal (`:193`, `:238-239`), inherited unchanged from the old component. Two
  concurrent actions on two different connectors will have the second action's
  start (`this._actionError.set(null)`, e.g. `:521`) clear the first one's error
  before a slow-reading user necessarily saw it, and a page that renders
  `actionError()` next to every card would show one connector's error under all
  of them. Not a regression, but worth naming since C4 doesn't scope it away
  either.
- Redaction/sanitization policy for exception text before it reaches the UI. C2
  (implementation-plan.md:289-291) required masking for `ConfigSummary`
  env/header values; no equivalent policy exists for `actionError` text, and this
  batch is the first place raw `Error.message` starts flowing into a
  user-visible signal (Finding S-1).

## Failure modes

### Silent poll timeout

- Trigger: a Smithery setup poll runs the full 5 minutes without the connection
  ever reaching `connected` or `error`.
- Symptom: the card silently reverts to its pre-setup status; nothing tells the
  user the wait was abandoned.
- Evidence: `connector-links.store.ts:638-644`.
- Current handling: `stopPolling` + `load()`, no `actionError` write.
- Recommendation: not required for this batch (inherited, bug-for-bug parity with
  `connectors-surface.component.ts:611-617` per the plan's "behaviour is
  preserved" mandate) — but worth a follow-up ticket so a page-level consumer can
  set a "setup timed out" message when `pollingIds` drops to empty without the
  link ever reaching `connected`/`error`.

### `opened:false` misclassified as failure

- Trigger: `mcpDirectory:openSmitherySetup` returns `{opened:false}` with
  `error` undefined — the documented "already connected, nothing to set up"
  case (`libs/shared/src/lib/types/mcp-directory.types.ts:529-530`).
- Symptom: user sees "Could not open the setup page for X" even though the
  connector is already connected.
- Evidence: `connector-links.store.ts:604-612` (`this.fail(... ?? fallback)` when
  `result.data.error` is undefined).
- Current handling: treated identically to a real failure. Byte-identical to the
  old component (`connectors-surface.component.ts:560-568`), and neither the old
  nor the new spec exercises this branch (`connector-links.store.spec.ts` has no
  `opened: false` case; grepped and confirmed absent from both specs).
- Recommendation (ruling, since the task asked for one): do NOT fix inside this
  batch. Batch 6's own validation notes (`batches.md:360`) require migrating
  "every assertion" and preserving behaviour; changing this now would be new
  product behaviour riding on a data-layer lift. File a follow-up task to special
  -case `opened:false && error === undefined` as a non-failure `awaiting-setup`
  -adjacent outcome (e.g. re-poll once, or a distinct `{kind:'already-connected'}`
  outcome), with a spec pinning it, before any page starts rendering this text as
  an error toast.

### Poll started from `installSmithery` cannot double up with a directly-started poll

- Trigger: `installSmithery` (`:553-589`) and `openSmitherySetup` (`:592-618`)
  both key their busy set by `connector.id`/`target.actionId`; `installSmithery`
  awaits `openSmitherySetup` and both have their own `try/finally` that call
  `removeFrom(this._busyIds, ...)` for the same id.
- Symptom checked for: none — this is confirmed SAFE, not a bug. `isBusy`/
  `isActionBusy` (`:793-795`) is `busyIds.has(id) || pollingIds.has(id)`, so the
  inner `openSmitherySetup` finally removing the id from `busyIds` the instant it
  starts the poll does not make the connector look idle, because `pollingIds`
  already holds the same id (`startSetupPoll`, `:632`). `startSetupPoll` itself
  calls `stopPolling(actionId)` before arming a new timer (`:630`), so even a
  theoretical re-entrant call cannot leave two live timers for one actionId.
- Evidence: `:553-618`, `:629-649`, `:793-795`.
- Recorded here because it was the first place a double-poll looked possible;
  worth the file:line trail for the next reviewer.

### Raw exception text reaches the UI (see Serious finding S-1 below)

- Trigger: any `await this.rpc.call(...)` inside `disconnect`, `runOAuthConnect`,
  `installSmithery`, or `openSmitherySetup` throws.
- Symptom: `actionError()` now shows `error.message` verbatim via `messageOf`
  (`:893-899`) instead of the old component's fixed string.
- Evidence: `:507-509`, `:538-539`, `:584-585`, `:613-614`, `:838-841`,
  `:893-899`.
- Current handling: no redaction of the message before display.
- Recommendation: see S-1.

### `serverActionId` uniqueness is assumed, not enforced

- Trigger: two catalogue connectors whose `url` normalizes to the same string
  (OAuth) or share a `smitheryQualifiedName` (Smithery) — not currently possible
  to rule out from this file alone.
- Symptom: an action on one card would report as "busy" on the other card too,
  because `catalogueOAuthConnector`/`catalogueSmitheryConnector`
  (`:817-836`) `.find()` the first match and treat it as canonical.
- Evidence: `:802-836`.
- Current handling: none; relies on catalogue data hygiene outside this file.
- Recommendation: not blocking — add (or point to) a
  `ptah-connectors.catalog.spec.ts` assertion that no two connectors share a
  normalized `url` or `smitheryQualifiedName`, so this store's assumption has a
  guard rail.

## Blocking issues

None found. No stub, no TODO/placeholder, no unhandled destroy/workspace race,
no data loss path.

## Serious issues

### S-1: Thrown-exception text now flows verbatim into a user-visible signal

- File: `libs/frontend/marketplace/src/lib/data/connector-links.store.ts:893-899`
  (`messageOf`), consumed at `:507-509` (disconnect), `:538-539`
  (runOAuthConnect), `:584-585` (installSmithery), `:613-614`
  (openSmitherySetup), and written into `actionError` via `fail()` (`:838-841`).
- Scenario: any of the four `catch (error: unknown)` blocks catches a real
  exception (network failure, IPC/serialization error, an `Error` thrown by the
  RPC transport). `messageOf` returns `error.message` whenever it is a non-empty
  string, instead of the fallback text.
- Comparison with the code it replaces: `connectors-surface.component.ts` never
  did this. Every equivalent catch block there used a fixed string —
  `` `Failed to connect ${connector.label}` `` (`:495-500`),
  `` `Failed to disconnect ${connector.label}` `` (`:441-446`),
  `` `Failed to install ${connector.label}` `` (`:540-545`),
  `` `Could not open the setup page for ${connector.label}` `` (`:569-576`) —
  and discarded the caught value entirely (bare `catch {}`). Grepping the old
  spec (`connectors-surface.component.spec.ts`) for any assertion on thrown-error
  message content returns nothing; the new spec adds one
  (`connector-links.store.spec.ts:683-696`, "reports a thrown connect as a failed
  outcome with its message"), which pins the new behaviour but does not address
  its safety.
- Impact: `connector.url`/`record.serverUrl` used in these calls can be a
  user-entered custom MCP server address (the `oauth-app`/custom-url flow lets a
  user paste any URL). Network/transport error objects from `fetch`/`undici`
  commonly interpolate the failing request URL into `.message` (e.g. "fetch
  failed: https://host/mcp?..."). If such a URL carries an embedded credential
  in its query string — a known anti-pattern some self-hosted MCP servers still
  use — that credential now reaches the webview UI where the old code never
  exposed anything beyond a fixed string. This is a plan-C4-adjacent change that
  implementation-plan.md's "Failure behaviour" section for C4 (:327-328) does not
  request or discuss, and R3 (env/header masking, :106, :512) does not cover it
  either since it only scoped `ConfigSummary`.
- Fix: either (a) keep `messageOf` but strip anything after the first `?` in a
  URL-shaped substring / cap and sanitize the message before it reaches
  `actionError`, or (b) revert the thrown-exception branches to the old fixed
  -string fallback and keep raw text only for the RPC-level `result.data.error`/
  `result.error` strings (those are backend-authored and were already surfaced
  unchanged by the old code, so no new exposure there). Either fix needs a spec
  proving a URL-with-query-string thrown message does not appear verbatim in
  `actionError()`.

## Moderate and minor issues

- M-1 (`opened:false` misclassified) — see Failure modes above;
  `connector-links.store.ts:604-612`. Ruled: preserve for this batch, follow-up
  ticket.
- M-2 (silent poll timeout) — see Failure modes above;
  `connector-links.store.ts:638-644`. Inherited, non-blocking.
- M-3 (`serverActionId` uniqueness unenforced) — `connector-links.store.ts:802-836`.
  Add a catalogue-level spec, not a store-level fix.
- Minor: single global `actionError` signal can show one connector's error text
  under an unrelated card if a page renders it without keying on the acting
  connector — `connector-links.store.ts:193,238-239`. Inherited from
  `connectors-surface.component.ts:191`; flag for the page-layer consumer
  (Connectors page, Batch 9+) to key error display per row/card rather than
  globally.

## Data flow

1. Page calls `ensure()` (`:381-384`) → no-op unless `state==='idle'` → `load()`.
   OK.
2. `load()` bumps `loadGeneration`, snapshots `scope.generation()`, sets
   `state:'loading'`, fires `readOAuth()`/`readSmithery()` in parallel
   (`:697-706`). OK — independent failure isolation confirmed by spec.
3. On resolution, a staleness guard (`destroyed` / generation / workspace
   mismatch) drops the result (`:708-714`). OK — covered by
   "a load superseded by a newer one publishes nothing" and the workspace-switch
   "drops a read that started under the previous workspace" specs.
4. Non-stale halves are written to their signals; a Smithery inline `error` is
   routed to `smitheryUnavailable`, not `loadError` (`:715-731`). OK.
5. `links` computed re-derives the full catalogue → status map from the latest
   signals on every read (`:270-308`). OK, pure and total over `this.connectors`.
6. An action (`connect`/`authorize`/`reconnect`/`disconnect`) checks
   `isBusy`/`isActionBusy` synchronously, then synchronously adds to `busyIds`
   before its first `await` (verified: async-function body runs synchronously up
   to the first `await`, so the busy flag is visible to a second synchronous
   caller before the first call's promise even resolves). OK — matches the "no
   double connectOAuth" requirement, and the spec's "never runs a second
   connectOAuth for a connector already busy" checks this precise race.
7. A successful action calls `await this.load()` to re-derive `links` from fresh
   data (`:501,532,577`) rather than optimistically patching state — OK, avoids
   drift between the merge and the action's own belief about the result.
8. Smithery setup: `installSmithery` → `openSmitherySetup` → `startSetupPoll` →
   timer chain that self-reschedules until settled or deadline, then reloads
   (`:629-649`). OK, and destroy cleanly interrupts every stage (`:208-213`,
   `:684-688`).
9. `messageOf` (`:893-899`) is the one step in this flow with an unresolved
   safety question — see S-1.

## Requirements fulfilment

| Requirement                                                                                  | Status   | Gap                                                                                             |
| -------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `ensure`/`reload` (idle-gated, supersede-in-flight)                                          | COMPLETE | none                                                                                            |
| `links`, `statusFor`, `datesFor`                                                             | COMPLETE | none                                                                                            |
| `connect`/`authorize`/`disconnect` per-kind routing                                          | COMPLETE | none                                                                                            |
| Smithery install → setup → poll (3s / 5min)                                                  | COMPLETE | deadline outcome is silent (M-2, inherited)                                                     |
| `busyIds`/`pollingIds`, no duplicate `connectOAuth` for a busy id                            | COMPLETE | none                                                                                            |
| `actionError`                                                                                | COMPLETE | global rather than per-connector (inherited); raw exception text now surfaces (S-1)             |
| `oauth-app` connect returns `needs-setup` with no RPC                                        | COMPLETE | none — spec asserts zero calls                                                                  |
| URL normalisation imported from `@ptah-extension/shared`                                     | COMPLETE | old local copy correctly not duplicated here                                                    |
| `managedByPtah` withholds Disconnect, Authorize explains                                     | COMPLETE | none                                                                                            |
| `DestroyRef` clears every poll timer                                                         | COMPLETE | none                                                                                            |
| `WorkspaceScopeService.generation` reload without navigation (Batch 6 acceptance)            | COMPLETE | spec explicitly asserts no router call                                                          |
| `reconnect(server)`/`isServerBusy(server)` (plan integration point, not itemised in C4 body) | COMPLETE | shares the busy key correctly; uniqueness of the underlying catalogue match is unverified (M-3) |

Implicit requirements not addressed: sanitizing thrown-error text before it
reaches a user-visible signal (S-1); per-connector error scoping (minor, listed
above).

## Edge cases

| Case                                                                  | Handled                        | How                                                                                                                                                                                                                                                                          | Concern                                                |
| --------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Smithery `error` field without a throw                                | YES                            | routed to `smitheryUnavailable`, not `loadError` (`:715-731`)                                                                                                                                                                                                                | none                                                   |
| Two `ensure()` calls before the first resolves                        | YES                            | second is a no-op once state leaves `idle`; spec `:248-255`                                                                                                                                                                                                                  | none                                                   |
| `reload()` while `ready`                                              | YES                            | always re-reads, generation-guarded                                                                                                                                                                                                                                          | none                                                   |
| Workspace switch while idle                                           | YES                            | effect no-ops (`:315-322`); spec `:363-371`                                                                                                                                                                                                                                  | none                                                   |
| Workspace switch while loading                                        | YES                            | in-flight read's result dropped, fresh read runs once the effect ticks; spec `:382-409`                                                                                                                                                                                      | none                                                   |
| Workspace switch to the currently-active workspace                    | YES                            | `generation === seenWorkspaceGeneration` short-circuits; spec `:373-380`                                                                                                                                                                                                     | none                                                   |
| Destroy mid-poll                                                      | YES                            | timers cleared, `pollingIds` emptied, in-flight tick's `destroyed` check stops it publishing; spec `:995-1012`                                                                                                                                                               | none                                                   |
| Poll deadline reached without settling                                | YES                            | stops, reloads                                                                                                                                                                                                                                                               | no explicit "timed out" signal to the caller/UI (M-2)  |
| `openSmitherySetup` returns `opened:false`, no error                  | YES (as failure)               | generic `fail(fallback)`                                                                                                                                                                                                                                                     | misclassifies "already connected" as an error (M-1)    |
| Two busy actions for the same catalogue-matched server via card + row | YES                            | shared `actionId` via `serverActionId`; spec `:784-800`                                                                                                                                                                                                                      | relies on catalogue URL/qualifiedName uniqueness (M-3) |
| Thrown exception during any RPC round trip                            | YES (surfaces text)            | `messageOf` returns `error.message`                                                                                                                                                                                                                                          | potential leak of URL-embedded secrets (S-1)           |
| File size vs 700-line soft cap                                        | N/A (not a code-logic concern) | 899 raw lines, but 637 non-comment/non-blank lines (measured directly) — under both the 700-line `max-lines` threshold and the `skipBlankLines`/`skipComments` accounting the rule uses. Rule is `warn`, not `error`, in `eslint.config.mjs:514-517`. No lint warning fires. | See ruling below.                                      |

## Ruling: file size / split

`connector-links.store.ts` is 899 raw lines but 637 effective (non-blank,
non-comment) lines — under the repo's 700-line `max-lines` accounting, which
explicitly `skipBlankLines`/`skipComments` (`eslint.config.mjs:514-517`), and
that rule is `warn`, not `error`, workspace-wide. No split is required by the
numeric rule, and none fires in lint.

On the substantive question (would a facade split — e.g. extracting the Smithery
poller into an injected collaborator — improve this file): not warranted now.
The poller is tightly coupled to signals the store itself owns (`_busyIds`,
`_pollingIds`, `_actionError`, and the `load()` it triggers on settling); an
extracted collaborator would need either back-references to the store or a
callback-heavy interface, trading one well-commented 900-line file organized
into six clearly bannered sections (Reads / Loading / Actions / Setup poll /
Load / Internals) for two smaller files coupled by an ad hoc contract. Revisit
only if a later batch needs the poller logic somewhere else (no such need is
named in the plan).

## Verdict

- Recommendation: CHANGES REQUESTED
- Confidence: HIGH
- Top risk: S-1 — raw thrown-exception text (potentially including a
  URL-embedded credential from a user-configured custom MCP server) now reaches
  `actionError()` and, from there, the UI, where the component this store
  replaces always substituted a fixed string. This is an unreviewed,
  undocumented behaviour change (not requested by implementation-plan.md C4),
  newly tested for its existence but not for its safety.
- What a robust implementation would add: (1) redact or drop raw
  `Error.message` text before it reaches `actionError` for the four thrown
  -exception branches, with a spec proving a URL-with-secret does not leak; (2)
  a follow-up ticket for the `opened:false`/"already connected" misclassification
  (M-1), left as-is in this batch per the preserve-behaviour mandate; (3) a
  catalogue-level uniqueness spec backing the `serverActionId` sharing rule
  (M-3). None of these require reshaping the store's structure or its 12
  migrated behavioural guarantees, all of which are intact and well covered by
  the 53 dedicated specs (464/464 project-wide, verified in this review).
