# Batch 7 fix round 1: surface input components

Executor: frontend-developer. Scope: the files under `libs/frontend/declarative-dashboard/src/lib/components/`
(`C/` below). No git run. No other file touched. The checkbox component and its spec needed no change: none of
F1-F3 applies to it (it holds no local text and no options).

## Fixes

### F1 (High): a consumed draft commits once

`C/surface-text-input.component.ts`
- `:113` `consumed`: the `drafts` object in force at the last successful commit, plus the component id it was for.
- `:218` `commitDraft` records `consumed` on every commit that passes the gate, including an "unchanged" one
  that emits only the draft removal.
- `:226-234` `currentDraft`: while `drafts()` is still that same object (the parent has not yet passed new
  inputs) and the node id matches, the fallback to `drafts()[id]` returns nothing, so a second blur, Enter, or
  debounce-then-blur emits nothing. The marker is keyed by the `drafts` object, not by the value. A later
  intentional edit to the same string still commits (the spec pins this). A new `drafts` object from the parent,
  or a different node id, clears the block.

### F2 (High): stale local text is dropped

`C/surface-text-input.component.ts`
- `:31-37` `TypedText`: the typed text keyed by `componentId`, `path`, `hostValue` and the `drafts` object it
  was typed against. It replaces the untyped `typedText` field (`:107`, set at `:182`).
- `:241-245` `isStale`: stale when the id or path changes, when the host value changes (`Object.is`), or when the
  parent has passed a new `drafts` object whose entry is not this text (removed or replaced). The same `drafts`
  object means the write has not round-tripped yet, so the typed text stands (first-commit support is kept).
  An unrelated drafts update that keeps this entry keeps the text.
- `:123-127` `effect()`: on every `node`/`drafts` input change it runs `isStale` and calls `dropTyped`
  (`:246-249`), which clears the typed text and the pending debounce timer.
- `:229` `currentDraft` runs the same guard at commit time, so a blur or timer that fires with no change
  detection in between also cannot send stale text.
- After invalidation, a commit falls back to this node's current `drafts` entry, which is what the UI shows. It
  never uses another component's id: the id comes from the current node, and a swapped node reads its own entry.

### F3 (Medium): validation uses the rendered options

`C/surface-choice-input.component.ts`
- `:108` `checkedNode`: `{ ...node(), options: options() }`. `options()` (`:103-106`) is the filtered
  well-formed list, and `[]` for a non-array.
- `:131` `errorText` and `:153` `chooseIndex` pass `checkedNode()` to `checkDraftValue`. Selection, and
  errorText with a string host, draft or pending value, can no longer throw. The shared validator is unchanged.

### Code-logic-reviewer item: invariant comment

`C/surface-text-input.component.ts:115-121`: only the owning input removes its own `drafts` entry, through
`draftChange`. Anything else that removes or replaces it, or changes the node or host value, makes the effect
drop the typed text and its timer. The Enter-then-blur spec is F1's first spec.

Kept out of this round, as instructed: helper extraction (review item (d)) and the host-rejection channel (B8).

## New specs, and proof each one fails without its fix

Red run: I swapped the pre-fix `surface-text-input.component.ts` and `surface-choice-input.component.ts` back
in, kept the new specs, and ran
`npx jest -c libs/frontend/declarative-dashboard/jest.config.ts <text spec> <choice spec> --verbose`.
Result: `Tests: 10 failed, 33 passed, 43 total`. Then I restored the fixed sources.

| Spec (file:line) | Fix | Pre-fix failure observed |
| --- | --- | --- |
| text spec:254 "a consumed draft commits once (F1) › commits once for Enter then blur with no change detection in between, and again for a new edit" | F1 | two `{reason, 'draft'}` commits instead of one |
| text spec:269 "… › commits once when the debounce fires and a blur follows before the parent refreshes" | F1 | `{reason, 'ab'}` committed three times (timer, blur, Enter) |
| text spec:283 "typed text is dropped when it is no longer what the UI shows (F2) › does not commit after the host value is replaced and the draft cleared" | F2 | committed `{reason, 'stale'}` |
| text spec:295 "… › does not commit under either id after the node is swapped to another component" | F2 | committed `{other, 'typed'}` (old text under the new id) |
| text spec:306 "… › does not let a pending timer commit a draft the parent cleared externally" | F2 | the timer committed `{reason, 'pending text'}` |
| text spec:316 "… › commits the externally replaced draft the UI shows, not the old typed text" | F2 | committed `'mine'` instead of the shown `'theirs'` |
| choice spec:202 "malformed options validate like they render (F3, select) › commits the valid option without throwing when a null entry sits beside it" | F3 | `TypeError: Cannot read properties of null (reading 'value')`, no commit |
| choice spec:209 "… (F3, select) › treats non-array options as none and never throws for a string host, draft or pending value" | F3 | `TypeError: input.options.some is not a function` |
| choice spec:202 / :209, same two for `radio-group` (`describe.each`) | F3 | same two TypeErrors |

Non-regression pin, green both before and after the fix: text spec:325 "… › keeps typed text across an
unrelated drafts update". It proves the F2 guard does not drop drafts on unrelated view-state changes.

One assertion was dropped while I wrote the specs: I first asserted `jest.getTimerCount() === 0` in spec:306.
The framework already holds two fake timers before any typing, so an absolute count does not isolate this
component's timer. The spec asserts the behaviour instead: advancing past the debounce commits nothing. This
was my new spec, not an existing one.

## Existing assertions

No existing spec or assertion changed. All new specs were appended (text spec after the last existing `it`,
choice spec as a new `describe.each` before "gives each instance unique ids"). No fixture or helper was edited.
All 114 pre-existing tests pass unchanged.

## Test counts

- Before this round: 12 suites, 114 tests (batch-7-report.md).
- After: 12 suites, 125 passed, 0 failed (+11 new: 7 text, 4 choice).
- Lint: 0 errors, 41 warnings (was 39). The +2 are `no-non-null-assertion` on the two `querySelector(...)!`
  calls in the new choice spec. They follow the spec pattern the lib already accepts.

## Verification

`npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard --skip-nx-cache`
(run with `--parallel=2 --output-style=static`): succeeded, `Test Suites: 12 passed`, `Tests: 125 passed, 125 total`.

Last 10 lines:

```
 NX   Successfully ran targets lint, typecheck, test for project @ptah-extension/declarative-dashboard


  Run duration:      11.0s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     9.9s (1 task)
  Recoverable time:  1.1s (10% of the run)
```

(The visible output ends with blank lines after the summary. Those are the lines shown above.)

## Notes for B8

- The F2 drafts guard assumes the parent applies each `draftChange` write synchronously, before it passes the
  next `drafts` object, which is what the spec host does. If a parent batches writes so that a refreshed `drafts`
  holds an older keystroke than the typed text, the guard drops the typed text, and the displayed older draft
  becomes what commits.
- An invalidated draft entry under a swapped-away component id is not removed by this input, per the invariant
  above. The renderer owns cleanup of entries for components that left the surface.
