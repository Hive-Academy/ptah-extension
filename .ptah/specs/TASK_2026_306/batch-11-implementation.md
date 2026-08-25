# Batch 11 — Harness card on the Dashboard home (promoting the blocked-paths disclosure)

**Status**: Task 11.1 COMPLETE, Task 11.3 COMPLETE, **Task 11.2 NOT SHIPPED — ordering escape invoked**.
**Branch**: `ak/boot-blocker-quota-gate`. **Not committed.**
**Wire contract**: unchanged. `libs/shared` untouched by this batch (see §6 for the proof, and for
why `git status` shows two shared files modified anyway).
**Batch 7's component was CHANGED, not copied.** One new optional input. Details in §3 — flagged
here because it means Batches 7 and 11 now interlock and must be reviewed together.

---

## 1. Verification — actual output

All runs `--skip-nx-cache`.

| Command                                                          | Result                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx run-many -t test -p dashboard,marketplace`               | **dashboard: 3 suites / 34 passed. marketplace: 9 suites / 134 passed.** 0 failed either side                                                                                                                           |
| `npx nx run-many -t lint -p dashboard,marketplace`               | **dashboard: "All files pass linting". marketplace: 0 errors, 2 warnings** — `max-lines` on `external-marketplaces.component.ts` (753) and `smithery-surface.component.ts` (940), both pre-existing and both unmodified |
| `npx nx run-many -t typecheck -p dashboard,marketplace`          | **PASS** (`ngc --noEmit` against each `tsconfig.lib.json`)                                                                                                                                                              |
| `npx nx build ptah-extension-webview`                            | **PASS** — "Application bundle generation complete", initial total **2.27 MB / 483.61 kB** transfer                                                                                                                     |
| `npx nx run-many -t lint -p chat,ptah-extension-webview,ui,core` | **0 errors** across all four (11 and 17 pre-existing warnings on two of them). Run because this batch edits `tsconfig.base.json` and `eslint.config.mjs`, which widen the affected set far past the two libs            |
| `npx prettier --check` on all nine touched files                 | PASS                                                                                                                                                                                                                    |

`dashboard` and `marketplace` are both non-buildable Angular libs with no `build` target, so the
build gate is the app that consumes them — `ptah-extension-webview`, the shell for both the VS Code
and Electron hosts. `typecheck` is reported beside it because that is the target that actually runs
the Angular compiler over each lib in isolation.

**Test delta.** dashboard 23 → **34** (+11), exactly the new spec file's case count:
`thoth-status-pillars.spec.ts` 9 + `thoth-status.service.spec.ts` 14 = 23 pre-existing,
`harness-card.spec.ts` 11 new. marketplace is **134, unchanged from Batch 7's own figure** — which
is the check that the input added to Batch 7's component did not alter what that component renders
by default.

**Spec integrity.** `git diff -U0 -- '*.spec.ts'` shows exactly **one** removed line repo-wide, and
it is not mine: it is an import widening in
`libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.schema.spec.ts`, from the Batch 8
backend developer working concurrently. **My diff removes zero spec lines and weakens zero
assertions.** `harness-blocked-paths.spec.ts` is byte-identical to what Batch 7 wrote.

---

## 2. The one rule: `blockedTargetPaths` is still the single derivation

This is the third call site, and the whole point of the third one is that it cannot disagree with
the first two. It does not, and here is the inventory rather than the assurance.

```
$ grep -rln "blockedTargetPaths" libs apps --include=*.ts
libs/shared/src/lib/types/harness-sync.types.ts              definition (:338)
libs/shared/src/lib/types/harness-sync.blocked.spec.ts        its unit spec
libs/backend/harness-sync/.../harness-reconciler.service.ts   CALL — the boot WARN
libs/backend/harness-sync/.../harness-reconciler.blocked-logging.spec.ts
libs/backend/harness-sync/.../repair/blocked-repair.service.ts        CALL — Batch 8, in flight, not mine
libs/backend/harness-sync/.../repair/blocked-repair.service.spec.ts   Batch 8, not mine
libs/backend/harness-sync/src/index.ts                        COMMENT only — why it is not re-exported
libs/backend/harness-sync/src/lib/health/harness-health.ts    COMMENT only — pointer to where it moved
libs/frontend/marketplace/.../harness-health.model.ts         CALL — the popover, via harnessBlockedPaths
libs/frontend/dashboard/.../harness-card.component.ts         PROSE only (docblock, line 32)
libs/frontend/dashboard/.../harness-card.spec.ts              PROSE only (docblock, line 19)
```

**The dashboard does not call `blockedTargetPaths` and does not import it.** It calls
`harnessBlockedPaths`, which is Batch 7's flattening wrapper and the only thing in the frontend
that calls the shared function. Two mentions of the name in `libs/frontend/dashboard` are both
inside docblocks explaining why nothing here re-derives anything.

```
$ grep -rnE "\.foreign|\.missing" libs/frontend/dashboard/src --include=*.ts   (excluding specs)
(no hits)
```

Zero, in production source **and** in the spec file — the spec builds its fixtures through helpers
that assign `missing:` / `foreign:` as object literal keys, which is fixture construction, not a
property read. No `missing.filter(...)`, no `foreign.includes(...)`, no `new Set(missing)` anywhere
in the lib.

The strong form of this is not the grep, though — it is mutation **B** in §5, which replaces the
call with a `foreign` passthrough that compiles cleanly and is caught **behaviourally** by four
cases including the cross-surface agreement case. A second intersection here would not merely be
against the rules; it would fail the suite.

---

## 3. Two deviations from the task text — both deliberate, both measured

### 3.1 The card imports from a NARROW barrel, not `@ptah-extension/marketplace`

Task 11.1 says to reuse `HarnessBlockedPathsComponent` and `harnessBlockedPaths` "from the
`marketplace` barrel". **The intent — reuse, do not re-implement — is honoured exactly. The import
path is not, because the wide barrel is not reachable from here.**

`@ptah-extension/marketplace` (`src/index.ts`) is a **dynamic-import-only** entry point. It exports
`MarketplaceHubComponent` and the eight surfaces behind it, and `eslint.config.mjs` enforces that:
`checkDynamicDependenciesExceptions` lists only narrow subpaths, with the comment "A static import
of the BARE barrel still errors, which is exactly the regression guard we want: it is how an eager
consumer would silently pull the whole lib back into the initial bundle."

`DashboardGridComponent` is exactly that eager consumer. It is a **static** import in
`libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:43,112` — deliberately not
deferred, because the dashboard is startup-reachable via `ptah.openDashboard` (recorded in
`app.config.ts:62-67`). A card mounted there that statically imports the wide barrel drags the
Marketplace hub into the initial bundle.

**Measured, three builds of `ptah-extension-webview`, `--skip-nx-cache` each:**

| Variant                                               | Initial raw | Initial transfer | Δ transfer vs baseline |
| ----------------------------------------------------- | ----------- | ---------------- | ---------------------- |
| Baseline — card written but not mounted in the grid   | 2.27 MB     | **482.29 kB**    | —                      |
| **Shipped** — `@ptah-extension/marketplace/harness`   | 2.27 MB     | **483.61 kB**    | **+1.32 kB**           |
| Counterfactual — `@ptah-extension/marketplace` (wide) | 2.37 MB     | **498.13 kB**    | **+15.84 kB**          |

The narrow barrel saves **14.52 kB of initial transfer and ~0.10 MB raw**, on the boot path, for one
leaf component and one pure function. Same order as the numbers already recorded in that eslint
comment (`-126,834 B` for tasks-ui, `-40,694 B` for harness-builder), so this is the established
discipline rather than a new one.

So this batch adds `libs/frontend/marketplace/src/harness.ts` — a second narrow entry point beside
the existing `src/services.ts`, exporting `HarnessBlockedPathsComponent`, `harnessBlockedPaths` and
its two types. Nothing else. It deliberately does **not** re-export `HarnessHealthStore`: that lives
in `services.ts`, which is where `app.config.ts` already registers it in `MESSAGE_HANDLERS`, and one
service reachable from two paths is how a reader concludes there are two singletons. The card
therefore has two imports, each from the barrel that owns what it is asking for.

This required two root-config edits, both called out because root config is not usually in a
frontend batch's blast radius:

- `tsconfig.base.json` — one path mapping for `@ptah-extension/marketplace/harness`.
- `eslint.config.mjs` — one entry in `checkDynamicDependenciesExceptions`, plus a prose update. The
  existing comment said "Only the `/services` subpaths are exempt", and this is the first exemption
  that is not a `/services` barrel, so the comment now says what the rule actually is and why this
  one qualifies. **Reviewer: this is the change most worth a second opinion.** The alternative was
  to widen `services.ts` to carry a component, which would have broken its own documented "exports
  only services — no components" contract instead.

### 3.2 Batch 7's component gained one optional input — `reconcileStep`

Naive reuse would have shipped a lie. Batch 7's action paragraph reads "…then run **Reconcile
now**", which names a button sitting eight pixels below it **inside the Marketplace popover**. The
Dashboard card has no such button and deliberately never will (§4), so the reused sentence would
point at a control that is not on screen.

Per the brief's "extract and share rather than copy", the fix is one input on
`HarnessBlockedPathsComponent`, defaulting to the popover's exact wording:

```ts
public readonly reconcileStep = input<string>('then run Reconcile now.');
```

and the template interpolates it in place of that one clause. Everything else in the paragraph is
fixed and stays fixed. The dashboard passes `'then reconcile from Marketplace → Plugins.'`

Consequences, stated plainly:

- **Batch 7's rendered output is unchanged.** Its spec file was not edited and its suite is
  134/134 — the same figure Batch 7 reported. That is the evidence, not the intent.
- The anchored `/^Move the occupant aside/`, the "may be your own work" clause and "read it before
  you discard anything" are all **before or after** the varying clause and are untouched. Both
  Batch 7's case 6 and my case 7 still assert them, on their respective surfaces.
- **The two batches now interlock.** A reviewer reverting Batch 7 breaks Batch 11, and a reviewer
  reading `harness-blocked-paths.component.ts` is reading a file two batches own.

---

## 4. What the card is, and what it refuses to be

`libs/frontend/dashboard/src/lib/components/harness-card/harness-card.component.ts`, mounted
**first** in `dashboard-grid.component.html`, above the analytics and Builders cards. Additive: no
existing card moved, and the grid's header, Tribunal button, padding and spacing are byte-identical.

```
┌─ Harness blocked paths ──────────────────────────────────┐  (section, aria-label)
│  ⚠   Your harness is short                               │  h3
│      Some of what Ptah tried to install for your AI      │
│      tools is not there, and nothing failed installing.  │
│                                                          │
│  ┌─ <ptah-harness-blocked-paths> ───────────────────┐    │  Batch 7's component,
│  │ 13 blocked paths                                 │    │  imported, not copied
│  │ Something Ptah does not own already sits there…  │    │
│  │ Claude Code                                      │    │
│  │   .claude/skills/…                               │    │
│  │ Move the occupant aside — … — then reconcile     │    │  ← the one varied clause
│  │ from Marketplace → Plugins. Nothing here proves  │    │
│  │ Ptah wrote these, so they may be your own work…  │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

**Hidden entirely when nothing is blocked.** The whole `<section>` is behind
`@if (blocked().count > 0)`, so a healthy home grows no empty card and no placeholder. Pinned by
two cases and killed by mutation C.

**Undetected targets excluded**, because `harnessBlockedPaths` excludes them and this card must
agree with the badge that shares it. `summarizeHarnessHealth` drops undetected targets from every
count (an uninstalled Codex is not a gap, E17), so counting their blocked paths would put "1 blocked
path" on the home while the Marketplace badge says the harness is in sync. Same rule as Batch 7,
inherited rather than re-decided, and killed by mutation E.

**No control of any kind.** Not a repair button, not a consent checkbox, not a quarantine
affordance, not even a "reconcile" or a navigation link. The card's spec asserts
`querySelectorAll('button')`, `('input')` and `('a')` are all length 0 **over the whole card**, not
just the disclosure block inside it. Provenance of these paths is unknown — `SkillJunctionService`
linked skills and only copied commands, so it never wrote them, and the candidates include the
Claude Code SDK, the pre-TASK_2026_288 `npx skills add` path, and the user's own hand. A one-click
fix asserts an ownership Ptah cannot prove. The card names where Reconcile lives instead, in prose.

**Leads with move, never says delete.** The string is Batch 7's, so this holds by construction — but
it is re-asserted here rather than assumed, because the card lives in a different lib whose CI would
not otherwise notice the wording changing. Case 7 asserts the anchored `/^Move the occupant aside/`,
both warning clauses, and `not.toContain('delete')` over the **whole card's** text.

### Data: no contract change, no polling

`HarnessHealthStore` is `providedIn: 'root'` and is registered in `MESSAGE_HANDLERS` at bootstrap
(`app.config.ts:73,247`), so the edge-triggered `harness:healthChanged` push has already populated
it before anything on the home renders — including pushes that landed before this card existed. The
card reads the signal. **`rpc.types.ts` is untouched, no message constant was added, and `libs/shared`
is not in my diff.**

`ngOnInit` pulls `harness:health` **only when `store.health() === null`** — the cold case where
nothing changed at activation so the backend had nothing to broadcast. Deliberately unlike the
Marketplace badge, which refreshes unconditionally: the badge mounts when a user chooses to open a
page, whereas this card mounts at boot on every window, and asking the backend to re-answer a
question already sitting in the signal would spend a round trip to learn nothing. Both directions
are pinned — mutation G (always pull) and mutation H (never pull) each kill exactly one case.

### Standards

`ChangeDetectionStrategy.OnPush`; standalone; signals and `inject()` throughout (`computed`, and
`input`/`input.required` on the reused component); no `[innerHTML]` on any path — paths render
through ordinary interpolation inside `<code>` in Batch 7's component. Tailwind/daisyui classes are
whole literal strings so the scanner sees them. `aria-label="Harness blocked paths"` on the section,
`<h3>` for the card title matching the sibling cards' level. `HarnessCardComponent` is 153 lines,
`harness-card.spec.ts` is 451 — nothing near the 700-line ceiling, and nothing in this batch was
split to satisfy it.

Complexity Level **1**: one injected store, one `computed`, one lifecycle call, no local state, no
output. Explicitly rejected: a container/presentational split (there is one consumer and no
branching UI logic to lift), a card-level store (the root store already exists and sharing it is
what makes the two surfaces agree), and any local view model beyond the one `computed`.

---

## 5. Task 11.2 — NOT shipped, ordering escape invoked

Task 11.2 routes the card into Batch 9's consent dialog. **Batch 9 has not landed** — Batch 8 is
being implemented concurrently by a backend developer right now (`libs/backend/harness-sync/src/lib/repair/`
and `.../quarantine/` are untracked in the working tree), and Batch 9 depends on Batch 8's RPC.

11.2's own criteria say: _"if Batch 9 has not landed, ship 11.1 alone and leave 11.2 pending rather
than stubbing a dead control. A button that opens nothing is worse than no button."_ That is what
happened. There is no placeholder, no disabled button, no `TODO` control, and no navigation stand-in
that a reviewer might mistake for the route. When Batch 9 lands, 11.2 adds **one** route, and the
card's "no controls" spec (case 9) is the case that will have to be deliberately amended to allow
it — which is the right place for that decision to become visible.

Task 11.3's criterion "where 11.2 landed: a spec that the route reaches the dialog" is
correspondingly not applicable. Its other four criteria are all covered (§6).

---

## 6. Spec inventory — counted, not estimated

**11 cases in 1 new file.** `grep -c "^\s*it("` on `harness-card.spec.ts` returns **11**;
`grep -c "it\.each\|test(\|it\.only\|fit("` returns **0**, so `it(` blocks equal Jest cases exactly.
Confirmed twice more: an isolated run of that file alone reports `Tests: 11 passed, 11 total`, and
the lib delta is 23 → 34.

The first two cases mount the **real `DashboardGridComponent`** — only the two unrelated sibling
cards are stubbed, and the harness card is real. A card-only test cannot tell a mounted card from an
unmounted one, and "unmounted" is precisely the state this batch was raised to fix. The agreement
case mounts the **real Marketplace badge** beside the card against **one shared store**.

### Mutation runs — nine, each reverted, final suite green at 11/11 and 34/34

| #   | Mutation                                                                             | Result                   |
| --- | ------------------------------------------------------------------------------------ | ------------------------ |
| A   | `<ptah-harness-card />` removed from `dashboard-grid.component.html`                 | **1 failed / 10 passed** |
| B   | card's `blocked` computed fed `missing = foreign` — a `foreign` passthrough          | **4 failed / 7 passed**  |
| C   | `@if (blocked().count > 0)` → `@if (true)` — card always renders                     | **3 failed / 8 passed**  |
| D   | card stops passing `[reconcileStep]`, inheriting the popover's button-naming wording | **1 failed / 10 passed** |
| E   | `if (!target.detected) continue;` removed from the shared `harnessBlockedPaths`      | **1 failed / 10 passed** |
| F   | action prose rewritten to `Delete whatever is at each of these paths, …`             | **1 failed / 10 passed** |
| G   | `ngOnInit` pulls unconditionally, ignoring the boot push                             | **1 failed / 10 passed** |
| H   | `ngOnInit` never pulls — listen-only                                                 | **1 failed / 10 passed** |
| I   | a `Move these aside for me` repair button added to the card                          | **1 failed / 10 passed** |

**Every one of the 11 cases is killed by at least one mutation. There are no cases that survive all
nine**, so this batch reports no preserved-behaviour guards — unlike Batches 7 and 10, where naming
them was the honest call. Each case pins exactly one property, which is why most mutations kill 1.

| #   | Case                                                                      | Killed by |
| --- | ------------------------------------------------------------------------- | --------- |
| 1   | renders the blocked-paths disclosure on the Dashboard home                | **A, B**  |
| 2   | adds no card to the home when nothing is blocked                          | **C**     |
| 3   | names the desired paths an unowned file occupies, and only those          | **B**     |
| 4   | stays hidden when the gaps and the foreign files are disjoint             | **B, C**  |
| 5   | ignores an uninstalled target, never claims a bigger shortfall than badge | **C, E**  |
| 6   | prints the same count as the popover for one report                       | **B**     |
| 7   | leads with move, may-be-your-own-work, never says delete                  | **F**     |
| 8   | names where Reconcile lives, since this surface has no such button        | **D**     |
| 9   | discloses only — no repair, consent or quarantine control                 | **I**     |
| 10  | renders from the boot push without asking for the report                  | **G**     |
| 11  | pulls once over the existing `harness:health` when no push has arrived    | **H**     |

**Mutation B is the one this batch exists to prevent**, and it is worth reading its kill list. A
`foreign` passthrough compiles, type-checks, and renders a plausible-looking list — and it takes
down case 6, the cross-surface agreement, because the popover keeps deriving correctly and the two
headings stop matching (13 vs 19). That is the single-derivation rule failing _observably_ rather
than by convention, which is the whole reason case 6 compares the two surfaces against **each
other** rather than each against a literal.

**Mutation A kills only case 1**, and that is correct rather than thin: case 2 mounts the home with a
**clean** report and asserts the card is absent, which stays true when the card is not in the grid at
all. Case 2 is discriminating against C, not A. Both are needed; neither is padding.

Task 11.3's criteria map as: _fails if the card is removed from the grid_ → A/case 1; _absent on a
clean report_ → case 2; _count equals the popover's_ → case 6; _no second intersection, Batch 7's
mutation B as the model_ → B/cases 1, 3, 4, 6.

**On the captured shape.** The agreement case uses `expected: 27, found: 14, missing: 13,
foreign: 19, writeFailed: 0` — `coldstart-306.log:844`'s counts. The thirteen `legacy-i` names are
**nominal**; nothing here reproduces the real workspace or establishes provenance. What it pins is
that at that size both surfaces show **13**, not 19, and that neither names the six
foreign-but-not-desired paths. Same honesty caveat Batches 6 and 7 applied to their own fixtures.

---

## 7. Files

**New**

- `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\harness-card\harness-card.component.ts`
- `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\harness-card\harness-card.spec.ts`
- `D:\projects\ptah-extension\libs\frontend\marketplace\src\harness.ts`

**Modified**

- `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\dashboard-grid\dashboard-grid.component.ts` (+1 import, +1 entry in `imports`, docblock)
- `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\dashboard-grid\dashboard-grid.component.html` (+1 element)
- `D:\projects\ptah-extension\libs\frontend\dashboard\src\index.ts` (+1 export)
- `D:\projects\ptah-extension\libs\frontend\dashboard\CLAUDE.md` (public API + key files, kept truthful)
- `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\harness\harness-blocked-paths.component.ts` — **Batch 7's file**, +1 optional input
- `D:\projects\ptah-extension\tsconfig.base.json` (+1 path mapping)
- `D:\projects\ptah-extension\eslint.config.mjs` (+1 boundary exception, comment updated)

**Untouched but visible in `git status`** — `libs/shared/src/lib/types/harness-sync.types.ts`,
`libs/shared/src/lib/types/rpc.types.ts`, everything under `libs/backend/**`. Those are the
concurrent Batch 8 backend developer's, not mine. My diff contains **nothing** under `libs/shared`
or `libs/backend`.

---

## 8. What the reviewer should check

1. **The narrow-barrel deviation (§3.1) is the load-bearing judgement in this batch.** Task 11.1
   named the wide barrel; the wide barrel is dynamic-import-only, the dashboard is eager, and taking
   the task literally costs 14.52 kB of initial transfer and would fail
   `@nx/enforce-module-boundaries`. If the new `@ptah-extension/marketplace/harness` entry point and
   its eslint exemption are the wrong shape, this is the thing to say so about.
2. **Batch 7's `harness-blocked-paths.component.ts` now has two owners.** The `reconcileStep` input
   defaults to Batch 7's exact wording and Batch 7's suite is unchanged at 134/134 — but the file is
   uncommitted from that batch and modified in this one, so the two must be reviewed as a pair.
3. `grep -rnE "\.foreign|\.missing" libs/frontend/dashboard/src` is empty and the only
   `blockedTargetPaths` mentions in the lib are docblocks. Three surfaces, one definition.
4. **The card has no button, no input and no anchor** — asserted over the whole card, not just the
   disclosure. Nothing in this diff can write to the filesystem or capture consent.
5. Task 11.2 is deliberately absent, not forgotten (§5). Confirm the escape was the right call given
   Batch 8 is mid-flight.
6. The `health() === null` pull guard (§4) is a deviation from the Marketplace badge's unconditional
   refresh. It is argued, and pinned in both directions by mutations G and H — but if a
   boot-visible card should always force a fresh read, that is a one-line change and two spec
   cases to swap.
7. `libs/frontend/dashboard/CLAUDE.md` was updated. Check it still reads true.

---

## 9. Observations recorded, NOT actioned

**O1 — the list is still uncapped, inherited from Batch 7's O1 and now on the home.** Every blocked
path renders, and unlike the popover this card has no `max-h-[26rem] overflow-y-auto` around it — it
sits in the page flow. At 13 that is a short block; at 500 it would push the analytics card off the
first screen entirely. Batch 7 recorded the same choice deliberately (there is no second place for
the user to read the rest), but the consequence is materially different on a scrolling home than in
a bounded popover. Worth a cap decision if a real workspace ever reports a large blocked set.

**O2 — the card has no e2e coverage, and this is now the second uncovered surface.** Batch 7's O2
established that no e2e spec references any harness identifier;
`apps/ptah-electron-e2e/src/specs/marketplace/marketplace.spec.ts` has no `harness` reference at
all. Nothing in `apps/*-e2e` mounts the dashboard harness card either. A green e2e run therefore
means nothing moved — and equally, e2e would not catch either card disappearing.

**O3 — Batch 12 can now name this surface.** Task 12.1 wants the boot WARN's `action` to name the
Dashboard harness card as a route. The component exists, its selector is `ptah-harness-card`, and
the user-facing name to put in the log line is the card's own heading: **"Your harness is short"**,
on the Dashboard. Recorded so Batch 12 does not have to guess at a label.

**O4 — the card's wording and the boot WARN's will diverge the moment Batch 12 lands.** The WARN
currently ends "…then re-run `ptah harness doctor --fix`"; the popover says "then run Reconcile
now"; this card says "then reconcile from Marketplace → Plugins". Three surfaces, three
destinations — each correct for where it is read, and all three sharing the same move-first framing
and the same "may be your own work" clause. That is the invariant that matters and it holds. But if
Batch 12 adds a fourth phrasing, someone should check that the _framing_ is still identical across
all four, because the `reconcileStep` input is now the seam where that could quietly stop being
true.
