# Code Logic Review — Batch 3, `TASK_2026_461_639c`

Scope: Task 3.1 (Component 7, D2a) — delete `skillSynthesis.eligibilityMinTurns` and
`skillSynthesis.prefilterMinChars` end to end. Uncommitted diff on
`libs/backend/platform-core`, `libs/backend/rpc-handlers`, `libs/shared`,
`libs/frontend/skill-synthesis-ui`, `libs/frontend/webview-e2e-harness`,
`apps/ptah-electron-e2e` (11 files, +15/−42). `libs/backend/skill-synthesis`
(Batch 4) excluded per instructions.

## Verdict

**APPROVED** — score **8/10**. 0 blocking, 0 major, 3 minor findings.

The deletion is complete and consistent at every layer that the batch's file list
covers. Behaviour under stale persisted settings and stale update payloads is
correct and pinned by a new spec case. The surviving references are documentation
files, not code, and one of them is already scheduled for Batch 5.

## Verification performed (evidence, not executor claims)

- Repo-wide grep for both keys over `libs`, `apps`, `tools` (all file types, not
  only `.ts`): code survivors are only the opt-in corpus harness
  (`libs/backend/skill-synthesis/src/lib/prefilter-corpus-measurement.spec.ts:57,59,77,78`),
  which Batch 1 deliberately retains. Two non-code survivors listed under findings
  1 and 2.
- Read the full handler path: `registerGetSettings` builds the response from
  `Object.keys(SkillSynthesisSettingsSchema.shape)`
  (`libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:531`),
  so the two keys leave the returned DTO automatically;
  `registerUpdateSettings` writes only keys that survived
  `UpdateSkillSynthesisSettingsParamsSchema.parse`
  (`skills-synthesis-rpc.handlers.ts:563-577`).
- Confirmed the update schema is `SkillSynthesisSettingsSchema.partial()` inside a
  plain `z.object` — no `.strict()`, no `.passthrough()` anywhere on the
  skill-synthesis settings path (`skills-synthesis-rpc.schema.ts:143-145`).
  Zod strips unknown keys, so an old webview/CLI payload carrying either stale key
  parses to `{ settings: {} }`, the write loop iterates zero entries, and the
  handler still returns `{ updated: true }`. Accepted and stripped, not rejected —
  A4 satisfied on the real path.
- Confirmed `PtahFileSettingsManager` performs no key validation on either read or
  write: it holds a plain `Record<string, unknown>`
  (`libs/backend/platform-core/src/file-settings-manager.ts:44`), loads with a bare
  `JSON.parse` (`:419`), and `set(key, value)` writes whatever key it is given
  (`:97`). A user `~/.ptah/settings.json` still holding either key loads without
  error; nothing reads the keys any more (schema shape, `FILE_BASED_SETTINGS_KEYS`,
  `readSettings` and the UI form all dropped them), so they are ignored, never an
  error.
- Confirmed the file-based routing decision uses `isFileBasedSettingKey`
  (`libs/backend/platform-core/src/file-settings-keys.ts:719-726`), backed by the
  `FILE_BASED_SETTINGS_KEYS` set the diff shrank
  (`file-settings-keys.ts:230,235` removed from the set, `:509,514` from
  `FILE_BASED_SETTINGS_DEFAULTS`). The getSettings default lookup
  (`FILE_BASED_SETTINGS_DEFAULTS[configKey]`, handlers `:533`) stays in lockstep
  with the schema.
- UI consistency: `skillSettingsDtoToForm` / `skillSettingsFormToDto` are
  spread-based (`skill-synthesis-tab.component.ts:1299-1338`), so no stale key can
  survive the DTO↔form round trip; the save path gates on
  `settingsForm.valid` (`:1018`) and builds the payload from
  `getRawValue()` (`:1020`), which no longer contains the removed controls. The
  removed controls carried no validators (plain `[5]` / `[800]` defaults,
  `:791` region), so validity and dirty tracking are unaffected. The
  "Eligibility & quality" section keeps five other controls
  (`skill-settings-panel.component.ts:151-192` region post-diff) — no empty
  fieldset, no orphan label. No `.html` templates exist for these components
  (inline templates).
- Shared DTO consistency: `SkillSynthesisSettingsDto` dropped both members
  (`libs/shared/src/lib/types/rpc.types.ts:2659-2667` region). All non-test
  consumers are the rpc handler, the tab mappers, and the RPC/state services
  (grep of `SkillSynthesisSettingsDto`); none references the removed fields.
  Typecheck over 7 projects passed per executor report and my focused runs.
- e2e fixtures: both `SETTINGS_FIXTURE` objects are untyped partial stubs handed
  to a stubbed webview (`apps/ptah-electron-e2e/src/specs/thoth/skills.spec.ts:36`,
  `libs/frontend/webview-e2e-harness/.../skills-lane-pickers.e2e.spec.ts:51`).
  They were already partial (no `drain.*`, `budget.*`, `trayKeepalive`), no
  assertion reads either removed key, and the scenarios (candidates subview,
  promote, lane pickers) do not exercise prefilter depth. Still valid scenarios.
- Focused test runs (my own, after confirming no jest/nx executor was alive —
  only idle Nx daemons and MCP servers):
  - `nx run-many -t test -p @ptah-extension/rpc-handlers --testPathPatterns "skills-synthesis-rpc.schema"`:
    208/208 passed, including the new A4 case
    `strips stale depth settings from an update payload`
    (`skills-synthesis-rpc.schema.spec.ts:497-511`).
  - `--testPathPatterns "skill-settings-panel|skill-synthesis-tab"` in
    `@ptah-extension/skill-synthesis-ui`: 2 suites, 54/54 passed.
  - `--testPathPatterns "file-settings-keys"` in `@ptah-extension/platform-core`:
    228/228 passed — the key-set/defaults parity pins survived the removal.

Five logic questions, answered short:

1. **Silent failure?** The intended one: stale keys in a user's settings.json are
   silently ignored (A4's design). No new silent failure found on the RPC path.
2. **Unexpected user action?** A user following the outdated docs page (finding 1)
   configures a key that now silently does nothing. Old-CLI `ptah config set` on a
   removed key (finding 3) reports success while writing a store nothing reads.
3. **Wrong answer from bad input?** None found. The partial Zod schema strips the
   stale keys before any write; a payload of only stale keys is a clean no-op
   returning `{ updated: true }`, pinned by the new spec case.
4. **Dependency failure?** Nothing new. `getSettings` per-key reads already fall
   back to defaults on a provider throw (`handlers:534-544`).
5. **Requirements never mentioned?** The published settings docs page and the
   skill-synthesis `CLAUDE.md` behaviour claim (findings 1 and 2).

## Findings

### 1. Published docs still document both removed keys as live settings — minor

- Files: `apps/ptah-docs/src/content/docs/skill-synthesis/settings.md:30` and
  `:35` — rows for `skillSynthesis.eligibilityMinTurns` (default `5`) and
  `skillSynthesis.prefilterMinChars` (default `800`), each described as the
  "depth-based acceptance path" the phase just deleted.
- Failure scenario: a user reads `docs.ptah.live`, sets either key (via
  `~/.ptah/settings.json` or an older host), and the value is silently ignored —
  stripped by the update schema, never read. The docs also still pair them with
  `prefilterMinEdits` / `prefilterMinToolUses` rows, implying a depth gate that no
  longer exists.
- Note on scope: Task 3.1's file list and its acceptance grep
  (`--include=*.ts`) do not cover `ptah-docs`, so the executor met the assigned
  acceptance; this is a plan-scope gap, not an execution defect. No later batch
  in `batches.md` covers it either.
- Fix: delete the two rows (and any prose describing the depth path) in the Batch
  5 or Batch 7 docs pass. One file, two lines.

### 2. `skill-synthesis/CLAUDE.md` still claims `passesPrefilter` applies `eligibilityMinTurns` — minor (already scheduled)

- File: `libs/backend/skill-synthesis/CLAUDE.md:57` — "the decision to SPEND is
  `passesPrefilter`, which is where `eligibilityMinTurns` is applied".
- Failure scenario: any agent or developer reading the lib's own instruction file
  between now and Batch 5 is told a dead setting still gates the prefilter — the
  opposite of what Batch 1 shipped.
- Current handling: Task 5.3's file list explicitly includes rewriting this
  CLAUDE.md for "the removed depth branch", so the claim has an owning batch. No
  action needed from Batch 3; recorded here so the promise is not dropped when
  Batch 5 edits the file.
- Fix: none in this batch. Batch 5 must delete the `eligibilityMinTurns` clause in
  that line along with its other CLAUDE.md edits.

### 3. A stale key in a user's settings.json becomes unreachable through `ptah config` — minor

- Files: `apps/ptah-cli/src/cli/commands/config.ts:229-247` (`runList` iterates
  `FILE_BASED_SETTINGS_KEYS`), `:169-177` (`runGet` goes through the provider),
  `:200-215` (`runSet`); routing at
  `libs/backend/platform-cli/src/implementations/cli-workspace-provider.ts:109-124`.
- Failure scenario: a user who previously ran
  `ptah config set skillSynthesis.eligibilityMinTurns 3` has the value in
  `~/.ptah/settings.json`. After this batch the key is out of
  `FILE_BASED_SETTINGS_KEYS`, so `ptah config list` no longer shows it,
  `ptah config get` returns `undefined` (the provider no longer routes the read
  to the file store), and `ptah config set` reports success while writing the
  provider's in-memory config — a store nothing reads. The stale entry also
  stays in the settings file forever; no tool can list or clear it.
- Impact: cosmetic-to-minor. No runtime behaviour reads the key, so nothing
  misbehaves; the residue is dead bytes in a user file plus a misleading CLI
  round trip. This is the generic consequence of removing any key from
  `FILE_BASED_SETTINGS_KEYS`, not a regression introduced by this batch's method.
- Fix (optional, later): have `runGet`/`runList` also read raw file settings for
  keys that look like `skillSynthesis.*` but are no longer registered, or document
  that removed keys are ignorable. Do not treat this as a Batch 3 gate.

## Checks against the review brief

| Check | Result |
| --- | --- |
| 1. No remaining reference anywhere in `libs/` + `apps/` except corpus harness | Code: clean (only the corpus harness). Non-code survivors: findings 1 and 2. |
| 2. Stale keys in settings.json ignored, never error; stale update payload accepted and stripped | Verified. No `.strict()`/`.passthrough()` on the path; manager does no key validation on read or write; new A4 spec case passes. |
| 3. Shared DTO / Zod schema / handler / UI consistency | Verified at `rpc.types.ts:2659-2667`, `skills-synthesis-rpc.schema.ts:30-137`, `handlers:531-577`, `skill-synthesis-tab.component.ts:788-820,1299-1338`. No dangling field, control, label, or signal. |
| 4. Panel form validity / dirty tracking / payload / layout after control removal | Verified: removed controls had no validators; save path uses `getRawValue()`; section keeps five controls; both UI suites pass (54/54). |
| 5. e2e fixtures still valid scenarios | Verified: untyped partial stubs, no assertion reads the removed keys. |
| 6. Task 3.1 silently not done | Nothing within the task's file list is missing. The only out-of-list survivor is the docs page (finding 1), which no batch owns. |

## Verdict detail

- Recommendation: APPROVE. The three findings are documentation/CLI-surface
  cleanups; none changes runtime behaviour and none requires revising this
  batch's code. Finding 1 should be assigned to a later batch before the phase
  closes so the phase does not merge with a docs page advertising dead settings.
- Confidence: HIGH — every layer read in full, every claim re-run or re-grepped,
  focused suites executed by this reviewer.
- Top risk: `docs.ptah.live` continues to instruct users to configure settings
  that are now silently stripped (finding 1).
- What a robust follow-through would add: the docs-page row deletion (Batch 5 or
  7), the Batch 5 CLAUDE.md correction (already promised in Task 5.3), and,
  optionally, a one-line note in the docs that unknown `skillSynthesis.*` keys are
  ignored rather than rejected.