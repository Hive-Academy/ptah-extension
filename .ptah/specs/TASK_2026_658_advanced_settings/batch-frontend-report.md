# Frontend batch report - TASK_2026_658 (Components 5-6)

Worktree: D:\projects\ptah-extension\.claude-worktrees\feat-advanced-settings-ui (branch
feat/advanced-settings-ui). Nothing staged or committed. The working tree is left dirty for the orchestrator.

## Status

- [x] Component 5: AdvancedSettingsGroupComponent and its spec
- [x] Component 6: placement in the Orchestration and Advanced tabs, with host specs

## Files (relative to the worktree)

### Component 5: generic group (chat)

- CREATED `libs/frontend/chat/src/lib/settings/advanced/advanced-settings-group.component.ts`
  - Selector `ptah-advanced-settings-group`, `groupId = input.required<AdvancedSettingGroupId>()`. Standalone, OnPush,
    signals, `inject()`. No `any`, no console.
  - Renders inside `ptah-surface-section` (tone subtle, padding md). It has `aria-labelledby` pointing at the group heading
    `advanced-group-{id}-heading` and `data-testid="settings-section-{groupId}"`. The heading and description come from
    `ADVANCED_SETTING_GROUPS`, and the fields come from `ADVANCED_SETTINGS` filtered by group.
  - Number fields:
    - Text input with `inputmode` numeric or decimal, derived from `integer`, plus a unit suffix when `unit` is set.
    - Commits on `change` (Enter or blur) and on `blur` when a draft is still pending. That blur path is the card's own,
      and it re-commits after an unconfirmed save.
    - Strips `,` `_` and whitespace before parsing. An empty field gives "Enter a value." and non-numeric text gives
      "Enter a number.". Every other check goes through `validateAdvancedSettingValue`, for example "Use a whole number
      from 1 to 365 days.".
    - An unchanged value is not written.
  - Booleans: a toggle that shows only the read-back value. The box is reset before the write and moves only when the
    write is confirmed, as in the card.
  - Help text = descriptor help + ` Range: {min} to {max} {unit}.` (numbers only) + the apply note. The four apply
    notes use the plan's exact strings. `restart` keys also get a small outline "Restart" badge, which is
    `aria-hidden` because the help text already says "Restart Ptah to apply.".
  - Status and errors:
    - One `role="status"` line per group, using the card's exact strings: "Saved {label}.", "Could not save {label}. The
      saved setting is unchanged." and "Could not confirm saving {label}. Reopen settings to see the saved value.".
    - When the host returns `data.error`, that error is shown under the field.
    - Loading text, and a load error (`role="alert"`) with a "Retry {title}" button. A rejected or failed read leads
      to Retry.
  - Reads and writes:
    - `rpcCall(this.vscode, 'settings:get' | 'settings:set', ..., 5_000)`. Reads run in parallel per group.
    - One `savingKey` makes every control in the group busy through `SettingsBusyDisabledDirective` (`aria-disabled`,
      focus kept).
    - A timeout is detected by the `RPC timeout` prefix, as in the card.
  - Accessibility:
    - Each number input has a `<label for>`. A toggle has an `aria-label`.
    - Every control has `aria-describedby` (help, plus the error and stored notice when present) and `aria-invalid`
      when an error is shown, plus the card's focus-ring class.
  - Test ids:
    - `data-testid="advanced-setting-{key}"` on every control.
    - `advanced-setting-{key}-field` on each field wrapper, added for the visual reviewer's screenshots.
    - `-error` and `-stored` on the messages.
    - `advanced-group-{id}-loading`, `-load-error`, `-retry` and `-status` on the group states.
  - No timers or observers.
- CREATED `libs/frontend/chat/src/lib/settings/advanced/advanced-settings-group.component.spec.ts`
  - 31 tests. The harness is the session-budget card's: `rpcCall` is mocked through `jest.mock('@ptah-extension/core')`,
    with an in-memory store seeded from the descriptor defaults.
  - Load:
    - Reads only the group's keys, with a 5 s timeout each. A key from another group has no control.
    - Every group (`it.each` over all 7) renders one labelled, described control per descriptor.
    - The section is labelled by its heading.
    - A read failure shows Retry, and Retry reads again. A rejected read also shows Retry.
    - A hand-edited invalid number or boolean shows the stored notice and adds it to `aria-describedby`.
  - Help text: range plus unit plus "Applies on the next cleanup run."; a restart key shows its note and badge, and a
    non-restart group has no badge; the Codex and live notes are checked.
  - Number fields:
    - A valid commit sends the exact key and number and shows "Saved {label}.". Grouped digits are accepted.
    - `7.5`, `0`, `366`, `abc` and an empty field are each refused inline with `aria-invalid` and no `settings:set`.
    - The decimal key gets `inputmode=decimal`, has no unit suffix and writes 0.75.
    - An unchanged value is not written. 0 is written for a key whose minimum is 0.
  - Toggles: a toggle writes a boolean and shows "Saved". A transport failure leaves the box at its saved value and
    shows "Could not save".
  - Failed writes:
    - A host `success:false` shows its `error` under the field, keeps the typed text and leaves the store unchanged.
    - Writes use a 5 s timeout.
    - A timeout shows the unconfirmed message and frees the group, and the next edit is written.
    - Every control is `aria-disabled` while a write is in flight.

### Component 6: placement

- MODIFIED `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts`
  - Imports `AdvancedSettingsGroupComponent`.
  - One new `@defer (on viewport)` block renders `context-budgets`, `codex-agents` and `background-queries`.
  - The placeholder is one row, `min-h-[2.75rem]`, with the same classes as the session-budget placeholder and
    `data-testid="orchestration-advanced-placeholder"`.
  - The block sits after `<ptah-lane-guards-settings />`; see Deviations. The class doc comment was updated.
- MODIFIED `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.spec.ts`
  - Adds an `AdvancedGroupStub` and swaps it in through `overrideComponent`.
  - The existing defer-count assertion changes from 3 to 4.
  - New test: the placeholder shows and no group renders. After `DeferBlockState.Complete`, the three groups render in
    order, after the roles `<details>`, the session budget and Lane guards.
- MODIFIED `libs/frontend/chat/src/lib/settings/advanced-settings.component.ts`
  - After `<ptah-vscode-lm-config>`, adds a closed-by-default `<details>` (`data-testid="fine-tuning-details"`)
    inside `ptah-surface-section padding="md"`.
  - Its summary (`fine-tuning-summary`, with the focus ring and the same chevron-on-wrapper pattern as the
    orchestration roles disclosure) shows "Fine-tuning" and the plan's description copy.
  - It wraps one `@defer (on viewport)` block that renders `memory-upkeep`, `skill-upkeep`, `scheduled-jobs` and
    `workspace-harness`, with placeholder `fine-tuning-placeholder`.
  - Adds the `ChevronRight`, `SurfaceSectionComponent` and `FOCUS` constants. The doc comment was updated.
- MODIFIED `libs/frontend/chat/src/lib/settings/advanced-settings.component.spec.ts`
  - Adds a group stub and swaps it in. The card-order test now ends with the Fine-tuning details.
  - New test: the details are closed and the summary reads "Fine-tuning". The placeholder renders first; after
    Complete the four groups render in order inside the details.

## Verification (run from the worktree)

- `npx jest -c libs/frontend/chat/jest.config.ts <group spec> <orchestration spec> <advanced spec> --coverage=false --maxWorkers=2`
  gave 3 suites and 78 tests, all passing (31 of them in the group spec, which also passed alone first).
- `npx eslint libs/frontend/chat/src/lib/settings/advanced/ <the 4 modified files>` exited 0 with no output.
- `npx prettier --write <all 6 files>` was applied.
- `ptah_get_diagnostics` on the group component reported nothing in that file. The 252 errors it reported are all in
  other, pre-existing chat spec files (for example tab-bar.component.spec.ts TabId and execution-node casts), not in
  files this batch touched.
- Not run, as instructed: `nx typecheck` (`ngc --noEmit`, strictTemplates), `nx lint` (module boundaries) and
  `nx test`. The template depends on `@if (setting.kind === 'boolean') … @else` narrowing `setting` to
  `AdvancedNumberSetting` for `numberText` / `edit` / `commit` / `setting.integer` / `setting.unit`. Angular's control
  flow type-checks the else branch with the negated guard, but only `ngc` confirms it. The orchestrator's `nx typecheck`
  for `@ptah-extension/chat` is the check that matters here.

## Plan deviations

1. **Stored-value notice copy.** The plan's text was "The saved value is not valid; Ptah uses the default (X).". The
   implementation shows "The saved value is not valid. Save a new value to replace it. Default: {X}." The plan's
   claim is false for part of the table:
   - Memory retention and lifecycle clamp a stored number to the nearest bound and do not fall back to the default
     (`memory-retention-config.ts:163-170`, `memory-lifecycle-config.ts:32-39`, `Math.min(max, Math.max(min, trunc))`).
   - The A1 keys (compaction, Codex, internalQuery, and so on) have no consumer maximum, so the consumer uses a stored
     value above the product limit as it is.

   The new copy is true for every key.
2. **Orchestration placement.** The new defer block sits after `<ptah-lane-guards-settings />`, not between the
   session-budget block and Lane guards. Lane guards' comment says it "should always be available", and the three
   groups (10 fields) would push it far down. The block is still after the session budget and below the fold, so the
   660 px budget is unchanged.
3. **Range format.** It reads "Range: 1,000 to 100,000,000 weighted tokens." ("to") instead of "{min}-{max}". This
   matches the card's `range()` copy and the shared validator's wording.
4. **Formatting noise.** `advanced-settings.component.ts` and `advanced-settings.component.spec.ts` did not pass
   `prettier --check` before this batch. Running `prettier --write` as instructed reformats both files, so the spec
   diff is mostly whitespace (about 320 lines). The pre-commit hook (`nx format:write`) would make the same change.

## Decisions

- **Grid without `auto-rows-fr`.** The group grid is `grid items-start gap-4 md:grid-cols-3`. The card uses
  `auto-rows-fr`, but help text here is longer (help + range + apply note). Equal-height rows would stretch every row to
  the longest help text.
- **Host error text.** A host `success:false` with a string `error` is shown under the field, as the plan says. The
  status line keeps the card's fixed copy. Because the webview and host share the same validator, a refusal after the
  client check passes is in practice a host exception message (for example a file write error). That text goes to the
  local user only, but it is host text. If review prefers the D15 rule ("host text never shown"), drop `refusal` in
  `write()`; it is a one-line change.
- **Read failures.** `rpcCall` rejections on read become a load error through `.catch(() => null)`. Write rejections
  use an empty `catch` with a comment. Both replace the card's `console.warn`, which the batch rules forbid.
- **Negative numbers.** They parse, so "-5" gets the validator's range message rather than "Enter a number.".
- **Toggle text.** The toggle shows "Enabled" next to the box and uses `aria-label = label`, copied from the card.
- **Outer Fine-tuning card.** It uses the default surface tone, so the nested subtle group cards stay visually distinct.

## Out-of-scope observations

- Pre-existing TypeScript errors in other chat spec files (shown by `ptah_get_diagnostics`), for example
  `tab-bar.component.spec.ts` TabId literals and `execution-node.send-message.spec.ts` casts. They are untouched.
- No e2e fixture check (A3) was done; no e2e was run, per CLAUDE.md.
