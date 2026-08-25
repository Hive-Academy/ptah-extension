# Batch 12 — the boot WARN names the destination

**Status**: COMPLETE. Task 12.1, one task, kept at one task. **Not committed.**
**Branch**: `ak/boot-blocker-quota-gate`
**Wire contract**: unchanged. `libs/shared` untouched. No new field, no schema change, no RPC.
**Filesystem behaviour**: unchanged. Zero writes added, zero removed. The only thing that changed
is the text of one `action` string in one WARN payload.

---

## 1. What changed

`HarnessReconcilerService.logBlocked`'s `action` gained one sentence, in the middle:

```
Move the occupant aside — the file or directory at each path, or the conflicting key in each
config file — then re-run `ptah harness doctor --fix`. The same list is on the Dashboard home,
in the "Your harness is short" card. Nothing here proves Ptah wrote these, so they may be your
own work: keep what you move, and read it before you discard anything.
```

The inserted sentence is the whole diff to the string. Everything before it and everything after
it is byte-identical to what Batch 6 shipped in `e1851b34a`.

**Placement is deliberate.** The destination goes between the CLI instruction and the provenance
caveat, not at the end, because all three existing surfaces close on
`…read it before you discard anything.` Appending the route after that clause would make this the
one surface whose last words are a navigation hint rather than the warning about the user's own
work. The framing sentence stays terminal, as it is everywhere else.

**The card is named as a place to READ, not as a fix.** Batch 11 §4 is explicit that the card has
no button, no input and no anchor — `querySelectorAll('button' | 'input' | 'a')` is asserted length
0 over the whole card. "The same list is on the Dashboard home" is therefore literally true and
claims nothing more. Wording that sold it as a one-click repair would assert the ownership of these
paths that this entire defect exists because Ptah cannot prove. Pinned: mutation F.

---

## 2. The wording constraint — the fourth phrasing, checked against the other three

Read all three before writing, per the brief. Here they are side by side, with the varying clause
marked:

| Surface                                                                             | Ends its action sentence with                        |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Boot WARN (`harness-reconciler.service.ts`)                                         | ``then re-run `ptah harness doctor --fix`.``         |
| Marketplace popover (`harness-blocked-paths.component.ts:129`, the input's default) | `then run Reconcile now.`                            |
| Dashboard card (`harness-card.component.ts:105`, `RECONCILE_STEP`)                  | `then reconcile from Marketplace → Plugins.`         |
| **This batch** — the boot WARN's new middle sentence                                | ``…--fix`. The same list is on the Dashboard home…`` |

**The framing is still one framing.** Every one of the four:

1. **Leads with move.** All four begin `Move the occupant aside — the file or directory at each
path, or the conflicting key in each config file —`. The WARN's is anchored by
   `expect(action).toMatch(/^Move the occupant aside/)`.
2. **Carries "may be your own work"** and **"read it before you discard anything"**, both after the
   varying clause, both unchanged.
3. **Never names a destructive verb.** See below — the ban was widened rather than restated.
4. **Never asserts Ptah owns these paths.** The WARN still says `Nothing here proves Ptah wrote
these`, and the new sentence adds no ownership claim: it says where the list is, not whose the
   files are.

**`reconcileStep` is the seam, and this batch does not touch it.** The fourth phrasing lives
entirely in the backend string. `libs/frontend/**` is not in my diff at all, so the input's default
and the dashboard's override are exactly what Batches 7 and 11 left them. Batch 11's O4 asked
someone to re-check the framing when a fourth phrasing landed — that check is §2 items 1–4 above,
and it holds.

### The delete-word ban is now wider than "delete", and wider than `action`

Two independent holes closed, both recorded before this batch rather than invented here:

- **Batch 7's follow-up m1**: `not.toContain('delete')` let `remove`, `erase`, `trash` and `rm`
  through. The case now scans for each of them with word boundaries, plus the inflections
  (`deleted`, `deleting`, `deletion`, `removes`, `removing`, `erased`).
- **The hole this batch would have opened**: the old assertion covered `action` only. Task 12.1
  inserts a sentence into the middle of that paragraph, and a later tidy-up that relocated
  "delete the occupant" into `note` or into a per-path `reason` would have passed an action-only
  check. The scan now runs over the whole logged line — `BLOCKED_MESSAGE` plus the serialized
  payload — so `note`, `reason`, every per-path `reason` and the message itself are all covered.
  Pinned by mutation D, which puts the verb in `blockedReason` and nowhere near `action`.

The original substring form is **kept verbatim**, widened to the whole line
(`expect(wholeLine.toLowerCase()).not.toContain('delete')`), so nothing the case used to assert was
traded for the regex set.

---

## 3. Decision: the host boot lines are NOT changed

Task 12.1 asks for a decision either way on
`apps/ptah-electron/src/activation/plugin-activation.ts` and
`apps/ptah-extension-vscode/src/activation/plugin-activation.ts:286-294`.

**Decision: no pointer on either. Neither file is in my diff.** Three reasons, in order of weight:

1. **Neither line has an action channel, and giving one an action would change its shape.** The
   Electron line is a single formatted string of counters built by `formatHarnessLine`
   (`plugin-activation.ts:375-392`) — `sources=…, detectedTargets=…, found=…, claude=…, missing=…,
foreign=…, writeFailed=…`. The VS Code one is a structured `logger.info('Harness reconciled', {…})`
   with six numeric fields. Appending a 60-word move-first paragraph to either turns a scannable
   one-line summary into a wall, on every activation and every workspace-folder change.
2. **It would be a duplicate a few lines from itself.** Both host lines are printed immediately
   after a `mode: 'full'` reconcile, which is precisely the pass on which `logBlocked` emits. A
   user who sees the shortfall on the host line sees the blocked WARN with the route in the same
   screenful. A second copy of the pointer buys nothing and is a second string to keep in sync —
   which is the exact failure mode Batch 11's O4 warned about.
3. **Those two lines already disagree with each other, and this is not the task that fixes it.**
   The task text says so, and Batch 5's finding is unresolved: Electron now leads with the
   aggregate plus a labelled `claude=` slice, while VS Code still logs the bare claude slice under
   unqualified `expected`/`found` names. Editing prose into both while their scopes still disagree
   would make the divergence harder to see, not easier. Recorded as an observation (§6 O1), not
   actioned.

---

## 4. What was preserved, and how it is proven

| Property                                                                       | Evidence                                                                                                  |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `full`-only gate (`if (health.mode !== 'full') return;`), Batch 6 m3           | Line untouched in the diff; **mutation G** removes it and the preflight case goes red                     |
| Not widened to preflight or `verify()`                                         | Same guard; `verify()` never reaches `log()` at all, unchanged                                            |
| `blockedTargetPaths` remains the single derivation                             | `logBlocked` still calls it and nothing else; no `missing`/`foreign` intersection anywhere in my diff     |
| Summary line byte-identical, still gated on `writeFailed > 0 \|\| missing > 0` | Untouched in the diff; existing case 6 asserts the summary gained no `blocked`/`action` field             |
| No filesystem behaviour change                                                 | Untouched planner and apply path; existing case 7 re-reads both occupants and asserts them byte-identical |
| No wire/schema change                                                          | `libs/shared` not in my diff; `nx typecheck harness-sync` PASS with no consumer edits                     |

`grep -rn "blockedTargetPaths"` inventory is unchanged from Batch 11 §2 — I added no call site and
removed none.

---

## 5. Verification — actual output

All runs `--skip-nx-cache`.

| Command                                                              | Result                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------ |
| `npx nx test harness-sync`                                           | **36 suites / 275 passed, 0 failed** (`Time: 15.04 s`) |
| `npx nx lint harness-sync`                                           | **`✔ All files pass linting`** — 0 errors, 0 warnings  |
| `npx nx build harness-sync`                                          | **PASS**                                               |
| `npx nx typecheck harness-sync`                                      | **PASS**                                               |
| `npx prettier --check` on all three touched files                    | **`All matched files use Prettier code style!`**       |
| `npx jest … harness-reconciler.blocked-logging.spec.ts` in isolation | **1 suite / 10 passed**                                |

**Test delta.** `harness-sync` is 275 across 36 suites, against Batch 6's reported 242 across 34 —
the gap is Batch 8's concurrently-uncommitted `repair/` and `quarantine/` suites, which are not
mine. **My contribution to the count is exactly +1**: the blocked-logging file goes 9 → 10 cases,
and an isolated run of that file alone reports `Tests: 10 passed, 10 total`.

**Spec integrity.** `git diff -U0 -- 'libs/backend/harness-sync/**/*.spec.ts' | grep "^-[^-]"`
returns exactly three lines, and all three are accounted for:

```
-  it('leads the user action with MOVE, … never presents deletion as the remedy', async () => {
-    const { action } = blockedDetail(logger);
-    expect(action.toLowerCase()).not.toContain('delete');
```

A title (widened to say "destruction … anywhere in the line"), a destructuring line (now two, so
the whole `detail` is in scope), and the weak substring check — which is **kept verbatim and
widened to the whole line** two lines further down, then supplemented by the regex set. **Zero
assertions weakened.**

---

## 6. Spec inventory — counted, not estimated

**10 cases in 1 file**, one of them new. Counted with `grep -c "  it("` on
`harness-reconciler.blocked-logging.spec.ts` → **10**; `grep -cE "it\.each|test\(|it\.only|fit\("`
→ **0**, so `it(` blocks equal Jest cases exactly. Confirmed by the isolated run
(`Tests: 10 passed, 10 total`).

### Mutation runs — seven, each applied and reverted programmatically, source restored byte-identical

The harness patched one string, ran the file, restored, and asserted
`readFileSync(SRC) === original` at the end (`restored: true`). It was deleted afterwards.

| #     | Mutation                                                                           | Result                  |
| ----- | ---------------------------------------------------------------------------------- | ----------------------- |
| **A** | `action` reverted to Batch 6's exact string — card never named                     | **1 failed / 9 passed** |
| **B** | Card still named, but the action leads `Delete whatever is at each of these paths` | **1 failed / 9 passed** |
| **C** | Move-first kept, `then remove it and` smuggled into the middle                     | **1 failed / 9 passed** |
| **D** | Destructive verb moved out of `action` into `blockedReason`                        | **2 failed / 8 passed** |
| **E** | Card named vaguely — `There is also a card about this somewhere in the app`        | **1 failed / 9 passed** |
| **F** | Card sold as a repair — `let it fix them for you`                                  | **1 failed / 9 passed** |
| **G** | `if (health.mode !== 'full') return;` removed (Batch 6 m3 guard)                   | **1 failed / 9 passed** |

**Every mutation is killed.** Reading the two most informative:

- **C is the m1 hole, and it is the one this batch would have shipped through.** The mutated string
  passes every assertion the case made before today — it starts with `Move the occupant aside`, it
  says `may be your own work`, it closes with `read it before you discard anything`, and it never
  contains the substring `delete`. It also tells the user to remove their own files. Only the
  word-boundary synonym set catches it.
- **D kills two, and the second one is the point.** It puts `delete` in a per-path `reason`, which
  the old action-only check could never have seen. Case 2 (the per-path reason strings) also goes
  red because it asserts those strings exactly — which is why D's kill count is 2 rather than 1,
  and why the framing case and case 2 are not redundant: case 2 pins the reason's content, the
  framing case pins that no surface of the line carries a destructive verb.

### Per-case discrimination

| #     | Case                                                                                          | Killed by   | Kind                      |
| ----- | --------------------------------------------------------------------------------------------- | ----------- | ------------------------- |
| 1     | names every blocked path, and only the blocked ones                                           | —           | preserved-behaviour guard |
| 2     | per-path reason; occupied path vs occupied server key                                         | **D**       | discriminating            |
| 3     | leads with MOVE, may-be-your-own-work, **no destructive verb anywhere in the line** (widened) | **B, C, D** | discriminating            |
| **4** | **names the Dashboard harness card** (NEW)                                                    | **A, E, F** | discriminating            |
| 5     | emits no blocked line when nothing is blocked                                                 | —           | preserved-behaviour guard |
| 6     | existing summary intact, gate intact, gained no `blocked`/`action` field                      | —           | preserved-behaviour guard |
| 7     | adds no write and removes none; occupants byte-identical                                      | —           | preserved-behaviour guard |
| 8     | same blocked set on a second converged pass                                                   | —           | preserved-behaviour guard |
| 9     | silent on a preflight pass, gap still in the summary and still derivable                      | **G**       | discriminating            |
| 10    | scope/targetCount/reason/mode labelled; note says a refusal is not a write failure            | —           | preserved-behaviour guard |

**4 discriminating against this batch's seven mutations, 6 preserved-behaviour guards.** The six
are Batch 6's own cases, and they are correctly inert here: they pin properties Batch 12 promised
to PRESERVE (the path set, the silence-when-clean, the untouched summary, the untouched
filesystem, convergence, the labelled scope), so a batch that changes only a string should leave
every one of them green. They are inherited coverage, not this batch's contribution — this batch's
contribution is **case 4, plus the widening of case 3**, and both are killed by three mutations
each.

**Cases 1, 5–8 and 10 were killed by Batch 6's own mutation runs** (5 of them by commenting out the
`logBlocked` call). They are not unkillable; they are unkilled _by mutations of a string_, which is
the only thing this batch mutates.

---

## 7. Files

**Modified** (three; nothing new, nothing deleted)

- `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.service.ts`
  — one sentence added to the `action` string, and the comment above it extended to say why the
  card is named and why it is named as a place to read rather than a repair.
- `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.blocked-logging.spec.ts`
  — existing framing case widened (whole line, synonym set), one new case for the destination.
- `D:\projects\ptah-extension\libs\backend\harness-sync\CLAUDE.md` — the paragraph describing this
  exact log line now describes it truthfully. It also **carried a stale "move or delete the
  occupant"**, written before Batch 6's F-B fix and contradicting both the code and the same
  document's own guidance three paragraphs later. Corrected in the same edit, since it documents
  the string this task owns.

**Not touched, and deliberately**: `libs/shared`, `libs/frontend/**` (a frontend developer is
concurrently on Batch 9 / Task 11.2), both hosts' `plugin-activation.ts` (§3), everything under
`libs/backend/harness-sync/src/lib/repair` and `.../quarantine` (Batch 8, uncommitted in the same
working tree and not mine).

---

## 8. What the reviewer should check

1. **The inserted sentence is honest about what the card does.** It says the list is there. The
   card has no control (Batch 11 §4). If a reviewer thinks "The same list is on the Dashboard home"
   still over-promises, that is the sentence to say so about — mutation F shows the spec draws the
   line at "let it fix them for you", and where exactly that line sits is a judgement.
2. **The whole-line synonym scan is the assertion most likely to be argued with.** It is stricter
   than Batch 7's m1 recommendation ("recorded, not worth a change") because Task 12.1 named the
   loophole explicitly. It will fail a future line that legitimately needs the word "removed" —
   e.g. reporting a path the reaper removed. That is a real future cost, and it is intentional:
   this payload has no removal semantics and gaining one should be a deliberate decision, not a
   quiet string edit.
3. **§3's decision on the host boot lines.** No code was written for it, so there is nothing to
   review but the argument.
4. `git diff` under `libs/shared` and `libs/frontend` is empty for this batch.
5. The `full`-only gate line is untouched and mutation G is the guard.

---

## 9. Observations recorded, NOT actioned

**O1 — the two host boot lines still disagree on scope.** Electron's `formatHarnessLine` leads with
the `summarizeHarnessHealth` aggregate and labels its claude slice; VS Code's
`plugin-activation.ts:286-294` still logs only the claude slice, under bare `expected` / `found`
names — the same field names the reconciler's summary uses for six-target sums. Batch 5 found this;
§3 declines to make it worse; nobody has fixed it.

**O2 — `harness-sync/CLAUDE.md` has one more "move or delete", and I left it.** It is in the
`ptah harness doctor` section: "the only way to clear them is for the user to move or delete the
file". That sentence is about the doctor's `foreign` list, a different surface with a different
audience, and rewording it is not this task. But it is the same framing question, and the answer
should probably be the same one.

**O3 — the blocked list is still uncapped**, inherited unchanged from Batch 6's O2 and Batch 11's
O1. At 13 paths the log line is fine; at 500 it is enormous, and now the WARN also points at a
Dashboard card that renders all 500 in the page flow.

**O4 — `targets/workspace-target.ts` still contains two literal NUL bytes** (offsets 33696 /
33733). Third batch in a row to record it; still two characters to fix; still makes `rg` treat the
file as binary and skip it.
