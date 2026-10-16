# Gate 1 requirements re-review — round 1

**Verdict: REVISE — 5/10.** Four earlier findings are fixed, one is partly fixed, and one is fixed. The view-mode and citation repairs are concrete, but the revised duration and parity rules still permit materially different implementations. This is above a foundational failure because the requested surfaces and T1 mapping are defined; it is below a sound 7/10 because two serious data contracts conflict or discard retained information.

## Earlier findings

| Finding | Status | Evidence |
| --- | --- | --- |
| 1. View-mode toggle | Fixed | `task-description.md:47,466-495` defines both densities, live and completed turns, inspector default, toggle behavior, persistence and old saved tabs. |
| 2. Duration persistence | Partly fixed | `task-description.md:117-146,151-160` defines durable `S`/`E`, fallback, zero-activity and running-agent behavior. But `:119-132` excludes agent completion from `E`, while `:156-158` permits adding a CLI completion time (new finding 2). |
| 3. T1-27/28 and F6-F12 | Partly fixed | `task-description.md:220-224` makes T1-28 unconditional, and `:225-240` assigns F6-F12. F9/T1-27 still says only “details in subagent-tile” and postpones the actual finding text to an implementation plan, leaving no checkable outcome at this gate (new finding 3). |
| 4. User-turn time and sender | Fixed | `task-description.md:195-200` specifies time text, `datetime`, full-date title, `You`/peer, accessibility-tree presence and peer visibility. |
| 5. C-18 and D-10 citations | Fixed | `parity-inventory.md:93` points to the composer implementation; `chat-input.component.ts:230-261,281-334,356,390-419` contains the named controls. `parity-inventory.md:108` points to `canvas-rail-board.component.ts:181,208,239`, each an `@defer (on idle)` around session details. |
| 6. T1-01 tiles versus chips | Fixed | `task-description.md:54,242-257` declares chip plus expanded activity row plus inspector row equivalent, and maps current tile fields by state. |

## New and remaining findings

1. **Serious — Retained per-message metrics become turn-only aggregates.** `parity-inventory.md:57-58` marks per-message tokens, cost and duration as `move`; `task-description.md:272-276` requires only sums over the turn, and `:159-160` explicitly says the per-message split is not shown when there are several assistant messages. Two assistant messages with different costs or durations therefore lose their individual values without any `remove-proposed` row, contrary to `task-description.md:457-461` and `parity-inventory.md:111-114`. The `Worked for` elapsed value also does not preserve an individual message's duration (`task-description.md:117-128`). **Fix:** Keep a per-message breakdown in the activity panel or another named reachable place, including duration, while retaining the turn totals; otherwise mark the lost granularity as a proposed removal for the user and do not claim full parity.

2. **Serious — The settled duration has two incompatible definitions.** `task-description.md:119-120` defines `E` solely as the maximum assistant `timestamp + duration`; `:129-132` says agent runtime after the last assistant message is excluded. Yet `:156-158` allows `E` to include a persisted CLI completion time. The aligned design repeats both rules in `design-spec.md:304,309`. The same completed turn can therefore show two different `Worked for` values depending on which sentence an implementer follows. **Fix:** Choose one rule for `E`, state it in the duration terms and criteria, and align A2 and design-spec §3.9. If CLI completion is included, state exactly which owned lane times qualify and how multiple lanes combine.

3. **Moderate — T1-27 still lacks an observable success condition.** `task-description.md:225-229` requires resolving “details in subagent-tile” but does not state what the defect is or what changed code must do; it says the architect will quote the full finding later. `reference/pr730-followup-map.md:50` has the same terse description. The F6-F12 table at `task-description.md:232-240` names outcomes for the other six, but repeats the F9 label. **Fix:** Put the full F9 finding and a checkable result in this requirement, or cite an available section containing both before Gate 1 approval.

4. **Moderate — Full-mode inspector open state conflicts with its close control.** `task-description.md:285-286` says that at ≥960 px in `full` the inspector is docked open, while `:295-296` requires a toggle that flips between Show and Hide. Requirement 16.4 (`:483-485`) likewise distinguishes `full` open from `compact` closed. It is unclear whether a user can close the full-mode dock, whether switching modes resets a manual choice, and whether that choice survives a tab switch. **Fix:** Define these as initial defaults, then specify the manual toggle state across mode changes and tab switches; or explicitly make the full-mode dock non-closable and revise its control criterion.

## Removals / visibility changes for the user

- **Proposed removals:** none (`parity-inventory.md:111-114`). B-4, B-8 and B-11 are listed as moved; B-14 and B-15 as kept. This review does not approve or reject any removal.
- **B-8/B-11/B-12:** per-message cost, token and duration badges move behind `Show activity`; the turn duration remains at rest in the disclosure (`parity-inventory.md:120-121`). Finding 1 addresses the missing per-message breakdown.
- **B-16:** user-turn time and `You` appear on hover/focus or without hover capability, remain screen-reader readable, and the inbound peer label remains visible at rest (`parity-inventory.md:122-123`).
- **B-14/B-15:** Branch and Rewind retain hover reveal and gain focus reveal (`parity-inventory.md:124`).

## Five logic questions

1. **Silent success:** a UI can display valid turn totals while silently losing the per-message values (finding 1).
2. **Unexpected user action:** closing the inspector in wide `full` mode has no defined lasting result (finding 4).
3. **Wrong answer from input data:** several assistant messages make the activity panel's total insufficient to recover each message's cost or duration (finding 1).
4. **Dependency failure or malformed data:** missing timestamps and durations have a bare `Worked` fallback (`task-description.md:137-145`); a persisted CLI completion time remains an unresolved input to `E` (finding 2).
5. **Missing requirement:** F9/T1-27 has no independently checkable outcome in the current requirements (finding 3).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Treat the six remapped F6-F12 items as scoped/deferred as written; retain F9 as an open criterion. | Require all seven now; follow the explicit T1/T3 split. | `task-description.md:98-100,232-240`; `reference/pr730-followup-map.md:50`. | Yes. |
| Treat summed turn metrics as insufficient proof of per-message parity when a turn has multiple assistant messages. | Accept aggregate as equivalent; retain the breakdown. | `parity-inventory.md:57-58`; `task-description.md:159-160,272-276,457-461`. | Yes; any capability removal is user-reserved. |

No checks were run; this was a document review with the requested code-citation spot-checks.
