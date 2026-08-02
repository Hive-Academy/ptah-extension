# @ptah-extension/thoth-runtime

[Back to Main](../../../CLAUDE.md)

## Purpose

Runtime-agnostic boot of the **Thoth channel** — the persistence + memory + skills + cron half of a Ptah host. Extracted verbatim from `apps/ptah-electron/src/activation/wire-runtime.ts`, which remains the reference implementation.

Owns: SQLite open/migrate + `sqlite-vec` diagnostics, memory curator + memory trigger, memory/vec/embedder push bridges, skill synthesis + skill trigger, code-symbol indexing run-deps, the workspace file index, and the cron scheduler with its built-in daily backup job.

## Boundaries

**Belongs here**: anything on the Thoth lifecycle path that only needs DI tokens to do its job.

**Does NOT belong**: host activation (content download, plugin loader, CLI detection, session import, git watcher, application menu), transport wiring, and the messaging gateway. Those stay with the host.

No `electron`, `vscode`, or app-local imports. Every collaborator is resolved from the `DependencyContainer` passed in by the host.

## Public API

```ts
bootThothRuntime(container, { workspaceRoot, logPrefix? }): Promise<ThothRuntimeRefs>
startThothCron(container, refs, { logPrefix? }): Promise<void>

emitVecLoadDiagnostic(container, diagnostic, logPrefix?)
serializeVecDiagnosticForBridge(diagnostic)
serializeEmbedderSnapshotForBridge(snapshot)
resetVecLoadDiagnosticForTest()      // test-only latch reset

emptyThothRuntimeRefs(): ThothRuntimeRefs
DEFAULT_THOTH_LOG_PREFIX
```

## Guidelines

- **Cron is a separate call on purpose.** Hosts run their own activation work between the Thoth boot and the cron start; folding cron into `bootThothRuntime` would let scheduled jobs fire during content download / session import. Do not merge them.
- **Every block is individually guarded and non-fatal.** A failure degrades that feature to `PERSISTENCE_UNAVAILABLE`; it never aborts host activation. Keep new blocks in the same shape.
- **`ThothRuntimeRefs` field names are load-bearing** — hosts capture them for their LIFO teardown chain. Renaming a field is a breaking change for every host.
- **`logPrefix`** exists so hosts keep their existing console signature (`[Ptah Electron]`). It is not a logging abstraction; do not grow it into one.
- `libs/backend/cli-engine` has its own `activateThoth`/`disposeThoth` for the CLI tier model. Converging the two is a separate task — do not partially merge them.

## Cross-Lib Rules

`scope:extension`, `type:feature`. Depends on `platform-core`, `vscode-core`, `shared`, `persistence-sqlite`, `memory-curator`, `skill-synthesis`, `cron-scheduler`, `workspace-intelligence`, `rpc-handlers`. No frontend imports.

## Test

`nx test @ptah-extension/thoth-runtime`. Specs drive a hand-rolled `DependencyContainer` stub (`isRegistered` + `resolve`) rather than a real tsyringe graph, so they assert boot behaviour rather than registration.
