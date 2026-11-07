## Fixes

1. Registry writes check the machine count and serialized UTF-8 size before creating a temp file or replacing the registry; typed `MachineRegistryWriteError` codes identify the limit. `machine-registry.ts:75`. Spec: `rejects an oversized write before replacing the existing registry`.
2. Credential read failures and non-string values leave only the affected machine unpaired; optional logger receives an error message without the returned value. `machines-service.ts:86`. Spec: `keeps listing other machines when one credential read fails or is malformed`.
3. Retry returns immediately for a connected machine and leaves its live client intact. `machine-connection.ts:414`. Spec: `retry on a connected machine preserves the live client`.
4. Connection attempts and exchange are mutually exclusive; exchange closes only its own client and transport. `machine-connection.ts:232,336`. Spec: `does not open a new connection while a pairing exchange is in flight`.
5. Worker identity mismatch revokes the issued token on the pairing client, with a 5-second best-effort limit, before rejecting. `machines-service.ts:216` and `machine-connection.ts:336`. Spec: `revokes the newly issued token on the pairing connection after worker mismatch`.
6. A saved pairing returns its offline summary when the first normal connection schedules a retry; other connection errors still reject. `machines-service.ts:269`. Spec: `returns an offline summary after a saved pairing has a retryable connection failure`.
7. SSH pairing takes a per-machine in-flight guard and the service mutation queue before the SSH command, rechecks state before exchange, and serializes against removal. `machines-service.ts:285`. Specs: `checks pairing preconditions before running the SSH command`; `rejects a concurrent SSH pairing before it can issue a second code`.
8. `add` accepts every syntactically valid alias; `sshAliases` remains a suggestion list. `machines-service.ts:165`; strict validation remains in `ssh-alias.ts:5`. Spec: `accepts a valid alias absent from the SSH suggestion list`.

## Decisions

- Kept the existing 256-machine and 256-KiB registry limits and used the exact serialized bytes written to disk. Reversible: yes.
- Added an optional no-op-by-omission logger option so token-read failures do not require host changes. Reversible: yes.
- Kept identity validation on the pairing connection through an optional exchange callback, allowing authenticated revocation before that connection closes. Reversible: yes.
- Used the existing mutation queue plus a per-machine guard for SSH pairing to prevent overlapping codes while preserving serialization with `pair` and `remove`. Reversible: yes.

## Verification

`npm run verify -- -p @ptah-extension/remote-machines -- --output-style=static` exited 0. Required filtered log:

```text
NX   Running targets lint, typecheck for project @ptah-extension/remote-machines:
NX   Successfully ran targets lint, typecheck for project @ptah-extension/remote-machines
NX   Running target test for project @ptah-extension/remote-machines:
Tests: 72 passed, 72 total
NX   Successfully ran target test for project @ptah-extension/remote-machines
```

Degradation audit: `audit-exit=0`, no remote-machines entries. DI lint: `di-lint OK`. Prettier ran on all changed TypeScript files.
