# Gate 1.7 independent design review — TASK_2026_701_9e4b

## Round 1 re-review

Verdict: REVISE

Eight original findings are fixed; four are partially fixed. Four Serious issues and one Moderate issue remain, including the new D7 contradiction below. No Blocking issue remains. This round supersedes the initial assessment retained below.

Scope: checked findings 1–12 against the revised specification, prototype source, approved task-description.md, parity-inventory.md and settled decision D7. D7/A3 is accepted: the wizard cannot predict generated content, every existing readable source file defaults to Keep, wizard diffs are unavailable, kept agents are not regenerated, and unreadable files are forced Keep. Pack/plugin comparisons retain their different semantics. No new design direction is requested.

Evidence: inspected both dark and light screenshots for wizard-preview, library, focus, marketplace, and the 400px sidebar, packs, completion and marketplace captures. Names below are relative to `prototype/screenshots/`; `{dark,light}` means both files. Reviewed the related HTML, shared CSS/JS and README. This was source and screenshot review, not live browser execution. No build, test, lint, serve or git mutation was performed. Only this review file was edited.

### Per-finding status

| Original finding | Status | Evidence and remaining issue |
| --- | --- | --- |
| 1 — Marketplace installed-view parity | Partially fixed; Serious remains | Spec 3.10 and marketplace.html A/B restore the header, ordered groups, Acme placement, source/provenance information and pending/error states; marketplace-{dark,light}.png. The interactive inspector displays another item's details and search narrows the preserved matching behavior: R1-1. |
| 2 — Consent/report parity | Fixed | Spec 3.3; marketplace.html C–E and marketplace-{dark,light}.png show script paths, command/environment-name disclosure, non-execution text, skipped files, named shadowed skills, disabled busy controls and separate failure/report states. Local files are inserted after shadowing and before the error without moving existing blocks. |
| 3 — Wizard surroundings and informational targets | Partially fixed; Moderate remains | Spec 3.1; sidebar.html A restores source status, model picker and selection controls; wizard-preview.html A and sidebar.html A show genuine definite/conditional rival targets; packs.html A/C show both pack surfaces and result states. wizard-preview-{dark,light}.png and sidebar-400-{dark,light}.png expose contradictory warning conditions: R1-5. Pack interaction gaps are tracked under finding 4. |
| 4 — Target selection and reachability | Partially fixed; Serious remains | Spec 3.2/3.5; sidebar Change now reveals target buttons, shared JS shows loading/reset, and packs.html B/D supplies no-conflict target choice plus both host notices; packs-400-{dark,light}.png. Individual pack Install and sidebar pack controls do not reach that choice: R1-2. |
| 5 — Focus and modal keyboard parity | Fixed | Spec 3.1/6.2; focus.html, focus-{dark,light}.png and proto.css replace the invisible inner ring with an unclipped outer ring. Recorded adjacent contrast is 14.01:1 dark / 14.41:1 light. proto.js implements opener focus, Tab wrapping, Escape and restoration; its focus query excludes hidden, disabled and negative-tabindex controls. Targets are buttons. This is source-level verification, not a runtime keyboard test. |
| 6 — Unreadable forced Keep | Fixed | Spec 3.1; wizard-preview.html A, sidebar.html A, packs.html A and marketplace.html C/F provide locked unreadable rows. proto.js rejects aria-disabled Replace and skips locked groups during bulk replacement. Corresponding dark/light captures show disabled Replace with explanatory text. |
| 7 — Shared fixture/provenance edges | Fixed for the specified static states | Spec 3.6; library.html A/A2/B and library-{dark,light}.png cover community/command content, shadowing, architect as Workspace file, plugin-update divergence, turned-off Old Helper versus orphaned Former Helper, and retained/legacy/pack origins. These agree with the matching Marketplace examples. The live inspector's different-item mismatch is retained under R1-1, not counted twice. |
| 8 — Completion outcomes and grade copy | Fixed | Spec 3.9; completion.html A/C gives seven named outcomes matching 3 written + 2 kept + 1 current + 1 changed-since-preview + 0 failed. Only backend-developer is named newly diverged. Both surfaces include all three grade statements; B/D show all-kept/current and failure variants. completion-400-{dark,light}.png. |
| 9 — Installer-family guard/primary failures | Partially fixed; Serious remains | Spec 3.4; marketplace.html B/D/F/G adds family cases, owned edits, unreadable Keep and distinct primary failures without the generic no-files-changed promise; marketplace-{dark,light}.png. The plugin-agent result opens a repair prompt that omits its agent: R1-3. |
| 10 — Context and host copy | Fixed | Spec section 5 and wizard-preview.html C define Electron/VS Code model-origin and root/target strings. proto.js uses per-context data-tpl-keep/data-tpl-rep instead of replacing every action with a generic label. Pack/completion opened-folder notices agree; D3's Library exclusion is retained. Warning visibility is separately covered by R1-5. |
| 11 — Responsive/token evidence | Fixed | Spec 4, 6.2 and 6.5 resolve the diff mixes, segmented radius deviation, measured contrast and wrapping rules. packs-400-, sidebar-400-, completion-400- and marketplace-400-{dark,light}.png provide actual narrow-layout evidence, including long content. |
| 12 — Rule provenance/parity mapping | Fixed | Spec rule tags, Decisions, section 9 and prototype/README.md distinguish project rules from lane proposals and cross-reference the inventory. README's Lane-introduced constraints contains only lane-proposed rules. No blanket component ban is introduced. |

### Outstanding findings and exact changes

**R1-1 — Serious; original finding 1, partially fixed: Marketplace detail and search semantics still lose parity.** Location: `prototype/marketplace.html:22–67`, `prototype/assets/proto.js:195–234`, parity-inventory.md Installed view rows for search and detail. All row links reach one Acme inspector. The click handler changes only `inspector-h`; selecting tailwind-v4 or Old Helper therefore leaves “Marketplace plugin”, “External marketplace”, version 2.1.0, Acme provenance, Acme contents and the Acme kept-file explanation underneath the new title. This contradicts the shared fixture and the preserved detail identity. Search matches only a contiguous substring of `data-name`; it does not match every query word across name, description and source as the inventory requires (for example `acme/skills` fails to find tailwind-v4).

Exact change: populate all inspector facts, names, kept/health notes and family-appropriate action from the selected fixture item; keep the selected row and inspector identity consistent. Restore word-wise search across the preserved fields. Demonstrate at least a community-skill and bundled-plugin detail plus a source search; preserve the existing Acme example. This is residual parity work, not a request for a redesigned inspector.

**R1-2 — Serious; original finding 4, partially fixed: pack target choice is still unreachable from required entry actions.** Location: `prototype/packs.html:14–24`, `:54`, `:83–90`; `prototype/assets/proto.js:94–143,165–168`; spec 3.2. The wizard's individual Install/Retry buttons and the sidebar pack Change/Install All/Retry buttons have no opener or other handler. The only working pack entry route is the wizard Install All/Choose location route. The text claiming “Per-file Install opens it for that one file” is therefore unsupported. Collapse lacks aria-controls and changes no panel. The no-conflict prompt is an isolated specimen, not a reachable install branch. Target changes reset choices and the displayed destination, but all HTML lacks the data-for-target fixtures supported by JS, so no changed target-dependent comparison is demonstrated.

Exact change: wire both pack entry surfaces and individual-file/retry actions to the shared prompt with the correct file scope; wire expand/collapse to its file list. Make the no-conflict state reachable through a fixture/target branch. Supply distinct root/subfolder comparison fixtures (including a changed existing/new state), reset choices to Keep on the new comparison, and retain the host notices already supplied. No backend execution is required.

**R1-3 — Serious; original finding 9, partially fixed: the plugin-agent repair route cannot select its kept agent.** Location: `prototype/marketplace.html:168–186`, spec 3.4 and requirement 8.5b/8.5f. The plugin-agent result names `.claude/agents/release-manager.md` and opens `ov-repair`. That dialog contains only tailwind-v4/SKILL.md, release-notes/SKILL.md and the unreadable release.md command. It never offers the agent; all three result openers show the same unrelated aggregate. The explicit replacement route promised for plugin-agent mirroring is still missing despite its result and family-map rows.

Exact change: bind the shared repair prompt to the originating kept-file set, including release-manager.md for the plugin-agent result, with the correct source label, default Keep, comparison and confirm count. Preserve forced Keep for unreadable files. Demonstrate each family entering a prompt that includes its reported files; sharing the component is appropriate, sharing unrelated fixture contents is not.

**R1-4 — Serious; new contradiction with settled D7: the sidebar initially authorizes replacement.** Location: `prototype/sidebar.html:50–52`, `prototype/assets/proto.js:152–157`; sidebar-400-{dark,light}.png. backend-developer is authored with Keep aria-checked=false and Replace aria-checked=true. The initial page and the Generate opener both retain this value; the opener only shows the dialog and focuses its first control. The first confirmation therefore says “replace 1 file” before the user has chosen Replace. This is the main preview, not a labelled separate post-interaction specimen.

Exact change: initialize every existing readable row in the actionable sidebar preview to Keep, as D7 and spec 3.1 require. If a selected-Replace demonstration is useful, keep it as a clearly labelled interaction state reached by selecting Replace. Capture the initial Keep state in both themes. Preserve the settled “Exists — may be replaced” wording and unavailable wizard diff.

**R1-5 — Moderate; residual original finding 3: warning examples contradict their displayed targets.** Location: `prototype/wizard-preview.html` A, `prototype/sidebar.html:46–55`, spec 3.1; wizard-preview-{dark,light}.png and sidebar-400-{dark,light}.png. The wizard displays “Other CLIs sync agents from a different folder...” while Project root is selected, although spec 3.1 and requirement 2.4 reserve that subfolder warning for the explicit alternative. The sidebar says “Harness sync is not available on this host. Rival-CLI copies are not listed” immediately above listed rival copies.

Exact change: condition the subfolder warning on the opened-folder target; show unavailable-sync and failed-detection examples as separately consistent states. Hide rival rows in the unavailable-sync example and retain a populated available-sync example for the informational-target parity evidence.

### Regression and decision check

D7's content-timing decision is not reopened; R1-4 asks only that its accepted safe default be implemented in the prototype. Forced Keep is now correctly enforced. Electron-only Library scope remains intact. New/refined interactions must preserve the inventory's search/detail semantics and the pack entry routes as specified above. No other new Blocking/Serious parity drop or requirement contradiction was identified within this bounded re-review.

## Verdict

REVISE

Current verdict: Round 1 remains REVISE because R1-1 through R1-4 are Serious. The material below is the initial review record; its original line numbers, counts and assessments are historical and are superseded by the Round 1 table above.

## Initial review record

The specification describes most requested behavior, but the prototype does not yet form a complete, consistent implementation contract. There are Blocking parity gaps and Serious accessibility and requirement gaps. Electron remains the priority host; D3 does not authorize a VS Code Library surface.

Reviewed the supplied specification, requirements, parity inventory, decisions, all five HTML pages, shared CSS/JS, README, and all eight dark/light screenshots. Spot-checked five real components, listed below. This was a static source and screenshot review: no build, test, lint, serve, application execution, or git mutation. Keyboard behavior was inspected in the event handlers, not exercised in a live browser.

References without a repository prefix are relative to this task folder. “Spec” below means design-spec.md. A promise that an existing feature is unchanged is useful, but does not resolve a contradictory or missing prototype treatment at Gate 1.7.

## Findings

1. **Blocking — Marketplace installed-view parity is not preserved in the prototype.** `prototype/marketplace.html:125`, `:129`, `:152`; `marketplace-dark.png` and `marketplace-light.png`; inventory lines 70–85. The existing “Skills & Plugins” header/harness explanation and search disappear. Acme Toolkit, an external marketplace plugin, is placed alongside bundled plugins under “Plugins”, while “External plugins” says zero. The required groups are Ptah plugins, Community skills, Marketplace plugins, in that order. Row detail navigation, the inspector/drawer, source-label distinctions, roving row navigation, no-match state, Removing state, stale-row message, and action-error treatment are absent. Spec lines 103 and 207 promise preservation but do not reconcile these differences. **Change:** retain the real header, search and group structure; place Acme in Marketplace plugins; restore the existing source labels alongside new provenance; show the preserved row/detail/navigation and pending/error states. Cross-reference every affected inventory row rather than asserting “nothing is removed”.

2. **Blocking — Consent and report parity is not demonstrated.** `prototype/marketplace.html:27` promises unchanged blocks in an HTML comment, but the dialog has no executable-script list, MCP command/environment-name disclosure, non-execution statement, or skipped-binary list. Its busy state with disabled Cancel/Install and “Installing…” is absent. The install report at `:98` has a Shadowed counter but loses the existing named shadowed-skills list (inventory line 95). These are preserved capabilities, including requirement 8.12. **Change:** render populated disclosure blocks using the real component copy, including verbatim commands as text, environment names only, and “Ptah will NOT register or run these servers”; retain the skipped-file and named shadowed lists; add the busy state. State the insertion point unambiguously: Spec line 50 says after shadowing/before scripts, whereas the existing component places scripts/MCP/skipped binaries before shadowing. Preserve the relative order of existing blocks.

3. **Blocking — Wizard parity and informational target semantics are incomplete.** `prototype/wizard-preview.html:125` does not show the generation source status or generation-model picker that Spec line 207 says are shown above the list. Neither preview demonstrates the independent backend warning for unavailable sync or failed CLI detection; a targets-changed warning is a different capability. The pack surfaces' browse/expand/Install/Install All/per-file status/retry controls are not represented. At `:108`, the prototype substitutes a conditional Claude source agent based on Playwright configuration for the retained conditional rival-CLI targets. The sidebar has no rival-CLI target example. **Change:** show the preserved surrounding sidebar controls and both independent warning states; retain both pack entry surfaces and their resulting per-file status; use genuine definite/conditional rival-target examples with condition text and informational treatment, without implying the wizard overwrite guard now controls rival copies. Keep the source-file decision separate.

4. **Serious — Target selection is missing from packs and unreachable in the sidebar.** Spec lines 20 and 56 define C5 only for wizard previews. `prototype/wizard-preview.html:133` has no promised “Change” control, and the pack prompt at `:190` has no target path or root choice. Its no-conflict path skips the prompt altogether (Spec line 46), leaving no designed opportunity to choose an opened-folder target. Clicking the modal target only toggles the warning (`prototype/assets/proto.js:84`); it does not refresh the displayed target-dependent comparison/decision state. **Change:** specify and prototype a target choice before both pack entry actions, including the no-conflict case; implement sidebar Change/reveal; show review/loading/reset behavior after a target change. Add a pack completion example with the exact Electron warning from Spec line 62, plus its VS Code wording. Requirements 2.2–2.4, 2.6 and 3.2a cannot be accepted from warning prose alone.

5. **Serious — Selected Keep has an invisible keyboard focus indicator; modal keyboard parity is missing.** `prototype/assets/proto.css:38`, `:94`, `:97`, `:99`: the outline is base-content, but selected Keep's background is also base-content; the negative outline offset puts the ring inside that background, yielding **1.00:1 in both themes**. The prototype also has no dialog opening/focus placement, Tab confinement, Escape dismissal, or focus restoration handler (`prototype/assets/proto.js:1`). Spec line 153's “no change is needed” assertion is too broad: target cards are div radios in the prototype, while the sidebar trap only queries buttons. **Change:** use a visible selected-state focus treatment (for example a contrasting inner ring or an unclipped outer ring), measure the actual adjacent colors, and implement a working opener/dialog/close focus cycle. Make target controls compatible with the trap or specify the required trap update, including hidden elements and roving tabindex. Preserve arrows, Space/Enter and path-inclusive accessible names already present in the keep/replace implementation.

6. **Serious — The unreadable-file prototype contradicts forced Keep.** `prototype/wizard-preview.html:181` says the file will be kept but supplies an enabled Replace radio at `:185`; the shared handler selects it normally. Spec lines 17 and 186 instead require forced Keep. Marketplace has no unreadable-local-item example, although 8.5c requires keeping it. **Change:** render a non-replaceable unreadable row with the explanatory copy, prevent bulk/keyboard selection of Replace for that row, and show the state in wizard/pack and Marketplace contexts. Clearly distinguish this from an ordinary differing file.

7. **Serious — Marketplace/Library agreement and provenance edge states are not reviewable together.** `prototype/library.html:20` leaves Skills and Commands panels empty. There is no Library community-source skill or shadowed item matching Marketplace's examples, and no plugin-update diverged clone matching the consent's keep route. Marketplace says Old Helper is disabled (`marketplace.html:141`), while Library says it is no longer installed (`library.html:53`). Marketplace reports architect's local source kept, while Library labels architect “Plugin: Acme Toolkit”/“In sync” without explaining which source the row represents. **Change:** use one coherent fixture across consent, result, Marketplace and Library; demonstrate active, shadowed, kept, plugin-update diverged, disabled and uninstalled/orphaned cases. Distinguish disabled from uninstalled copy. Add explicit provenance mapping for legacy/unmarked files, kept/current files retaining prior origin, kept pack files as Workspace file, and actual wizard writes as Setup wizard. Requirements 3.9–3.11 and 8.8 need deterministic labels, not name-based inference.

8. **Serious — Completion prototype contradicts required outcomes and omits sidebar grade copy.** `prototype/completion.html:28` marks planner “Changed since preview (kept)”, but `:31` says that same agent became diverged from its new source. That is inconsistent with the keep behavior in requirement 4.5. Seven processed agents have only three per-file entries. The sidebar at `:65` lacks the five outcome categories/per-file list and omits “Generating the file alone does not produce one”, required by 7.1 in both completion surfaces. **Change:** make counts and rows consistent, name only clones whose sources were actually replaced, and render the full outcome contract and all three grade statements in both completion surfaces. Include the all-kept/current and failure variants for the sidebar as well.

9. **Serious — Installer-family protection and primary failures lack complete designed states.** Spec line 52 names skills.sh and plugin-enable result/repair behavior, but `prototype/marketplace.html:113` shows only one generic skills.sh differing file and an inert “Review and replace…” button. There is no owned-but-edited result/installed-view example for Ptah plugin enable or plugin-agent mirroring, no readable confirmation state for the repair route, and no unreadable result. Requirement 8.5f must hold outside the clone store across all families, not just in the external consent example (which correctly includes a .codex managed edit). Failed removal/config-save/fetch action states under 8.10 are also unspecified; load failure is not removal failure. **Change:** specify a shared, working result-to-consent route with unowned and owned-but-edited examples mapped to each family, kept notes in the installed view, and exact action-error/retry/pending copy for install, remove and config changes. Do not promise “no files were changed” on generic install failure (`:88`) without a transactional guarantee; the requirements explicitly preserve the existing cleanup contract rather than require transactional installation.

10. **Moderate — Exact copy diverges during interaction and across hosts.** `prototype/assets/proto.js:80` changes every confirmation to “Confirm and replace N files”, removing “Update Acme Toolkit” and “Install pack”; this conflicts with Spec line 50's install/update suffix rule. Spec line 82 supplies only the Electron ignored-override wording; there is no exact VS Code ignored-override string. Spec line 56's default-root helper names the Library without a host-specific replacement. `completion.html:58` supplies a third opened-folder warning different from Spec lines 60–62. **Change:** define context-specific confirmation templates and a host/target/model-origin copy matrix, including ignored overrides and fallback “no model line”; use the same strings in HTML and JS. Preserve D3 for every VS Code variant.

11. **Moderate — Responsive and token handoff evidence is incomplete.** Spec line 203 acknowledges that a real narrow viewport was not captured; the 380px embedded frame is not equivalent. No responsive layout rules or long-path/long-plugin-name examples settle the behavior at approximately 400px. Spec line 120 leaves final diff colors to the implementer, and line 173 leaves their contrast unmeasured. The light segmented radius is a deliberate deviation from the theme button radius, rather than “all from existing config”. **Change:** resolve final diff token mappings and the segmented-radius source, record them as proposals/deviations, measure their actual pairs, and provide narrow dark/light evidence with wrapping actions and paths. Do not require running the application for this review: the author can revise the static artifact and capture it through an allowed route.

12. **Moderate — Rule provenance and parity mapping are incomplete.** `prototype/README.md:14` lists only three lane proposals, lacks a parity-inventory cross-reference/mapping, and omits applied project rules. Spec's principles and DS1–DS10 are untagged. Bulk Replace all without another prompt, collapsed target selection, inline diffs, refresh dismissal behavior, new copy and new navigation are lane decisions, not direct user instructions. **Change:** tag each rule with its source and distinguish approved requirement elaborations from new lane proposals; include the mapping below in the author's own contract. Do not describe an accessibility-driven choice as a blanket prohibition on a project component.

## Requirement coverage

“Covered” means designed in prose and/or a matching visible state, not runtime verification. “Partial” identifies a missing or contradictory prototype state that must be resolved. Backend-only criteria are retained requirements and are not judged as visual failures.

| Requirement IDs | Design/state evidence | Assessment |
| --- | --- | --- |
| 1.1–1.2 | Spec 16–19, 30–42; wizard-preview 54, 87, 103, 147 | Covered: both per-file groups default Keep; new/current rows have no decision. |
| 1.3–1.4 | Spec 91–96; completion 17–29 | Partial: outcome categories exist; complete coherent per-file examples needed (F8). |
| 1.5 | Spec 138, 207; wizard-preview 187 | Stale/reconfirm copy exists; preview-required reopening is preserved by parity, not demonstrated interactively (F3/F5). Server rejection is backend validation. |
| 1.6 | Spec 139, 185; wizard-preview 175–177 | Covered create-only fallback wording and action. Sidebar variant must retain this behavior. |
| 1.7 | Spec 44 | Covered behavior contract: retry/resume retain decisions. Backend enforcement is outside this review. |
| 1.8–1.9 | Spec 46; wizard-preview 190–205 | Partial: prompt exists; both pack entry surfaces and kept pack-row result absent (F3/F4). |
| 1.10 | Spec 3, 61, 81, 99 | Host policy stated; no complete host-specific prototype/copy matrix (F10). |
| 1.11 | Spec 137, 186; wizard-preview 181–185 | Contradictory enabled Replace in forced-Keep state (F6). |
| 1.12 | Spec 91, 138; completion 28 | Changed-since-preview outcome exists; contradictory divergence example (F8). Pack/retry enforcement is backend work. |
| 1.13 | Spec 91–96; completion 17–29, 49–51 | Partial: five outcomes designed, incomplete sidebar/pack examples (F3/F8). |
| 1.14 | Spec 207, 226 | Only prose preservation for source status/model picker/backend warning; missing prototype states (F3). |
| 2.1 | Spec 56 | Covered same-root path-only behavior in prose. |
| 2.2–2.4 | Spec 20, 56; wizard-preview 19–33, 133, 190 | Partial: default-root modal exists; sidebar Change and pack target choices missing (F4). |
| 2.5 | Spec 70; library 22 | Covered refresh/status intent; live refresh is backend/application verification. |
| 2.6 | Spec 58–62, 80–83, 98–99 | Partial host/target matrix; root-helper/ignored-model copy not fully host-qualified (F10). |
| 3.1–3.3 | Spec 70, 97; library 22, 66–67 | Refresh/loading/failure intent covered; pack completion mapping incomplete. |
| 3.2a | Spec 62; completion 53–55 | Warning copy exists; actual pack alternative-target/result flow absent (F4). |
| 3.4–3.6 | Spec 66–68; library 24–54, 64, 76–79 | Covered provenance, retained wizard label, card/drawer placement, corrected empty Agents copy. |
| 3.7 | Spec 97; completion 36 | Covered post-write Library-stale notice; pack result variant not shown. |
| 3.8 | Spec 3, 99 | D3 preserved in prose; exact host copy gaps in F10. |
| 3.9–3.11 | Spec 66 | Partial: legacy/current/kept/prior-origin mapping not fully specified or illustrated (F7). |
| 4.1–4.2 | Spec 74; wizard-preview 51; library 26–29 | Wizard divergence note/card covered; same note missing in sidebar example (include in F3 revision). |
| 4.3–4.5 | Spec 74, 93; completion 28–31 | Partial: named clone result exists but names a kept source as newly diverged (F8). |
| 4.6 | Spec 99 | Covered host exclusion in prose. |
| 5.1 | Spec 80–81; wizard-preview 52, 145 | Covered applied override, origin and workspace/machine scope. |
| 5.2–5.3 | Spec 82–83; wizard-preview 85, 104 | Partial: template/no-model/ignored states defined; VS Code ignored and ignored-with-no-model fallback need exact copy (F10). |
| 5.4–5.5 | Spec 85; library 84–87; wizard-preview 132 | Covered shared-model helper and distinct Writing model label; preserve the actual picker (F3). |
| 6.1–6.7 | Generation prompt/validator/rubric contracts | No direct new UI state. Preserve authored-fallback behavior; not visually verified. |
| 7.1 | Spec 94; completion 34, 68 | Modal covered; sidebar omits generation-alone statement (F8). |
| 7.2 | Spec 95; completion 45–47 | Covered all-kept/current statement; sidebar state missing (F8). |
| 7.3 | Spec 99 | Covered VS Code grade exclusion in prose. |
| 8.1 | Spec 3, 56 | Root alignment contract; installer root display/review flow incomplete (F4/F9). |
| 8.2, 8.2a–8.2b | Spec 70, 103 | Refresh intent/status covered; stale-workspace reply rejection is intentionally silent/backend. |
| 8.3–8.4 | Spec 66, 103; library 38–42; marketplace 132, 149 | Labels defined; community and plugin-skill Library examples missing (F7). |
| 8.5, 8.5a | Spec 50; marketplace 31–77 | Covered default-Keep consent rows for unowned, edited managed, edited clone; interactive cancel lifecycle not demonstrated (F2/F5). |
| 8.5b, 8.5f | Spec 50–52; marketplace 48–54, 113–117 | External edited .codex destination covered. No-consent family/result/installed-view/repair mapping incomplete (F9). |
| 8.5c | Generic C2 unreadable state only | No Marketplace unreadable fixture; force Keep (F6). |
| 8.5d | Spec 50, 74; marketplace 65–69 | Keep versus post-success rebase intent covered; matching plugin-diverged Library state missing (F7). |
| 8.5e | Spec 50, 52; marketplace 87, 106–107 | Covered re-approval reset and changed-since-approval outcome. |
| 8.6–8.7 | Spec 52; marketplace 28, 98–107 | Kept list covered; named shadowed report list dropped (F2). |
| 8.8, 8.8b | Spec 66, 103; marketplace 134, 141; library 50–54 | Partial/inconsistent cross-view fixtures, missing Library shadowed/community states (F7). |
| 8.9 | Spec 103; marketplace 133–138 | Agent counts and one names disclosure exist; names missing for bundled plugin; preserve commands as well (F1/F7). |
| 8.10 | Spec 50, 187; marketplace 88–89, 155 | Install failure exists. Removal/config/fetch action errors unspecified; load error is not action failure (F9). |
| 8.10a | Spec 52, 103, 147; marketplace 109, 127 | Covered post-primary-success stale notice. |
| 8.11 | Spec 3, 103 | Host intent covered; consent/result/installed-view host variants need complete D3 copy mapping (F10). |
| 8.12 | Spec 50, 207; marketplace 17–18, 87–89 | Install/update/reapproval/error visible; disclosure/busy parity gaps (F2). |
| Accessibility NFR | Spec 152–179; proto.css 38, 94–99; proto.js 25–47 | Group keyboard handlers/names exist; focus and lifecycle fail contract (F5). |
| Visual-review NFR | Eight supplied dark/light screenshots | Inspected. Static Edge captures are not Electron runtime validation; no actual narrow capture (F11). |

Requirements without a complete designed state are explicitly identified by “Partial”, “missing”, or “contradictory” above. In particular: pack target choice/no-conflict target/result (2.2–2.3/3.2a), Marketplace unreadable items (8.5c), non-consent edited-managed family flows (8.5b/8.5f), failed removal/config/fetch (8.10), and Library shadowed/community agreement (8.8) need new or completed states, not only wording adjustments.

## Parity check

**Not passed.** No removal is authorized. The following line-based map covers the inventory's capability rows, including backend rows so they are not mistaken for missing screens. “Preserved in prose” is not a claim that the current prototype exercises the behavior.

| Inventory lines | Capability set | Review result |
| --- | --- | --- |
| 24–28 | Read-only preview; ordered agents/source paths; rival targets; reserved exclusions; overwrite flag | Backend restrictions remain. Prototype's conditional/rival examples and agent grouping need correction (F3). |
| 29–32 | Sync/CLI warnings, sub-folder warning, target conditions | Sub-folder warning present; independent backend warnings and real rival conditions absent (F3/F4). |
| 33–35 | Confirmed-preview gate, resume, single-item retry | Preserved contract in Spec 44/207; implementation validation remains. |
| 36–44 | Wizard entry disabled states, checking, changed targets, fallback, warning, definite/conditional files, cancel, solid warning contrast | Checking/fallback/changed/solid warnings shown. Entry/close behavior and backend-warning/conditional fidelity incomplete (F3/F5). |
| 45–51 | Sidebar generate gating, source status, model picker, selection controls, stale guards, rejection reopen, signature | Prose preservation only; context and interactions absent (F3). Backend guards not visually verifiable. |
| 52–57 | Dialog title/model, alerts, backend warning, certainty/conditions, cancel/confirm, focus/escape/trap | Title/model/decision rows present; backend warning and lifecycle absent (F3/F5). |
| 58–59 | Both community-pack surfaces, bulk/single install, status, retry | Only conflict prompt shown; surrounding capabilities missing (F3). |
| 60–64 | Pack authorization/target/download safety; write outcomes; propagation | No removal proposed for backend guarantees. Target choice and pack result designs incomplete (F4). |
| 70–76 | Header, search, three ordered groups, group/load/action states, row metadata, source labels | Concrete prototype conflict/omissions (F1). Command count must remain when adding agents. |
| 77–79 | Manage, Uninstall/Removing, stale-row reload | Manage/Uninstall shown; pending/stale handling absent (F1/F9). |
| 80–85 | Routed detail inspector/drawer, keyboard rows, workspace safety, detail facts/issues/targets/actions | Detail and navigation absent; not accounted for by “same page” (F1). Workspace reply guard remains a backend/store contract. |
| 86–93 | Two-call consent, identity/upgrade, reapproval, MCP safety disclosure, error, busy/cancel, shadowing | Upgrade/reapproval/error/shadowing present; safety disclosures/busy absent (F2), lifecycle absent (F5). |
| 94–95 | Enable/reconcile and collision report | Backend intent retained; named report shadowing dropped (F2). |
| 96–100 | External/community remove/install cleanup and propagation; Ptah config toggle | No backend removal proposed; corresponding action errors/edited-managed results need designed states (F9). |
| 101–103 | Unowned refusal, edited-managed protection, explicit repair | External owned-edit row exists; no-consent result-to-repair flow incomplete (F9). |
| 104–105 | Editable orphan; reinstall replaces owned tree while retaining edited clone flow | Orphan visible with inconsistent disabled/uninstalled copy (F7); reinstall backend contract retained. |

A prose preservation declaration does not authorize the prototype's silent drops. Resolve F1–F3 before using this prototype as an implementation reference.

## Component and theme spot-checks

| Real component inspected | Evidence and comparison |
| --- | --- |
| `libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts:497` | Confirms solid warning-content treatment, native modal, conditional targets, backend warning and fallback button. New solid warnings match; prototype conditional/backend context does not fully match. |
| `libs/frontend/setup-wizard/src/lib/components/agent-preview-dialog.component.ts:23` and `:124` | Confirms model/title/certainty/condition rendering and a button-only first/last Tab trap with Escape. Button radios are a plausible extension, but prototype div target radios and absent modal lifecycle invalidate “no change needed”. |
| `libs/frontend/marketplace/src/lib/external-consent-dialog.component.ts:168`, `:214`, `:241`, `:296` | Confirms scripts, text-interpolated MCP commands, env names, skipped binaries and busy disabled controls. These need visible retained states. |
| `libs/frontend/marketplace/src/lib/pages/skills/installed-skills-page.component.ts:115` | Confirms Skills & Plugins header, harness explanation and search. AST also confirms routed close/uninstall and row keyboard functions; the new example must preserve them. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-card.component.ts:116` and `:236` | Confirms existing source/status hints and “No grade” muted treatment. Provenance labels and divergence reason should extend this component, keeping status separate from origin. |

Theme sources inspected: `apps/ptah-extension-webview/tailwind.config.js:80` and `:149` (Anubis/Anubis-light); `apps/ptah-extension-webview/src/styles.css:150` and `:154` (surface mix and strong border). Prototype base/content/primary/warning colors and surface formulas trace to these sources. Its handwritten CSS, diff colors and light segmented radius are deviations that must be explicit; visual similarity does not prove component reuse.

Independent WCAG 2.2 AA checks use relative luminance after OKLCH-to-linear-sRGB conversion with channel clipping: 4.5:1 for normal text (1.4.3), 3:1 for essential UI state/indicator contrast (1.4.11), plus visible keyboard focus (2.4.7). Values below use prototype color literals; no browser gamut-mapping claim is made.

| Pair | Dark | Light | Result |
| --- | --- | --- | --- |
| base-content / base-100 | 14.86 | 15.91 | Pass |
| base-content / base-300 | 12.29 | 13.21 | Pass |
| muted / base-100 | 6.06 | 6.03 | Pass |
| muted / base-300 | 5.01 | 5.01 | Pass |
| primary-content / primary | 4.82 | 6.84 | Pass for button text |
| warning-content / warning | 6.61 | 5.67 | Pass |
| primary / page | 3.59 | 1.40 | Light fails as an essential indicator or text color |
| inset focus / selected Keep fill | 1.00 | 1.00 | Fail: actual focus treatment |
| diff addition foreground/background | 9.85 | 8.30 | Prototype literals pass |
| diff deletion foreground/background | 8.46 | 8.20 | Prototype literals pass |

The screenshots and CSS do not use light primary as small text or the sole label/state cue: buttons use primary-content, and plugin badge borders accompany explicit base-content labels. Thus the 1.40 ratio alone is not a reason to ban primary buttons or badges. The material focus failure is the selected Keep ring, not the ordinary page ring. Final diff token pairs and interaction states still require measurements after the author's corrections.

## Rule provenance

| Rule or decision | Tag | Source / disposition |
| --- | --- | --- |
| Default Keep and explicit file replacement; no lost edited files | [user-requested] | U1, requirements 1 and 8. |
| Electron-only Library, no VS Code Library UI | [user-requested] | decisions.md D3. The full no-Library-copy matrix is the approved PM6 elaboration. |
| Existing capabilities remain; no merged inventory redesign | [project-rule] | Approved task scope and parity-inventory.md; no removals authorized. |
| Keyboard access, path-inclusive names, solid warning contrast | [project-rule] | task-description.md accessibility NFR, real preview components. |
| Project token/component reuse, status distinct from action, one primary action, narrow/wide/embedded proof | [project-rule] | ui-ux-designer/SKILL.md and PROTOTYPING.md:203–226. |
| Changed-since-preview protection, provenance fallback, edited-managed protection, host-copy mapping | [lane-proposed] | Already approved requirement elaborations PM6/PM10/PM12–PM14, not new direct user instructions. Preserve them. |
| DS1 button-radio implementation; DS2 bulk action without extra confirmation; DS3 inline diff; DS4 collapsed target control | [lane-proposed] | Spec Decisions; pending successful Gate 1.7 review. |
| DS5 exact provenance strings; DS6 focus styling; DS7 exact grade wording; DS8 refresh status persistence | [lane-proposed] | Requirements establish behavior; designer chooses treatment/copy. DS6 needs correction. |
| DS9 clone row treatment; DS10 result-to-repair navigation; diff colors/segmented radius | [lane-proposed] | Designer implementation choices; behavior must satisfy approved safety and rebase requirements. |

The required revisions are reversible design corrections within the approved scope. No new capability removal, host expansion, or visual direction decision is requested.

## Round 2 re-review

Verdict: APPROVED

Final round: 0 Blocking and 0 Serious findings remain. The four Serious defects from round 1 are resolved. Three Moderate prototype gaps remain below; approval uses the requested threshold and does not mean every original finding is fully closed. This assessment supersedes the round 1 verdict. D3, D6 and D7-D11 remain settled decisions.

Scope and evidence: reviewed the new "Revise round 2" section first, its cited specification sections, the prior open findings, decisions, README, shared JavaScript, affected HTML and relevant parity entries. Inspected supplied screenshots: marketplace-inspector-community-dark.png, marketplace-inspector-bundled-light.png, marketplace-repair-agent-dark.png, marketplace-repair-plugin-light.png, packs-file-scope-light.png, packs-subfolder-dark.png, sidebar-400-light.png and wizard-preview-dark.png. Source tracing and supplied screenshots only; no live browser execution, tests, build, serve, e2e, workspace-wide checks or git mutations. Paths below are relative to this task folder; screenshot names are relative to prototype/screenshots/.

| Item | Status | Evidence |
| --- | --- | --- |
| R1-1: selected Marketplace identity and preserved search fields | fixed | `prototype/marketplace.html:20`, `:27`, `:38`, `:49`, `:205` supply name, description, source and kind plus separate fixtures for all four main installed items. `prototype/assets/proto.js:247` updates title and `:250` updates description, facts, names, kept note, sync and action together; `:265` matches every query word across the supplied fields. `acme/skills` now matches tailwind-v4. Community-dark and bundled-light inspector screenshots show the respective identities. |
| R1-2: pack target choice from individual/sidebar entry points | partially | Serious routing gap fixed: `prototype/packs.html:16`, `:21`, `:22`, `:23`, `:24`, `:86`, `:87`, `:90` all reach ov-pack with pack/file scope. `prototype/assets/proto.js:157` scopes rows; `prototype/packs.html:44` and `:45` provide root/no-conflict and opened-folder/differing branches; `proto.js:95` resets choices on target change. File-scope-light and subfolder-dark screenshots demonstrate both branches. Expand/collapse still fails: R2-1. |
| R1-3: plugin-agent repair includes its reported agent | partially | Serious omission fixed: `prototype/marketplace.html:168` through `:170` identify each family; `:185` through `:187` include release-manager.md, Keep selected, plugin-version label and comparison. Plugin family retains the locked release.md row at `:182`. `prototype/assets/proto.js:170` filters by family and resets to Keep. Agent-dark and plugin-light repair screenshots show the appropriate files. Initial counts remain incorrect: R2-2. |
| R1-4: initial sidebar default Keep | fixed | `prototype/sidebar.html:50`, `:56`, `:59` select Keep; Replace is false, and the unreadable row is locked. sidebar-400-light.png shows Keep and the initial "Confirm and generate" action. Existing readable wizard rows retain "Exists — may be replaced" and unavailable generated-content comparisons. |
| R1-5: target and unavailable-sync warnings | fixed | `prototype/wizard-preview.html:31`, `:36` and `prototype/sidebar.html:42` condition subfolder notices on the sub target; `prototype/assets/proto.js:95` switches them. `prototype/sidebar.html:71` is a separate unavailable-sync specimen with only the Claude source row; `prototype/wizard-preview.html:86` is a separate detection-failure specimen. Default available-sync views keep informational rival rows without the contradictory warning. |
| Original finding 1 | partially | Identity/search are closed by R1-1; the inspector's preserved name disclosure has the same double-toggle issue as pack collapse (R2-1). |
| Original finding 3 | fixed | R1-5 closes its remaining warning contradiction. Source status, writing model, selection controls and definite/conditional rival rows remain in sidebar A. Pack interaction issues remain under finding 4. |
| Original finding 4 | partially | Required target routes, file scope, no-conflict branch and changed target comparison now exist. Remaining expand/collapse gap is Moderate (R2-1), not the former Serious unreachable-target defect. |
| Original finding 9 | partially | Family-specific explicit repair is now present, including the reported plugin agent and unreadable forced Keep. Initial count mismatch remains Moderate (R2-2); selecting Replace recalculates the actual visible replacement count. |
| Regression check: earlier finding 6, pack forced-Keep evidence | partially | The revised pack prompt no longer contains an unreadable row or bulk controls, although `design-spec.md:63` still requires them. Other affected surfaces preserve forced Keep. This is missing prototype coverage, not an approved capability removal (R2-3). |

### Remaining findings and regressions

**R2-1 — Moderate: collapse/disclosure handlers cancel each other.** Evidence: `prototype/packs.html:14` marks Collapse with both `.disc` and `data-toggle`; `prototype/marketplace.html:63` does the same for Show names. The `.disc` listener at `prototype/assets/proto.js:55` flips aria-expanded and panel.hidden, then the independent `data-toggle` listener at `:138` reads the newly flipped value and reverses it. A click leaves the panel in its original state. Pack expand/collapse therefore still fails the retained capability at `parity-inventory.md:58`; inspector disclosure is also affected. Use one toggle handler per control. This is a functional residual of the requested fixes, not a style preference.

**R2-2 — Moderate: repair and changed-target summaries count hidden containers instead of the displayed rows.** Evidence: `prototype/assets/proto.js:174` and `:175` exclude every group whose ancestor is hidden, but `openDialog` calls `scopeDialog` at `:182` before revealing the overlay at `:183`. The repair overlay starts hidden (`prototype/marketplace.html:172`), so each family initially reports "0 files can be replaced" and "0 kept, 0 to replace". The agent-dark and plugin-light repair screenshots show these zero counts alongside their actual Keep rows. The target-change path similarly calls `applyTarget`/summarise at `proto.js:120` before showing data-view at `:121`; packs-subfolder-dark.png shows a selected Keep row with "0 kept, 0 to replace". Recalculate once the container is visible, or count the active family/target scope independently of temporary container visibility. Preserve the unreadable count and exclude unrelated families. The requested repair row and safe Keep default work; this does not restore the previous Serious omission.

**R2-3 — Moderate: the pack rewrite drops previously reviewed forced-Keep/bulk coverage.** Evidence: the complete conflict branch at `prototype/packs.html:45` through `:52` now contains only readable perf-tuner.md and no bulk controls; section B at `:57` through `:80` is solely a no-conflict specimen. There is no pack unreadable/locked row anywhere in the file. This no longer demonstrates `design-spec.md:43` (forced Keep everywhere) or `:63` (C4, unreadable C2 and other-new-file information), despite the earlier review's finding 6 being closed on pack evidence. Restore a clearly labelled reachable pack fixture with an unreadable row and its forced Keep behavior, plus the specified bulk/new-file context. The written design still requires the guard, so this is a prototype coverage regression rather than evidence of a destructive implementation.

### Decision and parity disposition

No new contradiction with D7 was found in the revised wizard initial states: every actionable existing readable source row starts at Keep; unreadable rows remain locked; wizard content is not claimed to be known before generation. Pack/plugin comparisons keep their separate known-content semantics. D3's desktop-only Library and the approved direction under D6 are not reopened. No round 2 change proposes reversing D8-D11; backend enforcement of those decisions is outside this design re-review.

The inventory still approves zero removals (`parity-inventory.md:107`). The inspected changes do not authorize removal of any of its 77 capabilities. R2-1 records an outstanding implementation of preserved expand/disclosure behavior, and R2-3 records lost design evidence; neither is permission to drop functionality. Carry these three Moderate findings into implementation. No further design-review round is requested.
