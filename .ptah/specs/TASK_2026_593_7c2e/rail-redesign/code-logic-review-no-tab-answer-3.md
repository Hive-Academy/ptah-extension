# Code Logic Review — `TASK_2026_593_7c2e` (no-tab permission answer, round 3)

Review family: grok (implementer: codex)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | REVISE |
| Blocking issues | 1 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes | 1 |

Verdict: **REVISE**. Score **4/10**.

`permissionPreview` no longer runs tool input through `isUnsafeAttentionContext`. Shortened paths, path-bearing commands, truncation, and the requested redaction are in that helper. Deny with message focuses the field, trims, and refuses a blank reason with an inline error. None of that runs for a titled tab: this round removed the `isUnsafeAttentionContext` import and left two calls in `add`, so `reconcile` throws before `upsert`.

What separates 4 from 5: a 5 still leaves the feature operating. Here the throw is on the happy path the spec already builds (`title: 'Fix notifications'`, `titleOrigin: 'user'`), and it aborts the whole reconcile before any preview is published. What separates 4 from 3: the preview helper and the deny-message component match the requested behavior at the lines below. Restoring the import makes this round's logic hold. This is not a wrong preview design.

Tests and builds were not run (review rule). `ptah_*` search returned no tools (`search_tool` for code search and `ptah_agent_report`). Evidence is `git diff` for the service and its spec, and full reads of `chat-attention-source.service.ts`, `attention-permission-actions.component.ts`, and `attention-permission-actions.component.spec.ts`. No source file was edited.

## Decisions

- Treat the deleted import as a logic failure, not a style nit. Options were to hand it to the style review because it is an unbound name, or to file it here because `add` throws and the attention set never updates. The calls at `chat-attention-source.service.ts:171` and `:180` are still live. Reversible by importing `isUnsafeAttentionContext` again.
- Do not reopen payload shape, stale refusal, rail workspace equality, or lane reason order. Those were accepted in round 2 and this diff does not change them.
- Do not file bidi spoofing. `safePreview` strips only C0 and DEL (`:26`). The fix note promised that set. Format characters such as U+202E remain. Recorded under question 3 as residual, not a numbered defect.

## Old defects

1. **Fixed in the helper, not reached on a titled tab.** See new defect 1 for the throw. The helper itself:
   - Drops the context-label filter. `chat-attention-source.service.ts:8` imports only `attentionContext`. `permissionPreview` (`:33-49`) never calls `isUnsafeAttentionContext`.
   - File paths use the card's last-two-segments rule (`permission-request-card.component.ts:377-381`). `chat-attention-source.service.ts:37-39` normalizes backslashes, and when `parts.length > 2` shows `.../` plus the last two segments. Two segments or fewer keep the original string, which is what `shortenPath` returns.
   - Commands stay visible, including paths: `:36` previews `command` at 40 characters. `rm -rf /tmp/foo` is under that cap.
   - Patterns use 30 characters (`:40`). The card uses the same caps (`permission-request-card.component.ts:349` and `:360-366`).
   - Over-limit text gets `...` (`:29`). Description is redacted and capped at 50 (`:47`). The joined line is cut at 160 (`:48-49`). Command 40 + description 50 plus the labels stays under 160, so the outer cut does not eat a normal card-shaped preview.
   - Secrets: `password` / `passwd` / `secret` / `token` / `api_key` / `api-key` / `apikey` / `auth` as `key=value` (quotes or a single token) and as `--flag value` (`:20-22`, applied at `:27-28`). Known shapes `sk-` (8+), `AKIA` plus 16, `ghp_`, `xoxb-`, 32+ hex, and 40+ token characters (`:23`). Redaction runs on the full string before the slice, so a secret past the display cap is not left in the tail.
   - Allow stays enabled for session permissions (`:190`). The preview no longer replaces the body with `[sensitive input]`.
   - Specs name the strings (`chat-attention-source.service.spec.ts:138-163`) but do not get there while `add` throws (new defect 1).
2. **Fixed.**
   - Focus on open: `attention-permission-actions.component.ts:56-59` reads `expanded()` and `reasonField()` and calls `focus()`. The spec expects `document.activeElement` to be the field (`attention-permission-actions.component.spec.ts:29`).
   - Trimmed reason, no emit when blank: `:71-79`. Whitespace sets `reasonError` and returns before `selected.emit`. A padded value emits the trimmed string. Spec `:35-56`.
   - Inline error: `:34-38` sets `aria-invalid="true"` and `aria-describedby` only while `reasonError()` is set. The message is `Enter a reason for denial.` (`:38`). Input, cancel, and toggle clear the flag (`:36`, `:63`, `:85`).
   - `novalidate` (`:30`) lets the handler see an empty field instead of stopping at native `required`.
   - Enter submits the form (`:30` → `:71`). Escape runs `cancel` (`:30`, `:82-86`), which closes the form and does not emit. Spec `:59-68` dispatches Escape on the form and expects the form to be gone.

## New defects

1. **Blocking.** Deleting the context-filter import makes `add` throw, so a titled tab never publishes the preview this round just fixed.
   - `chat-attention-source.service.ts:8` imports `attentionContext` only. The diff removes `isUnsafeAttentionContext` from that import.
   - `:171-172` still evaluates `isUnsafeAttentionContext(sessionTitle)` whenever `sessionTitle` is non-empty. `:180-181` does the same for a non-empty question.
   - `sessionTitle` is the tab title when `titleOrigin !== 'default'` and the title is not a generic placeholder (`:169-170`). The spec's own tab is `Fix notifications` / `titleOrigin: 'user'` (`chat-attention-source.service.spec.ts:16-17` and `:28-29`), so the first `permissions.set` in that suite hits `:171`.
   - There is no local binding and no other import. The call is a `ReferenceError`.
   - `reconcile` (`:97-116`) calls `add` with no `try`. The throw happens before `this.live.clear()` and `notifications.upsert` (`:125-129`). Items already pushed onto the local `next` map are discarded. Later permissions, questions, and lanes in that pass are not visited. Stale keys are not resolved.
   - The effect calls `reconcile` from `untracked` (`:78-89`). The signals were already read, so the user-visible result of the tick is: no new row, no updated preview, previous rows left in place. `permissionPreview` at `:203` is after the throw.
   - Impact: a chat whose tab has a real title does not get Allow / Always allow / Deny / Deny with message for a new SDK permission, and a question with text fails the same way. Untitled or default-titled tabs skip `:171` and can still preview. The new path and secret assertions (`chat-attention-source.service.spec.ts:138-163`) sit on the titled fixture, so they do not lock the helper until the name resolves.

## Checks

### a. Defect 1 helper

Covered above. Interpolation only: `attention-permission-actions.component.ts:11` is `{{ item().permissionPreview }}`. No `[innerHTML]` in that component.

Regex cost, from `:21-23` and `:26`:
- Assigned and flag secrets are one key, optional space, then a quoted run or `[^\s]+`. A missing closing quote fails that alternative in linear time and falls through to `[^\s]+`. No nested overlapping quantifiers.
- Token alternatives are single quantified classes (`sk-`, `AKIA`, `ghp_`, `xoxb-`, hex `{32,}`, token `{40,}` with `={0,2}`). Failure backtracks one class, then tries the next alternative. That is linear in the input length.
- Control-character and whitespace replaces are single classes.

`String.prototype.replace` resets `lastIndex` on a global regexp, so the module-level `/gi` patterns do not skip later calls.

### b. Defect 2

Fixed at the component lines in old defect 2. The field id stays `permission-reason-` plus `item().key` (`:31-32`).

### c. Regressions in the two files

- No `any` and no cast in `permissionPreview`, `safePreview`, or `AttentionPermissionActionsComponent`.
- No `text-base-content/NN` class. The template uses `text-base-content-muted` and `text-error` (`attention-permission-actions.component.ts:11` and `:38`).
- Blank deny sets `reasonError` before returning (`:74-76`). That is the visible error, not a swallowed failure.
- The new failure is the unbound `isUnsafeAttentionContext` (new defect 1). `attentionContext` at `:182` is still imported.

### d. Specs

- Service specs assert exact preview strings for `src/main.ts`, `C:\repo\src\main.ts` → `.../src/main.ts`, `rm -rf /tmp/foo`, `password=***`, `--token ***`, and `sk-` → `***` (`chat-attention-source.service.spec.ts:138-163`). They would throw in `add` first (new defect 1). They do not assert truncation ellipsis, a quoted secret, or `--api-key value`.
- Component specs click Deny with message, read `activeElement`, reject `'   '`, check `aria-invalid` and the described error text, emit `'Please revise'` from `'  Please revise  '`, and remove the form on Escape (`attention-permission-actions.component.spec.ts:15-68`). Escape is dispatched on the form, which is the listener target. They do not also assert that Escape left `selected` uncalled. The handler does not emit (`attention-permission-actions.component.ts:82-86`).

## Five logic questions

1. **Silent failure.** `reconcile` throws on a titled tab (`chat-attention-source.service.ts:171`) before `upsert` (`:129`). The bell, snackbar, and rail keep the previous attention set and do not show the new permission. A blank denial does not emit and does show the inline error (`attention-permission-actions.component.ts:74-76`).
2. **Unexpected user action.** Approving a permission on a named chat tab. The row this round is supposed to update never arrives. Opening Deny with message on a row that was published earlier (default title) still focuses the field and rejects whitespace.
3. **Wrong answer from input.** Once `add` can finish, `src/main.ts` and `rm -rf /tmp/foo` stay visible (`:36-39`), and `password=hunter2` becomes `password=***` (`:21-28`). A titled tab never gets that string because construction throws first. Residual, not filed: `safePreview` (`:26`) does not strip bidi format characters, so a command can still display in a different order than it runs.
4. **Dependency failure.** `isUnsafeAttentionContext` is missing, which is the dependency failure for this round. `toolInput` is a `Record` (`permission.types.ts:38`), so `:34` does not throw on a missing object. `description` is a required string (`permission.types.ts:64`), so `:47` does not throw on `undefined`. If `focus()` runs before the view child exists, `:58` optional-chains and the effect has already read `reasonField()`, so a later view-child update can focus. No new `catch` was added around dispatch.
5. **Unspecified remainder.** A 40-character alphanumeric run is replaced by `***` (`:23`), including a long file name with no dot. That is the token shape this round was asked to cover. The outer `slice(0, 160)` (`:49`) does not add its own ellipsis; card-shaped command and description lengths stay under that cap.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the missing binding, because the import line, both call sites, the reconcile order, and the spec tab title were read. HIGH for the preview rules and the deny-message branches, because those functions were read in full. MEDIUM for focus timing inside Angular's effect flush, which was not executed.
- Top risk: a named session throws inside `add`, and the new permission never becomes an attention card.
- What a robust implementation would add: import `isUnsafeAttentionContext` again so title and question filtering stay, and leave tool-input preview on `permissionPreview` only.
