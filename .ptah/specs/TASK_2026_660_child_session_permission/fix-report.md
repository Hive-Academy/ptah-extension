# TASK_2026_660 — fix report: child sessions ignore the parent's autopilot level

Worktree: `D:\projects\ptah-extension\.claude-worktrees\fix-child-session-permission`
(branch `fix/child-session-permission`). Paths below are relative to it.

## 1. Trace

What the autopilot UI writes (`config:autopilot-toggle`,
`libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:322-401`):

1. config `autopilot.enabled` and `autopilot.permissionLevel` (`:352-356`);
2. the global `SdkPermissionHandler` level, `enabled ? level : 'ask'` (`:357-360`);
3. the per-session level of the target session (`sdkAdapter.setSessionPermissionLevel`,
   `:370-380`), which sets `SessionRecord.permissionLevel`
   (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts:509`).
   A new session seeds that record from the global level when its query starts
   (`session-query-executor.service.ts:748-758`, `permissionLevel ?? global`), and
   `canUseTool` reads it live through `permissionLevelResolver`.

Child start path (`ptah_session_start`):

| Step | File:line | Level |
| --- | --- | --- |
| Spawner guard reads the parent's live record | `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:310` | read (`lifecycle.find(caller)?.permissionLevel`) |
| Spawner hands it to the host port | `session-spawner.service.ts:408` | passed |
| Port carries it | `session-children/child-chat-session-host.port.ts:30-31` | passed |
| Host adapter (fallback: parent tab record) | `libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts:57-71` | passed, via a conditional spread |
| `AgentChildSessionStartParams` | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:129-140` | **no field** — the conditional spread escapes TypeScript's excess-property check, so nothing failed to compile |
| `startAgentChildSession` → `launchSdkSession` | `chat-session.service.ts:618-619, 657` (`permissionLevel: 'auto-edit'`) | **dropped and replaced by a constant** |
| Query executor seeds the child's record | `session-query-executor.service.ts:748-757` | `auto-edit` for every child |

How the child's permission handler then decides
(`libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`):

- `:491-504` an unattended (child) session at `yolo` approves every call except
  `AskUserQuestion` / `EnterPlanMode` — this exemption already exists, so a `yolo` child
  never prompts;
- `:505-514` any other level goes to the unattended policy table (`:677-` ):
  writes inside the worktree, allowlisted Bash and Ptah MCP tools are allowed; every other
  call raises a bounded prompt in the child tab that is denied after
  `agentSessions.permissionDenyWindowMs`. That is the prompt the user saw: the child ran at
  `auto-edit`, not the parent's `yolo`.

Webview side: `AutopilotStateService`
(`libs/frontend/core/src/lib/services/autopilot-state.service.ts:61-92`) is a single
root-provided store (`enabled`, `permissionLevel`), not per tab. The chat input and the
autopilot popover read it globally; nothing in tab adoption (`agentSession:opened`) touches
it (grep for `autopilot|permissionLevel` in `libs/frontend` finds no tab-state file). A
newly adopted child tab therefore already shows the global autopilot level, which is the
level the parent runs at; no webview change is needed.

## 2. Root cause

`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:129-140` — the
parameter type has no `permissionLevel`, and `:657` hard-codes `permissionLevel:
'auto-edit'`. The spawner and the host adapter read and forwarded the parent's level
correctly; the last hop threw it away. The spec
`chat-session-agent-child.spec.ts:289-298` pinned the constant.

## 3. Changes

| File:line (after the change) | Change |
| --- | --- |
| `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:43` | import `parsePermissionLevel` from `../../handlers/config-rpc.schema` (the zod parser `config:autopilot-get` already uses) |
| `chat-session.service.ts:141-145` | `AgentChildSessionStartParams.permissionLevel?: PermissionLevel` — the field the adapter was already sending |
| `chat-session.service.ts:657-676` | the level is computed once, logged in the session-config line, and passed to `launchSdkSession` instead of the `'auto-edit'` constant |
| `chat-session.service.ts:695-726` | `childPermissionLevel(parentLevel)`: the parent's live level; absent → `savedAutopilotLevel()` (`autopilot.enabled ? parsePermissionLevel(autopilot.permissionLevel) : 'ask'`, i.e. the effective level `config:autopilot-toggle` persists); `plan` → `ask` |
| `chat-session.service.ts:608-616` | doc comment no longer says "it always starts at `auto-edit`" |

Unchanged on purpose: the spawner (`session-spawner.service.ts:310`) already reads the
parent's record at start time, the host adapter already forwards it, and
`SdkPermissionHandler` (`sdk-permission-handler.ts:491-504`) already lets a `yolo`
unattended session run without prompts. No webview change (section 1).

Level mapping parent → child: `yolo` → `yolo` (no prompts), `auto-edit` → `auto-edit`,
`ask` → `ask` (both under the unattended policy table), `plan` → `ask`.

Docs:

- `.claude/skills/agent-lanes/SKILL.md:277-282` §9 "Permissions" bullet, and its copy
  `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md`
  (copied; `cmp` reports them identical).
- `content-manifest.json` regenerated with `node scripts/generate-content-manifest.js`
  (`package.json` script `manifest:generate`): only `contentHash` and `generatedAt`
  changed; `--check` → "content-manifest.json is up to date (… 230 files)".
- `apps/ptah-docs/src/content/docs/agents/agent-sessions.md:74-83` "Permissions": the
  child starts at the parent's autopilot level read at start; YOLO → no prompts; other
  levels → the existing policy text; plan → Ask.

## 4. Specs and results

New / changed specs:

- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session-agent-child.spec.ts`
  - harness: `getWithDefault` answers `autopilot.*` keys from an `autopilot` option;
  - the identity test now passes `permissionLevel: 'yolo'` and expects `'yolo'` (it pinned
    `'auto-edit'` before);
  - `permission level (TASK_2026_660)`: full-autopilot parent → `yolo` even when the saved
    level is lower; `ask` and `auto-edit` parents → the same level (not a fixed default);
    `plan` parent → `ask`; no parent level → saved level (`yolo`); autopilot off → `ask`;
    unknown saved level → `ask`.
- `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.spec.ts`
  - harness: the parent record's level is mutable (`parentLevel`);
  - `passes the level the parent holds when each child starts`: first child at `yolo`,
    the level changes to `auto-edit`, the second child gets `auto-edit`.
  - formatted with Prettier (it was not Prettier-clean before; lint-staged would reformat it).
- "No prompt at full autopilot" for an unattended session is already pinned by
  `libs/backend/agent-sdk/src/lib/sdk-permission-handler.unattended.spec.ts:184-198`
  ("YOLO level — allows an out-of-policy call without a prompt"); unchanged.

Runs (worktree root; ts-jest diagnostics are on in both jest configs, so these also
type-check the specs and the files they import):

- `npx jest -c libs/backend/rpc-handlers/jest.config.ts …/chat-session-agent-child.spec.ts
  …/child-chat-session-host.adapter.spec.ts --coverage=false --maxWorkers=1` →
  `Test Suites: 2 passed, 2 total; Tests: 30 passed, 30 total`.
- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts
  …/session-spawner.service.spec.ts --coverage=false --maxWorkers=1` (after Prettier) →
  `Test Suites: 1 passed, 1 total; Tests: 71 passed, 71 total`.
- `npx eslint` on the three changed TS files → 0 errors, 1 warning: `max-lines` on
  `chat-session.service.ts` (1159 lines; the file was already over the 700 limit).
- `npx prettier --check` on all changed files → clean after formatting the spawner spec.
- `ptah_get_diagnostics` scoped to the changed files → unavailable (TypeScript check still
  running after 45 s, twice). Project `typecheck` / `lint` / `test` left to the orchestrator.

## 5. Changed files and Nx projects

| File | Nx project |
| --- | --- |
| `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` | `rpc-handlers` |
| `libs/backend/rpc-handlers/src/lib/chat/session/chat-session-agent-child.spec.ts` | `rpc-handlers` |
| `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.spec.ts` | `cli-agent-runtime` |
| `.claude/skills/agent-lanes/SKILL.md` | none (repo skill) |
| `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md` | `ptah-extension-vscode` (asset) |
| `content-manifest.json` | none (repo root) |
| `apps/ptah-docs/src/content/docs/agents/agent-sessions.md` | `ptah-docs` |

## Decisions

1. **Source of the level: the parent's session record first, the saved autopilot config
   second.** `config:autopilot-toggle` writes both the config/global level and the target
   session's `SessionRecord.permissionLevel`; the record is what the parent's own
   `canUseTool` reads, so it is the parent's *current* level, and the spawner reads it at
   the moment of `ptah_session_start`. The config fallback only applies when no parent
   record was found (the spawner refuses an inactive caller, so this is rare).
2. **`plan` → `ask` (not inherited).** Plan mode is a hard rule against unattended sessions,
   independent of autopilot: the policy denies `EnterPlanMode` with "Plan mode is unavailable
   to unattended agent sessions: nobody is watching this session to approve a plan"
   (`sdk-permission-handler.ts:689-695`). A child started in SDK `plan` mode could not do
   its task and nobody would approve its plan. `ask` is the strictest non-plan level; the
   docs say so.
3. **The unattended policy is kept.** Below YOLO, writes are still confined to the child's
   worktree, Bash to the allowlist, and an out-of-policy call still gets a bounded prompt
   that is denied after `agentSessions.permissionDenyWindowMs`
   (`sdk-permission-handler.ts:505-514, 677-`). It does not block the user's chosen level:
   at YOLO the handler already skips it (`:491-504`), and `ask` / `auto-edit` were never
   meant to auto-approve out-of-worktree or non-allowlisted actions. `AskUserQuestion` is
   still denied at YOLO (nobody can answer it).
4. **No webview change.** `AutopilotStateService` is one root-level store, not per tab, so
   an adopted child tab already shows the global autopilot level the parent runs at.

## Out-of-scope observations

- `config:autopilot-toggle` without a `sessionId` (the popover never sends one) applies the
  live level to `getActiveSessionIds()[0]`, the most recently active session. If that is not
  the parent (for example a child tab was the last one used), the parent's record keeps its
  old level while the UI shows the new one, and a child started afterwards inherits the
  parent's actual (old) level. Fixing that needs the popover to pass the active tab's
  session id (`libs/frontend/chat-ui/src/lib/molecules/chat-input/autopilot-popover.component.ts:231-250`).
- The handoff session from TASK_2026_655 B2 is not on `origin/main` in this worktree, so it
  is not covered here; if it starts through `startAgentChildSession` it inherits the fix,
  otherwise it needs the same `permissionLevel` pass-through.
- `chat-session.service.ts` is 1159 lines against a 700-line `max-lines` limit
  (pre-existing).
