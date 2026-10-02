VERDICT: APPROVED

Score: 10/10
Defect counts:

- Blocking: 0
- Serious: 0
- Moderate: 0
- Minor: 0

---

## Executive Summary

Batch 8 provides documentation and skill updates for agent sessions (`TASK_2026_584`, Tasks 8.1 and 8.2).
The review evaluated:

1. `.claude/skills/agent-lanes/SKILL.md` (Section 9 "Agent sessions (`ptah_session_*`)")
2. `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md` (verified byte-identical)
3. `apps/ptah-docs/src/content/docs/agents/agent-sessions.md` (new documentation page)

Every factual claim regarding tool names, arguments, boundaries, defaults, runtime lifecycle states, refusal codes, settings, permission policies, completion push envelopes, and reporting mechanisms was traced directly to the committed code across `vscode-lm-tools`, `cli-agent-runtime`, and `agent-sdk`.
The docs build (`npx nx run ptah-docs:build`) succeeded with 0 errors and generated the output page `dist/apps/ptah-docs/agents/agent-sessions/index.html`.

---

## Byte-Identity Check: Skill Copies

- **Requirement**: `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md` must be byte-identical to `.claude/skills/agent-lanes/SKILL.md`.
- **Evidence**:
  - `git diff --no-index .claude/skills/agent-lanes/SKILL.md apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md`: returned 0 differences.
  - SHA256 Hash Comparison:
    - `.claude/skills/agent-lanes/SKILL.md`: `46006945C23E270ED06403914B100F49775B78D15A51978E146F118E62AFD32E`
    - `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md`: `46006945C23E270ED06403914B100F49775B78D15A51978E146F118E62AFD32E`
  - Result: 100% byte-identical.

---

## Factual Claims & Code Traceability

### 1. Tool Names and Argument Schemas

- **Claims**:
  - 5 tools: `ptah_session_start`, `ptah_session_send`, `ptah_session_status`, `ptah_session_read`, `ptah_session_stop`.
  - `ptah_session_start`: required `task` (up to 100 KiB) and `branch` (up to 200 chars); optional `baseRef`, `label` (up to 60 chars), `taskId` (`TASK_YYYY_NNN` format), `taskFolder` (relative without `..`), `deliverables` (up to 20 paths), `model`. Rejects extra arguments (strict).
  - `ptah_session_send`: required `sessionId`, `message` (up to 100 KiB); optional `mode` (`queue` [default], `steer`, `if-idle`).
  - `ptah_session_status`: optional `sessionId`.
  - `ptah_session_read`: required `sessionId`; optional `tailKiB` (1 to 256, default 32).
  - `ptah_session_stop`: required `sessionId`.
- **Evidence**:
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.ts:25-37`: `SESSION_TOOL_NAMES` defines the 5 tool names.
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-args.schema.ts:18-75`:
    - `MAX_SESSION_DELIVERABLES = 20` (line 19).
    - `SESSION_TASK_ID_PATTERN = /^TASK_\d{4}_\d{3}(_[0-9a-f]{4})?$/` (line 22).
    - `isRelativeWithoutParent` checks relative without `..` (lines 25-28).
    - `SessionStartArgsSchema`: `task` max `MAX_AGENT_MESSAGE_LENGTH` (100 * 1024), `branch` max 200, `baseRef` max 200, `label` max 60, `taskFolder` max 500 refined, `deliverables` max 20, `.strict()`.
    - `SessionSendArgsSchema`: `sessionId` (1..200), `message` max `MAX_AGENT_MESSAGE_LENGTH`, `mode` enum `['queue', 'steer', 'if-idle']`, `.strict()`.
    - `SessionStatusArgsSchema`: `sessionId` optional, `.strict()`.
    - `SessionReadArgsSchema`: `tailKiB` min 1, max `SESSION_READ_MAX_TAIL_KIB` (256), `.strict()`.
    - `SessionStopArgsSchema`: `sessionId`, `.strict()`.
  - All claims in `SKILL.md:231-237` and `agent-sessions.md:18-66` match exactly.

### 2. Status Values and Refusal Codes

- **Claims**:
  - `ptah_session_status` child statuses: `starting`, `working`, `awaiting-permission`, `waiting`, `idle`, `failed`, `stopped`, `timed-out`, `ended`.
  - Start refusal codes: `unattributed-caller`, `depth-exceeded`, `cap-reached`, `mcp-unavailable`, `chat-runtime-unavailable`, `no-workspace`, `invalid-arguments`, `branch-exists`, `worktree-failed`, `worktree-outside-workspace`, `session-start-failed`.
  - Fault start refusals (`session-start-failed`, `worktree-failed`) produce `isError: true` with rollback table.
- **Evidence**:
  - `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.port.ts:20-29`: `SessionChildStatus` is the union of those exact 9 status literals.
  - `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.port.ts:109-120`: `SessionSpawnRefusalCode` is the union of those exact 11 refusal codes.
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.ts:57-61, 147-158, 185-191`: `START_FAULTS` (`session-start-failed`, `worktree-failed`) format the Markdown rollback table and return `isError: true`.
  - All claims in `SKILL.md:253-255` and `agent-sessions.md:53, 101` match exactly.

### 3. Four Settings Keys, Types, Ranges, and Fallbacks

- **Claims**:
  - All four keys under `ptah.agentSessions.`:
    - `ptah.agentSessions.maxConcurrent`: default 3, range 1 to 5.
    - `ptah.agentSessions.maxRuntimeMinutes`: default 120, range 5 to 720.
    - `ptah.agentSessions.permissionDenyWindowMs`: default 60000, range 0 to 600000.
    - `ptah.agentSessions.bashAllowlist`: default list of 14 commands; non-string entry triggers fallback to default; trimmed, blanks dropped; explicit `[]` requires approval for all Bash commands.
- **Evidence**:
  - `libs/backend/cli-agent-runtime/src/lib/session-children/session-child-settings.ts`:
    - `SESSION_CHILD_SETTINGS_SECTION = 'ptah'` (line 14).
    - `SESSION_CHILD_MAX_CONCURRENT`: key `'agentSessions.maxConcurrent'`, fallback 3, min 1, max 5 (lines 34-39).
    - `SESSION_CHILD_MAX_RUNTIME_MINUTES`: key `'agentSessions.maxRuntimeMinutes'`, fallback 120, min 5, max 720 (lines 41-46).
    - `SESSION_CHILD_PERMISSION_DENY_WINDOW_MS`: key `'agentSessions.permissionDenyWindowMs'`, fallback 60000, min 0, max 600000 (lines 48-53).
    - `SESSION_CHILD_BASH_ALLOWLIST_KEY = 'agentSessions.bashAllowlist'` (line 55).
    - `DEFAULT_SESSION_CHILD_BASH_ALLOWLIST`: contains `['git status', 'git diff', 'git log', 'git show', 'git add', 'git commit', 'git rev-parse', 'git ls-files', 'git branch --show-current', 'npx nx', 'npm test', 'npm run', 'ls', 'pwd']` (lines 58-74).
    - `readAllowlist`: checks `value.every((entry): entry is string => ...)`, falls back to default if not, trims and filters out empty strings, honours explicit `[]` (lines 110-130).
  - All claims in `agent-sessions.md:82-97` match exactly.

### 4. Completion Signals, Delivery Envelopes & Held Completions

- **Claims**:
  - Turn completion push format: `<agent-lane-completed ... cli="ptah-session" ...>`.
  - Verdicts: `delivered`, `no-deliverable`, `unverified`, `failed`.
  - Deliverable check requires `writtenAfterSpawn !== false` (mtime >= `startedAt`).
  - Held completions: completions produced while parent is not live are held and returned at the end of every `ptah_session_*` result under `"Held while this session was not live:"`.
  - Parents are instructed to call `ptah_session_status` after resume (R12).
- **Evidence**:
  - `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:130-143`: `sessionChildVerdictOf` implements `delivered`, `no-deliverable`, `unverified`, `failed` requiring `check.writtenAfterSpawn !== false`.
  - `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:199-234`: `buildSessionChildCompletionEnvelope` renders `<agent-lane-completed ... cli="ptah-session" ...>`.
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.ts:55, 84-91, 417-427`: `HELD_COMPLETIONS_HEADING = 'Held while this session was not live:'`, appended to all replies.
  - All claims in `SKILL.md:240-248` and `agent-sessions.md:70-73` match exactly.

### 5. Child `ptah_agent_report` Routing & Parent Inactive Behavior

- **Claims**:
  - `ptah_agent_report` works from a child session (identified by `/session/{id}`).
  - Delivered into parent as `<agent-report ... cli="ptah-session">`.
  - If parent is not live, report is refused (`parent-session-not-active`), counted on the child's status record (`reportsRefused`), not queued; child is told to repeat content in its final turn message.
- **Evidence**:
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1223-1240`: maps `getCallerSessionId()` to `{ childSessionId, message, summary }`.
  - `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts:464-474`: when parent is not active, calls `markReportRefused` and returns `{ delivered: false, reason: 'parent-session-not-active' }`.
  - `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts:492-500`: renders `<agent-report ... cli="ptah-session">`.
  - `libs/backend/cli-agent-runtime/src/lib/session-children/session-child-contract.ts:40-43`: prompt explicitly instructs child: `"If a report is refused because the parent is not live, repeat its content in your final message of the turn..."`.
  - All claims in `SKILL.md:260-262` and `agent-sessions.md:71` match exactly.

### 6. Advisory Tracking: Follow-up F3

- **Batch 8 Note**: Follow-up F3 notes that the `ptah_agent_report` tool description in `tool-description.builder.ts:850-866` does not explicitly name child sessions (mentioning only `spawned` and `agent`). As prescribed in `batches.md` Task 8.1, this is an advisory observation regarding code frozen in Batch 6 and was not edited. SKILL.md Section 9 and `agent-sessions.md` properly document the child session report behavior.

---

## Docs Build Verification

- **Command**: `npx nx run ptah-docs:build`
- **Result**:
  - Screenshot reference check: 32 references verified and resolved.
  - Starlight / Astro build: 157 static pages built cleanly in 35.31s.
  - Search index: Pagefind indexed 159 HTML files without error.
  - Output artifact verified on disk: `dist/apps/ptah-docs/agents/agent-sessions/index.html` (exists: `True`).
  - Exit code: 0.

---

## Review Conclusion

All deliverables of Batch 8 are accurate, verified against code, and fully conform to all task requirements.
Verdict: **APPROVED**.
