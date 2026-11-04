# Research Report - TASK_2026_874_93f0

## Question

- Decision this supports: which smallest code change makes each Electron welcome vitals source (`PlanLimitsStore`, `RecentWorkspacesStore`, `HostInventoryCache`) load reliably, and in what order to land them.
- Question: Why does the no-workspace Electron welcome miss plan-limit providers, recent workspaces, or host inventory counts, and what is the smallest fix for each path?
- Bounds: `UsageVitalsCache` and `analytics:spendSummary` were not investigated. No running Electron session was observed. No external docs were required; every claim is from this worktree.

## Answer

The plan-limit tile is the unreliable one, and the request scope is not why. `provider:getPlanLimits` does not return "only the remembered provider" or "only providers with a registered surface." Those fields only add one selected route, session owners, and explicit owner keys. Codex, Grok, OpenCode, and Antigravity are added only when `detectAll()` finishes inside a 12-second discovery deadline. The welcome starts that discovery and, in the same open, `agent:detectClis` clears the in-flight detection, so the deadline is the likely miss. After at most three one-second retries the snapshot is kept, including a failed read that the ring renders as "no plan window." The welcome clock does not load plan limits again.

Recent workspaces are a separate, healthier path: Electron-only `workspace:listRecent` over global state written by `workspace:switch`, re-read on every welcome visit. Host inventory retries on the welcome clock, but a thrown `skillsSh:listInstalled` is answered as `{ skills: [] }`, which the cache stores as a real zero for 60 seconds.

Recommendation: fix plan limits first (stop clearing an in-flight CLI scan, and reload from the welcome while the snapshot is a failure or `discoveryIncomplete`). Then stop the skills handler from reporting a scan error as zero. Leave the recents path unless a later run shows `exists` hiding live folders.

## Evidence

| Claim | Source | Date | Verified how |
| --- | --- | --- | --- |
| Welcome reads plan limits, recents, CLI count, and skill count. It calls `recentWorkspaces.load()` on construct and again on the shared clock only when recents are `error`. It never calls `planLimits.load()` itself. | `libs/frontend/chat/src/lib/services/vitals/welcome-vitals.store.ts:40-115` | undated | read the source |
| The only automatic plan-limits pull for this screen is `injectVitalsTick`, once, and only when `snapshot()` is `null` or `now()` is more than 60s behind the wall clock, and only when `loading()` is false. | `libs/frontend/chat/src/lib/services/vitals/usage-vitals.view.ts:68-88` | undated | read the source |
| `load()` sends the remembered `providerId` plus, only when `surfaceScopes.size > 0`, the union of `sessionIds` and `ownerKeys`. Welcome never calls `registerScope`. Omitting those fields is the no-surface request. | `libs/frontend/core/src/lib/services/plan-limits.store.ts:144-168`, `:231-250` | undated | read the source |
| A failed or malformed pull sets `loadError` and, if nothing is held, installs `{ generatedAt: 0, owners: [], sessionOwners: {} }`. A later pull with an older `generatedAt` cannot replace a newer snapshot. | `libs/frontend/core/src/lib/services/plan-limits.store.ts:175-273` | undated | read the source |
| The ring is `empty` (caption "no plan window") whenever the snapshot is non-null but no owner has a window with `used`. A failure placeholder takes that path. The ring shows one owner: the first with a used window, not every provider. | `libs/frontend/chat/src/lib/services/vitals/usage-vitals.model.ts:239-286`; `usage-vitals.view.ts:181-194`; `welcome-vitals.view.ts:102-114` | undated | read the source |
| `provider:getPlanLimits` parses the optional scope and returns `PlanLimitsSnapshotService.snapshot`. It does not filter the roster down to `providerId`. | `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts:253-267`; `provider-rpc.schema.ts:133-140` | undated | read the source |
| Discovery always runs seven sources: selected route, CLI stores, requested sessions, detected Codex lane, enabled Ollama Cloud / Kimi Ptah CLI lanes, requested owner keys, and ledger owners with live evidence. A source that throws or misses its deadline is dropped, not listed. `discoverTargets` never rejects. | `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts:8-56`, `:226-358`, `:744-786` | undated | read the source |
| CLI stores are installed OpenCode, Antigravity, and Grok. The Codex lane is installed Codex. Both run only after `detectAll()` and receive `[]` when detection times out. Detection's own deadline is 12s, and the snapshot reserves 12s of a 24s budget for the later reads. | `plan-limit-owner-discovery.service.ts:190`, `:243-291`, `:453-558`; `plan-limits-snapshot.service.ts:91-93`, `:156-170`; `libs/shared/src/lib/utils/plan-limits/evidence-precedence.ts:16-39` | undated | read the source |
| Claude on the welcome has no session. An API-key route is `unsupported-auth` and is not read. A Claude CLI route with no ambient native session is `no-open-session` and is not read. Neither has a `used` window unless the ledger already does. Providers outside `planOwnerRead` are omitted entirely. | `plan-limit-owner-discovery.service.ts:387-450`, `:691-705`; `plan-owner-read.ts:102-195` | undated | read the source |
| `discoveryIncomplete` is true only when the detection source timed out. The store retries `load({}, true)` at 1s, at most three times, then stops. The retry keeps the remembered `providerId`. | `plan-limits-snapshot.service.ts:165-168`; `plan-limits.store.ts:186-197` | undated | read the source |
| The first auth sync does not load plan limits (`previous === null` returns). A later provider identity change loads with `activeProviderId()`. The dashboard card also loads with that id, but it is not mounted on the welcome. | `libs/frontend/core/src/lib/services/auth-state.service.ts:1388-1411`; `provider-account-card.component.ts:207-210`; `electron-shell.component.ts:385-397` | undated | read the source |
| `agent:detectClis` calls `invalidateCache()` then `detectAll()`. `invalidateCache` sets `detectionInFlight` to null while a scan can still be running, so the next `detectAll` starts a second scan. The first scan's promise still resolves for whoever awaited it. | `agent-rpc.handlers.ts:1252-1259`; `cli-detection.service.ts:146-164`, `:286-293` | undated | read the source |
| Welcome field init calls `injectVitalsTick()` (posts `provider:getPlanLimits`) before the inventory effects run. Electron IPC from one renderer is ordered, and the plan-limits handler awaits, so `detectClis` can run while that `detectAll` is in flight. | `welcome-vitals.store.ts:45-89`; `claude-rpc.service.ts:144-222`; `preload.ts:24-27` | undated | read the source; the overlap is inferred from that order, not from a trace |
| Carry-forward does not keep owners the newer snapshot omitted. A later incomplete snapshot replaces the roster. | `plan-limits-snapshot-carry.ts:73-95` | undated | read the source |
| Recents: Electron calls `workspace:listRecent` with a 10s timeout. Non-Electron returns `empty` and does not call. Invalid payloads and RPC failures are `error`. `empty` and `ready` stick for 60s unless `refresh()` is used. Welcome's `load()` is `refresh()`, so each visit bypasses the TTL. | `recent-workspaces.store.ts:21-68`; `vitals-load.ts:20-96` | undated | read the source |
| The list is global state `ptah.recentWorkspaces`, newest first, cap 8. Only `workspace:switch` records, fire-and-forget. `exists` false hides a row; a 1.5s timeout or a throw keeps it. The schema is `.strict()`. | `recent-workspaces.service.ts:47-52`, `:70-80`, `:171-197`; `workspace-rpc.handlers.ts:151-179`, `:389-390`; `rpc-workspace.types.ts:6-22` | undated | read the source |
| Welcome mounts only after workspace sync settles, and only when no folder is open. Sync's `workspace:getInfo` / `workspace:switch` already used the same RPC bridge. Preload sets `window.vscode` and `ptahConfig.isElectron: true` before Angular. | `electron-shell.component.ts:378-397`; `electron-layout.service.ts:879-974`; `preload.ts:24-38`; `vscode.service.ts:134-147`, `:182-184` | undated | read the source |
| `postRpcMessage` drops the call with no rejection when `vscode` is missing. The promise then waits out its timeout. That window is closed on this screen because preload runs first and welcome waits for a completed workspace RPC. | `claude-rpc.service.ts:245-251`; `preload.ts:24-27` | undated | read the source |
| Skills and CLIs are root caches. Ready/empty last 60s; a failure retries on the next read at least 5s later. The welcome clock is 30s, so a failure retries on the next tick. Client timeout is 10s. | `host-inventory.cache.ts:20-61`; `vitals-load.ts:20-96`; `usage-vitals.view.ts:115-138` | undated | read the source |
| CLI count is installed and `disabled !== true`. `skillsSh:listInstalled` on throw returns `{ skills: [] }` after logging. The cache maps any array to `ready` with that length, so a scan error becomes zero for 60s. With no folder open the handler passes `workspaceRoot` null, so only global roots are listed. | `host-inventory.cache.ts:33-50`; `skills-sh-rpc.handlers.ts:307-327`; `skills-sh-rpc.handlers.spec.ts:742-747` | undated | read the source |
| `agent:detectClis` has no server cache: it invalidates, scans every adapter, and throws on failure. The client then shows `error`, not zero. | `agent-rpc.handlers.ts:1252-1274`; `host-inventory.cache.spec.ts:62-69` | undated | read the source |

## Options

| Option | Fit here | Cost to adopt | Known failure mode |
| --- | --- | --- | --- |
| Welcome reloads plan limits on the shared clock while `loadError()` or `snapshot().discoveryIncomplete` is set, and the ring treats the `generatedAt: 0` placeholder as `error` | Matches the existing recents-error effect in `WelcomeVitalsStore`. Does not change which owners the host returns. | `welcome-vitals.store.ts` constructor effect, and `planRing` so it reads `loadError()`. Regression in `welcome-vitals.store.spec.ts`. | A 24s RPC every 30s while discovery stays incomplete. Bounded by the screen lifetime. |
| `invalidateCache()` must not null `detectionInFlight` | Welcome's `agent:detectClis` and `provider:getPlanLimits` share `CliDetectionService` on one Electron process. | `cli-detection.service.ts` `invalidateCache`. Regression in `cli-detection.service.spec.ts`: a caller awaiting `detectAll` still receives that scan if `invalidateCache` runs mid-flight, and the next call after it finishes scans again. | A `detectClis` that wanted a brand-new scan joins the scan already running. That scan is the one the welcome just started. |
| Make `skillsSh:listInstalled` reject on failure instead of `{ skills: [] }` | `HostInventoryCache` already logs a failed RPC and shows `error`, then retries. | `skills-sh-rpc.handlers.ts` `registerListInstalled` catch. Regression in `skills-sh-rpc.handlers.spec.ts`. | Callers that treated `[]` as "none installed" will see an error. The marketplace list was not re-checked in this pass. |
| Change `request()` so a welcome load sends every main provider id | Does not fit. The backend already discovers CLI stores and lanes without those ids. Sending them would not bring back a source the 12s deadline dropped. | Would touch the shared store every chat surface uses. | Easy to narrow the dashboard roster by accident. |
| Record recents somewhere other than `workspace:switch`, or poll them on the 30s clock | Not supported by a bug in the welcome read path. The list updates on each visit via `refresh()`. | New write site in restore or remove-folder. | A second writer can race the existing serial `record()` chain. |
| Not examined: raising `VITALS_RPC_TIMEOUT_MS` above 12s for `agent:detectClis` only, and scanning every workspace's skills from the welcome. | Both would change timeouts or product scope beyond the missed load. | Unknown; not designed here. | A longer detect blocks the welcome cell; a cross-workspace skill scan can count folders the user has not opened. |

## Disagreements

- "The tile shows only the remembered provider, or only providers with a registered surface." The store comment at `plan-limits.store.ts:231-234` says a dashboard with no surface names only its provider. The handler does use `providerId` as `selectedProviderId`, but `discoverTargets` still adds CLI stores, lanes, and ledger owners. The comment describes the request, not the roster. What decides it is `plan-limit-owner-discovery.service.ts:252-322`.
- "A failed plan read is visible." `PlanLimitsStore` sets `loadError`, but `toPlanRingLoad` never reads it. An empty placeholder becomes `empty` / "no plan window" (`usage-vitals.view.ts:184-185`). The dashboard card does read `loadError` (`provider-account-card.component.ts:196-204`). Same store, different surfaces.
- "Recent workspaces are the Electron workspace provider's open folders." They are not. Open folders come from `workspace:getInfo`. Recents are `IStateStorage` key `ptah.recentWorkspaces`, written only on `workspace:switch`.

## Local consequences

- `libs/frontend/chat/src/lib/services/vitals/welcome-vitals.store.ts`: add a clock effect that calls `planLimits.load()` while `loadError()` or `discoveryIncomplete` is set, beside the recents-error effect. Point `planRing` at `error` when the held snapshot is the failure placeholder.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts`: `invalidateCache` should clear `detectionCache` and `modelCache` only. Leave `detectionInFlight` so the welcome's `detectClis` joins the scan `getPlanLimits` already started.
- `libs/backend/rpc-handlers/src/lib/handlers/skills-sh-rpc.handlers.ts`: the `listInstalled` catch should fail the RPC. The cache then shows `error` and the welcome tick retries.
- `libs/frontend/chat/src/lib/services/vitals/recent-workspaces.store.ts`: no change from this evidence. A regression, if any is added, belongs in `recent-workspaces.store.spec.ts` and should keep "empty off Electron" and "reload keeps the last list."
- `libs/frontend/core/src/lib/services/plan-limits.store.ts`: the three incomplete retries can stay. They are too short to cover a detection scan that is still running, which is why the welcome clock has to continue.

Rank by impact:

1. Plan limits: `invalidateCache` plus the welcome reload and the ring's failure state. This is the tile that stays wrong after one cold open.
2. Skills: stop turning a thrown list into a cached zero. CLI count already surfaces `error` and retries; it gets better automatically if the detection scan is no longer doubled.
3. Recents: no change. The read path matches its tests.

## Unknowns

- How often `detectAll()` exceeds 12s on a cold Electron start was not measured. The race is in the code; the timeout rate is not. Smallest experiment: log `[PlanLimitOwnerDiscovery] source timed out` with `source: 'detection'` once on the welcome open.
- Whether a Codex or Grok read that finishes still has no `used` on first launch (empty ledger, `service-unavailable`) was not executed. If detection succeeds and the ring is still empty, the next change is in `selectPlanRing`, which this report does not recommend.
- `skillsSh:listInstalled` duration against the 10s client timeout was not measured. A timeout is already `error`. Only the thrown-and-swallowed path becomes a false zero.
- Marketplace callers of `skillsSh:listInstalled` were not all read. The handler change needs that spec (`skills-sh-rpc.handlers.spec.ts`) and a look at `installed-skills-page` before it lands.
- `IFileSystemProvider.exists` returning false for a live path would hide a recent row until the cap drops it. No Electron trace of that was taken.

## Decisions

- Decision: treat "main providers missing" as detection-deadline plus a one-shot welcome load, not as a request-scope filter. Options were those two readings of `plan-limits.store.ts:231-250`. Evidence is `discoverTargets` still scheduling CLI stores and lanes when `providerId` and surface ids are absent. Reversible: a later trace that shows detection finishing inside 12s and the ring still empty moves the fix to `selectPlanRing`.
