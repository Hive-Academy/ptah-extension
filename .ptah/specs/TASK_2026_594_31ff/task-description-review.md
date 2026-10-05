# Review — task-description.md (TASK_2026_594_31ff)

- Artifact: `.ptah/specs/TASK_2026_594_31ff/task-description.md`
- Revision: 3
- Author: codex CLI lane (CLI side)
- Reviewer: project-manager subagent (in-process side)
- Round: 2 of max 2
- Checked against: `context.md` (the "User Decisions (2026-10-05)" section overrides the older Scope lines), `TASK_2026_610_6a10/implementation-plan.md` §14 (:702-724), and code under `libs/shared/src/mcp-apps-contracts`, `libs/frontend/declarative-dashboard`, `libs/frontend/mcp-apps-page/src/lib/apps-system-prompt.ts` and `libs/backend/vscode-lm-tools`.

## Verdict: REVISE

The document covers every user decision and acceptance item, and the scope boundary holds. Revision 2 needs four changes: an explicit legacy-version reading (F1), a guard so the v1 catalog does not grow by accident (F2), the missing tool-description criterion (F3), and test gates for every project that criterion 8 touches (F4). The remaining findings are smaller precision edits. The version-site list in criterion 8 is accurate.

## Coverage check (context.md → task-description.md)

| Context item | Covered at | Status |
| --- | --- | --- |
| Decision 1 (status set only) | Summary, table :30-34 | covered |
| Decision 2 (skill + prompt pointer, no slash command) | In scope :14, crit 9-11 | covered |
| Design rule (semantic kinds, no class names) | :13, :26, crit 4 | covered |
| 10-05 #1 (extend the existing skill, `references/catalog.md`, completeness spec, `manifest:generate`) | :14, crit 9-10 | covered |
| 10-05 #2 (single catalog bump to `/3`) | crit 7-8 | covered (see F1) |
| 10-05 #3 (`text-block`, role heading/body, reject unknown role / empty / over-length / extra) | table :35, crit 5 | covered |
| 10-05 #4 (`alert` as a short inline note for ptah-ui `note`) | table :30, crit 2 | covered, imprecise (F6) |
| 10-05 #5 (`gate:eager-closure`) | crit 12 | covered |
| 10-05 #6 (commit, stash and push constraints) | not restated | acceptable: process rules, not requirements |
| Scope: "MCP tool descriptions in vscode-lm-tools list the new kinds" | In scope :15 only | **no acceptance criterion (F3)** |
| Scope: text fallback for the new kinds | In scope :11; crit 5 covers `text-block` only | partial (F7) |
| Scope: one OnPush component per kind, wired in `surface-node.component.ts` | NFR :55 | covered |
| Acceptance: backend + webview validate, dark + light render | crit 1 | covered |
| Acceptance: reject unknown tone, `class`/`style`/`html`, out-of-range value | crit 3-4 | covered |
| Acceptance: dashboard-spec/1 and /2 still render | crit 6 | ambiguous (F1) |
| Acceptance: the reference lists every `SURFACE_COMPONENT_KINDS` kind | crit 9 | covered |
| Acceptance: `nx test` on the four projects | crit 12 | covered, incomplete (F4) |

Scope creep: none found. The out-of-scope list matches context.md :52-55, plus two justified exclusions: no binding grammar, and no `dashboard-spec/3`.

## Findings

### F1 — serious — Legacy `dashboard-catalog/2` envelopes: criterion 6 does not say whether they are accepted after the bump

Evidence:
- `surface-catalog.ts:15-21`: `SURFACE_SUPPORTED_CATALOG_VERSIONS` and `DASHBOARD_CONTRACT_VERSION_PAIRS` map one schema version to exactly one catalog version.
- `surface.validator.ts:154-162`: a `dashboard-spec/2` envelope whose catalog is not the paired value is rejected with "does not pair".
- `surface.schemas.ts:485`: `z.literal(SURFACE_CATALOG_VERSION)`.
- `surface-view-model.ts:113`: a hard literal check.

After criterion 7, every envelope that carries `dashboard-spec/2` with `dashboard-catalog/2` is rejected. Criterion 6 ("a legacy `dashboard-spec/2` surface ... shall retain its current rendering behavior") can therefore be read two ways: (a) a `/2` + `/2` envelope still renders, or (b) the spec/2 shape still renders, but only at catalog `/3`. Under (a), criterion 6 contradicts criterion 7. The context.md line it came from ("Older dashboard-spec/1 and /2 specs still render") was written when a `dashboard-spec/3` was still planned. The surface store is session-scoped and in memory (`surface-tools.ts:196-199`; no `globalState`/`persist` under `vscode-lm-tools/src/lib/surface`), so reading (b) loses no stored data.

Change requested: rewrite criterion 6 so it names the outcome for each pair:
- `dashboard-spec/1` + `dashboard-catalog/1` validates and renders unchanged.
- `dashboard-spec/2` + `dashboard-catalog/3` validates and renders every pre-existing kind unchanged.
- `dashboard-spec/2` + `dashboard-catalog/2` is either rejected with the version-pair error, or explicitly accepted.

Recommend rejection, and list it under "Lane-introduced constraints" for user confirmation.

### F2 — serious — The v1 catalog is aliased to the v2 display kinds, so the v1 contract can silently gain the new kinds

Evidence:
- `surface-catalog.ts:35`: `SURFACE_DISPLAY_KINDS = DASHBOARD_COMPONENT_KINDS`.
- `dashboard-catalog.ts:56-62`: the v1 list behind `dashboard-catalog/1`.
- `dashboard-propose-spec.tool.ts:74,109`: the v1 tool's JSON-schema enum and its description both read `DASHBOARD_COMPONENT_KINDS`.

If the six kinds are appended to `DASHBOARD_COMPONENT_KINDS`, `ptah_dashboard_propose_spec` advertises them under the unchanged `dashboard-catalog/1`. That breaks the catalog-version rule in `dashboard-catalog.ts:37-47,126-130`: new vocabulary requires a new `catalogVersion`. The document says nothing about this.

Change requested: add an acceptance criterion: "When a `dashboard-spec/1` spec names any of the six new kinds, validation shall reject it; `DASHBOARD_COMPONENT_KINDS` and the `ptah_dashboard_propose_spec` description and enum shall list exactly the five v1 kinds." The mechanism (decoupling the alias) stays with the architect.

### F3 — serious — The tool-description requirement has no acceptance criterion

Evidence: In scope :15 states the requirement, but criteria 1-12 never check it. The lane's claim holds. `surface-tools.ts:172-173` builds the `ptah_surface_update` description from `SURFACE_LAYOUT_KINDS`, `SURFACE_INPUT_KINDS` and `SURFACE_DISPLAY_KINDS`, and no non-spec file in `vscode-lm-tools` has a hand-written v2 kind list (`dashboard-contract-help.ts` is derived from the v1 JSON schema, :227-288). The only existing assertion is that the description contains the catalog version (`surface-tools.spec.ts:157`).

Change requested: add a criterion: "When `buildSurfaceUpdateTool()` is built, its description shall name each of the six new kinds and the version `dashboard-catalog/3`, and a `surface-tools.spec.ts` case shall fail if any `SURFACE_COMPONENT_KINDS` member is missing." Also reword :15 to say that context.md's "list the new kinds" is satisfied through derivation, plus this test.

### F4 — serious — Criterion 12 runs only four projects, but criterion 8 edits files in four more

Evidence: criterion 8 changes files in `apps/ptah-extension-vscode` (`surface-composition.spec.ts:102`), `apps/ptah-electron` (`:106,117`), `libs/backend/rpc-handlers` (`surface-rpc-harness.ts:111`) and `libs/backend/cli-engine` (`surface-composition.spec.ts:81,93`). Criterion 12 runs only shared, declarative-dashboard, mcp-apps-page and vscode-lm-tools. A missed literal in those four projects would pass every gate.

Change requested: extend criterion 12: "`nx test` shall also pass for every project that owns a file in criterion 8 (rpc-handlers, cli-engine, ptah-extension-vscode, ptah-electron)." Keep the context.md four as the named minimum.

### F5 — minor — The property table does not settle whether the new kinds inherit the shared display fields

Evidence: `surface.schemas.ts:325-330`: every existing display kind spreads `displayShape`, which gives optional `title`, `description` and `actions`. The table lists "none" as optional properties for `progress`, `radial-progress` and `text-block`, and only `title` for `alert`. Criterion 4 rejects "an extra field". An implementer who reuses `displayShape` would contradict the table, and a reviewer cannot tell which is intended.

Change requested: add one sentence under the table. Either "the new kinds do NOT take the common display fields (`title`, `description`, `actions`) except where listed", or list them per kind. State the badge action set too (see L-4).

### F6 — minor — Criterion 2 ("short inline note") is not checkable

Evidence: crit 2 :40. The 610 dependency is a ptah-ui `note` → `alert` mapping that uses tone + text only (context.md :85-86; 610 plan §14 :710).

Change requested: replace the wording with observable conditions:
1. When `{ id, kind: 'alert', tone, text }` with no other field is validated, both the shared validator and the webview intake accept it.
2. When `title` is absent, the rendered alert contains no title element and no empty placeholder. It shows only the tone indicator and the text.
3. When `title` is present, it renders before the text inside the same alert element.

### F7 — minor — Text fallback is checked only for `text-block`

Evidence: In scope :11 lists "text fallback" for all six kinds, but only criterion 5 checks a fallback line.

Change requested: add: "When a surface containing each status kind is converted to the plain-text fallback, the output shall include one line per kind carrying its text, label or percentage (alert tone + text, badge text, progress label + value, divider text when present)."

### F8 — minor — "Valid JSON example" in criterion 9 needs a defined check

Evidence: crit 9 :47.

Change requested: "each example, wrapped in a `dashboard-spec/2` + `dashboard-catalog/3` envelope where it is a component, shall pass `validateSurfaceDocument` in the completeness spec." Add `manifest:check` passing after `manifest:generate` to criterion 10. That seam already exists (610 plan :696).

### F9 — minor — Criterion 11 should be drift-proof

Evidence: today `apps-system-prompt.ts:9-27` hand-writes all of its text.

Change requested: "a spec shall fail if any `SURFACE_COMPONENT_KINDS` member is absent from `APPS_SYSTEM_PROMPT`." Whether the line is derived or hand-written stays with the architect.

### F10 — minor — `role="alert"` for every tone is an assertive live region

Evidence: NFR :56 requires `role="alert"` for all alerts. Under the ptah-ui `note` mapping (10-05 #4), every informational note would interrupt screen-reader output.

Change requested: either restrict the requirement ("`warning` and `error` alerts are announced assertively, `info` and `success` are not"), or drop the specific role and require "the tone is conveyed in text, not only by colour". Leave the ARIA choice to the architect.

## Version-site list (criterion 8) — accuracy

A grep for `dashboard-catalog/2` across the worktree (excluding node_modules) matched every entry in criterion 8. I spot-checked these:
- `surface-catalog.ts:11`
- `surface.types.ts:124`
- `surface-view-model.ts:113`
- `surface-validator.spec.ts:241,257,263,286`
- `apps/ptah-electron/src/di/surface-composition.spec.ts:106,117`
- `cli-engine/src/lib/surface-composition.spec.ts:81,93`
- `protocol-dispatcher.surface.spec.ts:39`

All are correct.
- **Wrong entries:** none.
- **Missing under `libs/` or `apps/`:** none.
- **Not listed, correctly:** historical task artifacts under `.ptah/specs/TASK_2026_494_ca38/visual/*.e2e.spec.ts`, which are not live code.
- **Derived from the constant, need no edit:** `ptah-ui-converter.ts:59`, `surface.schemas.ts:485`, `surface-tools.ts:170` and `surface-tools.spec.ts:157,331` read `SURFACE_CATALOG_VERSION`. The criterion's "contain or derive" wording covers them.

## Trust-boundary check (dashboard-catalog.ts)

No criterion conflicts with the five controls (`dashboard-catalog.ts:11-19`). Closed tone, direction and role enums, plain `RichText` only (`:138`), strict rejection of extras, and no class, style or HTML all match. One gap: the badge "established actions" wording (:31) would admit `dashboard.open-url`, `dashboard.copy` and `surface.submit` via `SURFACE_ACTIONS` (`surface-catalog.ts:41-44`). That is still inside the allowlist, so it is not a violation, but it is broader than context.md's "optional `dashboard.select`". See L-4.

## Lane-introduced constraints

| # | Constraint | Assessment | Recommendation |
| --- | --- | --- | --- |
| L-1 | `progress` and `radial-progress` take a literal `value` only; no data-model binding (:21, :32-33, crit 3) | Defensible. Today only inputs carry `path` (`surface.schemas.ts:286-290`). Display kinds are literals, or a `{ data: { resultId } }` reference for charts, tables and lists (`:348,372,395`), never data-model paths. A live value is still reachable through `replace-component` (`surface-tools.ts:183-184`). It does narrow a context.md proposal, but that proposal was marked "architect confirms" (context.md :30), not a user decision. | **keep**, but relabel it as "deferred: no display kind binds the data model today" and add an Open question for the architect, so it is not presented as a user exclusion. |
| L-2 | `SURFACE_SCHEMA_VERSION` stays `dashboard-spec/2`; only the catalog bumps (crit 7) | Consistent with 10-05 #2 and with `dashboard-catalog.ts:37-41` (catalog and schema version independently; the envelope shape does not change). context.md Scope :42-43 asked for the reason to be documented. | **keep**, and add that one-line rationale with the `dashboard-catalog.ts:37-41` citation. |
| L-3 | `vscode-lm-tools` has no hand-written kind list; the tool description is contract-derived (:15) | Verified: `surface-tools.ts:172-173` derives from the kind constants; the v1 tool derives from `DASHBOARD_COMPONENT_KINDS` (`dashboard-propose-spec.tool.ts:74,109`). Accurate, but untested (F3), and the alias creates the v1 leak in F2. | **keep** the claim; **change** by adding the F3 and F2 criteria. |
| L-4 | `progress` `label` required; `badge` takes the "established actions" shape | Requiring `label` is sound: it is the accessible name of a progressbar, and context.md lists `label` without `?`. The badge action set is broader than context.md's "optional `dashboard.select`". | `label`: **keep**. Badge actions: **change** to "`actions` optional, restricted to `dashboard.select`", unless the user wants the full set. If unsure, **ask user**. |
| L-5 | `role="alert"` on every alert (NFR :56) | Conflicts in practice with decision 4 (inline notes); see F10. | **change** (F10). |
| L-6 | Legacy `/2` + `/2` envelopes (implicit in crit 6-7) | Unresolved; see F1. | **ask user** (Recommended: reject `/2` + `/2`, because no surface is persisted). |
| L-7 | `alert` `title` optional; `divider` `text` optional; `text-block` takes no optional fields | All match context.md :34,38 and the 610 plan :706. | **keep**. |

## Round 1 recheck (revision 2)

Line numbers below refer to `task-description.md` revision 2.

### Resolution table

| Finding | Status | Where in revision 2 | Note |
| --- | --- | --- | --- |
| F1 legacy `/2` + `/2` | resolved | crit 7 :49; Q1 :81 | All three pairs are named. Rejection is recommended and goes to the user. |
| F2 v1 catalog leak | resolved | crit 8 :50 | Uses the requested wording, and the mechanism is left open. |
| F3 tool-description criterion | resolved | crit 11 :53; In scope :17 | :17 now says "derived from the contract". See N3 for one small wording fix. |
| F4 test gates | resolved | crit 15 :57 | All eight projects are listed. |
| F5 `displayShape` inheritance | resolved | :39, table :33 | Badge actions are stated as well. |
| F6 alert checkability | partly | crit 2 :44 | Clauses 1 and 2 are only implied ("without a title"). There is no "no empty title placeholder" condition and no title-before-text order. The criterion also gained an out-of-scope clause; see N1. |
| F7 fallback for every kind | partly | crit 6 :48 | Now covers all five status kinds, but "meaningful representation" cannot be checked, and the output for a divider with no `text` is not defined. See N2. |
| F8 example validity + `manifest:check` | resolved | crit 12 :54; crit 13 :55 | |
| F9 prompt drift spec | resolved | crit 14 :56 | |
| F10 / L-5 `role="alert"` | resolved | NFR :63 | Assertive only for warning and error, and tone is conveyed in text. The ARIA role is an example, not a mandate. |
| L-1 binding deferred | resolved | Out of scope :23; table :34; Q3 :83 | Relabelled "Deferred" and tagged lane-proposed. |
| L-2 schema version stays `/2` | partly | :24; crit 9 :51 | The user decision is cited (:24). The one-line reason that catalog and schema version independently (`dashboard-catalog.ts:37-41`) is not attached to crit 9. crit 8 cites :37-41 only for the v1 boundary. Non-blocking. |
| L-4 badge actions | resolved | table :33; Q2 :82 | No criterion rejects a badge with a non-`dashboard.select` action; see N4. |

The open-questions section (:79-83) lists Q1 (legacy `/2` + `/2`), Q2 (badge actions) and Q3 (progress binding). Each has a recommended option. This item is satisfied.

### New findings

**N1 — serious — crit 2 :44 makes this task responsible for the ptah-ui `note` → `alert` conversion, which belongs to TASK_2026_610.**
Evidence: the 610 plan places that mapping in its own PR D3: `implementation-plan.md:462` ("`note` [D] → `alert`"), `:710` ("The fence `note` → 594 `alert` is in D3"), and `:715` (the `note` parser and converter fixtures are D3). Today `ptah-ui-converter.ts` has no `note` case; the cases at :74-104 are stats, table, list and chart. A 594 reviewer cannot check this clause without 594 implementing 610's parser and converter work. That is scope creep, and the two tasks would collide on the same files.
Exact change: delete the clause "when a ptah-ui `note` is converted, it shall produce this title-optional alert form with its tone and text preserved". In its place, put the F6 checkable conditions:
- "When `{ id, kind: 'alert', tone, text }` with no other field is validated, the shared validator and webview intake shall accept it."
- "When `title` is absent, the rendered alert shall contain no title element and no empty title placeholder."
- "When `title` is present, it shall render before the text inside the same alert element."

Optionally, add to Out of scope: "ptah-ui `note` → `alert` conversion — TASK_2026_610 D3 [source: 610 `implementation-plan.md:710`]".

**N2 — minor — crit 6 :48 says "meaningful representation", which a reviewer cannot check.**
Exact change: replace the sentence with "the text fallback shall emit one line per component containing: alert tone and text; badge text; progress and radial-progress label and value as a percentage; divider text when present, and a divider line when `text` is absent."

**N3 — minor — crit 11 :53 says "catalog-version-3 contract" where it should name the literal string.**
Exact change: replace "and their catalog-version-3 contract" with "and the literal `dashboard-catalog/3`".

**N4 — minor — the badge action restriction (table :33) has no rejection criterion.**
crit 4 :46 rejects unknown enum members and extra fields. A badge carrying `dashboard.open-url` is an allowlisted action, so crit 4 does not cover it.
Exact change: append to crit 4: "or a `badge` action other than `dashboard.select` (pending Q2)".

**N5 — minor — the Risks section cross-references use the revision-1 numbering.**
- :74 says "criteria 7–8 and run the four targeted test projects". It should say "criteria 9–10 and the eight projects in criterion 15".
- :76 says "criterion 9". It should say "criterion 12".

**N6 — nit — Out of scope :24 says "legacy dashboard spec versions remain supported".**
That sentence could be read as contradicting the `/2` + `/2` rejection in crit 7.
Exact change: append "(`dashboard-spec/1` + `/1`, and `dashboard-spec/2` at `dashboard-catalog/3`; see criterion 7)".

Spot-checks on new code claims: `SURFACE_LIMITS.maxStringLength` exists (`surface-catalog.ts:105`, which derives from `dashboard-catalog.ts:175`), so crit 5 is accurate. No tags were lost; every in-scope item, criterion and NFR carries a source tag. No contradictions between criteria apart from N6. No other scope creep apart from N1.

Verdict: REVISE

N1 is a single deletion plus the F6 replacement wording. N2-N6 are wording edits. Revision 3 can be approved without another full review if it applies exactly these changes.

## Round 2 recheck (revision 3)

Line numbers below refer to `task-description.md` revision 3.

### Resolution table

| Item | Status | Where in revision 3 | Note |
| --- | --- | --- | --- |
| N1 `note` → `alert` scope creep | resolved | crit 2 :45; Out of scope :25 | The conversion clause is gone. All three requested conditions appear word for word. The optional Out-of-scope line was added, citing 610 `implementation-plan.md:710`. |
| N2 fallback wording | resolved | crit 6 :49 | The requested sentence appears exactly, including the divider line when `text` is absent. |
| N3 literal catalog string | resolved | crit 11 :54 | Now reads "the literal `dashboard-catalog/3`". |
| N4 badge action rejection | resolved | crit 4 :47 | Appended "or a `badge` action other than `dashboard.select` (pending Q2)". |
| N5 Risks cross-references | resolved | Risks :75, :77 | Now "criteria 9–10 and the eight projects in criterion 15" and "criterion 12". Both targets are correct. |
| N6 legacy-support wording | resolved | Out of scope :24 | The parenthetical was appended and points to criterion 7, which holds the three version pairs. |
| L-2 schema/catalog rationale | resolved | crit 9 :52 | "Catalog and schema versions are independent contract dimensions, as established in `dashboard-catalog.ts:37-41`." |

### Regression check

- Criteria are numbered 1-15 with no gaps or duplicates. The internal references (Out of scope → criterion 7; Risks → 9–10, 12, 15; crit 4 → Q2) all resolve to the intended criteria.
- Every in-scope item, out-of-scope item, criterion, NFR, stakeholder and risk still carries a source tag. The new Out-of-scope line :25 is tagged `project-rule` with a source.
- Open questions Q1 (legacy `/2` + `/2`), Q2 (badge actions) and Q3 (progress binding) remain at :82-84, each with a recommended option.
- No new scope and no contradictions between criteria.

### Remaining open items

- Nit, non-blocking: the `alert` table row :33 still ends "so ptah-ui `note` can map to it". That is rationale, not an obligation. Criterion 2 is the checkable requirement, and :25 puts the conversion out of scope, so no change is required.
- For the user gate (not defects): Q1, Q2 and Q3 need the user's answers. The document already gives each a recommended option.

Verdict: APPROVED
