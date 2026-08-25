# Development Tasks — TASK_2026_242

**Total Tasks**: 10 | **Batches**: 3 | **Status**: 3/3 complete

> **State note (2026-08-16, team-leader MODE 2).**
>
> - **All three batches are VERIFIED but UNCOMMITTED.** The user has not authorized any
>   commit for this task, so all nine changed files sit in the working tree, unstaged.
>   Verification was done by reading the diffs and re-running the gates, not by
>   trusting the developers' reports. The exact staging list is at the bottom of this
>   file under **Files belonging to TASK_2026_242** — the working tree also carries
>   substantial unrelated dirt from parallel agents, so `git add -A` would be wrong.
> - **Batch 2 landed on its third attempt.** The first two attempts modified no file —
>   both died on tool-permission failures (`Tool permission request failed:
AbortError: Stream closed`, surfaced once as a declined read), which was
>   environmental rather than a rejection of the plan. That history is now closed.
> - **The docs no longer lead the code — resolved.** Batch 2 corrected `settings.md`
>   and `skill-synthesis/CLAUDE.md` to say the panel has a control per tier, which was
>   briefly ahead of reality. Batch 3 has now landed those three controls, so the two
>   doc edits are true as written and the earlier "do not commit these ahead of
>   Batch 3" caveat is discharged.

**Scope (fixed by `context.md` § Decision — NOT re-litigated here)**: put
`skillSynthesis.drain.nightlyMaxItemsPerRun` (40) and
`skillSynthesis.drain.weeklyMaxItemsPerRun` (400) on the RPC/settings-panel wire,
and relabel the existing "Max items per run" control so it names the frequent
tier. Backend keys and file-settings routing already exist — **do not re-add them**.

**Executor policy**: CLI-agent delegation is DISABLED for this task. Sub-agent
executors only (`backend-developer` / `frontend-developer`).

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS (2 HIGH, 2 MED). No blockers.

### Assumptions Verified

| #   | Assumption                                                         | Verdict                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Backend keys already exist and are routed                          | ✅ **VERIFIED** — `SKILL_DRAIN_KEYS` / `SKILL_DRAIN_DEFAULTS` / `SkillDrainConfig` / `readConfig()` all carry both (`skill-drain.service.ts:255-256, 273-274, 288-289, 1015-1022`), and `DRAIN_TIER_LIMITS` reads them (`:459-460`). Routing + defaults are in `platform-core/src/file-settings-keys.ts:259, 266, 483, 490`. **Nothing in Batches 1–3 may touch these files.**                                 |
| 2   | RPC dual-registration — is `skillSynthesis:` already allow-listed? | ✅ **VERIFIED PRESENT.** `libs/backend/vscode-core/src/messaging/rpc-handler.ts:79` already lists `'skillSynthesis:'`. This task adds **fields to an existing namespace**, not a namespace, so **no `ALLOWED_METHOD_PREFIXES` change and no `RpcMethodName` change is required**. Constraint 4 is satisfied with zero edits — a developer who "adds" the prefix has duplicated an entry.                       |
| 3   | The schema-driven loop needs no handler change                     | ✅ **VERIFIED** — `registerGetSettings` iterates `Object.keys(SkillSynthesisSettingsSchema.shape)` and builds `skillSynthesis.${key}` (`skills-synthesis-rpc.handlers.ts:512-513`); `registerUpdateSettings` writes the same path from `Object.entries(parsed.settings)` (`:552-557`). Declaring the schema key IS the whole of the backend wiring. **`skills-synthesis-rpc.handlers.ts` must not be edited.** |
| 4   | The existing `.max(100)` would reject the 400 weekly default       | ✅ **VERIFIED** — `skills-synthesis-rpc.schema.ts:73`. Confirms new entries need their own bounds (Task 1.1).                                                                                                                                                                                                                                                                                                  |
| 5   | The flat/required DTO forces a form control via a compile error    | ⚠️ **FALSE — see RISK-1.** The cast in `skillSettingsFormToDto` launders the missing keys. Mitigated by Task 3.4.                                                                                                                                                                                                                                                                                              |

### Risks Identified

| #      | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Severity | Mitigation                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RISK-1 | **The "flat + required DTO" forcing function does not fire.** `skillSettingsFormToDto` (`skill-synthesis-tab.component.ts:1240-1242`) opens its return literal with `...(flat as unknown as SkillSynthesisSettingsDto)`. A spread typed as the full DTO satisfies every required key, so adding two required fields to the DTO produces **no compile error** if the frontend mappers forget them. At runtime both are `undefined`; `UpdateSkillSynthesisSettingsParamsSchema` is `.partial()` so `undefined` passes validation, and `registerUpdateSettings`' `Object.entries` loop then calls `setConfiguration('ptah', 'skillSynthesis.drain.nightlyMaxItemsPerRun', undefined)` — **wiping a value the user had configured in `~/.ptah/settings.json`**, on every Save, silently. | **HIGH** | Task 3.1 (add both to `SkillSettingsFormValue` + both mappers explicitly) **and** Task 3.4 (a mapper round-trip spec that the cast cannot launder). Task 3.4 is not optional.              |
| RISK-2 | **Bounds guessed rather than derived.** Copying `.max(100)` rejects the 400 default outright; picking an arbitrary large ceiling ignores that `ELIGIBLE_SCAN_LIMIT` is `Math.max(20, cap)` (`skill-drain.service.ts:687`), so the cap directly sizes a `listEligible` SQL read **per workspace, per tick**, and `maxRounds = cap` sizes the deal loop (`:714`).                                                                                                                                                                                                                                                                                                                                                                                                                      | **HIGH** | Task 1.1 carries the derivation rule and the recommended values; Task 1.3 pins ceiling+1 as a rejection.                                                                                   |
| RISK-3 | **The DTO already diverges from the schema, and it is tempting to "fix".** `SkillSynthesisSettingsSchema` carries five phase-3 keys (`replayValidation.enabled`, `replayValidation.minConfidence`, `triggerEval.enabled`, `judgePanel.enabled`, `judgePanel.disagreementThreshold`) that `SkillSynthesisSettingsDto` does **not** declare (`rpc.types.ts:2440-2479`). They cross the wire (the loop reads the schema) but are invisible to TypeScript and have no control.                                                                                                                                                                                                                                                                                                           | **MED**  | **Explicitly OUT OF SCOPE.** Do not add them, do not remove them, do not add a schema↔DTO parity spec. `context.md` scopes this task to the two item caps. A parity sweep is its own task. |
| RISK-4 | **A pre-existing default drift will get copied.** The tab component's form seeds `maxAttempts: [3]` (`skill-synthesis-tab.component.ts:779`) while the real default is `5` (`SKILL_DRAIN_DEFAULTS`, `FILE_BASED_SETTINGS_DEFAULTS`, and the schema spec fixture all say 5). Harmless today because `patchValue` overwrites on load.                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **MED**  | Do **not** fix it (out of scope, unrelated file region). Do **not** imitate it: the two new controls seed **exactly** `40` and `400`, matching `FILE_BASED_SETTINGS_DEFAULTS`.             |

### Edge Cases to Handle

- [ ] `400` (the shipped weekly default) must PARSE, not throw → Task 1.3
- [ ] `40` (the shipped nightly default) must PARSE → Task 1.3
- [ ] `0` must be REJECTED for both — a cap of 0 drains nothing (mirrors the existing `drain.maxItemsPerRun` rejection at spec `:267`) → Task 1.3
- [ ] Numeric **strings** must coerce — these arrive from HTML number inputs over the RPC bridge → Task 1.3
- [ ] `ceiling + 1` must be REJECTED for both → Task 1.3
- [ ] A Save with the panel untouched must round-trip both caps unchanged, not `undefined` → Task 3.4 (RISK-1)
- [ ] The relabelled frequent control must keep its existing `data-testid` so the panel spec's KNOBS table and any e2e binding survive → Task 3.2

### Ordering Dependency (EXPLICIT — batches are NOT parallelisable)

```
Batch 1 (backend: rpc-handlers schema)
   ↓  the schema key is what puts the value on the wire at all
Batch 2 (shared: DTO + docs)
   ↓  the frontend cannot name `dto['drain.nightlyMaxItemsPerRun']` until the DTO declares it
Batch 3 (frontend: form + panel + specs)
```

Reversing it fails concretely: Batch 3 before Batch 2 is a TypeScript error on the
DTO index; Batch 2 before Batch 1 puts a key in the DTO that
`SkillSynthesisSettingsSchema.parse(raw) as SkillSynthesisSettingsDto`
(`skills-synthesis-rpc.handlers.ts:527-529`) would strip at runtime while the cast
claims it is present — a wire lie rather than a compile error.

**Never mix backend and frontend in one batch** — Batches 1–2 are backend-developer,
Batch 3 is frontend-developer.

---

## Batch 1: RPC schema — the two per-tier caps ✅ COMPLETE (verified, uncommitted)

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `backend-developer` (re-invoke with the reviewer's issues)
**Execution Mode**: `sequential`
**Rationale**: Three tasks in two tightly coupled files (a Zod schema and its own
spec's hoisted fixture); 1.2 and 1.3 both edit the same spec file, so they are not
file-disjoint and the parallel-eligible checklist fails. One agent, in order.
**Tasks**: 3 | **Dependencies**: None

### Task 1.1: Add the two schema entries with derived bounds ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.schema.ts`
**Spec Reference**: `context.md` § Decision, shape item 1
**Pattern to Follow**: `skills-synthesis-rpc.schema.ts:73` (`'drain.maxItemsPerRun'`), and the
dotted-key doc block immediately above it at `:52-69`.

**Implementation Details**:

- Insert both entries directly **after** `'drain.maxItemsPerRun'` at line 73, so the
  three item caps read as a group the way the three cron entries do at `:70-72`:
  ```
  'drain.nightlyMaxItemsPerRun': z.coerce.number().int().min(1).max(1_000),
  'drain.weeklyMaxItemsPerRun':  z.coerce.number().int().min(1).max(10_000),
  ```
- **Keys are DOTTED and literal.** `'drain.nightlyMaxItemsPerRun'` IS the settings path
  `skillSynthesis.drain.nightlyMaxItemsPerRun`. Renaming either to camelCase reads and
  writes a path no host stores (constraint 2).
- `z.coerce.number()` — not `z.number()`. Values arrive as strings from HTML number
  inputs over the RPC bridge; the file header at `:3-6` states this.

**Bounds derivation (RISK-2 — this is the reasoning, not a preference)**:

- **Floor `1` for both.** `0` is not "off" for an item cap — the drain's stop switch
  is `skillSynthesis.enabled` (gate 1). A `0` cap silently drains nothing while the
  panel shows a configured tier. Same rule the existing `drain.maxItemsPerRun` floor
  encodes.
- **Ceilings: `1_000` nightly / `10_000` weekly.** Rule: **the same 25× head-room ratio
  the frequent cap already ships** — `100 / 4 = 25`, so `40 × 25 = 1_000` and
  `400 × 25 = 10_000`. That rule is not arbitrary; it is the one already committed to
  in this file, and it lands where the drain's own physics say it can sustain:
  - The cap sizes a per-workspace SQL read, `scanLimit = Math.max(ELIGIBLE_SCAN_LIMIT, cap)`
    (`skill-drain.service.ts:687`) — bounded, once per tick, on the once-a-day and
    once-a-week tiers only.
  - The cap also bounds the round COUNT, `maxRounds = cap` (`:714`) — the deal loop
    terminates by construction even at the ceiling.
  - Cost cannot run away: `DRAIN_TIER_LIMITS`' own header and `context.md` both state
    the cap is a **throughput throttle, never a cost control**. `maxTokensPerDay` is
    the only cost ceiling and it is a HARD stop checked once per tick **and again per
    item** (`skill-drain.service.ts:593, 620-629`). A cap larger than the budget can
    pay for stops, having stopped the queue from growing.
- If you deviate from `1_000` / `10_000`, **state the replacement rule in the comment**
  — a bare number here rots the way `MAX_STAGE_TIMEOUT_MS`' old literal did.

**Quality Requirements**:

- Extend the existing bounds-rationale comment block (`:60-69`) with the two new
  entries' reasoning, in that block's register: why the tiers cannot share `.max(100)`,
  and the 25× rule. Do not open a second comment block.
- Do NOT touch `skills-synthesis-rpc.handlers.ts` (assumption 3), `file-settings-keys.ts`
  (assumption 1), or `rpc-handler.ts` (assumption 2).
- Do NOT add the five phase-3 keys to anything (RISK-3).

**Acceptance Criteria**:

- `SkillSynthesisSettingsSchema.shape` contains both dotted keys, spelled exactly
  `'drain.nightlyMaxItemsPerRun'` and `'drain.weeklyMaxItemsPerRun'`.
- `SkillSynthesisSettingsSchema.parse({...validFull, 'drain.weeklyMaxItemsPerRun': 400})`
  does not throw.
- The ceiling rationale is stated in-file.

---

### Task 1.2: Extend the hoisted `validFull` fixture ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.schema.spec.ts`
**Dependencies**: Task 1.1

**Implementation Details**:

- The schema is **not** `.partial()` for `parse`, so every settings spec needs the whole
  object. That is exactly why `validFull` was hoisted (see the file's own comment at
  `:67-74`). Add both keys to `validFull` beside `'drain.maxItemsPerRun': 4` at `:101`:
  `'drain.nightlyMaxItemsPerRun': 40,` and `'drain.weeklyMaxItemsPerRun': 400,`.
- Values are the **shipped defaults** and must match `FILE_BASED_SETTINGS_DEFAULTS`
  (`platform-core/src/file-settings-keys.ts:483, 490`) — the fixture comment at `:96-97`
  says `file-settings-keys.spec.ts` pins the same values on the other side.
- Add both to the key-name assertion array at `:188-197` (the test named
  _"names its keys so `skillSynthesis.<key>` is the settings path"_), in the same
  position they occupy in the schema.

**Acceptance Criteria**:

- One fixture, still one — no second copy of the settings object appears in this file.
- The key-name assertion lists both new dotted keys.

---

### Task 1.3: Bounds + coercion specs for both caps ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.schema.spec.ts`
**Dependencies**: Task 1.2
**Pattern to Follow**: the existing per-key bounds tests at `:257-284` (stale-claim TTL
floor, per-run item budget of 0, numeric-string coercion).

**Validation Notes**: this is the mitigation for RISK-2. The single most important
assertion is that **400 parses** — it is the exact value the pre-existing `.max(100)`
would have rejected, which is what made this a wiring task rather than a one-liner.

**Implementation Details** — add tests covering:

1. The shipped defaults parse: `40` for nightly, `400` for weekly (assert the parsed
   values, not just "does not throw", so a stray `.default()` cannot mask a drop).
2. `0` is rejected for both — mirror the wording of _"rejects a per-run item budget of 0,
   which would drain nothing"_ at `:267`.
3. `ceiling + 1` is rejected for both (`1_001` / `10_001` at the recommended ceilings).
   If Task 1.1 chose different ceilings, use those.
4. Numeric strings coerce for both — extend or mirror the coercion test at `:276-284`.

**Acceptance Criteria**:

- A test would FAIL if someone re-narrowed either ceiling to `.max(100)`.
- A test would FAIL if either key were renamed to camelCase (Task 1.2's key-name
  assertion already covers this — confirm it does).

---

**Batch 1 Verification**:

```
npx nx typecheck rpc-handlers
npx nx test rpc-handlers
```

**Result (2026-08-16, re-run by team-leader, not taken on report):**

- `npx nx typecheck rpc-handlers` — **passed**.
- `npx nx test rpc-handlers --skip-nx-cache` — **78/78 suites**, 2116 passed,
  31 skipped, 2147 total.
- **Chosen bounds**: floors `1` for both; ceilings nightly `.max(1_000)` and weekly
  `.max(10_000)`, derived by the **25× head-room rule** the frequent cap already
  ships (`100 / 4 = 25`, so `40 × 25` and `400 × 25`). The rule is stated in-file in
  the existing bounds-rationale comment block — no second block was opened.
- Both files exist and compile; all `rpc-handlers` Jest specs green.
- `git status --short` shows changes limited to the two `skills-synthesis-rpc.schema*` files.
- Edge cases 1–5 above are covered by real assertions (defaults asserted by value, not
  merely "does not throw"; `0` and ceiling+1 rejected for both tiers; numeric strings
  coerce; the key-name assertion lists both dotted keys).
- **NOT COMMITTED** — no commit authorized for this task.

---

## Batch 2: Shared DTO + the docs that currently say the opposite ✅ COMPLETE (verified, uncommitted)

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `backend-developer`
**Execution Mode**: `sequential`
**Rationale**: Three small edits across a shared type file and two docs, but 2.2 and 2.3
must state the _same_ new fact ("both caps are now on the wire") consistently with the
DTO 2.1 lands — a single agent holding all three keeps them from contradicting each
other, which is the exact defect this whole task is fixing one level down.
**Tasks**: 3 | **Dependencies**: Batch 1 (the schema key is what the DTO describes)

### Task 2.1: Add the two dotted keys to `SkillSynthesisSettingsDto` ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
**Spec Reference**: `context.md` § Decision, shape item 2
**Pattern to Follow**: `rpc.types.ts:2468-2477` and its dotted-key comment at `:2461-2467`.

**Implementation Details**:

- Insert both after `'drain.maxItemsPerRun': number;` (`:2471`):
  ```
  'drain.nightlyMaxItemsPerRun': number;
  'drain.weeklyMaxItemsPerRun': number;
  ```
- Quoted dotted keys, `number`, **required** (the DTO is flat and required by design —
  see constraint 3; `Partial<>` is applied at the one call site that needs it,
  `SkillSynthesisUpdateSettingsParams` at `:2486-2488`).

**Validation Notes**:

- **RISK-1**: adding these as required will NOT produce a compile error in
  `skill-synthesis-tab.component.ts`, because `skillSettingsFormToDto` spreads a cast.
  Do not conclude from a green `typecheck` that the frontend is done — Batch 3 is what
  makes it true, and Task 3.4 is what proves it.
- **RISK-3**: do not add the five phase-3 keys while you are in this interface.

**Acceptance Criteria**:

- `npx nx typecheck shared` and `npx nx typecheck rpc-handlers` both pass.
- The DTO's key order matches the schema's key order for the drain group.

---

### Task 2.2: Correct the docs rows that assert the keys are off the wire ✅ COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\skill-synthesis\settings.md`
**Dependencies**: Task 2.1

**Implementation Details** — three places state the now-false fact:

- Row `:73` (`nightlyMaxItemsPerRun`): drop **"File-settings only — not on the RPC wire"**
  and the sentence _"The settings panel's 'Max items per run' field is bound to
  `drain.maxItemsPerRun` alone; it does not read or write this key, and the nightly tier
  ignores whatever the panel shows. Edit `~/.ptah/settings.json` to change it."_
  Replace with a statement that the panel now has its own control for this tier.
- Row `:74` (`weeklyMaxItemsPerRun`): same treatment; keep the sizing rationale
  (~163 eligible sessions/week × two weekly rows) — that is still true and is the reason
  the number is 400.
- Row `:72` (`maxItemsPerRun`): make it say **frequent tier** explicitly, matching the
  panel's new label from Task 3.2, so the doc and the UI use one name for one tier.
- Line `:8` says _"most of the drain queue"_ has panel UI — verify it is still accurate
  after this change and adjust only if it is not. Do **not** rewrite the gates section
  at `:123-131`; those five keys stay off the wire (RISK-3).

**Acceptance Criteria**:

- No remaining claim in this file that either per-tier cap is file-settings-only.
- The `:82-84` note on caps-are-throughput-throttles survives unchanged — it is still
  the correct framing and `context.md` reaffirms it.

---

### Task 2.3: Correct the drain bullet in the lib's CLAUDE.md ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\skill-synthesis\CLAUDE.md`
**Dependencies**: Task 2.1

**Implementation Details**:

- The "Drain semantics (`SkillDrainService`)" bullet currently ends a sentence with:
  _"Both new caps are file-settings only and deliberately OFF the RPC wire, so the
  settings panel's single 'Max items per run' field describes the frequent tier alone
  (TASK_2026_242)."_ That sentence is what this task deletes the truth of.
- Replace it with the new state: all three item caps are on the RPC wire and each has
  its own control; the panel's frequent-tier field is now labelled as such. Keep the
  TASK_2026_242 reference — it is now the citation for the fix rather than the deferral.
- Change **only** that sentence. The surrounding measurement rationale (the 828-session
  corpus, the ~325 rows/week arithmetic, `perWorkspaceBatch` staying 1, the
  `max(20, tier cap)` scan note) is unaffected and must not be reworded.

**Acceptance Criteria**:

- No sentence in the repo still claims these two keys are off the RPC wire
  (`grep -n "OFF the RPC wire\|not on the RPC wire"` returns nothing for these keys).

---

**Batch 2 Verification**:

```
npx nx typecheck shared
npx nx typecheck rpc-handlers
npx nx test rpc-handlers
```

**Result (2026-08-16, re-run by team-leader, not taken on report):**

- `npx nx typecheck shared` — **passed**.
- `npx nx typecheck rpc-handlers` — **passed**.
- `npx nx test rpc-handlers --skip-nx-cache` — **78/78 suites**, 2116 passed,
  31 skipped, 2147 total (unchanged by this batch, as expected — the DTO is a type).
- `grep -rn "not on the RPC wire\|OFF the RPC wire" apps/ptah-docs libs/backend/skill-synthesis`
  → exit 1, no match. Task 2.3's acceptance criterion holds.
- **DTO key order matches the schema's drain group exactly** — both new keys are dotted
  string literals, `number`, required, inserted directly after `'drain.maxItemsPerRun'`.
- **RISK-3 held.** None of the five phase-3 keys (`replayValidation.*`,
  `triggerEval.enabled`, `judgePanel.*`) was added or removed, and no schema↔DTO parity
  spec appeared. The only `judgePanel` token in `rpc.types.ts` is the pre-existing
  unrelated `judgePanelRationales` field at `:2094`.
- **Task 2.2 corrected only what became false.** The weekly sizing rationale (~163
  eligible sessions/week × the two weekly rows) survives verbatim in the row-74 rewrite,
  and the caps-are-throughput-throttles `:::note` is untouched. Row 72 now names the
  **frequent tier** in bold and quotes the panel's new label. The phase-3 gates section
  is unmodified.
- **Task 2.3 changed exactly one sentence**, confirmed by `git diff --word-diff`. The
  828-session corpus, the ~325 rows/week arithmetic, `perWorkspaceBatch` staying 1 and
  the `max(20, tier cap)` scan note are all unreworded; the TASK_2026_242 citation is kept.
- **`settings.md:8` deliberately left unchanged** — ruled acceptable, see the state note
  at the top of this file and the Batch 2 ruling below.
- **NOT COMMITTED** — no commit authorized for this task.

**Ruling on `settings.md:8` ("most of the drain queue" has panel UI):** leaving it is
**correct**, and not merely tolerable. The sentence pairs a hedge with an explicit
exception list — "the triggers, the four lane sub-trees, and the three phase-3 gates
have no panel UI yet". That list never named the two item caps, so before this task the
line was already mildly wrong by omission; after Batch 3 the list becomes exactly right
and the hedge merely conservative. Task 2.2 instructed adjusting the line **only if it
is no longer accurate**, and it is accurate. Tightening "most" to "all" would also be
false — `maxAttempts` and `staleClaimTtlMs` still have no control.

---

## Batch 3: Form, panel controls, relabel, and the round-trip pin ✅ COMPLETE (verified, uncommitted)

**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `frontend-developer`
**Execution Mode**: `sequential`
**Rationale**: Four tasks across two components and their two specs, all touching the
same `drain` form group and its dotted↔nested mapping. 3.3 and 3.4 assert against what
3.1/3.2 build, and 3.1's mappers are the file 3.4 tests — not file-disjoint, so the
parallel-eligible checklist fails on every clause. Angular work, so `frontend-developer`.
**Tasks**: 4 | **Dependencies**: Batch 2 (the DTO must declare the keys first)

### Task 3.1: Extend the form group and BOTH dotted↔nested mappers ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\skill-synthesis-ui\src\lib\components\skill-synthesis-tab.component.ts`
**Spec Reference**: `context.md` § Decision, shape item 3
**Pattern to Follow**: the nested-vs-dotted comment at `:761-770` and
`SKILL_SETTINGS_MAPPERS` at `:1179-1254`.

**Validation Notes — this task carries RISK-1.** The mapper file is where the
`undefined`-wipe happens if either direction is missed, and **TypeScript will not catch
it** (`:1242` spreads `flat as unknown as SkillSynthesisSettingsDto`, which satisfies
every required key). All four edits below are mandatory; none is implied by another.

**Implementation Details** — four edits, all in this file:

1. **Form group** (`:771-781`): add to the nested `drain` group, after `maxItemsPerRun`:
   `nightlyMaxItemsPerRun: [40],` and `weeklyMaxItemsPerRun: [400],`.
   Seed values are the shipped defaults from `FILE_BASED_SETTINGS_DEFAULTS`
   (`file-settings-keys.ts:483, 490`) — **exactly 40 and 400**. Do not imitate the
   `maxAttempts: [3]` drift on line 779 (RISK-4) and do not fix it either.
2. **`SkillSettingsFormValue.drain`** (`:1194-1204`): add
   `readonly nightlyMaxItemsPerRun: number;` and `readonly weeklyMaxItemsPerRun: number;`.
3. **`skillSettingsDtoToForm`** (`:1215-1225`): add
   `nightlyMaxItemsPerRun: dto['drain.nightlyMaxItemsPerRun'],` and the weekly line.
4. **`skillSettingsFormToDto`** (`:1243-1252`): add
   `'drain.nightlyMaxItemsPerRun': drain.nightlyMaxItemsPerRun,` and the weekly line.

**Quality Requirements**:

- **Nested in the form, dotted on the wire.** Angular's `validateFormGroupControls`
  forbids `.` in a `FormGroup` key, which is exactly why the group is nested; the wire
  key stays dotted because it IS the settings path (constraints 2 and 3, and the file's
  own comment at `:763-770`).
- Both mappers spell the fields out **field by field**, as the existing ones do — do not
  introduce a derived/loop mapping. The file's comment at `:1188-1190` states why: a key
  that gains a third name must surface here rather than as a silent write.
- `ChangeDetectionStrategy.OnPush` and signals are already in place — do not change them.

**Acceptance Criteria**:

- `form.get('drain.nightlyMaxItemsPerRun')` and `form.get('drain.weeklyMaxItemsPerRun')`
  both resolve to a control.
- `skillSettingsFormToDto` emits both dotted keys with real numbers, never `undefined`.

---

### Task 3.2: Two new inputs + relabel the frequent-tier control ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\skill-synthesis-ui\src\lib\components\skill-settings-panel.component.ts`
**Dependencies**: Task 3.1
**Pattern to Follow**: the existing cron trio at `:415-436` — three sibling controls, one
per tier, each with a `skills-drain-*` testid. That trio is the precedent `context.md`
cites: the item cap is the odd one out, not a new pattern.

**Implementation Details** — inside the existing `formGroupName="drain"` grid at `:380-481`:

1. **Relabel** the existing control at `:437-447`. Label text changes from
   `Max items per run` to something that names the tier and matches the cron trio's
   register — e.g. `Max items per run (frequent tier)`. **Keep `formControlName="maxItemsPerRun"`
   and keep `data-testid="skills-drain-max-items-per-run"` unchanged** — the wire key is
   unchanged, the panel spec's KNOBS table at `:328` binds that id, and renaming it would
   break bindings for a cosmetic reason.
2. **Add two inputs** immediately after it, in tier order (frequent → nightly → weekly),
   mirroring the cron trio's order:
   - `formControlName="nightlyMaxItemsPerRun"`,
     `data-testid="skills-drain-nightly-max-items-per-run"`, label naming the nightly tier.
   - `formControlName="weeklyMaxItemsPerRun"`,
     `data-testid="skills-drain-weekly-max-items-per-run"`, label naming the weekly tier.
   - Both `type="number"`, `class="input input-bordered input-sm"`, wrapped in the same
     `<label class="flex flex-col gap-1">` + `<span class="text-xs text-base-content-muted">`
     shape every sibling uses.

**Quality Requirements**:

- Testids follow the established `skills-drain-<kebab-key>` convention exactly — compare
  `skills-drain-nightly-cron-expr` (`:422`) / `skills-drain-weekly-cron-expr` (`:433`)
  (constraint 5).
- The component is already `ChangeDetectionStrategy.OnPush` with signal inputs — this is
  a template-only change. Add no new `input()`, no new injection, no new state.
- The `Background work` section's intro paragraph (`:357-360`) already frames these as
  throughput knobs; extend it only if the three-tier split is otherwise unreadable.

**Acceptance Criteria**:

- Three item-cap inputs render, one per tier, each naming its tier in the visible label.
- No user reading the panel can still believe one number governs all three tiers — the
  defect in `task.md`'s `description` is gone.

---

### Task 3.3: Panel spec — fixture, KNOBS, write-back, label ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\skill-synthesis-ui\src\lib\components\skill-settings-panel.component.spec.ts`
**Dependencies**: Task 3.2
**Pattern to Follow**: the `Phase-0 background knobs` describe at `:313-421`.

**Implementation Details**:

1. Add `nightlyMaxItemsPerRun: [40],` and `weeklyMaxItemsPerRun: [400],` to the spec's
   own `drain` form group at `:91-100` (this fixture is separate from the component's —
   both need the controls or the render throws on an unknown `formControlName`).
2. Add two rows to the `KNOBS` table at `:321-332`:
   `['skills-drain-nightly-max-items-per-run', 'drain.nightlyMaxItemsPerRun']` and
   `['skills-drain-weekly-max-items-per-run', 'drain.weeklyMaxItemsPerRun']`.
   The `it.each(KNOBS)` at `:334` then proves each input resolves to its form path — which
   is character-for-character the dotted settings key (see the describe's comment at
   `:314-320`).
3. Add a write-back test for at least the **weekly** control, following the foreground-backoff
   pattern at `:397-409`: set `.value`, dispatch `input`, assert
   `form.get('drain.weeklyMaxItemsPerRun')?.value`.
4. Add one assertion that the **relabelled** frequent control's visible label names the
   frequent tier — this is the literal defect from `task.md`, and without it the relabel
   can be reverted silently.

**Acceptance Criteria**:

- `KNOBS` covers all three item caps.
- A test fails if the relabel is reverted to bare "Max items per run".

---

### Task 3.4: Tab spec — mapper round-trip pin (RISK-1 mitigation) ✅ COMPLETE (implemented CORRECTLY AGAINST this spec — see the ruling in the Batch 3 Verification block)

**File**: `D:\projects\ptah-extension\libs\frontend\skill-synthesis-ui\src\lib\components\skill-synthesis-tab.component.spec.ts`
**Dependencies**: Task 3.1

**Validation Notes**: `skillSettingsDtoToForm` / `skillSettingsFormToDto` currently have
**no unit coverage anywhere** — the only other reference in the repo is
`libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/skills-lane-pickers.e2e.spec.ts`.
Combined with the laundering cast at `:1242`, that means today nothing at all would catch
a dropped key. This task is the mechanical pin RISK-1 requires; it is **not optional** and
must not be folded into 3.3.

**Implementation Details**:

- Both functions are already `export`ed from `skill-synthesis-tab.component.ts` — import
  them directly; do not render the tab component to test them.
- Build a complete `SkillSynthesisSettingsDto` fixture with **distinct, non-default**
  values for the three item caps (e.g. `7` / `55` / `321`) so a value crossing wires
  between them is visible rather than accidentally equal.
- Assert `skillSettingsFormToDto(skillSettingsDtoToForm(dto))` reproduces all three
  dotted item-cap keys with their original values.
- Assert explicitly that neither new key is `undefined` in the output — this is the exact
  shape the cast would otherwise let through, and it is the value that would reach
  `setConfiguration` and wipe the user's file setting.
- Assert the nested `drain` / `budget` groups are **absent** from the outgoing DTO — the
  existing contract at `:1233-1236` (sending both would offer the backend two keys for
  one setting).

**Acceptance Criteria**:

- Deleting either new line from `skillSettingsFormToDto` makes this spec fail.
- Deleting either new line from `skillSettingsDtoToForm` makes this spec fail.

---

**Batch 3 Verification**:

```
npx nx typecheck skill-synthesis-ui
npx nx test skill-synthesis-ui
```

**Result (2026-08-16, re-run by team-leader, not taken on report):**

- `npx nx typecheck skill-synthesis-ui` — **passed**.
- `npx nx test skill-synthesis-ui --skip-nx-cache` — **23/23 suites, 337/337 tests**.
- `npx nx lint skill-synthesis-ui --skip-nx-cache` — **passed**.
- Task 3.1: all FOUR edits present (form group, `SkillSettingsFormValue.drain`,
  `skillSettingsDtoToForm`, `skillSettingsFormToDto`). Seeds are exactly `40` / `400`.
  Both mappers still spell fields out field by field — no derived/loop mapping.
- Task 3.2 is template-only: the relabel keeps `formControlName="maxItemsPerRun"` and
  `data-testid="skills-drain-max-items-per-run"` unchanged, the two new inputs use
  `skills-drain-nightly-max-items-per-run` / `skills-drain-weekly-max-items-per-run`
  in tier order, and no `input()`, injection or state was added. OnPush intact.
- Task 3.3: fixture gained both controls, `KNOBS` covers all three item caps, the
  write-back test also asserts the frequent cap did NOT move, and a label test pins all
  three captions verbatim so the relabel cannot be silently reverted.
- **RISK-4 held**: `maxAttempts: [3]` is untouched (now line 781, shifted only by the
  two inserted controls) and was not imitated — the new seeds match
  `FILE_BASED_SETTINGS_DEFAULTS`.
- **NOT COMMITTED** — no commit authorized for this task.

### Ruling: Task 3.4 as written in THIS FILE was a false pin. The developer was right to rewrite it.

My original Task 3.4 specified asserting on
`skillSettingsFormToDto(skillSettingsDtoToForm(dto))` — chaining the two mappers
function-to-function. **That would not have pinned RISK-1**, and the reason is visible
in the source rather than a matter of opinion:

- `skillSettingsDtoToForm` opens its return with `...dto`
  (`skill-synthesis-tab.component.ts:1218`), so every DOTTED key survives into the
  returned object alongside the nested `drain` group it builds.
- `skillSettingsFormToDto` destructures `const { drain, budget, ...flat } = value`
  (`:1246`) and re-emits `...(flat as unknown as SkillSynthesisSettingsDto)` (`:1248`).
  `flat` still carries those same dotted keys.

So with a mapper line DELETED, the direct chain still returns the correct value — the
key is supplied by the `...dto` → `...flat` passthrough, not by the mapper line under
test. The cast launders it at both ends, exactly as RISK-1 warns, and the test would
have gone green while the defect shipped.

The implemented version routes the round-trip through the component's REAL
`settingsForm` (`patchValue(skillSettingsDtoToForm(dto))` →
`skillSettingsFormToDto(form.getRawValue())`), mirroring `loadSettings` /
`onSaveSettings`. The form is the load-bearing part: it holds only DECLARED controls,
so `patchValue` discards the flat dotted keys and `getRawValue()` never re-emits them.
The dotted keys can then only come from the explicit mapper lines — which is the thing
RISK-1 needs pinned.

**Independently re-verified by mutation**, not accepted on report: deleting
`'drain.nightlyMaxItemsPerRun': drain.nightlyMaxItemsPerRun,` from
`skillSettingsFormToDto` and running `-t "skill settings mappers"` gives
**3 failed, 2 passed**, with the key ABSENT from the output (`'…' in out` → `false`,
value `undefined`) — the precise shape that would reach
`setConfiguration('ptah', '…', undefined)` and wipe the user's file setting. The line
was restored immediately; `git diff --stat` on the file reads `8 insertions(+)`,
`0 deletions`, confirming a byte-clean restore.

The reasoning is written into the spec's own doc comment (the `saveThroughForm` block
states why chaining directly is a false pin), so a later reader cannot "simplify" it
back into the broken form without deleting the explanation of why it exists.

---

## Full-Task Verification (after Batch 3, before MODE 3)

```
npx nx typecheck rpc-handlers
npx nx typecheck shared
npx nx typecheck skill-synthesis-ui
npx nx test rpc-handlers
npx nx test skill-synthesis-ui
```

Manual confirmations for the completion report:

- [ ] `rpc-handler.ts` `ALLOWED_METHOD_PREFIXES` was **not** modified (assumption 2 —
      the prefix was already present at `:79`; this task added fields, not a namespace).
- [ ] `skills-synthesis-rpc.handlers.ts` was **not** modified (assumption 3).
- [ ] `platform-core/src/file-settings-keys.ts` and
      `skill-synthesis/src/lib/queue/skill-drain.service.ts` were **not** modified
      (assumption 1 — backend keys and routing already existed).
- [ ] No phase-3 gate key was added to the DTO (RISK-3).
- [ ] `maxAttempts: [3]` at `skill-synthesis-tab.component.ts:779` is untouched (RISK-4).

---

## MODE 3 — Final Verification (2026-08-16, team-leader)

**Status: PASSED. All 3 batches, all 10 tasks verified. NOT COMMITTED.**

Gates, all re-run by the team-leader rather than taken on report:

| Command                                          | Result                                            |
| ------------------------------------------------ | ------------------------------------------------- |
| `npx nx typecheck rpc-handlers`                  | passed                                            |
| `npx nx typecheck shared`                        | passed                                            |
| `npx nx typecheck skill-synthesis-ui`            | passed                                            |
| `npx nx test rpc-handlers --skip-nx-cache`       | 78/78 suites, 2116 passed, 31 skipped, 2147 total |
| `npx nx test skill-synthesis-ui --skip-nx-cache` | 23/23 suites, 337/337 tests                       |
| `npx nx lint skill-synthesis-ui --skip-nx-cache` | passed                                            |

Manual checklist — every item confirmed by `git diff --quiet` per file, not by memory:

- [x] `vscode-core/src/messaging/rpc-handler.ts` **UNMODIFIED** (assumption 2 — the
      `skillSynthesis:` prefix was already present; this task added fields to an
      existing namespace, not a namespace).
- [x] `rpc-handlers/.../skills-synthesis-rpc.handlers.ts` **UNMODIFIED** (assumption 3 —
      the schema-driven loop needed no handler change).
- [x] `platform-core/src/file-settings-keys.ts` **UNMODIFIED** (assumption 1).
- [x] `skill-synthesis/src/lib/queue/skill-drain.service.ts` **UNMODIFIED** (assumption 1).
- [x] No phase-3 gate key added to the DTO (RISK-3) — grep for `replayValidation.`,
      `triggerEval.enabled`, `judgePanel.enabled`, `judgePanel.disagreement` in
      `rpc.types.ts` returns **0**.
- [x] `maxAttempts: [3]` untouched (RISK-4) — still seeded `3`, now at line 781 having
      shifted only by the two inserted controls.

### Files belonging to TASK_2026_242 (the exact staging list)

A commit must stage these **nine** paths and nothing else. The working tree carries
substantial unrelated dirt from parallel agents — `libs/backend/agent-sdk/*`,
`apps/ptah-docs/astro.config.mjs`, the tribunal docs, `.ptah/specs/TASK_2026_239/*`,
`.ptah/specs/TASK_2026_247/*`, `.ptah/specs/TASK_2026_257/*` — so `git add -A` or
`git commit -a` would be wrong.

**Batch 1 — backend schema**

1. `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts`
2. `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.spec.ts`

**Batch 2 — shared DTO + docs**

3. `libs/shared/src/lib/types/rpc.types.ts`
4. `apps/ptah-docs/src/content/docs/skill-synthesis/settings.md`
5. `libs/backend/skill-synthesis/CLAUDE.md`

**Batch 3 — frontend**

6. `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts`
7. `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.spec.ts`
8. `libs/frontend/skill-synthesis-ui/src/lib/components/skill-settings-panel.component.ts`
9. `libs/frontend/skill-synthesis-ui/src/lib/components/skill-settings-panel.component.spec.ts`

Plus, if the task-spec bookkeeping is committed alongside: `.ptah/specs/TASK_2026_242/`
(`task.md`, `context.md`, `tasks.md` — note `tasks.md` is currently **untracked**).

---

## Status Icons

| Status         | Meaning                               | Who Sets    |
| -------------- | ------------------------------------- | ----------- |
| ⏸️ PENDING     | Not started                           | team-leader |
| 🔄 IN PROGRESS | Assigned to a developer               | team-leader |
| 🔄 IMPLEMENTED | Developer done, awaiting verification | developer   |
| ✅ COMPLETE    | Verified, reviewed and committed      | team-leader |
| ❌ FAILED      | Verification failed                   | team-leader |
