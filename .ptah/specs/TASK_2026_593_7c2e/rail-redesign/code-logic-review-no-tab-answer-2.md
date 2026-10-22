# Code Logic Review — `TASK_2026_593_7c2e` (no-tab permission answer, round 2)

Review family: grok (implementer: codex)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | REVISE |
| Blocking issues | 0 |
| Major issues | 1 |
| Minor issues | 2 |

Verdict: **REVISE**. Score **7/10**.

The four card decisions now post through `PermissionHandlerService.handlePermissionResponse` with the same `id`, `decision`, and `reason` field the badge card emitted. A second or withdrawn answer is refused before another post. A closed tab whose workspace was seen while the tab existed stays on that workspace's canvas rail. The new preview then erases ordinary file paths and any command that contains a path, and Allow stays enabled, so the common tool body is still not visible.

What separates 7 from 8: one major gap on the preview this revision added. File and path-bearing command text becomes `Input: [sensitive input]` while the answer buttons stay enabled. What separates 7 from 6: the payload, the stale guard, the rail filter, and the lane reason order are implemented and traced to `file:line`. This is not a wrong-foundation pass.

Tests and builds were not run (review rule). `ptah_*` tools are not connected (`search_tool` for `ptah_agent_report` and `ptah_code_search_symbols` returned no tools). Evidence is `git diff`, `git status --short`, reads of the answer path, `git` HEAD was not required for the card because the card file is still in the tree, and a one-line Node check of `UNSAFE_CONTEXT` against sample previews. No source file was edited.

## Decisions

- Treat path erasure as a defect, not as acceptable sanitization. Options were to accept `isUnsafeAttentionContext` on the preview because it hides filesystem strings, or to require the compact path and command the card showed, with token redaction only. The user required full card parity including a tool-input preview. `permission-request-card.component.ts:345-366` shows the shortened path and the 40-character command. The unsafe regex was built for short attention context lines (`attention-context.util.ts:1-3`), and a Node check shows it matches `.../src/app.ts`, `src/main.ts`, `C:/repo/file.ts`, and `rm -rf /tmp/foo`. Reversible by not running that regex over the whole preview.
- Do not reopen empty deny-with-message as a missing default string. The old popover substitutes `User denied without explanation` (`deny-message-popover.component.ts:131-133`). This revision refuses an empty reason. The re-review asks for a typed reason and for empty handling. Refusal is that handling. Whitespace that passes `required` and then does nothing, and the missing focus, are still filed below.

## Old defects

1. **Fixed** for the four controls and the posted shape. Session permissions expose Allow, Always allow, Deny, and Deny with message with no tab (`chat-attention-source.service.ts:183-186`). Bell, snackbar, and rail render them (`notification-center.component.ts:55-56`, `notification-snackbar.component.ts:51-52`, `canvas-rail.component.ts:200-201`). The posted object is `{ id, decision, reason }` (`agent-permission-responder.ts:67-69`) through `SDK_PERMISSION_RESPONSE` (`permission-handler.service.ts:431-436`). The card emitted the same three fields and no rule fields (`permission-request-card.component.ts:387-399` and `:430-434`). `PermissionResponse` has optional `modifiedInput` and `reason` only (`permission.types.ts:89-101`); neither path sets `modifiedInput`. `always_allow` still asks the host to build the rule from the pending request id. Residual preview content is new defect 1, not a missing action.
2. **Fixed** for a tab that was open long enough to be observed. `chat-attention-source.service.ts:149-150` stores `sessionId` to `owner.workspacePath`. After the owner disappears, `workspacePath` stays that path and `tabId` is unset (`:192`). `canvas-rail.component.ts:352-353` keeps a tabless permission when `item.workspacePath === this.workspacePath()`, without a tile. `&&` binds the workspace check outside the `||`, so a different workspace does not match. A session whose workspace was never stored still has `workspacePath: ''` and stays off a canvas whose path is non-empty. That remainder is the case the fix note already states.
3. **Fixed.** A lane with no tab gets `Session unavailable` before the empty-tool check (`chat-attention-source.service.ts:183`). A lane with a tab and no tool name still gets `Unknown tool`. Spec at `chat-attention-source.service.spec.ts:125-135`.
4. **Fixed.** `permission-handler.service.spec.ts:508-517` again expects `unmatchedPermissions()` to contain the request after the only target tab closes, and still expects `permissionRequests()` to contain it.

## New defects

1. **Major.** The permission preview hides the file or command the user must judge, and Allow stays enabled.
   - `chat-attention-source.service.ts:24-27` copies a command (40 characters), a shortened `file_path`, or a pattern (30 characters).
   - `:35-42` runs that whole string through `isUnsafeAttentionContext` and, on a match, replaces it with `[sensitive input]`.
   - `attention-context.util.ts:1-3` treats Windows paths, absolute paths, and relative paths with an extension as unsafe. Checked with the same expression: `.../src/app.ts`, `src/main.ts`, `C:/repo/file.ts`, and `rm -rf /tmp/foo` match; `echo approved` and `README.md` do not.
   - `:183-186` still adds Allow and Always allow with no `disabledReason` for `kind === 'permission'`.
   - The command branch never applies the key redaction at `:29-30`. `password=<redacted>` does not match the regex, so that command is shown in the bell, snackbar, and rail. Known token shapes such as `sk-` are replaced (`chat-attention-source.service.spec.ts:138-143`), which only covers that shape.
   - The card showed the shortened path and the command (`permission-request-card.component.ts:345-366`). No spec asserts a file path survives.
   - Impact: Write, Read, and Edit, and any shell command that mentions a path, render `Input: [sensitive input]` (or the same for the description when it also contains a path). The click still posts `allow` or `always_allow`. The row looks answered. A short secret in a command that is not a known token is displayed. The preview is not written to the logger (`chat-attention-action-dispatcher.service.ts:125` logs `error.name` only).

2. **Minor.** Deny with message does not focus the field, and a whitespace-only reason fails with no message.
   - `attention-permission-actions.component.ts:29-33` expands the field. Nothing calls `focus()`. The old popover focused the input on open (`deny-message-popover.component.ts:114-117`).
   - `:32` sets `required` and `maxlength="1000"`. An empty string does not submit, which is the empty handling. Spaces satisfy `required`. `:52-54` then `preventDefault()` and return. No status is set and `selected` does not emit.
   - If a caller reaches the dispatcher with a blank reason, `:86` returns `unavailable('Enter a reason')`, which only sets the status-bar string (`:119-121`). `dispatchOutcome` turns every `false` into `{ kind: 'unavailable', reason: 'Could not complete action' }` (`:43-45`). The bell and snackbar show that generic line (`notification-center.store.ts:103-106`, `notification-snackbar.component.ts:219-221`). `chat-attention-action-dispatcher.service.spec.ts:76-82` locks the generic outcome.
   - Enter on a non-empty value submits the form (`:30`, `:52-55`). Escape collapses it (`:30`, `:58-60`). The visible label is `Reason for denial` bound with `for` (`:31-32`). The component spec covers the label, a typed submit, and Escape (`attention-permission-actions.component.spec.ts:15-42`). It does not cover focus or whitespace.

## Checks

### 1. Old defects 1-4

See the section above. 1, 2, 3, and 4 are fixed at the cited lines. Defect 1's tool body is only fixed for text that does not match `UNSAFE_CONTEXT`.

### 2. Payload equality

| Choice | Object passed to `handlePermissionResponse` | Same as the card |
| --- | --- | --- |
| Allow | `{ id, decision: 'allow', reason: undefined }` | Yes. Card `:395-399` passes `reason` undefined. `postMessage` structured clone drops `undefined`, so the host body is `{ id, decision }`. |
| Always allow | `{ id, decision: 'always_allow', reason: undefined }` | Yes. No `modifiedInput` and no rule object on either path (`permission.types.ts:96-100`). |
| Deny | `{ id, decision: 'deny', reason: undefined }` | Yes. Hard-deny bookkeeping stays inside the handler (`permission-handler.service.ts:437-454`) and still runs because both paths call it. |
| Deny with message | `{ id, decision: 'deny_with_message', reason: '<trimmed text>' }` | Yes for a typed reason. Field name is `reason`. |

`chat.store.ts:482-483` still forwards the card event with no tab. The no-tab attention path passes `tabId` undefined (`chat-attention-action-dispatcher.service.ts:87-89`, `agent-permission-responder.ts:63-69`). The handler then uses the active tab as `decidingTabId` (`permission-handler.service.ts:458`), which is what the badge did by omitting the argument. Specs: `agent-permission-responder.spec.ts:90-103`, dispatcher spec `:71-79`.

### 3. Stale refusal, double send, reason field

`dispatchOutcome` returns `stale` for `allow`, `always_allow`, `deny`, and `deny_with_message` when `isSessionPending` is false, and does not call `dispatch` (`chat-attention-action-dispatcher.service.ts:38-41`). `respondSession` checks again and returns false before the handler (`agent-permission-responder.ts:66`). The handler returns false before `postMessage` when the id is gone (`permission-handler.service.ts:432`). Specs at dispatcher `:85-94` and responder `:106-109`.

The permission branch has no `await` before `respondSession` (`chat-attention-action-dispatcher.service.ts:80-89`). `inFlight` is added and removed in that same synchronous stretch (`:56-93`). The handler posts and then removes the id (`permission-handler.service.ts:433-457`). A second click starts only after that removal, so it takes the stale return and does not post again. Two `dispatchOutcome` calls stacked in one turn: the first runs `dispatch` to completion before the first `await` yields, so the second sees an empty queue. Lane `always_allow` and `deny_with_message` are refused at `:82-84` and are not offered for lanes (`chat-attention-source.service.ts:183-186`).

Reason field: see new defect 2.

### 4. Untrusted HTML, truncation, secrets

`attention-permission-actions.component.ts:11` interpolates `permissionPreview`. There is no `[innerHTML]` in that component. No `text-base-content/NN` class was added on the changed templates or the new component; they use `text-base-content` and `text-base-content-muted`. Truncation is 40, 30, and 160 characters (`chat-attention-source.service.ts:24-42`). Sanitization is control-character stripping plus the unsafe-context regex, and key-name redaction only on the fallback branch (`:29-30`). That is new defect 1. Failure logs do not include the preview or the reason (`chat-attention-action-dispatcher.service.ts:125`).

### 5. Regressions

- No `any` and no cast on the production answer path. `isPermissionDecision` narrows `actionId` (`chat-attention-action-dispatcher.service.ts:9-11`, `:80`).
- Session Allow is enabled when `toolName` is empty (`chat-attention-source.service.ts:183`, spec `:119-122`). The card never disabled Allow (`permission-request-card.component.ts:106-114`). That matches the requested parity. Lanes still disable Allow when the tab is gone or the tool name is empty.
- Show in canvas stays disabled when nothing can open (`chat-attention-source.service.ts:187-188`). The shared component disables that button (`attention-permission-actions.component.ts:17`).
- Rail rows from another workspace: excluded by `item.workspacePath === this.workspacePath()` (`canvas-rail.component.ts:352-353`). The remembered path is the owner's path, not the active workspace (`chat-attention-source.service.ts:149-150`). `labelPath` can fall back to the active workspace for the display name only when an owner exists (`:151`); the filter uses `workspacePath`.
- Swallowed outcome text: new defect 2. The snackbar `catch` that sets `Action unavailable` (`notification-snackbar.component.ts:227-228`) is the existing catch around dispatch; this change does not add an empty catch on the post itself.
- No `text-base-content/NN` classes in the changed files.

### 6. Specs

These assert behavior rather than an identity tautology:

- Closed-tab workspace, four action ids, enabled Allow and Deny, disabled Open, lane reason order, and `sk-` redaction (`chat-attention-source.service.spec.ts:102-143`).
- Four decisions reach `respondSession` or are refused when pending is false, including typed feedback (`chat-attention-action-dispatcher.service.spec.ts:71-94`). The pending flag is mocked, so this does not prove the handler queue. The handler guard is unchanged and still covered for a missing id.
- Payload object for all four decisions (`agent-permission-responder.spec.ts:90-103`). The handler is a mock.
- Tabless rail row without a tile, same workspace (`canvas-rail.component.spec.ts:84-98`). No assertion that a different `workspacePath` is hidden.
- Preview text, label, form submit, Escape (`attention-permission-actions.component.spec.ts:15-42`).
- `unmatchedPermissions()` after pop-out (`permission-handler.service.spec.ts:508-517`).

Not covered: a file path or a path-containing command surviving the preview, focus, whitespace-only submit, and a second `handlePermissionResponse` after a successful `always_allow`. Specs were not executed.

## Five logic questions

1. **Silent failure.** Allow posts after the preview has been replaced with `[sensitive input]` (new defect 1). The host receives `allow`. Whitespace-only Deny with message returns without a message (new defect 2). A refused second answer does not post.
2. **Unexpected user action.** Approving Write or Read from the bell, snackbar, or rail. Expanding Deny with message and pressing Enter on spaces. The field is not focused, so keyboard users land elsewhere.
3. **Wrong answer from input.** `toolInput.file_path` of `src/main.ts`, or `command` of `rm -rf /tmp/foo`, becomes `[sensitive input]` while Allow stays enabled. `command` of `password=<redacted>` is shown. An empty `toolName` on a session permission still enables Allow, matching the card.
4. **Dependency failure.** If `postMessage` throws, the handler has not removed the id yet (`permission-handler.service.ts:433-457`). `dispatch` catches it, logs the error name, and upserts "Could not complete action" (`chat-attention-action-dispatcher.service.ts:90-91`, `:124-134`). A later click can send once. If the id is already gone, nothing is posted (`:38-41`, responder `:66`, handler `:432`).
5. **Unspecified remainder.** A session that never had a visible tab is still absent from the rail because no workspace was stored. The badge expiry countdown is still gone. `modifiedInput` remains unused, as it was on the card's emit.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for payload shape, stale refusal, and rail workspace equality. HIGH for the path regex, because the expression in `attention-context.util.ts:1` was executed against the shortened path samples. MEDIUM for focus behavior, which is inferred from the template having no focus call.
- Top risk: Allow or Always allow on a file or path-bearing command from a row that only says `[sensitive input]`.
- What a robust implementation would add: show the same shortened path and command the card showed, redact token shapes inside that text instead of discarding the whole line, focus the reason field when it opens, and surface a reason when the trimmed feedback is empty.
