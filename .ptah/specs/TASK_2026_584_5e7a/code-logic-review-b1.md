VERDICT: APPROVED
Score: 9/10

# Code Logic Review — `TASK_2026_584_5e7a` (Batch 1: agent-sdk Unattended Permission Policy + Metadata CWD)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor issues        | 0        |
| Failure modes found | 0        |

Evidence separating 9/10 from adjacent bands:

- Separating from 7-8 ("sound"): zero logic or design defects found across all 13 reviewed files; full test suite (71 new/updated unattended tests + 70 session metadata store tests) passes cleanly; strict adherence to all metacharacter, token-boundary, and path containment invariants with zero leaked abstractions.
- Separating from 10/10 ("flawless perfection"): slight residual coupling in `handleResponse` where answering "Always Allow" on a child prompt creates a global rule for interactive sessions (ruled compliant with the plan, but an implicit UX nuance worthy of note).

---

## Numbered Defects

None.

---

## ## Always Allow ruling

### Ruling: NO DEFECT (Compliant with Approved Plan)

**Question**: When the user answers a child session's bounded permission prompt with "Always Allow", `SdkPermissionHandler.handleResponse` creates a global permission rule in `this.ruleStore`. Children never consult rules (`"Always Allow" rules are not consulted for policy sessions`), but the parent and other interactive sessions would then auto-allow that tool. Does this contradict the plan's intent (plan lines 222-223, R2 lines 1113-1115)?

**Detailed Analysis and Ruling**:

1. **Plan Invariant Scoping**:
   - Plan lines 222-223 state: `""Always Allow" rules are not consulted for policy sessions. Deny text names the allowlist and tells the model to report the blocker to the parent."`
   - Plan lines 1113-1115 (Risk R2) state: `"- R2 (narrows auto-edit, by design): edits outside the worktree are not auto-approved; AskUserQuestion and EnterPlanMode are denied at once; global "Always Allow" rules are ignored for children."`
   - Notice the exact phrasing in both normative sections: rules are not consulted **for policy sessions** and are ignored **for children**. The constraint was specifically designed to ensure that unattended child sessions cannot inherit ambient permissions or bypass their strict sandbox.
2. **Child Isolation Maintained**:
   - In `SdkPermissionHandler.createCallback` (`sdk-permission-handler.ts:483-495`), the callback checks `this.unattendedPolicies?.get(routingHint ?? tabId)` at the very top. If an unattended policy is present, it executes `this.decideUnattendedToolCall(...)` and returns immediately. It **never reaches** `this.ruleStore.getRule(...)` (`sdk-permission-handler.ts:517-535`).
   - Consequently, even if an "Always Allow" rule exists globally, child sessions continue to evaluate tool calls strictly against their unattended policy table (and prompt only with a bounded window).
3. **Sibling Auto-Resolve Protection**:
   - In `SdkPermissionHandler.handleResponse` (`sdk-permission-handler.ts:1130`), the executor explicitly added:
     ```typescript
     // Unattended sessions never consult "Always Allow" rules.
     if (this.unattendedRequestIds.has(pendingId)) continue;
     ```
     This prevents creating an "Always Allow" rule from auto-resolving concurrent in-flight prompts belonging to unattended sessions.
4. **Interactive User Intent**:
   - When a tool call escapes the policy table, a prompt is rendered in the child's tab in the UI. If a human user at the keyboard explicitly clicks "Always Allow", that is a deliberate user decision to trust that tool. Honoring that choice for interactive sessions (such as the parent chat) is consistent with Ptah's global permission architecture.
5. **Conclusion**:
   - The implementation satisfies both the letter and intent of Revision 1 and R2. No defect is recorded.

---

## Five Logic Questions

### 1. How does this fail silently — where does a failure produce a success-looking result?

- **Analysis**:
  - `evaluateUnattendedBash` (`unattended-bash-policy.ts:63-105`): Wraps evaluation in `try { ... } catch`. Any exception returns `{ allowed: false, reason: ... }`. Blank or non-string commands return `{ allowed: false }`. No failure path returns `{ allowed: true }`.
  - `checkUnattendedWriteTarget` (`sdk-permission-handler.ts:214-248`): Any exception, missing argument, empty string, or non-contained path returns `{ inside: false }`. It never defaults to `{ inside: true }`.
  - Bounded prompt denial (`sdk-permission-handler.ts:197-207`): When a prompt times out, is rejected, or webview delivery fails, `interrupt` is explicitly set to `false` and an actionable deny message is returned to the model explaining the failure and instructing it to use `ptah_agent_report`. It never silently hangs or masquerades as success.

### 2. What user action produces unexpected behaviour?

- **Analysis**:
  - If a user closes the child tab while a bounded prompt is waiting, `webviewManager.sendMessage` or signal abort terminates the wait cleanly without hanging background execution.
  - If a user triggers a command with chaining operators (e.g. `;`, `&&`, `|`), the bash matcher explicitly identifies the operator and refuses execution with a clear explanation (`the command contains ... which can chain or redirect commands`).

### 3. What input data produces a wrong answer rather than an error?

- **Analysis**:
  - Empty or whitespace command / allowlist: `evaluateUnattendedBash` filters empty tokens (`split(/\s+/).filter(...)`). Blank allowlist entries cannot match empty commands or act as wildcards (`unattended-bash-policy.ts:84`).
  - Path traversal attempts: `checkUnattendedWriteTarget` evaluates `path.relative(root, path.resolve(root, target))`. Targets attempting `..`, `../`, `..\`, or escaping via `/root-other` resolve outside `root` and are caught by `relative.length > 0 && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)`.
  - Negative or non-finite deny windows: `clampDenyWindow` in `unattended-session-policy.registry.ts:34-39` clamps `<= 0`, `NaN`, and `Infinity` to `0` (which triggers immediate denial without prompt).

### 4. What happens when a dependency fails, times out, or returns a shape it should not?

- **Analysis**:
  - **No webview / webview not delivered**: Handled at `sdk-permission-handler.ts:278-298`. If `sendMessage` resolves to `false`, the pending request is immediately resolved with `decision: 'deny'`, preventing an unbounded hang.
  - **Prompt timeout**: Timed out via `awaitResponse` timer (`Math.max(1, unattendedDenyWindowMs)`). When the timer expires, the promise resolves to timeout denial and returns the informative policy denial message.
  - **Missing policy registry in container**: Injected as an optional parameter (`{ isOptional: true }`). If omitted or unpopulated, `this.unattendedPolicies?.get(...)` evaluates to `undefined`, cleanly preserving original handler behavior without throwing.

### 5. What is missing that the requirements never mentioned?

- **Analysis**:
  - **Exclusion of unattended requests from sibling auto-resolve**: When "Always Allow" is chosen in standard sessions, pending requests for the same tool are auto-resolved. The plan did not explicitly specify what happens to pending unattended prompts when a parent prompt is auto-allowed; the executor correctly identified this gap and added `unattendedRequestIds` to prevent accidental auto-approval of child sessions.
  - **Windows drive-letter cross-containment**: `path.relative` on Windows returns an absolute path when comparing paths across different drive letters (e.g. `C:\` and `D:\`). The implementation defensively added `!path.isAbsolute(relative)` (`sdk-permission-handler.ts:234`), correctly preventing cross-drive traversal leaks.

---

## Failure Modes

None identified. All reviewed execution paths fail closed (deny / prompt, never allow).

---

## Blocking Issues

None.

---

## Serious Issues

None.

---

## Moderate and Minor Issues

None.

---

## Data Flow

1. **Child Policy Registration**:
   - `SessionSpawner` calls `UnattendedSessionPolicyRegistry.register(childTabId, policy)` [OK]
   - Registry clamps `denyWindowMs` (0..600,000 ms), freezes allowlist, and stores entry [OK]
   - Disposer returned; idempotent and safe against race conditions [OK]

2. **Tool Call Execution (Child Session)**:
   - Tool callback in `SdkPermissionHandler` checks `unattendedPolicies.get(routingHint ?? tabId)` [OK]
   - If no policy: proceeds to original interactive evaluation pipeline [OK]
   - If policy present: branches directly into `decideUnattendedToolCall` [OK]
   - `EnterPlanMode`: Immediate deny (`interrupt: false`), directs model to write plan file [OK]
   - `AskUserQuestion`: Immediate deny (`interrupt: false`), directs model to `ptah_agent_report` [OK]
   - `SAFE_TOOLS`, `Task`, `ExitPlanMode`, `mcp__ptah__*`: Immediate allow [OK]
   - `Write` / `Edit` / `NotebookEdit`: Checked against `writableRoot` via lexical containment; allowed if inside, else bounded prompt [OK]
   - `Bash`: Evaluated with `evaluateUnattendedBash`; allowed if token-prefix matches without disallowed characters, else bounded prompt [OK]
   - Unknown tools / foreign MCP / network: Escalated to bounded prompt [OK]

3. **Bounded Prompt Handling**:
   - If `denyWindowMs === 0`: Immediate deny without emitting UI message [OK]
   - If `denyWindowMs > 0`: Emits `PERMISSION_REQUEST` with `timeoutAt = startTime + denyWindowMs` and child's `tabId`/`sessionId` [OK]
   - If webview undelivered: Immediate deny fallback [OK]
   - If user allows: Tool allowed [OK]
   - If user denies / times out: Returns denial message with guidance to report blocker to parent [OK]
   - If aborted: Preserves session abort semantics [OK]

4. **Session Metadata Creation**:
   - `SdkAgentAdapter.startChatSession` computes `workspaceId = blankToUndefined(config.workspaceId) ?? resolvedProjectPath` and `workingDirectory = resolvedProjectPath` [OK]
   - Invokes `createSessionIdCallback(workspaceId, workingDirectory, ...)` [OK]
   - If `workingDirectory === workspaceId` (standard sessions): Calls `metadataStore.create(id, workspaceId, name)` [OK]
   - If `workingDirectory !== workspaceId` (child in worktree): Calls `metadataStore.create(id, workspaceId, name, 'created', workingDirectory)` [OK]
   - `SessionMetadataStore.create` records `workingDirectory` and indexes by `workspaceId` [OK]
   - `getForWorkspace('/parent/workspace')` lists the child session under the parent workspace [OK]

---

## Requirements Fulfilment

| Requirement                                                    | Status   | Gap                                                                                                   |
| -------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| Task 1.1: `evaluateUnattendedBash` pure matcher                | COMPLETE | None. All refused metacharacters, token boundaries, and case sensitivity verified.                    |
| Task 1.2: `UnattendedSessionPolicyRegistry` & DI order         | COMPLETE | None. Registered before `SDK_PERMISSION_HANDLER` in `di/register.ts`; stale disposer safety verified. |
| Task 1.3: `SdkPermissionHandler` early branch & bounded prompt | COMPLETE | None. Exact policy table implemented; `timeoutAt != 0`; undelivered deny verified.                    |
| Task 1.4: Metadata cwd & workspace identity at creation        | COMPLETE | None. Forwarding verified; backward compatibility for existing callers preserved.                     |

---

## Edge Cases

| Case                                                                         | Handled | How                                                            | Concern |
| ---------------------------------------------------------------------------- | ------- | -------------------------------------------------------------- | ------- |
| Bash command chaining (`\n`, `\r`, `;`, `&`, `\|`, `` ` ``, `$()`, `<`, `>`) | YES     | Disallowed sequences table checked before token matching       | None    |
| Bash token prefix matching (`git status` vs `git statusx`)                   | YES     | Whitespace tokenization + exact token equality                 | None    |
| Bash case sensitivity (`Git status`)                                         | YES     | Exact string equality on tokens                                | None    |
| Path traversal in file edits (`../`, `..\`)                                  | YES     | `path.resolve` + `path.relative` containment check             | None    |
| Path prefix collision (`/root` vs `/root-other`)                             | YES     | Relative path checking `!relative.startsWith('..' + path.sep)` | None    |
| Windows cross-drive path resolution                                          | YES     | `!path.isAbsolute(relative)` check                             | None    |
| Deny window clamping (negative, NaN, >600s)                                  | YES     | Clamped to 0..600,000 ms at registration                       | None    |
| Deny window 0                                                                | YES     | Bypasses prompt and denies immediately                         | None    |
| Missing webview delivery                                                     | YES     | Immediate denial via promise resolution                        | None    |
| Stale policy disposer execution                                              | YES     | Map identity check `entries.get(id) === entry`                 | None    |
| Existing metadata callers (3-arg `create`)                                   | YES     | Pass-through with exact argument count preserved               | None    |

---

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: None. The implementation is isolated, fails closed, and exhibits full test coverage.
- What a robust implementation would add:
  1. (Future consideration) If child tabs should never offer "Always Allow" in the webview, filter the action buttons in the frontend presentation layer or intercept it in `handleResponse`.
