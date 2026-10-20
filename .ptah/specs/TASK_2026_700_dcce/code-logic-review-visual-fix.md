# Code Logic Review (visual fix) - TASK_2026_700_dcce

Score: 8/10. Verdict: APPROVED (no must-fix). Read from the uncommitted diff plus the full CSS, dock styles and session-controls template. Specs not re-run (orchestrator reported 539/539).

## Verified
- aria-live: one `<p aria-live="polite">` remains (command-session-controls.component.ts:33), only moved into `.session-support`; text unchanged. Spec asserts it.
- Contracts intact: `label[for="command-text"]`, `#command-text`, form/submit, Send aria-label unchanged. Mute/Stop `[disabled]` bindings and handlers unchanged; only classes changed (command-voice-hud.component.ts:53,55). Retry speech / Could not send blocks not in diff.
- Help text: ellipsis via `truncate` but full text stays in the DOM, so assistive tech reads it. `title` is a bonus.
- Dock placement: desktop support row 2 / recovery row 3; <=1100 entry 3, support 4, recovery 5; <=720 entry 3, new 4, support 5, recovery 6. No collisions, and the support line spans `1 / -1` at every width. `display: contents` chain still lets `.session-support` act as a grid item.
- Stats-band ResizeObserver: the page component .ts is not in the diff; the band CSS is untouched.
- Rail: flex column with `min-height: 0` and `overflow-y: auto`; work-list-region keeps `min-height: 7rem` and its own scroll, so a pending card stays reachable. At <=720 the rail becomes visible-overflow and the list block-height-capped at 24rem, so it is still reachable.

## Findings
1. Low, should-fix, not blocking. command-center-page.component.spec.ts:~569. The orchestrator's <=720px fix is the regression that was actually found (stage overlapping the dock), but nothing asserts it. The spec checks `.work-list-region` and `ptah-command-work-list` in the narrow block only. Nothing checks `.layout { display: flex; flex: none; ...}`, `.stage-column, .dock, .rail { flex: none; ...}` or `.stage { min-height: 500px }`. Fix: add three `expect(narrow).toContain(...)` lines.
2. Low. command-center-page.component.css last line. The `@container (max-width: 480px)` rule sets `.layout` grid-template-rows, but `.layout` is already `display: flex` at <=720px, so the property is dead. The spec asserts it, which hides that. Fix: drop the rule and its assertion, or keep it as documented harmless.
3. Low. command-session-controls.component.ts:34. At narrow widths (<=720px, about 350px of text space) the Tribunal help is ellipsised, and sighted mouse users only see it on hover. Touch and keyboard users cannot see the full text. The help was visible in full before. Fix (optional): allow `whitespace-normal` below 720px, or `line-clamp-2`.
4. Nit. command-voice-hud.component.ts:~57. The third button (shown while speaking) is still `btn-ghost`, so it is inconsistent with the bordered Mute/Stop. Fix: apply the same outline classes if the prototype calls for it.
5. Nit. At 721-1000px the stage min is 570 and the grid rows are `minmax(570px, 1fr)`, so the content can overflow a short host. The page scrolls, so it is acceptable. At <=720px the stage drops to 500 (down from 570) intentionally.

## Must-fix
None.
