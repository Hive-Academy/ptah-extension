# Code Logic Review — `TASK_2026_616_de8a` (Phase 1)

Scope: `git diff 04a64064e daac44d51` over auth-providers, cli-agent-runtime, rpc-handlers, chat-streaming, shared. Source files were read in full for the reader, resolver, provisional constants, broadcaster, lane-owner resolver; the other hunks were read as diffs plus surrounding context. No source was edited. No jest run (verification evidence taken from the batch records, not re-executed).

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 7/10           |
| Assessment          | APPROVED       |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 4              |
| Failure modes found | 7              |

Marker scan (TODO / FIXME / STUB / PLACEHOLDER) over the non-spec changed files: only the existing `*_PLACEHOLDER` credential constants in provider-owner.resolver.ts (legitimate). No empty bodies, no mock data standing in for logic.

Score separation: 7 not 8 because the observed Antigravity account has no expiry (S1) and the candidate list can silently drop the extension port (M1). Not 5-6 because the owner-mismatch path, D2, D3, the broadcaster bound and the store merges all hold up under trace, and privacy rules are respected.

## Five logic questions

### 1. How does this fail silently?

- Observed Antigravity email never expires. `observedAntigravityAccount` is written only by `observeAntigravityAccount` (provider-owner.resolver.ts:188-195), which the reader calls only after a parsed reply (antigravity-plan-usage.reader.ts:98-101). When the language server disappears (`discoverServer` returns null at :75, or any catch at :135/:140) nothing clears it. `antigravityOwnerRef` (resolver:347-356) then keeps returning the old observed account and never consults `google_accounts.json`. See S1.
- A hung or failing first candidate silently burns the shared 3 s budget (reader:72) and the rest are skipped with `unavailable()`; this is a documented degradation, not misleading.
- Proxy observations with no `sourceId` and no owner key are dropped at debug level (plan-limit-ledger.service.ts:445-451, 466-471): intentional (A5), logged, no success signal produced.

### 2. What user action produces unexpected behaviour?

- Switching the Google account in the IDE while no language server is running (or while the reader finds 0 or 2+ servers, `servers.length !== 1` at reader:165) keeps lanes attributed to the previously observed account until process restart (S1).
- Switching accounts: first read after the switch returns `service-unavailable` once (D1, reader:98-107); the owner re-resolves on the next snapshot. No wrong-account window data is recorded: the `observeAccount` call updates module state before the comparison, so the mismatching reading is discarded and the new owner key is used afterwards. Verified.
- google_accounts.json edits are picked up after up to 5 s (resolver:144), acceptable.

### 3. What input data produces a wrong answer?

- A reply where `remainingFraction` is absent: `toWindow` computes `1 - (undefined ?? 0)` = 100 % used (reader:310) for a window the server did not report a fraction for. Provisional-schema consequence; presents "exhausted" where "unknown" is correct. See M3.
- Duplicate listener ports (IPv4 + IPv6 listeners of the same port give two lsof lines, Windows `Get-NetTCPConnection` likewise): `parseLsofPorts` / the `L` lines are not de-duplicated (reader:195-198, 285-290). `candidates` emits two attempts per port and truncates at 8 (reader:247), so two dual-stack ports fill the cap and the extension-server port fallback is never tried. See M1.
- Email case: lowercased and trimmed in both the observed and the file paths (resolver:161, 190), so both produce the same key material `root\0email`; consistent, so file-fallback and observed owners do not flip-flop.

### 4. What happens when a dependency fails?

- `ps` / `powershell` failure: caught at reader:140, `unavailable()`. OK.
- `lsof` missing: caught at reader:182, falls back to extension port only (candidates still works). OK.
- Reply non-2xx, oversized, closed early, bad JSON: `readJsonResponse` rejects once (`settled`), request destroyed, caught per candidate at :135. OK. Timeout/abort clears via `untilAborted` and the 3 s timer; timer cleared in `finally` (:144).
- `snapshots.currentSnapshot()` or `broadcastMessage` never settles: bounded to 10 s each by `withinBound` (broadcaster:65-81), timer cleared on settle and unref'd, `pushing` freed in `finally` (:171). Verified. The hung inner promise stays referenced until it settles (unavoidable); its late settle is a no-op because `resolve`/`reject` of an already-rejected promise are ignored.
- google_accounts.json unreadable: cached as null for 5 s (resolver:171-180), falls to cli-store owner. OK.

### 5. What is missing that the requirements never mentioned?

- No expiry or clear for the observed Antigravity account (S1).
- No production invalidation hook for the account-file cache (only `resetAntigravityOwnerStateForTests`, resolver:198); the 5 s TTL is the only bound. Minor.
- No dedupe of ports (M1).
- Ledger rows written under the old cli-store key after a D2 upgrade are not migrated; documented and acceptable (lane-owner.resolver.ts:46-52).

## Failure modes

### Stale observed Antigravity account after the server goes away
- Trigger: IDE/language server was seen once with account A; it then exits (or is found twice) and the user signs in as B in the CLI (`agy`, which updates google_accounts.json).
- Symptom: lane runs and the plan-limit tile are attributed to A; B's quota evidence lands on A's owner.
- Evidence: provider-owner.resolver.ts:129, 188-195, 347-351; reader.ts:75, 165 (no clearing on the unavailable paths).
- Current handling: observed key is held for the process lifetime for the same root.
- Recommendation: store `observedAt` and ignore the observation after a bounded age (for example 2-5 min), or clear it when discovery finds no server; fall back to the file reading.

### Extension-port fallback crowded out by duplicate ports
- Trigger: listener output contains each port twice (dual-stack) with 2+ ports.
- Symptom: only duplicate https/http attempts, then `unavailable`, even though the extension port would answer.
- Evidence: reader.ts:195-198, 234-247, 285-290.
- Recommendation: de-duplicate ports (`new Set`) before building candidates and place the extension-port candidates ahead of the cap.

### Shared 3 s budget
- Trigger: first candidate hangs (wrong scheme can stall instead of erroring).
- Symptom: remaining candidates unreached, reading unavailable.
- Evidence: reader.ts:72, 76-88.
- Recommendation: a per-candidate sub-timeout (about 1 s) within the 3 s total.

### Missing `remainingFraction` rendered as 100 % used
- Evidence: reader.ts:310. Recommendation: omit the window (or mark unknown) when `remainingFraction` is undefined.

### Bound on broadcast cannot recall a hung transport call
- Trigger: broadcast hangs, bound fires, next push broadcasts while the first is still pending.
- Symptom: possible out-of-order delivery if the old one later completes. Documented in the header comment (broadcaster:17-24).
- Recommendation: acceptable; the next change carries a full snapshot.

### Dead generation guard
- Evidence: broadcaster.ts:143, 150. `pushing` already serialises pushes, so `generation !== this.pushGeneration` cannot be true while a push is in flight; a late snapshot is already dropped because `withinBound` has rejected. The guard (and its comment claiming a "dirty re-arm started") is dead code. Harmless.

### failingSince growth
- See Moderate M2.

## Blocking issues

None.

## Serious issues

### S1. Observed Antigravity account never expires
- File: libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:129, 188-195, 347-351
- Scenario: see failure mode above.
- Impact: wrong-account attribution of lane quota evidence and owner label for a long-lived host process; contradicts D1's intent that no wrong-account attribution occurs.
- Fix: age-bound the observation or clear it when the reader finds no (or ambiguous) server; add a test for "server gone, file account changed".

## Moderate and minor issues

- M1 (Moderate) reader.ts:195-198, 247, 285-290: ports not de-duplicated; cap of 8 can exclude the extension port.
- M2 (Moderate, severity judged) plan-usage.service.ts:132, 291-292, 306, 329: `failingSince` entries are removed on any non-transient settle and on cache eviction, but an owner that only ever fails transiently never reaches `cache.set` (:307-310), so its entry survives. In practice the key set is the set of owner keys, which is bounded by real accounts/keys plus per-session unknown owners; each entry is a string and a number. It cannot lose data or break a lane config: it is read only in `settle` for the stale-since display. Growth is slow and not user-driven, so Moderate, not Serious. Cheap fix: cap it at `PLAN_USAGE_MAX_OWNERS` with oldest-first eviction, or prune against owners the service has seen.
- M3 (Moderate) reader.ts:310: missing `remainingFraction` becomes 100 % used.
- M4 (Moderate) reader.ts:72-76: single 3 s budget across up to 8 candidates; plus HTTPS agent `rejectUnauthorized: false` (:339-342) is acceptable only because host is hard-coded `127.0.0.1` (:363); keep it that way.
- Minor: reader.ts:99-101 casts `target` for `ownerRef`, which the type already declares as required (plan-usage-reader.types.ts:39); remove the cast.
- Minor: broadcaster.ts:143/150 dead generation guard.
- Minor (already recorded): reader.spec.ts:183-184 vacuous privacy assertion; reader.spec.ts:278 weak `.rejects.toBeDefined()`.
- Minor: resolver cache has no production invalidation (resolver:198 test-only reset).
- Minor: `recordLaneLimits` owner upgrade at exit (agent-process-manager.service.ts:2430-2441) does not emit `agent:quota-owner`, unlike `recordQuotaOwner` (:1007); the card relies on the exit payload carrying the owner. Consistent with the previous unknown-owner exit behaviour.

## Data flow

1. `ps`/PowerShell lists language-server processes, token and ports parsed (reader:154-227). OK; `servers.length !== 1` yields no reading by design.
2. POSIX: padded pid matched by `^\s*(?:P\s+)?(\d+)` (:202); lsof ports added (:171). Gap: duplicates (M1).
3. Candidate requests with `X-Codeium-Csrf-Token`, JSON body, `Content-Type`, `Connect-Protocol-Version` (:361-378). Matches the live-confirmed transport. OK.
4. Zod parse (provisional schema). Failure logs only field path and code (:91-95), no values. OK.
5. `observeAccount(email)` hashes inside the resolver only (resolver:188-195); email not logged or stored beyond a derived key. OK.
6. Mismatch with `target.ownerRef.key` returns `service-unavailable` before any window is built (:98-107). No cross-account windows. OK.
7. Windows built, `windowSetEstablished: true`. Gap: M3.
8. `PlanUsageService.settle` caches, `evictCache` bounds to 64 preserving in-flight (service:306-330). OK; `.sort` per eviction is O(n log n) on n=65, negligible.
9. Lane side: spawn owner (APM:856) -> mid-run `recordQuotaOwner` (:1001) -> exit re-resolve (:2430). `upgradeQuotaOwner` (lane-owner.resolver.ts:54-71) is reached identically on both paths; it upgrades `cli-store` to `account` only when `providerId` is equal, never replaces `account`/`credential`, and handles `unknown` as before. Verified. Old cli-store ledger rows stay and age out (documented); JSDoc in shared agent-process.types.ts:162-168 matches.
10. D3 `resolveModelScope(cli, model)` (APM:2663-2689): only `ptah-cli` is narrowed; others keep trimmed lowercase id. Lane scopes reach the ledger only via `recordSuccess({modelScopes})` (APM:2466-2470; ledger:268 consumes them to clear evidence), so no ledger row is keyed by a lane scope. Existing persisted references with a family scope for non-Claude lanes are display-only. Verified by reading call sites; the ledger-side grep claim in the JSDoc is consistent with ledger:113, 268, 405, 473.
11. Broadcaster: snapshot (bounded) -> broadcast (bounded) -> finally frees `pushing` and re-arms on `dirty`. OK.
12. chat-streaming: `modelScope` merge now uses `!== undefined` on re-open and exit (store:1065-1072, 1296-1302) so null clears; absent keeps. Restored usage fold skips only when `restored === true && usageTotals === null` (:1210); restored cards are created with `usageTotals: null` (:1536), so the guard is reachable and a live segment on a restored card stays unknown by design.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| 1 Antigravity transport (header, JSON body, https/http, extension port, POSIX padded pid, Windows discovery) | COMPLETE | M1 dedupe, M4 per-candidate timeout |
| 1 email -> owner, hashed only in resolver, never logged | COMPLETE | S1 stale observation |
| 1 google_accounts.json fallback retained | COMPLETE | |
| D1 mismatch returns service-unavailable, no wrong-account data | COMPLETE | |
| 3 google_accounts.json 5 s TTL + mtime/size | COMPLETE | no production invalidation (Minor) |
| 2 / D2 cli-store -> account, same provider only, both paths | COMPLETE | |
| 5 / D3 ptah-cli-only Claude family scope | COMPLETE | |
| 4 broadcaster 10 s bound | COMPLETE | dead generation guard (Minor) |
| 6 null modelScope authoritative | COMPLETE | |
| Restored-card usage fold | COMPLETE | |
| A5 sourceless proxy observations | COMPLETE | |
| A6 PLAN_USAGE_MAX_OWNERS | COMPLETE | M2 failingSince |
| Rules: ctor order [7]-[10], decorated ctor params, no `.catch` in try, degradation-audit comments | COMPLETE | No constructor change in the diff; new catches carry `degradation-audit` comments (reader:136, 141, 183; resolver:172). `.finally` use in `untilAborted` (:334) is outside a try. |

Implicit requirements not addressed: expiry of observed state (S1); live reply capture remains unverified (schema stays provisional, as decided).

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Reply without email | YES | observation cleared, file/cli-store owner (resolver:190-194) | owner may differ from the target key, so one `unavailable` then recovers |
| 0 or 2+ language servers | YES | `unavailable()` | observation not cleared (S1) |
| Account switch while LS runs | YES | mismatch -> unavailable, then new owner | one missed poll only |
| Oversized / non-JSON reply | YES | `readJsonResponse` | none |
| Abort mid-read | YES | `untilAborted`, timers cleared | none |
| Cache above 64 owners | YES | LRU-by-readAt, in-flight kept | failingSince outside bound (M2) |
| Push never settles | YES | 10 s bound | late broadcast ordering |
| Sourceless proxy 429 | YES | dropped with debug log | none |
| Non-Claude lane with Claude-like model id | YES | full id kept | none |
| Same-provider cli-store upgrade when file account changes mid-run | YES | attributed to exit-time account | by design |

## Verdict

- Recommendation: APPROVE (with S1 fixed or explicitly accepted as a follow-up)
- Confidence: MEDIUM-HIGH (reply shape is third-party and never captured live; tests not re-run by this review)
- Top risk: the observed Antigravity account has no lifetime, so lane quota can be attributed to a previous account once the language server is gone.
- What a robust implementation would add: expiry/clear of the observed account; de-duplicated ports and extension port ahead of the attempt cap; per-candidate timeout; omit windows lacking `remainingFraction`; bound `failingSince`; remove dead generation guard and the `ownerRef` cast; strengthen the two weak spec assertions.


---

# Phase 2 review

Scope: commits 36701343b (5A), d1f7c4625 (5B), ff248a9ff (7), 81c2e674d (G), read in full via `git show`, plus the callers and helpers they touch. Not executed: no jest or browser run, so rendered contrast and the 280 px truncation are judged from the markup and CSS, not measured.

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Verdict | APPROVED with follow-ups (no Blocking) |
| Blocking | 0 |
| Serious | 1 |
| Moderate | 3 |
| Minor | 4 |

Why 7 and not 8-9: the four batches meet their stated requirements and contain no stubs or dead code. The Serious G item (events dropped during backoff, no catch-up) is a real staleness path that the batch introduced. Why not 5-6: all failure classification in G is conservative (a non-128 or non-"not a git repository" failure is never reported as a non-repo), and the refactor is behaviour-preserving.

## Findings

### Serious

**S1. Watcher events swallowed during the timeout backoff are never replayed.**
- Files: `libs/backend/vscode-core/src/services/git-info.service.ts:733-745`, caller `apps/ptah-electron/src/services/git-watcher.service.ts:1169-1189`.
- Scenario: a status read times out, so the 30 s backoff opens. A file changes during the window. `fetchAndPush` calls `drainCauses()` (line 1169), `refreshGitInfo` returns `statusUnavailable('timeout')` at once, and the watcher broadcasts that payload. The causes are consumed and no retry is armed.
- Impact: when the host recovers and the window expires, nothing re-triggers a refresh. The UI keeps the last good list, which is stale by the changes made during the window, until the next filesystem event. Each skipped push also broadcasts a fresh 'timeout' payload with the drained causes, so any consumer that uses causes for the truncated-content push loses them.
- Fix: arm one trailing refresh at `backoffUntil` (a single timer per root, cleared on dispose). Alternatively return a distinguishable "skipped" result so the watcher re-queues the causes and does not broadcast.

### Moderate

**M1. The backoff skip bypasses `invalidateReadCache`** (`git-info.service.ts:733-744`).
- The skip returns before `invalidateReadCache`. A branch or stash change made outside Ptah during the 30 s window leaves the branch, stash, tag and remote caches stale for up to the window. Invalidation is cheap and spawns nothing, so it should still run.
- Fix: invalidate before the early return.

**M2. `ownerStatusNote` now throws on an unknown status** (`lane-tiles.ts`, default branch, commit d1f7c4625).
- The `never` guard is right at compile time, and the text for every existing status is unchanged. The runtime `throw`, though, sits inside the view-model computation. If a newer backend sends a status string the webview does not know (cached or desynced clients), the whole stats view model fails instead of showing a generic note.
- Fix: keep the compile-time exhaustiveness and return the generic `Usage unavailable · <status>` text at runtime.

**M3. `aria-label` on a plain `<span>` is unreliable** (`session-stats-summary.component.ts`, LANES pill, `[attr.aria-label]="lanesAriaLabel()"`).
- The pill is a generic inline element with no role. Screen readers commonly ignore `aria-label` on generic elements (ARIA 1.2 prohibits naming them), so the stated goal (an accessible name) is probably not met.
- Fix: add `role="img"` or `role="group"`, or use visually hidden text. The count source (`lanesCount()`, same as the tooltip) and the plural handling are correct.

### Minor

- **m1.** Backoff entries are deleted only on a definitive answer. The recorded Minor holds: an expired entry for a root that never answers again stays in the map. It is one number per workspace root, roots are few, `refreshGitInfo` compares against the clock so an expired entry is inert, and it is bounded like `invalidatedAt`. It does not matter, but pruning the entry on the expiry check at line 735 is a one-line fix.
- **m2.** The backoff is also set when a numstat read (not only status) times out, because both sit in the same `try` (`git-info.service.ts:970-979`). That matches the "status/numstat" requirement. `readNumstat` still turns a non-zero exit into an empty Map silently (`:3607`), which is pre-existing. `operationReader` and `resolveRepositoryRoot` keep the 10 s default, so worst-case latency of one refresh is about 60 s plus those.
- **m3.** Duplication: the extracted breakdown component re-declares `formatCost`, `formatTokens`, `formatOptionalTokens` and `formatModelName`, and the parent keeps its own copies (parent ~803-831, still used for budget and lane text). Not dead code, but the copies can drift. Route to the style reviewer.
- **m4.** `plan-limit-tiles.ts` rebuilds the owner label from `owner.label` plus `ownerKeySuffix` instead of calling `ownerDisplayLabel`, so the "label · suffix" rule lives in two places. The tooltip order also changes from "Claude account · a1b2 plan limit" to "Claude account plan limit · a1b2"; intentional so the suffix stays visible, but a visible text change. No test pins the light-theme cost-badge ink (see 5B).

## Per-batch checks

**5A (36701343b): OK.**
- Meter: now outside the `showSummary()` block and gated on `percent() !== null`. It is shown when the percent is known and hidden when unknown. The "Used: unknown" row and the repeated used text stay summary-only. The lane-subgroup default (`showSummary` true) is unchanged.
- Caption: the lead span truncates only when closed. The tail is `shrink-0 whitespace-nowrap`, so the suffix stays visible at 280 px. The `min-w-0` on the flex parent and `gap-1` are present.
- Tiles: every tile constructor spreads the same `TileCaption`, so `caption`, `captionLead` and `captionTail` stay consistent. The unavailable tile has no tail, which is correct (no owner).
- Cooldown: it carries the `error-derived` source chip. This is a constant resting on the claim that every cooldown comes from an error or retry-after path; a stated assumption, not derived evidence.

**5B (d1f7c4625): OK with M2 and M3.**
- Contrast: `.ok-solid-text` is defined only for `anubis` (`styles.css:1949`, `#131317`). There is no `anubis-light` rule, so in light theme the class is inert and the badge falls back to daisyUI's stock `badge-success` content ink (6.01:1 per the author; the git badges already ship this pattern). It degrades safely. Specificity `[data-theme] .ok-solid-text` (0,2,0) beats `.badge-success`, so the dark override applies. `status-badge-contrast.spec.ts:196` pins the dark pairing only; the light 6.01 figure is asserted in a comment, not tested.
- Purple-400 and cyan-400 value text is replaced with `text-base-content` everywhere it appeared (including the model table cells).
- `ownerStatusNote`: covers `available`, `unsupported-auth`, `no-usage-source`, `stale`, the five failure statuses and a `never` default, which is exhaustive over all ten members of `ProviderAccountUsageStatus` (`rpc-providers.types.ts:166-176`).
- Subtotal caption: `truncate` plus a `title` tooltip, so it does not wrap.

**7 (ff248a9ff): OK.**
- The component has one input (`snapshot`) and one computed (`modelRows`). It injects `ModelStateService` for display names.
- The table markup, classes, test ids (`model-usage-table`, `-header`, `-row`, `-total`) and `aria-label="Per-model usage"` are identical to the removed template. Roles are preserved.
- Styles: the `.model-usage-row` grid moved to the child. The `@container` rules, `.context-bar-*` and both keyframes moved to `session-stats-summary.component.css` unchanged, and the `@container` rules still key off the parent's `container-type` on `.stats-grid`.
- The parent keeps both Models toggles and the expanded state. The `// prettier-ignore` plus compacted button markup is whitespace-only; the inline-flex gap keeps the label/value spacing. The removed `NgTemplateOutlet` import is no longer referenced.

**G (81c2e674d): OK with S1 and M1.**
- Budget: `GIT_STATUS_TIMEOUT_MS` is 30 s, applied to status and both numstat reads, and it is below `LONG_GIT_CALL_MS`.
- Probe removal and classification: a non-repository is classified only by `exitCode === 128 && /not a git repository/i` (`refusedAsNotARepository`). Every other non-zero exit (lock, other 128 such as dubious ownership) returns `statusUnavailable(...)` and is never reported as a non-repository. A timeout, spawn error or output-limit error throws into the `catch`, which also never reports a non-repository. `probeRepo` is retained for its other callers (`:3519`).
- Backoff set only on `reason === 'timeout'` (`:971-979`). It is cleared on success (`:953`) and on the not-a-repo answer (`:894`). Only `refreshGitInfo` checks it, so `getGitInfo` (user and RPC path) never skips; a user read that succeeds closes the window for the watcher. The clock is a module-level seam, which suits tsyringe.
- Concurrency: a skipped refresh does not enter `singleFlight`, so it creates no trailing run and spawns nothing. A late timeout from an older run can set the window after a newer success cleared it; the effect is at worst one extra 30 s skip, and S1 covers the more important gap.
- Not executed: I did not run `git-info.service.spec.ts`; the spec edits are in the commit.

## Five logic questions

1. **Silent failure:** a skipped refresh looks like a normal 'timeout' push and the drained causes vanish (S1). The cooldown chip is a constant.
2. **Unexpected user action:** editing files while the host is stalled and expecting the panel to catch up when it recovers. It does not until another change happens.
3. **Wrong answer from data:** a runtime status string outside the enum throws (M2) and blanks the view model. A localized git "not a git repository" message is the same dependency the old probe had, so no regression.
4. **Dependency failure:** a git stall is now ridden out for 30 s per read. A stall in the operation reader or repo-root resolution still hits the 10 s default.
5. **Missing, never mentioned:** a catch-up refresh after backoff expiry, a role for the LANES pill, and a test for the light-theme cost-badge ink.

## Verdict

Recommendation: APPROVE, with S1 filed as a follow-up before this behaviour is relied on under host stalls; M1 is a one-line fix to bundle with it, and M2 and M3 are cheap to fix in the same pass. Confidence: MEDIUM-HIGH (code read in full, nothing executed). Top risk: S1, where changes made during the 30 s backoff are not shown until the next unrelated filesystem event.

# Fix re-review

Scope: Phase 1 S1 + M3 (commit 683c1d3a8), Phase 2 git-info backoff fixes and chat-ui moderates (uncommitted diffs). Read-only; nothing executed by me.

## A. Phase 1 (683c1d3a8)

- **S1 observed account never expires: RESOLVED.** `provider-owner.resolver.ts` `antigravityOwnerRef` (~:360) now requires `now - observedAt <= ANTIGRAVITY_OBSERVED_ACCOUNT_MAX_AGE_MS` (5 min) before using the observation, else falls through to `google_accounts.json` / CLI store. The reader clears the observation on no unique server, all candidates failing and discovery throwing (`antigravity-plan-usage.reader.ts` ~:75, :147, :151). Clock seam reset in `resetAntigravityOwnerStateForTests`. Untested clears at :147/:151 are FU-616-P1-m6, not re-raised.
- **M3 missing `remainingFraction` rendered as 100 % used: RESOLVED.** Reader `flatMap` (~:112-120) omits configs without `quotaInfo` or with `remainingFraction === undefined`; an all-omitted reply yields no windows and stays unavailable. No new defect seen. Observation: expiry is a TTL, so a still-running healthy server whose polls stop for over 5 min falls back to the file/CLI-store account until the next successful poll re-observes; acceptable, and the intended degradation.

## B. Phase 2 git-info backoff (`git-info.service.ts`)

- **Serious, backoff swallows watcher changes: NOT RESOLVED (partially mitigated), new Serious defect.**
  Timer mechanics are correct: one timer per root in `backoffCatchUp` (:648), `scheduleBackoffCatchUp` clears the pending timer before re-arming (replaced, not stacked, :779-791), `unref`'d (:790), deleted on fire (:786), cleared on a definitive answer (`clearBackoffCatchUp` at the not-a-repo and success exits, ~:952, :1013) and on `dispose()`. Delay is `backoffUntil - now`; a few-ms early fire is bounded because the skip re-arms for the residual few ms.
  Loop bound: the catch-up is armed only by a skip; if the catch-up itself times out it re-arms a 30 s backoff but arms no new timer, so there is no perpetual loop. Bounded at one catch-up run per skip event; acceptable.
  **Defect:** the catch-up calls `void this.refreshGitInfo(...)` inside the service, and its result is discarded. The renderer is only told via `GitWatcherService.fetchAndPush`, which awaits `refreshGitInfo` and then broadcasts `GIT_STATUS_UPDATE` (`apps/ptah-electron/src/services/git-watcher.service.ts:1183-1190`). `GitInfoService` has no listener/emit mechanism (zero matches). So after the window closes the status is recomputed (and read caches stay valid), but nothing is pushed to the UI. The skipped change still shows only on the next filesystem event or a user-driven `getGitInfo`, which is the original symptom. The fix recovers the cache, not the user-visible behaviour the finding was about. 
  - NEW-1 (Serious): catch-up result is not delivered to the renderer. Fix: have the watcher own the catch-up (on a `statusUnavailable('timeout')` result, `fetchAndPush` re-schedules itself at the backoff expiry, so the existing broadcast path runs), or give `GitInfoService` an `onCatchUpRefresh` callback the watcher subscribes to and broadcasts from.
- **Moderate, skip bypasses `invalidateReadCache`: RESOLVED.** Skip branch calls `invalidateReadCache(workspacePath)` before returning (:757-760), matching the non-skipped path.
- **`dispose()` caller:** none in production. `GitInfoService` is a DI singleton with no shutdown call (the grep of `apps/ptah-electron/src/activation/shutdown.ts` shows no GitInfoService dispose; the watcher's `.dispose()` at :706 is a subscription). Timers are `unref`'d, so a missing caller cannot hold the host open and the map is bounded by roots; harmless leak, but effectively test-only API. Moderate-minor: either wire it into shutdown / the container's disposal, or drop it. A timer firing after teardown would only run a git status once.
- NEW-2 (Minor): the log line says "a catch-up is armed" on every skip including re-arms; cosmetic only.

## C. chat-ui

- **ownerStatusNote throws on unknown status (M2): RESOLVED.** `lane-tiles.ts` ~:441-452 keeps `const unhandled: never = snapshot.status` (compile-time exhaustiveness) and returns a neutral `Usage unavailable · <status>` at runtime. No throw path remains. Minor: an unknown status string is rendered raw to the user; acceptable for a desynced-client fallback.
- **LANES pill accessible name (M3): RESOLVED.** `session-stats-summary.component.ts` ~:175-180 adds `role="img"` with the existing `[attr.aria-label]`; no visual change. `role="img"` on a non-interactive summary is a correct way to give a generic span an accessible name; children become presentational, which is intended since the label carries the full text. No new defect.

## Verdict

NEEDS_REVISION for the Phase 2 Serious: Phase 1 S1/M3, the invalidate Moderate, and both chat-ui Moderates are RESOLVED; the catch-up timer lifecycle is correct and bounded, but its result never reaches the renderer (NEW-1, Serious), so the original "UI not updated after backoff" symptom persists. `dispose()` is production-dead but harmless (unref). Confidence: HIGH (code read, nothing executed).


# Fix re-review 2

Scope: uncommitted Batch G fix round 2 (`git diff -- libs/backend/vscode-core apps/ptah-electron`) plus the orchestrator's stress-harness correction. Read-only; nothing executed by me (orchestrator's check results taken as reported).

## NEW-1 (catch-up result never reaches the renderer): RESOLVED

- The service-side catch-up timer map and `dispose()` are gone. `GitInfoService.refreshGitInfo` (git-info.service.ts ~:737-745) skips via `statusBackoffRemainingMs(...) > 0`, still calls `invalidateReadCache`, and returns `statusUnavailable('timeout')`. `statusBackoffRemainingMs` (~:762-766) is a pure countdown (0 when absent or expired).
- The watcher owns the follow-up. `git-watcher.service.ts:1213-1228` (`fetchAndPush`): after `broadcastFn(GIT_STATUS_UPDATE, ...)` it reads `statusBackoffRemainingMs(workspaceRoot)`; when > 0 it re-adds the drained `causes` to `pendingCauses` and calls `scheduleBackoffFollowUp` (~:1244-1271). The timer callback calls `void this.fetchAndPush()`, the same method that broadcasts, so the follow-up result does reach the renderer. The spec "a refresh that lands in the backoff schedules one follow-up push" asserts the second `git:status-update` with the kept causes.

## Specific checks

- **Bounded cadence:** if every follow-up also times out, each real timeout opens a new 30 s window and the post-broadcast check schedules the next follow-up at `remaining + 1 s`. Cadence is at least status-timeout budget + 31 s, one pending timer per watcher (replaced, not stacked, ~:1255-1259), so it is a slow periodic retry while git stays stalled, not a tight or unbounded-rate loop. It stops when a read succeeds (remaining 0). Acceptable, and arguably the wanted retry behaviour.
- **Causes not duplicated:** `pendingCauses` is a Set (re-add is idempotent); `drainCauses` clears it per push (:1186); skipped pushes in one window each replace the timer, and the spec "several skipped refreshes ... exactly one follow-up" covers it. Causes accrued from real filesystem events in between merge in the Set.
- **No fire after stop/switch:** `stop()` clears and nulls the timer (~:571-574); the callback checks `isDisposed`, `armGeneration`, and `workspacePath`; the re-add happens only after the `workspacePath !== workspaceRoot` check (:1203), so a stale cause cannot leak across a switch. Timer is `unref`'d. Spec "stop() cancels a pending follow-up push" covers stop.
- **Harness correction:** `statusSpawns()` (harness :203-205) filters `args[0] === 'status'`; the pipeline's first spawn is `git status` now that the probe is gone, so one status spawn = one pipeline = one cycle per overflow; the assertion keeps its meaning (the previous comment about a failed probe ending the cycle before `status` no longer applies since there is no probe). Other consumers (`git-watcher.stress.perf.spec.ts:105,117`, `stress.spec.ts:135,147`, harness :531) all call `refreshCycles()` and so get the same semantics; grep finds no remaining `rev-parse` reliance in any harness or spec in apps/ptah-electron.

## New defects

- **Minor (NEW-3):** a normal successful push that lands after a pending follow-up was scheduled does not cancel the timer, so one redundant refresh plus broadcast fires at window end. Harmless (single-flight, one per window); optional: clear the timer when `backoffRemainingMs === 0`.
- **Minor (NEW-4):** git-watcher.service.ts now 709 lines against the 700 max-lines warning (reported by the orchestrator, not an error).

No Blocking, Serious or Moderate defect found.

## Verdict

APPROVED. NEW-1 resolved; follow-up lifecycle bounded and correctly guarded; harness correction semantically faithful. Confidence: HIGH (code read in full for the changed paths; tests not run by me).
