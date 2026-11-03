# Prototype - TASK_2026_853_897f

`index.html` is self-contained (no network). Open it by file URL. The "Theme" button switches `anubis` (dark) and
`anubis-light`. Token values are copied from `apps/ptah-extension-webview/tailwind.config.js`; DaisyUI classes are
re-created as plain CSS, so the real build must use the classes listed in `../design-spec.md`.
Interactive: theme switch, MCP scope radios (all seven targets on global; back to workspace clears only home targets), no-folder skills.sh panel (Install enables only after All workspaces is chosen), failed-save focus return in the state gallery.
Screenshots: `screenshots/dark.png`, `screenshots/light.png`.

## Lane-introduced constraints

- [lane-proposed] Built-in tool and skill settings are global (all workspaces), not per workspace (orchestrator decision #13).
- [lane-proposed] No reverse "Make workspace-only" action (orchestrator decision #14).
- [lane-proposed] The migration notice is an inline card at the top of the main chat view, not a toast (Decisions 4).
- [lane-proposed] Token-cost figures in the prototype are illustrative; the architect supplies real numbers (Decisions 6).
