# ptah-tui (`@ptah-extension/ptah-tui`)

[Back to Main](../../CLAUDE.md)

## Purpose

Ink 7 + React 19 terminal UI for the Ptah agent backend. Hosts the same in-process engine as the headless CLI via `@ptah-extension/cli-engine`, then renders a chat-first interactive shell on a real TTY. Shipped as a second esbuild bundle (`tui.mjs`) inside the `@hive-academy/ptah-cli` npm package and launched by `ptah tui`.

## Boundaries

**Belongs here**: `runTui` boot sequence, the Ink/React component tree, TUI hooks (chat/session/push-event demux against the current streaming contract), the TUI push-event adapter, Thoth panels. The engine, transport, push adapter, fire-and-forget handler, RPC registration, and Thoth lifecycle all come from `@ptah-extension/cli-engine` — never re-implement them here.

**Does NOT belong**: DI bootstrap, the `vscode` shim, CLI platform adapters, RPC method registration, argv parsing / commander router, JSON-RPC NDJSON I/O. No backend business logic, no frontend (Angular) imports.

## Entry Points

- `src/main.tsx` — `runTui(globals)` and `TUI_BUNDLE_API_VERSION`. TTY guard, `withEngine({ mode: 'full', requireSdk: false, thoth: 'off', pushAdapter })`, non-fatal `initializeSdkAdapter`, Ink `render`, LIFO disposal, exit codes 130/143. `PTAH_TUI_SMOKE=1` boots the engine, renders one frame, disposes, and exits 0 (the only way to e2e the boot path without a PTY).
- `src/transport/tui-webview-manager-adapter.ts` — `TuiWebviewManagerAdapter extends CliWebviewManagerAdapter`, raising `setMaxListeners(64)` so the chat hook + App + sidebar + Thoth panels do not trip EventEmitter leak warnings onto the Ink screen.

## Cross-Lib Rules

`scope:cli`. Consumes `@ptah-extension/cli-engine` and `@ptah-extension/shared` only. `ptah-extension-vscode` (`scope:extension`) is forbidden from depending on cli-engine — this app stays out of the VS Code graph.

## Build & Run

- `nx build ptah-tui` — esbuild ESM bundle to `dist/apps/ptah-cli/tui.mjs` with the same banner + externals as `main.mjs`. `deleteOutputPath: false`, `dependsOn` ptah-cli's build so it lands beside `main.mjs` and `embedder-worker.mjs`.
- `nx dev ptah-tui` — `npx tsx apps/ptah-tui/src/main.tsx` on a real terminal (nx pipes stdin, so `nx serve` cannot provide a TTY).
- `nx test ptah-tui` / `:lint` / `:typecheck`.
- Launched in production via `ptah tui`, which dynamic-imports `tui.mjs` next to `main.mjs`.

## Guidelines

- The TUI never attaches the NDJSON event pipe — push events flow `EventEmitter → React hooks`, never to stdout. Keep stdout clean while the TUI owns the terminal.
- Streaming contract is the current one: `chat:start` requires a UUID-v4 `tabId`; stop is `chat:abort`; payloads are `FlatStreamEventUnion` envelopes. Filter `payload.tabId === tabId` first for multi-session isolation.
- Respect `NO_COLOR` / `FORCE_COLOR`.
- No version string here — the single bin + version live in `apps/ptah-cli`.
