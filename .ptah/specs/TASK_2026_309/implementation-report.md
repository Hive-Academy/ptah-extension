# Implementation report — TASK_2026_309

Date: 2026-08-28
Implemented by a `backend-developer` subagent, reviewed by an independent
`code-logic-reviewer`, revised once after that review found a sixth surface the
task never listed.

**No production file changed.** Every surface already said the right thing. The
entire defect lived in the guard.

## What was wrong

Five surfaces tell a user how to clear a blocked harness path. Each must say MOVE
and must never say delete, because nothing proves Ptah wrote those paths — so
advising deletion trades a user's possibly irreplaceable work for a tidier count.

The guard was a **denylist of eight regexes**. "Purge", "wipe", "drop", "nuke",
"clear out" and "get rid of" all passed it. Two of the five surfaces carried only
a bare `not.toContain('delete')`, so "remove the occupant" would have shipped on
them.

## The replacement

An exact-match allowlist in `libs/shared/src/lib/types/harness-blocked-wording.ts`
— `libs/shared` because two surfaces are backend and three are frontend, and it is
the one permitted bridge. The module imports nothing.

Brittleness is the feature. A safety-critical instruction that gets reworded
should have to be re-approved by a human, not merely re-scanned by a regex the new
wording happens to slip past.

### Three nets, in order of authority

1. **Exact match on the action**, per surface.
2. **Residue scan** — approved prose and declared data are struck, then any run of
   four or more plain words left standing fails. Four is the floor because a
   target label ("Claude Code") and a heading ("13 blocked paths") are not prose
   and must not be approved one by one.
3. **Destructive-verb backstop**, no length threshold, over the same residue.

Net 3 exists because net 2 structurally cannot see "Delete these" on a button —
two words. A denylist is dangerous as a _primary_ mechanism, where silence means
approved. Underneath an authoritative allowlist the polarity inverts: approval
comes only from the allowlist, so this list can only ever add a failure and can
never grant permission. Being incomplete costs nothing it was relied on for. That
reasoning is written at the code, so nobody later mistakes it for the denylist
this task deleted.

### The two-sided pin

Production keeps its own literal; the spec asserts equality against the shared
constant. Editing either alone goes red, so a rewording must be made twice,
visibly, in one diff.

### And the pin's own blind spot, closed

The pin cannot stop someone editing the production string _and_ the constant
together in one commit. So the allowlist is now **checked against itself**: a spec
asserts no approved action, prose fragment, repair reason, WARN note or WARN
reason contains a destructive verb. One sanctioned exemption — `read it before you
discard anything` — which invokes the user's judgement about their own file rather
than instructing destruction.

## The sixth surface, found in review

`HarnessRepairPathResult.reason` carries Ptah-authored sentences and is rendered
unconditionally at `harness-repair-dialog.component.ts:276-280`. No spec fed the
real strings through the checker — the only `reason` exercised was an invented
fixture passed as `data`, which is struck unconditionally. A destructive rewrite
of any real literal, at any length, would have shipped green.

The implementer found **five** literals, not the three the review named:
`:230`, `:318-319`, `:334`, `:399-401`, `:406-408`. They also found a third route
into the same field — `describeError()` interpolates `quarantine.ts`'s own
assertion messages, which are Ptah prose too and are now listed.

Pinned from both ends, because either half alone is decorative: the backend spec
asserts each literal at its outcome site, which is what makes a production
rewrite fail; the frontend spec renders a five-row report carrying every constant,
asserts each reached the DOM, and runs the checker over the whole phase with none
of them declared as data. A frontend spec cannot import the backend service, so
the backend spec is what makes the shared constant real.

## Proof the guard works

Every mutation applied to the production string, spec run, then reverted.
`git diff` over the six production files is empty.

| Surface             | Substitution                                | Result                     |
| ------------------- | ------------------------------------------- | -------------------------- |
| Reconcile WARN      | `purge the file or directory`               | 1 failed / 9 passed        |
| Marketplace popover | same                                        | 1 failed / 10 passed       |
| Dashboard card      | `remove the occupant with the button below` | 2 failed / 12 passed       |
| Repair dialog       | `Ptah purges what it finds`                 | failed, exact-match diff   |
| Health store        | `Failed to purge the blocked paths`         | 1 failed / 30 passed       |
| Repair reason ×5    | one destructive rewrite each                | 1 failed / 17 passed, each |
| Confirm button      | `Move aside and install` → `Delete these`   | 2 failed / 23 passed       |

The dashboard case is the exact "remove the occupant ships today" scenario the
task named. The button case is the short-instruction hole the review found.

## Verification

4 of 4 projects. `shared` 47 suites / 1195 tests (up from 1180), `marketplace`
10 / 164, `harness-sync` 40 / 322, `dashboard` 4 / 43. Zero failures. Typecheck
and lint green; the four `max-lines` warnings are pre-existing on untouched files.

## Left open

- **One residual laundering path, narrowed not eliminated.** A non-destructive
  sentence declared in a spec's `data` array is still struck unquestioned. The
  checker now rejects `data` that is both prose-shaped and destructive, but it
  cannot forbid prose-shaped data outright without breaking the legitimate OS-error
  case the dialog actually renders (`EBUSY: resource busy or locked`). What holds
  the line is review: `data:` is only ever hand-written in a spec, is as visible as
  editing the allowlist, and is one grep away.
- **`DESTRUCTIVE_VERB` omits bare `rm`** deliberately. The old denylist had it and
  it was already recorded as a false-positive trap (`rm-helper`). Under an
  allowlist, omitting it costs nothing.
- **`libs/shared` now knows five strings that live in `harness-sync`'s repair
  service.** Same trade the module already makes for the WARN note. The backend
  spec stops it drifting, and the `CLAUDE.md` section names both sites.

## Outcome

Status `in_progress` → `done`.
