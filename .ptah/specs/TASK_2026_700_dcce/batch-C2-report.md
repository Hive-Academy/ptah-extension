# Batch C2 report

## Files changed

- `libs/frontend/command-center/src/lib/components/command-work-list.component.ts`
- `libs/frontend/command-center/src/lib/components/command-work-list.component.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-pending-input.component.ts`
- `libs/frontend/command-center/src/lib/components/command-pending-input.component.spec.ts`

## Acceptance items

- Delegated work retains every non-root projection node. Rows render in parent/child order from `parentId`, with indentation capped at three levels. The flat roving keyboard index, ArrowUp/ArrowDown wrap, Enter selection, projection-index focus return, `aria-current`, visible state text, count, off-canvas line, empty guidance, and one polite state-change region remain. Child rows show a decorative GitBranch glyph and unknown child text stays at full opacity.
- The delegated card has one list scroll container. One guarded `ResizeObserver` watches that container and disconnects on destroy. Clipping controls its scroll cue and bottom fade; a render check handles content changes within a container of unchanged size. Reduced motion continues to stop the running icon spin.
- The pending surface has a warm bordered card, kind icons, session-scoped copy, and an assertive announcement. Approval, question, and Tribunal variants retain their existing response guards, typed-answer reset, rejection and timeout feedback, and focused keyboard confirmation. An invalid Tribunal proposal displays a disabled Confirm control.

## Tests added or updated

- Work list: nested order and bounded indentation, projection-index focus, child glyph and unknown state, keyboard wrap, single observer lifecycle and clipping cue/fade.
- Pending input: scoped question and typed answer, approval controls, focused Tribunal confirmation, and disabled invalid confirmation.
- Existing component tests for state text, live region, reduced motion, answer retry, timeout, and duplicate-action guards remain.

## Verification

- Did not run Nx, Jest, build, lint, or e2e because C1 and C2 run in parallel and the orchestrator owns the heavy checks.
- The first scoped `ptah_get_diagnostics` result reported no errors in the four requested files. It also reported pre-existing-looking errors in sibling integration and coordinator specs outside this batch. After the final edits, two scoped diagnostic attempts returned `TypeScript check still running after 45s`, so a final compiler result is unavailable.

## N1 wording conflicts

None. Existing asserted list text, pending title/answer selectors, visible state/kind text, and Confirm Tribunal wording are retained. The owned invalid-proposal test now checks the required disabled Confirm control.

## Decisions

- **Nested visual order with flat focus index.** Options were to keep projection order and indent rows, or render a parent-first depth-first order. `parentId` is the ownership relation in `work-projection.ts`, and C2 requires owned rows beneath children, so the depth-first order is used. `focusRow` still resolves the requested projection index by node ID. Reversible.
- **Single scroll observer plus render check.** Options were observer only or observer with a render check. A container can retain the same box size while its content changes, so the render check keeps the cue accurate without adding observers or timers. Reversible.
- **Disabled invalid Tribunal Confirm.** Options were to omit Confirm or show it disabled. C2 explicitly requires invalid-proposal disable; the latter makes that state visible while `confirmRoster` continues to reject it. Reversible.
