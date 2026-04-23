# Ptah TUI - Terminal User Interface

↩️ [Back to Main](../../CLAUDE.md)

## Purpose

The **ptah-tui** application is a terminal-based front-end to the Ptah
agent backend. It runs as a single Node.js binary (`ptah` on the PATH)
and renders the agent conversation with Ink + React. It is the CLI-first
equivalent of the webview UI — same DI container, same libraries, same
RPC protocol, different renderer.

It provides:

- Ink + React TUI for chat, session list, settings, diff view
- Direct in-process transport to the agent backend (no IPC; same process)
- The same CLI adapter stack used by Electron and the VS Code extension
- Keyboard-driven navigation with focus management and theme switching

## Boundaries

**Belongs here**:

- Ink entry point (`src/main.tsx`)
- React components (atoms, molecules, feature folders)
- React contexts for mode, session, theme, TUI layout
- TUI-specific hooks (`src/hooks/`)
- TUI DI container (`src/di/container.ts`, `src/di/tui-adapters.ts`)
- The in-process RPC transport (`src/transport/`)
- The `vscode` module shim (`src/shims/vscode-shim.ts`)

**Does NOT belong**:

- Business logic — belongs in backend libraries
- Shared UI patterns — belongs in a future TUI UI library (none yet)
- CLI adapter / agent process management — belongs in
  `libs/backend/llm-abstraction` (to be moved into agent-sdk by Wave C5)
- RPC handler classes — belong in `libs/backend/rpc-handlers`

## Key Files

### Entry Points

- `src/main.tsx` — Ink render + top-level providers
- `src/components/App.tsx` — root component, wires contexts and layout
- `src/di/container.ts` — DI container, ~21 token registrations
- `src/di/tui-adapters.ts` — TUI-specific implementations of platform
  interfaces (auth, file settings, workspace, state storage)
- `src/services/tui-rpc-method-registration.service.ts` — registers shared
  RPC handlers against the in-process transport

### Configuration

- `tsconfig.app.json` — TypeScript base
- `tsconfig.build.json` — build-time path mappings (includes the `vscode`
  shim alias)
- `project.json` — Nx targets: `build`, `dev`
- `package.json` — declares the `ptah` binary entry

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Node.js process (single)                                    │
├──────────────────────────────────────────────────────────────┤
│  main.tsx                                                    │
│    ↓                                                         │
│  Ink render tree                                             │
│   ├── TuiContext provider                                    │
│   ├── ModeContext / SessionContext / ThemeContext            │
│   └── App component                                          │
│        ├── Sidebar (session list, mode switcher)             │
│        ├── MainPanel (chat stream + input)                   │
│        └── Overlays (file picker, settings, diff viewer)     │
│                                                              │
│  In-process RPC transport                                    │
│   (transport/cli-message-transport.ts)                       │
│    ↓                                                         │
│  DIContainer (tsyringe)                                      │
│    ↓                                                         │
│  Shared libs (agent-sdk, rpc-handlers, workspace-intelligence,│
│               llm-abstraction, etc.) via direct method calls │
└──────────────────────────────────────────────────────────────┘
```

Unlike the Electron app, the TUI has no IPC boundary — UI and backend
share one process. RPC still flows through `rpcHandler.handle(...)`
because the shared handler library is the source of truth for message
shapes and validation.

## Dependencies

### Internal Libraries

- `@ptah-extension/shared` — types and message protocol
- `@ptah-extension/platform-core` — platform interfaces and tokens
- `@ptah-extension/platform-cli` — CLI implementations of platform-core
- `@ptah-extension/vscode-core` — infrastructure (DI, logger, RPC, license,
  session watcher, subagent registry)
- `@ptah-extension/workspace-intelligence` — workspace analysis
- `@ptah-extension/agent-sdk` — Claude Agent SDK integration
- `@ptah-extension/agent-generation` — agent generation services
- `@ptah-extension/llm-abstraction` — CLI agent process manager and
  adapters (slated for merge into agent-sdk by Wave C5)
- `@ptah-extension/vscode-lm-tools` — MCP code execution
- `@ptah-extension/rpc-handlers` — shared RPC handler classes

### External NPM Packages

- `react`, `ink` — TUI rendering
- `@inkjs/ui`, `ink-text-input`, `ink-select-input`, `ink-spinner` — Ink
  widgets
- `marked`, `marked-terminal`, `cli-highlight` — markdown + syntax rendering
- `tsyringe`, `reflect-metadata` — dependency injection
- `@anthropic-ai/claude-agent-sdk`, `@github/copilot-sdk`, `@openai/codex-sdk`
  — AI provider SDKs (external in bundle)

### Build Dependencies

- `@nx/esbuild` — bundles `main.tsx` to a single ESM file with automatic JSX

## Commands

```bash
# Development
npm run tui:dev                        # Watch mode
npm run tui:build                      # Production build
npm run tui:serve                      # Build + run
```

The built binary lives at `dist/apps/ptah-tui/main.mjs`. The `package.json`
declares `"bin": { "ptah": "./main.mjs" }`, so linking the dist directory
(or publishing) yields a `ptah` command on PATH.

## Build Process

1. **build**: esbuild bundles `src/main.tsx` → `dist/apps/ptah-tui/main.mjs`
   with automatic JSX (`"jsx": "automatic"`), ESM output, Node 20 target.
   All React / Ink / SDK deps are kept external so the bundle stays small
   and upgradeable via the dist `package.json`.
2. **banner**: esbuild injects `createRequire`, `__filename`, and `__dirname`
   shims so CommonJS interop and `__dirname`-style path resolution still work
   in the ESM output.
3. **package.json copy**: the TUI `package.json` is copied alongside the
   bundle to declare the `ptah` bin entry.

## TUI-specific Concerns

### Ink rendering

Ink is a React reconciler for the terminal. Components render to
fixed-width text cells; there is no pixel layout. Prefer compositional
flex-style layout with `<Box flexDirection="column">` over absolute
positioning.

### Focus management

`src/hooks/use-focus-manager.tsx` owns focus across overlays, chat input,
and the sidebar. Only one focusable region is active at a time; keybindings
route to the focused region.

### Keyboard navigation

`src/hooks/use-keyboard-nav.ts` registers the global keymap. Do not call
`useInput` from Ink at random leaf components — route through the hook so
conflicts are caught.

### Themes

`src/lib/themes.ts` defines the color palettes. Components consume theme
via `ThemeContext` — never hard-code ANSI codes in components.

### No TTY / piped stdin

When stdout is not a TTY (e.g., `ptah | less`), Ink falls back to plain
text. Do not assume colors or cursor movement; degrade gracefully.

### The `vscode` module shim

Same pattern as the Electron app — `src/shims/vscode-shim.ts` provides a
minimal stub and `tsconfig.build.json` maps the `vscode` module to it.
This lets the TUI consume `vscode-core` and `vscode-lm-tools` without
the VS Code runtime.

## Development Workflow

1. **Start dev mode**: `npm run tui:dev` — watches and rebuilds on change;
   re-run the binary manually to see updates.
2. **Debug**: set `DEBUG=ptah:*` or use `NODE_OPTIONS=--inspect` then attach
   a debugger. Ink DevTools is available via `react-devtools-core` (external
   dep, not shipped by default).
3. **Manual smoke test**: `npm run tui:serve` — launches a new session; try
   sending a chat message, switching mode, opening file picker.

## Guidelines

### Component Layout

The current folder mix (`atoms/`, `molecules/`, `chat/`, `common/`,
`diff/`, `layout/`, `main-panel/`, `overlays/`, `settings/`, `sidebar/`) is
a hybrid of atomic design and feature folders. Pending a Wave-C decision
(see `WAVE_C_SIMPLIFICATION_PLAN.md` app dossier for TUI), prefer
**feature folders** for new work — place a new component inside the
feature folder it belongs to rather than introducing another atomic tier.

### Hooks

- One hook per file; filename kebab-case (`use-chat.ts`).
- Hooks must not throw at module scope; defer side effects to `useEffect`.
- Prefer RxJS + `useSyncExternalStore` for streaming state over
  `useState` chains.

### Accessibility

- Every focusable region must have a visible focus indicator (color +
  border or arrow marker).
- Never rely on color alone to convey state — pair with a text label
  or an icon glyph.

### Performance

- Ink re-renders on every state change; memoize expensive children with
  `React.memo` or context selectors.
- Long chat streams: virtualize (slice to the last N messages) rather than
  rendering the full history.

## Testing

```bash
# Unit tests
nx test ptah-tui

# Manual smoke
npm run tui:serve
# → verify render, keyboard nav, session switching, and chat round-trip.
```

## Troubleshooting

**Binary prints nothing / hangs**:

- Check stdout is attached to a TTY. Pipe redirection degrades Ink output.

**`Cannot find module 'ink'` at runtime**:

- External deps are expected to be installed in the dist `package.json`.
  Run `npm install` inside `dist/apps/ptah-tui/` or link the monorepo root
  `node_modules`.

**`vscode` import fails at runtime**:

- Check `tsconfig.build.json` still maps `vscode` to `src/shims/vscode-shim.ts`.
  If a lib reaches a vscode API the shim doesn't cover, extend the shim.

**Weird input handling**:

- Two `useInput` consumers collided. Route all keybindings through
  `use-keyboard-nav`.

**Large file picker slow to open**:

- File picker loads directory contents eagerly. Use the workspace-scoped
  glob in `platform-cli` for lazy enumeration instead.

## Related Documentation

- [VS Code Extension App](../ptah-extension-vscode/CLAUDE.md)
- [Electron Desktop App](../ptah-electron/CLAUDE.md)
- [Platform CLI Library](../../libs/backend/platform-cli/CLAUDE.md)
- [VS Code Core Library](../../libs/backend/vscode-core/CLAUDE.md)
- [Shared Types](../../libs/shared/CLAUDE.md)
- [Conventions](../../CONVENTIONS.md)
