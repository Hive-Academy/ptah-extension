# TASK_2025_219: Electron Monaco Editor Fixes — Workers, Multi-Tab, Markdown Preview

## User Request

Fix three Monaco editor issues in the Electron app:

1. Worker ERR_FILE_NOT_FOUND errors (importScripts fails with malformed file:// URLs)
2. Add multi-tab support (tab bar with open/close/switch)
3. Add markdown preview toggle for .md files

## Strategy

- **Type**: BUGFIX + FEATURE (hybrid)
- **Workflow**: Minimal — direct frontend-developer implementation
- **Complexity**: Medium (4-5 files)

## Root Cause Analysis (from investigation)

### Worker Errors

The Monaco AMD loader in Electron uses `importScripts()` with a relative `file://assets/...` URL instead of absolute `file:///D:/path/...`. Workers from blob origins can't resolve relative file:// URLs. Fix: configure `MonacoEnvironment.getWorkerUrl` in `onMonacoLoad` callback to return a data: URI bootstrap that resolves paths to absolute file:/// URLs.

### Multi-Tab

Currently EditorService tracks a single `activeFilePath` + `activeFileContent`. Need to add an `openTabs` signal tracking all open files, with tab switching that preserves per-tab content.

### Markdown Preview

ngx-markdown is already in the project. Add a preview toggle button on .md files that switches between Monaco editor and rendered markdown view.

## Files to Modify

1. `apps/ptah-extension-webview/src/app/app.config.ts` — Add `onMonacoLoad` worker URL fix
2. `libs/frontend/editor/src/lib/services/editor.service.ts` — Add tab state management
3. `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts` — Add tab bar UI
4. `libs/frontend/editor/src/lib/code-editor/code-editor.component.ts` — Add markdown preview toggle
