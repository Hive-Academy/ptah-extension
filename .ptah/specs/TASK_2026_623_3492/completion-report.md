# Completion Report - TASK_2026_623_3492 (Display panel)

Mode 3 (team-leader), 2026-10-12. Worktree `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel`.
The branch is `feat/task-623-display-panel`, based on `70f995a56`, with HEAD at `080284a1b` before this report.

**Verdict: COMPLETE WITH NOTES.**

- All 40 batches and all 87 tasks in `batches.md` are COMPLETE.
- All 39 batch commits resolve, and each is an ancestor of HEAD. Batch 33 has no source commit of its own (decision
  #160).
- Phases 1-8 are ACCEPTED, each by an accepting review.
- The parity inventory is verified row by row.
- No persisted-settings write paths were added.
- One known evidence gap remains: the populated display surfaces were never rendered. The user accepted this gap
  before Gate 3 (USER #155(b), with #158 and #160). It is follow-up #161(1). It is **not** verified.

## 1. What shipped, by phase

| Phase | Batches (commits) | What it delivers | Review |
| ----- | ----------------- | ---------------- | ------ |
| 1 Contract `/4` and grammar | 1 `29c30cf06`, 2 `e6826d07d`, 3 `d702fc14a`, 4 `31904b890`, 5 `00db87c36`, 6 `7206eb973`, 6F `f0d5df3a4` | `dashboard-catalog/4` contract and whole-pair validator (`/3` rejects `/4` features); text fallback; `display [id]` fences; nested layout grammar (`row col grid card section accordion`); converter; pure `$agents` source; resolver/pipeline `compilePtahUiBlock`; corpus and compactness specs | `code-logic-review.md` REVISE 6/10 -> fix 6F -> `code-logic-review-phase1-fix.md` APPROVED 8/10 |
| 2 Lane plan-limit read (R10 backend) | 7 `6d0421cb9`, 8 `89894ac0a`, 9 `a59a701cd`, 10 `47d8fb903`, 11 `02d47eb3b`, 12 `c8c137611`, 12F `76b125fa0`, 12F2 `e05d8250f` | Read-only `agent:getLanePlanLimits` RPC (Electron only; absent on VS Code and CLI); `formatPlanLimitRows` export; no `refresh`, no spawn; fixed-text failure boundary | `code-logic-review-phase2.md` REVISE 6/10, style APPROVED 8/10 -> 12F REVISE 5/10 -> 12F2 `code-logic-review-phase2-fix2.md` APPROVED 9/10 (#46) |
| 3 Renderer `/4` | 13 `51a6aa3a9`, 14 `cf913a15f`, 15 `5bfbb8b00`, 15F `b66148f4c` | Container-query layout width, accordion, stat trend pill and sparkline, avatar; trust-boundary specs; renderer guard fails closed | `code-logic-review-phase3.md` REVISE 6/10 -> `code-logic-review-phase3-fix.md` APPROVED 8/10 |
| 4 chat-ui display panel | 16 `24e882f14`, 17 `b3d5ce368`, 18 `3ee10e554`, 19 `4229545e1`, 20 `5558f064a`, 21 `5f356dc96`, 21F `b57910d88` | Host-sources token; `$agents`/`$limits` live adapters; display chip; host-built turn summary model and chip; lazy `@ptah-extension/chat-ui/display-panel` entry; panel strip, tabpanels and summary cards | code-logic APPROVED 7/10; style REVISE 7/10 -> 21F -> `code-style-review-phase4-fix.md` APPROVED 9/10 (#92) |
| 5 Transcript and dock | 22 `92d6a9597`, 23 `a4b7cc22e`, 24 `1d85c1dfa`, 25 `2ca5c9048` | Transcript display candidates and agent facts; per-tab dock state; transcript host sources; summary chip replaces the change-set card and tests row (Electron); tests row deleted; Displays/Agents dock in ChatView | `code-logic-review-phase5.md` APPROVED WITH NOTES 8/10 (#115) |
| 6 Previews (R7, both webviews) | 26 `583108bcf`, 27 `f70499432`, 28 `f96a6d5a7`, 28F `1527efcc1` | Tool-language util, copy button, expandable code output with language label; tool-call header (command preview, status text, accessible names, open-file); diff counts and gutter; full Bash command; Write preview | `code-logic-review-phase6.md` REVISE 6/10, style APPROVED WITH NOTES -> 28F -> `code-logic-review-phase6-fix.md` APPROVED WITH NOTES 8/10 (#135) |
| 7 Hint, skill, measurement, eager gate | 29 `36a8b37f9`, 30 `d7a69fbd0`, 31 `29c3418f0`, 32 `21074df38` | `PTAH_UI_HINT` (87 tokens); `ptah-surface-authoring` skill (asset and `.claude/skills` mirror); content manifest; measurement; eager-closure gate patterns | `code-logic-review-phase7.md` APPROVED WITH NOTES 8/10, no fix round |
| 8 Visual verification (V1) | 33 (build/gate/review only), 33F `5a2344e37` | One production webview build plus the eager gate; Electron visual review; fixes D1 (inactive dock tabpanel visible), D2 (chip word wrap), eager allow-list | `visual-review.md` FAIL -> 33F -> `visual-review-33F.md` PASS WITH NOTES (#158, #160) |

The remaining commits on the branch (`git log 70f995a56..HEAD`, 44 in total) are `docs(task-specs)` updates to
`batches.md`.

## 2. Evidence

- **Batch states:** `batches.md` has 40 COMPLETE batch headers and 87 COMPLETE task headers, with no other state.
  Each header carries its SHA. `git merge-base --is-ancestor <sha> HEAD` succeeds for all 39 SHAs.
- **Scoped checks:** every batch ran its scoped typecheck, lint or Jest before it was committed (the per-batch
  acceptance decisions in `decisions.md`, for example #80, #90 and #156). No suite was re-run in Mode 3 because no
  completion check needed one (CLAUDE.md memory-safe rules).
- **Measurement (`measurement.md`):**
  - Hint: 371 chars, 87 tokens, under the cap of 100. It was 74 tokens at the merge base.
  - `tools/list`: byte-identical between the merge base and HEAD on both hosts and both profiles. Coding parity
    holds, and the Apps delta is 0 characters.
  - Eager-closure gate on the production build: PASS, exit 0, 781 eager inputs. Added eager growth is 15,268 B, all
    of it allow-listed after #148. Re-run on the #157 rebuild: PASS, 781 inputs.
- **Visual:**
  - `visual-review.md` covers:
    - collapsed tool-row heights, against the prototype;
    - expanded Bash, Read, Write and Edit previews at 360 and 1024, dark and light;
    - 299 real code-output blocks, with no overflow;
    - the diff gutter label;
    - the chip, collapsed and expanded;
    - axe on 11 transcripts and the dock: 0 serious or critical issues at spec widths.
  - `visual-review-33F.md` covers:
    - D1 and D2 fixed, at dock widths 292 and 481 px and chip widths 360 and 1024, in both themes;
    - keyboard roving tabindex and focus ring;
    - axe on the dock: 0 violations.
  - Screenshots: `visual-review/`, 64 files (24 of them from 33F).
- **Write-path trace:** the diff `70f995a56..HEAD` adds no write to `localStorage`, `sessionStorage`, VS Code
  global or workspace state, configuration or files. Dock and panel state is in memory, per tab. Not persisting
  width and pin is explicitly out of scope in task-description.md. The one new host read, `agent:getLanePlanLimits`,
  is read-only.
- **Clean tree:** `git status` shows only the harness `.gitignore` edit (never staged) and the `batches.md` final
  status (committed with this report's Mode 3 commit). The untracked task-folder files, logs and `node_modules`
  junctions stay out of commits.

### Requirement traceability

### How to read this table

The table covers all 92 numbered acceptance criteria in task-description.md (R1-R10) and the non-functional
requirements.

**Status values:**

- **VERIFIED:** a spec pins the criterion, and, for visual items, a rendered check or a measurement confirms it.
  Pure contract, parser and backend criteria count as verified by their specs.
- **VERIFIED BY SPEC ONLY:** a UI criterion pinned by a spec, but never rendered.
- **DEFERRED by #N:** a recorded decision deviates from or defers the criterion.
- **NOT VERIFIED (rendered):** the populated-surface gap. Each of these rows is also pinned by a spec, but the
  rendered check is missing. It is covered by USER #155(b) with #158 and #160, and becomes follow-up #161(1).

**Path abbreviations:**

| Abbrev. | Path |
| ------- | ---- |
| `chat/` | `libs/frontend/chat/src/lib/` |
| `cui/` | `libs/frontend/chat-ui/src/lib/` |
| `dd/` | `libs/frontend/declarative-dashboard/src/lib/` |
| `mac/` | `libs/shared/src/mcp-apps-contracts/` |

**Spec abbreviations** (each abbreviation is a spec file):

| Abbrev. | Spec file |
| ------- | --------- |
| DS | `cui/organisms/display-panel/display-surfaces.spec.ts` |
| DSS | `display-surface-sync.component.spec.ts` |
| DPC | `display-panel.component.spec.ts` |
| DDS | `chat/services/display-dock/display-dock.state.spec.ts` |
| DDC | `display-dock.component.spec.ts` |
| CVD | `chat/components/templates/chat-view.dock.spec.ts` |
| CTD | `chat-transcript.display.spec.ts` |
| AGS | `mac/ptah-ui-agents-source.spec.ts` |
| TSM | `turn-summary.model.spec.ts` |
| TSC | `turn-summary.component.spec.ts` |
| CHIP | `turn-summary-chip.component.spec.ts` |
| VR | `visual-review.md` |
| VR33F | `visual-review-33F.md` |

### R1 Display panel (Electron)

| Req | Evidence | Status |
| --- | -------- | ------ |
| R1.1 Per tab | DDS, DDC, CVD (per-tab state); CTD "two transcripts provide two different host-source instances" | VERIFIED BY SPEC ONLY |
| R1.2 Placement / overlay / Escape | DDC, CVD; Escape guard case in `chat-view.component.spec.ts` (Task 27.3); dock rendered at 292 and 481 px (VR33F rows 1-4) | VERIFIED |
| R1.3 Both panels open | The Gate 1.7 design puts Displays and Agents tabs in one dock. CVD covers it. VR D1 failed, was fixed in 33F, and passes in VR33F rows 1-4 and 8-10 (dark and light) | VERIFIED |
| R1.4 Open and close | CVD, DDS; dock opened and closed in the app (VR Group 3, VR33F row 10) | VERIFIED |
| R1.5 Resize | CVD, DDS | VERIFIED BY SPEC ONLY |
| R1.6 Pin | DPC, DDS; the Pin control is in the rendered tab order (VR33F row 10) | VERIFIED BY SPEC ONLY |
| R1.7 Auto-open | DPC, DSS, DDC, CVD | NOT VERIFIED (rendered): needs a live turn (#155(b), #158, #160) |
| R1.8 User close wins for the turn | DSS, CVD, DDS, `sidebar-tab.component.spec.ts` | VERIFIED BY SPEC ONLY |
| R1.9 No auto-open on replay | DSS, CVD, DDS (`seenBlockKeys`) | VERIFIED BY SPEC ONLY |
| R1.10 Summary never auto-opens | DSS | VERIFIED BY SPEC ONLY |
| R1.11 In-chat display chip | `ptah-ui-display-chip.component.spec.ts` ("one collapsed line", "starts collapsed ...") | NOT VERIFIED (rendered): expanded display chip (#155(b), #158, #160) |
| R1.12 Surface cap (8, LRU, `evicted`) | DS "keeps all N surfaces", "drops the least recently updated ...", "evicts by recency ..." | VERIFIED |
| R1.13 Empty state | DPC, DDC; rendered as "Nothing to show yet" and "No agents in this session" (VR Group 3); copy ruled in #152 | VERIFIED |
| R1.14 Electron only | CTD "VS Code: keeps the card, with no chip, no tests row and no sync"; CVD; R10.9 case | VERIFIED |

### R2 `ptah-ui display` fences

| Req | Evidence | Status |
| --- | -------- | ------ |
| R2.1 Targets | `ptah-ui-fence.spec.ts`; `message-sender.host-data.spec.ts` | VERIFIED |
| R2.2 No id creates a new surface | DS "keys anonymous blocks by blockKey and ordinal", "compiles each closed display fence once with its id or an id-safe anonymous surface id" | VERIFIED |
| R2.3 Repeated id updates in place | DS "R2.3: an updated surface equals a fresh render" | VERIFIED |
| R2.4 Update maps onto existing ops | DS "R2.4: one stat changes and the expanded accordion elsewhere keeps its view state" | VERIFIED |
| R2.5 Ids scoped; reserved `ptah.` | DS "R2.5: ... reserved `ptah.` id is invalid"; `ptah-ui-pipeline.spec.ts` | VERIFIED |
| R2.6 Invalid block is atomic | DS "R2.6: an invalid update leaves the previous content", "R2.6: a resolve that fails or throws is invalid" | VERIFIED |
| R2.7 Streaming | DS "R2.7: an unclosed (streaming) display fence yields nothing"; DSS; `transcript-display-candidates.spec.ts`; CTD "content-only streaming write ..." | VERIFIED |
| R2.8 Order | DS "R2.8: applies across messages, nodes and ordinals in transcript order"; `transcript-display-candidates.spec.ts` | VERIFIED |
| R2.9 Reload and remount | DS "R2.9: the same candidates rebuild an equal panel"; AGS "rebuilds tree-backed values on reload" | VERIFIED |
| R2.10 Copy and storage hold the raw fence only | `message-sender.host-data.spec.ts` and `sdk-query-options-builder.host-data.spec.ts` sentinel cases (Task 29.2); display-chip spec "renders the raw fence as plain markdown ..." | VERIFIED |
| R2.11 Rendering scope | `transcript-display-candidates.spec.ts`; `ptah-ui-fence-line.spec.ts` | VERIFIED |
| R2.12 View actions only | `trust-boundary.spec.ts` "submit — R4.2", "submit produces NOTHING either"; Phase 3 review | VERIFIED |

### R3 Layout grammar

| Req | Evidence | Status |
| --- | -------- | ------ |
| R3.1 Backward compatibility (610 corpus) | `ptah-ui-converter.spec.ts`; Task 6.2 corpus deep-equal; Phase 1 accepted | VERIFIED |
| R3.2 Container mapping | `ptah-ui-converter.spec.ts` | VERIFIED |
| R3.3 Nesting limits reuse catalog budgets | `ptah-ui-parser.spec.ts` "catalog limits (R3.3)"; `ptah-ui-pipeline.spec.ts`; `ptah-ui-compactness.spec.ts` | VERIFIED |
| R3.4 Parser fixtures | `ptah-ui-parser.spec.ts` "parsePtahUi R3 nesting delta" (nesting, grid 0 rejected, max grid columns accepted, ...) | VERIFIED |
| R3.5 Responsive by container width | `dd/.../surface-container-width.spec.ts`, `surface-layout.component.spec.ts`; TSC "1 column at 300 px, 2 from 400 px, 3 from 700 px" | NOT VERIFIED (rendered): panel at 300 and 960 px against the prototype (#155(b), #158, #160) |

### R4 Atoms and `dashboard-catalog/4`

| Req | Evidence | Status |
| --- | -------- | ------ |
| R4.1 Catalog bump | `surface-validator.spec.ts` (`/3` rejects `/4` features); `tools/list` Apps delta 0 (measurement.md section 4) | VERIFIED |
| R4.2 Semantic only | `surface-validator.spec.ts` | VERIFIED |
| R4.3 Trend pill | `dashboard-stat.component.spec.ts` | NOT VERIFIED (rendered): atoms (#155(b), #158, #160) |
| R4.4 Sparkline | `dashboard-stat.component.spec.ts` | NOT VERIFIED (rendered): atoms (#155(b), #158, #160) |
| R4.5 Avatar | `dashboard-avatar.component.spec.ts` "shows initials in a decorative disc ..." | NOT VERIFIED (rendered): atoms (#155(b), #158, #160) |
| R4.6 Accordion | `surface-layout.component.spec.ts`; DS R2.4 accordion case | NOT VERIFIED (rendered): atoms (#155(b), #158, #160) |
| R4.7 Plain text | `trust-boundary.spec.ts`; `dashboard-avatar.component.spec.ts` | VERIFIED |
| R4.8 Inline parity | `dashboard-avatar.component.spec.ts` (R4.8) | NOT VERIFIED (rendered): inline versus panel side by side (#155(b), #158, #160) |

### R5 `$agents` host source

| Req | Evidence | Status |
| --- | -------- | ------ |
| R5.1 Allowed fields only | AGS; `cui/.../ptah-ui-agents.source.spec.ts`; `transcript-agent-facts.spec.ts` | VERIFIED |
| R5.2 Status vocabulary | AGS | VERIFIED |
| R5.3 Unavailable, never zero | AGS | VERIFIED |
| R5.4 Live values | `ptah-ui-agents.source.spec.ts` | NOT VERIFIED (rendered): populated `$agents` (#155(b), #158, #160) |
| R5.5 Turn scope | AGS | VERIFIED |
| R5.6 Reload | AGS "rebuilds tree-backed values on reload; R-only and lane usage read unavailable" | VERIFIED |
| R5.7 Grammar | `ptah-ui-parser.spec.ts` "parses $agents and $limits row sources and scalars" | VERIFIED |
| R5.8 No write-back | `message-sender.host-data.spec.ts` "keeps $agents names and costs ... out of params and stored text (R5.8, R10.5)"; `sdk-query-options-builder.host-data.spec.ts` | VERIFIED |
| R5.9 One row per agent | AGS; `transcript-agent-facts.spec.ts` | VERIFIED |
| R5.10 `context` field | AGS (CLI lanes read "unavailable"; follow-up #161(7)) | VERIFIED |
| R5.11 Session scope | AGS; `ptah-ui-parser.spec.ts` "parses the session scope after $agents only" | VERIFIED |
| R5.12 `context` fixtures | AGS | VERIFIED |
| R5.13 Session-scope fixtures | AGS | VERIFIED |

### R6 Turn summary

| Req | Evidence | Status |
| --- | -------- | ------ |
| R6.1 Cards with `$diff`/`$tests`/`$usage` values | TSM "values equal the $diff / $tests / $usage resolution (R6.1)"; TSC "renders the model cards in order" | NOT VERIFIED (rendered): live summary card (#155(b), #158, #160) |
| R6.2 Parity | Section 3 of this report (row by row: PASS) | VERIFIED |
| R6.3 States carry through | TSM, TSC (counts unavailable, baselineMissing, incomplete, background) | VERIFIED BY SPEC ONLY |
| R6.4 Nothing to report | TSM "nothing to report (R6.4)"; TSC; CHIP; CTD "mounts no chip for a turn without files or tests" | VERIFIED |
| R6.5 Chip in chat | CHIP "collapsed line (R6.5, R6.10)"; CTD; chip rendered collapsed and expanded at 360 and 1024, dark and light, from real sessions (VR Group 4, VR33F rows 5-7) | VERIFIED |
| R6.6 Which turn | CTD "binds Open in panel to the dock and publishes the summaries in turn order"; CTD Electron chip case on finalized stored messages (reload shape) | VERIFIED BY SPEC ONLY |
| R6.7 Built at turn end, no model call | TSM "is null before the turn is terminal"; host-data sentinels; summary-only sentinel deviation ruled in #137 | VERIFIED (deviation #137) |
| R6.8 Actions | TSM; TSC "row actions open the file and Review all reviews the set (R6.8)", "rejected action ... role=alert" | VERIFIED BY SPEC ONLY |
| R6.9 One file listing per turn | CHIP "never lists files, even expanded (R6.9)"; CTD | VERIFIED |
| R6.10 Tests row moves (Electron) | CTD "Electron: replaces the change-set card and tests row with the chip"; CHIP outcome words; rendered chip shows "1 test passed" (VR33F N2) | VERIFIED |

### R7 Command and file previews (both webviews)

| Req | Evidence | Status |
| --- | -------- | ------ |
| R7.1 Parity | `tool-call-header.component.spec.ts`; Phase 6 review items 9-10 (rows 120-136 PASS) | VERIFIED |
| R7.2 Command preview | `tool-input-display.component.spec.ts`; VR Group 4 (expanded Bash, command wraps) | VERIFIED |
| R7.3 Command outcome | `tool-call-header.component.spec.ts`; VR Group 1 and 4 | VERIFIED |
| R7.4 Command output | `code-output.component.spec.ts`; VR Group 4 (299 real blocks, no overflow) | VERIFIED (synthetic CJK, short-line and markdown inputs deferred: #154(c), #161(6)) |
| R7.5 File preview header | `tool-call-header.component.spec.ts`, `code-output.component.spec.ts`; VR Group 1 (path one line plus title) | VERIFIED (path-link wrap: #128, #161(3)) |
| R7.6 Edit diff | `diff-display.component.spec.ts` "shows removed and added counts ...", "captions the gutter as snippet lines ..."; VR Group 4 | VERIFIED (deviation #127, #132: snippet-relative gutter) |
| R7.7 Write preview | `tool-input-display.component.spec.ts`; VR Group 4 | VERIFIED (deviation #127: no new-versus-overwrite flag) |
| R7.8 Visual conformance to the Gate 1.7 spec | Electron: VR Groups 1 and 4 against the prototype. VS Code: not rendered | VERIFIED for Electron; VS Code DEFERRED by #154(c) (host-branch specs only) |
| R7.9 Collapsed-row height baseline | VR Group 1: every collapsed toggle row is 31.6 px or less (at most 36), and the Bash card is 76 px against the prototype's 86 | VERIFIED against the prototype; merge-base comparison DEFERRED by #17 |
| R7.10 Runtime: both webviews | `describe.each([true, false])` host specs (Phase 6 review item 9); no preview path gates on `isElectron` | VERIFIED BY SPEC ONLY (rendered VS Code DEFERRED by #154(c)) |

### R8 Hint, skill and authoring cost

| Req | Evidence | Status |
| --- | -------- | ------ |
| R8.1 Hint of 100 tokens or less | `ptah-ui-hint.spec.ts` "stays within the 100-token budget"; measurement.md section 1 (87 tokens) | VERIFIED (no example fence: #136) |
| R8.2 No other prompt text | `ptah-ui-hint.spec.ts` "points to the on-demand skill without advertising deferred elements", "keeps the session scope and row fields in the skill only"; `tools/list` byte-identical (measurement.md section 4) | VERIFIED |
| R8.3 Skill | Batch 30 `d7a69fbd0` (asset and `.claude/skills` mirror); `content-manifest.json` regenerated (Batch 31); `surface-catalog-reference.spec.ts` 4/4 | VERIFIED |
| R8.4 Corpus and compactness | `ptah-ui-compactness.spec.ts`; measurement.md section 2 | VERIFIED |
| R8.5 Fence versus markdown for subagent usage | `mac/ptah-ui-agents-compactness.spec.ts`; measurement.md section 3 | VERIFIED |

### R9 Collapsible and responsive chips and cards

| Req | Evidence | Status |
| --- | -------- | ------ |
| R9.1 Collapsible | Display-chip spec (R9.1, R9.2, R9.4); CHIP and TSC "collapse (R9)"; `tool-call-item.component.spec.ts`; chip rendered (VR Group 4) | VERIFIED for the chip and previews; summary cards and display chip NOT VERIFIED (rendered) (#155(b), #158, #160) |
| R9.2 Collapsed state | Display-chip spec; chip toggle 36 px (VR Group 4) | VERIFIED for the summary chip; display chip NOT VERIFIED (rendered) |
| R9.3 Expanded state | CHIP "expanded body"; expanded chip at 360 and 1024 (VR33F rows 5-7) | VERIFIED for the summary chip; summary cards NOT VERIFIED (rendered) |
| R9.4 Default states | Display-chip spec; `surface-layout.component.spec.ts`; CHIP and TSC "starts collapsed" | VERIFIED BY SPEC ONLY |
| R9.5 No overflow at named breakpoints | `diff-display`, `tool-input-display`, `tool-output-display` and display-chip specs; previews and chip clean at 360 and 1024 (VR Group 4, VR33F rows 5-6, after the D2 fix) | VERIFIED for `chat-narrow`/`chat-wide`; `panel-narrow`/`panel-wide` (300/960) NOT VERIFIED (rendered) (#155(b), #158, #160) |
| R9.6 Layout adapts | TSC "1 column at 300 px, 2 from 400 px, 3 from 700 px" | NOT VERIFIED (rendered) (#155(b), #158, #160) |

### R10 `$limits` host source (Electron)

| Req | Evidence | Status |
| --- | -------- | ------ |
| R10.1 Host read | `lane-plan-limits-rpc.handlers.spec.ts`, `rpc-lane-plan-limits.contract.spec.ts`; `ptah-ui-lane-limits.source.spec.ts` "makes no call without an acquire"; Phase 2 APPROVED 9/10 | VERIFIED |
| R10.2 Same text as the list | `agent-limit.formatter.spec.ts` (byte-identical, Task 8.1) | VERIFIED |
| R10.3 Unknown, never zero | `rpc-lane-plan-limits.contract.spec.ts` | VERIFIED |
| R10.4 Privacy | Handler, contract and source specs (recording proxy: no `refresh`, no spawn); `cli-agent-runtime` lookup case (Batch 10) | VERIFIED |
| R10.5 No write-back | `message-sender.host-data.spec.ts` (R5.8, R10.5); `sdk-query-options-builder.host-data.spec.ts` | VERIFIED |
| R10.6 Freshness and scope | `ptah-ui-lane-limits.source.spec.ts` "re-reads once per snapshot change while acquired ...", "is single-flight ...", "shares one call ..." | VERIFIED |
| R10.7 Failure | `ptah-ui-lane-limits.source.spec.ts` `describe('failure')`; handler fixed-text boundary (12F, 12F2) | VERIFIED |
| R10.8 Grammar | `ptah-ui-parser.spec.ts` "parses $agents and $limits ...", "rejects an unknown $limits column" | VERIFIED |
| R10.9 Electron only | `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts` and `cli-engine/.../rpc-surface.spec.ts` (expected-absent); CTD "VS Code renders a $limits fence as an ordinary code block" | VERIFIED |
| R10.10 Fixtures | `rpc-lane-plan-limits.contract.spec.ts`; `ptah-ui-resolver.spec.ts` | VERIFIED |

### Non-functional requirements

| NFR | Evidence | Status |
| --- | -------- | ------ |
| Lazy loading (610 5.1, 5.2, 5.9) | `scripts/eager-closure-gate.js` plus `apps/ptah-electron/src/config/eager-closure-gate.spec.ts` (23/23); real production build: gate PASS, 781 eager inputs, run twice (measurement.md section 5, #157); added eager bytes named (15,268 B) | VERIFIED; byte growth against the merge base DEFERRED by #17 (single build) |
| Performance | Live cap: DS R1.12 cases; R2.4 view-state case; R2.7 no re-apply (DS, DSS) | VERIFIED |
| Context budget | `tools/list` byte-identical on both hosts and both profiles; Apps delta 0 (measurement.md section 4); hint 87 tokens (section 1); sentinels R5.8, R10.5 (host-data specs); R6.7 sentinel deviation #137 | VERIFIED |
| Security | Validator is the only trust boundary: `trust-boundary.spec.ts`; 15F renderer guard fails closed; Phase 3 APPROVED 8/10. No new RPC except the read-only R10.1 (Phase 2); privacy sentinels | VERIFIED |
| Accessibility: axe zero serious or critical | Chat transcripts and dock: 0 serious or critical at spec widths (VR Group 5); dock 0 violations (VR33F row 11); axe cases in TSC and CHIP. Moderate `landmark-unique` findings go to follow-up #161(2) (#151, #159(a)) | VERIFIED for the chip, previews and dock; populated panel and overlay fixtures NOT VERIFIED (rendered) (#155(b), #158, #160) |
| Accessibility: keyboard, no focus move on auto-open, text for state | Dock tab keyboard and focus (VR33F rows 8-10); CHIP and TSC Escape and focus; DSS (auto-open never focuses) | VERIFIED for the dock and chip; panel controls with surfaces VERIFIED BY SPEC ONLY |
| Themes | Dark and light screenshots: chip, previews, dock (`visual-review/`, 64 files) | VERIFIED for those; populated panel surfaces NOT VERIFIED (rendered) (#155(b), #158, #160) |
| Responsive | See R3.5, R9.5 and R9.6 | Partially NOT VERIFIED (rendered) (#155(b), #158, #160) |
| Compatibility | VS Code: only R7 previews, skill assets and the expected-absent RPC list change (CTD VS Code cases; `chat-transcript.change-set.spec.ts`); no CSP or TUI file in the diff. `/3` and the Apps page: `surface-validator.spec.ts`, Apps `tools/list` delta 0 | VERIFIED |
| Tests (touched projects pass) | Every batch ran its scoped Jest, typecheck and lint before commit (team-leader acceptance rows in decisions.md, for example #80, #90 and #156); not re-run in Mode 3 (CLAUDE.md) | VERIFIED (per batch) |

### What the table shows

No criterion lacks both evidence and a decision, so the table exposes no new gap.

Every NOT VERIFIED (rendered) row falls in the populated-surface gap that the user ruled on (#155(b), with #158 and
#160). Each of those rows is still pinned by at least one spec.

The rows marked DEFERRED each cite a recorded decision: #17, #127, #128, #132, #136, #137 and #154(c).

## 3. Parity verification (parity-inventory.md rev 2)

First, the inventory was compared with the OLD surface at `70f995a56`. The inventory names every input and output
of the base components:

- change-set card inputs `changeSet`, `host`, `reconciled` and `conflicted`, and outputs `review`, `openFile` and
  `openScm`;
- tests-row inputs `runs` and `incomplete`;
- the transcript handlers `onChangeSetReview`, `onChangeSetOpenFile` and `onChangeSetOpenScm`.

The comparison found no unlisted capability. No row is `remove-proposed`. The two placement moves are user-approved:
#5 (change-set card, Electron only) and #10 (tests row).

| Section | Rows | Result | Evidence |
| ------- | ---- | ------ | -------- |
| 1 Tests row | 13 | All `keep`/`move` rows present with specs | `test-command-matcher.ts` and `turn-tests.utils.ts` are unchanged from base. The ported cases are in `turn-summary.model.spec.ts` ("Tests card (ported from turn-tests-row.component.spec.ts)": counts, all-unknown, background, run label, full command, failure lines, incomplete), `turn-summary.component.spec.ts` ("Tests detail (parity section 1)", plus the axe case with mixed and incomplete runs) and `turn-summary-chip.component.spec.ts` (outcome words, incomplete, region ids). `chat-transcript.display.spec.ts` covers "Electron: replaces the change-set card and tests row with the chip" (no `chat-turn-tests`, no `chat-change-set`) and "VS Code: keeps the card, with no chip, no tests row and no sync". The lazy chunk is in the eager-gate PASS. `turn-tests-row.component.ts` and its spec were deleted only after the ports existed (risk mitigation, Task 24.2). |
| 2 Change-set card | 21 | All rows present: Electron moved, VS Code kept | `change-set-card.component.ts`, `change-set.store.ts` and `change-set-actions.service.ts` are unchanged from base. In the transcript, `@if (display.enabled)` (= `isElectron`, `chat-transcript.component.ts:625`) shows the chip, and `@else` keeps `ptah-change-set-card` with `host="vscode"` and the review, openFile and openScm handlers. Specs in `turn-summary.component.spec.ts` "Files detail (parity section 2)": status badge name, rename origin, binary / `?` / `+0 −0`, conflicted `U` plus Resolve, reconciled group, counts unavailable, baselineMissing, truncatedCount, 50-row paging, Review all and openFile, `role="alert"` on rejection, conflict forces open, 1/2/3 columns at 300/400/700 px. `chat-transcript.change-set.spec.ts` keeps the VS Code card cases. The "accent border" row (visual) is in the populated-surface gap (#161(1)). |
| 3 Footer badges | 5 | `keep`: unchanged | `message-bubble.component.html`, `cost-badge.component.ts` and `duration-badge.component.ts` are unchanged from base. The Cost card keeps the null-is-"unavailable" rule (`turn-summary.component.spec.ts` "keeps cost unavailable, never $0"). |
| 4 Previews (both webviews) | 21 | All `keep` rows present | `code-logic-review-phase6.md` item 10 PASSes rows 120-136, and item 9 PASSes host parity (`describe.each([true, false])`). No preview path gates on `isElectron`. `batch-28-report.md` and the reviewer both found no row dropped. The rendered pass covered real Bash, Read, Write and Edit cards in `visual-review.md` Group 4. |

**Parity verdict: PASS.** No capability was dropped without approval. The VS Code path is unchanged: the card,
badges and template branch are kept.

- `chat-view.component.spec.ts` only gained one case, the #121(b) Escape guard (Task 27.3). No VS Code case was
  removed.
- `chat-transcript.change-set.spec.ts` keeps its three VS Code card cases. It lost only the Electron tests-row cases.
  Their successors are in `chat-transcript.display.spec.ts`:
  - The old "renders the tests row after a reload" case is carried by the Electron chip case. That case mounts a
    non-streaming tab built from finalized stored messages, the same shape the replayer produces after a reload.
  - The tree-backed source values also have a reload case: `ptah-ui-agents-source.spec.ts` "rebuilds tree-backed
    values on reload".

## 4. Accepted deviations (recorded decisions)

- **#136:** the hint carries no full example fence, because of the R8.1 100-token cap. All worked examples are in the
  skill.
- **#17, #143:** single build only. The merge-base eager growth check did not run. Added eager inputs are listed by
  name and bytes instead.
- **#148:** `copy-text-button.component.ts` (1,758 B) and `tool-language.utils.ts` (1,327 B) are on the allow-list
  as eager growth.
- **#122-#128, #131, #132:** R7 header and preview details:
  - The collapsed Bash command row stays.
  - The diff gutter counts lines within the snippet; there is no "Lines 41-46".
  - The Write meta reads "N lines", with no new-versus-overwrite flag.
  - Prism diff colouring is replaced by a row tint.
- **#152:** the Displays empty-state copy follows design-spec.md:61 ("Nothing to show yet"), not the prototype PNG
  ("No displays yet"). **The user may override this at Gate 3.**
- **#154(c):** not exercised, accepted:
  - merge-base heights;
  - synthetic CJK, short-line and markdown code-output inputs;
  - the rendered VS Code R7.8 and R7.10 (host-branch specs cover them);
  - a real-window resize (the cloned-node method was used instead).
- **#159(b), #151:** pre-existing findings, outside this task:
  - axe `scrollable-region-focusable` on `.ptah-markdown-root` (`libs/frontend/markdown` is unchanged);
  - chat-view `heading-order`.
- **#156:** pre-existing Prettier drift in `display-dock.component.ts` and its spec is left alone.

## 5. Populated-surface gap: NOT verified

Mode 3 completion check 2 requires rendered evidence against `prototype/`. That evidence exists for:

- the dock with empty states and tabs;
- the chip, collapsed and expanded;
- the tool previews.

It does **not** exist for these items, because the provider could not produce a new turn:

- the live turn summary card;
- the dock with surfaces;
- the display strip pills;
- the expanded display chip;
- populated `$agents`;
- the atoms;
- the panel at 300 and 960 px against `prototype/screenshots/`;
- the real `pending` chip word;
- a real numeric Tokens, Cost or Time tile;
- the `dp-tabpanel` `[hidden]` behaviour.

Coverage for these items:

- **USER #155(b):** Gate 3 proceeds without these checks, and they become a named follow-up.
- **#158:** the cause changed. The first run hit HTTP 429. At the 33F re-check the app reported "No Anthropic API key
  configured" (`visual-review/33F-turn-attempt.png`). #155(b) still applies because its intent was "the provider
  cannot produce a turn here". **The user should know the cause is now a missing key, not a rate limit. Configuring
  a key would allow the follow-up check before merge.**
- **#160:** Phase 8 is accepted on that basis.

The code-side mitigations are specs, not sight:

- `MINI_WORD_CLASS` and `MINI_VALUE_CLASS` are pinned by the 33F.2 spec ("sets pending values as words too",
  "keeps ? as a number-style value").
- The Mode 3 on-disk check confirms that `dp-tabpanel` carries no display utility
  (`display-panel.component.ts:210-213`: `class="dp-tabpanel min-w-0 rounded-box"`). Tailwind's `[hidden]` rule
  therefore applies, unlike the D1 dock case.

## 6. Follow-up tasks (decision #161)

None of these blocks Gate 3.

1. Populated surfaces and the panel at 300 and 960 px against the prototype, in dark and light.
   - Covers: the live summary card, the dock with surfaces, the strip pills, the expanded display chip, `$agents`,
     the atoms, the real `pending` word, a numeric Tokens/Cost/Time tile, and `dp-tabpanel` `[hidden]`.
   - Precondition: a configured provider (an API key, or the Claude CLI).
2. Accessibility landmarks:
   - a unique code-output region label (#151);
   - the turn summary chip `landmark-unique` (#159(a)).
3. Wrapping in the shared `ptah-file-path-link` (design-spec.md:140 asks for wrapping; the atom uses `truncate`,
   #128).
4. Move the `chat-view.component.ts` dock wiring into a `chat-view-dock.ts` helper (#113(a), #133(b)).
5. Closed chat tabs keep their `tabs` and `seen` entries in `display-dock.state.ts` (#115, Minor).
6. Width-aware code-output row estimate. Conditional: the synthetic inputs were not exercised (#121(a), #154(c)).
7. CLI adapter context reporting, so CLI lanes show a real `context` (#16, #28).
8. Item counts and totals on the expanded display chip. Needs a status field and a design call first (#63).
9. A file-relative Edit range and a Write new-versus-overwrite flag. Both need a new data source (#127, #132).

Recorded for other owners, not follow-ups of this task:

- markdown `scrollable-region-focusable` (#159(b));
- chat-view `heading-order` (#151);
- the optional `$tasks` source (#65).

## 7. Open risks

| Risk (batches.md plan validation) | Resolution |
| --------------------------------- | ---------- |
| V1 launch prerequisites beyond #17 | USER #116 approved `build-dev`, and #155(a) approved the 33F rebuild and relaunch; executed (#157). |
| No merge-base `stats.json` | Growth check not run (single build, #17); added eager inputs listed (measurement.md section 5). Accepted. |
| Intermediate L1-L5 commits red across projects | Batches 7-12 ran back to back; Phase 2 accepted (`code-logic-review-phase2-fix2.md`). |
| `/3` regression from `/4` | Task 1.2 and the Task 6.2 corpus; `tools/list` Apps delta is 0 (measurement.md section 4); Phases 1 and 3 accepted. |
| Parser rewrite breaks 610 fences | Task 3.2 kept all parser cases; Task 6.2 corpus; Phase 1 accepted. |
| `$limits` privacy and side effects | Tasks 7.1, 9.1 and 10.1, plus the 12F/12F2 boundary fixes; Phase 2 APPROVED 9/10. |
| Formatter drift | Task 8.1 byte-identical snapshot; `tools/list` byte-identical. |
| Eager bundle growth | Gate PASS on the real build (781 inputs, twice); #148 allow-list. |
| Parity loss when the tests row and card leave chat | Section 3 above: PASS. |
| Auto-open re-trigger | Tasks 20.2 and 23.1 store specs; Phases 4 and 5 accepted. |
| Shared-file sequencing | Sequential execution; no conflicts. |
| R7 host branching | `describe.each([true, false])` specs (Phase 6 item 9). Rendered VS Code R7.8 and R7.10 not exercised; accepted (#154(c)). |

**Residual risks carried to Gate 3:**

1. The populated surfaces have never been rendered (section 5). The highest-value residual is the panel layout at
   300 and 960 px against the prototype.
2. Two Moderate a11y `landmark-unique` findings (follow-up 2).
3. No growth comparison against the merge base exists, only an absolute gate PASS.

## 8. Gate 3: decision for the user

**Decision:** accept TASK_2026_623 as complete, with the notes above.

- **If accepted (per USER #147):** the orchestrator pushes `feat/task-623-display-panel` to origin and opens a PR
  against `main` with `## Summary` and `## Test plan`. **No merge.** The nine follow-ups in section 6 become named
  tasks.
- **Points the user should weigh before accepting:**
  1. **Populated display surfaces are not visually verified** (#155(b), #158, #160). The blocker is now "No Anthropic
     API key configured", no longer HTTP 429. The user can either:
     - (a) accept now and run follow-up 1 later; or
     - (b) configure a key or the Claude CLI first and run follow-up 1 before the PR is merged.
  2. **Displays empty-state copy:** "Nothing to show yet" (the spec) versus "No displays yet" (the prototype). Kept
     as the spec (#152); the user may override.
- **If not accepted:** name the item. The orchestrator opens a fix batch, or runs follow-up 1, before the push.
