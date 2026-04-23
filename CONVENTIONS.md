# Conventions

## 1. Purpose & scope

Authoritative shape and naming rules for the Ptah monorepo. One page, on purpose.

Every library CLAUDE.md may link here instead of restating. If a rule here
conflicts with a library-level CLAUDE.md, THIS file wins.

Source of extraction: `.ptah/specs/TASK_2025_291/WAVE_C_SIMPLIFICATION_PLAN.md`,
sections "Canonical Conventions" and "Appendix — Wave-C-Specific Conventions Cheatsheet".

---

## 2. Library folder shape

```
libs/<tier>/<lib-name>/
├── CLAUDE.md          # stated purpose
├── src/
│   ├── index.ts       # barrel — ≤150 lines, grouped exports
│   ├── di/
│   │   ├── index.ts   # exports register + tokens only
│   │   ├── register.ts
│   │   └── tokens.ts
│   └── lib/
│       ├── services/  # one subject per file; *Service suffix
│       ├── types/
│       ├── interfaces/  # only when there are implementations
│       ├── errors/    # one error hierarchy rooted at {Lib}Error
│       └── utils/     # pure functions only
```

Exceptions are allowed when documented in the library's own CLAUDE.md. Known
intentional exceptions:

- Platform libraries (`platform-core`, `platform-vscode`, `platform-electron`,
  `platform-cli`) use `src/implementations/` instead of `src/lib/services/`.
- Handler-only L4 libraries (`rpc-handlers`) have `src/lib/handlers/` instead
  of `src/lib/services/`.

## 3. Barrel rules

- Use explicit named exports: `export { X } from './path'`.
- Use `export * from` **only** for grouping files that are themselves a
  type bundle (e.g., `types/index.ts`).
- One grouped section per concern, separated by a single comment line.
- Do not re-export a deep helper just because one consumer needs it — the
  consumer can reach through a documented deep-import path (e.g.
  `@ptah-extension/vscode-lm-tools/vscode`) declared in `tsconfig.base.json`.
- Max barrel size: **150 lines**. If you exceed it, the library is doing too
  much; split before adding more.

## 4. DI token conventions

```typescript
// Good
export const TOKENS = {
  FOO_SERVICE: Symbol.for('FooService'),
} as const;
container.register(TOKENS.FOO_SERVICE, { useClass: FooService });

// Bad
container.register('FooService', ...);             // string token — silent failures
container.register(Symbol('FooService'), ...);     // unique per call — never matches
```

- Tokens live in `src/di/tokens.ts`, never scattered.
- Tokens use `Symbol.for('Name')` (shared registry), never `Symbol(...)`.
- Token identifier matches the symbol key (`FOO_SERVICE` ↔ `'FooService'`).

## 5. Registration function rule

- Each library exports exactly one `register{LibName}Services(container, options?)`.
- Registration functions **only** register into the DI container —
  no side effects, no logger output beyond a single summary line, no async I/O.
- Registration order at app level is owned by the app's DI container (phase files).
- Sub-module registrations (e.g., `quality/di.ts` inside `workspace-intelligence`)
  are called INTERNALLY by the library's main `register...Services` function;
  they are not exported as second public entry points.

## 6. Naming suffixes

| Suffix      | Semantics                                                            |
| ----------- | -------------------------------------------------------------------- |
| `*Service`  | Injectable, has a DI token, holds state or orchestrates              |
| `*Manager`  | Wrapper over a stateful external resource (VS Code API, OS, process) |
| `*Store`    | Pure storage (read / write / list) — no orchestration                |
| `*Registry` | In-memory map with registration semantics                            |
| `*Adapter`  | Implements a foreign contract behind a local one                     |
| `*Provider` | Concrete implementation of a platform interface (`IXxxProvider`)     |
| `*Handler`  | RPC handler or event handler                                         |
| `*Factory`  | Constructs non-DI instances                                          |

## 7. Error types

- Each library has a root error class `{Lib}Error extends Error`.
- Domain errors extend the root.
- Do **not** throw plain `Error` at a library boundary.
- `Result<T, E>` from `@ptah-extension/shared` is the preferred return shape
  for operations with expected failure paths.

## 8. Layer rule

```
L0   shared                                   → (nothing)
L0.5 platform-core                            → shared
L0.5 platform-vscode / electron / cli         → shared, platform-core
L1   vscode-core                              → L0, L0.5
L2   workspace-intelligence                   → L0, L0.5, L1
L3   agent-sdk, agent-generation              → L0..L2
L4   rpc-handlers, vscode-lm-tools            → L0..L3
L5   apps/*                                   → any lib
```

An import from a higher layer into a lower layer is a rule violation.
A library lives at exactly one layer — the deepest it imports from.

## 9. Disposal convention

- `dispose()` is **synchronous** by default.
- If async cleanup is genuinely required, expose `asyncDispose()` in addition.
- All `dispose` methods must be idempotent (second call is a no-op).
- The app's shutdown handler calls dispose in reverse registration order (LIFO).

## 10. Config discovery

- VS Code settings (package.json `contributes.configuration`) route through
  `ConfigManager.getConfiguration(...)`.
- File-based settings (`~/.ptah/settings.json`, keys listed in
  `FILE_BASED_SETTINGS_KEYS`) route through `PtahFileSettingsManager`
  automatically — `IWorkspaceProvider.getConfiguration()` dispatches.
- **Never** read `fs.readFileSync('~/.ptah/settings.json')` directly from a
  library or app; always go through the manager.

## 11. Cheatsheet

```
Library shape:       src/index.ts (≤150 lines) + src/di/ + src/lib/{services,types,interfaces,errors,utils}
Service suffix:      *Service (DI'd), *Manager (OS/VSCode), *Store (pure IO), *Registry, *Adapter, *Provider, *Handler
DI token:            Symbol.for('UniqueName'), in src/di/tokens.ts
Registration fn:     registerXxxServices(container, options?) — one per library
Error root:          {Lib}Error extends Error
Return shape:        Result<T, E> for expected-failure paths
Layer rule:          shared → platform-core → platform-* → vscode-core → workspace-intelligence → (agent-sdk | agent-generation) → (rpc-handlers | vscode-lm-tools) → apps
Dispose:             dispose() sync by default; asyncDispose() for async cleanup; always idempotent
Barrel:              explicit named exports, grouped by concern, ≤150 lines total
```
