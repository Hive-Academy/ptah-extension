Verdict: REVISE

## Earlier findings

| # | Status | Evidence |
|---|---|---|
| 1 | Resolved | Spec lines 14, 94–96 require an unselected, disabled no-folder state and an explicit All workspaces choice. Prototype `#nows-ws`, `#nows-gl`, and `#nows-btn` (lines 152–159) demonstrate it. The error below is explicitly labelled as a separate attempted-workspace-install example (lines 160–161). |
| 2 | Resolved for the cited local-file copy | Spec lines 125–130 and prototype `#mig-h`/notice bullets (lines 210–219) distinguish retired sharing from retained workspace files and say those files may still be available there. Installed examples use hypothetical `acme-*` names (prototype lines 141, 164–168, 174, 200). A separate skipped-source count gap is in New finding 1. |
| 3 | Resolved | Spec lines 18, 42 and prototype RemoteTrigger row (line 88) remove the `/schedule` dependency; the row says “None.” Final dependencies remain assigned to the architect's measured map (spec lines 17, 68). |
| 4 | Resolved | Spec lines 20, 64, 68 require independent tool/skill states and a blocked-dependency explanation. Prototype `workflow-authoring skill` remains checked with Workflow off and explains the block (line 100). |
| 5 | Resolved at design level | Spec lines 81–87 use native fieldset/legend and no nested `radiogroup`; prototype scope fieldsets (lines 142–149, 153–157, 175–181) do the same and have a visible focus rule (line 55). Actual DaisyUI keyboard/focus behavior remains an implementation check explicitly identified in spec line 86. |
| 6 | Resolved | Spec line 61 uses the existing `Saved {label}.` success copy and defines Undo as restoring and saving the prior value; prototype saved card (lines 128–130) matches. |
| 7 | Partly resolved | Spec lines 16, 101–106 restore seven global defaults and preserve compatible choices. Prototype lines 185–197 show four workspace targets and seven global targets, but its scope-switch script loses individual home-target choices; see New finding 2. |
| 8 | Resolved at prototype level | Spec lines 59–65, 70 describe distinct states and stable checkbox names. Prototype state gallery (lines 113–133) displays disabled loading controls, skeletons, errors, saved toast, and empty state as labelled examples; `docx skill` is stable (lines 111, 125). Real DaisyUI and axe remain untested, as the spec acknowledges (lines 158–160). |
| 9 | Resolved in wording | Spec line 35 and prototype line 79 say “Currently hidden” and “per new session (estimate).” The prototype amount and interaction still conflict with that rule; see New finding 3. |

## New findings

1. **Serious — migration counts omit retained global sources; spec lines 125–132, prototype lines 213–219.** Phase D migration AC3–AC4 and AC6 require the notice to count skipped items left on disk, including an unproven skills.sh root and an unproven home-config MCP entry. The revised `{kept}` bullet and path details count only files kept *in a workspace* because of edits or git. Thus a run that retires global records but leaves an unproven root or home entry has no truthful count or explanation for those leftovers. Add a separate “left on disk” count/category for retained global roots and home entries (with their inactive/possibly still configured status), or expand the kept count and copy to cover every skipped location without implying it is a workspace file. Keep the counts deduplicated per item as required by AC6.

2. **Moderate — MCP prototype loses individual target choices; prototype `sync()` lines 229–236, spec line 106.** After explicitly choosing All workspaces, unchecking Copilot, switching to This workspace and back, the prototype rechecks Copilot. Browser evaluation returned home choices `[false, true, true]` before the switch and `[true, true, true]` after it. `homeMemo` stores one boolean for all three targets. Store each target's choice separately, or make the prototype state reset explicit if the product decision is to reset all home targets on re-entering global scope; the latter would require revising spec line 106.

3. **Moderate — savings example conflicts with its own rule; spec line 35, prototype lines 79, 86–112, 226–240.** The displayed “2,900 tokens” equals the four off tool costs alone. The unchecked skill rows add about 830 tokens, so the stated sum of *items currently off*, rounded to 100, is about 3,700 tokens in the shown state. The line also does not update when a checkbox changes. Correct the example and update the total in the prototype interaction, or label the amount as a fixed illustrative snapshot and align the arithmetic with that snapshot.

4. **Minor — MCP conversion example promises a picker it does not show; spec line 116, prototype lines 199–201.** The note says home-folder targets are added “if you pick them,” while the prototype offers only Make global and no target picker for that action. Show the reused target fieldset in a conversion state or adjust the example so the conditional copy has a visible choice.

## Lane-introduced constraints

- Decisions #13–#16 are settled: global built-in toggles (spec lines 12, 34), conversion only to global (lines 19, 110–116), seven preselected global MCP targets (lines 16, 101–106), and a notice shown for retired-only migrations and persisted until seen (lines 15, 122, 132; prototype line 224). No further product decision is requested on these points.
- The revised notice satisfies the earlier local-file distinction but must also represent skipped global roots and home entries (New finding 1). This is a requirements contradiction, not a new placement preference.
- No new visual pattern was introduced in the revised surfaces: the spec points to the existing card, matrix, storefront, feedback, and badge classes; the prototype's labelled state gallery is documentation. I rendered the in-workspace HTML in dark and light themes at 1100×900 and checked the revised layout against those spec elements. The browser render does not validate real DaisyUI behavior, axe, or narrow widths; no build or tests were run. Skill discovery found no local invocable UI review skill, so no skill instructions could be loaded.
