# PR #582 CodeRabbit fixes: cross-side review

## Verdict: REVISE

All 22 inline comments and the outside-diff note are resolved or validly deferred. Mirrors, TOML parsing, the manifest check and the tests pass. The fixes did leave 15 follow-on defects. Most are cross-file contradictions between the rewritten rules and text the lanes did not touch. None is a regression in shipped code, but D1, D3 and D4 leave routing paths with no valid next step.

## Review state

| Field | Value |
| --- | --- |
| Authors | Lane A: codex. Lane B: opencode/kimi-k3. Lane C: codex. Plus orchestrator corrections: team-leader `task-description.md` changed to `task.md`, TASK_2026_535 §E root cause, and the §E quota edit made during review. |
| Reviewer | In-process subagent (opposite side from the CLI lanes) |
| Reviewed revision | Current working tree of `docs/skills-design-gate-parity` (uncommitted diff on `d398a9561`), including the orchestrator's later TASK_2026_535 §E and Acceptance edit |
| Completed revise rounds | 0 |

`P` = `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills`. `TL` = `libs/backend/agent-generation/templates/agents/team-leader.template.md`. `PM` = `libs/backend/agent-generation/templates/agents/project-manager.template.md`.

## Mechanical checks

| Check | Result |
| --- | --- |
| `diff -rq` of `P/{agent-lanes,orchestration,ui-ux-designer}` against `.claude/skills/*`, ignoring files that exist only in `.claude` | Identical |
| PM and TL template additions present in `.claude/agents/*.md`, `.opencode/agent/*.md` and `.codex/agents/*.toml` | All 4 PM and 22 TL added lines present in all three places. One exception is escaping in `.codex/agents/team-leader.toml` (D11). |
| Every `.codex/agents/*.toml` parses with Python `tomllib` | 15/15 OK |
| `npm run -s manifest:check` | `content-manifest.json is up to date (sha256:19e57de5…, 225 files)` |
| CR bytes in the 28 changed files and 3 lane reports | None |
| `npx nx test agent-generation --skip-nx-cache` (tail) | `Successfully ran target test for project @ptah-extension/agent-generation` (29.2 s, exit 0) |

## Comment status

| Comment id | Status | Evidence (plugin source or template) |
| --- | --- | --- |
| 4085139975 + outside-diff note (agent-lanes SKILL.md:75-77) | Resolved | `P/agent-lanes/SKILL.md:151` now accepts "the supplied preserve list or `parity-inventory.md` item by item" and requires explicit user approval for proposed removals. §3 item 9 (`:75-77`) is unchanged and consistent. See D9 for the remaining wording nit. |
| 4085139986 | Resolved | `P/orchestration/references/agent-catalog.md:71-74` gives two absolute paths (`design-spec.md`, `prototype/`), requires both on disk and a `WROTE:` line for each. This matches `libs/.../ui-ux-designer.template.md:114` ("One `WROTE:` line per file"). |
| 4085139998 | Resolved | `P/orchestration/references/task-tracking.md:147` routes by the type/strategy recorded in `context.md`: CREATIVE goes to the content writer, BUGFIX to team-leader Mode 1, and flows with architecture to the architect. Follow-on: D3. |
| 4085140006 | Resolved (follow-on D1, D2) | `P/orchestration/SKILL.md:42`: any flow that adds or redesigns UI inserts designer → prototype → cross-side review → Gate 1.7. |
| 4085140008 | Resolved | `P/ui-ux-designer/DEVELOPER-HANDOFF.md:353-365`: inspecting the prototype stays under "Before implementation"; the parity check moved to "After implementation". |
| 4085140019 | Resolved (follow-on D6, D7) | `P/ui-ux-designer/PROTOTYPING.md:19` (`assets/`), `:28` (offline rule; a CDN is a disclosed fallback) and `:43-50` (local `assets/tailwind-daisyui.css`; CDN tags commented out). |
| 4085140029 | Resolved (follow-on D8) | `PROTOTYPING.md:204` (narrow = actual narrow viewport) and `:206` (separate embedded-width check). Also `:91`, `:165-166`, `:227-232`, `:262`, `:265`. |
| 4085140044 | Resolved | `PROTOTYPING.md:235` adds `screenshots/dark-loading.png`. |
| 4085140051 | Resolved | `.ptah/specs/TASK_2026_535/task.md`: every heading (`:11,25,27,43,61,73,85,114,118,135`) is followed by a blank line. |
| 4085140058 | Resolved | `TASK_2026_535/task.md:64-70`: only discovered ids are used. `modelTier` requires a listed ptah-cli mapping. When no listed id fits, the lane uses its configured default (disclosed) or another lane, and never invents an id. |
| 4085140069 | Resolved | `TASK_2026_535/task.md:48` defines a `role-conflict` verdict distinct from `no-deliverable`, `:82-83` excludes it from failure counts, and `:125-126` adds an acceptance case. The name differs from CodeRabbit's `deliverable-conflict`, which is acceptable. Follow-on: D13. |
| 4085140106 | Resolved | `TASK_2026_537/task.md:55-57`: a null flag never counts as false; `mustAskUser` or a conservative gate applies. A null `replacesExistingSurface` requires the inventory and Gate 1.7. Acceptance at `:83-84`. |
| 4085140115 | Resolved | `TASK_2026_537/task.md:58` has disjoint bands (`c ≥ 0.9`, `0.5 ≤ c < 0.9`, `c < 0.5`). Boundary acceptance at `:85`. |
| 4085140124 | Resolved (follow-on D14) | `TASK_2026_537/task.md:64-70`: disjoint training, calibration and holdout sets; task-grouped splits; a versioned manifest; TASK_2026_523 is excluded from training. Acceptance at `:80-82`. |
| 4085140131 | Resolved | `TASK_2026_537/task.md:47-48` rejects cross-origin redirects and never sends the key to another host. Acceptance at `:87-88`. |
| 4085140148 | Validly deferred to PR #581 | `TASK_2026_538/task.md:18-21`, `:37-38`. Verified: `gh pr view 581` is OPEN on `fix/providers-runtime-regressions`, and its diff replaces `{ params }` with `{ fields: Object.keys(params ?? {}) }` and asserts the exact call in a spec. `depends_on: [TASK_2026_534]` points to a task that exists on that branch (`.ptah/specs/TASK_2026_534`). |
| 4085140162 | Resolved | `TASK_2026_538/task.md:23` and `:41` are followed by a blank line. |
| 4085140167 | Resolved | `TASK_2026_538/task.md:30-34` names the three runtimes (VS Code extension, Electron, headless CLI); each registers the migration in its own composition root, and the migration is idempotent. Acceptance at `:38-39`. |
| 4085140176 | Resolved | `PM:110-112` and `:192` name replace, consolidate, rebuild and redesign. This matches the method at `:100-106` and the refusal at `:238`. Mirrors verified. |
| 4085140180 | Resolved (follow-on D9) | `TL:297-303`: the parity check decides applicability first, and a missing inventory is a blocker. `:367-370`: "N/A" is allowed only when no surface changed. Also `:70` and `:433-435`. Mirrors verified. |
| 4085420540 | Resolved (follow-on D3, D4) | `P/orchestration/references/team-leader-modes.md:14`, `:41-43` and `TL:64-68`, `:93-94` all say BUGFIX is plan-free and decomposes from `task.md`, `context.md` and `research-report.md` when present. The orchestrator's `task.md` correction is present in the template and all three mirrors. |
| 4085420546 | Resolved | `team-leader-modes.md:58`: the required `code-logic-review.md` (reused when eligible) plus any extra named reviewer, each passed to Mode 2 with its actual report path and verdict. |
| 4085420552 | Resolved (follow-on D10) | `P/orchestration/references/checkpoints.md:219`, `:343`, `:418` show the recorded reason (user pin, lanes disabled at Gate 0.1, or opposite side unavailable). This matches `P/agent-lanes/SKILL.md:160-161`. |

## Defects

1. **D1 (Moderate, lane A): the new UI rule leaves `parity-inventory.md` without an owner in BUGFIX and REFACTORING.**
   - **Problem.** `P/orchestration/SKILL.md:42` inserts the designer before the architect/team-leader step in every flow. But `SKILL.md:50-52` and `agent-catalog.md:95-96` say the PM ("or architect when no PM") writes the inventory from the old code *before design starts*. In REFACTORING the architect now runs after the designer, and BUGFIX has neither a PM nor an architect. A redesign routed through these flows therefore reaches the designer and Gate 1.7 with no inventory.
   - **Fix.** Append to `SKILL.md:42`: "When the flow has no PM ahead of the designer (BUGFIX, REFACTORING) and the surface is replaced or redesigned, invoke project-manager first to write `parity-inventory.md` from the old code." Change `agent-catalog.md:95` from "PM (architect when no PM)" to "PM (in flows without a PM, a project-manager invoked for the inventory alone)". Mirror both to `.claude`.

2. **D2 (Minor, lane A): Gate 1.7 "next step" text still names only the architect or the creative phase.**
   - **Problem.** `SKILL.md:64` says "before architect". `checkpoints.md:304-305` says "before the architect (or the next creative phase)". `checkpoints.md:354` says "proceed to architect or the next creative phase". `agent-catalog.md:93-94` says "FEATURE UI and CREATIVE design flow through … before the architect or next creative phase". All of these contradict `task-tracking.md:147` (BUGFIX goes to team-leader Mode 1) and `SKILL.md:42` (any flow).
   - **Fix.**
     - At `SKILL.md:64` and `checkpoints.md:304`, use "before the flow's next phase (architect, team-leader Mode 1 for BUGFIX, or the next creative phase)".
     - At `checkpoints.md:354`, use "proceed to the next phase of the recorded flow".
     - At `agent-catalog.md:93`, use "Any flow that adds or redesigns UI (SKILL.md flow rule) goes through designer → prototype → Gate 1.7 before its next phase".

3. **D3 (Moderate, lane A; the gap predates this PR, but the new plan-free rule now contradicts it directly): continuation sends a plan-free BUGFIX to the project-manager.**
   - **Problem.** A BUGFIX folder after init and research holds `task.md`, `context.md` and optionally `research-report.md`. `task-tracking.md:145` routes that to project-manager, and `research-report.md` has no row. This conflicts with `team-leader-modes.md:14` and `:41-42` (BUGFIX Mode 1 after init and research, plan-free).
   - **Fix.**
     - Change row `:145` to: "`task.md` / `context.md` only | per the strategy in `context.md`: BUGFIX → researcher-expert when research is planned, else team-leader Mode 1 (designer first when UI changes); REFACTORING → software-architect; otherwise project-manager".
     - Add the row "`research-report.md` (no later artifact) | per strategy: BUGFIX → team-leader Mode 1 (designer first when UI changes); FEATURE → designer when UI, else software-architect".

4. **D4 (Moderate; lane A for team-leader-modes.md, lane B for TL): the plan-free BUGFIX has no way out of a blocker.**
   - **Problem.**
     - `team-leader-modes.md:56` maps `DECOMPOSITION BLOCKED` to "Re-invoke software-architect … then Gate 2 again". `TL:113` ("ask for an architect revision"), `TL:341-344` ("invokes software-architect to revise implementation-plan.md") and `TL:430-432` say the same. A BUGFIX has no architect, plan or Gate 2.
     - `TL:95` ("every file the plan names") and `TL:99` ("Stress-test the plan") are undefined for BUGFIX.
   - **Fix.**
     - At `team-leader-modes.md:56`, add: "(BUGFIX, plan-free: present the numbered blockers to the user via Gate SR or re-run researcher-expert; invoke software-architect only if the user escalates to a planned flow)".
     - At `TL:113` and `TL:342-344`, add: "for a plan-free BUGFIX, return the blockers with evidence; the orchestrator resolves them with the user".
     - At `TL:95`, use "every file the plan (BUGFIX: `task.md` / `research-report.md`) names".
     - Regenerate or mirror to `.claude/agents`, `.codex/agents` (escaped) and `.opencode/agent`.

5. **D5 (Minor, lane B): ui-ux-designer `SKILL.md` contradicts the new PROTOTYPING rules.**
   - **Problem.** `P/ui-ux-designer/SKILL.md:134` says "CDN equivalent acceptable", but `PROTOTYPING.md:28` requires offline assets and allows a CDN only as a disclosed deviation. `SKILL.md:138` says "narrow width (≈400px sidebar)", which merges the two checks `PROTOTYPING.md:204-206` now separates. `SKILL.md:128-131` lists the deliverable without `assets/`.
   - **Fix.**
     - `:134`: "…from the project's configuration; copy the built CSS into `prototype/assets/` so the prototype works offline. A CDN build is a fallback disclosed in `README.md` (PROTOTYPING.md)."
     - `:138`: "…narrow width (actual ≈400px browser viewport), embedded sidebar width (container toggle), and wide width."
     - After `:130`, add a bullet: "`assets/`: local copies of the CSS/JS the prototype links."
     - Mirror to `.claude`.

6. **D6 (Minor, lane B): the README template has no place for the deviation it requires.**
   - **Problem.** `PROTOTYPING.md:28` and `:47` require naming a CDN fallback as a deviation in `README.md`. The template at `:245-290`, and the README description in the folder layout at `:20`, have no such section.
   - **Fix.** In the template after "How to Open", add:

     ```text
     ## Assets and deviations
     - Styling: `assets/tailwind-daisyui.css` (source: <project build path or generation command>)
     - Deviations: [CDN fallback used because …; or none]
     ```

     At `:20`, append "assets/deviations" to the README comment.

7. **D7 (Minor, lane B): the offline stylesheet may not contain the classes the prototype uses.**
   - **Problem.** `PROTOTYPING.md:28` and `:43-46` say to copy "the project's built CSS (or the daisyUI/Tailwind build)". The project's built CSS is purged down to the classes the app uses. Tailwind v3 ships no prebuilt full stylesheet. daisyUI's `full.min.css` has components but not Tailwind utilities, yet the skeleton relies on utilities (`flex`, `gap-2`, `px-4`, `space-y-6`, `text-xs`, `hidden`, at `:87-142`). A prototype can therefore lose styling silently offline, which is the failure the comment asked to prevent.
   - **Fix.** Replace the parenthetical at `:28` with: "Generate `assets/tailwind-daisyui.css` once at authoring time with the project's own Tailwind config and CLI, with `content` including `prototype/**/*.html` (viewing still needs no build), or copy the built CSS and inline any missing rules in the `<style>` block. Before capturing screenshots, confirm that no class the prototype uses is unstyled." Mirror the wording in the comment at `:43-45`.

8. **D8 (Minor, lane B): the narrow-viewport capture step cannot be done with the tools it names.**
   - **Problem.** `PROTOTYPING.md:227-229` says to "resize the window to ≈400px wide". There is no resize tool, and `ptah_browser_navigate`'s `viewport` takes effect only when a session is created (per the tool schema).
   - **Fix.** Replace with: "close the browser session (`ptah_browser_close`), then `ptah_browser_navigate({ url, viewport: { width: 400, height: 900 } })`; reopen at a wide viewport for the wide captures." Mirror to `.claude`.
   - **Related issue, older than this PR (log as a follow-up, not a blocker for this round).** `ptah_browser_navigate` accepts only http/https and blocks localhost by default. The `file:///…/prototype/index.html` URL at `:225` is therefore rejected, and the whole capture step needs a different serving method.

9. **D9 (Minor; lane A for agent-lanes, lane B for TL): the preserve-list alternative uses inconsistent vocabulary.**
   - **Problem.** `P/agent-lanes/SKILL.md:151` covers "Code that deletes or replaces a surface", but §3 item 9 (`:75`) also covers consolidation. `TL:298-302` accepts "the lane preserve list" but then checks "every capability marked `keep` or `move`". A preserve list marks items stays / moves / `## Proposed Removals`. `P/orchestration/SKILL.md:92` names only `parity-inventory.md`.
   - **Fix.**
     - `agent-lanes/SKILL.md:151`: "Code that deletes, replaces or consolidates a surface".
     - `TL:301-302`: "every capability marked `keep`/`move` (preserve list: stays/moves) exists …; every proposed removal has recorded user approval".
     - `orchestration/SKILL.md:92`: "…approved removal in `parity-inventory.md` or the lane preserve list".
     - Mirror the changes.

10. **D10 (Minor, lane A): the orchestration `SKILL.md` "Never" rule still uses the old same-side reason.**
    - **Problem.** `P/orchestration/SKILL.md:93-94` says "if no other side exists, say the review was same-side". That is the misstatement comment 4085420552 fixed in the three templates, and it contradicts `checkpoints.md:219/343/418` and `agent-lanes/SKILL.md:160-161`.
    - **Fix.** "…; a same-side review states its recorded reason (user pin, lanes disabled at Gate 0.1, or opposite side unavailable)." Mirror the change.

11. **D11 (Minor, orchestrator mirror): unescaped quotes in the Codex TOML mirror.**
    - **Problem.** `.codex/agents/team-leader.toml:274`, `:342`, `:344` contain `"N/A"` unescaped. The generator (`libs/backend/harness-sync/src/lib/targets/transformers/codex-agent-transformer.ts:38`) escapes every `"`, so this mirror is not what regeneration produces. It still parses, and the line it replaced at HEAD `:336` had the same drift.
    - **Fix.** Write `\"N/A\"` on those three lines.

12. **D12 (Minor, orchestrator edit): TASK_2026_535 §E adds a field the ledger schema does not have.**
    - **Problem.** `.ptah/specs/TASK_2026_535/task.md:109` (§E) and `:130` (Acceptance) introduce `failure_kind: quota`, but the §B `lane_runs` column list at `:45-53` has no `failure_kind`.
    - **Fix.** At `:49`, after `adapter_error (real message)`, add "`failure_kind` (`quota` | `task` | `adapter`; NULL when the run succeeded or the kind is unknown)".

13. **D13 (Minor, lane C): unclear whether a spawn-time conflict rejection produces a ledger row.**
    - **Problem.** `TASK_2026_535/task.md:82-83` says scorecards exclude `role-conflict` "including when the conflict is rejected at spawn time". But `:54` writes rows on spawn, and a rejected spawn has no agent or process, so it is unclear whether a row exists to exclude.
    - **Fix.** Either state "a spawn-time rejection writes a `lane_runs` row with `status: rejected`, `verdict: role-conflict` and NULL process fields", with a matching acceptance bullet at `:125`, or drop the spawn-time clause.

14. **D14 (Minor, lane C): TASK_2026_537 contradicts itself on training data.**
    - **Problem.** `.ptah/specs/TASK_2026_537/task.md:44-45` trains the local heads "on the TASK_2026_536 dataset and `.ptah/specs/**/task.md` history" (everything). `:64-69` limits fitting to the training split and excludes holdout examples.
    - **Fix.** At `:44-45`, use "…trained on the training split defined in item 5 (TASK_2026_536 dataset + `.ptah/specs/**/task.md` history)".

15. **D15 (Minor, lane C; the problem is older than this PR and CodeRabbit did not flag it): TASK_2026_537 has headings with no blank line after them.**
    - **Problem.** In `TASK_2026_537/task.md`, `## Principles` (`:18`), `## Research first (Gate before design)` (`:74`) and `## Acceptance` (`:79`) run straight into content (MD022).
    - **Fix.** Add a blank line after each.

## Cross-file consistency: what holds

- **BUGFIX plan-free rule.** `team-leader-modes.md:14`, `:41-43`, `TL:64-68`, `:93-94` and `task-tracking.md:147` all agree on the rule and the `task.md` / `context.md` / `research-report.md` inputs. D3 and D4 are the gaps.
- **Designer's two outputs.** `agent-catalog.md:71-74`, ui-ux-designer `SKILL.md:128-131`, the designer template `:106` and `:114`, and Gate 1.7 at `checkpoints.md:318-321` agree on `design-spec.md` plus `prototype/`. D5 is the gap.
- **Preserve-list alternative.** agent-lanes §3 item 9 and §6 now agree. TL Mode 3 accepts the preserve list. D9 covers wording only.
- **Same-side reason.** The three gate templates are identical and match agent-lanes §6. D10 is the one stale line.
- **Offline assets.** The folder layout (`:19`), the constraint (`:28`) and the skeleton (`:46`) agree on `prototype/assets/`. The README template does not (D6).
- **TASK_2026_535 §E.** It has two separate causes: missing MCP (the shared background service, with `--standalone` as the fix) and "[Error] Unknown error" (the user's usage limit hidden by the adapter's generic wrapper). These do not contradict each other. The Acceptance bullet at `:127-131` covers both. Only D12 remains.

## Advisory (not a defect)

- For a CLI-lane designer, `agent-lanes` §4 checks that each declared deliverable exists and is non-empty. Declaring the directory `prototype/` may not satisfy that check. Consider having `agent-catalog.md:71-74` tell CLI lanes to declare `prototype/index.html` and `prototype/README.md` instead.

## Defect count by lane

| Owner | Defects |
| --- | --- |
| Lane A (codex) | 6: D1, D2, D3, D4 (shared), D9 (shared), D10 |
| Lane B (opencode/kimi-k3) | 6: D4 (shared), D5, D6, D7, D8, D9 (shared) |
| Lane C (codex) | 3: D13, D14, D15 |
| Orchestrator | 2: D11, D12 |
| Unique total | 15 |

## Round 1 recheck

### Verdict: REVISE

All 15 round-0 defects are closed. The only blocking item is one new defect: lane A's edit broke a markdown table (N1). It is a one-line move. Two other new items are acceptable if disclosed (N2, N3).

### Review state

| Field | Value |
| --- | --- |
| Authors | Lane A: codex, resumed. Lane B's defects: a fresh Codex session, because OpenCode was out of quota. Lane C: codex, resumed. Plus the orchestrator: D11 and every rendered agent copy regenerated with the harness-sync `OpencodeAgentTransformer` / `CodexAgentTransformer`, after a 3-way merge of the template changes into `.claude/agents`. |
| Reviewer | In-process subagent (opposite side from the CLI lanes) |
| Reviewed revision | Current working tree of `docs/skills-design-gate-parity` (uncommitted, on `d398a9561`) |
| Completed revise rounds | 1 |

`P` = `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills`. `TL` = `libs/backend/agent-generation/templates/agents/team-leader.template.md`. `SA` = `libs/backend/agent-generation/templates/agents/software-architect.template.md`.

### Mechanical checks

| Check | Result |
| --- | --- |
| `diff -rq` of `P/{agent-lanes,orchestration,ui-ux-designer}` against `.claude/skills/*`, ignoring files that exist only in `.claude` | Identical |
| Template additions in `.claude/agents`, `.opencode/agent` and `.codex/agents` (escaped) | project-manager 4/4, team-leader 43/43, software-architect 23/23 lines present in all three places |
| Rendered copies of ui-ux-designer and visual-reviewer | Changes are blank lines only (transformer normalisation); no content change |
| Python `tomllib` over `.codex/agents/*.toml` | 15/15 parse |
| `npm run -s manifest:check` | Up to date (`sha256:1cfb9875…`, 225 files) |
| CR bytes in changed files and the `pr-582-*` reports | None |
| `git diff --check` | Clean |
| `NX_DAEMON=false npx nx test agent-generation --skip-nx-cache` | 34/34 suites, 1120/1120 tests, `Successfully ran target test`. There is one leaked-worker warning, which also appeared in round 0. Lane B's failed run did not reproduce. |

### D1–D15

| Defect | Status | Evidence |
| --- | --- | --- |
| D1 | Closed | `P/orchestration/SKILL.md:50-54`: in flows without a PM (BUGFIX, REFACTORING), software-architect runs in inventory-only mode before the designer; BUGFIX stays plan-free. The mode is defined in `SA:60-84` (reads the OLD code, uses the orchestration columns, stops without a plan, and replies `WROTE: … — <N> capabilities`) and in the SA description. Invocation: `P/orchestration/references/agent-catalog.md` software-architect row. Ownership: `task-tracking.md:114`. |
| D2 | Closed | "Before the next phase of the flow (architect, team-leader, or content writer)" now appears at `SKILL.md:42` and `:67`, `checkpoints.md:304-305` and `:354`, and in the agent-catalog prose paragraph and the ui-ux-designer profile row. |
| D3 | Closed | `task-tracking.md:146`: BUGFIX goes to researcher-expert if research is planned, otherwise to Mode 1, plan-free. `:148` adds the missing `research-report.md` row. |
| D4 | Closed | `team-leader-modes.md:56`, `TL:95-104` (the file list and stress test use the bug report, context and research), `TL:115`, `TL:348-353` and `TL:440-444`. A plan-free BUGFIX goes to Gate SR or researcher-expert, never to software-architect or Gate 2. |
| D5 | Closed | `P/ui-ux-designer/SKILL.md:130` (`## Deviations`), `:132` (`assets/`), `:135` (generated offline CSS; the production CSS is purged, so it is not enough; a CDN is a disclosed fallback) and `:139` (narrow viewport and embedded sidebar are separate checks). |
| D6 | Closed | `PROTOTYPING.md:20` (layout lists assets and deviations) and `:268-273` (the `## Deviations` template section: asset source, CDN reason, departures from tokens, capture limits). |
| D7 | Closed | `PROTOTYPING.md:28-36`: generate the CSS with the project's own config, with the prototype HTML in the scan and a CLI example, then verify class coverage offline before capturing. The skeleton at `:51-55` links `assets/app.css`. The Tailwind v3 CLI `--content` flag example is valid; "adapt to installed tooling" covers v4. |
| D8 | Closed | `PROTOTYPING.md:234`: serve over local HTTP; a `file:///` URL is not allowed; localhost needs the `ptah.browser.allowLocalhost` setting. `:235` closes the session and reopens it at 400×900 and at 1440×900. This matches the tool schema, where the viewport is set only when a session is created. The earlier `file:///` issue is also fixed. |
| D9 | Closed | `P/agent-lanes/SKILL.md:151` (adds "consolidates"), `SKILL.md:95` (either artifact), `TL:70` and `TL:298-309` (a preserve list is checked item by item without inventory markers, and `## Proposed Removals` need approval), plus `TL:378` and `TL:446`. |
| D10 | Closed | `SKILL.md:96-97` states the recorded same-side reason. |
| D11 | Closed | `.codex/agents/team-leader.toml:276`, `:352` and `:354` now contain `\"N/A\"`. The file was generated by `CodexAgentTransformer`, which escapes quotes. |
| D12 | Closed | `.ptah/specs/TASK_2026_535/task.md:50-51` adds `failure_kind` (task, quota, adapter, timeout, role-conflict; NULL when the run succeeded or the kind is unknown). |
| D13 | Closed | `TASK_2026_535/task.md:55`, `:85-88` and `:130-133`: a spawn-time rejection writes a row with `status: rejected` and NULL agent/process fields, and that row is excluded from failure counts. See N3. |
| D14 | Closed | `TASK_2026_537/task.md:44-45`: training uses only the training split from item 5. |
| D15 | Closed | `TASK_2026_537/task.md:18`, `:75` and `:81` are followed by a blank line. |

### Lane A's unrequested `parity-inventory.md` continuation row (`task-tracking.md:149`)

Justified. Inventory-only mode creates a folder state (`task.md` + `context.md` + `parity-inventory.md`) that no other row matches: the "`task.md` / `context.md` only" row does not apply. Without the new row, a resumed BUGFIX or REFACTORING would have no next step. See N2 for one gap in its wording.

### New defects from round 1

1. **N1 (blocking, lane A): the agent-catalog selection-matrix table is broken.**
   - **Problem.** Lane A's paragraph ("These paths include the conditional inventory → design → Gate 1.7 steps…") sits inside the table at `P/orchestration/references/agent-catalog.md:48-50`, between the `Demo video` row and the `Infrastructure` row. The blank line ends the table, and the `| Infrastructure | devops-engineer |` line at `:51` becomes lazy paragraph text. The Infrastructure route disappears from the rendered matrix. At HEAD, `:49` was a table row.
   - **Fix.** Move the `| Infrastructure | devops-engineer | … |` line back directly below `| Demo video | … |`. Then place the blank line and the "These paths include…" paragraph after it, before `---`. Mirror the change to `.claude/skills/orchestration/references/agent-catalog.md` and regenerate `content-manifest.json`.

2. **N2 (acceptable with disclosure, lane A): the parity-only continuation can skip planned research.**
   - **Problem.** In a FEATURE where the PM wrote `task-description.md` and `parity-inventory.md` and research is planned, the `task-tracking.md:149` row is the furthest match, so it resumes the designer and skips the research.
   - **Fix (optional, one clause).** At `:149`, start with "Run any planned research first (researcher-expert), then resume…".

3. **N3 (acceptable with disclosure, lane C): the rejected ledger row may have no key.**
   - **Problem.** `TASK_2026_535/task.md:85-88` and `:130-133` require rejected rows with NULL agent fields, but §B (`:45`) names no key, and `agent_id` is its first column. If the implementer makes `agent_id` the primary key, rejected rows cannot be stored. The spec does not currently state that `agent_id` is the key, so this is ambiguous rather than a contradiction.
   - **Fix (optional).** At `:45`, start the column list with "`run_id` (primary key; `agent_id` nullable and indexed),".

### Defect count by owner, round 1

| Owner | Blocking | Acceptable with disclosure |
| --- | --- | --- |
| Lane A | 1 (N1) | 1 (N2) |
| Lane B (revision by the Codex session) | 0 | 0 |
| Lane C | 0 | 1 (N3) |
| Orchestrator | 0 | 0 |

## Round 2 recheck

### Verdict: APPROVED

N1, N2 and N3 are closed, and the edits introduced nothing new, blocking or otherwise. No open items go to the user's gate from this review.

### Review state

| Field | Value |
| --- | --- |
| Authors | Lane A: codex, resumed (N1, N2). Lane C: codex, resumed (N3). Orchestrator: orchestration mirror and manifest regeneration. |
| Reviewer | In-process subagent (opposite side from the CLI lanes) |
| Reviewed revision | Current working tree of `docs/skills-design-gate-parity` (uncommitted, on `d398a9561`) |
| Completed revise rounds | 2 |

### N1–N3

| Item | Status | Evidence |
| --- | --- | --- |
| N1 | Closed | `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/agent-catalog.md:47`: `\| Infrastructure \| devops-engineer \|` is back directly below `\| Demo video \|` (`:46`), so the table is intact. The paragraph on conditional inventory → design → Gate 1.7 follows the table at `:49-50`, after a blank line and before `---`. |
| N2 | Closed | `…/orchestration/references/task-tracking.md:149`: the row now starts "Run any planned research first, then resume required designer → prototype → document review → Gate 1.7…". The rest of the row, including the plan-free BUGFIX fallback, is unchanged. |
| N3 | Closed | `.ptah/specs/TASK_2026_535/task.md:45`: `run_id` is the primary key, and `agent_id` is nullable and indexed. §D (`:88`) and Acceptance (`:133`) give each rejected row its own `run_id` with NULL `agent_id` and process fields. This is consistent with the "unknown stays NULL" rule at `:58-59`. |

### Mechanical checks

| Check | Result |
| --- | --- |
| `diff -rq` of the plugin `orchestration` skill against `.claude/skills/orchestration`, ignoring files that exist only in `.claude` | Identical |
| `npm run -s manifest:check` | Up to date (`sha256:5fd2111a…`, 225 files) |
| CR bytes in changed files and the `pr-582-*` reports | None |
| `git diff --check` | Clean |

### New defects from round 2

None.

### Carried advisory (not a defect)

- For a CLI-lane designer, `agent-lanes` §4 checks that each declared deliverable exists and is non-empty. Declaring the directory `prototype/` may not satisfy that check. This note is carried from round 0 and is optional follow-up, not a gate item.
