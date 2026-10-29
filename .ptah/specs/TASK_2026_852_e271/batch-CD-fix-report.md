# Batch C+D revision, round 1

## Defect 1: Relay glyphs

Source: `.claude/skills/tribunal/SKILL.md`; identical changes in `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/SKILL.md`.

| File:line | Old → new text |
| --- | --- |
| `SKILL.md:52` | `**Relay ? phased lane workflow.**` → `**Relay — phased lane workflow.**` |
| `SKILL.md:53` | `plan ? architect ? implement ? review` → `plan → architect → implement → review` |
| `SKILL.md:54` | `? [references/relay.md](references/relay.md).` → `→ [references/relay.md](references/relay.md).` |

UTF-8 scan of both copies of `SKILL.md`, `references/vendor-panel.md`, `references/relay.md`, and `orchestration/references/task-tracking.md`: no other lost arrow or dash glyphs. The `a ? b : c` example at `task-tracking.md:71` is a valid ternary expression and was retained.

## Defect 2: Crucible main-chat roles

Source: `.claude/skills/tribunal/references/crucible.md`; identical changes in `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/references/crucible.md`.

| File:line | Old → new text |
| --- | --- |
| `crucible.md:51` | `UI role tokens` and `vendor-panel.md#0-explicit-panel-from-the-tribunal-ui` → `User's plain-text role pins` and `vendor-panel.md#0-explicit-panel-from-the-user`; pinned executor and judge lanes resolve through `ptah_agent_list` and must use different families. |
| `crucible.md:52` | `UI lanes without tokens — the first lane executes, the last judges` → `Roles not pinned — use the heuristic above to choose the executor and judge from different families`; state role choices in the panel confirmation and never infer them from lane order. |
| `crucible.md:53–54` (old) | Separate `Lanes the user named` and `Nothing named` rules → consolidated into the two rules above; user-named lanes are retained. |
| `crucible.md:120` (old), `:118` (new) | `or use the folder the UI framing names` → `or use the folder the user named in chat`. |

The new anchor is derived from the heading `## 0. Explicit panel from the user` in `vendor-panel.md`. A scan of `crucible.md`, `forge.md`, `race.md`, and `council.md` and their mirrors found no remaining link to the old anchor.

## Mirror comparison

Python byte comparisons returned `True` for all five source/mirror pairs: `tribunal/SKILL.md`, `tribunal/references/vendor-panel.md`, `tribunal/references/relay.md`, `orchestration/references/task-tracking.md`, and `tribunal/references/crucible.md`. The changed source files were copied byte for byte to their mirrors.

## Verification

Command: `npm run verify -- -t test -p @ptah-extension/vscode-lm-tools,@ptah-extension/harness-sync`

Header: `verify test (@ptah-extension/vscode-lm-tools,@ptah-extension/harness-sync)` (2 projects).

Summary: `NX   2 tasks: 2 succeeded`; `Cache: 0/2 hit (0%)`; `Run duration: 5m 18s`; exit code `0`.
