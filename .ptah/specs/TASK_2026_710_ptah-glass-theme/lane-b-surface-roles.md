# Lane B: glass surface roles

| Component | File | Role(s) added | Notes |
| --- | --- | --- | --- |
| `ptah-electron-shell` | `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts` | `bar`, `chrome` | Header bar; workspace sidebar host. The shell's opaque root fill becomes transparent under `data-glass='on'` in its inline styles. |
| `ptah-chat-view` | `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` | `chrome`, `plate` | Main pane and queued-message status row. |
| `ptah-docked-inspector` | `libs/frontend/marketplace/src/lib/ui/docked-inspector.component.ts` | `chrome`, `plate` | Inspector pane and title row. |
| `ptah-chat-input` | `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts` | `tile`, `plate` | Composer form and status line. |
| `ptah-command-center-header` | `libs/frontend/command-center/src/lib/components/command-center-header.component.ts` | `bar` | Text-dense toolbar. |
| `ptah-confirmation-modal` | `libs/frontend/setup-wizard/src/lib/components/confirmation-modal.component.ts` | `overlay` | Modal box. |
| `ptah-dropdown` | `libs/frontend/ui/src/lib/overlays/dropdown/dropdown.component.ts` | `overlay` | Overlay panel. |
| `ptah-add-cli-instance-modal` | `libs/frontend/chat/src/lib/settings/providers/add-cli-instance-modal.component.ts` | `overlay` | Attribute on native modal host; its projected `.modal-box` is also styled by the shared layer. |
| `ptah-message-bubble` | `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html` | `content` | Assistant answer bodies; user bubble retains its bubble fill. |
| `ptah-project-setup-card` | `libs/frontend/chat/src/lib/components/molecules/setup-plugins/project-setup-card.component.ts` | `tile` | Card section. |
| `ptah-prompt-suggestions` | `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/prompt-suggestions.component.ts` | `tile` | Suggestions list container. |
| `ptah-command-session-stats` | `libs/frontend/command-center/src/lib/components/command-session-stats.component.ts` | `tile` | Four visible stat items. |
| `ptah-inspector-session-stats` | `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts` | `plate`, `tile` | Heading and limit notice; individual stat tiles. |
| `ptah-tool-call-item` | `libs/frontend/chat/src/lib/components/molecules/tool-execution/tool-call-item.component.ts` | `tile` | Tool call wrapper. |
| `ptah-execution-node` | `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts` | `tile` | Agent tile mode wrapper. |
| `ptah-command-center-start` | `libs/frontend/command-center/src/lib/components/command-center-start.component.ts` | `content` | Reading panel surrounding the start view. |
| `ptah-chat-empty-state` | `libs/frontend/chat/src/lib/components/molecules/setup-plugins/chat-empty-state.component.ts` | — | Hides `ptah-aurora-effect` under the root glass attribute with component CSS. |
| `ptah-canvas-rail-board` | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts` | — | Hides the other live aurora host under glass with component CSS. |
| `ptah-workspace-sidebar` | `libs/frontend/chat/src/lib/components/organisms/workspace-sidebar.component.ts` | `plate`, `tile` | Folder list is the current Electron sidebar list; it uses `flex: 0 1 auto`. The add-folder action uses `mt-auto`, and the bottom MCP card wrapper is a tile. |
| License status card | `libs/frontend/chat/src/lib/settings/license/license-status-card.component.ts` | `content` | Top-level status card. |
| Agent behaviour section | `libs/frontend/chat/src/lib/settings/pro-features/agent-behaviour-section.component.ts` | `content` | Top-level settings card. |
| Output style config | `libs/frontend/chat/src/lib/settings/output-style/output-style-config.component.ts` | `content` | Top-level settings card. |
| MCP port config | `libs/frontend/chat/src/lib/settings/pro-features/mcp-port-config.component.ts` | `content` | Top-level settings card. |
| VS Code LM config | `libs/frontend/chat/src/lib/settings/pro-features/vscode-lm-config.component.ts` | `content` | Conditional settings card. |
| Web search config | `libs/frontend/chat/src/lib/settings/ptah-ai/web-search-config.component.ts` | `content` | Top-level settings card. |
| Provider card list | `libs/frontend/marketplace/src/lib/ui/provider-card-list.component.ts` | `content` | Each rendered provider card in the marketplace list. |
| Installed servers page | `libs/frontend/marketplace/src/lib/pages/servers/installed-servers-page.component.ts` | `content` | Text-heavy server capabilities panel. |

## Decisions

- The source has `ThemeService.currentTheme`, but no public `info()` or `glass` signal. Used a root-attribute CSS selector in the shell's inline styles for its opaque fill. Options were a theme-name lookup in component TypeScript or a CSS selector; the root attribute is already the glass-layer contract and keeps the component independent of the theme list. Reversible.
- The current `ptah-sidebar-tab` is a narrow toggle button, not the prototype's `ul.menu` session pane. Put `chrome` on the actual workspace sidebar host in `ptah-electron-shell`. Options were labeling the toggle or its pane host; the pane host owns the visual region. Reversible.
- The shared CSS layer already targets `.modal-box`. Added `overlay` to the add-CLI modal host without changing the shared native modal component, which is outside this lane's files. Reversible.
- `ThemeService` exposes no public glass signal. Both aurora hosts use `:host-context([data-glass='on'])` in component CSS, with no TypeScript theme coupling.
- The current Electron sidebar contains workspace folders rather than a session `ul.menu`. Its folder list is the text-dense group that can take the plate role. The actual previous-sessions list is in a modal and keeps its independent scroll layout.
- Eight files received settings/marketplace `content` roles, within the 12-file limit. Attributes are on rendered cards or text panels, not icon badges or skeleton placeholders.

## Skipped or unresolved

- `ptah-dialog-host`: `ptah_code_search_symbols` had an empty index; subsequent file and selector searches found no component. The only selector occurrence is in a spec. No template to edit.
- `ptah-sidebar-tab`: its current template is only a vertical toggle button. The folder list and bottom tile were updated in `ptah-workspace-sidebar` instead.
- Date/time separator in the chat message list: `chat-transcript.component.html` renders message slots and turn summaries with no separator text. `chat-view.component.html` contains a resize separator only. No `<span class="pill">` was added.
- Verification: the earlier `ptah_get_diagnostics` check timed out and did not recognise the two HTML files. This continuation passed `git diff --check` for its changed templates/styles. No Nx, Jest, TypeScript CLI, lint, or build command was run per the lane's memory-safe rule.
