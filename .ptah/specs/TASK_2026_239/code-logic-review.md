# Code Logic Review — TASK_2026_239 (documentation accuracy)

Scope: `apps/ptah-docs/src/content/docs/tribunal/{index,council,forge,race,relay,crucible}.md`
plus `apps/ptah-docs/astro.config.mjs`. Everything else dirty in the tree was ignored per brief.

## Review Summary

| Metric                       | Value                                   |
| ---------------------------- | --------------------------------------- |
| Overall Score                | 8.5/10                                  |
| Assessment                   | NEEDS_REVISION (one sentence, one edit) |
| BLOCKING                     | 0                                       |
| MAJOR                        | 1                                       |
| MINOR                        | 3                                       |
| Informational / unverifiable | 2                                       |

This is an unusually accurate docs change. Every number, every blocking rule, every
banner state and the whole cost arithmetic traced to a source. The findings below are
real but narrow; three of the four are precision problems in `index.md`, not invented UI.

---

## FINDINGS

### F1 — MAJOR — `index.md:44` tells the user a same-vendor Crucible roster is allowed, then blocks it

**Docs claim** — `apps/ptah-docs/src/content/docs/tribunal/index.md:44`:

> For the two **role** moves — Relay and Crucible — a lane is not just a panelist, it is a
> **role slot**. Relay has four (plan, architect, implement, review) and Crucible has two
> (executor, judge). **You assign a vendor and a model to each slot, the same vendor may fill
> two slots on different models**, and the roster is validated before launch: Relay blocks a
> review lane identical to its implement lane, and Crucible blocks a judge from the same
> family as its executor.

The bolded permission is stated for **both** role moves. It is true of Relay and false of
Crucible.

**Contradicted by** — `libs/frontend/tribunal-panel/src/lib/services/tribunal-roster-rules.ts:100-111`:

```ts
const executor = laneFor(lanes, 'executor');
const judge = laneFor(lanes, 'judge');
if (executor && judge && executor.family === judge.family) {
  issues.push({ severity: 'block', message: `The judge must be a different vendor family from the executor. …` });
}
```

The Crucible check is on `family` alone — **the model is never consulted**. Compare Relay
at the same file `:62-81`, which blocks only on `family` **and** `normalizeModel()` matching
and downgrades same-family/different-model to `severity: 'warn'`. So the same vendor on two
different models is _permitted_ in Relay and _blocked_ in Crucible, and `index.md:44` states
the Relay rule as if it covered both. `rosterIsLaunchable` gates the Next button
(`tribunal-wizard.component.ts:224-227`) and the Open Tribunal button
(`step-run.component.ts:126-131`), so the user is hard-stopped.

**Failure scenario** — a user with two vendor families reads line 44, opens the Crucible
roster, picks the same vendor for Executor and Judge on two different models expecting the
documented "two slots on different models" behaviour, and the wizard refuses to advance. The
trailing clause of the same sentence does state the correct rule, but a permission followed
by its own exception 20 words later reads as a contradiction, not a qualification.

Note the writer got this right everywhere else: `crucible.md:84` states only the two blocking
rules, `crucible.md:119` correctly scopes it ("blocked **in the panel**", which is the right
distinction from the skill reference at `references/crucible.md:53`, where a same-family judge
is permitted on explicit request), and `relay.md:55` states the Relay rule correctly. It is
this one generalized sentence that is wrong.

**Corrected wording** for `index.md:44` (split the permission per move):

> …Relay has four (plan, architect, implement, review) and Crucible has two (executor, judge).
> You assign a vendor and a model to each slot, and the roster is validated before launch. In
> Relay the same vendor may fill two slots on different models — only an identical
> implement/review lane is blocked, and a same-family review is flagged as a weaker signal. In
> Crucible it may not: the judge must come from a different vendor family than the executor,
> whatever the model.

---

### F2 — MINOR — `index.md:40` attributes the conductor's auto-assembly and its 3-lane budget to the wizard

**Docs claim** — `index.md:40-42`:

> Tribunal takes one lane per family, ordered by preference, **up to a concurrency budget of
> three by default**. A family that is present **joins automatically**; … a newly installed
> agent or a newly configured provider **joins the next Tribunal on its own**.
>
> … The wizard shows you the live list, with a **Refresh** button next to it.

Both statements are true of the **conversational** path and of nothing in the panel.

**Source for the true half** — `references/vendor-panel.md:66-68`: bucket by family, "Take
**one** panelist per family, ordered by `preferredRank`", "Cap to the concurrency budget
(default **3**…)". That is §2, and `references/vendor-panel.md:36` scopes §2 explicitly:
"Only fall back to the discovery/selection algorithm below when the prompt does **not** carry
explicit panelist lines (i.e. Tribunal was triggered conversationally, not from the UI)."
`references/vendor-panel.md:30` is even blunter about the UI path: "**Skip §2
discovery/selection entirely.** … do NOT apply family-spread, and do NOT collapse duplicate
vendors."

**Contradicted for the wizard by**:

- `libs/frontend/tribunal-panel/src/lib/services/tribunal-state.service.ts:28` —
  `export const TRIBUNAL_MAX_VENDOR_TILES = 8;`
- `step-panel-preview.component.ts:65` renders "Up to {{ maxVendors }} lanes" — i.e. **8**,
  not 3 — and `:329` binds `maxVendors = this.discovery.maxVendors`.
- Nothing auto-joins: every lane is added by an explicit click,
  `step-panel-preview.component.ts:423 addInstance()` / `step-role-roster.component.ts:293
onVendorChange()`. A newly installed agent appears in the picker only after
  `TribunalDiscoveryService.rediscover()` (`tribunal-discovery.service.ts:134`), which is
  exactly what the Refresh button in the next sentence calls.

**Failure scenario** — a user with five configured providers reads "up to a concurrency budget
of three", opens the wizard expecting a three-lane ceiling, and finds an eight-lane cap with an
empty panel that assembles nothing on its own. Harmless, but the paragraph is now the _only_
place the docs explain panel assembly, so the conflation lands on every reader.

**Corrected wording**:

> Each installed CLI is its own **vendor family**, and each configured provider is its own
> family too. When you trigger Tribunal from chat, it takes one lane per family, ordered by
> preference, up to a concurrency budget of three by default — a family that is present joins
> automatically, one that isn't is simply absent. When you convene from the panel you pick the
> lanes yourself from the same discovered list (up to eight), and a newly installed agent or
> newly configured provider shows up as soon as you hit **Refresh**.

---

### F3 — MINOR — `index.md:47` says the single-family case just runs; the skill asks first

**Docs claim** — `index.md:47`: "With only one available, **it runs that single lane** and
labels the result a single-voice answer, not a tribunal."

**Contradicted by** — `references/vendor-panel.md:71`: "If fewer than **2 families** remain,
surface that and **ask whether to proceed single-voice or stop**."

**Failure scenario** — a single-vendor user fires a Council expecting an answer and gets a
confirmation prompt instead. Small, but the sentence promises an automatic behaviour the
protocol deliberately gates. (Carried over from the pre-change wording, but the line was
edited in this diff so it is in scope.)

**Corrected wording**: "With only one available, Tribunal says so and asks whether to proceed
single-voice — one lane, labelled as a single-voice answer rather than a tribunal — or stop."

The rest of that note is correct: Crucible's hard block is
`step-pick-move.component.ts:262-271` (`blockedReason`, `availableFamilyCount() >= 2`),
`isEnabled()` at `:282`, and the "Configure a provider" shortcut at `:139-162`.

---

### F4 — MINOR — `index.md:75-80` numbers Run as step 4 for every move; flat moves see three steps

**Docs claim** — a single numbered list, 1 Move → 2 Panel/Roster → 3 Rubric ("Crucible only")
→ 4 Run.

**Contradicted by** — `tribunal-wizard.component.ts:200-209`:

```ts
const kinds: WizardStepKind[] = ['move', this.laneStepKind()];
if (this._move() === 'crucible') kinds.push('rubric');
kinds.push('run');
```

The step rail renders `{{ step.index + 1 }}` (`:76`), so Council/Forge/Race show **3 · Run**
and only Crucible shows **4 · Run**. `crucible.md:81` ("the wizard walks four steps") is
correct precisely because it is Crucible-scoped; `index.md` is not.

**Failure scenario** — cosmetic only; a Council user counting steps sees three where the docs
promised four. The "Crucible only" tag on item 3 largely self-corrects it.

**Corrected wording**: introduce the list as "A wizard walks you through the run before it
spends anything — three steps, or four for Crucible:" and re-tag item 3 as
"**Rubric** (Crucible only, inserted before Run)".

---

## Informational — not defects

### I1 — `<Card>` / `<CardGrid>` do not render on `index.md`, and the new `icon="star"` is inert

The writer disclosed this in `docs-changes.md:103-110` and I confirmed it against the build
output rather than taking it on trust. `dist/apps/ptah-docs/tribunal/index.html` contains:

- the literal text `import { Card, CardGrid } from '@astrojs/starlight/components';` rendered
  as a paragraph (smart-quoted by the markdown typographer, so it is definitely prose);
- `<cardgrid>` and five lowercased `<card title="…" icon="…">` unknown elements.

So the new Crucible card's body text and its `[How it works →]` link **do** reach the page —
nothing is lost — but it is not a card, and `icon="star"` (which does exist in
`node_modules/@astrojs/starlight/components-internals/Icons.ts`) never renders. This is
pre-existing, site-wide, and correctly out of scope; I am recording it only because the
changelog's "verified present in Icons.ts" could read as "verified rendering". Worth the
follow-up ticket the writer proposed.

### I2 — unverifiable, not contradicted

`crucible.md:10` — "A cheap model gets a well-specified task roughly 80% right, and a strong
reviewer can close the rest in two rounds". This traces verbatim to `references/crucible.md:21`,
so it is faithfully reported, but the 80% figure has no measurement behind it anywhere in the
repo. Faithful ≠ true. Flagging, not scoring against it.

---

## Verified correct — the claims I tried hardest to break

| Claim                                                                                                                                         | Docs                                           | Source of truth                                                                                                                                                                                                                                                              | Verdict |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Crucible verdict readout: round-of-cap, verdict chip, per-defect severity + `file:line` + what's wrong + what correct looks like, mentor note | `crucible.md:88`                               | `crucible-verdict-panel.component.ts:117` (`Round {{currentRound}} of {{roundCap}}`), `:127-135` chip, `:196-234` defect id/severity/location/what/`Expected:`, `:239-251` mentor note via `MarkdownBlockComponent`                                                          | ✅      |
| Four end-of-loop banner states: PASS-as-opinion, cap-with-defects, REJECT, regression stop                                                    | `crucible.md:88`                               | `TERMINATION_COPY` at `crucible-verdict-panel.component.ts:58-82`; `CrucibleTermination` at `tribunal-ui.types.ts:157-162` — exactly four terminal members                                                                                                                   | ✅      |
| Missing **and** unparseable verdicts both read "awaiting verdict", never PASS                                                                 | `crucible.md:90`                               | `chipFor()` `:346-348` maps `'unparsed' → 'awaiting'`; `chip()` `:300-303` returns `'awaiting'` with no rounds; `VERDICT_LABEL.awaiting = 'Awaiting verdict'` `:30`; plus the explicit "this is not a pass" line at `:163-171`                                               | ✅      |
| Crucible blocks unfilled slot, same-family judge, empty rubric                                                                                | `crucible.md:84-85`                            | `tribunal-roster-rules.ts:92-111`; rubric gate `tribunal-wizard.component.ts:228-229` (`canAdvance` on `rubric().trim().length > 0`) + `step-crucible-rubric.component.ts:100-105`                                                                                           | ✅      |
| Relay blocks identical review lane, _warns_ on same-family                                                                                    | `relay.md:55`, `index.md:44`                   | `tribunal-roster-rules.ts:69` `severity: 'block'` vs `:77` `severity: 'warn'` — the block/warn distinction is stated correctly, which is the trap this review was set to catch                                                                                               | ✅      |
| Relay four-step phase rail: status, lane, reassignment, deliverable link; "progress unavailable" when no spec folder                          | `relay.md:57`                                  | `relay-phase-rail.component.ts:80-145` + the two-arm `:146-161`; `tribunal-progress.service.ts:88` `NO_SPEC_FOLDER_REASON`, `:216-221` relay arm returns the `unavailable` value; `step-run.component.ts:154-157` warns at launch                                            | ✅      |
| Rail/readout sit **above the lane tiles**                                                                                                     | `relay.md:57`, `crucible.md:88`                | `tribunal-page.component.ts:112-151` progress strip precedes the `<gridstack>` at `:153-192`; conductor chat is the left `<aside>` `:75-80`                                                                                                                                  | ✅      |
| "Refresh" control on the panel **and** the role picker                                                                                        | `index.md:42`, `council.md:107`                | `step-panel-preview.component.ts:68-82` + `:369 refresh()`; `step-role-roster.component.ts:75-89` + `:281`                                                                                                                                                                   | ✅      |
| "Convene a Tribunal" dashboard entry                                                                                                          | all five pages                                 | `libs/frontend/dashboard/src/lib/components/dashboard-grid/dashboard-grid.component.html:22,35` (also `tribunal-empty-state.component.ts:25,71`)                                                                                                                             | ✅      |
| Wizard flags — not disables — Relay/Crucible when the tribunal skill is missing                                                               | `index.md:85`, `relay.md:59`, `crucible.md:97` | `step-pick-move.component.ts:48-51` `SKILL_DEPENDENT_MOVES`, `:111-123` advisory badge, `:164-170` note. The **only** disable is Crucible on `<2` families (`:262-271`). The changelog's "Correction to the task brief" is right and the docs follow the code, not the brief | ✅      |
| Rubric 3–7 criteria; frozen after round 1                                                                                                     | `crucible.md:18,41,43`                         | `references/crucible.md:59,73`; UI copy `step-crucible-rubric.component.ts:44-47`                                                                                                                                                                                            | ✅      |
| Round cap 2; 3rd only on explicit mid-run request; never a 4th                                                                                | `crucible.md:69`                               | `references/crucible.md:111,153`; `MAX_CRUCIBLE_ROUND_CAP = 2` `step-crucible-rubric.component.ts:28`, clamped on output `:142-148`; UI renders an over-cap round as "user-authorised" rather than clamping (`crucible-verdict-panel.component.ts:119-126`)                  | ✅      |
| Regression stop = defect count did not fall **and** severity mix did not improve                                                              | `crucible.md:70`                               | `references/crucible.md:154` verbatim; banner copy `crucible-verdict-panel.component.ts:77-81`                                                                                                                                                                               | ✅      |
| Three verdicts `PASS`/`REVISE`/`REJECT`; REJECT never patched                                                                                 | `crucible.md:51-55`                            | `references/crucible.md:98-100`; `VERDICT_WORDS` `judge-report.parser.ts:62-66`; `nextRoundNote` suppressed on reject `crucible-verdict-panel.component.ts:334-344`                                                                                                          | ✅      |
| Defects without `file:line` are discarded                                                                                                     | `crucible.md:59`                               | `references/crucible.md:145`; `judge-report.parser.ts:224-225` — `LOCATION_RE` miss ⇒ `return null`. Note the parser keeps an off-contract _severity_ as `'unknown'` rather than dropping it; the docs never claim otherwise                                                 | ✅      |
| Mentor note ≤ 5 lines, names the pattern                                                                                                      | `crucible.md:61`                               | `references/crucible.md:95,102`                                                                                                                                                                                                                                              | ✅      |
| **Cost: 2 paid calls per round, ≈6 vendor calls at a cap of 2**                                                                               | `crucible.md:112`                              | `references/crucible.md:117,176`; `tribunal-estimate.ts:37` → `2 * (1 + roundCap) + 1` = **7** at cap 2 = 6 vendor calls + 1 conductor turn. The docs' "roughly six vendor calls plus the conductor's own turns" is exact                                                    | ✅      |
| Council ≈ `panel size × 2` calls, default 3 panelists                                                                                         | `council.md:107`                               | `tribunal-estimate.ts:25` `laneCount * 2 + 1`; `references/vendor-panel.md:68,124`                                                                                                                                                                                           | ✅      |
| Anonymization is best-effort, not airtight                                                                                                    | `council.md:40`                                | `references/vendor-panel.md:109` verbatim                                                                                                                                                                                                                                    | ✅      |
| Race: distinct families by default; same vendor repeatable on different models                                                                | `race.md:21,55`                                | `references/race.md:22,71`; `step-panel-preview.component.ts:423-443` mints a fresh instance index per repeat add, `:451-458` sets model per lane                                                                                                                            | ✅      |
| Relay phase names + deliverables                                                                                                              | `relay.md:55`                                  | `RELAY_ROLES` `tribunal-ui.types.ts:12-17`; `ROLE_COPY` `step-role-roster.component.ts:33-46`; `PHASE_LABEL` `relay-phase-rail.component.ts:27-32`; `references/relay.md:45-50`                                                                                              | ✅      |
| Family = one per installed CLI, one per configured provider                                                                                   | `index.md:40`                                  | `tribunal-discovery.service.ts:242` (`family: cli`) and `:274` (`family: provider.id`); `references/vendor-panel.md:66`                                                                                                                                                      | ✅      |

### Residual hardcoded vendor lists — verified, not trusted

Ran my own sweep over all six pages, wider than the writer's (added `gemini|gpt|opus|sonnet|
haiku|antigravity|opencode|deepseek|qwen|grok|llama|mistral|zai` to their list) and
case-insensitive:

```
grep -rniE "claude|codex|copilot|cursor|anthropic|openai|kimi|moonshot|glm|z\.ai|zai|ollama|
openrouter|github|gemini|gpt|opus|sonnet|haiku|antigravity|opencode|deepseek|qwen|grok|
llama|mistral" apps/ptah-docs/src/content/docs/tribunal/
→ exit 1, zero matches
```

**Zero matches**, including indirect forms — no vendor in an example, no table row, no
anonymization sample. The 8-row "Vendor family → CLI agent used" table is gone from
`index.md`, and `council.md:40` de-brands the old deference-effect quote without replacing it
with another brand. This was the headline goal of the change and it landed cleanly.

### Links and sidebar — verified

Every `/tribunal/...` and `/agents/...` target in the six pages resolves:
`council`, `crucible`, `forge`, `race`, `relay` all exist as `.md` under
`src/content/docs/tribunal/`, and `agents/agent-orchestration.md` exists. The new page is
reachable from the sidebar — `astro.config.mjs:84` adds
`{ label: 'Crucible', slug: 'tribunal/crucible' }` to the explicit `items` array after Relay,
which is the correct pattern for that section (no `autogenerate` mixing). Build output
confirms `dist/apps/ptah-docs/tribunal/crucible/index.html` is emitted. Frontmatter
(`title` + `description`, no colon-space hazard) matches the four siblings.

---

## Verdict

**Recommendation**: NEEDS_REVISION — apply F1, then this is APPROVED.
**Confidence**: HIGH (every finding is cited to a line in the shipped component or the shipped
skill reference; nothing rests on inference).
**Top risk**: `index.md:44` — the only claim in the change that would put a user in front of a
blocked wizard the docs told them would work.

F2–F4 are precision fixes in one file and can ship together or separately. I found no invented
UI, no wrong protocol number, no wrong cost arithmetic, no residual vendor roster, and no broken
link — which is not the outcome I expected going in.
