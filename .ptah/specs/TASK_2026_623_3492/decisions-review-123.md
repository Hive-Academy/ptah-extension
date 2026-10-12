# Decision #123 review

## Verdict: REVISE

**Ruling: AGREE-WITH-CHANGE.** The command row may remain visible while collapsed: the approved design is the more specific, later visual contract for this ambiguity. It defines the 36 px value as the **header** height and separately puts the Bash command row in “Always visible”; the approved narrow collapsed prototype shows exactly that two-row card. `task-description.md:820-824` permits the Gate 1.7 height where stated, while `design-spec.md:186-191` states both constraints. The implementation follows that interpretation at `tool-call-header.component.ts:246-266`.

### Required change — Serious

Amend decision #123 and Batch 33 Task 33.3 so that the check does all of the following, at **both** `chat-narrow` (360) and `chat-wide` (1024), in dark and light:

1. Require the collapsed header-toggle row to be `<= 36 px` for Bash, Read, Write, and Edit; do not merely record an over-36 narrow result. R7.9 says each collapsed row must be no taller than the Gate 1.7 height when it states one (`task-description.md:820-824`), and that spec states 36 px (`design-spec.md:186-187`). The present ruling makes chat-wide the only asserted target and treats narrow as informational (`decisions.md:127`); the current Batch 33 text repeats that weakened check (`batches.md:2069-2071`). A likely long Read/Write/Edit path can wrap because the header is `flex-wrap` and its path uses `break-all` (`tool-call-header.component.ts:94,127-140`), so this is a real narrow-width failure path, not a theoretical measurement distinction.
2. Record the merge-base collapsed-row height for **Bash, Read, Write, and Edit in each theme**, not Bash only. R7.9 explicitly requires all four and each theme (`task-description.md:820-823`); Batch 33 currently records only Bash (`batches.md:2070-2071`).
3. Keep the Bash-card total-height comparison, but record the numeric implementation and prototype heights, width, theme, and the exact command fixture. “At most the prototype” is otherwise not an auditable pass/fail result (`decisions.md:127`; `batches.md:2069-2071`).

### Command access and horizontal overflow: AGREE

The collapsed command is one visual line through `truncate`, holds the complete value in `title`, and switches to wrapping (`whitespace-pre-wrap` and `break-all`) once expanded (`tool-call-header.component.ts:257-263`). The copy control receives the original command, not the truncated rendering (`tool-call-header.component.ts:265`; `tool-call-header.component.spec.ts:236-245`). The text remains in the DOM, so assistive technology receives the full code text; the `title` also meets the specified full-text affordance. The targeted header spec verifies the title and both state classes (`tool-call-header.component.spec.ts:212-234`) and bans horizontal-scroll/nowrap classes for a 300-character command (`:247-257`). The requirement still needs the proposed visual `scrollWidth <= clientWidth` measurement because class inspection alone cannot prove layout at 360 px (`task-description.md:925-933`).

### Accessibility and focus order: AGREE

There is no nested interactive control: the header expand toggle ends before the always-visible command row, so tab order is expand toggle then Copy command (`tool-call-header.component.ts:91-226,246-266`). File tools have no command-copy button; their Open-file control is a sibling after the toggle (`:228-243`), giving toggle then Open file. This is consistent with the design’s sibling-button requirement (`implementation-plan.md:1090-1092`) and is covered for Open file (`tool-call-header.component.spec.ts:137-159`) and Copy command being outside the toggle (`:236-245`). Escape from expanded item content restores focus to the toggle and consumes the event (`tool-call-item.component.ts:169-180`), satisfying R9.1 (`task-description.md:907-913`). No keyboard defect found in this flow.

### Five logic questions

1. **Silent failure:** a 37+ px narrow header could be recorded as an observation and still look like a passed Batch 33 review under the current wording (`decisions.md:127`; `batches.md:2069-2071`).
2. **Unexpected user action:** opening a chat at 360 px with a long Read/Write/Edit path can wrap the `flex-wrap` header and exceed the accepted 36 px baseline (`tool-call-header.component.ts:94,127-140`).
3. **Wrong-answer input:** a long path or command containing an unbroken token is the relevant input. Bash has ellipsis/wrap handling (`:257-263`); file paths lack an equivalent collapsed single-line constraint (`:127-140`).
4. **Dependency failure/shape:** no external dependency is involved in rendering the Bash command. A missing/non-Bash-shaped input yields an empty `bashCommand()` and therefore no row (`tool-call-header.component.ts:347-351`), rather than falsely copying a fabricated value.
5. **Missing requirement coverage:** R7.9’s mandatory merge-base record for Read, Write, and Edit and the exact measurable prototype-height evidence are absent from the ruling’s Batch 33 check (`task-description.md:820-824`; `batches.md:2069-2071`).

## Review scope and evidence

Read decision #8 and #117-#124, Batch 27 and Batch 33 Task 33.3, R7/R9, implementation-plan component 11, design-spec section 6, parity-inventory section 4, the prototype markup and collapsed-dark screenshot, the complete header/component specs, and the complete tool-call item implementation. No tests, builds, Nx commands, or source edits were run, per `CLAUDE.md` memory-safe rules. Native file reads were used because no `ptah_*` read/diagnostic tools were supplied in this session.
