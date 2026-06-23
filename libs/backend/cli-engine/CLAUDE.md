# @ptah-extension/cli-engine

[Back to Main](../../../CLAUDE.md)

## Purpose

Runtime-agnostic engine that hosts the full Ptah agent backend in-process for the headless CLI (`apps/ptah-cli`) and the terminal UI (`apps/ptah-tui`). Owns the DI bootstrap, the in-process message transport, the push-event adapter, the fire-and-forget permission/question handler, CLI platform adapters, the `vscode` module shim, RPC method registration, and the Thoth runtime lifecycle (activate/dispose, vec/embedder diagnostics, push bridges).

## Boundaries

**Belongs here**: `withEngine` bootstrap + `CliDIContainer`, `CliBootstrapOptions`, SDK init extraction (`initializeSdkAdapter`), Thoth tier lifecycle (`activateThoth`/`disposeThoth`), push bridges, transport/adapter/handler classes, CLI platform adapters, the `vscode` shim, CLI RPC registration + CLI agent RPC handlers, `stderr-json` fatal-error emitter.

**Does NOT belong**: argv parsing + commander router, JSON-RPC server / NDJSON I/O, the Ink/React UI, business logic (other backend libs), the Anthropic-compatible HTTP proxy.

## Cross-Lib Rules

`scope:cli`. May depend on `scope:extension` backend libs. Consumed by both `scope:cli` apps (`ptah-cli`, `ptah-tui`). `ptah-extension-vscode` (`scope:extension`) is forbidden from depending on this lib — lint enforces the Thoth-free invariant structurally. No frontend imports.

## Build

No `build` target — the lib is bundled into each consuming app by esbuild, like every other backend lib in the CLI graph.
