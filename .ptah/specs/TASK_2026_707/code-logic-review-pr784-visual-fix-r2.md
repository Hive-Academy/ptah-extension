# Code Logic Review — PR #784 visual fix, round 2 (independent re-review)

Review family: opencode reviewing codex+Glm

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Verdict | **APPROVE** |
| Prior defects verified fixed | 4/4 + comment hygiene |
| New blocking issues | 0 |
| New serious issues | 0 |
| New moderate issues | 0 |
| Minor observations (non-blocking) | 4 |
| New failure modes found | 0 |

Scope examined: the six changed files' uncommitted diff (`git diff` vs HEAD) plus each file read in full — `plan-tile-view.model.ts` (995 lines), `plan-tile-view.model.spec.ts` (1011), `provider-account-card.component.ts` (263), `provider-account-tile.component.html` (202), `provider-account-tile.component.ts` (167), `provider-account-tile.component.spec.ts` (486). The prior round-1 review (`code-logic-review-pr784-visual-fix.md`), both fix reports, and the diff hunk map were used to date every comment and code path (new vs pre-existing committed baseline). Per instruction I ran no test, typecheck, lint, build or render; the implementer's 63/63 Jest result on the two changed specs is accepted as reported, and each assertion cited below was verified by reading the test bodies.

## Prior defects — verification

### 1. Stale owner with a quota bar repeats one status — **FIXED** (semantic, by status kind)

- `plan-tile-view.model.ts:530-531` — `statusChip` now has `case 'stale': return null;`. The "Cached data" chip is removed for every stale owner by status kind, not by string equality or pill presence.
- `plan-tile-view.model.ts:571-580` — the specific notice "Showing cached account data; refresh failed at …" is retained in `statusNoticeText`, including `staleSince` time.
- Trace for a stale windowed owner: `bar` non-null → `pill = null` (`plan-tile-view.model.ts:950-952`), `chip = statusChip('stale') = null` (`:954-957`), `statusNotice` = the notice (`:958`). Exactly one stale message in the footer; the cooldown stays a separate, distinct line (`:988-991`).
- Trace for a stale windowless owner: the pill takes the notice text (`:678-684`) and `statusNotice` is deduplicated to null by `notice?.text === pill?.text` (`:958`) — one message again, now with warning tone via `pillTone` (`:687-700`).
- The requested DOM assertion for chip *and* notice exists: `provider-account-tile.component.spec.ts:474-485` asserts no `tile-status-chip`, exactly one `tile-status-notice` containing "refresh failed", and a distinct `tile-cooldown` containing "retry delay". Model-level: `plan-tile-view.model.spec.ts:953-967` (bar non-null, chip null, notice present, cooldown retained).

### 2. Meaningful qualifier line can be cut off — **FIXED**

- `provider-account-tile.component.html:26-30` — the qualifier line uses `block whitespace-normal break-words text-xs opacity-60` (wraps, no `truncate`) and carries its own full-text `[attr.title]="qualifier"`.
- `provider-account-tile.component.html:23-25` — the name line keeps `truncate` but has `[attr.title]="view().titleName"`; the outer label span keeps the full header tooltip (`:18-22`, `headerTitle()` at `provider-account-tile.component.ts:137-142`).
- DOM coverage: `provider-account-tile.component.spec.ts:398-420` asserts both header lines, both `title` attributes (`:416-417`), and that the qualifier class has `break-words` and not `truncate` (`:418-419`). Model coverage: `plan-tile-view.model.spec.ts:833-870`, including the two-qualifier Claude shape with the full label preserved for aria/tooltips (`:867-869`).

### 3. Unbounded chips/evidence can make the whole grid tall — **FIXED**

- Window chips: `plan-tile-view.model.ts:915-925` — `chips.splice(3)` then one `+N more` chip (key `__more-windows`) whose `title` joins each hidden window's label, value, reset and full facts tooltip (`:923`). The cap runs after the primary bar and the Claude hidden-generic-weekly exclusion, so neither consumes visible slots (`:895`).
- Evidence notices: `plan-tile-view.model.ts:960-968` — `evidence.splice(2)` then one `+N more` notice whose `title` joins the hidden notices' full titles (`:966`).
- Row height is now bounded (≤4 chip badges, ≤3 evidence lines, header ≤2 lines, one bar block, one secondary line, one status row, one cooldown) under `grid-auto-rows: 1fr` (`provider-account-card.component.ts:69`), so one large owner can no longer stretch every row.
- Tests: `plan-tile-view.model.spec.ts:992-1001` (labels `['Extra 0','Extra 1','Extra 2','+2 more']`, overflow title contains "Extra 3"/"Extra 4") and `:1003-1009` (evidence length 3, `+2 more`, title contains "Model 2"/"Model 3"); the existing active/expired/estimated evidence test now also checks the estimated fact inside the overflow title (`:826-828`).

### 4. Missing regression coverage for real quota providers and distinct notices — **FIXED**

- Codex weekly bar with its 5-hour chip, no duplicate status: `plan-tile-view.model.spec.ts:969-978` (bar "Weekly", chips `['5-hour']`, `statusChip` null, `statusNotice` null).
- OpenCode Go monthly + 5-hour + weekly, no duplicate status: `:980-990` (bar "Go monthly", chips `['5-hour','Weekly']`, both null).
- Stale windowed owner → one message: model `:953-967` and DOM `provider-account-tile.component.spec.ts:474-485`.
- Distinct failure/cooldown notices retained: `plan-tile-view.model.spec.ts:966` (cooldown "a retry delay, not a plan reset") and `provider-account-tile.component.spec.ts:484`.
- Caps covered at `:992-1009`; the DOM icon test was moved to a CLI-failure owner that still keeps a chip (`provider-account-tile.component.spec.ts:462-472`).

### 5. Comment hygiene (task/PR references) — **FIXED within the change**

The diff filter over all six files shows task/PR references only on removed (`-`) lines; no added (`+`) line contains any. Removed by this change: `TASK_2026_707, PR 1` (model header, now `plan-tile-view.model.ts:1-15`), `TASK_2026_707 selection rule` (before `:426-431`), the card header `TASK_2026_596 … TASK_2026_631 … TASK_2026_707` (now `provider-account-card.component.ts:1-22`), the `TASK_2026_707` grid comment (now `:54-58`), and the tile header `TASK_2026_707` (now `provider-account-tile.component.ts:25-33`). The "PR 784 visual review defect" comments named in round 1 are all gone from the current files.

Pre-existing, outside every diff hunk (committed baseline, not this change's regression): `(review defect 3)` at `plan-tile-view.model.ts:582`, `:676` and `plan-tile-view.model.spec.ts:543`, and `carry-forward from Batch 3` at `provider-account-card.component.ts:160`. Hunk map evidence: the model's hunks end at new lines 564 and resume at 886, the spec's at 16 and 823, the card's at 73 and 260 — those lines are unchanged context.

## Original criteria — re-check

| Criterion | Status | Evidence |
| --- | --- | --- |
| Uniform rows (`grid-auto-rows`) | MET | `provider-account-card.component.ts:68-71` — `repeat(auto-fit, minmax(16rem, 1fr))`, `grid-auto-rows: 1fr`, `align-items: stretch`. |
| One status message for API-key / missing-key / unavailable, actions kept | MET | Claude API key: `plan-tile-view.model.spec.ts:873-891` + DOM footer hidden `provider-account-tile.component.spec.ts:434-440`; Provider CLI `:893-909`; Ollama missing key with `Add key` `:911-933` + DOM `:442-460`; Antigravity unavailable `:935-951`. `Go to chat` emission `:268-288`; action wiring `provider-account-card.component.ts:225-231`, `plan-tile-view.model.ts:708-735`. |
| Subtle theme border | MET | `provider-account-tile.component.html:4` (`rounded-lg border border-base-content/10 p-2.5`); DOM assertion `provider-account-tile.component.spec.ts:389-396`. |
| Lucide icons aria-hidden, tree-shakable | MET | Direct imports `provider-account-tile.component.ts:16`, icon map `:121-126` satisfies `Record<PlanTileStatusChipIcon, unknown>`; `aria-hidden="true"` at `provider-account-tile.component.html:149`. |
| Test ids unchanged | MET | `provider-account-tile` at `provider-account-tile.component.html:7`; `tile-cooldown` at `:193`; both exercised by the DOM specs. |
| No `any` / `@ts-ignore` / `console.*` | MET | Mechanical grep over both component folders: no matches; confirmed by full reads of all six files (the only cast is the typed `'some-new-reason' as PlanLimitStatusReason` test device at `plan-tile-view.model.spec.ts:503`, pre-existing). |
| UTF-8 clean (no `â€` / `Â` mojibake) | MET | Grep for `â€` and `Â` across both folders: no matches; the typographic `’`, `—`, `·`, `↻` in the files are intentional UTF-8. |

## Five logic questions

1. **How does this fail silently?** The prior silent failure — a stale owner presenting a healthy-looking bar plus two cached-state messages — is closed at `plan-tile-view.model.ts:530-531` (chip) and `:958` (notice dedup against the pill). Remaining soft spot: the stale notice itself renders with `truncate` and a hover-only `title` (`provider-account-tile.component.html:154-162`), so at a 16rem column the trailing absolute timestamp can ellipsize for keyboard/touch users. This is the established pattern for secondary/cooldown/evidence lines and was not in scope of the named defects — minor observation 2.
2. **What user action produces unexpected behaviour?** A user scanning an owner with more than three secondary windows sees the first three in snapshot source order plus "+N more" (`plan-tile-view.model.ts:915-925`). The bar always shows the most constrained window (`selectPrimary`, `:432-464`), so a hidden chip can never exceed the bar's urgency; the narrow exception is an equal-percent tie, where the runner-up window's warning tone is only in the overflow title. Disclosed, reversible design decision (fix report 2, Decision 2) — minor observation 1.
3. **What input data produces a wrong answer?** `tileTitleLines` (`plan-tile-view.model.ts:137-147`) splits on flat `\(…\)` groups. Nested parentheses ("Foo (bar (baz))") would split oddly (name "Foo (bar", qualifier "(baz)"), and unbalanced "(" yields a single line with a full tooltip. No `ownerDisplayLabel` shape in the shared DTO or the specs produces nested or unbalanced parens (tested shapes: "Claude (owner unknown) (key unavailable) · 81da", `plan-tile-view.model.spec.ts:843`), so no real input is mis-rendered. Checked, not a defect.
4. **What happens when a dependency fails?** A failed refresh with held data is signalled exactly once per tile: stale notice (`plan-tile-view.model.ts:571-580`), no stale chip (`:530-531`), cooldown kept separate (`:988-991`), and the card-level "Refresh failed — showing last observed data (observed …)" notice remains section-level context (`provider-account-card.component.ts:196-205, 239-263`) rather than a per-tile duplicate. Failure time (`staleSince`) is preserved in the notice text.
5. **What is missing that the requirements never mentioned?** `statusNoticeTone` and `statusNoticeTitle` (`plan-tile-view.model.ts:983-985`) are computed but never read by the template (`provider-account-tile.component.html:154-162` uses a fixed class and the notice text as its own title). Pre-existing shape, style-domain — routed to code-style-reviewer as minor observation 3. Also, no rendered-width or row-height measurement exists for the wrap/cap changes (no run allowed here); that remains the visual reviewer's pass.

## New findings (all minor, none blocking)

1. **Minor — overflow hides an equal-percent secondary chip's tone.** `plan-tile-view.model.ts:915-925`. Source-order cap means an equal-percent tie window (e.g. a second 94% window) can sit behind "+N more" with its warning tone only in the tooltip. The bar still shows the maximum, and the overflow title keeps all facts. Reversible: rank visible slots by percent before capping, if ever desired.
2. **Minor — the single stale message can itself ellipsize.** `provider-account-tile.component.html:154-162`. The stale notice is `truncate` with a hover `title`; the qualifier line got wrap treatment but the status line did not. Consistent with the pre-existing notice pattern; full text is in the tooltip and, for windowless stale owners, in the pill (which wraps, `:87-99`).
3. **Minor — dead view fields.** `statusNoticeTone` / `statusNoticeTitle` at `plan-tile-view.model.ts:983-985` are unused by the template. Style-domain; pre-existing; for code-style-reviewer.
4. **Minor — pre-existing process references inside the six files.** `(review defect 3)` at `plan-tile-view.model.ts:582`, `:676`, `plan-tile-view.model.spec.ts:543` and `Batch 3` at `provider-account-card.component.ts:160` are committed baseline outside the diff. They carry no task/PR IDs, and sibling committed files show the same convention; if the project wants them gone, that is a separate cleanup commit.

## Data flow

1. Card → tiles: selection order, shared clock, refresh/action routing unchanged and correct (`provider-account-card.component.ts:174-190, 212-231`): **OK**.
2. `buildPlanTile` classification and primary selection (`plan-tile-view.model.ts:872-940`): **OK**; cap applied after primary/hidden exclusion.
3. Pill/chip/notice derivation (`:950-958`): **OK** — semantic stale suppression plus textual dedup against the pill; traced for windowed stale, windowless stale, API-key, missing-key, unavailable, and ledger-only owners.
4. Template render (`provider-account-tile.component.html`): **OK** — two-line header with wrap+tooltips, one bar/pill slot, capped chips and evidence with overflow titles, one status row, separate cooldown; icon map exhaustive over `PlanTileStatusChipIcon` (`provider-account-tile.component.ts:121-126` vs `plan-tile-view.model.ts:514-518`; the obsolete `cached`/`Clock` mapping is fully gone).
5. Grid sizing (`provider-account-card.component.ts:63-76`): **OK** — uniform `1fr` rows, now with bounded per-tile content.

## Decisions

1. **APPROVE despite no live render evidence.** Options: hold for a screenshot, or approve on code+DOM evidence. The four named defects each have model and DOM assertions citing exact strings/elements, and the CSS mechanisms (`break-words`, `1fr`, caps) are deterministic; the visual pass is a separate review lane. Reversible.
2. **Treat pre-existing "(review defect 3)" / "Batch 3" comments as out of scope.** Options: count as a failed hygiene item, or scope the criterion to the change. The diff adds no task/PR reference and removes the ones it touches; the flagged lines predate the change (hunk-map evidence above). Reversible — a follow-up commit can strip them.
3. **Accept source-order capping.** Options: require percent-ranked visible chips, or accept the documented source-order decision. `selectPrimary` guarantees the bar carries the maximum-constrained window, so hidden chips are never more urgent than the visible bar except in equal-percent ties. Reversible.

## Verdict

- **APPROVE** — score **8/10**.
- The score sits in the "sound" band: all four prior defects are fixed with semantic mechanisms and dual (model + DOM) regression coverage, the original criteria are re-verified, and no new blocking, serious or moderate defect exists. It does not reach 9–10 because rendered-width/row-height confirmation is still outstanding (nothing may be run here), and the four minor observations above remain in the code.
- Confidence: **HIGH** for the logic and coverage claims (every cited assertion was read); **MEDIUM** for pure-CSS visual outcomes (wrap width, final row height), which await the visual review.
