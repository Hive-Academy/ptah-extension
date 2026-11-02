# Batch 3 Report — Directory browser auto-detect

Status: IMPLEMENTED — VERIFICATION PENDING

## Completion

Implemented the shared-mapper auto-detect path for official registry entries. Added card metadata mapping, required-input display, coded configuration errors, install disabling for unresolved URL variables, and search/popular error propagation. Updated the component spec with new-shape fixtures and regression cases. The required scoped verification command remains queued and has produced no output.

## Files

- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts` — modified
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.spec.ts` — modified
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/.ptah/specs/TASK_2026_859_b561/batch-3-report.md` — this report

## Risk Handling

- R1: search and popular results now surface the supplied coded error message.
- R4: unresolved URL variables appear as named required inputs and disable the existing Install button.
- R5: required secrets show only their names, descriptions, and a `secret` marker. No input values enter the required-input view.
- R8: edits stay in the assigned component and spec. Target selection and `confirmInstall` target handling are unchanged.

## Verification

Command: `npm run verify -- -p @ptah-extension/chat-ui 2>&1 | tail -40`

The command remains active in the machine-wide verification queue. It has produced no final output. Two Ptah diagnostics requests also returned `TypeScript check still running after 45s`, so no diagnostics result is claimed. No second verification copy was started.

Final verify output: unavailable while the command is queued.

## Decisions

- Used property presence for `packages` and `remotes` to decide between direct mapping and the detail-fetch fallback. Empty arrays therefore produce `MCP_NO_INSTALL_SOURCE` without another request.
- Kept Smithery entries on the existing detail-fetch path and excluded them from the official-registry mapper.
- Used the existing DaisyUI and Tailwind classes for the required-input list. No visual redesign was introduced.
