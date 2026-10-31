# Investigation: disabled `ptah-core` skills

## Scope and result

Read-only investigation. Final disk observation: `2026-10-29T22:00:08Z`.

Only this requested report was written. No source, settings, or application state was changed. No application, build, test, or verification command was run. No worktree, commit, push, or pull request was created.

**Primary cause: the Plugins settings saved the main checkout's configuration. The affected session resolves capability policy for its separate worktree.** That worktree has no configuration that enables the opt-in `ptah-core` plugin.

**A new SDK session with the same worktree path would still disable `session-handoff` under the inspected state.** This is a policy calculation, not a live-session test. No new session was started for this investigation.

**No Ubuntu-specific cause was found.** The root mismatch follows application rules that also apply on other operating systems.

## Ranked causes

### 1. Confirmed: settings and session use different roots

The Plugins panel sends `plugins:save-config` without a session ID or workspace path. The backend selects the host's active workspace root.

Evidence:

- Panel save payload: `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.ts:865-887`.
- Host root selection: `libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts:82-87`.
- Plugin handler root selection: `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:1137-1168`.
- Save uses captured `configRoot`: `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:452-459`.
- Session policy instead uses `sessionConfig.projectPath`: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:1402-1407,1640-1655`.

The saved main-root record has `lastUpdated: 2026-10-29T20:54:30.362Z`. No corresponding worktree record exists. The worktree has its own `.ptah` directory, so root resolution stops there.

### 2. Confirmed: no worktree inheritance enables the opt-in plugin

`ptah-core` is bundled. Bundled plugins default to off. Only `harness` and `skillssh` sources default to on.

Evidence:

- Source rule: `libs/shared/src/lib/types/rpc/rpc-misc.types.ts:450-464`.
- Default calculation: `libs/shared/src/lib/types/capability-toggle.types.ts:146-166`.
- Plugin default application: `libs/backend/cli-agent-runtime/src/lib/capabilities/capability-policy-model.ts:309-318`.
- Root resolution: `libs/backend/harness-sync/src/lib/workspace/workspace-root.ts:49,66-101`.

No inspected path translates this worktree to its Git main checkout. The plugin configuration and capability store both use the resolved worktree root. Parent session metadata does not override this rule.

All four affected skill slugs have only `ptah-core` as their plugin provider. Their files exist, but file presence does not enable the provider plugin.

### 3. Confirmed enforcement, not a separate Ubuntu defect

An off parent plugin disables its skills. Ptah emits both bare and provider-qualified deny names. The SDK blocks model invocation and user-typed slash invocation.

Evidence:

- Parent-plugin gate: `libs/backend/cli-agent-runtime/src/lib/capabilities/capability-policy-model.ts:221-251,285-295`.
- Deny names: same file, `402-422`.
- SDK flag settings: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:484-512,527-555`.
- Installed SDK contract: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:6548-6552`. It states that `off` hides a skill from both the model and `/name`.

The displayed advice to remove an override from settings is misleading here. Ptah generates the override from capability policy. No inspected Claude settings file contains it.

## A. Toggle destination and disk comparison

### Authoritative current configuration

Physical file:

`/home/amun/.config/Ptah/global-state.json`

Logical key:

`ptah.plugins.harnessConfig:/home/amun/ptah-extension`

Current value:

```json
{
  "version": 1,
  "harnessRoot": "/home/amun/ptah-extension",
  "config": {
    "enabledPluginIds": ["ptah-nx-saas", "ptah-angular", "ptah-core"],
    "disabledSkillIds": [],
    "disabledPluginIds": [],
    "disabledAgentIds": [],
    "lastUpdated": "2026-10-29T20:54:30.362Z"
  },
  "origin": "saved",
  "sourceFolders": ["/home/amun/ptah-extension"],
  "dismissed": {}
}
```

This is **workspace/harness-root configuration in a global storage file**. It is not a global capability override for all workspaces.

Electron injects global state as the configuration home: `apps/ptah-electron/src/activation/plugin-activation.ts:273-284`. The storage registration selects `global-state.json`: `libs/backend/platform-electron/src/registration.ts:119-123`.

The loader serves a virtual workspace view through that home: `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:931-944`. A valid home record wins before legacy fallback: `libs/backend/agent-sdk/src/lib/helpers/plugin-config-home.ts:509-542`. Save writes `origin: saved`: same file, `491-505`.

The whole global file mtime was `2026-10-29T21:00:32.760331Z` during the first inspection. It was `2026-10-29T21:11:10.761002Z` at final inspection. The plugin record retained its `20:54:30.362Z` timestamp. Whole-file mtimes include unrelated application writes.

The Electron log confirms a save pass at `20:54:30.693Z`:

`/home/amun/.config/Ptah/logs/Ptah Electron-2026-10-29.log:7882`

It records `reason: plugins:save-config`. This corroborates the saved record timestamp.

### Legacy main checkout file

```text
/home/amun/.config/Ptah/workspace-storage/
L2hvbWUvYW11bi9wdGFoLWV4dGVuc2lvbg/workspace-state.v2/values/
d832e93d650acdc0d3c8e9c96e219366e56901603ec00d8926ee5a01c631ce46.50.json
```

The line breaks above are for display only.

Its mtime remains `2026-10-27T16:51:50.206198Z`. Its contents are:

```json
{"enabledPluginIds":["ptah-core","ptah-nx-saas","ptah-angular"],"disabledSkillIds":[],"disabledPluginIds":[],"disabledAgentIds":[],"lastUpdated":"2026-10-27T16:51:50.205Z"}
```

A prior transcript read at `20:45:59.506Z` already showed these lists and timestamp:

`/home/amun/.claude/projects/-home-amun-ptah-extension--claude-worktrees-fix-lane-budget-wrap-up-aef7114fd22f/dff48fba-f8e6-4574-bf95-ab8be631d1ed.jsonl:876`

Thus the toggle did not update that legacy file. The current home record, not the legacy file, governs the main root.

### Worktree state

Workspace:

`/home/amun/ptah-extension/.claude-worktrees/fix-lane-budget-wrap-up-aef7114fd22f`

Both initial and final inspections found:

- No `ptah.plugins.harnessConfig:<worktree path>` key in `global-state.json`.
- No Electron workspace-storage directory for the base64url-encoded worktree path.
- No global capability items.
- No capability `items/` records for this worktree.

**Historical limit:** no complete pre-toggle snapshot of the authoritative home record was available. Its previous enabled list cannot be proved. The old legacy file is not that snapshot. The evidence identifies the saved destination and current state, but not the complete before/after home-record diff.

## B. Policy calculation and open-session refresh

Policy is computed **per SDK query creation**, not once for the entire logical session and not on each model request inside a persistent query.

`executeQuery`:

1. Resolves policy from `sessionConfig.projectPath` at `1402-1407`.
2. Calls harness synchronization at `1408-1416`.
3. Passes the same policy snapshot to the options builder at `1441-1481`.
4. Starts and registers the SDK query at `1500-1529`.

All references above use:

`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`

The options builder places the deny list into launch settings: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1338-1339,1393-1407`.

`HarnessPolicySync.apply` reconciles files and tracks acknowledged fingerprints. It does not patch an active SDK query's settings: `libs/backend/agent-sdk/src/lib/harness/harness-policy-sync.ts:65-108`.

Plugin save invalidates command discovery and reconciles harness files. It then refreshes the user layer: `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:452-482`. No live `skillOverrides` patch was found in these paths.

**Important distinction:** follow-up slash handling explicitly ends the old query and creates a resumed query. It therefore computes fresh policy:

`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:882-919`

Consequently, a slash invocation should pick up a saved toggle **when the toggle and query resolve the same root**. A general claim that an open session never refreshes policy is incorrect. Here, fresh policy still disables the worktree's plugin because the toggle belongs to the main checkout.

The log also records a resumed worktree query at `20:44:41.281Z`, followed by a worktree policy acknowledgement warning at `20:44:41.307Z`: Electron log lines `7616,7620`. A missing harness acknowledgement does not remove native SDK deny flags.

## C. Child identity, worktree root, and policy key

Child creation separates metadata identity from execution path:

- `workspaceId` names the parent workspace.
- `projectPath` names the child worktree.

Evidence: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:747-785,1012-1017`.

Some context follows the parent, including prompt/model/provider configuration and permission level:

- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:935-1002`.
- `libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts:90-107`.

Capability policy instead follows `projectPath`. The resolver selects the harness root, applies realpath, and derives its key:

`libs/backend/cli-agent-runtime/src/lib/capabilities/capability-resolver.service.ts:253-277`

The state-root fallback only searches from cwd to the resolved policy root. It does not search the parent session's workspace: same file, `280-304`.

For this worktree, both `.ptah` and `.git` exist. Its `.ptah` is not a symlink. Therefore:

```text
physicalRoot = policyKey =
/home/amun/ptah-extension/.claude-worktrees/fix-lane-budget-wrap-up-aef7114fd22f

wsKey = 5de25e4dc26078ebd761dad7ed8351fc
```

The key calculation is SHA-256 of `policyKey`, truncated to 32 hexadecimal characters: `libs/backend/cli-agent-runtime/src/lib/capabilities/capability-toggle-store.ts:140-155`.

Neither plugin configuration nor capability storage maps this specific worktree to main. Root discovery is marker-based, not Git-common-directory-based. A different nested directory without its own `.ptah` can resolve to an ancestor. Do not generalize this result to every possible worktree layout.

Stored session metadata illustrates the split. The sessions database associates `dff48fba-f8e6-4574-bf95-ab8be631d1ed` with the main workspace. Its transcript records the worktree cwd. The database's current `is_child` value is `0`, so that field alone does not prove the original parent relation. The launch code and execution-root evidence establish the relevant policy behavior without that assumption.

## D. User-typed slash commands

The SDK intentionally blocks both model and user invocation for `skillOverrides[name] = off`.

Its separate `user-invocable-only` value keeps `/name` available while hiding the skill from the model. Ptah deliberately emits `off`, not that value.

Ptah forwards ordinary slash commands to the SDK:

- `libs/backend/agent-sdk/src/lib/helpers/slash-command-interceptor.ts:35-88`.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:323-346`.

The transcript contains actual SDK `local_command` failures at `20:40:52.578Z` and `20:44:09.566Z`:

`/home/amun/.claude/projects/-home-amun-ptah-extension--claude-worktrees-fix-lane-budget-wrap-up-aef7114fd22f/dff48fba-f8e6-4574-bf95-ab8be631d1ed.jsonl:748,756`

These recorded failures precede the toggle. The user's report supplies the post-toggle failure. The inspected transcript does not independently establish its exact post-toggle timestamp.

## E. Read-only reproduction from current stores

A Python process read the JSON stores and applied the verified rules. It did not call the resolver. This avoids resolver side effects such as diagnostic writes or legacy imports.

Inputs:

| Input | Observed value |
| --- | --- |
| Worktree home config | Absent |
| Worktree legacy config | Absent |
| Global capability items | None |
| Worktree capability items | None |
| Worktree imported entries | `{}` |
| `ptah-core` source | Bundled, opt-in |
| Other provider for the four slugs | None found |

Capability directory:

`/home/amun/.ptah/capabilities/workspaces/5de25e4dc26078ebd761dad7ed8351fc/`

Its `root.json` records the literal worktree root and policy key. Mtime: `2026-10-29T16:39:19.773478Z`.

Its `imported.json` contains:

```json
{"v":1,"createdAt":"2026-10-29T16:39:19.836Z","sources":[],"entries":{}}
```

Mtime: `2026-10-29T16:39:19.836479Z`. There are no item records. `root.json` is diagnostic, not a policy input: `libs/backend/cli-agent-runtime/src/lib/capabilities/capability-resolver.service.ts:307-310`.

The configuration reader treats absent configuration as empty: `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1058-1095`. It merges global items beneath the workspace config at `1114-1139`.

Manual result:

| Skill | Own default | Parent plugin | Effective result |
| --- | --- | --- | --- |
| `session-handoff` | On | Off | Off, `parent-plugin` |
| `orchestration` | On | Off | Off, `parent-plugin` |
| `agent-lanes` | On | Off | Off, `parent-plugin` |
| `tribunal` | On | Off | Off, `parent-plugin` |

For `session-handoff`, the corresponding generated flags are:

```json
{
  "skillOverrides": {
    "session-handoff": "off",
    "ptah-core:session-handoff": "off"
  }
}
```

The other three skills receive equivalent bare and qualified denies.

Installed plugin skill files exist under `~/.ptah/plugins/ptah-core/skills/`. Copies also exist in the worktree's `.claude/skills/` and the user mirror. These copies do not override explicit SDK denies. Workspace plugin discovery admits `ptah-harness-*` roots, not an implicit enabled replacement for bundled core: `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1516-1552`.

### Previously supplied facts: confirmation status

1. **Confirmed for inspected locations:** `~/.claude/settings.json` has no `skillOverrides`. No repository or affected-worktree `.claude/settings*.json` files exist. `/etc/claude-code` does not exist.
2. **Confirmed:** Ptah constructs SDK flag-tier overrides from capability denies. One enabled provider can keep a bare skill enabled. Explicit per-skill off settings can also deny a skill.
3. **Confirmed with qualification:** bundled core is opt-in. A workspace enabled list can enable it. A true global capability item can also enable it beneath workspace configuration. No such global item exists here.
4. **Partly outdated:** the legacy workspace file exists, but the current Electron home record in `global-state.json` is authoritative. Worktree legacy storage remains absent. Its capability directory exists, but contains no enable selection.

## Product gaps and smallest fix options

No option below was implemented.

### Gap 1: Plugins settings do not identify the selected session's policy root

The panel can save main while the selected session runs in a worktree.

Smallest options:

- Show the target harness root and a notice when it differs from the selected session root.
- Add an explicit session-root target to the RPC contract and panel. Validate the target on the backend.

Files: `plugin-catalog-panel.component.ts`, `plugin-rpc.handlers.ts`, and the associated plugin RPC contract. Current call sites appear at the citations in section A.

### Gap 2: child worktrees do not inherit parent plugin choices

Smallest options:

- Copy the effective parent plugin selection when Ptah creates a child worktree. Define later synchronization as separate behavior.
- Pass an explicit plugin-policy root alongside execution cwd. Keep MCP trust policy tied to the execution root unless separately approved.

Files: `chat-session.service.ts`, `child-chat-session-host.adapter.ts`, session configuration types, `capability-resolver.service.ts`, and `plugin-loader.service.ts`.

Do not automatically merge every worktree into the main capability store. That could widen repository MCP permissions.

### Gap 3: a persistent query has no demonstrated live settings patch

Smallest option: report that the new policy applies to the next recreated query. If immediate effect is required, recreate only an idle affected query.

Files: `plugin-rpc.handlers.ts`, `session-lifecycle-manager.ts`, and `session-query-executor.service.ts`.

This is not the principal cause here. Slash queries already recreate the SDK query. A restart notice alone would not fix a save to the wrong root.

### Gap 4: the SDK error points to the wrong place for remediation

Smallest option: attach Ptah policy context to the error. Name the disabled provider and exact root. Direct the user to that root's Plugins settings.

Files: `chat-slash-command-router.service.ts`, the SDK event-to-UI error path, and capability explanation contracts. Do not change `off` to `user-invocable-only` unless the product intentionally permits direct invocation of disabled skills.

### Gap 5: legacy and current storage locations obscure diagnosis

Smallest option: show the governing home key, logical root, and legacy provenance in the existing configuration status UI.

Files: `plugin-config-home.ts`, `plugin-loader.service.ts:getConfigHomeStatus`, and `plugin-catalog-panel.component.ts`.

## Ubuntu assessment and remaining limits

The inspected policy code has no Ubuntu-specific branch. Windows alone folds root keys to lowercase: `libs/backend/cli-agent-runtime/src/lib/capabilities/capability-toggle-store.ts:140-147`. That distinction does not combine main and worktree paths.

No missing skill file, unreadable policy input, or permission failure was needed to explain the result. The deterministic current configuration already produces the deny.

Remaining limits:

- No complete pre-toggle authoritative record was available.
- No live invocation was performed after the toggle.
- No application runtime was started to verify the installed executable against the checkout.
- Harness synchronization logged acknowledgement gaps. Their precise cause is outside this bounded investigation. Native SDK denies independently explain the disabled command.
