# Batch A1 report

Implemented plan batches 1, 2, 12, and 13 in `codex-runtime`, plus the optional CLI detection fields in `shared`. Installed native Codex is preferred when its version is at least 0.165.0; otherwise the selector uses the bundled native executable. SHA/platform pin admission, parity gate, and dev route were removed.

## Final public contract

The following are exported from `@ptah-extension/codex-runtime` (types are shown with their exact callable signatures):

```ts
export const CODEX_MIN_SUPPORTED_VERSION = '0.165.0';
export type CodexExecutableOrigin = 'installed' | 'bundled';
export interface CodexExecutableSelection {
  readonly path: string;
  readonly version: string;
  readonly source: CodexExecutableOrigin;
  readonly reason: string;
}
export interface CodexExecutableProbes {
  installedCandidates(): Promise<readonly string[]>;
  bundledCandidate(): Promise<string | undefined>;
  canonicalNativePath(path: string): Promise<string | undefined>;
  readVersion(path: string, timeoutMs: number): Promise<string>;
}
export interface CodexSelection {
  readonly selected: CodexExecutableSelection;
  readonly bundledFallback?: CodexExecutableSelection;
}
export function parseCodexVersion(output: string): string | undefined;
export function isCodexVersionSupported(version: string, minimum?: string): boolean;
export function selectCodexExecutable(probes: CodexExecutableProbes, minimum?: string): Promise<CodexSelection>;
export function createNodeCodexExecutableProbes(
  bundledCandidate: () => Promise<string | undefined>,
): CodexExecutableProbes;
export interface CodexSelectionSnapshotPort {
  selectForOpen(): Promise<CodexSelection>;
  current(): CodexExecutableSelection | undefined;
  activateFallback(failed: CodexExecutableSelection, method?: string): Promise<CodexExecutableSelection>;
}
export class CodexSelectionSnapshot implements CodexSelectionSnapshotPort {
  constructor(probes: CodexExecutableProbes);
}
export class CodexExecutableUnavailableError extends Error {
  constructor(minimum: string);
}
export class CodexUnsupportedMethodError extends Error {
  readonly method: string;
  readonly version: string;
  readonly source: 'installed' | 'bundled';
  constructor(method: string, version: string, source: 'installed' | 'bundled');
}
```

`CodexRuntimeOptions` now requires `selectionSnapshot: CodexSelectionSnapshotPort` alongside `spawner`, `store`, `sink`, `clock`, and `logger`; `requestUserInput` remains optional. `CodexRuntimeRegistrationPorts extends CodexRuntimeOptions` and requires `usage: (CodexRuntimeUsageNotifications & { readonly auth: CodexHomeAuthReader; readonly profileForHome: (home: string) => CodexExecutionProfile }) | null`. `registerCodexRuntime(container: DependencyContainer, ports: CodexRuntimeRegistrationPorts): void` registers the supplied snapshot as `CODEX_RUNTIME_TOKENS.SelectionSnapshot`, whose value is `Symbol.for('ptah.codex-runtime.SelectionSnapshot')`. `CODEX_RUNTIME_TOKENS.ExecutableSource` resolves `ports.selectionSnapshot.current()`; its type is `CodexExecutableSelection | undefined` at resolution. Hosts create one `CodexSelectionSnapshot(createNodeCodexExecutableProbes(async () => bundledNativePath))` per host scope, pass that same instance to chat, lane, and detection ports, and resolve the token from the scoped container. Call `selectForOpen()` on every new open/detection; use the returned `selected` for that process and `current()` for status. On a typed required-method `-32601` before a turn receipt, call `activateFallback(selected, error.method)` once, close the failed process, and reopen the same profile with the returned bundled selection. The optional second argument supplies the exact method in the safe status reason; this is an additive extension of the plan's one-argument snapshot port.

`CodexExecutableSource` is an alias of `CodexExecutableSelection`. The existing `IProcessSpawner` boundary remains from `@ptah-extension/platform-core`. `CliDetectionResult` now has `readonly codexSource?: 'installed' | 'bundled'` and `readonly codexReason?: string` in `@ptah-extension/shared`.

## Files created, modified, deleted

- Created: `libs/backend/codex-runtime/src/lib/select-codex-executable.ts`, `select-codex-executable.spec.ts`.
- Modified: `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts`, `codex-app-server-process.spec.ts`, `codex-runtime.ts`, `codex-runtime.spec.ts`, `codex-context.ts`, `codex-runtime-ports.ts`, `di/tokens.ts`, `di/registration.ts`, `di/registration.spec.ts`, `libs/backend/codex-runtime/src/index.ts`, `libs/shared/src/lib/types/agent-process.types.ts`.
- Deleted: `libs/backend/codex-runtime/src/lib/codex-executable-pin-data.ts`, `codex-executable-pin.ts`, `codex-executable-pin.spec.ts`, `codex-protocol-manifest.ts`, `codex-protocol-manifest.spec.ts`, `codex-executable-inspection.ts`, `codex-executable-inspection.spec.ts`, `codex-dev-route.ts`, `codex-dev-route.spec.ts`, `codex-parity-gate.ts`, `codex-parity-gate.spec.ts`.

## TypeScript check

- `npx tsc -p libs/backend/codex-runtime/tsconfig.lib.json --noEmit`: exit 1; no A1 file errors. The reported error was in concurrently edited `codex-event-translator.ts` (missing `isUnmodeledCodexNotification` import at the time of the check).
- `npx tsc -p libs/backend/codex-runtime/tsconfig.spec.json --noEmit`: exit 1; same translator error plus `codex-account-usage-client.spec.ts:163` TS2353 (`resolvedPath` fixture uses the deleted source shape). That spec is outside A1 ownership.
- Latest scoped `ptah_get_diagnostics`: no errors in requested A1 files; sibling diagnostics remain in the concurrent protocol translator work and the account usage spec. A2's schema changes were still in flight. No tests were run, per lane instructions.

## Decisions

- **Installed-first native selector:** The plan chose one selector in `codex-runtime` over per-host exact-pin checks. The existing bundled native resolver remains a host-supplied callback, preserving the dependency direction. Reversible: yes.
- **Optional method argument on fallback activation:** The plan's one-argument port could not produce its required exact status text containing `model/list` or another missing method. An optional `method` argument preserves one-argument implementers and lets callers provide the safe method name. Reversible: yes.
- **One-shot fallback tracked per selection object:** Concurrent opens can select independently; a `WeakMap` keeps each open's already-probed bundled candidate and prevents a later selection from invalidating an earlier open's one fallback. `current()` records the latest selection or fallback transition for host status. Reversible: yes.
- **Catalog preflight at open:** `model/list` is called after thread open and before returning a context. A typed required-method failure can trigger bundled reopen. Other catalog failures log a sanitized class and leave basic chat available, matching the plan's empty/unavailable catalog behavior. Reversible: yes.

## Open issues for other lanes

- Coordinator or owner of `codex-account-usage-client.spec.ts`: replace its `resolvedPath` executable fixture at line 163 with the new `{ path, version, source, reason }` selection. A1 cannot edit that file under its explicit ownership list.
- A2: finish tolerant protocol schema and translator changes; the current project diagnostics include translator property-narrowing errors after A2's unknown item variant was added. A1 adjusted its own context narrowing but did not edit A2 files.
- Chat and lane owners: handle a first `turn/start` `CodexUnsupportedMethodError` before a receipt with one bundled retry, passing `error.method` to `activateFallback`. Do not replay a received turn. Treat other method failures locally.
- Host owners: supply the bundle's native path to `createNodeCodexExecutableProbes`, register one shared snapshot, and migrate all deleted gate/pin imports before integration typechecks. The `-32601` protocol classification remains the plan's assumption pending a live Codex check.
- No skill-loading mechanism was listed for this lane; no optional skill was loaded.
