# Cross-side review, round 2 — `pause-switches-plan.md` (revision 1, commit 69f2e5fac)

Read-only decision review against source. No tests or builds run; nothing modified except this
file; the concurrent `tools/mcp-bench` reader was not touched. Every claim the revision added was
checked against code; the ten round-1 findings were re-checked against the revised plan
(`.ptah/specs/TASK_2026_620_a13e/pause-switches-plan.md`, 465 lines) and the binding decisions
(`context.md:178-190`).

**Verdict: REVISE** — for exactly one blocking item (N1: the binding `previewEnhancement` decision
is not implemented and is re-opened as an open question). All ten round-1 findings are CLOSED, the
new host/notification claims verify against source, PD's dead-key sweep is complete at file level
with minor line-enumeration gaps, the batch order is sound, and the test plan proves pause and
resume on a booted-paused host. Fold in N1 (plus the three minors at the implementer's discretion)
and the plan is approvable without another review round.

---

## Round-1 finding status

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | Skills boot scan has no resume path | **CLOSED** | Plan §3.4 "Boot scans resume without restart" (each trigger service keeps `bootScanOwed`; `maybeRearmBootScan()` from the config-change event **and lazily from `onActivity`/`onSessionStart`**); P2 (`skill-trigger.service.ts`: arming needs the master else owed; callback `'stalled'` + owed; lazy `onActivity`); §5 skill-synthesis row ("resume (event and lazy) re-arms once and queues the skipped sessions"). Consistent with source: single arm site `skill-trigger.service.ts:182-186` (no master gate — verified r1), `'stalled'` stops the scan and keeps the watermark (`memory-trigger.service.ts:940-944` — verified r1), and the activity handler is registered on every activity event (`skill-trigger.service.ts:152-154` — verified r1), so the lazy path fires on the next chat activity |
| 2 | M10 fix creates capture-dead boot | **CLOSED** | §3.2 drops the "mirror the CLI" change with the round-1 rationale, citing both halves correctly (CLI hole `cli-engine/src/lib/bootstrap/thoth-runtime.ts:246-268`; `indexing-control.service.ts:417-422` revives PreCompact only — both verified r1); M10 becomes follow-up F1, matching user decision 2 (`context.md:182-183` "the per-workspace toggle fix … are follow-ups, not B-P") |
| 3 | Memory boot-scan re-arm is event-only | **CLOSED** | §3.4 lazy re-arm from `onActivity`/`onSessionStart`; P1; §5 memory-curator row ("resume with no event (value flipped in a fake provider, then one onActivity) re-arms once"). Consistent with source: the only arm site is `start()` (`memory-trigger.service.ts:215-219` — verified r1) and `onActivity` runs on every activity event (`:275-303` — verified r1); no `fileSettings.watch` subscription exists in the Electron provider (grep: `fileSettings` only at `electron-workspace-provider.ts:47, 57, 96, 218`), so the lazy path is the correct cover for external-edit resumes |
| 4 | Embedder warmup missed | **CLOSED** | New row M15 (`wire-runtime.ts:505, 632-660` — verified r1); §3.9 gate (early return + log when `memory.enabled` false; lazy load on first embed cited at `embedder-worker-client.ts:99, 170, 194` — cited, not opened); §5 ptah-electron row ("warmup skipped when memory is paused"). Minor nit N3 |
| 5 | VS Code users cannot reach the switches | **CLOSED** | §0.2: verified this round — `expected-absent.ts:1-14` (header: "no better-sqlite3, no embedder worker"), `:38` `MemoryRpcHandlers`, `:43` `SkillsSynthesisRpcHandlers` pinned must-not-resolve (imports `:22-26`); `phase-2-libraries.ts:85-88` ("nothing under apps/ptah-extension-vscode calls registerPersistenceSqliteServices … the Thoth-free invariant is lint-enforced"). User decision 5 (`context.md:189`) settles Thoth placement; the plan states the consequence explicitly instead of silently |
| 6 | `setTriggers` payload stale-write risk | **CLOSED** | §3.7 fixes the payload to `{ triggers: {}, enabled }`. Verified against source: `MemorySetTriggersParamsSchema = { triggers: MemoryTriggersSchema.partial() }` (`memory-rpc.schema.ts:93-95`) so `{}` parses, and the handler writes only keys present in the flattened partial (`memory-rpc.handlers.ts:738-746` — verified r1) so no trigger key is written; §5 rpc-handlers row tests exactly this |
| 7 | Interval change inert after removing restart | **CLOSED** | §3.4 "Curator settings stay fresh; period changes apply live": tick reads via a supplier, and `updateSettings` now calls `SkillSynthesisService.restartCurator()` which passes the same `onPassComplete`/`onEvent` options as `start()` (today's start passes them at `skill-synthesis.service.ts:426-429`, today's RPC restart drops them at `skills-synthesis-rpc.handlers.ts:661-664` — both verified r1); P2 + P3; §5 tests ("`restartCurator()` keeps the callbacks", "updateSettings with curatorIntervalHours calls restartCurator") |
| 8 | Badge dependency direction unresolved | **CLOSED** | Verified this round: `thoth-shell.component.ts:22` imports `ThothStatusService`, `:25-26` import both tab components, `:203` `inject(ThothStatusService)` — both edges already exist, so §3.7's `pausedChange` output + `thothStatus.refresh()` adds no new lib dependency |
| 9 | Path errors / unverified citations | **CLOSED** | CLI path now correct (`libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts` — matches the actual file). Electron notification verified this round: `electron-workspace-provider.ts:41` (event field), `:62` (assigned), `:212-226` (`setConfiguration`: file key → `fileSettings.set` `:218` → `fireConfigChange` `:220-225`). M20/M21 independently re-verified: no `memory.triggers.*` entries in `file-settings-keys.ts` (grep returns only `skillSynthesis.triggers.*` at `:389, 398-399, 686, 691-692` and a comment mention at `:395`); `memory.curatorEnabled` appears only at `file-settings-keys.ts:248, 360 (comment), 564` |
| 10 | No provenance tags | **CLOSED** | `[U]/[R]/[L]` tags on the rule rows in §3.4-§3.8, the preserve list, and a dedicated "Lane-introduced constraints" section (plan `:8-16, :422-441`) |

## New-claims verification (per the review brief)

| Claim | Verdict | Evidence |
|---|---|---|
| Electron `onDidChangeConfiguration` fires for UI and tray writes but not external edits | **Verified** | `electron-workspace-provider.ts:212-226` — `setConfiguration` fires `fireConfigChange` for file keys in-process (UI RPC handlers and the tray both call this provider); no `fileSettings.watch` subscription anywhere in the file (grep: `fileSettings` at `:47, 57, 96, 218` only), so an external edit refreshes the cache but fires no event — the plan's §0.3 table is accurate |
| VS Code runs no memory/skills background work | **Verified** | `expected-absent.ts:38, 43` pin `MemoryRpcHandlers`/`SkillsSynthesisRpcHandlers` must-not-resolve (header `:1-14`); `phase-2-libraries.ts:85-88` lint-enforced Thoth-free invariant. (`wire-runtime.ts:193-199` `sqliteOk` and `mirrorUserLayer` citations not re-opened; consistent with round-1's S15 verification) |
| Both boot scans re-arm on settings change AND next chat activity | **Verified (design consistent)** | §3.4 + P1/P2; arm sites are single and start-only (`memory-trigger.service.ts:215-219`, `skill-trigger.service.ts:182-186`), activity handlers run per event in both services, `maybeRearmBootScan()` is guarded by owed + master + `bootScan` flag + not-armed, and rate-limit stalls do not set owed (today's behaviour, `memory-trigger.service.ts:952-971` — verified r1) |
| Memory switch writes `{triggers:{}, enabled}` without clobbering | **Verified** | `memory-rpc.schema.ts:93-95` (`.partial()`), `memory-rpc.handlers.ts:738-746` (writes only present keys); §5 test pins it |
| Curator interval restart keeps callbacks | **Verified (design)** | §3.4/P2/P3 `restartCurator()` re-passes the options that today's `start()` passes (`skill-synthesis.service.ts:426-429`) and that today's RPC restart drops (`:661-664`) |
| Always-on tray does not stop quitting when the last window closes unless `trayKeepalive` | **Verified** | Today: `handleWindowAllClosed` suppresses quit only when `hasLiveTray()` (`tray.service.ts:315-329`), wired at `main.ts:390-396`; today the tray exists only when `trayKeepalive === true` (`main.ts:330-342`, gate at `:335`), so net behaviour today = suppress iff keepalive ∧ live. §3.8's rule `keepAliveRequested() && hasLiveTray()` preserves exactly that net behaviour with an always-created tray and respects R10 (`tray.service.ts:321-323`: no live tray → quit); macOS unchanged (`:317-318`); `main.quit-path.spec.ts` pins the matrix |

## PD — dead-key deletion completeness

- `memory.curatorEnabled`: **complete** — repo grep shows only `file-settings-keys.ts:248` (declaration), `:360` (comment), `:564` (default); no spec hits.
- `memory.triggers.preCompact`: **complete at file level, partial at line level** — every file in PD's table was confirmed by grep (`file-settings-keys.ts:380, 669`; `memory-trigger-config.ts:19, 76, 126, 141` + `:175-180` r1; shared DTO `rpc-curator-diagnostics.types.ts:68`; `memory-rpc.schema.ts:45`; `memory-rpc.handlers.ts:596`; accordion `:55, 239`; the three e2e-harness files). **Missed:** `libs/frontend/core/src/lib/services/providers-settings-state.service.spec.ts:113, 145` (references `preCompact` — not in PD's list) and spec lines `memory-rpc.handlers.spec.ts:1042, 1111, 1129` (PD lists `:191, 765, 795, 1013, 1022`). Mitigated by PD's done-criterion ("nothing references the three keys") and the scoped test pass, but the missed **file** must be added.
- `skillSynthesis.triggers.sessionEnd`: **complete at file level, partial at line level** — verified `skill-trigger-config.ts:8, 44, 68, 78, 100-102` (PD cites `:8, 44, 68, 78, 97-102` — matches), shared `SkillTriggersDto.sessionEnd` `rpc-curator-diagnostics.types.ts:95`, `file-settings-keys.ts:389, 686`, `skills-synthesis-rpc.handlers.ts:803` (r1), frontend `skill-trigger-toggle.component.ts:9`, `skill-triggers-settings.component.ts:51-53, 135-136`, `skill-diagnostics-state.service.ts:66`. **Missed:** `skill-trigger.integration.spec.ts:59` (`'skillSynthesis.triggers.sessionEnd': true` — a file not in PD's list), plus `skill-trigger-config.spec.ts:36, 48, 126, 131, 139` (PD lists `:16` only) and `skill-synthesis-tab.component.spec.ts:87, 1043` / `skill-activity-feed.live-poll.integration.spec.ts:85` only loosely covered by "(+ their specs)". Correctly excluded: the `SessionEnd` registry symbols (`skill-trigger.service.ts:119` etc.) and the memory `memory.triggers.sessionEnd.enabled` sub-switch, which stays.

## Sub-batches and order

- PD correctly runs **alone first**: it overlaps files that P1/P2/P3/P4 later touch
  (`memory-rpc.handlers.ts`, `memory-rpc.schema.ts`, `skills-synthesis-rpc.handlers.ts`,
  `rpc-curator-diagnostics.types.ts`, the accordion, state service specs), so the sequencing is
  required and correctly stated.
- The parallel set **P1 / P2 / P3 / P5 is file-disjoint**: P1 = memory-curator service files
  (`memory-trigger.service.ts`, `memory-curator.service.ts`, retention, indexing-control) + a new
  pause spec; P2 = skill-synthesis service files; P3 = shared types + error codes + rpc-handlers;
  P5 = Electron (`tray.service.ts`, `main.ts`, `wire-runtime.ts`). PD's `memory-trigger.service.spec.ts:200`
  edit does not collide with P1's **new** `memory-trigger.pause.spec.ts`.
- **P4 after P3** is required (the `enabled` fields in `rpc-curator-diagnostics.types.ts`) and PD has
  already removed the dead DTO fields before P3 extends the same types — order PD → P1/P2/P3/P5 → P4
  is sound.

## Test plan — pause and resume on a booted-paused host

Present for both trajectories: memory ("boot with the master off arms nothing, and the first resume
arms") and skills ("booted paused → event → subscription, curator interval and backfill exist once;
the same via the lazy path with no event"), plus two-resume → one-arm, mid-tick drain rows left
`queued`, prefilter `unscored` survival, `restartCurator` callback retention, the tray quit matrix,
and a manual smoke that resumes by **editing `~/.ptah/settings.json` by hand and starting a chat
turn** — exactly the external-edit + lazy path. Gap: no row yet for the `previewEnhancement`
refusal (N1) — add it to the rpc-handlers and frontend rows when N1 is folded in.

## New findings

### N1. BLOCKING — the binding `previewEnhancement` decision is not implemented and is re-opened as a question

`context.md:187-188` records the binding orchestrator decision under decision 3: "`previewEnhancement`
(the call the Skills UI really uses; `enhanceNow` has no UI caller) is refused while paused too,
since it is the same model work." The revised plan does the opposite: §3.6 refuses only the four
RPCs and says "see Open question 1 for `previewEnhancement`", and Open question 1 (plan `:458-465`)
asks the user whether the preview should also be refused — re-litigating a settled decision the
review brief explicitly forbids re-opening.

Evidence the decision is implementable exactly as recorded:
- The call exists and is baseline-safe to refuse: `rpc.types.ts:2004` (`'skillSynthesis:previewEnhancement'`),
  already in `host-source-registry.baseline.ts:332` — refusing it while paused adds no RPC method.
- The Skills UI really uses it: `skill-clones-view.component.ts:751`
  (`await this.rpc.previewEnhancement(c.kind, c.slug)`), `skill-synthesis-rpc.service.ts:436-441`,
  drawer doc `enhance-preview-drawer.component.ts:6`; handler behaviour pinned by
  `skills-synthesis-rpc.handlers.spec.ts:3476-3573`.
- `enhanceNow` indeed has no UI caller (§2 row, consistent with r1 verification of `:834`).

Fix (no design choice left open): add `skillSynthesis:previewEnhancement` to §3.6's refused set
`[U]`; P3 refuses it with `RpcUserError(…, 'PAUSED')` when Skills is paused; P4 greys the
Enhance action in `skill-clones-view.component.ts` (around `:751`) with the same tooltip; §5 adds
the refusal + grey-out tests; delete Open question 1. Everything else in the plan can stand.

### N2. MINOR — PD's dead-key enumeration has gaps

Missed file: `libs/frontend/core/src/lib/services/providers-settings-state.service.spec.ts:113, 145`
(`preCompact`) and `skill-trigger.integration.spec.ts:59` (`'skillSynthesis.triggers.sessionEnd'`);
missed spec lines: `memory-rpc.handlers.spec.ts:1042, 1111, 1129`; `skill-trigger-config.spec.ts:36, 48,
126, 131, 139`; the accordion spec's fixture line; "(+ their specs)" should name
`skill-synthesis-tab.component.spec.ts:87, 1043` and `skill-activity-feed.live-poll.integration.spec.ts:85`.
The done-criterion ("nothing references the three keys") plus the scoped typecheck/test pass catches
all of these, so nothing ships broken — but the list should be corrected so PD's "done" check greps
the right surface. Also keep the plan's own instruction to verify
`persistence-sqlite/…/0032_skill_synthesis_queue.spec.ts:194` and the unknown-key tolerance spec.

### N3. MINOR — embedder warmup gate is `memory.enabled` only

§3.9: with Memory paused and Skills running, the warmup is skipped and the first skills
embedding/backfill tick pays a cold model load (lazy load on first embed,
`embedder-worker-client.ts:99, 170, 194` — cited, not opened this round). Functionally safe; arming
on `memory.enabled || skillSynthesis.enabled` would avoid the cold start. Perf-only; the plan
labels it `[L]` (#14), which is legitimate — record the trade-off either way.

### N4. MINOR — the tray's keep-alive log/tooltip copy becomes false with an always-created tray

`tray.service.ts:186-190` logs "Tray keep-alive active — closing all windows will leave Ptah
running; use the tray to quit" (and sets the tooltip) on every successful `create()`. With the tray
always created and `trayKeepalive` false (the default), closing the last window now **quits** —
so that copy lies to every default user. P5 lists only "header comment updated"; the log line and
tooltip must be updated (or conditioned on `keepAliveRequested()`) alongside it.

## Updated lane-introduced constraints

The plan now carries its own accurate list (`:422-441`, 16 items) — verified consistent with source
and with the round-1 list, with these deltas from this review:

1. Items 1-13 and 15-16 stand as written (masters reuse the two keys; memory master carried on
   `memory:getTriggers`/`setTriggers` with `{triggers:{}, enabled}`; Thoth-tab placement only;
   finish-don't-abort; `'stalled'` + `bootScanOwed` + lazy re-arm; `ensureStarted()`; prefilter
   `unscored` + `paused-mid-run`; no forced drain on resume; supplier-fed tick +
   `restartCurator()`; telemetry/DB maintenance stay on; `'PAUSED'` error code + tooltips;
   optimistic toggle + focus refresh + `pausedChange`; 8 screenshots dark+light; PD alone → P4 last).
2. Item 14 ("embedder warmup gated on `memory.enabled` only") stays `[L]` but carries the N3
   trade-off note.
3. One item must move **out** of lane territory into `[U]`: the refusal set is decision 3 **as
   extended by the binding orchestrator decision** (`context.md:187-188`), so
   `skillSynthesis:previewEnhancement` belongs in §3.6's refused set and in P3/P4/§5 — not in an
   open question (N1).
4. New `[L]` worth recording explicitly: the tray menu also rebuilds on open
   (`tray.on('click')`/`'right-click'`, Assumption per platform — keep the assumption label), and
   the keep-alive log/tooltip copy change (N4).

## Verdict

**REVISE** — one blocking item: fold the binding `previewEnhancement` refusal + grey-out into
§3.6/P3/P4/§5 and delete Open question 1 (N1). The three minor items (N2 PD enumeration, N3 warmup
gate trade-off, N4 tray copy) can be fixed in the same pass. No re-review round is needed if N1 is
applied as specified above; all ten round-1 findings are closed and every other new claim verified
against source.
