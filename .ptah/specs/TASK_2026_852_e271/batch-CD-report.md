## Files

- Deleted: `apps/ptah-extension-vscode/assets/harnesses/tribunal-conductor.json`
- Edited: `libs/backend/rpc-handlers/src/lib/harness/config/builtin-presets.ts`
- Edited: `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts`
- Edited: `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.spec.ts`
- Edited: `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.schema.ts`
- Edited: `libs/shared/src/lib/types/rpc.types.ts`
- Edited: `libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts`
- Edited: `libs/shared/src/lib/types/rpc/rpc-tasks.types.ts`
- Edited: `libs/backend/task-specs/src/lib/task-index.service.ts`
- Edited: `.claude/skills/tribunal/SKILL.md`
- Edited: `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/SKILL.md`
- Edited: `.claude/skills/tribunal/references/vendor-panel.md`
- Edited: `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/references/vendor-panel.md`
- Edited: `.claude/skills/tribunal/references/relay.md`
- Edited: `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/references/relay.md`
- Edited: `.claude/skills/orchestration/references/task-tracking.md`
- Edited: `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/task-tracking.md`

## Skill wording

- Tribunal description: "and Tribunal UI launches" -> "or a named Tribunal mode (Council, Forge, Race, Crucible, Relay) in main chat".
- Tribunal preflight: UI-generated panelist lines and immediate spawn -> plain-text user pins resolved through `ptah_agent_list`, preserving duplicates and order.
- Tribunal preflight: "Announce the panel, rounds and call count before spending" -> present the resolved panel, rounds and expected paid call count; confirm before any spawn.
- Tribunal Relay: "A Relay launch from the Tribunal UI" -> invoke Relay through the `tribunal` skill in main chat, delegating phase execution to orchestration.
- Tribunal reference and requirement: "A Relay launch from the Tribunal UI" / "Relay launches" -> "Running Relay from main chat" / "Relay runs".
- Vendor panel introduction: "explicit UI panels" -> "explicit user panels".
- Vendor panel section 0: UI-generated `[tribunal:<laneId>]` and `spawnArgs` lines -> user-named lanes, models and roles in plain text; preserve duplicates, order and roles.
- Vendor panel section 0: spawn pins verbatim without confirmation -> resolve every pin against `ptah_agent_list`, report unavailable or AT LIMIT pins without substitution, then confirm panel, rounds and paid calls before spawning.
- Vendor panel folder rule: "Spec folder ... already created by the Tribunal UI" -> use a task folder the user names in chat.
- Vendor panel selection: "Announce labels and names before spending" -> present labels, rounds and paid calls and confirm before spawning.
- Vendor panel rounds: "Announce panel size x rounds before spending" -> present planned rounds and expected paid calls, then confirm before spawning.
- Relay mapping: "Mapping a Tribunal UI launch onto it" -> plain-text phase-to-lane and model pins resolved through `ptah_agent_list`; preserve roles and orchestration phase order.
- Task tracking: "A task folder the Tribunal UI already created ... is used as given" -> "A task folder the user names in chat is used as given; skip allocation."

## Mirror check

- Native `cmp` command attempted; unavailable in PowerShell on this machine. Exact byte comparison was run with Python.
- `tribunal/SKILL.md`: PASS, byte identical.
- `tribunal/references/vendor-panel.md`: PASS, byte identical.
- `tribunal/references/relay.md`: PASS, byte identical.
- `orchestration/references/task-tracking.md`: PASS, byte identical.

## Verification

- Command: `npm run verify -- -t test,typecheck,lint -p @ptah-extension/rpc-handlers,@ptah-extension/shared,@ptah-extension/vscode-lm-tools,@ptah-extension/harness-sync,@ptah-extension/task-specs`
- Project names confirmed against five `project.json` files; expected header count: 5 projects.
- Result: PENDING. The machine-wide verify lock admitted this process; Nx is running a Jest task. No final Nx summary or header has returned yet. Session ID: 32024.
- Scoped `git diff --check`: PASS.
- Static reference audit: PASS for removed RPC in scoped handler/contract files and no explicit DI guard expectation.
- Skill description shape, vendor roster, lane rule, and sibling link specs were read before editing; their assertions need the queued verify result.

## Decisions

- Removed the RPC-only Zod schema and parsed type from `tasks-rpc.schema.ts` to satisfy dead-code deletion, although the plan omitted this file from its explicit list.
- Kept `roundJudgeFile()`, the task-spec artifact reader and its contract; only the RPC-specific comment was changed.
- The preset list is empty because Tribunal Conductor was its only entry; the generic preset mechanism remains.
- No DI guard was edited because no explicit method list includes the removed RPC.
- No new mirror equality spec was added, per amendment 2.
- Other lanes' concurrent file edits were left untouched.

## Open issues

- Required scoped verification is running; capture its eventual result before accepting this batch.
