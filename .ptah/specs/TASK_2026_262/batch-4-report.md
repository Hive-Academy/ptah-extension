# TASK_2026_262 — Batch 4 report

**Headline**: docs and carrier closed. Batch 3 is recorded as ❌ CANCELLED with
the five-call-site argument and the accepted cost written inline rather than
flipped silently; `auth-providers/CLAUDE.md` now carries tier derivation as a
real concern of the lib, built around the fact that **three separate writers
carry the same precedence chain and two of them were found only by going to
look**. Gate unmoved, as a docs-only batch should leave it.

Nothing committed, nothing staged. Four files touched, all of them mine. No file
under `libs/frontend/**`, `libs/backend/task-specs/**`,
`agent-sdk/src/lib/permission/**`, `apps/ptah-extension-vscode/assets/plugins/**`
or any other session's `.ptah/specs/TASK_2026_2*/task.md` was read, edited or
staged.

---

## Files changed

| File                                                                | What                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `D:/projects/ptah-extension/.ptah/specs/TASK_2026_262/tasks.md`     | Batch 3 cancelled with its reasoning inline; batches 1, 2, 4 and all 13 task markers set to real state |
| `D:/projects/ptah-extension/libs/backend/auth-providers/CLAUDE.md`  | new `## Tier derivation` section + 2 existing bullets extended                                         |
| `D:/projects/ptah-extension/libs/backend/skill-synthesis/CLAUDE.md` | verified against shipped code; 2 pre-existing markdown artifacts repaired                              |
| `D:/projects/ptah-extension/.ptah/specs/TASK_2026_262/task.md`      | `status:` line only, `in_progress` → `in_review`, via `Edit`                                           |

`context.md` untouched, as instructed — it stays the historical record of the
investigation.

---

## 1. `tasks.md` — Batch 3 cancelled, and the rest marked honestly

### The cancellation is a recorded decision, not a status flip

A new `### ❌ CANCELLED — the go/no-go, and why it went no` block sits directly
under the batch's own conditional clause, so the clause and the outcome read
together. It records three things the brief asked for and one more the reports
made worth keeping.

**Why it went no — the structural half.** `ModelResolver.resolve` returns
`string` and is reached through `IModelResolver` from five synchronous call
sites, **three of which are session-history reads**
(`session-history-reader.service.ts:499,589,725`). Giving `resolve` a failure
mode makes a _past_ session unreadable because the _present_ provider has no
catalogue. Stated in the file as inherent rather than fixable — it can be
relocated but not engineered away, which is what makes it decisive rather than
merely expensive. The other two callers reinforce it: the OpenRouter passthrough
has no error channel and its 404 _is_ the error, and the profile resolver's
ladder terminates in `model` with no failure route.

**Why it went no — the proportionality half.** Before Batch 1 the chat failure
was permanent, silent and universal across three providers, which is what would
have justified the channel. After Batches 1 and 2 it is none of the three, so
building it now sizes machinery for a permanent condition one batch after the
change that stopped it being permanent.

**The accepted cost, recorded as a cost.** A user inside the refresh window, or
with LM Studio's `/v1/models` down while inference is up, gets a **raw provider
404**. Ptah's log carries `warnUnservableTierValue`, so support diagnoses it in
one line, but **the user cannot self-diagnose without opening the log**. Written
in plainly, because a cancellation that only records the reasons for saying no
reads later as if there were no downside.

**The escape hatch, named.** If that cost is ever judged unacceptable, the
proportionate answer is **surfacing the existing warn where the user already
is** — the message still sends and the explanation sits beside the 404 — not
threading a failure channel through four callers and a synchronous history-read
path. Re-opening the batch as originally scoped means re-arguing the
five-call-site point.

I also carried forward the recommended re-point (Batch 1 residual item 3:
`provider:listModels` warms both caches but never re-runs `applyPersistedTiers`,
needing the `providerId === resolveActiveProviderId()` guard), since both batch
reports independently landed on it as the higher-value use of any budget spent
here.

Task 3.2 is marked `❌ CANCELLED — no_change_needed`, and its verification line
now records that R6 was never armed: no RPC namespace was added anywhere in this
carrier, and no file in `libs/shared` or `libs/backend/vscode-core` was touched
by any batch.

### Every other marker set to its real state

Header counter is now `3 complete, 1 cancelled`. Batches 1, 2 and 4 are ✅
COMPLETE. All 13 task-level markers moved off ⏸️ PENDING, four of them carrying
their outcome in the heading where the outcome was the point — 1.6 (`both LEFT,
argued`), 1.7 (`recommended NO, Batch 3 cancelled`), 2.2 (`zero production
change here; a FOURTH tier-writer found one lib down`) and 2.3
(`no_change_needed`). A reader scanning headings should not have to open a report
to learn that a task's answer was "leave it".

---

## 2. `auth-providers/CLAUDE.md` — tier derivation as a lib concern

New `## Tier derivation` section between `Internal Structure` and
`Dependencies`, plus one added bullet in `Boundaries → Belongs here` and one in
`Internal Structure`. Written for the next person to touch this code, not as a
changelog — no batch numbers, no diffs, no restatement of what the reports
already carry.

**The framing it opens with** is the one thing every other paragraph depends on:
the three tier env vars are the whole mechanism, `resolve` reads them and
substitutes nothing else, so **whatever fails to populate them is where the bug
is and `resolve` is never where it gets fixed**. Anyone arriving at this file
after a 404 will otherwise start reading `resolve`, which is what the original
defect trained people to do.

**`model-tier-derivation.ts`.** Documented as an exported pure function with the
by-construction property that makes the "no invented ids" rule self-enforcing —
every returned string is `===` an id on an input entry — and the `{}`-on-garbage
contract with its reason (a wrong-but-servable model is worse than a 404 because
it is silent). Why a module and not a private method: three writers need the same
rule and a copied rule diverges; and it is arithmetic on an array with no
business touching the service's I/O, cache, logger or env. Readers are pointed at
the file's own docblock before changing the rule.

**Context length over price, with the reason that decides it**: ranking by price
selects the top tier **because it is expensive**, so on a ~200-model router a
user's first message silently goes to the priciest listing. Context length cannot
make that mistake, and its own failure — a small long-context model out-ranking a
large short-context one — is quality-only and reversible by picking a model. The
section ends with "do not 'improve' this to price without engaging with that",
because price is the change a future reader will reach for first.

**The four sites, as a table, called out as the load-bearing fact.** Three
writers — `applyPersistedTiers` (shared `authEnv` + `process.env`),
`WorkspaceProviderProfileResolver.applyProviderTiers` (per-workspace snapshot),
`ProviderAuthResolver.buildTierValues` (lane / curator override) — each with its
own copy of `user pick ?? registry defaultTiers ?? live-derived`, plus
`ModelResolver.resolve` as the single reader that deliberately has no derivation
of its own. It also records why all three go through the one
`getLiveDerivedTiers` accessor instead of calling the pure function directly:
**two things must agree, the rule and the source**, and a source disagreement is
invisible because both sides look correct in isolation.

The fifth-site warning is explicit and carries its evidence: a new writer that
stops at `persisted ?? defaults` silently reverts to the original bug and **will
look fine in review**, because that two-link chain is what the other three used
to say. Named as not-hypothetical — writers #2 and #3 were found only by going to
look, **one batch apart**, #2 during planning and #3 only after tracing the lane
path by hand inside a batch scoped as no-op verification. Nothing detects a
missing link; the failure is a provider 404.

**Why a lane needs its own link.** `buildLaneEnv` blanks every
`ALL_TIER_ENV_KEYS` entry out of the ambient env by design, so background work
cannot inherit the chat provider's mapping — which means **writer #1's value
arrives on the lane path only to be deleted**, and a fix applied only to the chat
path is thrown away there. The `undefined`-not-`delete` detail is kept with its
consequence (never serialize or normalize a lane env), as are the two deliberate
properties: derive for the **resolved** provider never the active one, and write
snapshot-only.

**What did not change**, in its own subsection so it cannot be skimmed past: the
registry. **3 of 11 entries still declare no `defaultTiers` and that figure is
correct and must not be "fixed"** — what moved is the fallback _below_
`defaultTiers`. And `requesty-provider-entry.ts:19-23`'s "tiers come from the
live model list instead" is documented as **implemented rather than
aspirational** — "read it as a spec that is met, not as a TODO".

**Two further things carried because the next reader needs them and neither
report is a place they will look**: the precedence order with its rationale
plus the `autoResolveDefaultTiers` violation (persists a heuristic into the
user-choice slot, no activeness guard, recommended for deletion — flagged by
Batch 1 and re-confirmed by Batch 2), and the freshness model (sync read only,
fire-and-forget refresh, bounded by `tierRefreshInFlight`, nothing on a timer)
with the residual window and the deliberately un-narrowed warn.

---

## 3. `skill-synthesis/CLAUDE.md` — verified, two artifacts repaired

Batch 2's corrections **read correctly against what shipped**. I checked each
claim against source rather than against the batch report, and rewrote nothing
that was already right.

- The "Lane resolution is three lines" bullet claims `buildTierValues` rebuilds
  from "the RESOLVED provider's persisted lane tier, then its registry
  `defaultTiers`, then its LIVE catalogue". Verified against
  `provider-auth-resolver.ts:333-335`, which is literally
  `overrides.X ?? defaults?.X ?? derivedFor('X')` for all three tiers. Correct.
- Its `buildLaneEnv` claim — blanks `ALL_TIER_ENV_KEYS`, so a chat-path-only fix
  "arrives at a lane just to be deleted", and the two chains "share the
  derivation and differ only in where they write" — matches
  `provider-auth-resolver.ts:264-268` and the shared `getLiveDerivedTiers`
  accessor. Correct.
- The "Inherit keeps a PINNED default" bullet keeps **3 of 11** verbatim with
  "that figure is unchanged and correct; no registry entry was edited", states
  that what changed is the fallback below `defaultTiers`, and reframes the
  condition from "which provider" to "has that provider's catalogue been fetched
  yet" — with the honest residual that inside the window the pinned id still goes
  verbatim. All correct.
- Its claim that the other half of the old caveat is "settled and ruled out"
  matches Batch 1's eight-site R4 trace. Correct.

**Two pre-existing markdown artifacts repaired** (see "Found stale" below).
Nothing else changed in the file.

---

## 4. Carrier

`.ptah/specs/TASK_2026_262/task.md` — `status: in_progress` → `status: in_review`,
by `Edit` on that one line. The `>-` block scalars on `title` and `description`
were not touched; nothing else in the frontmatter or body moved.

---

## Found stale beyond the listed scope

1. **`TASK*2026_250` in `skill-synthesis/CLAUDE.md` — FIXED.** A markdown
   emphasis pass had eaten the underscore, leaving a task id that does not grep
   and does not match the repo's `TASK_YYYY_NNN` convention. Confirmed
   pre-existing (present in `14f9c81ba~1`, so not Batch 2's doing). One
   character, zero risk, and task ids are how these docs cross-link.
2. **`\_and*` in the same bullet — FIXED.** Mangled `_and_` emphasis rendering
   as literal backslash-underscore-asterisk mid-sentence. Also pre-existing.
   Replaced with `**and**`, which is what the sentence wants — `openrouter` is
   `DEFAULT_PROVIDER_ID` _and_ the registered `anthropicProviderId` default.
3. **`auth-providers/CLAUDE.md` "Public API" section is badly stale — NOT
   FIXED, and it should be.** It still reads "Batch 17 scaffold — surface is
   intentionally empty. Subsequent batches in Win 5 will export: …", which was
   true during TASK_2026_123 and has been false for a long time — the lib
   exports a real surface today. I left it alone deliberately: correcting it
   means reading `src/index.ts` and reconciling the whole list, which is a
   different piece of work from this carrier's subject and would bury the tier
   derivation change in unrelated churn. Flagging it as worth its own small
   task. Note that my one addition here is consistent with leaving it: the
   derivation is documented as deliberately **not** in the barrel, so it does
   not belong in that list either way.
4. **`model-resolver.ts:38-48` cited in `skill-synthesis/CLAUDE.md` — NOT
   FIXED, judged not wrong enough.** The `claude-*` branch is actually at
   `:39-50`. The citation brackets the right code and lands a reader inside the
   right function; churning a doc line number for one line of drift costs more
   in review noise than it buys. Recording it rather than silently leaving it.

---

## Gate

`npx nx run-many -t test lint typecheck -p auth-providers skill-synthesis` —
**all 6 targets succeeded, exit 0.** `auth-providers` came back from the Nx cache
on the first run, so I re-ran it with `--skip-nx-cache` to report measured rather
than replayed numbers. Real numbers:

```
auth-providers    Test Suites: 33 passed, 33 total            | Tests: 590 passed, 590 total
skill-synthesis   Test Suites: 6 skipped, 62 passed, 62 of 68 | Tests: 37 skipped, 1260 passed, 1297 total

lint  auth-providers   ✖ 2 problems (0 errors, 2 warnings)
lint  skill-synthesis  ✖ 30 problems (0 errors, 30 warnings)
typecheck              (clean, both)
```

**Identical to Batch 2's exit numbers on every line** — 33/590 and 62-of-68/1260,
warnings at the TASK_2026_250 baseline of 2 and 30. That is the expected result
for a docs-only batch and is the point of running it: a moved number here would
have meant I touched something I should not have. `auth-providers`' 2 remain the
same two `no-non-null-assertion` warnings in
`translation/responses-stream-translator.ts:312` and
`translation/translation-proxy-base.ts:107`. No new warning anywhere; no source
file was edited by this batch.

Prettier run over all four changed files — it reformatted the new table in
`auth-providers/CLAUDE.md` and reported the other three unchanged.

---

## One thing I did not take at face value

The brief described "FOUR tier-population sites" and listed `resolve()`'s own
read as the fourth. **Three of those four populate; the fourth consumes.**
`ModelResolver.resolve` reads `env[TIER_ENV_VAR_MAP[tier]]` at `:43` and `:59`
and writes nothing — it is the reader all three writers feed, and it is
deliberately the one site with no derivation of its own, which is exactly
Assumption 1's point that it cannot become async.

I documented it as four sites in the chain with the writer/reader split made
explicit in the table, and pinned the actionable rule to the writers: **a fifth
site means a fourth writer, and it must wire the derivation in.** Writing "four
writers" would have been the more literal reading of the brief and would have
sent someone looking for a derivation link inside `resolve` — the one place the
carrier spent a whole task establishing must not have one. Flagging the
divergence rather than quietly resolving it, since the count itself was
load-bearing in the instruction.

---

## Batch 4 verification checklist

| Item                                                                       | Status                                                                             |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Batch 3 marked ❌ CANCELLED **with the reason recorded inline**            | ✅ five-call-site argument, proportionality argument, accepted cost, escape hatch  |
| Batches 1, 2, 4 marked with real status                                    | ✅ plus all 13 task-level markers and the header counter                           |
| `auth-providers/CLAUDE.md` covers the derivation module + the price choice | ✅ with the "because it is expensive" reasoning stated                             |
| The FOUR sites documented as the load-bearing fact                         | ✅ table + explicit fifth-site rule + how #2 and #3 were found, one batch apart    |
| `buildLaneEnv` blanking → a lane needs its own link                        | ✅ own subsection                                                                  |
| `requesty-provider-entry.ts:19-23` recorded as implemented                 | ✅ "read it as a spec that is met, not as a TODO"                                  |
| "3 of 11" left alone everywhere it appears                                 | ✅ preserved in `skill-synthesis/CLAUDE.md`, restated as must-not-fix in the other |
| `skill-synthesis/CLAUDE.md` verified, not rewritten                        | ✅ claims checked against source; only 2 pre-existing artifacts repaired           |
| Carrier `status:` line only, via `Edit`                                    | ✅ `in_progress` → `in_review`                                                     |
| `context.md` untouched                                                     | ✅                                                                                 |
| Gate run, real numbers reported                                            | ✅ 6/6 targets, unmoved from Batch 2                                               |
| Nothing committed, no other session's work touched                         | ✅ `git status` shows exactly the four intended files                              |
