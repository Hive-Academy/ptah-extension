# Batch 9 + Task 11.2 — the consent dialog, and the one route into it

**Task**: TASK_2026_306 · **Branch**: `ak/boot-blocker-quota-gate` · **Status**: implemented, verified, **NOT committed**
**Executor**: `frontend-developer` (sub-agent) · **Date**: 2026-08-23
**Scope**: Task 9.1 (the dialog) and Task 11.2 (the route), plus one narrow, explicitly-authorised
line in `libs/backend/harness-sync/CLAUDE.md`.

---

## 1. What shipped, in one paragraph

`HarnessRepairDialogComponent` lists every blocked path with a per-path checkbox, arrives with
**nothing ticked**, disables Confirm until something is, and sends `harness:repairBlocked` exactly
the paths that are ticked **and still blocked** at the moment of the press. It names the quarantine
destination and the fact that Ptah never empties it _before_ the user consents, states plainly that
Ptah cannot prove it created these directories, leads with **move**, and offers no affordance to
empty the quarantine. The Dashboard harness card — the "Your harness is short" card Batch 11 put on
the home — gained **one** control, which opens that dialog and does nothing else; the card still
performs no repair and captures no consent, and the dialog renders as a _sibling_ of the card
section so the checkboxes never belong to the card's DOM. Batch 11's case 9 was rewritten rather
than deleted.

---

## 2. The three properties this batch actually has to hold

The backend refuses anything outside the blocked set and moves rather than overwrites. Neither of
those can tell a path the user deliberately ticked from a path the UI ticked for them. So the
design is organised around three properties, each placed where it is structural rather than
remembered.

### 2.1 Nothing is ticked on open — by construction, not by a reset

`selection` is `signal<ReadonlySet<string>>(new Set())` and **there is no code anywhere that seeds
it**. The host mounts the dialog behind `@if (repairOpen())`, so close-then-reopen destroys and
recreates the component — a re-open after a partial repair has no selection to carry because it has
no instance to carry one. This is deliberately stronger than an `ngOnInit` that clears a selection:
a clear can be removed and the removal reads as a tidy-up, whereas seeding a selection has to be
_written_.

The `@if` is therefore load-bearing, not stylistic. Mutation **M1** confirms it: pre-ticking the
rows kills 16 of the dialog's 24 cases and one of the card's.

`Select all` exists and is a **press**. Decision U3's objection was never to a user selecting
thirteen paths at once — it was to a dialog that arrives having selected them on their behalf. The
spec pins that the toggle starts reading `Select all` with zero boxes ticked, and only a click moves
it.

### 2.2 Only ticked, currently-blocked paths are sent

```ts
protected readonly selected = computed<readonly RepairCandidate[]>(() => {
  const ticked = this.selection();
  return this.candidates().filter((candidate) => ticked.has(candidate.key));
});
```

`candidates()` is the flattened **live** blocked set. The request is built by mapping `selected()`,
so a `HarnessRepairBlockedPath` can only ever be constructed from a row that is currently being
rendered. Two consequences, and both are pinned:

- a path that was never blocked cannot be named, because it never became a candidate;
- a path that **was** blocked, got ticked, and has since left the set (a `harness:healthChanged`
  push landed, or another window reconciled) is dropped at press time rather than sent stale.

The obvious alternative — reading the selection set out and splitting the keys back into
`{target, relPath}` — compiles, renders identically, and gets the second case wrong. That is
mutation **M4**, and it kills exactly one spec: the one written for it.

The key is `` `${target}::${relPath}` `` rather than `relPath`, because two targets can legitimately
block the same workspace-relative path (`.mcp.json` on both `claude` and `cursor`) and a
relPath-keyed selection would tick and send both from one click.

### 2.3 An empty selection produces no request at all

Three layers, and the reason there are three is that a consent RPC fired when consent was withheld
is **indistinguishable on the wire** from one fired when it was given:

1. Confirm is `[disabled]="!canConfirm()"`.
2. `confirm()` returns early on `paths.length === 0`.
3. `HarnessHealthStore.repairBlocked` returns `null` on an empty list before touching `rpc.call`.

Layer 1 is a rendering; layer 2 is the decision; layer 3 covers any future second caller. Mutation
**M2** removes layers 2 and 3 together and kills exactly the two cases that own the property — one
at the component, one at the store.

---

## 3. Wording — treated as a deliverable, per the Batch 12 review

### 3.1 Positive assertion, not a denylist

The Batch 12 review established that the eight-regex denylist is not a semantic check — `purge`,
`wipe`, `drop`, `unlink` and `nuke` all pass it — and that it carries two known false positives
(`\brm\b` matching `rm-helper`, `\btrash\b` matching `trash-cleaner`, because a hyphen is a word
boundary). So the sentence a user reads before authorising a move over content of unknown
provenance is pinned **whole and exact**:

> Move the occupant aside and Ptah installs its own copy in the space it leaves. Everything you tick
> is moved into a `.ptah-quarantine` folder beside it — so `.claude/skills/orchestration` becomes
> `.claude/skills/.ptah-quarantine/orchestration-20260823T141530123` — intact, under its own name
> and the time it was moved. Ptah never empties that folder and nothing in it expires: what goes
> there stays until you deal with it yourself. Nothing here proves Ptah wrote these, so they may be
> your own work: read it before you discard anything.

Four properties are in that literal by construction: it **opens on MOVE**; it names the destination
and that the destination is permanent; it claims no ownership; it hands the judgement back
("may be your own work", "read it before you discard anything").

The denylist survives as a **second** net, and its value is entirely its **scope** — it runs over
the whole rendered dialog in **both** phases, so a destructive verb in a button label or in a
per-path `reason` returned by the backend is visible. Its spec says in as many words that it is not
a completeness claim.

### 3.2 The destination is named as a RULE plus a worked example, not a literal path

`quarantineDirFor` is `join(dirname(occupant), QUARANTINE_DIR_NAME)` — the quarantine is a
**sibling of the occupant**. A blocked `.codex/prompts/x` and a blocked `.claude/skills/y`
therefore land in two different folders, and any single absolute path in the copy would be wrong
for one of them. So the copy states the rule and shows one instance of it.

The per-path destination is **not** re-derived client-side. The exact `quarantinePath` comes back in
the outcome for every path that moved — including every failure after the move — so the user is
told where their content actually went by the code that actually put it there.

### 3.3 U4 is stated and is not contradicted by a control

"Ptah never empties that folder and nothing in it expires" is asserted, and a separate case walks
every `<button>` in the dialog asserting none of them says `clean`, `empty` or `purge`. A button
contradicting the documented promise is worse than no button.

### 3.4 The card's fifth phrasing

`RECONCILE_STEP` is the middle clause of the shared disclosure's action sentence — the input Batch 7
added precisely so the fixed opening and closing clauses cannot drift. This is the fifth phrasing
across the repo and the **first to offer an action rather than only a location**, so it too is now
pinned whole and exact rather than by substring:

> Move the occupant aside — the file or directory at each path, or the conflicting key in each
> config file — then reconcile from Marketplace → Plugins, or let Ptah move it for you with the
> button below. Nothing here proves Ptah wrote these, so they may be your own work: keep what you
> move, and read it before you discard anything.

Doing it by hand is named **first** on purpose: it is the route that requires no claim of ownership
from anybody, and a user unsure whose directory that is should take it. The dialog is offered second
and described as _Ptah doing the move_, not as a fix. "the button below" is literal — the control
sits directly under that paragraph in the card body.

---

## 4. Task 11.2 — the route, and how Batch 11's case 9 was amended

### 4.1 What the card gained

One `<button data-testid="harness-card-repair">Move these aside…</button>`, placed under the
disclosure. It sets a boolean. It fires no RPC, pre-selects nothing, and does not say how many paths
would be moved.

The dialog is rendered **outside** the `[data-testid="harness-card"]` section:

```html
@if (blocked().count > 0) {
<section data-testid="harness-card">…</section>
} @if (repairOpen()) { <ptah-harness-repair-dialog … /> }
```

Two reasons, both real: the "this card captures no consent" assertion keeps meaning something while
a dialog full of checkboxes exists in the same component, and the dialog **outlives the section** —
a fully successful repair empties the blocked set and hides the card, and the user still has to read
the outcomes. Mutation **M10** nests it back inside and kills the case written for it.

### 4.2 Batch 11 case 9 — replaced, deliberately, in place

Batch 11 asserted zero `<button>`, zero `<input>` and zero `<a>` across the whole card. That was
correct while `harness:repairBlocked` had no dialog. It is now replaced by
**"offers exactly one control, and it is a route rather than an action"**, which:

- pins the button **count at exactly 1**, so a second control cannot be added quietly;
- names the one permitted control by `data-testid` **and by its label text**;
- keeps `<input>` at 0, `<a>` at 0 and adds `[type="checkbox"]` at 0;
- keeps the `aria-label` assertion;
- adds `expect(rpcMock.call).not.toHaveBeenCalled()` — the card routes and does not act.

Its comment records why the old assertion was right and why the new one replaces it, so the decision
to put a repair affordance on the home page is visible in the diff rather than absent from it.
Three further cases were added under a new `the route into the consent dialog (Task 11.2)` block.
The card spec went **11 → 14** cases: one replaced 1:1, three added.

### 4.3 Scope boundary, recorded rather than left implicit

The Marketplace popover was **not** given a second control. U8 asks for the dialog to be reachable
from the boot-visible surface, and Task 11.2 names the Dashboard card. The popover already has
`Reconcile now` eight pixels below the same disclosure, and adding a route there would have meant
re-opening Batch 7's shipped component and specs for something nobody asked for. If a reviewer wants
it, it is one line in `harness-health-badge.component.ts` plus its own case — but it should be a
decision, not a side effect of this batch.

---

## 5. The two rules this batch was told not to break, and did not

### 5.1 `blockedTargetPaths` stays the single derivation

This is the **fourth** frontend consumer and it derives nothing. The dialog's `blocked` input is
`harnessBlockedPaths(store.health())` — the same function the card and the popover call, which calls
`blockedTargetPaths` from `@ptah-extension/shared`, which is what the reconciler's WARN calls.

```
$ grep -rnE "\.foreign|\.missing|new Set\(" libs/frontend/dashboard/src --include=*.ts | grep -v spec.ts
no hits outside specs

$ git diff --stat -- libs/shared
(empty)
```

The dialog's spec mounts against `harnessBlockedPaths(health)` rather than a hand-built
`HarnessBlockedDisclosure`, on purpose: a hand-built one would let a spec offer the dialog a path the
shared function would never produce, and the "cannot send an unblocked path" case would then be
testing a fiction.

### 5.2 The narrow entry point was extended, not forked

`HarnessRepairDialogComponent` was added to the existing concern-named
`@ptah-extension/marketplace/harness` barrel. No consumer-named entry point was created.

`HarnessHealthStore` is deliberately still **not** re-exported there — the dialog reaches it by a
relative import inside its own lib. Same `providedIn: 'root'` class, same single instance, and
`harness.ts`'s docblock now says so, because "why is the store in one barrel and the dialog in
another" is exactly the question a reader will have.

**Cost of putting the dialog on the eager path**, measured rather than asserted:

| initial bundle (transfer) | before    | after     |
| ------------------------- | --------- | --------- |
| `ptah-extension-webview`  | 483.61 kB | 486.60 kB |

**+2.99 kB.** Measured by stashing only `libs/frontend/dashboard` and `libs/frontend/marketplace`
and rebuilding.

---

## 6. What was deliberately NOT duplicated from the backend

A blocked MCP fragment key (`.mcp.json#github`) is refused by the backend as `not-a-path`. The
dialog **does not filter those out client-side**. `isMcpFragmentKey` lives in
`harness-sync/src/lib/targets/mcp/mcp-facet.port.ts` and a frontend lib cannot import it; copying the
predicate would put a second definition of "is this a file" on the far side of the wire — the same
duplication rule that keeps `missing ∩ foreign` in `libs/shared`.

So the row is offered, the backend refuses it, and the refusal is rendered in plain language rather
than as the wire token. Nothing is moved either way, and the honest cost — a user can tick something
that comes back "does not apply" — is smaller than a client-side rule that can drift from the server
one it is imitating.

The same reasoning covers `OUTCOME_TEXT`: it is a `Record<HarnessRepairOutcome, string>`, so a
seventh outcome added to the wire contract fails to compile here rather than rendering an empty
cell.

---

## 7. Files

| File                                                                           | Change                                                                       |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `libs/frontend/marketplace/src/lib/harness/harness-repair-dialog.component.ts` | **new** — the dialog (512 lines incl. docblocks)                             |
| `libs/frontend/marketplace/src/lib/harness/harness-repair-dialog.spec.ts`      | **new** — 24 cases                                                           |
| `libs/frontend/marketplace/src/lib/harness/harness-health.store.ts`            | `repairBlocked()`, `repairing` signal, `busy` widened to three calls         |
| `libs/frontend/marketplace/src/harness.ts`                                     | dialog added to the narrow barrel + why the store is still not here          |
| `libs/frontend/marketplace/src/index.ts`                                       | dialog added to the wide barrel                                              |
| `libs/frontend/dashboard/.../harness-card/harness-card.component.ts`           | one route button, sibling dialog mount, new `RECONCILE_STEP`, docblock       |
| `libs/frontend/dashboard/.../harness-card/harness-card.spec.ts`                | case 9 replaced; 3 route cases added; action sentence pinned exact (11 → 14) |
| `libs/backend/harness-sync/CLAUDE.md`                                          | **one claim** — see §9. No source change in `libs/backend/**`.               |

No change under `libs/shared`. No RPC contract change — `harness:repairBlocked` shipped in Batch 8
and this is its first caller.

---

## 8. Verification — actual output

```
$ npx nx run-many -t test,lint,typecheck -p dashboard,marketplace --skip-nx-cache
Test Suites: 10 passed, 10 total      (marketplace)
Tests:       158 passed, 158 total
Test Suites: 3 passed, 3 total        (dashboard)
Tests:       37 passed, 37 total
✖ 2 problems (0 errors, 2 warnings)
NX  Successfully ran targets test, lint, typecheck for 2 projects
```

The two lint warnings are **pre-existing** `max-lines` on `external-marketplaces.component.ts` (753)
and `smithery-surface.component.ts` (940), neither touched here. The new component is 512 lines,
under the 700 soft ceiling.

```
$ npx nx build ptah-extension-webview --skip-nx-cache
Initial total  2.28 MB | 486.60 kB
Application bundle generation complete. [15.473 seconds]
NX  Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
```

(The three `@xterm/*` "not ESM" warnings are pre-existing and unrelated.)

```
$ npx nx test harness-sync --skip-nx-cache -- --testPathPatterns="blocked-logging"
Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
```

Run to confirm the `CLAUDE.md` edit did not disturb Batch 12's in-flight work. No spec in
`harness-sync` reads `CLAUDE.md` (`grep -rn "CLAUDE.md" libs/backend/harness-sync/src --include=*.spec.ts`
returns one hit and it is a comment).

### Spec count, counted

```
$ grep -c "    it(" libs/frontend/marketplace/src/lib/harness/harness-repair-dialog.spec.ts
24
$ grep -c "    it(" libs/frontend/dashboard/src/lib/components/harness-card/harness-card.spec.ts
14
$ grep -c "test(" <both files>
0
0
```

**24 new** (dialog) + **3 new and 1 replaced** (card, 11 → 14) = **27 new cases, 1 rewritten**.
Jest agrees: the dialog suite reports `Tests: 24 passed, 24 total`, the card suite `14 passed`.

| Dialog block               | cases  |
| -------------------------- | ------ |
| what the dialog arrives in | 4      |
| what leaves the dialog     | 8      |
| what it says               | 6      |
| what it reports back       | 3      |
| the store call itself      | 3      |
| **total**                  | **24** |

---

## 9. The `CLAUDE.md` claim Batch 12 left behind

Batch 12 wrote into `libs/backend/harness-sync/CLAUDE.md`:

> The card is named as a place to READ, not as a repair: **it has no control of any kind, by
> design.**

True as committed, false the moment this batch lands. This is the third recurrence of the
documentation-truth pattern in this task (F-C on Batch 6, F3 on Batch 8), so it is fixed rather than
marked. The line now reads:

> The card is named as a place to READ, and it carries exactly ONE control: a route into the consent
> dialog (TASK_2026_306 Batch 9 / Task 11.2). The card itself still performs no repair and captures
> no consent — the per-path checkboxes live in the dialog, they arrive with nothing ticked, and
> `harness:repairBlocked` is sent only the paths the user actually ticked. The card had no control
> at all until the dialog existed, on the rule that a button opening nothing is worse than no button.

The last sentence is there so the _history_ survives too: a future reader should be able to tell
that the absence of a control was a decision with a reason, not an oversight that was later
corrected. **That one claim is the only change in `libs/backend/**`\*\* — no source file in that lib
was touched.

---

## 10. Mutation testing — 11 mutations, fail/pass per mutation

Every mutation was applied to source, the affected suite run, then the file restored from a
pre-mutation copy. "Revert it and it does not compile" was not accepted as evidence anywhere —
every mutation below compiles and renders.

| #       | Mutation                                                                                   | Suite  | Result               | Cases killed                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------ | ------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **M1**  | Seed `selection` with every candidate key on construction (pre-tick everything)            | dialog | **16 fail / 8 pass** | all four "arrives in" cases plus every case whose selection is then wrong                                                               |
|         |                                                                                            | card   | **1 fail / 13 pass** | `opens the dialog with nothing ticked and fires no request on the way in`                                                               |
| **M2**  | Remove BOTH empty-list guards (`confirm()` early return + store `paths.length===0`)        | dialog | **2 fail / 22 pass** | `sends no request when confirm is reached with nothing ticked`; `refuses an empty list before it reaches the wire`                      |
| **M3**  | `confirm()` maps `candidates()` instead of `selected()` (send everything shown)            | dialog | **4 fail / 20 pass** | `carries exactly the ticked paths and no others`; `drops a path the user unticked`; `keeps two targets … apart`; the empty-confirm case |
| **M4**  | Build the request by splitting raw `selection()` keys instead of filtering rows            | dialog | **1 fail / 23 pass** | `will not send a ticked path that stopped being blocked before confirm`                                                                 |
| **M5**  | Action sentence → "Ptah will delete the occupant and install its own copy…"                | dialog | **2 fail / 22 pass** | the exact-text case; the whole-dialog denylist case                                                                                     |
| **M6**  | Drop the destination + the never-emptied promise from the pre-consent copy                 | dialog | **3 fail / 21 pass** | `names the quarantine destination while the user can still decline`; the U4 case; the exact-text case                                   |
| **M7**  | Render `result.outcome` raw and suppress `quarantinePath`                                  | dialog | **3 fail / 21 pass** | both "reports back" cases; the denylist case's positive `moved aside` half                                                              |
| **M8**  | Store adopts `health: null` unconditionally                                                | dialog | **1 fail / 23 pass** | `leaves the last good report standing when the backend ran no pass`                                                                     |
| **M9**  | Delete the card's route button                                                             | card   | **4 fail / 10 pass** | all three Task 11.2 route cases + `offers exactly one control`                                                                          |
| **M10** | Nest the dialog INSIDE `[data-testid="harness-card"]`                                      | card   | **1 fail / 13 pass** | `keeps the ticking out of the card even while the dialog is open`                                                                       |
| **M11** | `RECONCILE_STEP` → "then delete it and press the button below to let Ptah take the space." | card   | **2 fail / 12 pass** | `names both places the user can act`; Batch 11's `leads with move … never says delete`                                                  |

Reading of the split: M2, M4, M8 and M10 each kill **exactly one** case, which is the shape you want
— the property has an owner rather than a crowd. M1 and M9 kill broadly because they remove the
premise the rest of the suite is written against, which is also correct. M3's fourth casualty is the
empty-confirm case, and that is not noise: sending every candidate means an empty selection sends
everything, which is the worst possible version of that bug and the case catches it.

The four cases the brief named as mandatory map to M1 (nothing checked on open), M2 (confirm with
nothing checked sends nothing), M3 (exactly the checked paths), M4 (cannot send a path outside the
blocked set) and M5 (move-not-delete over the whole dialog). Each is killed by the mutation written
against it.

---

## 11. Left for the reviewer

1. **The popover has no route** (§4.3). Deliberate, one line to change if the reviewer disagrees.
2. **A ticked MCP fragment key comes back "does not apply"** (§6). Chosen over duplicating a
   backend predicate. The alternative is to export `isMcpFragmentKey` from `libs/shared` — a real
   option, but it is a `libs/shared` change and this batch was told to stay out of it.
3. **The repair's write pass is workspace-wide** (Batch 8 §m1). The dialog does not say so. It is
   the same full pass that runs at every activation, so it adds no exposure the user does not
   already have several times a day — but if the reviewer wants that disclosed here, it is one
   sentence, and it would be the honest place to put it.
