# Context — TASK_2026_184

## Origin

Found during TASK_2026_181 Batch 10, while building the Tasks command palette.
That batch worked around it locally and correctly declined to fix the shared
method as a drive-by. The team-leader then traced the other consumers and found
the defect is **not latent** — one of them is reachable today.

## The defect

`libs/frontend/ui/src/lib/native/shared/keyboard-navigation.service.ts:100-110`

`configure()` **clamps** `activeIndex` to `itemCount - 1` rather than resetting
it. For a fixed-length list that is fine. For a **filter-as-you-type** list it is
not: after the list narrows, the active row is wherever the clamp landed, not the
new first match.

## The live victim

`libs/frontend/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.ts:140`

It configures from `suggestions().length` **inside an effect** and never resets.
It is a filter-as-you-type file picker — exactly the shape that trips the clamp.

**Type to narrow, press Enter, insert the wrong file.**

It already owns a `resetFocus()` at `:268`, but this path does not call it.

## The other consumers

| Consumer                                              | Risk                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| `unified-suggestions-dropdown.component.ts`           | **Live victim** — filter-as-you-type, no reset                                   |
| `native-autocomplete.component.ts`                    | Same shape; flagged by the Batch 10 logic reviewer as sharing the risk unguarded |
| `effort-selector`, `model-selector`, `agent-selector` | Fixed-length lists — immune                                                      |

## What TASK_2026_181 did, and why it stays

`libs/frontend/tasks-ui`'s command palette calls `configure()` and then
`setActiveIndex(0)` **synchronously** in `onQueryChange`, with a docblock
explaining that the ordering is eager on purpose. That workaround is correct
locally and should **stay** even after the shared method is fixed — it does not
depend on `configure()`'s reset semantics either way.

## Scope

1. Decide the shared semantics. Reset-on-reconfigure is the behaviour a
   filter-as-you-type list needs; a separate opt-in may be needed for any
   consumer that genuinely wants the clamp.
2. **Four consumers depend on today's behaviour** — the fix changes behaviour for
   all of them, so it needs its own tests rather than a drive-by. That is
   precisely why Batch 10 did not attempt it.
3. Fix `unified-suggestions-dropdown` regardless of which way the shared
   semantics land; it has a `resetFocus()` it simply is not calling.

## Test note inherited from Batch 10

Batch 10 shipped a test named _"resets the active row when the query narrows the
list"_ that **could not fail** for the scenario its own docblock described — its
fixture narrowed to exactly one match, which the clamp alone satisfies. Found by
mutation, and being corrected in that batch.

Any test written here must narrow to **more than one** remaining item, or it
tests the clamp rather than the reset. This is the same trap, and it is easy to
walk into twice.

---

# REOPENED 2026-08-09 — state-preservation safety review

The fix shipped in `5e74320d3`. It is reopened not because a defect was found,
but because the change makes `configure()` **unconditionally reset** the active
index — including on a same-count reconfigure — and the app depends on state
surviving navigation in ways this task never checked. That question must be
answered before the change is trusted, and this task owns answering it.

## The concern, stated plainly

Ptah runs background sessions, supports more than one workspace open at a time,
and caches per-page and per-tab state so a user does not lose work while moving
around the app. A `configure()` that always resets is safe only if no
`configure()` call sits on a restore, re-activation, or re-render path. If one
does, returning to a surface silently throws away the user's position — a worse
failure than the stale row this task fixed, because it is invisible until the
user notices their selection moved.

## What has already been verified — do not re-derive

Checked 2026-08-09 against the tree at `5e74320d3`:

- `KeyboardNavigationService` is declared `@Injectable()` with **no
  `providedIn`**. Every consumer lists it in its own component `providers: []`
  array — `unified-suggestions-dropdown`, `native-autocomplete`,
  `task-command-palette`, `effort-selector`, `model-selector`,
  `agent-selector`. It is therefore **component-scoped**: a fresh instance per
  component instance, destroyed with that component.
- All three components that actually call `configure()` are **transient
  overlays** — two autocomplete dropdowns and a command palette. None is a
  persistent tab surface, and none survives its own teardown.

On that evidence the reset cannot reach cached tab or page state: the only state
the service holds is an `activeIndex` belonging to an overlay that is already
gone. **This is a necessary check, not a sufficient one.**

## What this task must now establish

1. **Prove the DI scoping claim holds at runtime, not just by inspection.** A
   component `providers` array is defeated if any consumer is itself provided at
   a higher level, or if a parent re-provides the service. Confirm no consumer
   is instantiated once and reused across tab switches.
2. **Map every `configure()` call against the lifecycle that triggers it.** For
   each of the three call sites, establish whether it can fire on: restoring a
   cached tab, re-activating a background session, switching workspaces, or a
   re-render that is not a user-initiated list change. `unified-suggestions-dropdown`
   configures inside an `effect()` — establish exactly what that effect depends
   on and when it re-runs.
3. **Fact-check the state-preservation architecture itself.** Find where
   per-tab and per-page state is actually cached (`TabManagerService` in
   `chat-state` is the obvious starting point, but confirm rather than assume),
   what survives a workspace switch, and what a background session restores on
   re-activation. Write down what is genuinely preserved today versus what is
   assumed to be.
4. **If a real gap exists, design the architectural fix rather than patching
   `configure()` again.** The likely correct shape is that transient focus state
   and durable surface state are different concerns and should not share a
   lifecycle — but do not commit to that shape before the evidence is in.

## Rules for this pass

- **Do not revert `5e74320d3` reflexively.** The bug it fixed is real: type to
  narrow, press Enter, insert the wrong file. Reverting restores that. Any
  proposal must keep the narrowing behaviour correct.
- If the investigation finds the state-preservation gap is real but broader than
  keyboard focus, **it gets its own carrier**. This task does not grow to
  absorb it — it records the finding and hands off.
- Report findings as evidence with file and line citations. "Looks fine" is not
  an outcome; either a call path can reach a restore or it provably cannot.

## Why this blocks

`TASK_2026_163`'s manual Electron smoke is held behind this. The smoke exercises
chat, wizard, marketplace and dashboard across a live session, and it is not
worth running against navigation behaviour that is under question.
