# Final cross-side review, round 3 — `pause-switches-plan.md` (TASK_2026_620_a13e)

Read-only decision review against source (plan read in full, 505 lines; production code
unchanged since round 2, so round-2 code verifications remain valid). Fresh greps were re-run for
all three dead keys across `apps/` + `libs/` to confirm the rebuilt PD list. No tests or builds
run; nothing modified except this file; the concurrent `tools/mcp-bench` writers were not touched.

**Verdict: APPROVED.** All four round-2 items are CLOSED with verified evidence, the PD dead-key
list is complete (my independent greps found no file or line the plan misses), and nothing in the
revision contradicts the binding user decisions (`context.md:178-190`). Two cosmetic notes below
carry no severity.

---

## Round-2 item status

| # | Item | Status | Evidence |
|---|---|---|---|
| N1 | `previewEnhancement` refused + greyed while paused | **CLOSED** | Binding decision now restated in the plan's decisions section (plan `:25-28`, citing `context.md:187-188`); S12 row includes `previewEnhancement` (`skills-synthesis-rpc.handlers.ts:1150`; UI caller `skill-clones-view.component.ts:751` — verified r2); §3.6 refuses all five RPCs with `RpcUserError(…, 'PAUSED')` and greys the four UI buttons incl. Enhance; P3 refuses `runCurator`/`analyzeNow`/`enhanceNow`/`previewEnhancement` (`:732, :834, :1100, :1150`); P4 disables Enhance in `clones/skill-clones-view.component.ts` and renders a `PAUSED` error as a paused notice; §5 rpc-handlers row ("the five manual RPCs … throw `PAUSED`") and frontend row ("Run now, Run curator, Analyze now and Enhance (`previewEnhancement`) are disabled") test it. Code citation verified: `registerPreviewEnhancement` registers `'skillSynthesis:previewEnhancement'` at exactly `skills-synthesis-rpc.handlers.ts:1146-1155` (`:1150`). Open question deleted — §"Open questions" now reads "None" (plan `:503-505`) |
| N2 | PD dead-key enumeration gaps | **CLOSED** | §3.5 rebuilt from three stated greps with stated exclusions, and the plan's PD done-check is "re-run greps (a)-(c)" (plan `:217-229`). My independent re-run confirms completeness — see "PD completeness" below |
| N3 | Embedder warmup gated on memory only | **CLOSED** | §3.9: skipped only when **both** switches are paused; skills-use-the-embedder evidence verified — `skill-synthesis.service.ts:280` (`private readonly embedder: IEmbedder \| null = null`, `@inject` at `:279`), `:692-693` (`if (embeddingProvider === undefined && this.embedder) embeddingProvider = this.embedder`), `:962` (`if (!this.embedder \|\| !this.vecStatus.available) return 0` — the backfill embedding path); §3.1 and M15 updated consistently ("M15 warmup only when Skills is also paused"; "serves memory **and** skills … skipped when both switches are paused"); §5 ptah-electron row tests "warmup runs when either switch is on and is skipped only when both are paused" |
| N4 | Tray keep-alive log/tooltip copy false with always-on tray | **CLOSED** | P5 now replaces the `create()` log at `tray.service.ts:186-190` (verified r2) with mode-dependent copy computed from `trayKeepalive` at create time, adds the pause state to the tooltip (`TRAY_TOOLTIP` `:78`), and updates the file header; §5 ptah-electron row pins "the create log and tooltip match the keep-alive mode and pause state" |

## PD completeness (independent grep re-run vs the plan's 3.5 table)

- `memory.curatorEnabled`: repo grep returns exactly `file-settings-keys.ts:248, 360 (comment), 564` plus the docs row `apps/ptah-docs/src/content/docs/memory/settings.md:17` — **both** in the plan's table. The docs line itself ("Legacy registered key; no current runtime consumer") corroborates the dead-key claim.
- `memory.triggers.preCompact` (key + DTO field): my grep (`preCompact` minus hook symbols) returns exactly the files the plan lists — file-settings-keys `:380, :669` + spec `:332, :345`; memory-trigger-config `:19, 76, 126, 141, 175-180, 263` + spec `:16, 42, 66, 125, 130, 153`; coalesce/integration/service specs `:106/:59/:200`; `diagnostics.types.ts:53` + `diagnostics.service.spec.ts:149`; schema `:45`; handlers `:596` + handlers spec `:191, 765, 795, 1013, 1022, 1042, 1111, 1129` (the three lines missing in round 2 are now listed); shared DTO `rpc-curator-diagnostics.types.ts:68`; accordion `:55, 239` + accordion spec `:50, 87, 296-300, 435, 465, 503, 554`; state/rpc service specs (all lines match); `providers-settings-state.service.spec.ts:113, 145` (round-2 miss, now listed); the three webview-e2e-harness files `:180/:215/:257`; docs `memory/settings.md:51`. The only extra hits are the plan's stated exclusions, verified as noise: the PreCompact hook/compaction symbols (`compaction-boundary-generation-registry.ts:338`, `no-activity-watchdog.spec.ts:255-373`).
- `skillSynthesis.triggers.sessionEnd` (key + `SkillTriggersDto.sessionEnd`): my greps over skill-synthesis, skill-synthesis-ui, rpc-handlers and webview-e2e-harness match the plan's list — `skill-trigger-config.ts:8, 44, 68, 78, 97-102, 146` (+ spec `:16, 36, 48, 126, 131, 139` — round-2 miss, now listed); `skill-trigger.integration.spec.ts:59` (round-2 miss, now listed); `diagnostics.service.spec.ts:26, 143, 158, 165`; file-settings-keys `:389, 686` + spec `:339, 349`; schema `:277`; handlers `:803` (verified r1) + handler specs incl. `activity-feed.integration.spec.ts:374-377, 483, 493`; shared DTO `:95` (with the correct note that `:86` is memory's `sessionEnd.enabled` and stays); frontend toggle `:9` + spec `:10`, triggers-settings `:51, 53, 135, 136` + spec `:21, 94, 114, 117, 118, 280` + parity spec `:28, 56, 57, 60, 115, 129, 269`; live-poll spec `:85`; tab component spec `:87, 1043`; `skill-diagnostics-state.service.ts:66` + specs; `thoth-feed-visual.e2e.spec.ts:197, 368` — **verified exactly** (`triggers: { sessionEnd: true, … }` at `:197` and `:368`); docs `skill-synthesis/settings.md:53`. Correctly untouched: `persistence-sqlite/…/0032_…spec.ts:194`, the `SessionEnd` registry symbols (`skill-synthesis.service.ts:227, 268, 412-423`, `skill-trigger.service.ts:119`, the chat-session specs in rpc-handlers), and memory's `memory.triggers.sessionEnd.enabled` (`rpc-curator-diagnostics.types.ts:86`).

No file or line my greps found is missing from the plan's 3.5 table, and every exclusion the plan
states matches actual hook/registry noise. PD's done-check (re-run greps a-c, remaining hits may
only be the do-not-touch list) is executable as written.

## Binding user decisions — no contradictions

1. Read side stays on while paused; pause stops capture/curation/retention/lifecycle/synthesis/judging/promotion/warmup-backfill — §3.3 unchanged (M16-M18, S15 stay on); the warmup now stops when **both** switches are paused (§3.9), which honours the decision under the two-switch model: each switch still pauses its own pipeline's embedding work (drain stage, backfill via the deferred start), and the shared warmup stops exactly when both pipelines are paused. Consistent.
2. Delete the three dead keys; per-workspace toggle and host-local keys are follow-ups — §3.5/PD + F1/F2 (§"Follow-ups"). Docs rows added to PD implement the deletion correctly. Consistent.
3. Manual runs refused + greyed, including `previewEnhancement` (orchestrator extension) — implemented (N1 above). Consistent.
4. Tray always shown, two items, refreshed on change, Quit keeps working — §3.8 unchanged from r2 (verified then: quit matrix sound via `tray.service.ts:315-329`, `main.ts:330-342, 390-396`), plus the N4 copy fix. Consistent.
5. Switches visible on the Thoth Memory/Skills settings; stop ALL; pause/resume without issues — §3.7 unchanged; §5 proves pause and resume on a booted-paused host for both trajectories (r2 verification stands).

## New findings

None blocking or serious. Two cosmetic notes (no severity, fix in passing or ignore):

1. The "Lane-introduced constraints" list is numbered out of order (plan `:474-477`: items run 14, **17**, 15, 16 — the tray-copy item 17 was inserted between 14 and 15). No semantic effect; the disposition tables and all sections are otherwise consistent.
2. Three micro-citations were not opened in this review and stand on the plan's word only: `TRAY_TOOLTIP = 'Ptah'` at `tray.service.ts:78` (its usage at `:186` was verified in r2), `judge-panel.service.ts:249, 452-464` and `trigger-eval.service.ts:354, 392-418` (supporting evidence for the warmup OR-gate; the load-bearing citations `skill-synthesis.service.ts:279-280, 692-693, 962` are verified), and `enhanceNow` at `skills-synthesis-rpc.handlers.ts:1100` (consistent with `previewEnhancement` registering later at `:1150`, verified). None is load-bearing for a decision.

## Verdict

**APPROVED** — the plan is implementable as written: PD → P1/P2/P3/P5 (parallel, file-disjoint) → P4
(after P3's shared types), executors sensible, test plan proves pause and resume (event and lazy
paths, booted-paused hosts, external-edit smoke), all provenance-tagged, and every binding user
decision is implemented. No further review rounds are required from this side.
