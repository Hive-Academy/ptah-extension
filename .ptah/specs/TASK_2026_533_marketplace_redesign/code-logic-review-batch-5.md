# Code Logic Review — Batch 5 (MarketplaceInventoryStore) — TASK_2026_533

## Summary

| Metric          | Value    |
| --------------- | -------- |
| Overall score   | 8/10     |
| Verdict         | APPROVED |
| Blocking issues | 0        |
| Serious issues  | 1        |
| Moderate issues | 2        |

Scope read in full: `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts` (698 lines), `marketplace-inventory.store.spec.ts` (1193 lines, 48 tests), `connected-surface.component.ts` (full, incl. lines 260-820), `marketplace-hub.component.ts` (full), `mcp-connector-rows.ts` (full, worktree/pre-7a version), `installed-mcp-removal.ts`, `installed-mcp-groups.ts` (`InstalledServerGroup` shape), `session-mcp-status.registry.ts`. No `ptah_get_diagnostics` run: this worktree is not the active VS Code workspace, so a scoped compiler check would not resolve against it; correctness was verified by full source trace instead.

## Integration check (mcp-connector-rows.ts after commit 1d01377b8)

**PASS.** The store imports exactly one symbol from the connector-rows file:

- `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts:33` — `import { toConnectorRows } from '../mcp-connector-rows';`

`marketplace-inventory.store.spec.ts` imports nothing from `./mcp-connector-rows` or `../mcp-connector-rows` at all — its fixtures build `InstalledMcpServer`/`InstalledServerGroup` objects by hand (`store.spec.ts:84-155`, `709-723`).

`normalizeServerKey` is used internally by `mcp-connector-rows.ts:77,82` but is never imported into either reviewed file — it is only referenced as an unexported local helper from the store's point of view. `toConnectorRows` (the only symbol actually imported) and `CLAUDE_CONNECTOR_REMOVAL_REASON` both survive commit `1d01377b8` per the task's own description of that commit. There is no import of `normalizeServerKey` (or anything else removed by 7a) from `mcp-connector-rows.ts` in either the store or its spec, so this batch will not break when it rebases onto/merges after Batch 7a.

## Five logic questions

### 1. How does this fail silently?

- No silent-success masking of failures was found on the load paths: every RPC/catalogue failure becomes a slice `error` (`store.ts:429-456`), every removal failure becomes an `actionError` or a `failed`/`refused` outcome (`store.ts:571-587`), and `catch (error: unknown)` is used throughout (`store.ts:432`, `579`) with `messageOf` falling back to a fixed string only when the thrown value carries none (`store.ts:165-167`).
- One near-silent gap: `setPending` (`store.ts:690-696`) has no `this.destroyed` guard, unlike its sibling `setActionError` (`store.ts:678-688`, guarded at line 682). A removal that is still in flight when the shell is torn down will still flip `_pendingIds` on completion even though the store is dead — no failure is reported anywhere because nothing is supposed to read a destroyed store, but it is an unguarded write the class's own contract ("No late publish after destroy") promises not to do. See Serious-1.
- `readPlugins` (`store.ts:472-478`) trusts `PluginCatalogService.error()` to be current the instant `ensureLoaded()`/`refresh()` resolves. If the catalogue ever updated its error signal asynchronously after its promise settles, this slice would report `ready` when a failure just occurred. Not observable in this store's own code — it is an assumption on an external dependency's contract, which the class doc explicitly names (`store.ts:467-471`) and the spec pins with a mocked catalogue (`store.spec.ts:460-471`).

### 2. What user action produces unexpected behaviour?

- Switching the active workspace while a slice is loaded makes that slice's rows disappear immediately (`state: 'loading', data: []`, `store.ts:426-427` with `discardData=true` from `reloadRequested(true)` at `store.ts:376`), confirmed by the spec at `store.spec.ts:1127`. This is a real, visible flash of empty content — but it is the correct behaviour, not a defect: the alternative (keeping the previous workspace's rows on screen while the new workspace loads) would show the wrong workspace's installed servers/plugins/skills as if they belonged to the new one, which is the leak the workspace-generation guard exists to prevent. `notifyContentChanged()` deliberately takes the opposite path (`discardData=false` at `store.ts:408`) so a same-workspace reload after an install/removal does not flash.
- Clicking Remove on a row currently mid-removal is refused with an `in-progress` outcome rather than being queued or silently ignored (`store.ts:595-601`, `store.spec.ts:998-1017`) — correct, not a surprise.
- Removing a `direct` (unmanaged) row without confirmation is refused with a `needs-confirmation` message that never reaches the RPC layer (`store.ts:613-621`, `store.spec.ts:856-873`) — matches the pinned edge case in `batches.md`.

### 3. What input data produces a wrong answer?

- A blocked row that also happens to carry a stray `removalFixCommand` while `removal !== 'none'` is correctly ignored — `removalLockOf` (`store.ts:124-130`) reads the field only behind `group.removal !== 'none'`, and this is the only read site in the file (verified by inspection — no other reference to `removalFixCommand` anywhere else in `store.ts`). Pinned by `store.spec.ts:743-754` ("ignores a fix command on a removable %s row") and `:756-769`.
- The store passes the RPC's `InstalledMcpServer[]` straight through (`readInstalled`, `store.ts:459-465`) into `groupInstalledServers`, whose `InstalledServerGroup.servers` field is the raw `InstalledMcpServer[]` (`installed-mcp-groups.ts:30`), including the whole `config` object — `env`/`headers` and any secret values it carries. `store.installed()` therefore exposes raw secrets in its `data`, not just keys. This is consistent with the plan (masking is explicitly deferred to `provider-row.ts`, Batch 8) and the store's _own_ authored text never embeds a raw value (the `needs-confirmation` message uses `configPaths`, a path, not `config` — `store.ts:617-619`), so this is not a leak introduced by this batch. But the spec's "never puts an env or header value into a store-authored message" test (`store.spec.ts:790-805`) only exercises locally-constructed `InstalledServerGroup` objects built directly in the spec (`store.spec.ts:709-723`), never the real `RPC → readInstalled → groupInstalledServers → store.installed()` pipeline with a secret-bearing server. See Moderate-1.
- No other wrong-answer path found: generation/workspace comparisons, connector de-duplication (unchanged, Batch 7a-owned), and removal routing all matched the old component's logic 1:1 in my trace.

### 4. What happens when a dependency fails?

- `ClaudeRpcService.call` returning `isSuccess() === false`: every loader (`readInstalled`, `readCommunity`, `readMarketplaces`, `performRemoval`'s three branches) reads `.error` with a fallback string — none silently treats a non-success result as success.
- `ClaudeRpcService.call` throwing: caught generically in `load()` (`store.ts:430-436`) and in `removeOne` (`store.ts:579-587`), both becoming a user-facing `error`/`actionError`. Matches `store.spec.ts:445-458` and `:980-996`.
- `PluginCatalogService.ensureLoaded()/refresh()` throwing: caught by the same generic `try/catch` in `load()` since `readPlugins` is one of the loaders (`store.ts:430`). `PluginCatalogService.error()` reporting non-null without throwing: correctly surfaced as the plugins slice's `error` (`store.ts:476-477`, `store.spec.ts:460-471`) — see the deliberate behaviour-change judgement below.
- `WorkspaceScopeService`/`SessionMcpStatusRegistry` are treated as always-available root services with no null-guard needed (both are `providedIn: 'root'`); no failure mode exists for them beyond the data-shape risk discussed under Q5.

### 5. What is missing that the requirements never mentioned?

- **Connector rows are not workspace-scoped.** `newestSessionStatus` (`store.ts:305-310`) reads `SessionMcpStatusRegistry.sessions()`/`.peek()`, and that registry is `providedIn: 'root'`, keyed purely by session id with no workspace association and no clearing on a workspace switch (`session-mcp-status.registry.ts:43-111`). A workspace switch correctly discards and reloads the `installed` slice's _disk_ servers (`store.ts:372-377`, `426-427`), but the claude.ai connector rows merged into `store.installed()` (`store.ts:321-335`) keep coming from whatever session was last recorded — which may belong to the workspace the user just left. This is not a regression introduced by this batch: `marketplace-hub.component.ts:91-98` had the exact same root-scoped read with no workspace filter, so the gap is inherited unchanged. It becomes newly relevant here because TASK_2026_540 is precisely the "no navigation across a workspace switch" feature this store implements, and nothing in `batches.md`/`implementation-plan.md` calls out session-to-workspace scoping. See Moderate-2.
- No requirement gap found in removal safety, generation handling, or the zero-RPC rule — all were traced against explicit spec assertions and matched.

## Findings

### 1. `setPending` writes to a destroyed store's state — no destroyed guard (Serious)

- File: `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts:690-696`
- Trigger: a removal (`removeOne`, called from `removeServer`/`removeCommunitySkill`/`removeMarketplacePlugin`/`removeMany`) is in flight when the shell destroys the store (user navigates away from the Marketplace mid-removal).
- Symptom: `setPending(id, false)` in `removeOne`'s `finally` (`store.ts:585-587`) still executes after `this.destroyed` is true, mutating `_pendingIds` on a dead instance. Contrast with `setActionError` two methods above it (`store.ts:678-688`), which explicitly checks `if (this.destroyed) return;` at line 682. The class doc promises "No late publish after destroy" (`store.ts:240-253`) and the spec's own `destroy` suite title is "publishes nothing that lands after the shell is gone" (`store.spec.ts:1176`), but that suite only exercises the `ensure()`/load path (`store.spec.ts:1177-1191|), never a removal in flight at destroy time — so this gap has no test that would catch it.
- Impact: low in the current wiring (a destroyed, shell-scoped instance is never re-read by anything, since nothing outlives the shell to observe it), but it is a real inconsistency against the class's own stated invariant, and it is exactly the kind of asymmetry that turns into a real bug the next time this store's lifecycle assumptions change (e.g. if a future caller keeps a reference across teardown, or if `_pendingIds` is ever read from a wrapping root-scoped service).
- Fix: guard `setPending` the same way `setActionError` is guarded (`if (this.destroyed) return;` at the top of the method), and add a destroy-during-removal spec alongside the existing destroy-during-load one.

### 2. Config values pass through the `installed` slice unmasked, and the "no leak" spec doesn't exercise that path (Moderate)

- File: `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts:459-465` (raw pass-through), `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/installed-mcp-groups.ts:30` (`InstalledServerGroup.servers: InstalledMcpServer[]`), spec at `marketplace-inventory.store.spec.ts:790-805`.
- Trigger: any consumer that serializes or logs `store.installed().data[i].servers[j].config` (which carries the full `env`/`headers` object, per the spec's own `diskServer`/`userServer` fixtures at `store.spec.ts:84-131`).
- Symptom: a raw secret (e.g. an API key or bearer token) is reachable through the store's public `installed` signal, not just a key/name.
- Current handling: acceptable for this batch — the plan explicitly defers masking to `provider-row.ts` (Batch 8), and the store's own authored strings (removal-confirmation and error text) never embed a raw value, only `configPaths` (file paths) and server keys/names. The risk-mitigation table in `batches.md` names `ConfigSummary`/`provider-row` as the boundary, not this store.
- Recommendation: not a blocker for this batch, but flag for Batch 8 verification and strengthen the existing "never puts an env or header value..." spec (`store.spec.ts:790-805`) to also assert against `store.installed()` populated via the real `mcpDirectory:listInstalled` RPC responder (the way every other slice test does), not only against locally-constructed `InstalledServerGroup` fixtures that bypass the load path — as written, the test proves the store's own removal messages are clean, but not that `store.installed().data` itself is clean, which it is not.

### 3. Connector rows can leak across a workspace switch (Moderate)

- File: `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts:305-310, 321-335`; root cause in `libs/frontend/chat-state/src/lib/session-mcp-status.registry.ts:43-111` (root-scoped, no workspace key).
- Trigger: user has an active session against workspace A (claude.ai connectors reported), switches the active workspace to B with the Marketplace still open.
- Symptom: `store.installed()` for workspace B still appends connector rows derived from workspace A's session (`newestSessionStatus()` has no workspace filter), potentially showing account connectors that have nothing to do with the newly active workspace, or — if workspace B's own session later reports — silently overwriting them without ever having been wrong-workspace-flagged in between.
- Current handling: none; inherited unchanged from `marketplace-hub.component.ts:91-98`, which had the identical unscoped read.
- Recommendation: out of this batch's file set to fix (the fix belongs in `SessionMcpStatusRegistry` or in how sessions are keyed to workspaces), but worth a follow-up task since this store is the first place TASK_2026_540's "no navigation on workspace switch" model actually exercises this interaction continuously rather than via full component teardown/recreate.

### 4. Race handling — verified correct (no defect)

- Evidence: `load()` captures `generation = ++slice.generation` and `workspace = this.scope.generation()` synchronously before the only `await` (`store.ts:424-425`), then drops the result if either changed, or if `this.destroyed` (`store.ts:438-444`). Because the generation bump is synchronous, any later call to `load()` for the same slice (from `ensure`/`reload`/`retry`/`reloadRequested`) always wins the race against an older in-flight one — pinned by `store.spec.ts:560-579` ("drops a superseded read...") and `:1152-1172` ("drops a read that started under the previous workspace").
- A reload legitimately started _after_ a workspace switch captures the _new_ `this.scope.generation()` value as its own `workspace` baseline (`store.ts:425`, evaluated fresh on every call), so it is not dropped by its own guard unless yet another switch happens before it resolves — in which case dropping it is correct (a newer reload for the newest workspace is already in flight, started by the same effect). Pinned by `store.spec.ts:1106-1140`.

### 5. Zero-RPC rule — verified correct (no defect)

- Evidence: `newestSessionStatus`, `installed`, `plugins`, `community` (via `sliceView`), `marketplaces`, and `counts` are all plain `computed()`s over existing signals (`store.ts:305-361`) with no call to `ensure`/`reload`/`this.rpc`/`this.catalog` anywhere in their bodies. Construction only sets `seenWorkspaceGeneration` from `this.scope.generation()` (a signal read, not an RPC) and registers a `DestroyRef` callback (`store.ts:289-295`). Pinned end-to-end by `store.spec.ts:309-330` ("reads nothing on construction, from slice reads, or from counts").

### 6. Removal safety — verified correct (no defect)

- `direct` without confirmation refused before any RPC: `store.ts:613-621`, `store.spec.ts:856-873`.
- Blocked (`removal: 'none'`) rows refused via `removalLockOf` before any RPC: `store.ts:602-612`, `store.spec.ts:612-636, 771-788`.
- `removeMany` is a strict sequential `for...of` (`store.ts:536-540`), not `Promise.all`/`allSettled` — confirmed both by reading the loop and by the ordering assertion in `store.spec.ts:1065-1072`.
- Exactly one reload for the whole batch, gated on at least one `'removed'` outcome: `store.ts:543-545`, `store.spec.ts:1073-1077, 1084-1100` ("does not reload when nothing was removed").
- `pendingIds` add/remove is symmetric via `try/finally` (`store.ts:570-587`) on every exit path including the thrown-error branch, and a concurrent duplicate removal of the same id is refused before it is ever marked pending a second time (`store.ts:595-601`), pinned by `store.spec.ts:998-1017`. (See Finding 1 for the one asymmetry, in the destroy path rather than the concurrency path.)

### 7. `removalFixCommand` read discipline — verified correct (no defect)

- `removalLockOf` (`store.ts:124-130`) is the only place `removalFixCommand` is read in the file; it is gated behind `group.removal !== 'none'` returning `null` first. Explicitly pinned by `store.spec.ts:743-754` (ignored on every removable `removal` kind) and `:756-769` (removable row with a stray fix command removes normally, calling the RPC, not surfacing the command).

### 8. Plugins-slice error surfacing — deliberate, correct behaviour change (judged, not a defect)

- Old `connected-surface.component.ts:523-539` (`loadPlugins`) awaits `catalog.ensureLoaded()` and, if it resolves without throwing, unconditionally sets `pluginsLoad` to `{ state: 'ready' }` — it never reads `PluginCatalogService.error()`. If the catalogue recorded a failure internally but its promise still resolved (its own stated contract: "a root, workspace-scoped cache that never rejects: it publishes a failure on `error()` instead" — `store.ts:467-471`), the old surface would show the plugins group as `ready` with whatever `enabledPlugins()` currently holds (possibly empty), with no indication anything failed.
- New `readPlugins` (`store.ts:472-478`) reads `this.catalog.error()` after the await and turns a non-null value into the slice's `error` state, tested at `store.spec.ts:460-471`.
- Judgement: this is a correct, intentional improvement, not unreviewed drift. It closes a real silent-failure path (a `ready` state that actually means "the catalogue failed, but I'm not telling you") and is explicitly documented as the reason for the design (`store.ts:467-471`) and directly pinned by a spec. I did not find a case where the new behaviour produces a _false_ error (i.e. `catalog.error()` non-null while the load genuinely succeeded) — the store's read is a straight pass-through of the catalogue's own signal.

### 9. Post-destroy safety — mostly correct, one gap (see Finding 1)

- `load()` checks `this.destroyed` before publishing on every path (`store.ts:438-444`), pinned by `store.spec.ts:1175-1192`.
- `removeAndNotify`/`removeMany` both check `this.destroyed` before calling `notifyContentChanged()` (`store.ts:541, 556`), preventing a reload from being kicked off after teardown.
- `setActionError` checks `this.destroyed` (`store.ts:682`).
- `setPending` does not (Finding 1).
- The `workspaceEffect` itself has no explicit destroyed check, but it only calls `reloadRequested`, which only calls `load()`, which is itself guarded — no gap there.

### 10. Stub/placeholder rejection — none found

- No `TODO`, no `throw new Error('not implemented')`, no placeholder return. Every slice loader performs a real RPC or catalogue call; every removal branch performs a real RPC. `SLICE_IDS`/`LOAD_FALLBACK`/`loaders` are fully wired for all four slice ids with no gaps.

## Requirements fulfilment

| Requirement                                                                                                             | Status                                                                                                                                                                                                                            | Gap                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Four independently loaded slices (`installed`/`plugins`/`community`/`marketplaces`), each `idle\|loading\|ready\|error` | COMPLETE                                                                                                                                                                                                                          | none                                                                                                        |
| `ensure()` only from idle                                                                                               | COMPLETE                                                                                                                                                                                                                          | `store.ts:382-385`, pinned `store.spec.ts:349-365`                                                          |
| `reload()`, `retry()` (retry only from error)                                                                           | COMPLETE                                                                                                                                                                                                                          | `store.ts:388-399`                                                                                          |
| `removeServer(group,{confirmedDirect})`, `removeCommunitySkill`, `removeMarketplacePlugin`                              | COMPLETE                                                                                                                                                                                                                          | same RPCs/messages as `connected-surface.component.ts:763-801` via shared `removeInstalledGroup`            |
| `removeMany(refs)` sequential, per-item outcome                                                                         | COMPLETE                                                                                                                                                                                                                          | `store.ts:533-550`                                                                                          |
| `notifyContentChanged()` reloads only non-idle slices, clears command cache                                             | COMPLETE                                                                                                                                                                                                                          | `store.ts:406-416`                                                                                          |
| `WorkspaceScopeService.generation` effect, reload without navigation                                                    | COMPLETE                                                                                                                                                                                                                          | `store.ts:372-377`; navigation-free reload pinned `store.spec.ts:1106-1140`                                 |
| `newestSessionStatus`                                                                                                   | COMPLETE                                                                                                                                                                                                                          | `store.ts:305-310`; see Finding 3 for a pre-existing scoping gap this exposes but does not create           |
| `removalFixCommand` read only on blocked rows (Batch 1 follow-up)                                                       | COMPLETE                                                                                                                                                                                                                          | `store.ts:124-130`, tested                                                                                  |
| Shell-scoped, no `providedIn: 'root'` (D4)                                                                              | COMPLETE                                                                                                                                                                                                                          | `@Injectable()` with an explicit eslint-disable comment naming the rejected alternative, `store.ts:261-262` |
| Migrate every behavioural assertion of `connected-surface.component.spec.ts`                                            | COMPLETE for behaviour; presentation-only assertions (button labels, empty-state nav targets, decoration status) correctly deferred per the spec's own header note (`store.spec.ts:1-28`) to `provider-row`/`ConnectorLinksStore` | none within this batch's scope                                                                              |
| Migrate `marketplace-hub.component.spec.ts:157-237`                                                                     | COMPLETE                                                                                                                                                                                                                          | `store.spec.ts:584-704`                                                                                     |
| No config value (env/header) in any store-authored message                                                              | COMPLETE for authored text; slice **data** still carries raw values by design (deferred to Batch 8)                                                                                                                               | test only covers authored text + hand-built fixtures, not the real load pipeline (Finding 2)                |

Implicit requirements not addressed: cross-workspace scoping of `SessionMcpStatusRegistry`-derived connector rows (Finding 3) — not named in `implementation-plan.md`/`batches.md`, and not this batch's file set to fix, but surfaced by tracing the workspace-switch behaviour this batch implements.

## Edge cases

| Case                                                     | Handled | How                                                                                                   | Concern                                                                                                                      |
| -------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Ensure while already loading                             | YES     | second `ensure()` is a no-op (`store.ts:382-385`)                                                     | none                                                                                                                         |
| Retry while not in error                                 | YES     | no-op (`store.ts:396-399`)                                                                            | none                                                                                                                         |
| Reload superseding an older read                         | YES     | per-slice generation counter                                                                          | none                                                                                                                         |
| Workspace switch mid-load                                | YES     | old result dropped by workspace-generation check                                                      | none                                                                                                                         |
| Workspace switch with all slices idle                    | YES     | `reloadRequested` skips idle slices (`store.ts:413`)                                                  | none                                                                                                                         |
| Duplicate concurrent removal of the same id              | YES     | `in-progress` refusal before pending is set a second time                                             | none                                                                                                                         |
| `removeMany` with a mix of removed/failed/refused        | YES     | per-item outcome, one reload gated on any success, aggregated `actionError`                           | error text collapses to only the first message when >1 failure on the same slice — acceptable per design, not a logic defect |
| Removal in flight at store destroy                       | PARTIAL | RPC still completes; `actionError` write is guarded, `pendingIds` write is not                        | Finding 1                                                                                                                    |
| Connector row present before installed read lands        | YES     | `installed` computed short-circuits to `[]` while `cells.installed.data()` is `null` (`store.ts:325`) | none                                                                                                                         |
| Config/env/header values reaching the UI                 | PARTIAL | store's own text never embeds them; slice `data` still carries them raw                               | Finding 2, by design for this batch                                                                                          |
| Session-derived connector rows across a workspace switch | NO      | no workspace key on `SessionMcpStatusRegistry`                                                        | Finding 3, inherited                                                                                                         |

## Verdict

- Recommendation: APPROVED
- Confidence: HIGH
- Top risk: a removal still in flight when the Marketplace shell is destroyed writes to `_pendingIds` after `this.destroyed` is true (Finding 1) — low real-world impact today (nothing reads a dead store), but it is the one place the code doesn't hold its own stated "no late publish after destroy" invariant, and it has no test coverage to catch a regression if that assumption ever stops being true.
- What a robust implementation would add: a `this.destroyed` guard in `setPending` symmetric with `setActionError`; a destroy-during-removal spec alongside the existing destroy-during-load one; an "installed slice through the real RPC pipeline never contains an env/header value" spec to replace the current hand-built-fixture version; and a tracked follow-up for workspace-scoping `SessionMcpStatusRegistry` reads (or accepting the cross-workspace connector bleed as a known limitation until that registry is addressed).
