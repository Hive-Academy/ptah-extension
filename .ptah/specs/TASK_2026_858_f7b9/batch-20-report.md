## Files changed

- `libs/worker-protocol/src/lib/worker-command.ts`, `.spec.ts`, and `src/index.ts`: added and exported the absolute packaged worker command.
- `libs/backend/remote-machines/src/lib/ssh-alias.ts`, `.spec.ts`: alias validation and injectable SSH config listing.
- `libs/backend/remote-machines/src/lib/ssh-worker-commands.ts`, `.spec.ts`: SSH status/pair execution, 15-second timeout, protocol-schema parsing, and version-mismatch mapping.
- `libs/backend/remote-machines/src/lib/ssh-stdio-transport.ts`, `.spec.ts`: SSH stdio Duplex with process cleanup.
- `libs/backend/remote-machines/src/lib/machine-registry.ts`, `.spec.ts`: validated owner-only atomic registry persistence.
- `libs/backend/remote-machines/src/lib/machine-token-store.ts`, `.spec.ts`: per-machine secret storage and plaintext-mode warning.
- `libs/backend/remote-machines/src/index.ts`: public exports.
- `.ptah/specs/TASK_2026_858_f7b9/batch-20-report.md`: this report.

## Decisions

- **Remote command**: use the worker-protocol absolute constant rather than PATH lookup. Evidence: plan R6.3/AD-29. Reversible: yes, with coordinated packaging change.
- **Port**: use 41873 locally because worker-protocol has no exported port constant and worker-runtime's server defaults to 41873. Reversible: yes.
- **Registry shape**: store machine ID, SSH alias, and optional display name; exclude tokens. Evidence: AD-11 and `ISecretStorage` contract. Reversible: yes, before consumers exist.
- **Plaintext warning**: expose `warning()` from `MachineTokenStore` using optional `ISecretStorage.storageMode()`. Evidence: the interface and Electron implementation expose `plaintext`. Reversible: yes.
- **Dependencies**: no package.json change; existing worker-runtime also uses an empty dependency map and workspace aliases. Reversible: yes.

## Verification

- `ptah_get_diagnostics` scoped to changed implementation files: 0 errors, 0 warnings.
- Exact command: `npm run verify -- -p @ptah-extension/worker-protocol,@ptah-extension/remote-machines -- --output-style=static` (captured through `tee`, filtered with `tail -40`, then searched for `Failed tasks`). Exit code 0.
- `NX Successfully ran targets lint, typecheck for 2 projects`.
- worker-protocol: 9 suites passed, 188 tests passed.
- remote-machines: 5 suites passed, 8 tests passed.
- `NX Successfully ran target test for 2 projects`.
- `Failed tasks`: absent from the captured output.

## Known limits

- The SSH config reader lists literal `Host` aliases from the main config file; it does not expand `Include` directives.
- Batch 21 owns connection and reconnect behavior; this batch provides only the stdio transport.

## Orchestrator review round 1

1. Added `error` listeners to SSH stdin, stdout, and stderr. They destroy the transport once with an actionable message; a late write and EPIPE have a regression spec.
2. Added transport specs for stderr on nonzero exit, readable end on exit zero, stdout to Duplex, and Duplex to stdin.
3. Command SSH now uses `stdio: ['ignore', 'pipe', 'pipe']`, so the remote process receives EOF on stdin. Updated argv spec.
4. Added optional `machineLabel`, defaulting to the alias, and used it in command error messages. Version-mismatch copy has a display-name spec.
5. Oversized stdout now yields `invalid-output` with an "output too large" message; covered by a spec.
6. Added command specs for the 15-second timeout, parsed valid status, pair option order and pre-spawn validation, and spawn failure.
7. Both alias and registry use `MACHINE_SSH_ALIAS_PATTERN` from the public `@ptah-extension/shared` entry point. The `scope:extension` boundary permits `scope:shared`; lint passed.
8. Registry now tracks whether rename landed, skips temp cleanup after rename, and treats post-rename directory fsync as best-effort. Added missing-file, rename-failure cleanup, and schema-invalid-file specs.
9. Ran `npx prettier --write` over all files created or changed in the original batch and this review, with a final formatting run after the last edit.

Final verification: `npm run verify -- -p @ptah-extension/worker-protocol,@ptah-extension/remote-machines -- --output-style=static 2>&1 | tail -40` (captured with `tee` before `tail` to check failure text). Exit code 0. `NX Successfully ran targets lint, typecheck for 2 projects`; worker-protocol 9 suites and 188 tests passed; remote-machines 5 suites and 20 tests passed; `NX Successfully ran target test for 2 projects`. `Failed tasks`: absent. Scoped `ptah_get_diagnostics`: 0 errors, 0 warnings.
