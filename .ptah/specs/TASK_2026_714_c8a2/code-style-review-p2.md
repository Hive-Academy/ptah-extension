# Code Style Review P2 - @ptah-extension/codex-runtime

Review family: Claude reviewer, Codex implementer.
Score: 7/10. Verdict: REVISE (no blockers; 3 serious findings worth fixing before P3 builds on this).

## Passes
- Boundaries: imports only `@ptah-extension/platform-core` (IDisposable, IProcessSpawner); tags `scope:extension`,`type:feature` match auth-providers/cli-agent-runtime; auth-providers -> codex-runtime only, no cycle.
- No `any`, no `as unknown as`, no `console.*`, no eslint-disable/ts-ignore. Only two `degradation-audit: reported` comments (codex-runtime.ts:397, :547), both carry real rationale.
- Public API (index.ts) is type-first and hides validator/process/manifest internals; `CodexProtocolManifest` is NOT exported (only `CodexBinaryIdentity`).
- Tokens are `Symbol.for` in a const object; nullable uses `{ useFactory: () => null }` (registration.ts:46-52). Naming kebab-case with role suffixes.

## Findings
1. SERIOUS - god file. src/lib/codex-protocol-validator.ts is 1041 lines (eslint max-lines 700 warns at :708, 1021 counted). It mixes ~45 schema constants (:3-533), request/server-request/notification tables (:534-807), error class/dispatch (:808-1041). Split by responsibility (schemas/items, schemas/requests, schemas/notifications, frame/dispatch) with the validator as thin barrel. codex-runtime.ts (669 lines) is near the limit; codex-app-server-process (413) fine.
2. SERIOUS - spec fixtures depend on task-folder evidence. codex-protocol-validator.spec.ts:197-217 and codex-event-translator.spec.ts:400-409 read `.ptah/specs/TASK_2026_714_c8a2/spike-run-*.json` via fragile `../../../../../` paths (lines 1/19 also read the schema/manifest). Task folders are not stable library inputs and may be archived. Copy trimmed, sanitized frames into `src/lib/__fixtures__/` (the schema/manifest JSON already live in `src/lib/protocol/`). Same smell in codex-parity-gate.ts:14 (doc references the task folder; acceptable as a comment, but evidence strings should not require the folder to exist).
3. SERIOUS - duplicated concept. `CodexProtocolManifest` (codex-protocol-manifest.ts:2) is a strict structural subset of `CodexExecutableManifestRow` (codex-runtime-ports.ts:10) and exists only so `verifyCodexBinary` accepts the row (codex-app-server-process.ts:105 passes the row). Drop it and type `verifyCodexBinary` against `Pick<CodexExecutableManifestRow,'platform'|'arch'|'pinnedVersion'|'binarySha256'>`; also `binaryPath?` is dead.
4. MINOR (duplicated helpers) - home normalization is implemented three times: codex-account-usage-client.ts:40 (`normalizeHome`, lowercases on win32, rejects NUL), codex-execution-profile.ts:153 (`normalize` with realpath), and auth-providers codex-home-auth.service.ts:54/158 (`resolve(home)`). Keys can diverge (case, symlink) and the port doc says "all home arguments are normalized". Export one `normalizeCodexHome` from codex-runtime and reuse.
5. MINOR - registration shape: registration.ts:38-43 eagerly `new`s CodexRuntime/CodexParityGate with `useValue`, whereas cli-agent-runtime/di/register.ts uses `instanceCachingFactory`. Defensible (host-owned lifecycle, documented at :16-19), but `CodexParityGate` is registered by class while everything else uses tokens; consider adding a `ParityGate` token for consistency. Also the usage-profile identity check (:60-63) is logic inside DI wiring; move into a named function.
6. MINOR - tokens.ts:2-10 includes `Clock`/`Logger` with `ptah.codex-runtime.*` names that mirror platform-core/vscode-core tokens; fine, but `Logger` token is typed as `CodexRuntimeLogger` (a private duplicate of the shared Logger shape). Acceptable to keep the lib agnostic; add one line noting why not the platform logger.
7. MINOR - index.ts trailing comment block (lines 28-34) is a review-follow-up note about experimentalApi; belongs in the task report or a TODO with an owner, not the public barrel. Ports use `export type *` of whole modules (index.ts:2-6) which leaks every future type added to codex-runtime-ports/types; prefer explicit lists for a public surface. `Clock` is a very generic exported name; consider `CodexClock`.
8. MINOR - package.json lists `zod`/`tsyringe` as dependencies; project.json build externals include unrelated `vscode`, `better-sqlite3`, `sqlite-vec` (copied boilerplate, lib never imports them). Trim to what the lib uses.
9. MINOR - `test.options.passWithNoTests` in project.json is unneeded now that specs exist.

## Verification
`npx eslint` on validator, registration, runtime: 0 errors, 1 warning (max-lines, finding 1).
